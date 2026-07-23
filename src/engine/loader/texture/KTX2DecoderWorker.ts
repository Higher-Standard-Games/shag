import { workerFunction } from "@babylonjs/core/Misc/khronosTextureContainer2Worker.js";
import * as KTX2Decoder from "@babylonjs/ktx2decoder";
import { MSCTranscoder } from "@babylonjs/ktx2decoder/Transcoders/mscTranscoder.js";
import mscTranscoderJsModule from "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js";

MSCTranscoder.JSModule = mscTranscoderJsModule;
workerFunction(KTX2Decoder);
