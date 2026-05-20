import { describe, expect, it } from "vitest";
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
});
