import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { installSceneMeshFilter } from "./SceneMeshCandidates";

Cvar.register("r_weapon_candidates", 1, {
  type: "int",
  min: 0,
  max: 1,
  persist: false,
  description: "Camera-layer filtering before first-person weapon mesh evaluation (0 for diagnostics)",
});

export function installWeaponCameraCandidates(
  scene: Scene,
  camera: Camera,
  enabled: () => boolean = () => Cvar.getBool("r_weapon_candidates"),
): () => void {
  return installSceneMeshFilter(scene, {
    camera,
    enabled,
    keep: (mesh, view) => (mesh.layerMask & view.layerMask) !== 0,
  });
}
