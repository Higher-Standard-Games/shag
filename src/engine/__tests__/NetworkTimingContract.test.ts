import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../../shared/net/GameState";
import { NetworkGameHost } from "../network/client/hosts/NetworkGameHost";
import type { Transport } from "../network/client/transport/Transport";
import { MoveCommand } from "../network/core/Command";
import { Simulation } from "../network/core/Simulation";
import { MessageCodec, MessageType } from "../network/protocol/MessageCodec";

vi.mock("../AudioManager", () => ({ AudioManager: { getInstance: () => ({ loadPlaylist: () => {} }) } }));

class EmptySimulation extends Simulation {
  protected createInitialState(): GameState {
    return new GameState();
  }
  protected registerSystems(): void {}
  protected registerCommandHandlers(): void {}
}

const welcome = (rate = 125) => MessageCodec.encodeWelcome("s1", "Test", "wdm2", rate, 8, 1);
const accepted = () => MessageCodec.encodeJoinAccept("c1", "player_1", "1");
const snapshot = () => MessageCodec.encodeSnapshot(new GameState());
const input = () => new MoveCommand("player_1", 1, 1, { x: 1, y: 0, z: 0 }, 0, 0, 0);

function fixture() {
  let deliver = (_data: Uint8Array) => {};
  let closed = (_reason?: string) => {};
  const transport: Transport = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {
      closed("closed");
    }),
    send: vi.fn(),
    isConnected: () => true,
    onMessage: (cb) => {
      deliver = cb;
      return () => {};
    },
    onDisconnect: (cb) => {
      closed = cb;
      return () => {};
    },
    onConnect: () => () => {},
    onError: () => () => {},
  };
  const host = new NetworkGameHost(
    transport,
    { tickRate: 125, tickDuration: 8, maxPlayers: 8, gameRules: {} },
    EmptySimulation,
  );
  host.setExternalPrediction(true);
  const mapLoad = vi.fn();
  const published = vi.fn();
  const messages = vi.fn();
  host.onServerInfo(mapLoad);
  host.onStateUpdate(published);
  host.onServerMessage(messages);
  return {
    host,
    transport,
    mapLoad,
    published,
    messages,
    deliver: (data: Uint8Array) => deliver(data),
    close: () => closed("lost"),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("network timing handshake", () => {
  it.each([0, 60, 250])("rejects %iHz before map loading, state publication or input", async (rate) => {
    const f = fixture();
    const connecting = f.host.connect("ws://test");
    const rejected = expect(connecting).rejects.toThrow(
      `Unsupported server tick rate: ${rate}Hz; this client requires 125Hz`,
    );
    f.deliver(snapshot());
    f.deliver(welcome(rate));
    f.deliver(accepted());
    f.deliver(snapshot());
    f.host.sendCommand(input());
    await rejected;
    expect(f.host.isConnected()).toBe(false);
    expect(f.host.getServerInfo()).toBeNull();
    expect(f.mapLoad).not.toHaveBeenCalled();
    expect(f.published).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    expect(f.messages).toHaveBeenCalledWith({ type: "error", message: expect.stringContaining(`${rate}Hz`) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts 125Hz, drops early datagrams and clears timers on disconnect", async () => {
    const f = fixture();
    const connecting = f.host.connect("ws://test");
    f.deliver(snapshot());
    f.deliver(welcome());
    f.deliver(snapshot());
    expect(f.published).not.toHaveBeenCalled();
    f.deliver(accepted());
    await connecting;
    f.deliver(snapshot());
    f.host.sendCommand(input());
    expect(f.mapLoad).toHaveBeenCalledOnce();
    expect(f.published).toHaveBeenCalledOnce();
    expect(vi.mocked(f.transport.send).mock.calls.map(([data]) => MessageCodec.peekMessageType(data))).toContain(
      MessageType.Input,
    );
    await f.host.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    f.deliver(welcome());
    f.deliver(accepted());
    expect(f.host.isConnected()).toBe(false);
  });

  it("rejects JoinAccept without Welcome", async () => {
    const f = fixture();
    const rejected = expect(f.host.connect("ws://test")).rejects.toThrow("before a compatible Welcome");
    f.deliver(accepted());
    await rejected;
    expect(f.host.isConnected()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a missing Welcome without leaving a live connection", async () => {
    const f = fixture();
    const rejected = expect(f.host.connect("ws://test")).rejects.toThrow("Timeout waiting for Welcome and JoinAccept");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the handshake timeout on transport failure", async () => {
    const f = fixture();
    vi.mocked(f.transport.connect).mockRejectedValueOnce(new Error("open failed"));
    await expect(f.host.connect("ws://test")).rejects.toThrow("open failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([60, 125])("revalidates %iHz during resume and stops retrying an incompatible server", async (rate) => {
    const f = fixture();
    const connecting = f.host.connect("ws://test");
    f.deliver(welcome());
    f.deliver(accepted());
    f.deliver(MessageCodec.encodeResumeToken("seat", 20000));
    await connecting;
    f.mapLoad.mockClear();
    f.close();
    await vi.advanceTimersByTimeAsync(0);
    f.deliver(snapshot());
    expect(f.published).not.toHaveBeenCalled();
    f.deliver(welcome(rate));
    f.deliver(accepted());
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    expect(f.host.isConnected()).toBe(rate === 125);
    expect(f.mapLoad).toHaveBeenCalledTimes(rate === 125 ? 1 : 0);
    await f.host.disconnect();
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows an explicit retry after an incompatible server", async () => {
    const f = fixture();
    const rejected = expect(f.host.connect("ws://test")).rejects.toThrow("60Hz");
    f.deliver(welcome(60));
    await rejected;
    const retry = f.host.connect("ws://test");
    f.deliver(welcome());
    f.deliver(accepted());
    await retry;
    expect(f.host.isConnected()).toBe(true);
    await f.host.disconnect();
  });

  it.each([
    125.5,
    381,
    -131,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("does not encode %sHz as a different rate", (rate) => {
    expect(() => welcome(rate)).toThrow("integer byte");
  });

  it("rejects a contradictory local tick duration", () => {
    const f = fixture();
    expect(
      () =>
        new NetworkGameHost(
          f.transport,
          { tickRate: 125, tickDuration: 16, maxPlayers: 8, gameRules: {} },
          EmptySimulation,
        ),
    ).toThrow("matching tick duration");
  });
});
