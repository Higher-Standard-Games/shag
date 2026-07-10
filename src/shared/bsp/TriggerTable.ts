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

/** Classnames accepted as a destination for each trigger type (Q3 allows several). */
const DEST_CLASSNAMES: Record<TriggerType, string[]> = {
  teleport: ["misc_teleporter_dest", "target_position", "info_notnull"],
  push: ["target_position", "info_notnull", "misc_teleporter_dest"],
};

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
  if (!modelStr || !modelStr.startsWith("*")) return -1;
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
      (e) => DEST_CLASSNAMES[type].includes(e.classname) && e.properties.targetname === targetName,
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
