/**
 * Field of view — the player's number, and what Babylon needs.
 *
 * `cl_fov` is stated the way Quake-family players expect it: horizontal degrees
 * at 16:9. Babylon's `camera.fov` is neither of those things — it is vertical,
 * in radians — so the two are not interchangeable and the conversion lives here
 * rather than being open-coded at each call site.
 *
 * The camera keeps Babylon's default vertical-fixed mode on purpose. Holding the
 * VERTICAL angle and letting horizontal follow the viewport is Hor+: an ultrawide
 * player sees more to the sides instead of having it cropped away, and nothing
 * has to recompute on resize.
 */

import { MovementVars } from "../movement/MovementVars";

/** The aspect `cl_fov` is quoted against. 16:9 is what the number means to a player. */
const REFERENCE_ASPECT = 16 / 9;

/** Horizontal degrees at 16:9 → the vertical radians Babylon wants. */
export function horizontalFovToVerticalRadians(horizontalDegrees: number): number {
  const halfHorizontal = (horizontalDegrees * Math.PI) / 360;
  return 2 * Math.atan(Math.tan(halfHorizontal) / REFERENCE_ASPECT);
}

/** Vertical radians → the horizontal degrees a player would recognise. */
export function verticalRadiansToHorizontalFov(verticalRadians: number): number {
  return (2 * Math.atan(Math.tan(verticalRadians / 2) * REFERENCE_ASPECT) * 180) / Math.PI;
}

/**
 * The current `cl_fov` as vertical radians, ready to use as a camera's base FOV.
 * Every viewport effect — ADS, speed, the wall-jump squeeze — multiplies this,
 * so they all scale with the player's choice without knowing about it.
 */
export function currentBaseFov(): number {
  return horizontalFovToVerticalRadians(MovementVars.getInstance().get("cl_fov"));
}
