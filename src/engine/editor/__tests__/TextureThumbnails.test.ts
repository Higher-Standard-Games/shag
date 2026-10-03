/**
 * Thumbnail scheduling and caching, with fake decoding and storage; and the
 * TGA pixel decoder the browser path uses instead of a PNG data URL.
 */

import { describe, expect, it, vi } from "vitest";
import { decodeTGAPixels } from "../../loader/texture/TgaDecoder";
import { type StoredThumbnail, TextureThumbnails, type ThumbnailDeps } from "../TextureThumbnails";

function harness(overrides: Partial<ThumbnailDeps> = {}) {
  const stored = new Map<string, StoredThumbnail>();
  let urls = 0;
  const revoked: string[] = [];
  const releases: Array<() => void> = [];
  const decodeOrder: string[] = [];
  const deps: ThumbnailDeps = {
    readFile: vi.fn(async (path: string) => (path.includes("absent") ? null : new ArrayBuffer(8))),
    versionOf: vi.fn(() => "v1"),
    // Each decode waits until the test releases it, so concurrency and order are observable.
    decode: vi.fn(
      (path: string) =>
        new Promise<{ blob: Blob; width: number; height: number } | null>((resolve) => {
          decodeOrder.push(path);
          releases.push(() =>
            resolve(path.endsWith(".ktx") ? null : { blob: new Blob([path]), width: 256, height: 128 }),
          );
        }),
    ),
    store: {
      get: vi.fn(async (key: string) => stored.get(key)),
      put: vi.fn(async (key: string, value: StoredThumbnail) => {
        stored.set(key, value);
      }),
    },
    createObjectURL: () => `blob:${++urls}`,
    revokeObjectURL: (url) => revoked.push(url),
    ...overrides,
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const releaseAll = async () => {
    while (releases.length) {
      releases.shift()!();
      await flush();
    }
  };
  return { deps, stored, revoked, releases, decodeOrder, flush, releaseAll };
}

describe("texture thumbnails", () => {
  it("decodes once, reports the source size, then serves memory and the store", async () => {
    const h = harness();
    const thumbs = new TextureThumbnails(h.deps);
    const first = thumbs.request("textures/a.tga");
    const same = thumbs.request("textures/a.tga");
    await h.flush();
    await h.releaseAll();
    expect(await first).toEqual({ url: "blob:1", width: 256, height: 128 });
    expect(await same).toBe(await first);
    expect(h.deps.decode).toHaveBeenCalledTimes(1);
    expect(await thumbs.request("textures/a.tga")).toEqual(await first); // memory

    const reopened = new TextureThumbnails(h.deps); // a new page: memory empty, IndexedDB kept
    expect(await reopened.request("textures/a.tga")).toMatchObject({ width: 256, height: 128 });
    expect(h.deps.decode).toHaveBeenCalledTimes(1);
  });

  it("decodes again when the package version changed", async () => {
    const h = harness();
    h.stored.set("textures/a.tga", { blob: new Blob(["old"]), width: 64, height: 64, version: "v0" });
    const thumbs = new TextureThumbnails(h.deps);
    const thumb = thumbs.request("textures/a.tga");
    await h.flush();
    await h.releaseAll();
    expect(await thumb).toMatchObject({ width: 256, height: 128 });
    expect(h.stored.get("textures/a.tga")?.version).toBe("v1");
  });

  it("runs the newest batch first, in request order, within the concurrency limit", async () => {
    const h = harness();
    const thumbs = new TextureThumbnails(h.deps, { concurrency: 2 });
    // First render: tiles a..d requested top to bottom.
    const first = ["a", "b", "c", "d"].map((name) => thumbs.request(`textures/${name}.tga`));
    await h.flush();
    expect(h.decodeOrder).toEqual(["textures/a.tga", "textures/b.tga"]); // two slots, top first
    // The mapper scrolls: x and y become visible; c and d are still queued from before.
    const scrolled = ["x", "y"].map((name) => thumbs.request(`textures/${name}.tga`));
    thumbs.cancel("textures/d.tga"); // d's tile left the screen
    expect(await first[3]).toBeNull();
    await h.flush();
    await h.releaseAll();
    expect(h.decodeOrder).toEqual([
      "textures/a.tga",
      "textures/b.tga",
      "textures/x.tga",
      "textures/y.tga",
      "textures/c.tga",
    ]);
    expect(await scrolled[1]).not.toBeNull();
    expect(await first[2]).not.toBeNull();
  });

  it("returns null for a missing file or a format without a preview, without retrying", async () => {
    const h = harness();
    const thumbs = new TextureThumbnails(h.deps);
    expect(await thumbs.request("textures/absent.tga")).toBeNull();
    const ktx = thumbs.request("textures/grid.ktx");
    await h.flush();
    await h.releaseAll();
    expect(await ktx).toBeNull();
    expect(await thumbs.request("textures/grid.ktx")).toBeNull();
    expect(h.deps.decode).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used thumbnail and revokes its URL; dispose revokes the rest", async () => {
    const h = harness();
    const thumbs = new TextureThumbnails(h.deps, { memoryLimit: 2 });
    for (const name of ["a", "b"]) {
      const request = thumbs.request(`textures/${name}.tga`);
      await h.flush();
      await h.releaseAll();
      await request;
    }
    await thumbs.request("textures/a.tga"); // touch a, so b is now the oldest
    const third = thumbs.request("textures/c.tga");
    await h.flush();
    await h.releaseAll();
    await third;
    expect(h.revoked).toEqual(["blob:2"]); // b
    thumbs.dispose();
    expect(h.revoked.sort()).toEqual(["blob:1", "blob:2", "blob:3"]);
  });
});

describe("TGA pixels", () => {
  it("decodes a bottom-up 24-bit image to top-down RGBA", () => {
    // 2×2, uncompressed true colour, origin bottom-left (descriptor 0), BGR rows bottom first.
    const header = new Uint8Array(18);
    header[2] = 2;
    header[12] = 2;
    header[14] = 2;
    header[16] = 24;
    const bgr = [
      [255, 0, 0], // bottom-left: blue
      [0, 255, 0], // bottom-right: green
      [0, 0, 255], // top-left: red
      [255, 255, 255], // top-right: white
    ].flat();
    const file = new Uint8Array([...header, ...bgr]);
    const { width, height, pixels } = decodeTGAPixels(file.buffer);
    expect([width, height]).toEqual([2, 2]);
    expect([...pixels]).toEqual([
      255, 0, 0, 255, /* top-left red */ 255, 255, 255, 255 /* top-right white */, 0, 0, 255, 255,
      /* bottom-left blue */ 0, 255, 0, 255 /* bottom-right green */,
    ]);
  });
});
