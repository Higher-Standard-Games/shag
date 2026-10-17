import { WebSocket } from "ws";
import { InputButtons } from "../engine/network/components/InputComponent";
import type { GameState } from "../engine/network/core/GameState";
import { MessageCodec, MessageType } from "../engine/network/protocol/MessageCodec";

/** Real protocol workload, run outside the measured server process. */
export async function connectBenchmarkClients(port: number, count: number) {
  const clients: WebSocket[] = [],
    timers: ReturnType<typeof setInterval>[] = [];
  let snapshots = 0,
    commands = 0,
    bytes = 0,
    errors = 0;
  const close = async () => {
    for (const timer of timers) clearInterval(timer);
    await Promise.all(
      clients.map(
        (ws) =>
          new Promise<void>((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) return resolve();
            const timer = setTimeout(() => {
              ws.terminate();
              resolve();
            }, 1000);
            ws.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
            ws.close();
          }),
      ),
    );
  };
  try {
    for (let index = 0; index < count; index++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      clients.push(ws);
      const baselines = new Map<number, GameState>();
      let playerId = "",
        sequence = 0;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Benchmark client join timeout")), 5000);
        ws.on("error", (error) => {
          errors++;
          clearTimeout(timeout);
          reject(error);
        });
        ws.on("open", () => ws.send(MessageCodec.encodeJoin(`MemoryProbe${index}`)));
        ws.on("message", (raw: Buffer) => {
          const data = new Uint8Array(raw);
          bytes += data.byteLength;
          try {
            if (data[0] === MessageType.JoinAccept) {
              playerId = MessageCodec.decodeJoinAccept(data).playerId;
              ws.send(MessageCodec.encodeJoinGame());
            } else if (data[0] === MessageType.Snapshot) {
              const state = MessageCodec.decodeSnapshot(data, baselines);
              baselines.set(state.tick, state);
              while (baselines.size > 80) baselines.delete(baselines.keys().next().value!);
              snapshots++;
              ws.send(MessageCodec.encodeAck(state.tick));
              if (playerId) {
                clearTimeout(timeout);
                resolve();
              }
            }
          } catch {
            errors++;
          }
        });
      });
      timers.push(
        setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          sequence++;
          const yaw = sequence * 0.012 + index;
          ws.send(
            MessageCodec.encodeCommand(playerId, sequence, {
              type: "move",
              direction: { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) },
              yaw,
              pitch: 0,
              buttons:
                InputButtons.FORWARD |
                (sequence % 90 < 10 ? InputButtons.JUMP : 0) |
                (sequence % 30 < 15 ? InputButtons.FIRE : 0),
            }),
          );
          commands++;
        }, 16),
      );
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    ready: () => {
      for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(MessageCodec.encodeReady());
    },
    stats: () => ({ clients: count, snapshots, commands, receivedBytes: bytes, decodeOrSocketErrors: errors }),
  };
}
