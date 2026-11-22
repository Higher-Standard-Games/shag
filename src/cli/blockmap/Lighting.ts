/**
 * A tiny CPU light baker for block maps: hemispheric sky ambient, a sun with
 * hard shadows and point lights with shadows. Shadows are ray/box tests
 * against every box, which is fine for a few hundred boxes.
 */

import type { Box, MapLighting, Rgb, Vec3 } from "./MapSpec";

const EPSILON = 1e-3;
/** Rays per surface point for baked ambient occlusion. */
const OCCLUSION_RAYS = 8;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** True when the segment from `origin` along `direction` for `maxDistance` hits a box. */
function rayHitsBox(origin: Vec3, direction: Vec3, maxDistance: number, box: Box): boolean {
  let near = EPSILON;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-9) {
      if (o <= box.mins[axis] || o >= box.maxs[axis]) return false;
      continue;
    }
    let t0 = (box.mins[axis] - o) / d;
    let t1 = (box.maxs[axis] - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return false;
  }
  return true;
}

/** Edge of a cell of the 2D grid that shadow rays walk, in world units. */
const CELL = 128;

export class LightBaker {
  private readonly toSun: Vec3;
  /** Boxes that cast shadows: liquids let light through. */
  private readonly occluders: Box[];
  private readonly mins: Vec3 = [Infinity, Infinity, Infinity];
  private readonly maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  private readonly columns: number;
  private readonly rows: number;
  /** Occluder indices per XY cell, so a ray tests only the boxes along its path. */
  private readonly cells: number[][];
  /** Per-occluder stamp, so a box spanning several cells is tested once per ray. */
  private readonly visited: Uint32Array;
  private stamp = 0;

  constructor(
    boxes: Box[],
    private readonly lighting: MapLighting,
  ) {
    const sun = normalize(lighting.sunDirection);
    this.toSun = [-sun[0], -sun[1], -sun[2]];
    this.occluders = boxes.filter((box) => !box.liquid);
    for (const box of this.occluders) {
      for (let a = 0; a < 3; a++) {
        this.mins[a] = Math.min(this.mins[a], box.mins[a]);
        this.maxs[a] = Math.max(this.maxs[a], box.maxs[a]);
      }
    }
    this.columns = Math.max(1, Math.ceil((this.maxs[0] - this.mins[0]) / CELL));
    this.rows = Math.max(1, Math.ceil((this.maxs[1] - this.mins[1]) / CELL));
    this.cells = Array.from({ length: this.columns * this.rows }, () => []);
    this.visited = new Uint32Array(this.occluders.length);
    this.occluders.forEach((box, index) => {
      const [c0, r0] = this.cellOf(box.mins[0], box.mins[1]);
      const [c1, r1] = this.cellOf(box.maxs[0], box.maxs[1]);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.columns + c].push(index);
    });
  }

  private cellOf(x: number, y: number): [number, number] {
    const column = Math.floor((x - this.mins[0]) / CELL);
    const row = Math.floor((y - this.mins[1]) / CELL);
    return [Math.min(this.columns - 1, Math.max(0, column)), Math.min(this.rows - 1, Math.max(0, row))];
  }

  /** Direction from a surface towards the sun, unit length. */
  get sunVector(): Vec3 {
    return this.toSun;
  }

  /** True when the segment from `origin` along unit `direction` for `maxDistance` hits a shadow-casting box. */
  occluded(origin: Vec3, direction: Vec3, maxDistance: number): boolean {
    if (this.occluders.length === 0) return false;
    // Clip the segment to the occluders' bounds
    let near = 0;
    let far = maxDistance;
    for (let axis = 0; axis < 3; axis++) {
      const d = direction[axis];
      if (Math.abs(d) < 1e-9) {
        if (origin[axis] < this.mins[axis] || origin[axis] > this.maxs[axis]) return false;
        continue;
      }
      let t0 = (this.mins[axis] - origin[axis]) / d;
      let t1 = (this.maxs[axis] - origin[axis]) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) return false;
    }

    // Walk the XY cells the clipped segment crosses (2D DDA)
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    const x = origin[0] + direction[0] * near;
    const y = origin[1] + direction[1] * near;
    let [column, row] = this.cellOf(x, y);
    const stepX = Math.sign(direction[0]);
    const stepY = Math.sign(direction[1]);
    const boundaryX = this.mins[0] + (column + (stepX > 0 ? 1 : 0)) * CELL;
    const boundaryY = this.mins[1] + (row + (stepY > 0 ? 1 : 0)) * CELL;
    let nextX = stepX === 0 ? Infinity : near + (boundaryX - x) / direction[0];
    let nextY = stepY === 0 ? Infinity : near + (boundaryY - y) / direction[1];
    const deltaX = stepX === 0 ? Infinity : CELL / Math.abs(direction[0]);
    const deltaY = stepY === 0 ? Infinity : CELL / Math.abs(direction[1]);
    for (;;) {
      for (const index of this.cells[row * this.columns + column]) {
        if (this.visited[index] === this.stamp) continue;
        this.visited[index] = this.stamp;
        if (rayHitsBox(origin, direction, maxDistance, this.occluders[index])) return true;
      }
      if (nextX < nextY) {
        if (nextX > far) return false;
        column += stepX;
        nextX += deltaX;
      } else {
        if (nextY > far) return false;
        row += stepY;
        nextY += deltaY;
      }
      if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return false;
    }
  }

  /** Hemispheric ambient for a normal: sky above, ground below. */
  ambient(normal: Vec3): Rgb {
    const up = (normal[2] + 1) / 2;
    const { skyAmbient: sky, groundAmbient: ground } = this.lighting;
    return [
      ground[0] + (sky[0] - ground[0]) * up,
      ground[1] + (sky[1] - ground[1]) * up,
      ground[2] + (sky[2] - ground[2]) * up,
    ];
  }

  /**
   * Share of ambient light reaching a surface point (1 = open sky): cosine-
   * weighted rays over the hemisphere, `occlusion.radius` long. The ray set
   * turns about the normal from point to point, so the few rays read as
   * noise-free gradients instead of bands.
   */
  occlusion(start: Vec3, normal: Vec3): number {
    const settings = this.lighting.occlusion;
    if (!settings || settings.strength <= 0) return 1;
    // Tangent frame for the normal
    const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const tangent = normalize([
      helper[1] * normal[2] - helper[2] * normal[1],
      helper[2] * normal[0] - helper[0] * normal[2],
      helper[0] * normal[1] - helper[1] * normal[0],
    ]);
    const bitangent: Vec3 = [
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ];
    // A per-point turn from a cheap hash of the position
    const hash = Math.sin(start[0] * 12.9898 + start[1] * 78.233 + start[2] * 37.719) * 43758.5453;
    const turn = (hash - Math.floor(hash)) * Math.PI * 2;
    let blocked = 0;
    for (let i = 0; i < OCCLUSION_RAYS; i++) {
      // Cosine-weighted: radius sqrt(u) on the disc, lifted onto the hemisphere
      const u = (i + 0.5) / OCCLUSION_RAYS;
      const r = Math.sqrt(u);
      const angle = i * 2.39996323 + turn;
      const a = r * Math.cos(angle);
      const b = r * Math.sin(angle);
      const c = Math.sqrt(Math.max(0, 1 - u));
      const direction: Vec3 = [
        tangent[0] * a + bitangent[0] * b + normal[0] * c,
        tangent[1] * a + bitangent[1] * b + normal[1] * c,
        tangent[2] * a + bitangent[2] * b + normal[2] * c,
      ];
      if (this.occluded(start, direction, settings.radius)) blocked++;
    }
    return 1 - settings.strength * (blocked / OCCLUSION_RAYS);
  }

  /** Linear light arriving at `point` on a surface with `normal`. */
  shade(point: Vec3, normal: Vec3): Rgb {
    const start: Vec3 = [point[0] + normal[0] * 0.5, point[1] + normal[1] * 0.5, point[2] + normal[2] * 0.5];
    const open = this.occlusion(start, normal);
    const color = this.ambient(normal).map((value) => value * open) as Rgb;

    const sunCos = dot(normal, this.toSun);
    if (sunCos > 0 && !this.occluded(start, this.toSun, 1e5)) {
      for (let c = 0; c < 3; c++) color[c] += this.lighting.sunColor[c] * sunCos;
    }

    for (const light of this.lighting.points) {
      const delta: Vec3 = [light.origin[0] - start[0], light.origin[1] - start[1], light.origin[2] - start[2]];
      const distance = Math.hypot(delta[0], delta[1], delta[2]);
      if (distance >= light.radius || distance < EPSILON) continue;
      const direction: Vec3 = [delta[0] / distance, delta[1] / distance, delta[2] / distance];
      const cos = dot(normal, direction);
      if (cos <= 0 || this.occluded(start, direction, distance)) continue;
      const falloff = (1 - distance / light.radius) ** 2;
      for (let c = 0; c < 3; c++) color[c] += light.color[c] * cos * falloff;
    }
    return color;
  }

  /**
   * Light grid sample at a point in open air, for sprites and models: Q3's
   * split into an ambient colour and one directional light. Every light that
   * reaches the point (sun and point lights, with shadows) adds to a weighted
   * direction; three quarters of their colour becomes the directional part
   * and a quarter goes to ambient, so light from opposite sides is not lost.
   */
  gridSample(point: Vec3): { ambient: Rgb; directional: Rgb; direction: Vec3 } {
    // A sideways normal: half sky, half ground, as a vertical sprite sees it
    const ambient = this.ambient([1, 0, 0]);
    const total: Rgb = [0, 0, 0];
    const weighted: Vec3 = [0, 0, 0];
    const add = (color: Rgb, direction: Vec3, scale: number) => {
      const weight = (color[0] + color[1] + color[2]) * scale;
      for (let c = 0; c < 3; c++) {
        total[c] += color[c] * scale;
        weighted[c] += direction[c] * weight;
      }
    };
    if (!this.occluded(point, this.toSun, 1e5)) add(this.lighting.sunColor, this.toSun, 1);
    for (const light of this.lighting.points) {
      const delta: Vec3 = [light.origin[0] - point[0], light.origin[1] - point[1], light.origin[2] - point[2]];
      const distance = Math.hypot(delta[0], delta[1], delta[2]);
      if (distance >= light.radius) continue;
      const direction: Vec3 =
        distance < EPSILON ? [0, 0, 1] : [delta[0] / distance, delta[1] / distance, delta[2] / distance];
      if (distance >= EPSILON && this.occluded(point, direction, distance)) continue;
      add(light.color, direction, (1 - distance / light.radius) ** 2);
    }
    const length = Math.hypot(weighted[0], weighted[1], weighted[2]);
    const direction: Vec3 =
      length > EPSILON ? [weighted[0] / length, weighted[1] / length, weighted[2] / length] : this.toSun;
    return {
      ambient: [ambient[0] + total[0] * 0.25, ambient[1] + total[1] * 0.25, ambient[2] + total[2] * 0.25],
      directional: [total[0] * 0.75, total[1] * 0.75, total[2] * 0.75],
      direction,
    };
  }
}
