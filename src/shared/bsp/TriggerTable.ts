/**
 * TriggerTable — single source of truth for BSP trigger volumes
 * (teleporters and jumppads).
 *
 * Both the server (FPSMovementSubsystem → per-entity MovementProfile) and the
 * client (V2NetworkClient prediction) derive their trigger list from the SAME
 * BSP entity + model arrays via `extractTriggerVolumes`, so trigger evaluation
 * is identical on both sides — client-predicted, replay-idempotent, and exact
 * under demo re-simulation. Same design as PickupTable (see
 * docs/research/triggerbrushes-and-targets.md).
 *
 * Ground truth (Warsow FBSP maps, verified against wdm2/wdm7):
 *   trigger_teleport { model "*N", target "tX" } → misc_teleporter_dest
 *     { targetname "tX", origin, angle }
 *   trigger_push     { model "*N", target "X"  } → target_position
 *     { targetname "X", origin }
 * Triggers have NO origin — the volume is BSP submodel N's AABB.
 *
 * NOTE: destination entities are NOT always the "canonical" classname above.
 * A survey of all 38 shipping maps (v0.9.21) found mappers also point triggers
 * at `target_location` (wdm12/17/18/19, wbomb6, wda1, wdm11, wtutorial1) and at
 * Quake 3's `info_teleport_destination` (wbomb2, wctf1, wda4). The engine's
 * G_PickTarget resolves target→targetname to ANY entity and uses its origin, so
 * our classname filter is a safety allow-list (see DEST_CLASSNAMES), not an
 * engine rule — it must include every point-entity class used as a dest, or the
 * trigger is silently dropped and the pad/teleporter does nothing.
 */

export type TriggerType = "teleport" | "push";

export interface TriggerVolume {
  /** Stable index in BSP order over accepted triggers — identical on both sides. */
  id: number;
  type: TriggerType;
  /** Babylon-space AABB of the trigger submodel (Q3 mins/maxs, Y↔Z swapped). */
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  /** Babylon-space destination point (teleport exit / jumppad ballistic target). */
  dest: { x: number; y: number; z: number };
  /** Exit yaw in game radians (teleport only; from misc_teleporter_dest "angle"). */
  destYaw?: number;
}

/** Minimal BSP entity shape (matches BspLoader.BspEntity). */
interface BspEntityLike {
  classname: string;
  properties: Record<string, string>;
}

/** Minimal BSP submodel shape (matches BspLoader.BspModel). */
interface BspModelLike {
  mins: [number, number, number];
  maxs: [number, number, number];
}

/**
 * Point-entity classnames accepted as a trigger destination. Both trigger types
 * share one set: cross-type dests occur in real maps (a `trigger_push` aimed at
 * a `misc_teleporter_dest`, a `trigger_teleport` aimed at a `target_position`),
 * and the engine (G_PickTarget) never filters by classname at all. This list is
 * verified to cover every dest classname in the shipping map pack — extend it if
 * a new map introduces another (a dropped trigger warns via console).
 */
const DEST_CLASSNAMES: readonly string[] = [
  "target_position", // canonical jumppad / aim target
  "misc_teleporter_dest", // Warsow/QF teleport dest
  "info_teleport_destination", // Quake 3 teleport dest (wbomb2, wctf1, wda4)
  "target_location", // used as push/teleport dest in many Warsow maps
  "info_notnull", // generic Q3 target point
];

const TRIGGER_CLASSNAMES: Record<string, TriggerType> = {
  trigger_teleport: "teleport",
  trigger_push: "push",
};

/**
 * Convert a Q3 entity "angle" (yaw degrees, 0 = Q3 +X) to our game yaw
 * (radians; forward dir = (sin yaw, 0, cos yaw) in Babylon space — the same
 * convention WeaponSystem uses for fire direction).
 *
 * Derivation: Q3 forward (cosθ, sinθ, 0) → Babylon axis swap → (cosθ, 0, sinθ);
 * solving sin(yaw)=cosθ, cos(yaw)=sinθ gives yaw = π/2 − θ.
 * Result normalized to (−π, π]. Q3 special angles −1/−2 (up/down) don't apply
 * to yaw-only destinations and are treated as 0.
 *
 * ⚠ Verify empirically on wdm2's "t2" exit (angle −90) during T3/T4 — a sign
 * error here sends players out backwards (docs/research/triggerbrushes-and-targets.md §3.1).
 */
export function q3AngleToGameYaw(q3AngleDeg: number): number {
  const deg = q3AngleDeg === -1 || q3AngleDeg === -2 ? 0 : q3AngleDeg;
  let yaw = Math.PI / 2 - (deg * Math.PI) / 180;
  // Normalize to (−π, π]
  while (yaw <= -Math.PI) yaw += 2 * Math.PI;
  while (yaw > Math.PI) yaw -= 2 * Math.PI;
  return yaw;
}

/** Parse "*N" brush-model reference; returns −1 when not a valid submodel ref. */
function parseModelIndex(modelStr: string | undefined): number {
  if (!modelStr?.startsWith("*")) return -1;
  const idx = Number.parseInt(modelStr.slice(1), 10);
  return Number.isInteger(idx) && idx > 0 ? idx : -1; // *0 is worldspawn — never a trigger
}

/** Parse a Q3 "x y z" origin string into Babylon coords (Y↔Z swap). */
function parseOrigin(origin: string | undefined): { x: number; y: number; z: number } | null {
  if (!origin) return null;
  const [x, y, z] = origin.split(/\s+/).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y: z, z: y };
}

/**
 * Extract the ordered list of trigger volumes (teleporters + jumppads) from
 * BSP entities + submodels. Iterates in BSP order, resolves `target` →
 * `targetname`, converts everything to Babylon space, and assigns sequential
 * ids. Deterministic: identical input → identical output. Triggers with a
 * missing/invalid model or an unresolvable target are dropped with a warning
 * (fail closed — same policy as PickupTable).
 */
export function extractTriggerVolumes(entities: BspEntityLike[], models: BspModelLike[]): TriggerVolume[] {
  const out: TriggerVolume[] = [];
  let id = 0;

  for (const entity of entities) {
    const type = TRIGGER_CLASSNAMES[entity.classname];
    if (!type) continue;

    const modelIndex = parseModelIndex(entity.properties.model);
    if (modelIndex < 0 || modelIndex >= models.length) {
      console.warn(`[TriggerTable] ${entity.classname} has invalid model "${entity.properties.model}" — dropped`);
      continue;
    }

    const targetName = entity.properties.target;
    if (!targetName) {
      console.warn(`[TriggerTable] ${entity.classname} (*${modelIndex}) has no target — dropped`);
      continue;
    }

    // First matching destination in BSP order (Q3 picks randomly among
    // multiple matches; maps in practice have exactly one).
    const destEntity = entities.find(
      (e) => DEST_CLASSNAMES.includes(e.classname) && e.properties.targetname === targetName,
    );
    if (!destEntity) {
      console.warn(`[TriggerTable] ${entity.classname} (*${modelIndex}) target "${targetName}" unresolved — dropped`);
      continue;
    }

    const dest = parseOrigin(destEntity.properties.origin);
    if (!dest) {
      console.warn(`[TriggerTable] target "${targetName}" has invalid origin — dropped`);
      continue;
    }

    const model = models[modelIndex];
    const volume: TriggerVolume = {
      id: id++,
      type,
      // Per-axis relabel (x, z_q3→y, y_q3→z) keeps min < max on every axis.
      min: { x: model.mins[0], y: model.mins[2], z: model.mins[1] },
      max: { x: model.maxs[0], y: model.maxs[2], z: model.maxs[1] },
      dest,
    };

    if (type === "teleport") {
      volume.destYaw = q3AngleToGameYaw(Number(destEntity.properties.angle ?? "0") || 0);
    }

    out.push(volume);
  }

  return out;
}
