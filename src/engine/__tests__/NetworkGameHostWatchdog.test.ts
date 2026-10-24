/**
 * NetworkGameHost notices when snapshots stop arriving while the connection
 * stays open: the player's inputs are then ignored and the world freezes with no
 * error or close on either side.
 */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { GameState } from "../../shared/net/GameState";
import { NetworkGameHost } from "../network/client/hosts/NetworkGameHost";
import type { Transport } from "../network/client/transport/Transport";
import { Simulation as ClientSimulation } from "../network/core/Simulation";
import { MessageCodec } from "../network/protocol/MessageCodec";

vi.mock("../AudioManager", () => ({
  AudioManager: { getInstance: () => ({ loadPlaylist: () => {} }) },
}));

class EmptySimulation extends ClientSimulation {
  protected createInitialState(): GameState {
    return new GameState();
  }
  protected registerSystems(): void {}
  protected registerCommandHandlers(): void {}
}

let now = 0;
let deliver: (data: Uint8Array) => void = () => {};
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

/** Let `ms` pass with the client running, checking as its timer does. */
function run(ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    now += 100;
    vi.advanceTimersByTime(100);
  }
}

async function joinedHost(): Promise<NetworkGameHost> {
  const transport: Transport = {
    connect: async () => {},
    disconnect: async () => {},
    send: () => {},
    isConnected: () => true,
    bufferedAmount: () => 4096,
    onMessage: (callback) => {
      deliver = callback;
      return () => {};
    },
    onConnect: () => () => {},
    onDisconnect: () => () => {},
    onError: () => () => {},
  };
  const host = new NetworkGameHost(
    transport,
    { tickRate: 125, tickDuration: 8, maxPlayers: 8, gameRules: {} },
    EmptySimulation,
  );
  host.setExternalPrediction(true);
  const connecting = host.connect("ws://test", "tester");
  deliver(MessageCodec.encodeWelcome("s1", "Test", "wdm2", 125, 8, 1));
  deliver(MessageCodec.encodeJoinAccept("c1", "player_1", "1"));
  await connecting;
  return host;
}

const snapshot = (tick: number) => {
  const state = new GameState();
  state.tick = tick;
  return MessageCodec.encodeSnapshot(state);
};

beforeEach(() => {
  now = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const warned = (text: string) => warn.mock.calls.some(([message]) => String(message).includes(text));

describe("NetworkGameHost connection watchdog", () => {
  it("warns when snapshots stop arriving, and says when they resume", async () => {
    await joinedHost();
    deliver(snapshot(1));

    run(1900);
    expect(warned("No snapshot for")).toBe(false);

    run(200);
    expect(warned("No snapshot for 2.0s")).toBe(true);
    expect(warned("4096 bytes waiting to send")).toBe(true);

    run(1000);
    deliver(snapshot(2));
    expect(warned("Snapshots resumed after 3.1s")).toBe(true);
  });

  it("treats a long stall as a lost connection", async () => {
    await joinedHost();

    run(8100);

    expect(error.mock.calls.some(([message]) => String(message).includes("No snapshot for 8.0s"))).toBe(true);
  });

  it("does not count a gap while the client itself was not running", async () => {
    await joinedHost();

    // A map build blocks the main thread: no timer runs for eleven seconds,
    // longer than a stall that would be treated as a lost connection.
    now += 11000;
    run(1500);

    expect(warned("No snapshot for")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it("stops watching when the host disconnects", async () => {
    const host = await joinedHost();

    await host.disconnect();
    run(10000);

    expect(warned("No snapshot for")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a terminal failure when the resume allowance expires", async () => {
    const host = await joinedHost();
    const ended = vi.fn();
    host.onSessionEnded(ended);
    const inner = host as unknown as { resumeToken: string; resumeGraceMs: number; resumeSession(): Promise<void> };
    inner.resumeToken = "held-seat";
    inner.resumeGraceMs = 1000;
    const resuming = inner.resumeSession();
    await Promise.resolve();
    await Promise.resolve();
    now = 2000;
    await vi.advanceTimersByTimeAsync(2000);
    await resuming;
    expect(ended).toHaveBeenCalledOnce();
    await host.disconnect();
  });
});
