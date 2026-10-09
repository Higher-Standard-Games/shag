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

const DEFAULT_SHADER = "blx/blx_grid";

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
