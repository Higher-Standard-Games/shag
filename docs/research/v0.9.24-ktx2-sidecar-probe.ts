/** Decode the reported assets locally; compare KTX2 row order with the source TGA. No GPU/network. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import * as decoderModule from "@babylonjs/ktx2decoder";
import { ingestPk3Dir } from "../../src/engine/loader/pk3/NodePk3";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { PK3TextureLoader } from "../../src/engine/loader/pk3/PK3TextureLoader";

const binary = (name: string) => new Uint8Array(readFileSync(`node_modules/@babylonjs/ktx2decoder/wasm/${name}`)).buffer;
// The installed wrapper is UMD, without an ES export. Evaluate that local file
// in this standalone Node probe (the browser build's bundler handles it there).
const requireLocal = createRequire(import.meta.url);
const mscPath = requireLocal.resolve("@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js");
decoderModule.MSCTranscoder.JSModule = new Function("require", "__dirname", `${readFileSync(mscPath, "utf8")}\nreturn MSC_TRANSCODER;`)(requireLocal, dirname(mscPath));
decoderModule.MSCTranscoder.WasmBinary = binary("msc_basis_transcoder.wasm");
decoderModule.MSCTranscoder.UseFromWorkerThread = false;
decoderModule.LiteTranscoder_UASTC_RGBA_UNORM.WasmBinary = binary("uastc_rgba8_unorm_v2.wasm");
decoderModule.LiteTranscoder_UASTC_RGBA_SRGB.WasmBinary = binary("uastc_rgba8_srgb_v2.wasm");
decoderModule.ZSTDDecoder.WasmModuleURL = "shag-local:zstd";
// This decoder version's ZSTD helper only accepts a fetch URL. Serve its bytes
// from disk and reject every other fetch; this probe never uses the network.
globalThis.fetch = async (input) => {
  if (String(input) === "shag-local:zstd") return new Response(binary("zstddec.wasm"));
  throw new Error(`Unexpected network request in local KTX2 probe: ${String(input)}`);
};
await ingestPk3Dir("public/data");
const decoder = new decoderModule.KTX2Decoder();
const parser = PK3TextureLoader.getInstance() as unknown as {
  parseTGA(bytes: ArrayBuffer, path: string): { pixels: Uint8Array; width: number; height: number } | null;
};
for (const name of ["treadplate", "treadplate_norm", "glow_halo_yellow"]) {
  const base = `textures/boqu/${name}`;
  const sourceBytes = await PK3Loader.getInstance().getFile(`${base}.tga`);
  if (!sourceBytes) throw new Error(`Missing local source ${base}.tga`);
  const source = parser.parseTGA(sourceBytes, `${base}.tga`);
  if (!source) throw new Error(`Invalid local TGA ${base}`);
  const decoded = await decoder.decode(new Uint8Array(readFileSync(`public/data/ktx2cache/${base}.ktx2`)), {}, { forceRGBA: true });
  if (decoded.errors) throw new Error(decoded.errors);
  const mip = decoded.mipmaps[0];
  if (!mip.data || mip.width !== source.width || mip.height !== source.height) throw new Error(`Size mismatch ${base}`);
  let same = 0;
  let flipped = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width * 4; x++) {
      same += Math.abs(source.pixels[y * source.width * 4 + x] - mip.data[y * source.width * 4 + x]);
      flipped += Math.abs(source.pixels[y * source.width * 4 + x] - mip.data[(source.height - 1 - y) * source.width * 4 + x]);
    }
  }
  console.log("KTX2_SIDECAR_PROBE", JSON.stringify({
    name: base, format: decoded.transcodedFormat, transcoder: decoded.transcoderName,
    mips: decoded.mipmaps.map(level => [level.width, level.height, level.data?.byteLength]),
    meanAbsoluteError: { sameRows: same / mip.data.length, flippedRows: flipped / mip.data.length },
  }));
  if (same >= flipped) throw new Error(`Source row-order check failed: ${base}`);
}
