/**
 * The 3D pane's flycam: a pose in Quake space, the math that moves it, and a
 * controller for mouse look, free look, held fly keys and the wheel. The
 * controller only changes the pose; the session puts it on a Babylon camera.
 */

import type { Vec3q } from "./EditorDocument";

/** Position in Quake units; yaw in degrees counter-clockwise from +X; pitch in degrees, positive looking up. */
export interface FlyPose {
  position: Vec3q;
  yaw: number;
  pitch: number;
}

export const MAX_PITCH = 89;
/** Degrees of look per pixel of mouse movement. */
export const LOOK_SENSITIVITY = 0.2;
/** Quake units per second; Shift flies three times faster. */
export const FLY_SPEED = 400;
export const FAST_FACTOR = 3;
/** Quake units per wheel notch. */
export const WHEEL_STEP = 64;

const RAD = Math.PI / 180;

export function forwardOf(pose: FlyPose): Vec3q {
  const yaw = pose.yaw * RAD;
  const pitch = pose.pitch * RAD;
  return { x: Math.cos(pitch) * Math.cos(yaw), y: Math.cos(pitch) * Math.sin(yaw), z: Math.sin(pitch) };
}

/** The horizontal right-hand direction for the pose's yaw. */
export function rightOf(pose: FlyPose): Vec3q {
  const yaw = pose.yaw * RAD;
  return { x: Math.sin(yaw), y: -Math.cos(yaw), z: 0 };
}

const wrapYaw = (yaw: number): number => ((yaw % 360) + 360) % 360;

/** A pose looking along `direction` from `position`. */
export function poseLookingAlong(position: Vec3q, direction: Vec3q): FlyPose {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const pitch = Math.asin(Math.max(-1, Math.min(1, direction.z / length))) / RAD;
  const yaw = Math.hypot(direction.x, direction.y) < 1e-9 ? 0 : Math.atan2(direction.y, direction.x) / RAD;
  return { position: { ...position }, yaw: wrapYaw(yaw), pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)) };
}

/** Mouse movement in pixels to a new look direction: right turns right, down looks down. */
export function look(pose: FlyPose, dx: number, dy: number, sensitivity = LOOK_SENSITIVITY): FlyPose {
  return {
    position: { ...pose.position },
    yaw: wrapYaw(pose.yaw - dx * sensitivity),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pose.pitch - dy * sensitivity)),
  };
}

/**
 * Moves `distance` units: forward along the view, strafe along the
 * horizontal right, up along world Z. A diagonal is no faster than a
 * straight line.
 */
export function fly(pose: FlyPose, input: { forward: number; strafe: number; up: number }, distance: number): FlyPose {
  const f = forwardOf(pose);
  const r = rightOf(pose);
  const move = {
    x: f.x * input.forward + r.x * input.strafe,
    y: f.y * input.forward + r.y * input.strafe,
    z: f.z * input.forward + input.up,
  };
  const length = Math.hypot(move.x, move.y, move.z);
  if (length < 1e-9) return { ...pose, position: { ...pose.position } };
  const scale = distance / length;
  return {
    ...pose,
    position: {
      x: pose.position.x + move.x * scale,
      y: pose.position.y + move.y * scale,
      z: pose.position.z + move.z * scale,
    },
  };
}

/** Keeps the look direction and backs off from `center` until a box of `size` fits a view of half-angle `halfFov`. */
export function framePose(pose: FlyPose, center: Vec3q, size: Vec3q, halfFov: number): FlyPose {
  const distance = Math.max(32, Math.min(20_000, (Math.hypot(size.x, size.y, size.z) * 0.6) / Math.sin(halfFov)));
  const f = forwardOf(pose);
  return {
    ...pose,
    position: { x: center.x - f.x * distance, y: center.y - f.y * distance, z: center.z - f.z * distance },
  };
}

/**
 * The pose an orbit camera (Babylon ArcRotateCamera alpha, beta, radius
 * around a Quake-space target) was viewing from: same eye, looking at the
 * target. Converts views saved before the flycam.
 */
export function poseFromOrbit(alpha: number, beta: number, radius: number, target: Vec3q): FlyPose {
  // Babylon's orbit offset (cosα·sinβ, cosβ, sinα·sinβ) in Y-up, with Y and Z swapped into Quake.
  const offset = {
    x: Math.cos(alpha) * Math.sin(beta) * radius,
    y: Math.sin(alpha) * Math.sin(beta) * radius,
    z: Math.cos(beta) * radius,
  };
  const eye = { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z };
  return poseLookingAlong(eye, { x: -offset.x, y: -offset.y, z: -offset.z });
}

/** The editor's starting view: the old default orbit, from above and to the side of the origin. */
export const DEFAULT_POSE: FlyPose = poseFromOrbit(Math.PI / 4, Math.PI / 3, 650, { x: 0, y: 0, z: 0 });

export interface FlyCameraHost {
  /** Receives the 3D pane's pointer and wheel events. */
  element: HTMLElement;
  /** Whether a pointer event is over the 3D pane. */
  isOver(event: MouseEvent): boolean;
  getPose(): FlyPose;
  setPose(pose: FlyPose): void;
  /** A right click (no drag) outside free look: the editor deselects. */
  onRightClick(): void;
  /** Aborting it removes every listener. */
  signal: AbortSignal;
}

const FLY_KEYS = new Set(["w", "a", "s", "d", " ", "c"]);
/** Pointer travel, in pixels, below which a middle/right press is a click, not a drag. */
const CLICK_SLOP = 4;

/**
 * Mouse look on a middle or right drag. A middle click toggles free look
 * (pointer captured, every movement looks); a right click leaves free look,
 * or otherwise tells the host to deselect. Fly keys act while the
 * pointer is over the 3D pane or in free look; leaving the pane, losing
 * focus or a key release stops them, so the camera never drifts on.
 */
export class FlyCameraController {
  private readonly held = new Set<string>();
  private hovering = false;
  private freeLook = false;
  private drag: { button: number; x: number; y: number; travel: number } | null = null;
  private fast = false;

  constructor(private readonly host: FlyCameraHost) {
    const options = { signal: host.signal };
    const { element } = host;
    element.addEventListener("pointerdown", (event) => this.pointerDown(event), options);
    window.addEventListener("pointermove", (event) => this.pointerMove(event), options);
    window.addEventListener("pointerup", (event) => this.pointerUp(event), options);
    element.addEventListener("pointerleave", () => this.setHovering(false), options);
    element.addEventListener("wheel", (event) => this.wheel(event), { ...options, passive: false });
    element.addEventListener("auxclick", (event) => event.preventDefault(), options);
    window.addEventListener("blur", () => this.release(), options);
    document.addEventListener(
      "pointerlockchange",
      () => {
        if (this.freeLook && document.pointerLockElement !== element) this.setFreeLook(false);
      },
      options,
    );
  }

  get isFreeLook(): boolean {
    return this.freeLook;
  }

  /** Whether fly keys currently drive the camera. */
  get active(): boolean {
    return this.hovering || this.freeLook;
  }

  /** A keydown the session hasn't sent to an input; true when it was a fly key (or Escape leaving free look). */
  keyDown(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if (key === "escape" && this.freeLook) {
      this.setFreeLook(false);
      return true;
    }
    this.fast = event.shiftKey;
    if (!this.active || event.ctrlKey || event.metaKey || event.altKey || !FLY_KEYS.has(key)) return false;
    event.preventDefault();
    this.held.add(key);
    return true;
  }

  keyUp(event: KeyboardEvent): void {
    this.fast = event.shiftKey;
    this.held.delete(event.key.toLowerCase());
  }

  /** Advances held-key movement by `seconds` (clamped, so a stalled frame doesn't jump the camera). */
  step(seconds: number): void {
    if (!this.held.size) return;
    const axis = (plus: string, minus: string) => Number(this.held.has(plus)) - Number(this.held.has(minus));
    const input = { forward: axis("w", "s"), strafe: axis("d", "a"), up: axis(" ", "c") };
    if (!input.forward && !input.strafe && !input.up) return;
    const distance = FLY_SPEED * (this.fast ? FAST_FACTOR : 1) * Math.min(Math.max(seconds, 0), 0.1);
    this.host.setPose(fly(this.host.getPose(), input, distance));
  }

  private pointerDown(event: PointerEvent): void {
    if ((event.button !== 1 && event.button !== 2) || !this.host.isOver(event)) return;
    event.preventDefault(); // no middle-button autoscroll
    this.drag = { button: event.button, x: event.clientX, y: event.clientY, travel: 0 };
  }

  private pointerMove(event: PointerEvent): void {
    if (this.freeLook) {
      const dx = event.movementX ?? 0;
      const dy = event.movementY ?? 0;
      if (dx || dy) this.host.setPose(look(this.host.getPose(), dx, dy));
      return;
    }
    if (this.drag) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.drag.travel += Math.hypot(dx, dy);
      if (this.drag.travel > CLICK_SLOP && (dx || dy)) this.host.setPose(look(this.host.getPose(), dx, dy));
      return;
    }
    if (event.target === this.host.element || this.hovering) this.setHovering(this.host.isOver(event));
  }

  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.button !== drag.button) return;
    this.drag = null;
    if (drag.travel > CLICK_SLOP) return;
    if (drag.button === 1) this.setFreeLook(!this.freeLook);
    else if (this.freeLook) this.setFreeLook(false);
    else this.host.onRightClick();
  }

  private wheel(event: WheelEvent): void {
    if (!this.host.isOver(event) || !event.deltaY) return;
    event.preventDefault();
    const distance = WHEEL_STEP * (event.shiftKey ? FAST_FACTOR : 1);
    this.host.setPose(fly(this.host.getPose(), { forward: -Math.sign(event.deltaY), strafe: 0, up: 0 }, distance));
  }

  private setHovering(hovering: boolean): void {
    this.hovering = hovering;
    if (!this.active) this.held.clear();
  }

  private setFreeLook(on: boolean): void {
    this.freeLook = on;
    if (on) {
      this.host.element.requestPointerLock?.();
    } else {
      if (document.pointerLockElement === this.host.element) document.exitPointerLock?.();
      if (!this.hovering) this.held.clear();
    }
  }

  private release(): void {
    this.held.clear();
    this.drag = null;
    this.fast = false;
  }
}
