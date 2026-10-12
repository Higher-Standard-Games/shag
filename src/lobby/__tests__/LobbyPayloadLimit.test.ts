import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { LobbyServer } from "../LobbyServer";

let server: LobbyServer | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.stop();
  server = undefined;
  vi.restoreAllMocks();
});

it("rejects oversized lobby frames and still accepts normal logins", async () => {
  server = new LobbyServer(0, { shutdownAll: vi.fn() } as never);
  // Keep this transport regression independent of the developer's demo archive.
  vi.spyOn(server as unknown as { _scanDemos(): void }, "_scanDemos").mockImplementation(() => {});
  await server.start();
  const port = (server as unknown as { wss: { address(): { port: number } } }).wss.address().port;
  const oversized = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(oversized);
  await once(oversized, "open");
  const closed = once(oversized, "close");
  oversized.send("x".repeat(64 * 1024 + 1));
  expect((await closed)[0]).toBe(1009);

  const normal = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(normal);
  await once(normal, "open");
  const reply = once(normal, "message");
  normal.send(JSON.stringify({ type: "auth" }));
  const message = JSON.parse(String((await reply)[0]));
  expect(message.type).toBe("welcome");
  expect(message.identity.id).toBeTruthy();
  const errors = vi.spyOn(console, "error");
  const chat = once(normal, "message");
  normal.send(JSON.stringify({ type: "chat:send", text: { malformed: true } }));
  normal.send(JSON.stringify({ type: "chat:send", text: "hello" }));
  expect(JSON.parse(String((await chat)[0]))).toMatchObject({ type: "chat:message", text: "hello" });
  expect(errors).not.toHaveBeenCalled();
  const archive = once(normal, "message");
  normal.send(JSON.stringify({ type: "demos:list", scope: "yours", requestId: "archive_test", limit: 1 }));
  expect(JSON.parse(String((await archive)[0]))).toMatchObject({
    type: "demos:list_response",
    scope: "yours",
    requestId: "archive_test",
    demos: [],
  });
});
