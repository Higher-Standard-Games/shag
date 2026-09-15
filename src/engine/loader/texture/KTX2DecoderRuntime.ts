import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader.js";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2.js";
import { initializeWebWorker } from "@babylonjs/core/Misc/khronosTextureContainer2Worker.js";
import { AutoReleaseWorkerPool } from "@babylonjs/core/Misc/workerPool.js";

/** A decoder worker that has not answered its init message by then counts as failed. */
const WORKER_START_TIMEOUT_MS = 30_000;

type DecoderBinaries = Parameters<typeof initializeWebWorker>[1];

let initialization: Promise<void> | null = null;

/**
 * Configure Babylon's KTX2 loader with the official local ES module decoder.
 * Browser builds transcode in workers; non-browser callers use the same module
 * on the current thread. No decoder resource is fetched from Babylon's CDN.
 */
export function ensureKTX2Decoder(): Promise<void> {
  if (!initialization) {
    initialization = initializeKTX2Decoder();
  }
  return initialization;
}

/** Share one load until it fails, so the next caller retries a transient failure. */
export function cacheUntilFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/**
 * Start one decoder worker for Babylon's KTX2 worker pool.
 *
 * The pool runs a queued decode only after its worker promise resolves, and
 * does not handle a rejection. A worker that failed to start would leave that
 * decode, and every later decode queued for its slot, waiting forever: the
 * texture would neither load nor report an error, so it would never fall back
 * to its source image. A failed or stalled start therefore resolves to a
 * stand-in that fails each decode at once. The slot is then freed as usual, so
 * a later decode tries a real worker again.
 */
export async function startDecoderWorker(
  createWorker: () => Worker,
  binaries: () => Promise<DecoderBinaries>,
  timeoutMs = WORKER_START_TIMEOUT_MS,
): Promise<Worker> {
  const started: { worker?: Worker } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const start = (async () => {
      started.worker = createWorker();
      return initializeWebWorker(started.worker, await binaries());
    })();
    start.catch(() => {}); // A start that loses the race below may still reject.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no init response within ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([start, timeout]);
  } catch (error) {
    started.worker?.terminate();
    console.warn("[KTX2] Decoder worker failed to start; KTX2 textures fall back to their source images", error);
    return unavailableDecoderWorker(error);
  } finally {
    clearTimeout(timer);
  }
}

/** Stands in for a worker that could not start: every decode fails, as a decode error would. */
function unavailableDecoderWorker(reason: unknown): Worker {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const msg = `KTX2 decoder worker unavailable: ${reason instanceof Error ? reason.message : String(reason)}`;
  const worker = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message: { action?: string } | undefined) {
      if (message?.action !== "decode") return;
      const event = { data: { action: "decoded", success: false, msg } } as MessageEvent;
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        }
      });
    },
    terminate() {
      listeners.clear();
    },
  };
  return worker as unknown as Worker;
}

async function initializeKTX2Decoder(): Promise<void> {
  const [decoderModule, mscModule, mscWasm, astcWasm, bc7Wasm, rgbaUnormWasm, rgbaSrgbWasm, r8Wasm, rg8Wasm, zstdWasm] =
    await Promise.all([
      import("@babylonjs/ktx2decoder"),
      import("@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js"),
      import("@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_astc.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_bc7.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_rgba8_unorm_v2.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_rgba8_srgb_v2.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_r8_unorm.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/uastc_rg8_unorm.wasm?url"),
      import("@babylonjs/ktx2decoder/wasm/zstddec.wasm?url"),
    ]);

  if (typeof Worker !== "function") {
    decoderModule.MSCTranscoder.JSModule = mscModule.default;
    decoderModule.MSCTranscoder.WasmModuleURL = mscWasm.default;
    decoderModule.LiteTranscoder_UASTC_ASTC.WasmModuleURL = astcWasm.default;
    decoderModule.LiteTranscoder_UASTC_BC7.WasmModuleURL = bc7Wasm.default;
    decoderModule.LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL = rgbaUnormWasm.default;
    decoderModule.LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL = rgbaSrgbWasm.default;
    decoderModule.LiteTranscoder_UASTC_R8_UNORM.WasmModuleURL = r8Wasm.default;
    decoderModule.LiteTranscoder_UASTC_RG8_UNORM.WasmModuleURL = rg8Wasm.default;
    decoderModule.ZSTDDecoder.WasmModuleURL = zstdWasm.default;
    decoderModule.MSCTranscoder.UseFromWorkerThread = false;
    decoderModule.WASMMemoryManager.LoadBinariesFromCurrentThread = true;
    (globalThis as typeof globalThis & { KTX2DECODER?: typeof decoderModule }).KTX2DECODER = decoderModule;
    KhronosTextureContainer2.DefaultNumWorkers = 0;
    return;
  }

  const wasmUrls = {
    wasmMSCTranscoder: mscWasm.default,
    wasmUASTCToASTC: astcWasm.default,
    wasmUASTCToBC7: bc7Wasm.default,
    wasmUASTCToRGBA_UNORM: rgbaUnormWasm.default,
    wasmUASTCToRGBA_SRGB: rgbaSrgbWasm.default,
    wasmUASTCToR8_UNORM: r8Wasm.default,
    wasmUASTCToRG8_UNORM: rg8Wasm.default,
    wasmZSTDDecoder: zstdWasm.default,
  };
  const wasmBinaries = cacheUntilFailure(() =>
    Promise.all(
      Object.entries(wasmUrls).map(async ([name, url]) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`KTX2 ${name} fetch failed: HTTP ${response.status}`);
        }
        return [name, await response.arrayBuffer()] as const;
      }),
    ).then((entries) => Object.fromEntries(entries)),
  );

  const workerCount = Math.max(1, KhronosTextureContainer2.DefaultNumWorkers);
  KhronosTextureContainer2.WorkerPool = new AutoReleaseWorkerPool(workerCount, () =>
    startDecoderWorker(
      () => new Worker(new URL("./KTX2DecoderWorker.ts", import.meta.url), { type: "module" }),
      wasmBinaries,
    ),
  );
}
