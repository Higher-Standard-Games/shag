import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { installSceneMeshFilter } from "./SceneMeshCandidates";

Cvar.register(
  "r_weapon_candidates",
  typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent) ? 1 : 0,
  {
    type: "int",
    min: 0,
    max: 1,
    persist: false,
    description: "WebGL camera-layer filtering before first-person weapon mesh evaluation (default on in Firefox)",
  },
);

export function installWeaponCameraCandidates(
  scene: Scene,
  camera: Camera,
  enabled: () => boolean = () => Cvar.getBool("r_weapon_candidates") && !scene.getEngine().isWebGPU,
): () => void {
  return installSceneMeshFilter(scene, {
    camera,
    enabled,
    keep: (mesh, view) => (mesh.layerMask & view.layerMask) !== 0,
  });
}
