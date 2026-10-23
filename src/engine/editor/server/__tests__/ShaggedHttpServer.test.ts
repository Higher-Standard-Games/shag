import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompileJobs, type ToolRunner } from "../CompileJobs";
import type { CompilerConfig } from "../CompilerConfig";
import { clearGameCompilerProfile } from "../GameCompilerProfile";
import { MapStore } from "../MapStore";
import { resolveServerConfig } from "../ServerConfig";
import { createShaggedHttpServer } from "../ShaggedHttpServer";
import { registerTestCompilerProfile } from "./fixtures/TestCompilerProfile";

beforeEach(registerTestCompilerProfile);
afterEach(clearGameCompilerProfile);

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
      publishRoot: path.join(root, "data"),
      port: 9010,
      uiOrigins: ["http://localhost:3000"],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const base = `http://127.0.0.1:${address.port}`;
      const preflight = await fetch(`${base}/api/maps/arena/compile`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
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
      await mkdir(path.join(root, "data"));
      await writeFile(path.join(root, "data", "map_installed.pk3"), "existing");
      const collision = await fetch(`${base}/api/maps/installed`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "source", expectedRevision: 0 }),
      });
      expect(collision.status).toBe(409);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("resolves flags before environment and validates origins", () => {
    const config = resolveServerConfig(
      [
        "--port",
        "9020",
        "--maps-root",
        "relative/maps",
        "--publish-root",
        "relative/data",
        "--ui-origin",
        "http://localhost:4444",
      ],
      { SHAGGED_PORT: "9030", SHAGGED_MAPS_ROOT: "ignored" },
      "C:/workspace",
    );
    expect(config.port).toBe(9020);
    expect(config.mapsRoot).toBe(path.resolve("C:/workspace", "relative/maps"));
    expect(config.publishRoot).toBe(path.resolve("C:/workspace", "relative/data"));
    expect(config.uiOrigins).toEqual(["http://localhost:4444"]);
    expect(() => resolveServerConfig(["--ui-origin", "*"])).toThrow();
  });

  it("starts a compile for the exact saved revision and reports completed source without claiming playability", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-http-build-"));
    roots.push(root);
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    await store.save("arena", "source", 0);
    const compiler: CompilerConfig = {
      makebspBin: "bsp",
      makelightBin: "light",
      mediaRoot: root,
      toolchainRoot: root,
      defaultQuality: "fast",
      available: true,
      reason: null,
    };
    const runner: ToolRunner = async (binary, args) => {
      if (binary === "light") {
        const header = Buffer.alloc(8);
        header.write("FBSP", 0, "ascii");
        header.writeInt32LE(1, 4);
        await writeFile(args.at(-1)!.replace(/\.map$/, ".bsp"), Uint8Array.from(header));
      }
      return 0;
    };
    const jobs = new CompileJobs(store, compiler, path.join(root, "jobs"), runner);
    const server = createShaggedHttpServer(
      store,
      {
        mapsRoot: store.root,
        publishRoot: path.join(root, "data"),
        port: 9010,
        uiOrigins: ["http://localhost:3000"],
      },
      jobs,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const base = `http://127.0.0.1:${address.port}`;
      expect(await fetch(`${base}/api/status`).then((response) => response.json())).toMatchObject({
        compilerAvailable: true,
        playableAvailable: false,
        reason: null,
      });
      const response = await fetch(`${base}/api/maps/arena/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, quality: "fast" }),
      });
      expect(response.status).toBe(202);
      const { jobId } = (await response.json()) as { jobId: string };
      await jobs.wait(jobId);
      expect(await fetch(`${base}/api/compiles/${jobId}`).then((result) => result.json())).toMatchObject({
        state: "compiled",
        buildId: jobId,
        runtimeMapName: null,
      });
      const stale = await fetch(`${base}/api/maps/arena/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 2, quality: "fast" }),
      });
      expect(stale.status).toBe(409);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
