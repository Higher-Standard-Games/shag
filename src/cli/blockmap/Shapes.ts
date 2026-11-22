/**
 * Shapes the block map compiler builds out of boxes: stairs and arches.
 *
 * The compiler only knows axis-aligned boxes (no CSG, no sloped planes), which
 * suits a voxel-style diorama: a stair is a run of solid steps and an arch is
 * two piers with a stepped round opening between them, like pixel art of an
 * arch. Every piece is an ordinary box, so lighting, occlusion and collision
 * need nothing new. A map lists shapes in `shapes`; `expandShapes` turns them
 * into boxes before compiling.
 */

import type { Box, BoxTextures, Vec3 } from "./MapSpec";

/** A horizontal direction: which way a stair climbs, or which axis an arch's opening faces. */
export type Heading = "+x" | "-x" | "+y" | "-y";

export interface StairsShape {
  type: "stairs";
  /** Bottom corner where the first step starts: the low edge, on the side of smaller x or y. */
  origin: Vec3;
  /** The way the stair climbs. */
  climb: Heading;
  /** Width across the climb, units. */
  width: number;
  steps: number;
  /** Height of each step. */
  rise: number;
  /** Depth of each step along the climb. */
  run: number;
  textures: BoxTextures;
}

export interface ArchShape {
  type: "arch";
  /** Centre of the opening at ground level. */
  origin: Vec3;
  /** Axis the wall runs along: the opening is crossed along the other one. */
  along: "x" | "y";
  /** Width of the opening. */
  span: number;
  /** Height of the straight sides before the round top starts. */
  spring: number;
  /** Width of each pier and the height of the wall above the opening's crown. */
  thickness: number;
  /** Wall depth (how far the opening goes through). */
  depth: number;
  /** Columns the round top is built from; more is smoother (default: one per 4 units). */
  segments?: number;
  textures: BoxTextures;
}

export type Shape = StairsShape | ArchShape;

/** Boxes for a stair: each step is solid down to the stair's base. */
export function stairs(shape: Omit<StairsShape, "type">): Box[] {
  const { origin, climb, width, steps, rise, run, textures } = shape;
  const [x0, y0, z0] = origin;
  const total = steps * run;
  const boxes: Box[] = [];
  for (let i = 0; i < steps; i++) {
    const top = z0 + (i + 1) * rise;
    // Along the climb: step i covers [i * run, (i + 1) * run] from the low edge
    const a = climb.startsWith("+") ? i * run : total - (i + 1) * run;
    const b = a + run;
    const box: Box =
      climb === "+x" || climb === "-x"
        ? { mins: [x0 + a, y0, z0], maxs: [x0 + b, y0 + width, top], textures }
        : { mins: [x0, y0 + a, z0], maxs: [x0 + width, y0 + b, top], textures };
    boxes.push(box);
  }
  return boxes;
}

/**
 * Boxes for an arch: two piers, and above the opening a row of columns, each
 * hanging down to the round top's height at its middle, so the opening reads
 * as a semicircle in steps.
 */
export function arch(shape: Omit<ArchShape, "type">): Box[] {
  const { origin, along, span, spring, thickness, depth, textures } = shape;
  const [cx, cy, z0] = origin;
  const radius = span / 2;
  const crown = z0 + spring + radius;
  const top = crown + thickness;
  const segments = Math.max(2, Math.round(shape.segments ?? span / 4));
  // Work in (u along the wall, v through it), then map to x/y
  const toBox = (u0: number, u1: number, z1: number, z2: number): Box => {
    const v0 = -depth / 2;
    const v1 = depth / 2;
    return along === "x"
      ? { mins: [cx + u0, cy + v0, z1], maxs: [cx + u1, cy + v1, z2], textures }
      : { mins: [cx + v0, cy + u0, z1], maxs: [cx + v1, cy + u1, z2], textures };
  };
  const boxes: Box[] = [toBox(-radius - thickness, -radius, z0, top), toBox(radius, radius + thickness, z0, top)];
  const width = span / segments;
  for (let i = 0; i < segments; i++) {
    const u0 = -radius + i * width;
    const u1 = u0 + width;
    const mid = (u0 + u1) / 2;
    // Underside of the arch at this column, rounded to whole units
    const under = Math.round(z0 + spring + Math.sqrt(Math.max(0, radius * radius - mid * mid)));
    if (under < top) boxes.push(toBox(u0, u1, under, top));
  }
  return boxes;
}

/** Expand a map's shapes into boxes. */
export function expandShapes(shapes: readonly Shape[] | undefined): Box[] {
  const boxes: Box[] = [];
  for (const shape of shapes ?? []) {
    if (shape.type === "stairs") boxes.push(...stairs(shape));
    else if (shape.type === "arch") boxes.push(...arch(shape));
    else throw new Error(`Unknown shape type: ${(shape as { type: string }).type}`);
  }
  return boxes;
}
