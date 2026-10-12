import recipe from "../../../config/player-model-vanguard.json";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

export const VANGUARD_PACKAGE = recipe.package;
export const VANGUARD_ROOT = recipe.root;
export const VANGUARD_MODEL = recipe.model;
export const VANGUARD_ANIMATIONS = recipe.animations;

// Live players and teleport ghosts can start together. Share only the archive
// download, never containers or animation groups owned by separate managers.
const downloads = new WeakMap<PK3Loader, Map<string, Promise<void>>>();

/** Read a virtual player GLB, lazily mounting its indexed package through the mirror-aware loader. */
export async function readPlayerModelAsset(assetPath: string, optional = false): Promise<ArrayBuffer | null> {
  if (!assetPath.startsWith(VANGUARD_ROOT)) {
    const response = await fetch(assetPath);
    if (!response.ok) throw new Error(`Player asset ${assetPath}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const loader = PK3Loader.getInstance();
  const owner = PK3Index.getInstance().findFile(assetPath) ?? VANGUARD_PACKAGE;
  // Check the indexed owner even if an older mounted package has this path.
  // Replacement packages must not silently keep reading the base model.
  if (!loader.getPackageInfo().some((pkg) => pkg.filename === owner)) {
    let pending = downloads.get(loader);
    if (!pending) {
      pending = new Map();
      downloads.set(loader, pending);
    }
    let download = pending.get(owner);
    if (!download) {
      download = loader.loadPK3(owner).finally(() => pending!.delete(owner));
      pending.set(owner, download);
    }
    await download;
  }
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
