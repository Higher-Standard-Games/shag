import type { NetworkCommand } from "../../../engine/network/protocol/BinaryProtocol";

export const KNOWN_BUTTON_MASK = 0xffff;

const HALF_PI = Math.PI / 2;
const MAX_WEAPON_SLOT = 9;

/** The movement fields shared by the server ingest path and client prediction. */
export interface SanitizedMovement {
  direction: { x: number; y: number; z: number };
  pitch: number;
  yaw: number;
  buttons: number;
}

/** A full sanitized usercmd (movement + inventory + ordering). */
export interface SanitizedCommand extends SanitizedMovement {
  weaponSlot: number;
  sequence: number;
}

export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let result = angle % twoPi;
  if (result > Math.PI) {
    result -= twoPi;
  } else if (result <= -Math.PI) {
    result += twoPi;
  }
  return result;
}

/**
 * Core clamp for the movement half of a usercmd. This is the single source of
 * truth the server (ingest) and client (prediction) both call, so predicted and
 * simulated states apply the *identical* transform and never diverge.
 *
 * Returns null to REJECT: a non-finite direction/pitch/yaw must never reach the
 * sim (a NaN yaw becomes a NaN fire ray → NaN projectile broadcast to everyone).
 * `buttons` is coerced rather than rejected — the bitwise mask turns any NaN/Inf
 * into 0 safely, so a junk button word can't sink an otherwise-valid command.
 */
export function sanitizeMovement(input: {
  direction?: { x: number; y: number; z: number };
  pitch?: number;
  yaw?: number;
  buttons?: number;
}): SanitizedMovement | null {
  const dx = input.direction?.x ?? 0;
  const dz = input.direction?.z ?? 0;
  const pitch = input.pitch ?? 0;
  const yaw = input.yaw ?? 0;

  if (!Number.isFinite(dx) || !Number.isFinite(dz) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
    return null;
  }

  // Direction magnitude carries no information (MovementProfile normalizes it),
  // so clamp |dir_xz| ≤ 1 as defense-in-depth against a speed hack via an
  // oversized wish vector, while leaving sub-unit (analog) input intact.
  const len = Math.hypot(dx, dz);
  const scale = len > 1 ? 1 / len : 1;

  return {
    direction: { x: dx * scale, y: 0, z: dz * scale },
    pitch: Math.max(-HALF_PI, Math.min(HALF_PI, pitch)),
    yaw: wrapAngle(yaw),
    buttons: (input.buttons ?? 0) & KNOWN_BUTTON_MASK,
  };
}

/**
 * Server ingest: sanitize a decoded wire command. Thin wrapper over
 * {@link sanitizeMovement} that also bounds the weapon slot and carries the
 * sequence. Returns null to drop the whole packet.
 */
export function sanitizeCommand(cmd: NetworkCommand): SanitizedCommand | null {
  const move = sanitizeMovement(cmd);
  if (!move) return null;

  return {
    ...move,
    // weaponSlot/seq are coerced, not rejected: `| 0` maps NaN/Inf → 0 safely.
    weaponSlot: Math.max(0, Math.min(MAX_WEAPON_SLOT, (cmd.weaponSlot ?? 0) | 0)),
    sequence: cmd.seq ?? 0,
  };
}

/**
 * Client prediction parity: apply the exact server clamp to local input, but
 * neutralize non-finite input to a zero movement instead of dropping it.
 *
 * (The server drops a non-finite packet and then repeats the last command; the
 * client can't cheaply "repeat last" inside prediction, so it predicts a zero
 * step. This only differs if the client actually produced a non-finite input —
 * which real keyboard/mouse/camera input never does — so the two stay in lockstep
 * in every real case while both refusing to predict/simulate NaN.)
 */
export function sanitizeMovementOrZero(input: {
  direction?: { x: number; y: number; z: number };
  pitch?: number;
  yaw?: number;
  buttons?: number;
}): SanitizedMovement {
  return (
    sanitizeMovement(input) ?? {
      direction: { x: 0, y: 0, z: 0 },
      pitch: 0,
      yaw: 0,
      buttons: 0,
    }
  );
}
