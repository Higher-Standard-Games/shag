import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

/**
 * The FreeCamera a controller makes for itself when it is handed another kind
 * of camera, made once and reused on every later attach in the same scene.
 * Placed at `position` each time, as a new one would be.
 */
export function reusableFreeCamera(
  owned: FreeCamera | null,
  name: string,
  position: Vector3,
  scene: Scene,
): FreeCamera {
  if (owned && !owned.isDisposed() && owned.getScene() === scene) {
    owned.position.copyFrom(position);
    return owned;
  }
  return new FreeCamera(name, position.clone(), scene);
}
