import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { ASSET_HEADER_TIMEOUT_MS, fetchAsset, readAssetBuffer } from "../AssetRequest";
import { PK3Loader } from "../PK3Loader";
import { fetchPk3 } from "../Pk3Mirror";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  PK3Loader.getInstance().unloadAll();
});

it("keeps caller cancellation connected after response headers", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const response = await fetchAsset("test", { signal: controller.signal }, async (_url, init) => {
    requestSignal = init?.signal;
    return new Response(new ReadableStream());
  });
  expect(requestSignal?.aborted).toBe(false);
  controller.abort();
  expect(requestSignal?.aborted).toBe(true);
  await response.body?.cancel();
});

it("aborts stalled headers even when fetch ignores cancellation", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const request = fetchAsset("test", {}, async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const result = expect(request).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(ASSET_HEADER_TIMEOUT_MS);
  await result;
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("falls back to origin when the mirror never answers", async () => {
  vi.useFakeTimers();
  const impl = vi.fn(async (url: RequestInfo | URL) =>
    String(url).startsWith("https:") ? new Promise<Response>(() => {}) : new Response("origin"),
  );
  const request = fetchPk3("data/test.pk3", "https://mirror.invalid/", impl);
  await vi.advanceTimersByTimeAsync(ASSET_HEADER_TIMEOUT_MS);
  expect((await request).source).toBe("origin");
  expect(impl).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a stalled body and clears its timer", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const result = expect(readAssetBuffer(response, 100)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await result;
  expect(cancel).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("allows a progressing body to exceed the idle timeout", async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
  );
  const request = readAssetBuffer(response, 100);
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(80);
    stream.enqueue(new Uint8Array([i]));
  }
  stream.close();
  expect([...new Uint8Array(await request)]).toEqual([0, 1, 2, 3]);
  expect(vi.getTimerCount()).toBe(0);
});

it("retries an intact ZIP header with a missing directory, then installs the valid archive", async () => {
  const valid = await new JSZip().file("test.txt", "ok").generateAsync({ type: "uint8array" });
  const corrupt = new Uint8Array(32);
  corrupt.set([0x50, 0x4b, 3, 4]);
  const impl = vi
    .fn()
    .mockResolvedValueOnce(new Response(corrupt))
    .mockResolvedValueOnce(new Response(new Uint8Array(valid).buffer));
  vi.stubGlobal("fetch", impl);
  await PK3Loader.getInstance().loadPK3FromUrl("https://origin.invalid/test.pk3");
  expect(impl).toHaveBeenCalledTimes(2);
  expect(
    PK3Loader.getInstance()
      .getPackageInfo()
      .some((p) => p.filename === "test.pk3"),
  ).toBe(true);
});

it("bounds corrupt archive retries and preserves the cause", async () => {
  const impl = vi.fn(async () => new Response(new Uint8Array(32)));
  vi.stubGlobal("fetch", impl);
  await expect(PK3Loader.getInstance().loadPK3FromUrl("https://origin.invalid/bad.pk3")).rejects.toThrow(
    "Could not load bad.pk3",
  );
  expect(impl).toHaveBeenCalledTimes(3);
});

it("does not delay a missing package with repeated 404 requests", async () => {
  const impl = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", impl);
  await expect(PK3Loader.getInstance().loadPK3FromUrl("https://origin.invalid/missing.pk3")).rejects.toThrow(
    "HTTP 404",
  );
  expect(impl).toHaveBeenCalledOnce();
});
