import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import { GameServerSpawner, portIsFree } from "../GameServerSpawner";

/** A run of free ports, found by binding port 0 and counting up from there. */
async function freeRun(length: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const probe = createServer();
    const start = await new Promise<number>((resolve) =>
      probe.listen(0, "0.0.0.0", () => resolve((probe.address() as { port: number }).port)),
    );
    await new Promise((resolve) => probe.close(resolve));
    if (start + length > 65535) continue;
    let free = true;
    for (let port = start; port < start + length && free; port++) free = await portIsFree(port);
    if (free) return start;
  }
  throw new Error("no free port run");
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

type Ports = {
  allocatePort(): Promise<number>;
  reservedPorts: Set<number>;
  activeServers: Map<string, { port: number }>;
};

describe("game server ports", () => {
  it("passes over a port another process listens on", async () => {
    const start = await freeRun(3);
    const other = await listen(start);
    try {
      const spawner = new GameServerSpawner(start) as unknown as Ports;
      expect(await spawner.allocatePort()).toBe(start + 1);
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it("gives two spawns starting together different ports, and reuses a freed one", async () => {
    const start = await freeRun(3);
    const spawner = new GameServerSpawner(start) as unknown as Ports;
    const [a, b] = await Promise.all([spawner.allocatePort(), spawner.allocatePort()]);
    expect(new Set([a, b])).toEqual(new Set([start, start + 1]));

    // The first match is running, the second has ended: the next takes the freed port
    spawner.reservedPorts.clear();
    spawner.activeServers.set("m_running", { port: start });
    expect(await spawner.allocatePort()).toBe(start + 1);
  });
});
