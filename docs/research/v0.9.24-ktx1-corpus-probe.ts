/** Parse installed KTX1 assets through the shared PK3 index. No GPU evidence. */
import { ingestPk3Dir } from "../../src/engine/loader/pk3/NodePk3";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { parseKTX1 } from "../../src/engine/loader/texture/KTX1Loader";

const packages = await ingestPk3Dir("public/data");
const loader = PK3Loader.getInstance();
const files = loader.listFiles("*.ktx");
const formats: Record<string, number> = {};
const errors: { path: string; message: string }[] = [];
const unsupported: string[] = [];
let valid = 0;
let incompleteRawMipChains = 0;
for (const path of files) {
  try {
    const data = await loader.getFile(path);
    if (!data) throw new Error("Indexed file missing");
    const parsed = parseKTX1(data);
    formats[parsed.formatName] = (formats[parsed.formatName] ?? 0) + 1;
    if (!parsed.isCompressed && parsed.mipLevels.length < Math.max(1, parsed.header.numberOfMipmapLevels)) incompleteRawMipChains++;
    valid++;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("non-array 2D")) unsupported.push(path);
    else errors.push({ path, message });
  }
}
console.log("KTX1_CORPUS", JSON.stringify({ packages, total: files.length, valid, incompleteRawMipChains, formats, unsupported, errors }, null, 2));
if (errors.length || !files.length) process.exitCode = 1;
