import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader.js";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2.js";
import { initializeWebWorker } from "@babylonjs/core/Misc/khronosTextureContainer2Worker.js";
import { AutoReleaseWorkerPool } from "@babylonjs/core/Misc/workerPool.js";

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
  const wasmBinaries = Promise.all(
    Object.entries(wasmUrls).map(async ([name, url]) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`KTX2 ${name} fetch failed: HTTP ${response.status}`);
      }
      return [name, await response.arrayBuffer()] as const;
    }),
  ).then((entries) => Object.fromEntries(entries));

  const workerCount = Math.max(1, KhronosTextureContainer2.DefaultNumWorkers);
  KhronosTextureContainer2.WorkerPool = new AutoReleaseWorkerPool(workerCount, async () => {
    const worker = new Worker(new URL("./KTX2DecoderWorker.ts", import.meta.url), { type: "module" });
    return initializeWebWorker(worker, await wasmBinaries);
  });
}
