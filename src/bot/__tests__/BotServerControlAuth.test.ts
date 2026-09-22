/**
 * The bot server's control port: only callers that send the shared bot secret
 * get to use it, and it listens on this machine only.
 */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BOT_SECRET_HEADER } from "../../lobby/ServerData";
import { BotServer } from "../BotServer";

const SECRET = "test-bot-secret";
let server: BotServer | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

async function startServer(): Promise<BotServer> {
  server = new BotServer(0, { secret: SECRET });
  await server.start();
  return server;
}

/** Resolves with the close code, or with the first message the server sends. */
function exchange(port: number, headers: Record<string, string>): Promise<{ closed?: number; reply?: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.on("open", () => ws.send(JSON.stringify({ type: "status" })));
    ws.on("message", (data) => {
      resolve({ reply: JSON.parse(data.toString()) });
      ws.close();
    });
    ws.on("close", (code) => resolve({ closed: code }));
    ws.on("error", reject);
  });
}

describe("BotServer control port", () => {
  it("refuses to start without the shared secret", async () => {
    await expect(new BotServer(0).start()).rejects.toThrow(/secret/);
  });

  it("closes a connection that doesn't send the secret", async () => {
    const { port } = await startServer();
    expect(await exchange(port, {})).toEqual({ closed: 1008 });
  });

  it("closes a connection that sends the wrong secret", async () => {
    const { port } = await startServer();
    expect(await exchange(port, { [BOT_SECRET_HEADER]: "guess" })).toEqual({ closed: 1008 });
  });

  it("answers a caller that sends the secret", async () => {
    const { port } = await startServer();
    expect(await exchange(port, { [BOT_SECRET_HEADER]: SECRET })).toEqual({ reply: { type: "status", bots: [] } });
  });
});
