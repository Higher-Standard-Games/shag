import recipe from "../../../config/player-model-vanguard.json";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

export const VANGUARD_PACKAGE = recipe.package;
export const VANGUARD_ROOT = recipe.root;
export const VANGUARD_MODEL = recipe.model;
export const VANGUARD_ANIMATIONS = recipe.animations;

/** Read a virtual player GLB, lazily mounting its indexed package through the mirror-aware loader. */
export async function readPlayerModelAsset(assetPath: string, optional = false): Promise<ArrayBuffer | null> {
  if (!assetPath.startsWith(VANGUARD_ROOT)) {
    const response = await fetch(assetPath);
    if (!response.ok) throw new Error(`Player asset ${assetPath}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const loader = PK3Loader.getInstance();
  const owner = PK3Index.getInstance().findFile(assetPath) ?? VANGUARD_PACKAGE;
  await loader.ensurePK3(owner);
  const bytes = await loader.getFile(assetPath);
  if (!bytes && !optional) throw new Error(`Player asset missing from PK3: ${assetPath}`);
  return bytes;
}

/** Preserve explicit URL/data-source callers while the default Vanguard path uses embedded GLB bytes. */
export async function resolvePlayerModelAsset(rootUrl: string, file: string, optional = false) {
  if (rootUrl !== VANGUARD_ROOT) return { source: file, options: { rootUrl } };
  const bytes = await readPlayerModelAsset(rootUrl + file, optional);
  if (!bytes) return null;
  return { source: new Uint8Array(bytes), options: { pluginExtension: ".glb", rootUrl: "" } };
}
