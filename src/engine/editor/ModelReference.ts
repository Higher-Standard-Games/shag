import { PK3Index } from "../loader/pk3/PK3Index";
import type { PointEntity } from "./EditorDocument";

const MODEL_PATH = /^models\/[a-zA-Z0-9_./-]+\.(?:md3|glb|gltf|obj)$/i;

/** Paths are compiler VFS paths, never URLs or paths on the author's disk. */
export function validModelPath(path: string): boolean {
  return MODEL_PATH.test(path) && !path.split("/").includes("..") && !path.split("/").includes(".");
}

export function modelReferenceIssue(entity: PointEntity): string | null {
  if (entity.classname !== "misc_model") return null;
  const path = entity.keys.model ?? "";
  if (!validModelPath(path)) return "Set a models/... path to an MD3, GLB, glTF, or OBJ asset.";
  const scale = entity.keys.modelscale;
  if (scale !== undefined && (!Number.isFinite(Number(scale)) || Number(scale) <= 0)) {
    return "modelscale must be a positive number.";
  }
  const angle = entity.keys.angle;
  if (angle !== undefined && !Number.isFinite(Number(angle))) return "angle must be a finite number.";
  return null;
}

/** Browser-visible package paths; loose files can also be entered by hand. */
export function indexedModelPaths(index = PK3Index.getInstance()): string[] {
  return [
    ...new Set(
      index
        .findByPattern("models/*")
        .map(({ file }) => file)
        .filter(validModelPath),
    ),
  ].sort();
}
