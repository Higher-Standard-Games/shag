import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  closed: number | null = null;
  send = vi.fn();
  close(code: number) {
    this.closed = code;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

const servers: LobbyServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) (server as unknown as { accounts: { close(): void } }).accounts.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeServer(): LobbyServer {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const server = new LobbyServer(0, { shutdownAll: vi.fn() } as never);
  servers.push(server);
  return server;
}

function open(server: LobbyServer, address: string): FakeSocket {
  const socket = new FakeSocket();
  (server as unknown as { handleConnection(ws: unknown, address: string): void }).handleConnection(socket, address);
  return socket;
}

describe("lobby connection limits", () => {
  it("refuses a 33rd open connection from one address, but not from loopback or another address", () => {
    const server = makeServer();
    const sockets = Array.from({ length: 32 }, () => open(server, "203.0.113.7"));
    expect(sockets.every((socket) => socket.closed === null)).toBe(true);
    expect(open(server, "203.0.113.7").closed).toBe(1013);
    expect(open(server, "203.0.113.8").closed).toBeNull();
    for (let i = 0; i < 40; i++) expect(open(server, "127.0.0.1").closed).toBeNull();
    sockets[0].close(1000);
    expect(open(server, "203.0.113.7").closed).toBeNull();
  });

  it("closes a connection that has not logged in within 30 seconds", () => {
    vi.useFakeTimers();
    const server = makeServer();
    const idle = open(server, "203.0.113.9");
    const player = open(server, "203.0.113.10");
    player.emit("message", Buffer.from(JSON.stringify({ type: "auth" })));
    vi.advanceTimersByTime(30_000);
    expect(idle.closed).toBe(1008);
    expect(player.closed).toBeNull();
  });
});
