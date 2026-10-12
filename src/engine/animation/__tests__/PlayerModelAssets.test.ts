import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PK3Index } from "../../loader/pk3/PK3Index";
import { PK3Loader } from "../../loader/pk3/PK3Loader";
import { readPlayerModelAsset, resolvePlayerModelAsset, VANGUARD_PACKAGE, VANGUARD_ROOT } from "../PlayerModelAssets";

describe("packaged player assets", () => {
  const loader = PK3Loader.getInstance();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loader.unloadAll();
    loader.configure({ basePath: "/data/", additionalPaths: [] });
    const zip = new JSZip();
    zip.file(`${VANGUARD_ROOT}vanguard.glb`, new Uint8Array([1, 2, 3]));
    zip.file(`${VANGUARD_ROOT}rifle aiming idle.glb`, new Uint8Array([4, 5, 6]));
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    fetchMock = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    loader.unloadAll();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shares the lazy archive download across concurrent player and ghost imports", async () => {
    const [model, idle] = await Promise.all([
      readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`),
      readPlayerModelAsset(`${VANGUARD_ROOT}rifle aiming idle.glb`),
    ]);
    expect([...new Uint8Array(model!)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(idle!)]).toEqual([4, 5, 6]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/data/${VANGUARD_PACKAGE}`);
  });

  it("skips unavailable optional clips without repeat downloads and rejects missing required files", async () => {
    expect(await resolvePlayerModelAsset(VANGUARD_ROOT, "dance_1.glb", true)).toBeNull();
    expect(await resolvePlayerModelAsset(VANGUARD_ROOT, "dance_2.glb", true)).toBeNull();
    await expect(readPlayerModelAsset(`${VANGUARD_ROOT}missing.glb`)).rejects.toThrow("missing from PK3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases failed downloads for retry and reloads after the PK3 filesystem is cleared", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`)).rejects.toThrow("PK3 not found");
    await readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`);
    loader.unloadAll();
    await readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses an indexed replacement archive rather than assuming the default filename owns the model", async () => {
    await readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`);
    const replacement = new JSZip();
    replacement.file(`${VANGUARD_ROOT}vanguard.glb`, new Uint8Array([7, 8, 9]));
    const bytes = await replacement.generateAsync({ type: "arraybuffer" });
    fetchMock.mockImplementation(async () => new Response(bytes));
    vi.spyOn(PK3Index.getInstance(), "findFile").mockReturnValue("z_vanguard.pk3");
    const model = await readPlayerModelAsset(`${VANGUARD_ROOT}vanguard.glb`);
    expect(fetchMock.mock.calls[1][0]).toBe("/data/z_vanguard.pk3");
    expect([...new Uint8Array(model!)]).toEqual([7, 8, 9]);
  });

  it("preserves explicit loose URL and data-source imports", async () => {
    expect(await resolvePlayerModelAsset("/custom/", "player.glb")).toEqual({
      source: "player.glb",
      options: { rootUrl: "/custom/" },
    });
    expect(await resolvePlayerModelAsset("", "data:fixture")).toEqual({
      source: "data:fixture",
      options: { rootUrl: "" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
