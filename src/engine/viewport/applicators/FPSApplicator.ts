/**
 * FPSApplicator - Apply viewport effects to FPS camera
 *
 * For FPS cameras, deltas are applied directly:
 * - Position offset: Added to camera position
 * - Rotation offset: Added to camera rotation (pitch/yaw/roll)
 * - FOV multiplier: Multiplied with base FOV
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ViewportDelta } from "../ViewportDelta";
import type { ViewportApplicator } from "./ViewportApplicator";

const DEG2RAD = Math.PI / 180;

export class FPSApplicator implements ViewportApplicator {
  readonly cameraType = "fps";

  apply(delta: ViewportDelta, camera: Camera, baseFOV: number): void {
    const fpsCamera = camera as FreeCamera;
    if (!fpsCamera.rotation) return;

    // Apply position offset
    // Transform offset from camera-local to world space
    const forward = fpsCamera.getDirection(new Vector3(0, 0, 1));
    const right = fpsCamera.getDirection(new Vector3(1, 0, 0));
    const up = new Vector3(0, 1, 0);

    // Position offset is in camera-local coords: x=right, y=up, z=forward
    const worldOffset = right
      .scale(delta.positionOffset.x)
      .add(up.scale(delta.positionOffset.y))
      .add(forward.scale(delta.positionOffset.z));

    fpsCamera.position.addInPlace(worldOffset);

    // Apply rotation offset (in degrees, convert to radians)
    // x = pitch, y = yaw, z = roll
    fpsCamera.rotation.x += delta.rotationOffset.x * DEG2RAD;
    fpsCamera.rotation.y += delta.rotationOffset.y * DEG2RAD;
    fpsCamera.rotation.z += delta.rotationOffset.z * DEG2RAD;

    // Apply FOV multiplier
    fpsCamera.fov = baseFOV * delta.fovMultiplier;
  }

  reset(camera: Camera, baseFOV: number): void {
    const fpsCamera = camera as FreeCamera;
    if (!fpsCamera.rotation) return;

    // Reset roll to zero (pitch/yaw are user-controlled)
    fpsCamera.rotation.z = 0;

    // Reset FOV
    fpsCamera.fov = baseFOV;
  }
}
