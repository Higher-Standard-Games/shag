/**
 * Generators that expand to ordinary brushes and entities. The document keeps
 * no generator state: a human can edit every part afterwards. Part IDs derive
 * from the generator's ID, so the same call always yields the same document.
 */
import type { BoxBrush, FaceKey, PointEntity, Vec3q } from "../EditorDocument";

type Axis = keyof Vec3q;

/** An opening in one side of a room; the side's own axis in min/max is ignored. */
export interface RoomOpening {
  side: FaceKey;
  min: Vec3q;
  max: Vec3q;
}

export interface RoomSpec {
  id: string;
  /** Interior space: min.z is the floor surface players stand on. */
  min: Vec3q;
  max: Vec3q;
  /** Wall, floor and ceiling thickness. Default 16. */
  wall?: number;
  shader?: string;
  floorShader?: string;
  ceilingShader?: string;
  openings?: RoomOpening[];
  /** Light entity intensity at the ceiling centre; false for none. Default 300. */
  light?: number | false;
}

export interface CorridorSpec {
  id: string;
  /** Floor centre at each end. Must differ along exactly one of x or y, at the same z. */
  from: Vec3q;
  to: Vec3q;
  /** Interior width and height. Defaults 128 and 128. */
  width?: number;
  height?: number;
  wall?: number;
  shader?: string;
  /** Default 200; false for none. */
  light?: number | false;
}

export interface Generated {
  brushes: BoxBrush[];
  entities: PointEntity[];
}

/**
 * The shader a brush gets when nobody names one: caulk, as in NetRadiant. It
 * seals and collides but is never drawn, so a mapper textures only the faces a
 * player can see.
 */
export const DEFAULT_SHADER = "common/caulk";

/** The two in-plane axes of each side, and the normal axis. */
const SIDE_AXES: Record<FaceKey, { normal: Axis; u: Axis; v: Axis }> = {
  "+X": { normal: "x", u: "y", v: "z" },
  "-X": { normal: "x", u: "y", v: "z" },
  "+Y": { normal: "y", u: "x", v: "z" },
  "-Y": { normal: "y", u: "x", v: "z" },
  "+Z": { normal: "z", u: "x", v: "y" },
  "-Z": { normal: "z", u: "x", v: "y" },
};

const SIDE_NAMES: Record<FaceKey, string> = {
  "+X": "east",
  "-X": "west",
  "+Y": "north",
  "-Y": "south",
  "+Z": "ceiling",
  "-Z": "floor",
};

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function generateRoom(spec: RoomSpec): Generated {
  const { id, min, max } = spec;
  if (!id) throw new Error("gen.room needs an id");
  const t = positive(spec.wall ?? 16, "wall");
  for (const axis of ["x", "y", "z"] as const) {
    if (!(min?.[axis] < max?.[axis])) throw new Error(`interior ${axis}: min must be below max`);
  }
  const shader = spec.shader ?? DEFAULT_SHADER;
  // Floor and ceiling cover the corners; east/west walls run the full outer
  // depth; north/south fit between them. Every seam is face-to-face.
  const slabs: Record<FaceKey, { min: Vec3q; max: Vec3q; shader: string }> = {
    "-Z": {
      min: { x: min.x - t, y: min.y - t, z: min.z - t },
      max: { x: max.x + t, y: max.y + t, z: min.z },
      shader: spec.floorShader ?? shader,
    },
    "+Z": {
      min: { x: min.x - t, y: min.y - t, z: max.z },
      max: { x: max.x + t, y: max.y + t, z: max.z + t },
      shader: spec.ceilingShader ?? shader,
    },
    "-X": { min: { x: min.x - t, y: min.y - t, z: min.z }, max: { x: min.x, y: max.y + t, z: max.z }, shader },
    "+X": { min: { x: max.x, y: min.y - t, z: min.z }, max: { x: max.x + t, y: max.y + t, z: max.z }, shader },
    "-Y": { min: { x: min.x, y: min.y - t, z: min.z }, max: { x: max.x, y: min.y, z: max.z }, shader },
    "+Y": { min: { x: min.x, y: max.y, z: min.z }, max: { x: max.x, y: max.y + t, z: max.z }, shader },
  };
  const brushes: BoxBrush[] = [];
  for (const side of ["-Z", "+Z", "-X", "+X", "-Y", "+Y"] as FaceKey[]) {
    const slab = slabs[side];
    const holes = (spec.openings ?? []).filter((o) => o.side === side);
    let pieces = [{ min: slab.min, max: slab.max }];
    for (const hole of holes) pieces = pieces.flatMap((piece) => cut(piece, hole, spec, side));
    pieces.forEach((piece, index) => {
      const suffix = pieces.length === 1 && holes.length === 0 ? "" : `-${index + 1}`;
      brushes.push({ id: `${id}-${SIDE_NAMES[side]}${suffix}`, min: piece.min, max: piece.max, shader: slab.shader });
    });
  }
  const entities: PointEntity[] = [];
  const light = spec.light ?? 300;
  if (light !== false) {
    const z = Math.max(min.z + (max.z - min.z) / 2, max.z - 32);
    entities.push({
      id: `${id}-light`,
      classname: "light",
      origin: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z },
      keys: { light: String(positive(light, "light")) },
    });
  }
  return { brushes, entities };
}

/** Pieces of a slab around one opening. The opening must lie inside the interior span. */
function cut(piece: { min: Vec3q; max: Vec3q }, hole: RoomOpening, room: RoomSpec, side: FaceKey) {
  const { u, v } = SIDE_AXES[side];
  for (const axis of [u, v]) {
    if (!(hole.min?.[axis] < hole.max?.[axis])) throw new Error(`opening on ${side}: ${axis} min must be below max`);
    if (hole.min[axis] < room.min[axis] || hole.max[axis] > room.max[axis]) {
      throw new Error(
        `opening on ${side} must stay inside the interior on ${axis} (${room.min[axis]}..${room.max[axis]}), so corners stay sealed`,
      );
    }
  }
  const lo = (axis: Axis) => Math.max(piece.min[axis], hole.min[axis]);
  const hi = (axis: Axis) => Math.min(piece.max[axis], hole.max[axis]);
  if (lo(u) >= hi(u) || lo(v) >= hi(v)) return [piece];
  const out: Array<{ min: Vec3q; max: Vec3q }> = [];
  const push = (min: Vec3q, max: Vec3q) => {
    if (min.x < max.x && min.y < max.y && min.z < max.z) out.push({ min, max });
  };
  const at = (base: Vec3q, changes: Partial<Vec3q>): Vec3q => ({ ...base, ...changes });
  // Full-height strips either side of the hole along u, then the parts above and below it.
  push(piece.min, at(piece.max, { [u]: lo(u) }));
  push(at(piece.min, { [u]: hi(u) }), piece.max);
  push(at(piece.min, { [u]: lo(u) }), at(piece.max, { [u]: hi(u), [v]: lo(v) }));
  push(at(piece.min, { [u]: lo(u), [v]: hi(v) }), at(piece.max, { [u]: hi(u) }));
  return out;
}

export function generateCorridor(spec: CorridorSpec): Generated {
  const { id, from, to } = spec;
  if (!id) throw new Error("gen.corridor needs an id");
  if (from?.z !== to?.z) throw new Error("corridor ends must be at the same z (use stairs between levels)");
  const along: Axis | null = from.x !== to.x && from.y === to.y ? "x" : from.y !== to.y && from.x === to.x ? "y" : null;
  if (!along) throw new Error("corridor must run along exactly one of x or y");
  const across: Axis = along === "x" ? "y" : "x";
  const width = positive(spec.width ?? 128, "width");
  const height = positive(spec.height ?? 128, "height");
  const min = { x: 0, y: 0, z: from.z };
  const max = { x: 0, y: 0, z: from.z + height };
  min[along] = Math.min(from[along], to[along]);
  max[along] = Math.max(from[along], to[along]);
  min[across] = from[across] - width / 2;
  max[across] = from[across] + width / 2;
  const ends: FaceKey[] = along === "x" ? ["-X", "+X"] : ["-Y", "+Y"];
  const room = generateRoom({
    id,
    min,
    max,
    wall: spec.wall,
    shader: spec.shader,
    light: spec.light ?? 200,
    openings: ends.map((side) => ({ side, min, max })),
  });
  // Open ends meet a room's outer wall face to face: nothing may reach past
  // them into the wall it joins.
  // The end walls' corner columns become empty here and are dropped: the
  // joined room's wall seals that corner.
  for (const brush of room.brushes) {
    brush.min[along] = Math.max(brush.min[along], min[along]);
    brush.max[along] = Math.min(brush.max[along], max[along]);
  }
  room.brushes = room.brushes.filter((brush) => brush.min[along] < brush.max[along]);
  return room;
}

export interface ConnectSpec {
  id: string;
  /** Interiors of the two rooms, as given to gen.room. Their floors must be at the same z. */
  from: { min: Vec3q; max: Vec3q };
  to: { min: Vec3q; max: Vec3q };
  /** Interior width and height. Defaults 128 and 128. */
  width?: number;
  height?: number;
  /** Corridor wall thickness. Default 16. */
  wall?: number;
  /** Centre of the corridor across its direction. Default: the middle of the rooms' shared span. */
  offset?: number;
  shader?: string;
  /** Default 200; false for none. */
  light?: number | false;
}

/**
 * A corridor between two rooms that face each other along x or y. The caller
 * first carves `carve` out of the existing brushes (both rooms' walls and
 * anything between), then adds `brushes`: the corridor fills that cut exactly,
 * leaving a doorway into each room, so the join is sealed whatever the rooms'
 * wall thickness.
 */
export function generateConnect(spec: ConnectSpec): Generated & { carve: { min: Vec3q; max: Vec3q } } {
  const { id, from: a, to: b } = spec;
  if (!id) throw new Error("gen.connect needs an id");
  if (a?.min?.z !== b?.min?.z)
    throw new Error("the rooms' floors (min.z) differ; join different heights with gen.stairs inside a room");
  const width = positive(spec.width ?? 128, "width");
  const height = positive(spec.height ?? 128, "height");
  const t = positive(spec.wall ?? 16, "wall");
  let along: Axis;
  if (a.max.x <= b.min.x || b.max.x <= a.min.x) along = "x";
  else if (a.max.y <= b.min.y || b.max.y <= a.min.y) along = "y";
  else throw new Error("the rooms overlap; they must be apart along x or y");
  const across: Axis = along === "x" ? "y" : "x";
  const [first, second] = a.max[along] <= b.min[along] ? [a, b] : [b, a];
  const shared = [Math.max(a.min[across], b.min[across]), Math.min(a.max[across], b.max[across])];
  const centre = spec.offset ?? (shared[0] + shared[1]) / 2;
  const half = width / 2 + t;
  if (centre - half < shared[0] || centre + half > shared[1]) {
    throw new Error(
      `a ${width}-wide corridor with ${t}-unit walls needs ${2 * half} units of the rooms' shared ${across} span (${shared[0]}..${shared[1]}) around ${centre}`,
    );
  }
  const floor = a.min.z;
  if (floor + height > Math.min(a.max.z, b.max.z))
    throw new Error(`corridor height ${height} is taller than the lower room`);
  const start = first.max[along];
  const end = second.min[along];
  const box = (lo: Partial<Vec3q>, hi: Partial<Vec3q>): { min: Vec3q; max: Vec3q } => {
    const min = { x: 0, y: 0, z: 0, ...lo };
    const max = { x: 0, y: 0, z: 0, ...hi };
    min[along] = start;
    max[along] = end;
    return { min, max };
  };
  const shader = spec.shader ?? DEFAULT_SHADER;
  const c0 = centre - width / 2;
  const c1 = centre + width / 2;
  const brushes: BoxBrush[] = [
    { id: `${id}-floor`, ...box({ [across]: c0 - t, z: floor - t }, { [across]: c1 + t, z: floor }), shader },
    {
      id: `${id}-ceiling`,
      ...box({ [across]: c0 - t, z: floor + height }, { [across]: c1 + t, z: floor + height + t }),
      shader,
    },
    { id: `${id}-side-1`, ...box({ [across]: c0 - t, z: floor }, { [across]: c0, z: floor + height }), shader },
    { id: `${id}-side-2`, ...box({ [across]: c1, z: floor }, { [across]: c1 + t, z: floor + height }), shader },
  ];
  const entities: PointEntity[] = [];
  const light = spec.light ?? 200;
  if (light !== false) {
    const origin = { x: 0, y: 0, z: floor + Math.max(height / 2, height - 32) };
    origin[along] = (start + end) / 2;
    origin[across] = centre;
    entities.push({ id: `${id}-light`, classname: "light", origin, keys: { light: String(positive(light, "light")) } });
  }
  const carve = box({ [across]: c0 - t, z: floor - t }, { [across]: c1 + t, z: floor + height + t });
  return { brushes, entities, carve };
}

export interface StairsSpec {
  id: string;
  /** Floor point at the bottom of the first step, and at the top of the last; they differ along x or y. */
  from: Vec3q;
  to: Vec3q;
  /** Default 128. */
  width?: number;
  /** Rise per step; at most 18 (the game's step height). Default 16. */
  step?: number;
  shader?: string;
}

/** Solid steps from `from` up to `to`, standing on the floor at from.z. */
export function generateStairs(spec: StairsSpec): Generated {
  const { id, from, to } = spec;
  if (!id) throw new Error("gen.stairs needs an id");
  const rise = to.z - from.z;
  if (!(rise > 0)) throw new Error("to.z must be above from.z; stairs go up from `from`");
  const along: Axis | null = from.x !== to.x && from.y === to.y ? "x" : from.y !== to.y && from.x === to.x ? "y" : null;
  if (!along) throw new Error("stairs must run along exactly one of x or y");
  const across: Axis = along === "x" ? "y" : "x";
  const stepHeight = positive(spec.step ?? 16, "step");
  if (stepHeight > 18) throw new Error("step must be at most 18: players climb 18 units without jumping");
  const count = Math.ceil(rise / stepHeight);
  const run = to[along] - from[along];
  const tread = Math.abs(run) / count;
  if (tread < 8) throw new Error(`a ${Math.abs(run)}-unit run is too short for ${count} steps; make it longer`);
  const width = positive(spec.width ?? 128, "width");
  const dir = Math.sign(run);
  const brushes: BoxBrush[] = [];
  for (let i = 0; i < count; i++) {
    // Whole units, so steps stay on integer coordinates.
    const a = Math.round(from[along] + dir * tread * i);
    const b = i === count - 1 ? to[along] : Math.round(from[along] + dir * tread * (i + 1));
    const min = { x: 0, y: 0, z: from.z };
    const max = { x: 0, y: 0, z: Math.min(to.z, from.z + stepHeight * (i + 1)) };
    min[along] = Math.min(a, b);
    max[along] = Math.max(a, b);
    min[across] = from[across] - width / 2;
    max[across] = from[across] + width / 2;
    brushes.push({ id: `${id}-step-${i + 1}`, min, max, shader: spec.shader ?? DEFAULT_SHADER });
  }
  return { brushes, entities: [] };
}

export interface TeleporterSpec {
  id: string;
  /** Floor point under the middle of the teleporter trigger. */
  at: Vec3q;
  /** Floor point where players arrive. */
  to: Vec3q;
  /** Facing on arrival, degrees (0 = +X, 90 = +Y). Default 0. */
  angle?: number;
  /** Trigger footprint (square) and height. Defaults 64 and 64. */
  size?: number;
  height?: number;
}

export interface JumpPadSpec {
  id: string;
  /** Floor point under the middle of the pad. */
  at: Vec3q;
  /** Floor point where players land; the pad throws them there. */
  to: Vec3q;
  /** Trigger footprint (square) and height. Defaults 64 and 16. */
  size?: number;
  height?: number;
}

export interface Linked {
  /** Brushes that become the trigger brush entity. */
  trigger: BoxBrush[];
  classname: "trigger_teleport" | "trigger_push";
  keys: Record<string, string>;
  entities: PointEntity[];
}

/** Player origins sit this far above the floor, as spawn points do. */
const STANDING_ORIGIN = 24;

function triggerBox(id: string, at: Vec3q, size: number, height: number): BoxBrush {
  return {
    id: `${id}-trigger`,
    min: { x: at.x - size / 2, y: at.y - size / 2, z: at.z },
    max: { x: at.x + size / 2, y: at.y + size / 2, z: at.z + height },
    shader: "common/trigger",
  };
}

/** A teleporter: a trigger on the floor at `at` sending players to `to`. */
export function generateTeleporter(spec: TeleporterSpec): Linked {
  if (!spec.id) throw new Error("gen.teleporter needs an id");
  const destination = `${spec.id}_dest`;
  return {
    trigger: [triggerBox(spec.id, spec.at, positive(spec.size ?? 64, "size"), positive(spec.height ?? 64, "height"))],
    classname: "trigger_teleport",
    keys: { target: destination },
    entities: [
      {
        id: `${spec.id}-dest`,
        classname: "misc_teleporter_dest",
        origin: { x: spec.to.x, y: spec.to.y, z: spec.to.z + STANDING_ORIGIN },
        keys: { targetname: destination, angle: String(spec.angle ?? 0) },
      },
    ],
  };
}

/** A jump pad: a push trigger on the floor at `at` throwing players to `to`. */
export function generateJumpPad(spec: JumpPadSpec): Linked {
  if (!spec.id) throw new Error("gen.jumppad needs an id");
  const target = `${spec.id}_target`;
  return {
    trigger: [triggerBox(spec.id, spec.at, positive(spec.size ?? 64, "size"), positive(spec.height ?? 16, "height"))],
    classname: "trigger_push",
    keys: { target },
    entities: [
      {
        id: `${spec.id}-target`,
        classname: "target_position",
        origin: { x: spec.to.x, y: spec.to.y, z: spec.to.z + STANDING_ORIGIN },
        keys: { targetname: target },
      },
    ],
  };
}
