import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MAX_WEBSOCKET_QUEUED_BYTES, WebSocketServerTransport } from "./WebSocketTransport";

describe("WebSocketServerTransport", () => {
  it("disconnects a saturated reader without blocking a healthy broadcast recipient", async () => {
    const errors: Error[] = [];
    const transport = new WebSocketServerTransport(
      { port: 0, host: "127.0.0.1" },
      {
        onError: (_client, error) => {
          errors.push(error);
        },
      },
    );
    await transport.start();
    const sockets: WebSocket[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const socket = new WebSocket(`ws://127.0.0.1:${transport.getPort()}`);
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
      }
      const slow = [...transport.getClients().values()][0];
      const serverSocket = (slow as unknown as { ws: WebSocket }).ws;
      Object.defineProperty(serverSocket, "bufferedAmount", { get: () => MAX_WEBSOCKET_QUEUED_BYTES });
      const closed = new Promise<number>((resolve) => sockets[0].once("close", resolve));
      const received = new Promise<Buffer>((resolve) => sockets[1].once("message", (data) => resolve(data as Buffer)));
      transport.broadcastDatagram(new Uint8Array([1, 2, 3]));
      expect([...(await received)]).toEqual([1, 2, 3]);
      expect(await closed).toBe(1006);
      expect(errors).toHaveLength(1);
      expect(() => slow.sendDatagram(new Uint8Array([4]))).toThrow("unavailable");
    } finally {
      for (const socket of sockets) socket.terminate();
      await transport.stop();
    }
  });

  it("starts and stops a plain ws server when no cert paths are configured", async () => {
    const transport = new WebSocketServerTransport({
      port: 0,
      host: "127.0.0.1",
    });

    await transport.start();
    expect(transport.isRunning()).toBe(true);

    await transport.stop();
    expect(transport.isRunning()).toBe(false);
  });

  it("closes a client that sends a message over the size cap, and delivers ones under it", async () => {
    const received: number[] = [];
    const transport = new WebSocketServerTransport(
      { port: 0, host: "127.0.0.1", maxMessageBytes: 1024 },
      { onDatagram: (_conn, data) => received.push(data.length) },
    );
    await transport.start();
    try {
      const { port } = (transport as unknown as { httpServer: { address(): AddressInfo } }).httpServer.address();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));

      ws.send(new Uint8Array(1000));
      await expect.poll(() => received).toEqual([1000]);

      ws.send(new Uint8Array(2000));
      expect(await closed).toBe(1009);
      expect(received).toEqual([1000]);
    } finally {
      await transport.stop();
    }
  });
});
