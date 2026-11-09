import animations from "../../../config/player-animations.json";
import selection from "../../../config/player-model.json";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

export const PLAYER_MODEL_PACKAGE = selection.package;
export const PLAYER_MODEL_ROOT = selection.root;
export const CARTEL_MODEL_ROOT = "models/players/cartel/";
export const RIOTKITTY_MODEL_ROOT = "models/players/riotkitty/";
export const ROBOT_MODEL_ROOT = "models/players/robot/";
export const FEMALE_MODEL_ROOT = "models/players/female/";
export const PLAYER_MODEL_FILE = selection.model;

/** The clips every body shares, retargeted at load. */
export const PLAYER_ANIMATION_PACKAGE = animations.package;
export const PLAYER_ANIMATION_ROOT = animations.root;
export const PLAYER_ANIMATIONS = animations.animations;

/** Packaged bodies: Draco-compressed, so the decoder comes before their bytes. */
const BODY_ROOTS = [PLAYER_MODEL_ROOT, FEMALE_MODEL_ROOT, ROBOT_MODEL_ROOT, CARTEL_MODEL_ROOT, RIOTKITTY_MODEL_ROOT];
const PACKAGED_ROOTS = [PLAYER_ANIMATION_ROOT, ...BODY_ROOTS];

/** Whether a body root is packaged, rather than a loose URL. */
export function isPackagedPlayerModelRoot(root: string): boolean {
  return BODY_ROOTS.includes(root);
}

/** Read a virtual player GLB, lazily mounting its indexed package through the mirror-aware loader. */
export async function readPlayerModelAsset(assetPath: string, optional = false): Promise<ArrayBuffer | null> {
  if (!PACKAGED_ROOTS.some((root) => assetPath.startsWith(root))) {
    const response = await fetch(assetPath);
    if (!response.ok) throw new Error(`Player asset ${assetPath}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const loader = PK3Loader.getInstance();
  const owner =
    PK3Index.getInstance().findFile(assetPath) ??
    (assetPath.startsWith(PLAYER_ANIMATION_ROOT) ? PLAYER_ANIMATION_PACKAGE : PLAYER_MODEL_PACKAGE);
  await loader.ensurePK3(owner);
  const bytes = await loader.getFile(assetPath);
  if (!bytes && !optional) throw new Error(`Player asset missing from PK3: ${assetPath}`);
  return bytes;
}

/** Preserve explicit URL/data-source callers while the packaged player path uses embedded GLB bytes. */
export async function resolvePlayerModelAsset(rootUrl: string, file: string, optional = false) {
  if (!PACKAGED_ROOTS.includes(rootUrl)) return { source: file, options: { rootUrl } };
  if (BODY_ROOTS.includes(rootUrl) && typeof window !== "undefined") await import("./PlayerModelDecoder");
  const bytes = await readPlayerModelAsset(rootUrl + file, optional);
  if (!bytes) return null;
  return { source: new Uint8Array(bytes), options: { pluginExtension: ".glb", rootUrl: "" } };
}
