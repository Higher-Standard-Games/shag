import { describe, expect, it } from "vitest";
import { LocalSocket } from "../LocalSocket";

const next = () => new Promise((resolve) => setImmediate(resolve));

describe("an in-process lobby connection", () => {
  it("opens both ends, passes frames each way on a later turn, and closes both", async () => {
    const { client, server } = LocalSocket.pair();
    const events: string[] = [];
    client.on("open", () => events.push("client open"));
    server.on("open", () => events.push("server open"));
    server.on("message", (data: Buffer) => events.push(`server got ${data.toString()}`));
    client.on("message", (data: Buffer) => events.push(`client got ${data.toString()}`));
    client.on("close", () => events.push("client close"));
    server.on("close", () => events.push("server close"));
    await next();
    expect(client.readyState).toBe(1);
    client.send('{"type":"auth"}');
    expect(events).not.toContain('server got {"type":"auth"}');
    await next();
    server.send("welcome");
    await next();
    client.close();
    await next();
    expect(events).toEqual([
      "client open",
      "server open",
      'server got {"type":"auth"}',
      "client got welcome",
      "client close",
      "server close",
    ]);
    server.send("dropped");
    await next();
    expect(server.readyState).toBe(3);
    expect(events).not.toContain("client got dropped");
  });
});
