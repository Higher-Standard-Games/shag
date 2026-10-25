import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Cvar } from "../../../core/Cvar";
import { PK3Index } from "../PK3Index";
import { PK3Loader } from "../PK3Loader";
import { PK3TextureLoader } from "../PK3TextureLoader";

let engine: NullEngine, scene: Scene;
const loader = PK3TextureLoader.getInstance();
const pk3 = PK3Loader.getInstance();
function image(): ArrayBuffer {
  const bytes = new Uint8Array(21);
  bytes[2] = 2;
  bytes[12] = bytes[14] = 1;
  bytes[16] = 24;
  bytes[18] = bytes[19] = bytes[20] = 255;
  return bytes.buffer;
}
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  loader.init(engine, scene);
  vi.spyOn(PK3Index.getInstance(), "findFile").mockReturnValue("review.pk3");
  vi.spyOn(PK3Index.getInstance(), "getPK3Path").mockReturnValue("data/review.pk3");
  vi.spyOn(pk3, "ensurePK3").mockResolvedValue();
  vi.spyOn(Cvar, "get").mockReturnValue(0);
  vi.spyOn(Cvar, "getBool").mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  loader.clearCache();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("falls back from a stalled optional manifest once without repeating its delay for every texture", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(Cvar.get).mockReturnValue(undefined);
  vi.mocked(Cvar.getBool).mockReturnValue(true);
  vi.mocked(PK3Index.getInstance().findFile).mockImplementation((path) =>
    path.endsWith(".tga") ? "review.pk3" : null,
  );
  vi.spyOn(pk3, "getFile").mockResolvedValue(image());
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const pending = loader.resolveAndLoadTexture("textures/review-stalled");
  await vi.advanceTimersByTimeAsync(2600);
  expect(await pending).not.toBeNull();
  expect(await loader.resolveAndLoadTexture("textures/review-other")).not.toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
});

it("detaches a cancelled map from shared texture acquisition without creating a late texture", async () => {
  const controller = new AbortController();
  loader.init(engine, scene, controller.signal);
  let finish!: (data: ArrayBuffer) => void;
  vi.spyOn(pk3, "getFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = loader.loadTexture("textures/review.tga");
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  controller.abort(new Error("cancelled"));
  await rejected;
  finish(image());
  await Promise.resolve();
  expect(loader.getCacheInfo().count).toBe(0);
});

it("does not start a source fallback in a replacement scope after an old sidecar finishes", async () => {
  let finish!: (texture: null) => void;
  vi.spyOn(
    loader as unknown as { tryLoadKTX2Sidecar(path: string): Promise<null> },
    "tryLoadKTX2Sidecar",
  ).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = vi.spyOn(pk3, "getFile").mockResolvedValue(image());
  const old = loader.resolveAndLoadTexture("textures/retired");
  loader.clearCache();
  finish(null);
  expect(await old).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(loader.getCacheInfo().count).toBe(0);
});

it("acquires an indexed but unmounted texture owner without loose HTTP", async () => {
  vi.spyOn(pk3, "hasFile").mockReturnValue(false);
  vi.spyOn(pk3, "getFile").mockResolvedValue(image());
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await loader.resolveAndLoadTexture("textures/review")).not.toBeNull();
  expect(pk3.ensurePK3).toHaveBeenCalledWith("review.pk3");
  expect(fetch).not.toHaveBeenCalled();
});

it("coalesces simultaneous extraction and texture creation, retaining a single cached result", async () => {
  const read = vi.spyOn(pk3, "getFile").mockResolvedValue(image());
  const [a, b] = await Promise.all([
    loader.loadTexture("textures/review.tga"),
    loader.loadTexture("textures/review.tga"),
  ]);
  expect(a).not.toBeNull();
  expect(a).toBe(b);
  expect(read).toHaveBeenCalledOnce();
  expect(await loader.loadTexture("textures/review.tga")).toBe(a);
});

it("does not probe loose HTTP for an indexed package failure and permits retry", async () => {
  const read = vi.spyOn(pk3, "getFile").mockResolvedValue(null);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(loader.loadTexture("textures/review.tga")).rejects.toThrow("indexed package");
  read.mockResolvedValue(image());
  expect(await loader.loadTexture("textures/review.tga")).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("drops an extraction completed after cache clear without publishing into the new generation", async () => {
  let release!: (bytes: ArrayBuffer) => void;
  vi.spyOn(pk3, "getFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = loader.loadTexture("textures/review.tga");
  await vi.waitFor(() => expect(release).toBeDefined());
  loader.clearCache();
  release(image());
  expect(await pending).toBeNull();
  expect(loader.getCacheInfo().count).toBe(0);
});
