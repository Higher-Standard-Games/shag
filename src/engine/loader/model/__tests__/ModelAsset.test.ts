import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PK3Index } from "../../pk3/PK3Index";
import { PK3Loader } from "../../pk3/PK3Loader";
import { isIndexedModelDirectory, readIndexedModelAsset, resolveModelAsset } from "../ModelAsset";

const asset = "models/weapons/glauncher/glauncher.glb";
const cfg = "models/weapons/glauncher/glauncher.cfg";
const index = PK3Index.getInstance();
const loader = PK3Loader.getInstance();
let fetchMock: ReturnType<typeof vi.fn>;

async function bank(name: string, content: number[]) {
  const zip = new JSZip();
  zip.file(asset, new Uint8Array(content));
  zip.file(cfg, "ammoCounter 1");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  await index.indexPK3ArrayBuffer(name, bytes, name);
  return bytes;
}

beforeEach(() => {
  index.clear();
  loader.unloadAll();
  loader.configure({ basePath: "/data/", additionalPaths: [] });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  index.clear();
  loader.unloadAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares one package download across model and cfg imports without loose requests", async () => {
  const bytes = await bank("z_weapons.pk3", [1, 2, 3]);
  fetchMock.mockImplementation(async () => new Response(bytes));
  const [model, sidecar] = await Promise.all([
    resolveModelAsset(`/data/${asset}`),
    readIndexedModelAsset(`data/${cfg}`),
  ]);
  expect([...(model.source as Uint8Array)]).toEqual([1, 2, 3]);
  expect(model.options).toEqual({ rootUrl: "", pluginExtension: ".glb" });
  expect(new TextDecoder().decode(sidecar!)).toBe("ammoCounter 1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/data/z_weapons.pk3");
});

it("loads a new indexed owner even when the old package already contains the model", async () => {
  const base = await bank("z_weapons.pk3", [1]);
  fetchMock.mockImplementation(async () => new Response(base));
  await readIndexedModelAsset(asset);
  const replacement = await bank("zz_replacement.pk3", [2]);
  fetchMock.mockImplementation(async () => new Response(replacement));
  expect([...new Uint8Array((await readIndexedModelAsset(asset))!)]).toEqual([2]);
  expect(fetchMock.mock.calls.at(-1)![0]).toBe("/data/zz_replacement.pk3");
});

it("releases a failed load and reloads after the mounted filesystem is cleared", async () => {
  const bytes = await bank("z_weapons.pk3", [1]);
  fetchMock.mockImplementation(async () => new Response(bytes));
  vi.spyOn(loader, "ensurePK3").mockRejectedValueOnce(new Error("offline"));
  await expect(readIndexedModelAsset(asset)).rejects.toThrow("offline");
  await readIndexedModelAsset(asset);
  loader.unloadAll();
  await readIndexedModelAsset(asset);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps unindexed custom URLs and non-GLB imports on their original loader path", async () => {
  expect(await resolveModelAsset("https://example.invalid/guns/custom.glb")).toEqual({
    source: "custom.glb",
    options: { rootUrl: "https://example.invalid/guns/" },
  });
  expect(await resolveModelAsset("/data/custom/model.obj")).toEqual({
    source: "model.obj",
    options: { rootUrl: "/data/custom/" },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("recognizes packaged directories without confusing custom origins or similarly named paths", async () => {
  await bank("z_weapons.pk3", [1]);
  expect(isIndexedModelDirectory("/data/models/weapons/glauncher/")).toBe(true);
  expect(isIndexedModelDirectory("models/weapons/glauncher")).toBe(true);
  expect(isIndexedModelDirectory("/data/models/weapons/glaunch/")).toBe(false);
  expect(isIndexedModelDirectory("https://custom.invalid/data/models/weapons/glauncher/")).toBe(false);
  expect(isIndexedModelDirectory("/custom/")).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
