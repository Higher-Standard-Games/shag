/**
 * CinematicCameraPaths — Phase 3 camera path generation
 *
 * Pure Vec3 math, no Babylon.js.  Computes concrete camera keyframes for
 * freefly segments, or returns entity IDs for chase-cam segments.
 */

import type { HighlightCandidate } from "./DemoAnalyzer";
import type { CameraPresetId } from "./SequenceBuilder";

// ── Exported types ────────────────────────────────────────────────────────────

export interface CameraKeyframe {
  tick: number;
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fov?: number; // degrees, default 90
}

export interface CameraPathResult {
  type: "chase" | "freefly";
  // chase:
  targetEntityId?: string;
  // freefly:
  keyframes?: CameraKeyframe[];
  interpolation?: "linear" | "catmull_rom";
}

// ── Internal Vec3 type ───────────────────────────────────────────────────────

type Vec3 = { x: number; y: number; z: number };

// ── Vec3 helpers (internal) ───────────────────────────────────────────────────

function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3Add(a, vec3Scale(vec3Sub(b, a), t));
}

function vec3Normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return vec3Scale(v, 1 / len);
}

function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vec3Distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Catmull-Rom between p1 and p2: a curve through every keyframe with no kink at any. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return {
    x: axis(p0.x, p1.x, p2.x, p3.x),
    y: axis(p0.y, p1.y, p2.y, p3.y),
    z: axis(p0.z, p1.z, p2.z, p3.z),
  };
}

// ── lerp helpers ─────────────────────────────────────────────────────────────

function lerpTick(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── generateCameraPath ────────────────────────────────────────────────────────

export function generateCameraPath(
  preset: CameraPresetId,
  highlight: HighlightCandidate,
  startTick: number,
  endTick: number,
  _tickRate: number,
): CameraPathResult {
  switch (preset) {
    case "chase_hero":
      return { type: "chase", targetEntityId: highlight.primaryPlayer };

    case "victim_pov":
      return {
        type: "chase",
        targetEntityId: highlight.victimPlayer ?? highlight.primaryPlayer,
      };

    case "orbit_kill":
      return _orbitKill(highlight, startTick, endTick);

    case "rocket_jump_hero":
      return _rocketJumpHero(highlight, startTick, endTick);

    case "dramatic_zoom":
      return _dramaticZoom(highlight, startTick, endTick);

    case "replay_orbit":
      return _replayOrbit(highlight, startTick, endTick);
  }
}

// ── Per-preset path generators ────────────────────────────────────────────────

function _orbitKill(highlight: HighlightCandidate, startTick: number, endTick: number): CameraPathResult {
  const killerPos: Vec3 = highlight.killerPos ?? { x: 0, y: 0, z: 0 };
  const victimPos: Vec3 = highlight.victimPos ?? { x: 200, y: 0, z: 0 };
  const midpoint: Vec3 = vec3Scale(vec3Add(killerPos, victimPos), 0.5);
  const dist = vec3Distance(killerPos, victimPos);
  const radius = Math.max(dist * 0.8, 200);
  const height = midpoint.y + 80;

  const keyframes: CameraKeyframe[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const angle = t * 270 * (Math.PI / 180);
    const tick = lerpTick(startTick, endTick, t);
    const pos: Vec3 = {
      x: midpoint.x + Math.cos(angle) * radius,
      y: height,
      z: midpoint.z + Math.sin(angle) * radius,
    };
    keyframes.push({ tick, position: pos, lookAt: { ...midpoint } });
  }

  return { type: "freefly", keyframes, interpolation: "catmull_rom" };
}

function _rocketJumpHero(highlight: HighlightCandidate, startTick: number, endTick: number): CameraPathResult {
  const killerPos: Vec3 = highlight.killerPos ?? { x: 0, y: 100, z: 0 };
  const apexPos: Vec3 = { ...killerPos, y: killerPos.y + 150 };

  const below: Vec3 = { x: killerPos.x, y: killerPos.y - 100, z: killerPos.z + 150 };
  const side: Vec3 = { x: killerPos.x + 200, y: killerPos.y + 60, z: killerPos.z };
  const behind: Vec3 = { x: apexPos.x - 100, y: apexPos.y + 80, z: apexPos.z + 100 };

  const keyframes: CameraKeyframe[] = [
    { tick: startTick, position: below, lookAt: { ...killerPos } },
    {
      tick: lerpTick(startTick, endTick, 0.5),
      position: side,
      lookAt: { ...killerPos, y: killerPos.y + 75 },
    },
    { tick: endTick, position: behind, lookAt: { ...apexPos } },
  ];

  return { type: "freefly", keyframes, interpolation: "catmull_rom" };
}

function _dramaticZoom(highlight: HighlightCandidate, startTick: number, endTick: number): CameraPathResult {
  const killerPos: Vec3 = highlight.killerPos ?? { x: 0, y: 0, z: 0 };
  const victimPos: Vec3 = highlight.victimPos ?? { x: 400, y: 0, z: 0 };
  const midpoint: Vec3 = vec3Scale(vec3Add(killerPos, victimPos), 0.5);

  const direction = vec3Normalize(vec3Sub(victimPos, killerPos));
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const perp = vec3Normalize(vec3Cross(direction, up));

  const widePos: Vec3 = {
    x: midpoint.x + perp.x * 400,
    y: midpoint.y + 200,
    z: midpoint.z + perp.z * 400,
  };
  const tightPos: Vec3 = {
    x: victimPos.x + perp.x * 80,
    y: victimPos.y + 40,
    z: victimPos.z + perp.z * 80,
  };

  const keyframes: CameraKeyframe[] = [
    { tick: startTick, position: { ...widePos }, lookAt: { ...midpoint }, fov: 90 },
    {
      tick: lerpTick(startTick, endTick, 0.7),
      position: vec3Lerp(widePos, tightPos, 0.7),
      lookAt: { ...victimPos },
      fov: 60,
    },
    { tick: endTick, position: { ...tightPos }, lookAt: { ...victimPos }, fov: 50 },
  ];

  return { type: "freefly", keyframes, interpolation: "linear" };
}

function _replayOrbit(highlight: HighlightCandidate, startTick: number, endTick: number): CameraPathResult {
  const center: Vec3 = highlight.killerPos ?? { x: 0, y: 0, z: 0 };
  const height = center.y + 60;
  const radius = 250;

  const keyframes: CameraKeyframe[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const angle = t * 270 * (Math.PI / 180);
    const tick = lerpTick(startTick, endTick, t);
    const pos: Vec3 = {
      x: center.x + Math.cos(angle) * radius,
      y: height,
      z: center.z + Math.sin(angle) * radius,
    };
    keyframes.push({ tick, position: pos, lookAt: { ...center } });
  }

  return { type: "freefly", keyframes, interpolation: "catmull_rom" };
}

// ── interpolatePath ───────────────────────────────────────────────────────────

export function interpolatePath(
  keyframes: CameraKeyframe[],
  tick: number,
  interpolation: CameraPathResult["interpolation"] = "linear",
): { position: Vec3; lookAt: Vec3; fov: number } {
  if (keyframes.length === 0) {
    return {
      position: { x: 0, y: 0, z: 0 },
      lookAt: { x: 0, y: 0, z: 0 },
      fov: 90,
    };
  }

  // Tick before first keyframe
  if (tick <= keyframes[0].tick) {
    const kf = keyframes[0];
    return { position: { ...kf.position }, lookAt: { ...kf.lookAt }, fov: kf.fov ?? 90 };
  }

  // Tick after last keyframe
  const last = keyframes[keyframes.length - 1];
  if (tick >= last.tick) {
    return { position: { ...last.position }, lookAt: { ...last.lookAt }, fov: last.fov ?? 90 };
  }

  // Find surrounding keyframes
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].tick <= tick) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const kfA = keyframes[lo];
  const kfB = keyframes[hi];
  const span = kfB.tick - kfA.tick;
  const t = span > 0 ? (tick - kfA.tick) / span : 0;

  const fovA = kfA.fov ?? 90;
  const fovB = kfB.fov ?? 90;

  const position =
    interpolation === "catmull_rom"
      ? catmullRom(
          keyframes[Math.max(0, lo - 1)].position,
          kfA.position,
          kfB.position,
          keyframes[Math.min(keyframes.length - 1, hi + 1)].position,
          t,
        )
      : vec3Lerp(kfA.position, kfB.position, t);
  return {
    position,
    lookAt: vec3Lerp(kfA.lookAt, kfB.lookAt, t),
    fov: fovA + (fovB - fovA) * t,
  };
}
