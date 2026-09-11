/**
 * View-lag probe — how stale is the world a client aims at?
 *
 * Lag compensation rewinds to the view tick a client reports. How far back that
 * is decides whether a shot lands, so it is worth measuring rather than
 * assuming. This drives a real GameServer over a real socket with latency held
 * in both directions, and prints the lag the server actually observes.
 *
 * Re-run it after changing tick rate, snapshot rate, or the interpolation
 * assumption in WeaponSystem — all three move these numbers.
 *
 * Run: npm run net:viewlag
 */

import { MessageType } from "../engine/network/protocol/BinaryProtocol";
import { MessageCodec } from "../engine/network/protocol/MessageCodec";
import { ProtocolTestClient } from "../games/fps/server/__tests__/_protocolTestClient";
import { GameServer } from "../games/fps/server/GameServer";
import { Deathmatch } from "../games/fps/server/gametypes/Deathmatch";

const TICK_RATE = 125;
const SNAPSHOT_RATE = 60;
const SAMPLES = 60;
const LATENCIES = [0, 25, 50, 75, 100];

interface SimPeek {
  currentTick: number;
  getState(): { allEntities(): Iterable<{ input?: { viewTick?: number } }> };
}

async function measure(oneWayMs: number): Promise<number> {
  const server = new GameServer(
    {
      port: 0,
      serverName: "viewlag",
      mapName: "test",
      maxClients: 8,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      certPath: "",
      keyPath: "",
    },
    new Deathmatch(),
  );
  await server.start();
  const sim = (server as unknown as { simulation: SimPeek }).simulation;

  const client = await ProtocolTestClient.connect(server.getPort());
  client.send(MessageCodec.encodeJoin("viewlag-probe"));
  const accept = MessageCodec.decodeJoinAccept(await client.waitForType(MessageType.JoinAccept));
  // Joining leaves you spectating, and a spectator's input is dropped.
  client.send(MessageCodec.encodeJoinGame());
  client.setLatency(oneWayMs);

  let newestSnapshot = 0;
  void client
    .waitFor((frame) => {
      if (frame.length > 0 && frame[0] === MessageType.Snapshot) {
        try {
          const tick = MessageCodec.decodeSnapshot(frame).tick;
          if (tick > newestSnapshot) newestSnapshot = tick;
        } catch {
          // A frame we cannot decode says nothing about the clock.
        }
      }
      return false; // never resolves — a running observer, torn down with the socket
    }, 60_000)
    .catch(() => {});

  while (newestSnapshot === 0) await new Promise((r) => setTimeout(r, 5));

  const lags: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    client.send(
      MessageCodec.encodeCommand(accept.playerId, i + 1, {
        direction: { x: 0, y: 0, z: 1 },
        pitch: 0,
        yaw: 0,
        buttons: 0,
        tick: newestSnapshot,
        weaponSlot: 0,
      }),
    );
    await new Promise((r) => setTimeout(r, 1000 / TICK_RATE));
    const seen: number[] = [];
    for (const e of sim.getState().allEntities()) if (e.input?.viewTick) seen.push(e.input.viewTick);
    if (seen.length) lags.push(Number(sim.currentTick) - Math.max(...seen));
  }

  await client.close();
  await server.stop();

  if (!lags.length) throw new Error(`no view ticks observed at ${oneWayMs}ms`);
  lags.sort((a, b) => a - b);
  return lags[Math.floor(lags.length / 2)]; // median — immune to a stray scheduling hiccup
}

console.log(`[viewlag] ${TICK_RATE}Hz ticks, ${SNAPSHOT_RATE}Hz snapshots\n`);
console.log("  one-way    RTT   view lag   view lag   overhead");
console.log("     (ms)   (ms)    (ticks)       (ms)       (ms)");
for (const oneWay of LATENCIES) {
  const ticks = await measure(oneWay);
  const ms = (ticks / TICK_RATE) * 1000;
  const rtt = oneWay * 2;
  console.log(
    `  ${String(oneWay).padStart(7)}  ${String(rtt).padStart(5)}  ${String(ticks).padStart(9)}  ${ms.toFixed(1).padStart(9)}  ${(ms - rtt).toFixed(1).padStart(9)}`,
  );
}
console.log(
  "\n[viewlag] Overhead is the structural part — snapshot quantisation and queueing —\n" +
    "          that a client pays even on a perfect connection. The interpolation\n" +
    "          assumption in WeaponSystem is added on top of this, so it should stay\n" +
    "          small: this lag is already rewound without it.",
);
process.exit(0);
