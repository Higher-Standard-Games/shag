import { workerFunction } from "@babylonjs/core/Misc/khronosTextureContainer2Worker.js";
import * as KTX2Decoder from "@babylonjs/ktx2decoder";
import { MSCTranscoder } from "@babylonjs/ktx2decoder/Transcoders/mscTranscoder.js";
import mscTranscoderJsModule from "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js";
import zstdWasmUrl from "@babylonjs/ktx2decoder/wasm/zstddec.wasm?url";

MSCTranscoder.JSModule = mscTranscoderJsModule;
// Babylon 9.17's ZSTD helper ignores the WasmBinary supplied at worker init
// and fetches WasmModuleURL itself. Keep that request on the local asset host.
KTX2Decoder.ZSTDDecoder.WasmModuleURL = zstdWasmUrl;
workerFunction(KTX2Decoder);
