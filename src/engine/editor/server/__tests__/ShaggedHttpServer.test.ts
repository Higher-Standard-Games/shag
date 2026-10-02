import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MapStore } from "../MapStore";
import { resolveServerConfig } from "../ServerConfig";
import { createShaggedHttpServer } from "../ShaggedHttpServer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SHAGGED loopback API", () => {
  it("serves status, saves and loads a map, and rejects stale revisions and foreign browser origins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-http-"));
    roots.push(root);
    const store = new MapStore(root);
    await store.init();
    const server = createShaggedHttpServer(store, {
      mapsRoot: root,
      port: 9010,
      uiOrigins: ["http://localhost:3000"],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const base = `http://127.0.0.1:${address.port}`;
      const status = await fetch(`${base}/api/status`);
      expect(await status.json()).toMatchObject({ saveAvailable: true, compilerAvailable: false });
      const put = () =>
        fetch(`${base}/api/maps/arena`, {
          method: "PUT",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ source: '{\n"classname" "worldspawn"\n}\n', expectedRevision: 0 }),
        });
      const saved = await put();
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ name: "arena", revision: 1 });
      expect(await fetch(`${base}/api/maps/arena`).then((response) => response.json())).toMatchObject({ revision: 1 });
      expect((await fetch(`${base}/api/maps`).then((response) => response.json())).maps).toHaveLength(1);
      expect((await put()).status).toBe(409);
      expect((await fetch(`${base}/api/maps/arena`, { headers: { origin: "https://foreign.example" } })).status).toBe(
        403,
      );
      expect(
        (
          await fetch(`${base}/api/maps/BadName`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source: "test", expectedRevision: 0 }),
          })
        ).status,
      ).toBe(400);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("resolves flags before environment and validates origins", () => {
    const config = resolveServerConfig(
      ["--port", "9020", "--maps-root", "relative/maps", "--ui-origin", "http://localhost:4444"],
      { SHAGGED_PORT: "9030", SHAGGED_MAPS_ROOT: "ignored" },
      "C:/workspace",
    );
    expect(config.port).toBe(9020);
    expect(config.mapsRoot).toBe(path.resolve("C:/workspace", "relative/maps"));
    expect(config.uiOrigins).toEqual(["http://localhost:4444"]);
    expect(() => resolveServerConfig(["--ui-origin", "*"])).toThrow();
  });
});
