import fallbackUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.js?url";
import binaryUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.wasm?url";
import decoderUrl from "@babylonjs/core/assets/Draco/draco_wasm_wrapper_gltf.js?url";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";

// Serve the mesh decoder with the application, including offline installations.
DracoDecoder.DefaultConfiguration = { wasmUrl: decoderUrl, wasmBinaryUrl: binaryUrl, fallbackUrl };
