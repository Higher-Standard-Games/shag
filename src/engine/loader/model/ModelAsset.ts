import { PK3Index } from "../pk3/PK3Index";
import { PK3Loader } from "../pk3/PK3Loader";

/** Indexed model directories do not require loose optional attachment sidecars. */
export function isIndexedModelDirectory(path: string): boolean {
  if (/^(?:https?:|blob:|data:)/i.test(path)) return false;
  const directory = path
    .replace(/\\/g, "/")
    .replace(/^\/?data\//i, "")
    .replace(/^\/+/, "");
  if (!directory) return false;
  return PK3Index.getInstance().findByPattern(`${directory.endsWith("/") ? directory : `${directory}/`}*`).length > 0;
}

/** Read an indexed model or sidecar, respecting replacement package ownership. */
export async function readIndexedModelAsset(path: string): Promise<ArrayBuffer | null> {
  if (/^(?:https?:|blob:|data:)/i.test(path)) return null;
  const asset = path
    .replace(/\\/g, "/")
    .replace(/^\/?data\//i, "")
    .replace(/^\/+/, "");
  const loader = PK3Loader.getInstance();
  const owner = PK3Index.getInstance().findFile(asset);
  if (!owner) return null;
  await loader.ensurePK3(owner);
  const bytes = await loader.getFile(asset);
  if (!bytes) throw new Error(`Model asset missing from indexed package ${owner}: ${asset}`);
  return bytes;
}

/** Embedded GLBs use PK3 bytes; unindexed/custom model URLs keep normal loading. */
export async function resolveModelAsset(path: string) {
  if (/\.glb$/i.test(path)) {
    const bytes = await readIndexedModelAsset(path);
    if (bytes) return { source: new Uint8Array(bytes), options: { pluginExtension: ".glb", rootUrl: "" } };
  }
  const slash = path.lastIndexOf("/");
  return { source: path.substring(slash + 1), options: { rootUrl: path.substring(0, slash + 1) } };
}
