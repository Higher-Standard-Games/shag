import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PK3Index } from "../../loader/pk3/PK3Index";
import { PK3Loader } from "../../loader/pk3/PK3Loader";
import {
  CARTEL_MODEL_ROOT,
  PLAYER_ANIMATION_PACKAGE,
  PLAYER_ANIMATION_ROOT,
  PLAYER_MODEL_FILE,
  PLAYER_MODEL_PACKAGE,
  PLAYER_MODEL_ROOT,
  RIOTKITTY_MODEL_ROOT,
  ROBOT_MODEL_ROOT,
  readPlayerModelAsset,
  resolvePlayerModelAsset,
} from "../PlayerModelAssets";

describe("packaged player assets", () => {
  const loader = PK3Loader.getInstance();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loader.unloadAll();
    loader.configure({ basePath: "/data/", additionalPaths: [] });
    const zip = new JSZip();
    zip.file(`${RIOTKITTY_MODEL_ROOT}riotkitty.glb`, new Uint8Array([16, 17, 18]));
    zip.file(`${CARTEL_MODEL_ROOT}cartel.glb`, new Uint8Array([13, 14, 15]));
    zip.file(`${ROBOT_MODEL_ROOT}robot.glb`, new Uint8Array([10, 11, 12]));
    zip.file(PLAYER_MODEL_ROOT + PLAYER_MODEL_FILE, new Uint8Array([7, 8, 9]));
    zip.file(`${PLAYER_ANIMATION_ROOT}rifle run.glb`, new Uint8Array([1, 2, 3]));
    zip.file(`${PLAYER_ANIMATION_ROOT}rifle aiming idle.glb`, new Uint8Array([4, 5, 6]));
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
      readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`),
      readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle aiming idle.glb`),
    ]);
    expect([...new Uint8Array(model!)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(idle!)]).toEqual([4, 5, 6]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/data/${PLAYER_ANIMATION_PACKAGE}`);
  });

  it("loads bodies and shared clips from their own archives, once each", async () => {
    const [body, idle, robot, cartel, riotkitty] = await Promise.all([
      resolvePlayerModelAsset(PLAYER_MODEL_ROOT, PLAYER_MODEL_FILE),
      resolvePlayerModelAsset(PLAYER_ANIMATION_ROOT, "rifle aiming idle.glb"),
      resolvePlayerModelAsset(ROBOT_MODEL_ROOT, "robot.glb"),
      resolvePlayerModelAsset(CARTEL_MODEL_ROOT, "cartel.glb"),
      resolvePlayerModelAsset(RIOTKITTY_MODEL_ROOT, "riotkitty.glb"),
    ]);
    expect([...(riotkitty!.source as Uint8Array)]).toEqual([16, 17, 18]);
    expect([...(cartel!.source as Uint8Array)]).toEqual([13, 14, 15]);
    expect([...(robot!.source as Uint8Array)]).toEqual([10, 11, 12]);
    expect([...(body!.source as Uint8Array)]).toEqual([7, 8, 9]);
    expect([...(idle!.source as Uint8Array)]).toEqual([4, 5, 6]);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(
      [`/data/${PLAYER_ANIMATION_PACKAGE}`, `/data/${PLAYER_MODEL_PACKAGE}`].sort(),
    );
  });

  it("skips unavailable optional clips without repeat downloads and rejects missing required files", async () => {
    expect(await resolvePlayerModelAsset(PLAYER_ANIMATION_ROOT, "dance_1.glb", true)).toBeNull();
    expect(await resolvePlayerModelAsset(PLAYER_ANIMATION_ROOT, "dance_2.glb", true)).toBeNull();
    await expect(readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}missing.glb`)).rejects.toThrow("missing from PK3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases failed downloads for retry and reloads after the PK3 filesystem is cleared", async () => {
    // Exhaust the loader's initial attempt and two automatic retries.
    for (let attempt = 0; attempt < 3; attempt++) fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`)).rejects.toThrow("offline");
    await readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`);
    loader.unloadAll();
    await readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("uses an indexed replacement archive rather than assuming the default filename owns the model", async () => {
    await readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`);
    const replacement = new JSZip();
    replacement.file(`${PLAYER_ANIMATION_ROOT}rifle run.glb`, new Uint8Array([7, 8, 9]));
    const bytes = await replacement.generateAsync({ type: "arraybuffer" });
    fetchMock.mockImplementation(async () => new Response(bytes));
    vi.spyOn(PK3Index.getInstance(), "findFile").mockReturnValue("z_animations.pk3");
    const model = await readPlayerModelAsset(`${PLAYER_ANIMATION_ROOT}rifle run.glb`);
    expect(fetchMock.mock.calls[1][0]).toBe("/data/z_animations.pk3");
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
