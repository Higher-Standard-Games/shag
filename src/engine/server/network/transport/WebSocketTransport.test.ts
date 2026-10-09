import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebSocketServerTransport } from "./WebSocketTransport";

describe("WebSocketServerTransport", () => {
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
