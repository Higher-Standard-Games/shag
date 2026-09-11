/**
 * Lift/mover validation against the installed map library.
 *
 * Two passes, because they catch different failures:
 *
 * 1. Reachability — every lift a map authors must be callable: automatic, or
 *    wired to a caller we understand. A lift nothing can call is a silent dead
 *    end for the player, and a synthetic BSP fixture will never reveal it.
 * 2. Ride — on known maps, prove the inline model really collides and that a
 *    body standing on it travels the authored distance and comes back.
 *
 * Run: npm run test:lifts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../engine/loader/pk3/NodePk3";
import { SweepCollisionBackend } from "../engine/physics/SweepCollisionBackend";
import { extractLifts, type LiftState } from "../shared/bsp/LiftSystem";

const DATA_DIRS = ["public/data", "public/data/basewsw"];
/** Maps whose lifts are ridden in full, chosen to cover a plat and door lifts. */
const RIDE_MAPS = ["acidwdm2", "wtutorial1"];

function installedMaps(): string[] {
  const names = new Set<string>();
  for (const dir of DATA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir))
      if (file.startsWith("map_") && file.endsWith(".pk3")) names.add(file.slice(4, -4).toLowerCase());
  }
  return [...names].sort();
}

async function loadBsp(map: string) {
  const buffer = await resolveMapBspViaIndex(DATA_DIRS, map);
  return buffer ? BspLoader.load(buffer) : null;
}

async function surveyReachability(): Promise<void> {
  const maps = installedMaps();
  assert(maps.length > 0, "no map pk3s installed — cannot validate lifts");
  const dead: string[] = [];
  let mapsWithLifts = 0;
  let lifts = 0;
  for (const map of maps) {
    let bsp: Awaited<ReturnType<typeof loadBsp>>;
    try {
      bsp = await loadBsp(map);
    } catch {
      continue; // A map that will not even parse is not this tool's problem.
    }
    if (!bsp) continue;
    const definitions = extractLifts(bsp.entities, bsp.models);
    if (!definitions.length) continue;
    mapsWithLifts++;
    for (const d of definitions) {
      lifts++;
      if (!d.automatic && d.triggers.length === 0)
        dead.push(`${map} model *${d.modelIndex} (${d.plat ? "func_plat" : "func_door"}) has no caller`);
    }
  }
  console.log(`[lifts] ${lifts} lifts across ${mapsWithLifts}/${maps.length} installed maps`);
  for (const line of dead) console.error(`[lifts] UNREACHABLE ${line}`);
  assert.equal(dead.length, 0, `${dead.length} lift(s) cannot be called by any caller we understand`);
}

async function rideLifts(map: string): Promise<void> {
  const bsp = await loadBsp(map);
  if (!bsp) throw new Error(`missing map ${map}`);
  const backend = new SweepCollisionBackend();
  await backend.init(bsp);
  const lifts = backend.lifts;
  if (!lifts?.definitions.length) throw new Error(`${map} should author lifts`);
  for (const d of lifts.definitions) {
    const x = (d.min.x + d.max.x) / 2;
    const z = (d.min.z + d.max.z) / 2;
    // Drop onto the car at its rest stop; the inline model must stop the trace.
    const hit = backend.trace(
      new Vector3(x, d.max.y + d.start + 80, z),
      new Vector3(x, d.min.y + d.start - 10, z),
      { radius: 16, height: 64 },
      -1,
      d.modelIndex,
    );
    assert(hit.fraction < 1, `${map} *${d.modelIndex}: inline model has no collision`);

    const rider = { position: { x, y: hit.endPos.y, z }, velocity: { x: 0, y: 0, z: 0 } };
    const startY = rider.position.y;
    // A targeted lift needs someone in its caller volume to set it going.
    const t = d.triggers[0];
    const caller = t
      ? {
          position: { x: (t.min.x + t.max.x) / 2, y: t.min.y + 24, z: (t.min.z + t.max.z) / 2 },
          velocity: { x: 0, y: 0, z: 0 },
        }
      : undefined;
    const travelTicks = Math.ceil((Math.abs(d.end - d.start) / d.speed) * 60) + 10;
    for (let tick = 0; tick < travelTicks; tick++) lifts.step(1 / 60, caller && tick === 0 ? [rider, caller] : [rider]);
    const travelled = rider.position.y - startY;
    assert(
      Math.abs(travelled - (d.end - d.start)) < 0.1,
      `${map} *${d.modelIndex}: rider moved ${travelled.toFixed(2)}, expected ${(d.end - d.start).toFixed(2)}`,
    );

    if (d.toggle) {
      // A toggle lift must hold its stop until something calls it again.
      for (let tick = 0; tick < 600; tick++) lifts.step(1 / 60, []);
      const held: LiftState | undefined = lifts.snapshot().find((s) => s.modelIndex === d.modelIndex);
      assert.equal(held?.offset, d.end, `${map} *${d.modelIndex}: toggle lift left its stop on its own`);
      if (!caller) throw new Error(`${map} *${d.modelIndex}: a toggle lift must have a caller`);
      lifts.step(1 / 60, [rider, caller]);
      for (let tick = 0; tick < travelTicks; tick++) lifts.step(1 / 60, [rider]);
      assert(
        Math.abs(rider.position.y - startY) < 0.1,
        `${map} *${d.modelIndex}: toggle lift did not carry its rider back`,
      );
    }
    console.log(`[lifts] ok ${map} *${d.modelIndex} ${d.plat ? "plat" : "door"} travel=${travelled.toFixed(1)}`);
  }
  backend.dispose();
}

await surveyReachability();
for (const map of RIDE_MAPS) await rideLifts(map);
console.log("[lifts] all checks passed");
