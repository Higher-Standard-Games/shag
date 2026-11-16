// Record the collision traces of a bot match: a game server and bots in this
// process, every SweepCollisionBackend.trace call logged (start, end, hull,
// content mask), the game server's and the bots' alike.
// Usage: node node_modules/vite-node/vite-node.mjs prototypes/collision-wasm/record.ts -- <map> <bots> <seconds> <out.f64>
import { writeFileSync } from "node:fs";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SweepCollisionBackend } from "../../src/engine/physics/SweepCollisionBackend";
import { BotServer } from "../../src/games/fps/bot/BotServer";
import { loadBspCollision } from "../../src/games/fps/cli/HeadlessMapLoader";
import { GameServer } from "../../src/games/fps/server/GameServer";
import { Deathmatch } from "../../src/games/fps/server/gametypes/Deathmatch";
import { SearchAndDestroy } from "../../src/games/fps/server/gametypes/SearchAndDestroy";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [map = "washoi_dm2", botsArg = "6", secondsArg = "30", out = ".cache/traces.f64"] = args;
const LIMIT = 400_000;
/** start3 end3 radius height contentMask, Babylon axes. */
const FIELDS = 9;
const log = new Float64Array(LIMIT * FIELDS);
let count = 0;
let seen = 0;
let movers = 0;

const original = SweepCollisionBackend.prototype.trace;
SweepCollisionBackend.prototype.trace = function (start: Vector3, end: Vector3, options, excludeModel = -1, onlyModel = -1) {
  if (onlyModel >= 0) movers++;
  else {
    seen++;
    // Keep an even sample once the log is full.
    const slot = count < LIMIT ? count++ : Math.floor(Math.random() * seen);
    if (slot < LIMIT) {
      const o = slot * FIELDS;
      log[o] = start.x;
      log[o + 1] = start.y;
      log[o + 2] = start.z;
      log[o + 3] = end.x;
      log[o + 4] = end.y;
      log[o + 5] = end.z;
      log[o + 6] = options?.radius ?? Number.NaN;
      log[o + 7] = options?.height ?? Number.NaN;
      log[o + 8] = options?.contentMask ?? Number.NaN;
    }
  }
  return original.call(this, start, end, options, excludeModel, onlyModel);
};

const bsp = await loadBspCollision(map, "./game");
if (!bsp) throw new Error(`no map ${map}`);
const port = 7861;
const server = new GameServer(
  { port, serverName: "trace-record", mapName: map, maxClients: 16, tickRate: 125, snapshotRate: 60, certPath: "", keyPath: "" },
  map.includes("snd") ? new SearchAndDestroy() : new Deathmatch(),
);
server.setCollisionWorld(bsp.collision);
server.setSpawnPoints(bsp.spawnPoints, bsp.teamSpawnPoints);
server.setMapData(bsp.entities, bsp.models);
server.setPickupItems(bsp.pickups);
server.setTriggerVolumes(bsp.triggers);
if (bsp.pvs) server.setPVSData(bsp.pvs);
await server.start();
const bots = new BotServer(port + 100);
for (let i = 0; i < Number(botsArg); i++) await bots.addBot(`ws://localhost:${port}`, { difficulty: "medium" });
await new Promise((r) => setTimeout(r, Number(secondsArg) * 1000));
await bots.removeAllBots();
await server.stop();
writeFileSync(out, new Uint8Array(log.buffer, 0, count * FIELDS * 8));
console.log(`RECORDED ${count} of ${seen} world traces (${movers} mover-only traces left out) -> ${out}`);
process.exit(0);
