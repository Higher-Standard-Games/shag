import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import type { PVSCuller } from "../loader/bsp/PVSCuller";
import { installSceneMeshFilter } from "./SceneMeshCandidates";

/** Mirrors the PVS view policy: a weapon-only camera does not add a world view. */
export function getSinglePvsCamera(scene: Scene): Camera | null {
  if (!scene.activeCameras?.length) {
    const camera = scene.activeCamera;
    return camera && (camera.layerMask & ~0x10000000) !== 0 ? camera : null;
  }
  let primary: Camera | null = null;
  for (const camera of scene.activeCameras) {
    if (!camera || (camera.layerMask & ~0x10000000) === 0) continue;
    if (primary) return null;
    primary = camera;
  }
  return primary;
}

/** Skip only PVS-owned hidden world meshes in the same single primary view. */
export function installPvsMeshCandidates(
  scene: Scene,
  culler: PVSCuller,
  view: () => Camera | null,
  enabled: () => boolean = () => true,
): () => void {
  return installSceneMeshFilter(scene, {
    enabled: (camera) => enabled() && culler.isEnabled() && camera === view() && camera === getSinglePvsCamera(scene),
    keep: (mesh) => !culler.canSkipCandidate(mesh),
  });
}
