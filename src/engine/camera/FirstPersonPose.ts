/**
 * FirstPersonPose — put a camera behind someone's eyes.
 *
 * One frame of a first-person view: where the eye is, where it looks, and the
 * view effects over it (stride bob, landing dip, lean, speed FOV). Every view
 * behind another player's eyes writes the camera through here, and the effects
 * go on through the same applicator the local camera uses, so a watched screen
 * is built the way the player's own was.
 */

import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { FPSApplicator } from "../viewport/applicators/FPSApplicator";
import type { ViewportDelta } from "../viewport/ViewportDelta";

export interface FirstPersonPose {
  /** Eye position: the entity origin plus the view height, crouch included. */
  x: number;
  y: number;
  z: number;
  /** View angles in radians. */
  yaw: number;
  pitch: number;
  /** The view effects over the base pose, when there are any this frame. */
  effects?: ViewportDelta | null;
}

const applicator = new FPSApplicator();

/** Write `pose` into `camera`, with `baseFov` before the effects' FOV change. */
export function applyFirstPersonPose(camera: FreeCamera, pose: FirstPersonPose, baseFov: number): void {
  camera.position.set(pose.x, pose.y, pose.z);
  // Roll is only ever the effects': a roll left behind by another camera on
  // the same FreeCamera (the death tilt) would hold the view sideways.
  camera.rotation.set(pose.pitch, pose.yaw, 0);
  if (pose.effects) applicator.apply(pose.effects, camera, baseFov);
  else camera.fov = baseFov;
}

/** A pose with every coordinate defined, or null. */
export function finitePose<T extends FirstPersonPose>(pose: T | null | undefined): T | null {
  if (!pose) return null;
  const finite =
    Number.isFinite(pose.x) &&
    Number.isFinite(pose.y) &&
    Number.isFinite(pose.z) &&
    Number.isFinite(pose.yaw) &&
    Number.isFinite(pose.pitch);
  return finite ? pose : null;
}
