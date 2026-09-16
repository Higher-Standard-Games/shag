/**
 * v0.9.23 asset probe: invisible map weapons and untextured projectiles.
 *
 * Run from the repository root, naming the pk3s whose shader scripts to load:
 *   npx vite-node docs/research/v0.9.23-asset-probe.ts -- data0_21pure.pk3 map_wdm2.pk3
 * Add --only=N to run a single section.
 *
 * 1. The render surface under every wdm2 weapon spawn and around it, and
 *    whether BspMeshBuilder gives that surface Havok collision. It only does so
 *    for opaque shader groups on the world model.
 * 2. Disposing one clone with dispose(false, true), as Pickup.dispose does,
 *    disposes the material its cached source and every sibling clone share.
 * 3. A Babylon AutoReleaseWorkerPool whose worker creation rejects never runs
 *    the queued action, so a KTX2 decode behind it never settles.
 * 4. Real Havok: how far a launched corpse or a dropped weapon moves a settled
 *    map weapon body. Repeated with collision filters.
 * 5. SceneCommand.clearScene disposes the meshes AssetPreloader and
 *    ProjectileManager cache, and a clone of a disposed mesh has no vertices.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { AutoReleaseWorkerPool } from "@babylonjs/core/Misc/workerPool";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import { Scene } from "@babylonjs/core/scene";
import HavokPhysics from "@babylonjs/havok";
import { type BspFile, BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import { ingestPk3File, resolveMapBspViaIndex } from "../../src/engine/loader/pk3/NodePk3";
import { Q3ShaderRegistry } from "../../src/engine/loader/shader/Q3ShaderRegistry";
import { CLASSNAME_TO_WEAPON } from "../../src/shared/bsp/PickupTable";

type V3 = [number, number, number];
interface Tri {
  v: [V3, V3, V3];
  face: number;
  model: number;
}

const SURF_NODRAW = 0x80;
const unhandled: string[] = [];
process.on("unhandledRejection", (reason) => unhandled.push(String(reason)));

// ── 1. wdm2 weapon spawn surfaces ───────────────────────────────────────────

function triangles(bsp: BspFile): Tri[] {
  const out: Tri[] = [];
  const pos = (i: number) => bsp.vertices[i].position as V3;
  bsp.models.forEach((model, m) => {
    for (let f = model.firstFace; f < model.firstFace + model.numFaces; f++) {
      const face = bsp.faces[f];
      if (!face) continue;
      if (face.faceType === 1 || face.faceType === 3) {
        for (let k = 0; k + 2 < face.numMeshVerts; k += 3) {
          const at = (n: number) => pos(face.firstVertex + bsp.meshVerts[face.firstMeshVert + n]);
          out.push({ v: [at(k), at(k + 1), at(k + 2)], face: f, model: m });
        }
      } else if (face.faceType === 2) {
        // Control net, not the tessellated curve: close enough to name the surface.
        const [w, h] = face.patchSize;
        const at = (i: number, j: number) => pos(face.firstVertex + j * w + i);
        for (let j = 0; j + 1 < h; j++) {
          for (let i = 0; i + 1 < w; i++) {
            out.push({ v: [at(i, j), at(i + 1, j), at(i + 1, j + 1)], face: f, model: m });
            out.push({ v: [at(i, j), at(i + 1, j + 1), at(i, j + 1)], face: f, model: m });
          }
        }
      }
    }
  });
  return out;
}

/** Height of a triangle at (x, y), or null when the vertical line misses it. */
function heightAt([a, b, c]: [V3, V3, V3], x: number, y: number): number | null {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return null;
  const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
  const l3 = 1 - l1 - l2;
  if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null;
  return l1 * a[2] + l2 * b[2] + l3 * c[2];
}

function surfaceBelow(tris: Tri[], x: number, y: number, top: number) {
  let best: { z: number; tri: Tri } | null = null;
  for (const tri of tris) {
    const z = heightAt(tri.v, x, y);
    if (z === null || z > top) continue;
    if (!best || z > best.z) best = { z, tri };
  }
  return best;
}

async function spawnSurfaces(pk3s: string[], map: string) {
  const dataDir = path.resolve("public/data");
  for (const pk3 of pk3s) {
    if (!(await ingestPk3File(dataDir, pk3))) console.warn(`[probe] could not ingest ${pk3}`);
  }
  const registry = Q3ShaderRegistry.getInstance();
  const shaderCount = await registry.loadShaders();

  const buffer = await resolveMapBspViaIndex([dataDir], map);
  if (!buffer) throw new Error(`${map}.bsp not found`);
  const bsp = BspLoader.load(buffer);
  const tris = triangles(bsp);

  const describe = (hit: ReturnType<typeof surfaceBelow>) => {
    if (!hit) return { texture: "(none)", havok: false };
    const texture = bsp.textures[bsp.faces[hit.tri.face].textureIndex];
    const props = registry.resolveMaterialProps(texture.name);
    const drawn = (texture.surfaceFlags & SURF_NODRAW) === 0 && !props.isSky && !props.autosprite && !props.autosprite2;
    return {
      texture: texture.name,
      model: hit.tri.model,
      faceType: bsp.faces[hit.tri.face].faceType,
      transparent: props.isTransparent,
      // BspMeshBuilder: world model, drawn, and !isTransparent → createStaticBody(MESH).
      havok: hit.tri.model === 0 && drawn && !props.isTransparent,
    };
  };

  console.log(`\n== 1. ${map} weapon spawn surfaces (shaders loaded: ${shaderCount}) ==`);
  const floors = new Set<string>();
  for (const entity of bsp.entities) {
    if (!CLASSNAME_TO_WEAPON[entity.classname] || !entity.properties.origin) continue;
    const [x, y, z] = entity.properties.origin.split(" ").map(Number);
    // The client spawns weapons 24u above the origin and pops them upward.
    const top = z + 40;
    const center = surfaceBelow(tris, x, y, top);
    const centerInfo = describe(center);
    floors.add(centerInfo.texture);

    const ring: string[] = [];
    for (const radius of [16, 32, 48]) {
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2;
        const hit = surfaceBelow(tris, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, top);
        const info = describe(hit);
        const drop = center && hit ? center.z - hit.z : Number.POSITIVE_INFINITY;
        if (!info.havok || drop > 16) {
          floors.add(info.texture);
          ring.push(
            `r${radius}@${k * 45}°: ${info.texture} drop=${Number.isFinite(drop) ? drop.toFixed(0) : "void"} havok=${info.havok}`,
          );
        }
      }
    }
    console.log(
      `${entity.classname} @ ${x} ${y} ${z}: floor=${centerInfo.texture} ` +
        `height=${center ? (z - center.z).toFixed(0) : "void"} model=${centerInfo.model ?? "-"} ` +
        `transparent=${centerInfo.transparent ?? "-"} havok=${centerInfo.havok}`,
    );
    for (const line of ring) console.log(`    ${line}`);
  }

  console.log("\n   shaders of the reported surfaces:");
  for (const name of floors) {
    const shader = registry.getShader(name);
    if (!shader) {
      console.log(`   ${name}: no shader script (plain texture)`);
      continue;
    }
    const stages = shader.stages.map(
      (s) =>
        `${s.map ?? "?"}${s.blendFunc ? ` blend=${s.blendFunc.join("/")}` : ""}${s.alphaFunc ? ` alpha=${s.alphaFunc}` : ""}`,
    );
    console.log(`   ${name}: surfaceparms=[${[...shader.surfaceParms].join(",")}] stages=${stages.join(" | ")}`);
  }
}

// ── 2. Shared material disposal ────────────────────────────────────────────

function sharedMaterialDisposal(disposeMaterials: boolean) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cached = MeshBuilder.CreateBox("cached_rlauncher", { size: 1 }, scene);
  const material = new StandardMaterial("rlauncher_shared", scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  material.diffuseTexture = texture;
  cached.material = material;
  const pickupA = cached.clone("rlauncher_pickup_a");
  const pickupB = cached.clone("rlauncher_pickup_b");
  const shared = pickupA.material === material && pickupB.material === material;
  const textureBefore = texture.getInternalTexture() !== null;

  pickupA.dispose(false, disposeMaterials);

  const result = {
    clonesShareMaterial: shared,
    textureAliveBefore: textureBefore,
    cachedStillPointsAtIt: cached.material === material,
    siblingStillPointsAtIt: pickupB.material === material,
    materialStillInScene: scene.materials.includes(material),
    textureStillAlive: texture.getInternalTexture() !== null,
  };
  engine.dispose();
  return result;
}

// ── 3. Worker pool with failing worker creation ────────────────────────────

async function failingWorkerPool() {
  let created = 0;
  let ran = 0;
  const pool = new AutoReleaseWorkerPool(2, async () => {
    created++;
    throw new Error("worker module failed to load");
  });
  for (let i = 0; i < 5; i++) {
    pool.push((_worker, onComplete) => {
      ran++;
      onComplete();
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const internals = pool as unknown as { _workerInfos: { idle: boolean }[]; _pendingActions: unknown[] };
  return {
    workersCreated: created,
    actionsRun: ran,
    slotsHeld: internals._workerInfos.length,
    slotsIdle: internals._workerInfos.filter((w) => w.idle).length,
    actionsQueuedForever: internals._pendingActions.length,
    unhandledRejections: unhandled.length,
  };
}

// ── 4. Havok: what moves a settled map weapon ─────────────────────────────

/** RagdollSystem.createBoneConfig boxes (MODEL_SCALE 36), stacked as a standing body. */
const S = 36;
const CORPSE: Array<{ w: number; h: number; d: number; x: number; y: number; mass: number }> = [
  { w: 0.3 * S, h: 0.15 * S, d: 0.2 * S, x: 0, y: 34, mass: 2 }, // hips
  { w: 0.25 * S, h: 0.12 * S, d: 0.18 * S, x: 0, y: 40, mass: 10 }, // spine: Ragdoll default mass
  { w: 0.32 * S, h: 0.16 * S, d: 0.22 * S, x: 0, y: 48, mass: 1 }, // spine2
  { w: 0.08 * S, h: 0.05 * S, d: 0.08 * S, x: 0, y: 55, mass: 1 }, // neck
  { w: 0.18 * S, h: 0.22 * S, d: 0.18 * S, x: 0, y: 61, mass: 1 }, // head
  { w: 0.08 * S, h: 0.22 * S, d: 0.08 * S, x: -10, y: 46, mass: 1 }, // left arm
  { w: 0.06 * S, h: 0.22 * S, d: 0.06 * S, x: -10, y: 38, mass: 1 }, // left forearm
  { w: 0.08 * S, h: 0.22 * S, d: 0.08 * S, x: 10, y: 46, mass: 1 }, // right arm
  { w: 0.06 * S, h: 0.22 * S, d: 0.06 * S, x: 10, y: 38, mass: 1 }, // right forearm
  { w: 0.12 * S, h: 0.4 * S, d: 0.12 * S, x: -4, y: 24, mass: 1 }, // left up leg
  { w: 0.1 * S, h: 0.38 * S, d: 0.1 * S, x: -4, y: 9, mass: 1 }, // left leg
  { w: 0.12 * S, h: 0.4 * S, d: 0.12 * S, x: 4, y: 24, mass: 1 }, // right up leg
  { w: 0.1 * S, h: 0.38 * S, d: 0.1 * S, x: 4, y: 9, mass: 1 }, // right leg
];

const WORLD = 1;
const PICKUPS = 2;
const DEBRIS = 4;

function glbExtents(file: string): V3 {
  const buffer = fs.readFileSync(file);
  const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString("utf8"));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], accessor.min[i]);
        max[i] = Math.max(max[i], accessor.max[i]);
      }
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

type Scenario = "none" | "corpse on spawn" | "corpse across" | "weapon dropped on";

async function havokDisplacement() {
  const wasmBinary = fs.readFileSync(path.resolve("node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm"));
  const havok = await (HavokPhysics as unknown as (options: object) => Promise<unknown>)({ wasmBinary });
  // The pickup visual is rlauncher.glb at its definition scale of 2.
  const [ex, ey, ez] = glbExtents(path.resolve("public/data/models/weapons/rlauncher/rlauncher.glb")).map((e) => e * 2);

  const run = (scenario: Scenario, angle: number, filtered: boolean) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.enablePhysics(new Vector3(0, -1000, 0), new HavokPlugin(true, havok));
    const physics = scene.getPhysicsEngine() as unknown as {
      _step(dt: number): void;
      setVelocityLimits(linear: number, angular: number): void;
    };
    // RagdollSystem raises the global limit on the first death of a session.
    physics.setVelocityLimits(10000, 100);
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) physics._step(1 / 60);
    };
    const filter = (agg: PhysicsAggregate, membership: number, collide: number) => {
      if (!filtered) return;
      agg.shape.filterMembershipMask = membership;
      agg.shape.filterCollideMask = collide;
    };

    const floor = MeshBuilder.CreateGround("floor", { width: 4000, height: 4000 }, scene);
    filter(new PhysicsAggregate(floor, PhysicsShapeType.MESH, { mass: 0 }, scene), WORLD, ~0);

    // Map weapon: EntityManager toss + Pickup tumble + PhysicsSystem body.
    const pickup: Mesh = MeshBuilder.CreateBox("rlauncher", { width: ex, height: ey, depth: ez }, scene);
    pickup.position.set(0, 24, 0);
    pickup.computeWorldMatrix(true);
    const pickupBody = new PhysicsAggregate(pickup, PhysicsShapeType.CONVEX_HULL, { mass: 10, restitution: 0.3 }, scene);
    filter(pickupBody, PICKUPS, WORLD);
    pickupBody.body.setLinearVelocity(new Vector3(15, 95, 8));
    pickupBody.body.setAngularVelocity(new Vector3(3, -2, 4));
    step(3);
    const settled = pickup.position.clone();

    const debris: PhysicsAggregate[] = [];
    if (scenario === "corpse on spawn" || scenario === "corpse across") {
      const across = scenario === "corpse across";
      const originX = settled.x + Math.cos(angle) * (across ? 96 : 16);
      const originZ = settled.z + Math.sin(angle) * (across ? 96 : 16);
      // Knockback is upward-biased; across flings the corpse back over the spawn.
      const dir = across
        ? new Vector3(-Math.cos(angle), 0.35, -Math.sin(angle))
        : new Vector3(Math.cos(angle), 0.8, Math.sin(angle));
      const velocity = dir.normalize().scale(670);
      CORPSE.forEach((bone, i) => {
        const mesh = MeshBuilder.CreateBox(`bone${i}`, { width: bone.w, height: bone.h, depth: bone.d }, scene);
        mesh.position.set(originX + bone.x, bone.y, originZ);
        mesh.computeWorldMatrix(true);
        const agg = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: bone.mass, restitution: 0 }, scene);
        filter(agg, DEBRIS, WORLD | DEBRIS);
        agg.body.setLinearVelocity(velocity);
        agg.body.setGravityFactor(0.8);
        debris.push(agg);
      });
    } else if (scenario === "weapon dropped on") {
      const mesh = MeshBuilder.CreateBox("dropped", { width: ex, height: ey, depth: ez }, scene);
      mesh.position.set(settled.x + Math.cos(angle) * 8, 56, settled.z + Math.sin(angle) * 8);
      mesh.computeWorldMatrix(true);
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.CONVEX_HULL, { mass: 10, restitution: 0.3 }, scene);
      filter(agg, DEBRIS, WORLD | DEBRIS);
      agg.body.setLinearVelocity(new Vector3(Math.cos(angle) * 150, 100, Math.sin(angle) * 150));
      agg.body.setAngularVelocity(new Vector3(6, -4, 5));
      debris.push(agg);
    }

    step(5); // RAGDOLL_LIFETIME
    for (const agg of debris) agg.dispose();
    step(2);
    const moved = pickup.position.subtract(settled);
    engine.dispose();
    return { horizontal: Math.hypot(moved.x, moved.z), vertical: moved.y };
  };

  console.log(`\n== 4. Havok: settled map weapon (hull ${ex.toFixed(0)}x${ey.toFixed(0)}x${ez.toFixed(0)}u, mass 10) ==`);
  const scenarios: Scenario[] = ["none", "corpse on spawn", "corpse across", "weapon dropped on"];
  for (const filtered of [false, true]) {
    console.log(filtered ? "   with pickup/debris collision filters:" : "   as shipped (no collision filters):");
    for (const scenario of scenarios) {
      const angles = scenario === "none" ? [0] : Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2);
      const results = angles.map((angle) => run(scenario, angle, filtered));
      const horizontal = results.map((r) => r.horizontal).sort((a, b) => a - b);
      const fellThrough = results.filter((r) => r.vertical < -40).length;
      const displaced = horizontal.filter((h) => h > 32).length;
      console.log(
        `   ${scenario.padEnd(18)} moved min/median/max ${horizontal[0].toFixed(0)}/` +
          `${horizontal[Math.floor(horizontal.length / 2)].toFixed(0)}/${horizontal[horizontal.length - 1].toFixed(0)}u, ` +
          `>32u in ${displaced}/${results.length}, fell through floor ${fellThrough}/${results.length}`,
      );
    }
  }
}

// ── 5. Cloning a cache whose meshes the scene clear disposed ───────────────

function cloneAfterSceneClear() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cached = MeshBuilder.CreateBox("cached_rlauncher", { size: 1 }, scene);
  cached.material = new StandardMaterial("rlauncher_shared", scene);
  // AssetPreloader and ProjectileManager keep their source meshes disabled in the scene.
  cached.setEnabled(false);
  const firstSession = cached.clone("pickup_first_session").getTotalVertices();

  // SceneCommand.clearScene disposes every scene mesh with dispose(false, true),
  // while both caches keep the disposed meshes and skip reloading them.
  for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
  const secondSession = cached.clone("pickup_second_session");

  const result = {
    verticesFirstSession: firstSession,
    cachedSourceDisposed: cached.isDisposed(),
    verticesSecondSession: secondSession.getTotalVertices(),
    secondSessionCloneDisposed: secondSession.isDisposed(),
  };
  engine.dispose();
  return result;
}

async function main() {
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const runs = (section: string) => !only || only === section;
  const pk3s = process.argv.slice(2).filter((arg) => arg.endsWith(".pk3"));

  const map = process.argv.find((arg) => arg.startsWith("--map="))?.slice("--map=".length) ?? "wdm2";
  if (runs("1")) await spawnSurfaces(pk3s.length > 0 ? pk3s : ["data0_21pure.pk3", `map_${map}.pk3`], map);
  if (runs("2")) {
    console.log("\n== 2. dispose(false, true) on one clone ==");
    console.log("   Pickup.dispose path:", sharedMaterialDisposal(true));
    console.log("   control, dispose(false, false):", sharedMaterialDisposal(false));
  }
  if (runs("3")) {
    console.log("\n== 3. AutoReleaseWorkerPool with rejecting worker creation ==");
    console.log("  ", await failingWorkerPool());
  }
  if (runs("4")) await havokDisplacement();
  if (runs("5")) {
    console.log("\n== 5. clone from a cache after the scene clear ==");
    console.log("  ", cloneAfterSceneClear());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
