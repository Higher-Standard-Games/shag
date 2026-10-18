import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import JSZip from "jszip";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePk3Index } from "../../../../cli/pk3-index-build";
import { PK3Index } from "../PK3Index";
import { PK3Loader } from "../PK3Loader";
import { parsePublishedIndex, pk3IndexHash } from "../PK3PublishedIndex";

const directories: string[] = [];
beforeEach(() => PK3Index.getInstance().clear());
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  PK3Index.getInstance().clear();
  PK3Index.getInstance().setSearchPaths(["data/"]);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "shag-published-index-"));
  directories.push(dir);
  return dir;
}
async function pack(dir: string, filename: string, files: Record<string, string | Uint8Array>): Promise<void> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  await writeFile(join(dir, filename), Uint8Array.from(await zip.generateAsync({ type: "uint8array" })));
}
async function fixture() {
  const dir = await directory();
  await pack(dir, "a_base.pk3", {
    "Maps/Arena.BSP": "base",
    "Textures/Shared.TGA": "base",
    "models/base.obj": "base",
    "Scripts/base.shader": "textures/shared\n{\nmap textures/shared.tga\n}\n",
  });
  await pack(dir, "z_override.pk3", {
    "maps/arena.bsp": "override",
    "textures/shared.tga": "override",
    "shaders/override.shader": "textures/shared\n{\nmap textures/shared.tga\n}\n",
  });
  const report = await generatePk3Index(dir);
  const text = await readFile(join(dir, "pk3_index.json"), "utf8");
  const manifest = JSON.parse(await readFile(join(dir, "pk3_manifest.json"), "utf8"));
  return { dir, report, text, manifest };
}

it("indexes bare halo aliases and top-level definitions without indexing stage tokens", async () => {
  const dir = await directory();
  await pack(dir, "halos.pk3", {
    "scripts/halos.shader": `/* phantom { } */
halo { { clampmap textures/halo.png } }
halo_large
{ if deluxe { { map textures/halo.png } } }
"mapobjects_leds_orange" { { map textures/led.png } }
textures/regular { { map textures/regular.png } }`,
  });
  await generatePk3Index(dir);
  const index = JSON.parse(await readFile(join(dir, "pk3_index.json"), "utf8"));
  expect(index.shaders.halo).toBe("halos.pk3");
  expect(index.shaders.halo_large).toBe("halos.pk3");
  expect(index.shaders.mapobjects_leds_orange).toBe("halos.pk3");
  expect(Object.keys(index.shaders).sort()).toEqual([
    "halo",
    "halo_large",
    "mapobjects_leds_orange",
    "textures/regular",
  ]);
});

function serve(parts: Map<string, string | Uint8Array>) {
  const requests: Array<{ url: string; method: string; cache?: RequestCache }> = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit = {}) => {
    requests.push({ url, method: options.method ?? "GET", cache: options.cache });
    const body = parts.get(url);
    if (body === undefined) return new Response("missing", { status: 404 });
    if (options.method === "HEAD")
      return new Response(null, {
        headers: { "content-length": String(typeof body === "string" ? body.length : body.byteLength) },
      });
    return new Response(typeof body === "string" ? body : Uint8Array.from(body));
  });
  return requests;
}

describe("published PK3 metadata", () => {
  it("loads metadata over real HTTP, then lazily downloads only the selected map package", async () => {
    const data = await fixture();
    const bodies = new Map<string, string | Uint8Array>([
      ["/data/pk3_manifest.json", JSON.stringify(data.manifest)],
      ["/data/pk3_index.json", data.text],
    ]);
    for (const filename of data.manifest.files)
      bodies.set(`/data/${filename}`, Uint8Array.from(await readFile(join(data.dir, filename))));
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      requests.push(url);
      const body = bodies.get(url);
      response.writeHead(body === undefined ? 404 : 200);
      response.end(body);
    });
    const loader = PK3Loader.getInstance();
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const index = PK3Index.getInstance();
      index.setSearchPaths([`http://127.0.0.1:${address.port}/data/`]);
      await index.ensureIndex();
      expect(requests).toEqual(["/data/pk3_manifest.json", "/data/pk3_index.json"]);
      const owner = index.findMap("arena")!;
      loader.unloadAll();
      await loader.loadPK3FromUrl(index.getPK3Path(owner)!);
      expect(new TextDecoder().decode((await loader.getFile("maps/arena.bsp"))!)).toBe("override");
      expect(loader.getPackageInfo().map((entry) => entry.filename)).toEqual(["z_override.pk3"]);
      expect(requests).toEqual(["/data/pk3_manifest.json", "/data/pk3_index.json", "/data/z_override.pk3"]);
    } finally {
      loader.unloadAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("generates actual lookup winners and boots/revalidates without fetching any archive or HEAD", async () => {
    const data = await fixture();
    expect(data.manifest.files).toEqual(["a_base.pk3", "z_override.pk3"]);
    expect(data.manifest.indexHash).toBe(pk3IndexHash(data.text));
    const snapshot = JSON.parse(data.text);
    expect(snapshot.files["textures/shared.tga"]).toBe("z_override.pk3");
    expect(snapshot.shaders["textures/shared"]).toBe("z_override.pk3");
    expect(snapshot.maps.arena).toBe("z_override.pk3");
    expect(snapshot.packages.every((entry: { path: string }) => !entry.path.includes(data.dir))).toBe(true);
    const requests = serve(
      new Map([
        ["/data/pk3_manifest.json", JSON.stringify(data.manifest)],
        ["/data/pk3_index.json", data.text],
      ]),
    );
    const index = PK3Index.getInstance();
    index.setSearchPaths(["/data/"]);
    expect(await index.ensureIndex()).toBe(true);
    expect(index.findMap("ARENA")).toBe("z_override.pk3");
    expect(index.findShader("textures/shared")).toBe("z_override.pk3");
    expect(index.findFile("MODELS\\BASE.OBJ")).toBe("a_base.pk3");
    expect(index.getPK3Path("a_base.pk3")).toBe("/data/a_base.pk3");
    expect(await index.ensureIndex()).toBe(false);
    expect(requests).toHaveLength(4);
    expect(
      requests.every(
        (request) => request.method === "GET" && request.cache === "no-cache" && request.url.endsWith(".json"),
      ),
    ).toBe(true);
  });

  it("rejects schema/owner/manifest mismatch and rebases untrusted package URLs", async () => {
    const data = await fixture();
    const parsed = JSON.parse(data.text);
    parsed.packages[0].path = "https://unrelated.invalid/archive.pk3";
    const changed = JSON.stringify(parsed);
    expect(
      parsePublishedIndex(changed, { ...data.manifest, indexHash: pk3IndexHash(changed) }, "/local/")?.packages[0].path,
    ).toBe("/local/a_base.pk3");
    for (const mutate of [
      (item: typeof parsed) => {
        item.version = 99;
      },
      (item: typeof parsed) => {
        item.files["textures/shared.tga"] = "missing.pk3";
      },
      (item: typeof parsed) => {
        item.packages.pop();
      },
      (item: typeof parsed) => {
        item.maps.arena = "a_base.pk3";
      },
    ]) {
      const bad = JSON.parse(data.text);
      mutate(bad);
      const text = JSON.stringify(bad);
      expect(parsePublishedIndex(text, { ...data.manifest, indexHash: pk3IndexHash(text) }, "/data/")).toBeNull();
    }
    expect(parsePublishedIndex(data.text, { ...data.manifest, files: ["../escape.pk3"] }, "/data/")).toBeNull();
    expect(parsePublishedIndex(`${data.text} `, data.manifest, "/data/")).toBeNull();
  });

  it("falls back to runtime scanning for a stale snapshot or an old files-only manifest", async () => {
    const data = await fixture();
    for (const manifest of [data.manifest, { files: data.manifest.files }]) {
      const parts = new Map<string, string | Uint8Array>([
        ["/data/pk3_manifest.json", JSON.stringify(manifest)],
        ["/data/pk3_index.json", "stale"],
      ]);
      for (const filename of data.manifest.files)
        parts.set(`/data/${filename}`, Uint8Array.from(await readFile(join(data.dir, filename))));
      const requests = serve(parts);
      const index = PK3Index.getInstance();
      index.clear();
      index.setSearchPaths(["/data/"]);
      await index.ensureIndex();
      expect(index.findMap("arena")).toBe("z_override.pk3");
      expect(requests.filter((request) => request.url.endsWith(".pk3") && request.method === "GET")).toHaveLength(2);
    }
  });

  it("updates a same-size replacement and works with blocked cache storage", async () => {
    const dir = await directory();
    await pack(dir, "map.pk3", { "maps/old1.bsp": "map" });
    await generatePk3Index(dir);
    const parts = new Map<string, string | Uint8Array>();
    const update = async () => {
      for (const name of ["pk3_manifest.json", "pk3_index.json"])
        parts.set(`/data/${name}`, await readFile(join(dir, name), "utf8"));
    };
    await update();
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    });
    const requests = serve(parts);
    const index = PK3Index.getInstance();
    index.setSearchPaths(["/data/"]);
    await index.ensureIndex();
    const oldChecksum = index.getStats().checksum;
    expect(index.findMap("old1")).toBe("map.pk3");
    // Build a same-length replacement without clearing the live browser singleton.
    await pack(dir, "map.pk3", { "maps/new1.bsp": "map" });
    const cached = index.exportSnapshot();
    await generatePk3Index(dir);
    await update();
    Object.assign(index, { index: cached });
    await index.ensureIndex();
    expect(index.getStats().checksum).toBe(oldChecksum);
    expect(index.findMap("old1")).toBeNull();
    expect(index.findMap("new1")).toBe("map.pk3");
    expect(requests.every((request) => request.url.endsWith(".json"))).toBe(true);
  });

  it("merges configured search paths in order without accepting paths from the snapshot", async () => {
    const data = await fixture();
    const second = await directory();
    await pack(second, "later.pk3", { "textures/shared.tga": "later" });
    await generatePk3Index(second);
    const requests = serve(
      new Map([
        ["/first/pk3_manifest.json", JSON.stringify(data.manifest)],
        ["/first/pk3_index.json", data.text],
        ["/second/pk3_manifest.json", await readFile(join(second, "pk3_manifest.json"), "utf8")],
        ["/second/pk3_index.json", await readFile(join(second, "pk3_index.json"), "utf8")],
      ]),
    );
    const index = PK3Index.getInstance();
    index.setSearchPaths(["/first", "/second"]);
    await index.ensureIndex();
    expect(index.findFile("textures/shared.tga")).toBe("later.pk3");
    expect(index.findMap("arena")).toBe("z_override.pk3");
    expect(index.getPK3Path("later.pk3")).toBe("/second/later.pk3");
    expect(requests).toHaveLength(4);
  });

  it("does not overwrite published metadata when a package is corrupt", async () => {
    const data = await fixture();
    await writeFile(join(data.dir, "bad.pk3"), "not a zip");
    await expect(generatePk3Index(data.dir)).rejects.toThrow("Cannot index package: bad.pk3");
    expect(await readFile(join(data.dir, "pk3_index.json"), "utf8")).toBe(data.text);
    expect(JSON.parse(await readFile(join(data.dir, "pk3_manifest.json"), "utf8"))).toEqual(data.manifest);
  });

  it("refuses to publish a partial list if a package appears while generation is running", async () => {
    const data = await fixture();
    const index = PK3Index.getInstance();
    const indexArchive = index.indexPK3ArrayBuffer.bind(index);
    vi.spyOn(index, "indexPK3ArrayBuffer").mockImplementation(async (...args) => {
      const result = await indexArchive(...args);
      if (args[0] === "z_override.pk3") await pack(data.dir, "new.pk3", { "maps/new.bsp": "new" });
      return result;
    });
    await expect(generatePk3Index(data.dir)).rejects.toThrow("Package list changed while indexing");
    expect(await readFile(join(data.dir, "pk3_index.json"), "utf8")).toBe(data.text);
    expect(JSON.parse(await readFile(join(data.dir, "pk3_manifest.json"), "utf8"))).toEqual(data.manifest);
  });

  it("extracts bounded JPG previews without changing the packaged PNG", async () => {
    const dir = await directory();
    const image = new PNG({ width: 1600, height: 900 });
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 230;
      image.data[i + 1] = 40;
      image.data[i + 2] = 20;
      image.data[i + 3] = 255;
    }
    const png = Uint8Array.from(PNG.sync.write(image));
    await pack(dir, "map_arena.pk3", { "maps/arena.bsp": "map", "levelshots/arena.png": png });
    const before = await readFile(join(dir, "map_arena.pk3"));
    expect((await generatePk3Index(dir)).levelshotCount).toBe(1);
    const preview = jpeg.decode(await readFile(join(dir, "levelshots/arena.jpg")));
    expect([preview.width, preview.height]).toEqual([960, 540]);
    expect(preview.data[0]).toBeGreaterThan(220);
    expect(preview.data[1]).toBeLessThan(50);
    expect(await readFile(join(dir, "map_arena.pk3"))).toEqual(before);
  });

  it("rejects invalid packaged images before replacing published metadata", async () => {
    const data = await fixture();
    await pack(data.dir, "map_badshot.pk3", { "maps/arena.bsp": "map", "levelshots/arena.png": "bad PNG" });
    await expect(generatePk3Index(data.dir)).rejects.toThrow("Invalid levelshot PNG");
    expect(await readFile(join(data.dir, "pk3_index.json"), "utf8")).toBe(data.text);
    expect(JSON.parse(await readFile(join(data.dir, "pk3_manifest.json"), "utf8"))).toEqual(data.manifest);
  });

  it("removes only stale generated previews and leaves unrelated loose files alone", async () => {
    const dir = await directory();
    const png = Uint8Array.from(PNG.sync.write(new PNG({ width: 2, height: 2 })));
    await pack(dir, "map_arena.pk3", { "maps/arena.bsp": "map", "levelshots/arena.png": png });
    await generatePk3Index(dir);
    await writeFile(join(dir, "levelshots/manual.jpg"), "manual image");
    await pack(dir, "map_arena.pk3", { "maps/arena.bsp": "map" });
    expect((await generatePk3Index(dir)).levelshotCount).toBe(0);
    await expect(readFile(join(dir, "levelshots/arena.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dir, "levelshots/manual.jpg"), "utf8")).toBe("manual image");
  });

  it("publishes an empty data directory so source-only builds do not require downloaded assets", async () => {
    const dir = await directory();
    expect((await generatePk3Index(dir)).packageCount).toBe(0);
    const text = await readFile(join(dir, "pk3_index.json"), "utf8");
    const manifest = JSON.parse(await readFile(join(dir, "pk3_manifest.json"), "utf8"));
    expect(parsePublishedIndex(text, manifest, "/data/")?.packages).toEqual([]);
  });
});
