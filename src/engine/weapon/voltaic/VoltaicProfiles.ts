import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type VoltaicImpactKind = "none" | "world" | "player";

export interface VoltaicEffectSample {
  start: Vector3;
  end: Vector3;
  color: Color3;
  impactKind: VoltaicImpactKind;
  impactNormal?: Vector3;
  intensity?: number;
}

export const VOLTAIC_PART = {
  SHEATH: 0,
  CORE: 1,
  DOMINANT: 2,
  SECONDARY_A: 3,
  SECONDARY_B: 4,
  GHOST: 5,
  FORK_A: 6,
  FORK_B: 7,
  FORK_C: 8,
  FORK_D: 9,
} as const;

export const VOLTAIC_REMOTE_FADE_START = 0.15;
export const VOLTAIC_REMOTE_REMOVE_TIME = 0.21;
export const VOLTAIC_HERO_RELEASE_TIME = 0.05;

export function impactKindToFloat(kind: VoltaicImpactKind): number {
  if (kind === "world") return 1;
  if (kind === "player") return 2;
  return 0;
}

/** Small stable FNV-1a style hash used only to seed presentation. */
export function makeVoltaicSeed(key: string, activation: number): number {
  let hash = 0x811c9dc5;
  const input = `${key}:${activation}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 8191) + 1;
}
