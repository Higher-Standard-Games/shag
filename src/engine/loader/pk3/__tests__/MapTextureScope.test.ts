import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BspFile } from "../../bsp/BspLoader";
import { MapLoader } from "../../map/MapLoader";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import { PK3Index } from "../PK3Index";
import { PK3Loader } from "../PK3Loader";
import type { PK3PackageScope } from "../PK3PackageScope";

const loader = PK3Loader.getInstance(),
  index = PK3Index.getInstance(),
  shaders = Q3ShaderRegistry.getInstance();
const bodies = new Map<string, Uint8Array>();
async function pack(filename: string, files: Record<string, string>, mount = true) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  bodies.set(`data/${filename}`, bytes);
  await index.indexPK3ArrayBuffer(filename, Uint8Array.from(bytes).buffer, `data/${filename}`);
  if (mount) await loader.processPK3ArrayBuffer(filename, Uint8Array.from(bytes).buffer);
}
function scope(packageName: string): PK3PackageScope {
  return {
    package: packageName,
    files: new Set(loader.getPackageFiles(packageName)),
    shaders: new Set(["textures/shared"]),
    excludedPackages: new Set([packageName === "tex_a.pk3" ? "tex_b.pk3" : "tex_a.pk3"]),
  };
}
function activate(packageName: string) {
  const context = scope(packageName);
  loader.setPackageScope(context);
  index.setPackageScope(context);
}
beforeEach(() => {
  loader.unloadAll();
  index.clear();
  shaders.clear();
  bodies.clear();
});
afterEach(() => {
  loader.unloadAll();
  index.clear();
  shaders.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("switches file and shader copies together, hides cached peer-only assets and restores the legacy view", async () => {
  for (const name of ["a", "b"])
    await pack(`tex_${name}.pk3`, {
      "textures/shared.tga": name,
      [`textures/${name}.tga`]: name,
      [`scripts/${name}.shader`]: `textures/shared { { map textures/${name}.tga } }`,
    });
  const published = index.exportSnapshot();
  for (const name of ["a", "b", "a"]) {
    activate(`tex_${name}.pk3`);
    await shaders.loadShaders();
    expect(index.findFile("textures/shared.tga")).toBe(`tex_${name}.pk3`);
    expect(index.findShader("textures/shared")).toBe(`tex_${name}.pk3`);
    expect(new TextDecoder().decode((await loader.getFile("textures/shared.tga"))!)).toBe(name);
    expect(shaders.getShader("textures/shared")?.stages[0].map).toBe(`textures/${name}.tga`);
    const other = name === "a" ? "b" : "a";
    expect(index.findFile(`textures/${other}.tga`)).toBeNull();
    expect(loader.hasFile(`textures/${other}.tga`)).toBe(false);
    expect({ ...index.exportSnapshot(), lastUpdated: published.lastUpdated }).toEqual(published);
  }
  loader.setPackageScope(null);
  index.setPackageScope(null);
  await shaders.loadShaders();
  expect(new TextDecoder().decode((await loader.getFile("textures/shared.tga"))!)).toBe("b");
  expect(index.findFile("textures/shared.tga")).toBe("tex_b.pk3");
  expect(shaders.getShader("textures/shared")?.stages[0].map).toBe("textures/b.tga");
});

it("keeps deliberate override files/shaders above the map bank even when a shader filename was shadowed", async () => {
  await pack("a_base.pk3", { "scripts/base.shader": "textures/shared { { map textures/base.tga } }" });
  await pack("tex_a.pk3", {
    "textures/shared.tga": "a",
    "scripts/a.shader": "textures/shared { { map textures/a.tga } }",
  });
  await pack("tex_b.pk3", { "textures/shared.tga": "b" });
  await pack("z_override.pk3", {
    "textures/shared.tga": "override",
    "scripts/base.shader": "textures/shared { { map textures/override.tga } }",
  });
  activate("tex_a.pk3");
  await shaders.loadShaders();
  expect(index.findFile("textures/shared.tga")).toBe("z_override.pk3");
  expect(index.findShader("textures/shared")).toBe("z_override.pk3");
  expect(new TextDecoder().decode((await loader.getFile("textures/shared.tga"))!)).toBe("override");
  expect(shaders.getShader("textures/shared")?.stages[0].map).toBe("textures/override.tga");
});

interface MapInternals {
  prepareMapTextureBank(name: string, progress: () => void, signal: AbortSignal): Promise<void>;
  resolveMapDependencies(bsp: BspFile): Promise<Set<string>>;
}
it("downloads only the companion, resolves shared dependencies locally and retains legacy-map fallback", async () => {
  for (const name of ["a", "b"]) {
    await pack(`map_${name}.pk3`, { [`maps/${name}.bsp`]: "map" }, false);
    await pack(
      `tex_${name}.pk3`,
      {
        "textures/shared.tga": name,
        [`media-manifests/${name}.json`]: JSON.stringify({ map: name }),
        [`scripts/${name}.shader`]: "textures/shared { { map textures/shared.tga } }",
      },
      false,
    );
  }
  const fetch = vi.fn(async (url: string) => new Response(Uint8Array.from(bodies.get(url)!)));
  vi.stubGlobal("fetch", fetch);
  const maps = MapLoader.getInstance() as unknown as MapInternals;
  const bsp = { textures: [{ name: "textures/shared" }] } as BspFile;
  await maps.prepareMapTextureBank("a", () => {}, new AbortController().signal);
  expect([...(await maps.resolveMapDependencies(bsp))]).toEqual([]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["data/tex_a.pk3"]);
  expect(index.findFile("textures/shared.tga")).toBe("tex_a.pk3");
  await maps.prepareMapTextureBank("legacy", () => {}, new AbortController().signal);
  expect(index.findFile("textures/shared.tga")).toBe("tex_b.pk3");
  expect([...(await maps.resolveMapDependencies(bsp))]).toEqual(["tex_b.pk3"]);
});

it("rejects a wrongly labelled companion instead of falling back to another map's bank", async () => {
  await pack("tex_a.pk3", { "media-manifests/a.json": '{"map":"wrong"}' });
  vi.stubGlobal("fetch", async (url: string) => new Response(Uint8Array.from(bodies.get(url)!)));
  await expect(
    (MapLoader.getInstance() as unknown as MapInternals).prepareMapTextureBank(
      "a",
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("Invalid map texture bank");
});

it("fetches an image override referenced only inside a shader, without downloading peer banks", async () => {
  await pack("map_a.pk3", { "maps/a.bsp": "map" }, false);
  await pack("map_b.pk3", { "maps/b.bsp": "map" }, false);
  await pack(
    "tex_a.pk3",
    {
      "media-manifests/a.json": '{"map":"a"}',
      "textures/stage.tga": "original",
      "scripts/a.shader": "textures/surface { { map textures/stage.tga } }",
    },
    false,
  );
  await pack("tex_b.pk3", { "textures/stage.tga": "peer" }, false);
  await pack("z_override.pk3", { "textures/stage.tga": "override" }, false);
  const fetch = vi.fn(async (url: string) => new Response(Uint8Array.from(bodies.get(url)!)));
  vi.stubGlobal("fetch", fetch);
  await (MapLoader.getInstance() as unknown as MapInternals).prepareMapTextureBank(
    "a",
    () => {},
    new AbortController().signal,
  );
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["data/tex_a.pk3", "data/z_override.pk3"]);
  expect(new TextDecoder().decode((await loader.getFile("textures/stage.tga"))!)).toBe("override");
  expect(index.findShader("textures/surface")).toBe("tex_a.pk3");
});

it("loads a shared billboard once with a revision URL, bypasses stale sidecars and reuses it across maps", async () => {
  for (const name of ["a", "b"]) {
    await pack(`map_${name}.pk3`, { [`maps/${name}.bsp`]: "map" }, false);
    await pack(
      `tex_${name}.pk3`,
      {
        [`media-manifests/${name}.json`]: JSON.stringify({
          map: name,
          sharedDependencies: [
            { package: "tex_billboard.pk3", dynamic: true, texturePrefixes: ["textures/billboard/"] },
          ],
        }),
        [`scripts/${name}.shader`]: "textures/ad { { map textures/billboard/ad.png } }",
      },
      false,
    );
  }
  await pack("tex_billboard.pk3", { "textures/billboard/ad.png": "ad" }, false);
  const fetch = vi.fn(async (url: string) => new Response(Uint8Array.from(bodies.get(url.split("?")[0])!)));
  vi.stubGlobal("fetch", fetch);
  const maps = MapLoader.getInstance() as unknown as MapInternals;
  const revision = index.getStats().lastUpdated!.getTime();
  await maps.prepareMapTextureBank("a", () => {}, new AbortController().signal);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["data/tex_a.pk3", `data/tex_billboard.pk3?pk3v=${revision}`]);
  expect(loader.canUseTextureSidecar("textures/billboard/ad")).toBe(false);
  expect(loader.canUseTextureSidecar("textures/wall")).toBe(true);
  await maps.prepareMapTextureBank("b", () => {}, new AbortController().signal);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "data/tex_a.pk3",
    `data/tex_billboard.pk3?pk3v=${revision}`,
    "data/tex_b.pk3",
  ]);
  expect(new TextDecoder().decode((await loader.getFile("textures/billboard/ad.png"))!)).toBe("ad");
  vi.spyOn(Date, "now").mockReturnValue(revision + 1000);
  await pack("tex_billboard.pk3", { "textures/billboard/ad.png": "AD" }, false);
  // Publishing replacement metadata advances the revision, even when the archive size is unchanged.
  index.exportSnapshot();
  await maps.prepareMapTextureBank("a", () => {}, new AbortController().signal);
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(`data/tex_billboard.pk3?pk3v=${revision + 1000}`);
  expect(new TextDecoder().decode((await loader.getFile("textures/billboard/ad.png"))!)).toBe("AD");
});
