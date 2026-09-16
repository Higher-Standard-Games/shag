/**
 * KTX2 decoder worker start. Babylon's worker pool never runs a decode whose
 * worker failed to start, so the texture neither loaded nor errored and never
 * fell back to its source image. These drive Babylon's real KTX2 upload path
 * through a pool built with the runtime's worker factory.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2.js";
import { AutoReleaseWorkerPool } from "@babylonjs/core/Misc/workerPool.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheUntilFailure, startDecoderWorker } from "../KTX2DecoderRuntime";

type Upload = (data: ArrayBufferView, internalTexture: unknown, options?: unknown) => Promise<void>;
type Listener = (event: MessageEvent) => void;

let engine: NullEngine;

beforeEach(() => {
  engine = new NullEngine();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  KhronosTextureContainer2.WorkerPool = undefined;
  (KhronosTextureContainer2 as unknown as { _WorkerPoolPromise?: unknown })._WorkerPoolPromise = undefined;
  engine.dispose();
  vi.restoreAllMocks();
});

/** A fake worker; `answersInit` decides whether it ever finishes starting. */
function fakeWorker(answersInit: boolean) {
  const listeners = new Set<Listener>();
  return {
    addEventListener: (type: string, listener: Listener) => type === "message" && listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    postMessage: (message: { action?: string }) => {
      if (answersInit && message.action === "init") {
        queueMicrotask(() => {
          for (const listener of [...listeners]) listener({ data: { action: "init" } } as MessageEvent);
        });
      }
    },
    terminate: vi.fn(),
  };
}

/** Upload `count` textures through `pool`; resolves to "hung" if any upload never settles. */
async function uploadThrough(pool: AutoReleaseWorkerPool, count: number) {
  const ktx2 = new KhronosTextureContainer2(engine, { workerPool: pool });
  const upload = (ktx2 as unknown as { _uploadAsync: Upload })._uploadAsync.bind(ktx2);
  const uploads = Array.from({ length: count }, () => upload(new Uint8Array(16), {}));
  const hung = new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2000));
  return Promise.race([Promise.allSettled(uploads), hung]);
}

describe("startDecoderWorker", () => {
  it("settles every queued decode with an error when the worker cannot start", async () => {
    const pool = new AutoReleaseWorkerPool(2, () =>
      startDecoderWorker(
        () => {
          throw new Error("worker module failed to load");
        },
        async () => ({}),
      ),
    );

    const results = await uploadThrough(pool, 5);

    expect(results).not.toBe("hung");
    expect(results).toHaveLength(5);
    for (const result of results as PromiseSettledResult<void>[]) {
      expect(result.status).toBe("rejected");
      expect(String((result as PromiseRejectedResult).reason?.message)).toContain("worker module failed to load");
    }
  });

  it("settles decodes when the decoder binaries fail to load", async () => {
    const pool = new AutoReleaseWorkerPool(1, () =>
      startDecoderWorker(
        () => fakeWorker(true) as unknown as Worker,
        async () => {
          throw new Error("KTX2 wasmZSTDDecoder fetch failed: HTTP 504");
        },
      ),
    );

    const results = await uploadThrough(pool, 2);

    expect(results).not.toBe("hung");
    expect((results as PromiseSettledResult<void>[]).every((result) => result.status === "rejected")).toBe(true);
  });

  it("gives up on a worker that never answers its init message, and terminates it", async () => {
    const worker = fakeWorker(false);

    const started = await startDecoderWorker(
      () => worker as unknown as Worker,
      async () => ({}),
      20,
    );

    expect(started).not.toBe(worker);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("uses a worker that starts normally", async () => {
    const worker = fakeWorker(true);

    expect(
      await startDecoderWorker(
        () => worker as unknown as Worker,
        async () => ({}),
      ),
    ).toBe(worker);
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});

describe("cacheUntilFailure", () => {
  it("shares one load, and retries after a failure", async () => {
    let calls = 0;
    const load = cacheUntilFailure(async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed");
      return "binaries";
    });

    await expect(load()).rejects.toThrow("fetch failed");
    const [first, second] = await Promise.all([load(), load()]);

    expect(first).toBe("binaries");
    expect(second).toBe("binaries");
    expect(await load()).toBe("binaries");
    expect(calls).toBe(2);
  });
});
