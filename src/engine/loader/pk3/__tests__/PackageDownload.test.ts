import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { readAssetBuffer } from "../AssetRequest";
import { PackageDownload } from "../PackageDownload";
import { PK3Loader } from "../PK3Loader";

afterEach(() => {
  for (const download of PackageDownload.getActive()) download.finish();
  PK3Loader.getInstance().unloadAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports streamed bytes before the body completes without changing its contents", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const progress = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
  );
  const read = readAssetBuffer(response, undefined, undefined, progress);
  controller.enqueue(new Uint8Array([1, 2]));
  await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(2));
  controller.enqueue(new Uint8Array([3]));
  controller.close();
  expect([...new Uint8Array(await read)]).toEqual([1, 2, 3]);
  expect(progress).toHaveBeenLastCalledWith(3);
});

it("tracks independent transfers, truthful totals and speed including stalls", () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const a = new PackageDownload("textures.pk3");
  const b = new PackageDownload("weapons.pk3");
  a.response(new Response(null, { headers: { "content-length": "10000000" } }));
  b.response(new Response(null, { headers: { "content-length": "10", "content-encoding": "gzip" } }));
  now = 1000;
  a.update(2_000_000);
  expect(a.bytesPerSecond()).toBe(2_000_000);
  expect(a.total).toBe(10_000_000);
  expect(b.total).toBeNull();
  expect(PackageDownload.getActive()).toEqual([a, b]);
  now = 3100;
  expect(a.bytesPerSecond()).toBe(0);
  a.reset();
  expect(a.loaded).toBe(0);
  expect(a.total).toBeNull();
  a.finish();
  expect(PackageDownload.getActive()).toEqual([b]);
});

it("registers actual PK3 fetches and clears success and failure", async () => {
  const zip = await new JSZip().file("hello.txt", "hello").generateAsync({ type: "uint8array" });
  const fetch = vi.fn(async () => {
    expect(PackageDownload.getActive().map((item) => item.filename)).toEqual(["test.pk3"]);
    return new Response(new Uint8Array(zip).buffer, { headers: { "content-length": String(zip.length) } });
  });
  vi.stubGlobal("fetch", fetch);
  await PK3Loader.getInstance().loadPK3FromUrl("https://example.test/test.pk3");
  expect(PackageDownload.getActive()).toEqual([]);
  fetch.mockImplementation(async () => new Response(null, { status: 404 }));
  await expect(PK3Loader.getInstance().loadPK3FromUrl("https://example.test/missing.pk3")).rejects.toThrow("HTTP 404");
  expect(PackageDownload.getActive()).toEqual([]);
});
