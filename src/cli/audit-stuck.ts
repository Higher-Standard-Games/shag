/**
 * Stuck-geometry audit.
 *
 * Walks a simulated player hull along and into map surfaces looking for places
 * the collision trace lets a body penetrate, or traps one that got in. This
 * exists because "I get stuck on that handrail" is not reproducible by hand:
 * you cannot tell whether a fix generalised, and you never find the other
 * twelve rails nobody happened to walk into.
 *
 * The suspect class is patch (bezier) and triangle-soup collision. Those are
 * traced as raw triangles against the triangle's own FACE plane only — the box
 * sweep has no edge or vertex bevel planes (Q3 generates these in
 * `CM_AddFacetBevels`; nothing here does). Near a triangle edge the face plane
 * and the 2D containment test disagree, so a hull can slip in; once inside, the
 * trace reports `startSolid` with the FACE normal, which is the wrong direction
 * to push out of an edge contact, and the slide move cannot resolve it.
 *
 * Run:
 *   npx vite-node src/cli/audit-stuck.ts -- wbomb6
 *   npx vite-node src/cli/audit-stuck.ts -- wbomb6 --at 512 64 -300
 *   npx vite-node src/cli/audit-stuck.ts -- wbomb6 --ladders
 *
 * Coordinates are BABYLON space (y up) — the same numbers the game console
 * prints — so a reported position can be teleported to directly.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { ingestPk3Dir, resolveMapBspViaIndex } from "../engine/loader/pk3/NodePk3";
import { CollisionMasks, SurfaceFlags } from "../engine/physics/ContentFlags";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../engine/physics/PlayerPhysicsConstants";
import { SweepCollisionBackend } from "../engine/physics/SweepCollisionBackend";
import { runCli } from "./_runCli";

const DIRS = ["public/data", "public/data/basewsw"];

const HULL = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT, contentMask: CollisionMasks.PLAYERSOLID };

/** Run speed, and the step the movement profile uses. */
const WALK_SPEED = 320;
const DT = 1 / 125;
const WALK_STEPS = 24;

/** Horizontal directions a player might approach a rail from. */
const DIRECTIONS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new Vector3(Math.cos(a), 0, Math.sin(a));
});

/** Directions tried when asking whether a penetrated body can get back out. */
const ESCAPE_DIRS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
  new Vector3(0, 1, 0),
  new Vector3(1, 0, 1).normalize(),
  new Vector3(-1, 0, 1).normalize(),
  new Vector3(1, 0, -1).normalize(),
  new Vector3(-1, 0, -1).normalize(),
];

interface Finding {
  kind: "penetrated" | "trapped";
  position: Vector3;
  from: Vector3;
  direction: Vector3;
  surface: string;
  patch: boolean;
  escapes: number;
}

/** Is a hull at this origin free of solid? */
function isFree(backend: SweepCollisionBackend, at: Vector3): boolean {
  const trace = backend.trace(at, at, HULL);
  return !trace.startSolid && !trace.allSolid;
}

/**
 * Can a body at this origin get out?
 *
 * Penetration that resolves itself on the next step is noise — players never
 * notice it. Penetration you cannot leave is the bug being hunted, so this is
 * what separates the two.
 */
function escapeCount(backend: SweepCollisionBackend, at: Vector3): number {
  let escapes = 0;
  for (const dir of ESCAPE_DIRS) {
    let pos = at.clone();
    for (let i = 0; i < 8; i++) {
      const move = dir.scale(WALK_SPEED * DT);
      pos = backend.stepSlideMove(pos, move, HULL).endPos;
    }
    if (isFree(backend, pos)) escapes++;
  }
  return escapes;
}

/** Walk a hull from `start` along `dir` and report the first penetration. */
function walk(
  backend: SweepCollisionBackend,
  start: Vector3,
  dir: Vector3,
  surface: string,
  patch: boolean,
): Finding | null {
  let pos = start.clone();

  for (let step = 0; step < WALK_STEPS; step++) {
    const move = dir.scale(WALK_SPEED * DT);
    pos = backend.stepSlideMove(pos, move, HULL).endPos;

    if (isFree(backend, pos)) continue;

    // The hull is inside geometry it walked into. Whether that matters depends
    // entirely on whether it can get back out.
    const escapes = escapeCount(backend, pos);
    return {
      kind: escapes === 0 ? "trapped" : "penetrated",
      position: pos.clone(),
      from: start.clone(),
      direction: dir.clone(),
      surface,
      patch,
      escapes,
    };
  }
  return null;
}

/** Sample origins in open air just off a triangle, on both sides. */
function samplesAround(a: Vector3, b: Vector3, c: Vector3): Vector3[] {
  const centre = a
    .add(b)
    .add(c)
    .scale(1 / 3);
  const normal = Vector3.Cross(b.subtract(a), c.subtract(a));
  if (normal.lengthSquared() < 1e-6) return [];
  normal.normalize();

  const out: Vector3[] = [];
  for (const sign of [1, -1]) {
    for (const distance of [PLAYER_RADIUS + 4, PLAYER_RADIUS + 20]) {
      // Lift toward standing height: a rail is hit by the body, not the feet.
      out.push(centre.add(normal.scale(sign * distance)).add(new Vector3(0, 8, 0)));
    }
  }
  return out;
}

function describe(v: Vector3): string {
  return `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.z.toFixed(1)}`;
}

/** Dump every surface a trace from one spot reports, for a single position. */
function inspect(backend: SweepCollisionBackend, at: Vector3): void {
  console.log(`\n=== inspect ${describe(at)} (Babylon) ===`);
  const here = backend.trace(at, at, HULL);
  console.log(
    `  resting hull: startSolid=${here.startSolid} allSolid=${here.allSolid} ` +
      `contents=0x${here.contents.toString(16)} texture=${here.hitTextureName ?? "—"}`,
  );
  console.log(`  escapes: ${escapeCount(backend, at)}/${ESCAPE_DIRS.length} directions`);

  // Ground probe: a walkable surface has to hold the hull up. Patches and soup
  // carry real floors in these maps, so a collision change that stopped them
  // blocking would drop players out of the world rather than merely feel wrong.
  const ground = backend.trace(at, at.add(new Vector3(0, -512, 0)), HULL);
  console.log(
    `  ground: ${ground.fraction < 1 ? `hit at y=${ground.endPos.y.toFixed(1)}` : "none within 512"} ` +
      `normal=(${ground.normal ? describe(ground.normal) : "—"}) tex=${ground.hitTextureName ?? "—"}`,
  );

  for (const dir of DIRECTIONS) {
    const end = at.add(dir.scale(64));
    const trace = backend.trace(at, end, HULL);
    const normal = trace.normal ? describe(trace.normal) : "—";
    console.log(
      `  ${describe(dir).padEnd(20)} frac=${trace.fraction.toFixed(3)} ` +
        `normal=(${normal}) startSolid=${trace.startSolid} tex=${trace.hitTextureName ?? "—"}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const mapName = args.find((a) => !a.startsWith("--") && !/^-?\d/.test(a)) ?? "wbomb6";
  const atIndex = args.indexOf("--at");
  const laddersOnly = args.includes("--ladders");

  for (const dir of DIRS) await ingestPk3Dir(dir);
  const bytes = await resolveMapBspViaIndex(DIRS, mapName);
  if (!bytes) throw new Error(`Map not found through PK3 index: ${mapName}`);

  const bsp = BspLoader.load(bytes);
  const backend = new SweepCollisionBackend();
  await backend.init(bsp);

  if (atIndex >= 0) {
    const [x, y, z] = args.slice(atIndex + 1, atIndex + 4).map(Number);
    if (![x, y, z].every(Number.isFinite)) throw new Error("--at needs three numbers (Babylon x y z)");
    inspect(backend, new Vector3(x, y, z));
    return;
  }

  // Ladder brush centres, in Babylon space — the region of interest when the
  // report is "that handrail next to the ladder".
  const ladderSpots: Vector3[] = [];
  for (let bi = 0; bi < bsp.brushes.length; bi++) {
    const brush = bsp.brushes[bi];
    const sides = bsp.brushSides.slice(brush.firstSide, brush.firstSide + brush.numSides);
    const isLadder = sides.some((s) => (bsp.textures[s.shaderIndex]?.surfaceFlags ?? 0) & SurfaceFlags.LADDER);
    if (!isLadder) continue;
    const mins = [-1e9, -1e9, -1e9];
    const maxs = [1e9, 1e9, 1e9];
    for (const side of sides) {
      const plane = bsp.planes[side.planeIndex];
      if (!plane) continue;
      for (let a = 0; a < 3; a++) {
        if (plane.normal[a] > 0.9) maxs[a] = Math.min(maxs[a], plane.dist);
        if (plane.normal[a] < -0.9) mins[a] = Math.max(mins[a], -plane.dist);
      }
    }
    if (mins.some((m) => m < -1e8) || maxs.some((m) => m > 1e8)) continue;
    // Q3 (x, y, z) -> Babylon (x, z, y)
    ladderSpots.push(new Vector3((mins[0] + maxs[0]) / 2, (mins[2] + maxs[2]) / 2, (mins[1] + maxs[1]) / 2));
  }

  for (const spot of ladderSpots) console.log(`[ladder] centre ${describe(spot)} (Babylon)`);

  const LADDER_RANGE = 512;
  const findings: Finding[] = [];
  let facesScanned = 0;
  let trianglesScanned = 0;

  for (let i = 0; i < bsp.faces.length; i++) {
    const geometry = backend.getFaceCollision(i);
    if (!geometry) continue;

    const face = bsp.faces[i];
    const patch = face.faceType === 2;
    const surface = bsp.textures[face.textureIndex]?.name ?? "?";

    // A rail is hit around chest height; skip faces nowhere near the ladders
    // when asked to focus, so the interesting run stays small enough to read.
    if (laddersOnly) {
      const centre = geometry.mins.add(geometry.maxs).scale(0.5);
      if (!ladderSpots.some((spot) => Vector3.Distance(spot, centre) < LADDER_RANGE)) continue;
    }

    facesScanned++;

    for (let t = 0; t + 2 < geometry.indices.length; t += 3) {
      const a = geometry.vertices[geometry.indices[t]];
      const b = geometry.vertices[geometry.indices[t + 1]];
      const c = geometry.vertices[geometry.indices[t + 2]];
      if (!a || !b || !c) continue;
      trianglesScanned++;

      for (const start of samplesAround(a, b, c)) {
        if (!isFree(backend, start)) continue;
        for (const dir of DIRECTIONS) {
          const finding = walk(backend, start, dir, surface, patch);
          if (finding) findings.push(finding);
        }
      }
    }
  }

  console.log(`\n=== stuck audit: ${mapName}${laddersOnly ? " (near ladders)" : ""} ===`);
  console.log(`faces scanned ${facesScanned}, triangles ${trianglesScanned}`);
  console.log(`\npenetrations: ${findings.length}`);
  console.log(`  a hull walked out of verified-free air and ended up inside solid.`);
  console.log(`  a correct sweep never allows that, so each one is a defect; the`);
  console.log(`  escape count is how bad it feels rather than whether it is real.`);

  const patchHits = findings.filter((f) => f.patch).length;
  console.log(`\nby surface kind: patch ${patchHits}, soup ${findings.length - patchHits}`);

  const histogram = new Map<number, number>();
  for (const f of findings) histogram.set(f.escapes, (histogram.get(f.escapes) ?? 0) + 1);
  console.log(`\nescape directions available (of ${ESCAPE_DIRS.length}) — lower is worse:`);
  for (const escapes of [...histogram.keys()].sort((a, b) => a - b)) {
    const count = histogram.get(escapes) ?? 0;
    const label = escapes === 0 ? "TRAPPED" : String(escapes);
    console.log(`  ${label.padStart(7)}: ${"#".repeat(Math.min(60, count))} ${count}`);
  }

  // Cluster, so one rail is one line rather than four hundred.
  const clusters: Finding[] = [];
  for (const finding of [...findings].sort((a, b) => a.escapes - b.escapes)) {
    if (clusters.some((c) => Vector3.Distance(c.position, finding.position) < 64)) continue;
    clusters.push(finding);
  }

  console.log(`\ndistinct sites: ${clusters.length} (worst first)`);
  for (const c of clusters.slice(0, 30)) {
    console.log(
      `  ${describe(c.position).padEnd(26)} ${c.patch ? "PATCH" : "soup "} ` +
        `escapes=${c.escapes}/${ESCAPE_DIRS.length}  ${c.surface}`,
    );
  }
  if (clusters.length > 30) console.log(`  … ${clusters.length - 30} more`);
}

runCli(main).then(() => process.stdout.write("", () => process.exit(process.exitCode ?? 0)));
