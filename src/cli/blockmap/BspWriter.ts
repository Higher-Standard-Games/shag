/**
 * Compile a block map to a Quake 3 IBSP v46 file that SHAG's `BspLoader`,
 * `MapLoader` and collision read like any MakeBSP output.
 *
 * What it writes:
 * - one textured polygon face per visible box side, with baked lightmaps
 *   (128x128 IBSP pages) from `LightBaker`;
 * - one solid brush per box, so collision traces work;
 * - a one-node BSP tree: every face and brush in a single leaf and cluster,
 *   with a PVS that sees everything;
 * - a light grid matching the world bounds, for lighting models and sprites.
 *
 * Faces are wound clockwise seen from the front, as q3map2 writes them.
 */

import { LightBaker } from "./Lighting";
import type { BlockMap, Box, Vec3 } from "./MapSpec";
import { expandShapes } from "./Shapes";

const LIGHTMAP_SIZE = 128;
const CONTENTS_SOLID = 1;
const CONTENTS_WATER = 0x20;
const SURF_SKY = 0x4;
const SURF_NOLIGHTMAP = 0x400;
const FACE_POLYGON = 1;

/**
 * How SHAG turns an IBSP lightmap byte into light: `min(1, (b/255)^0.7 * 2)`
 * (`writeBspLightmapRgba` in `loader/bsp/mesh/lightmaps.ts`), times the IBSP
 * gain of 3 (`LIGHTMAP_INTENSITY_IBSP` in MapLoader). Storing the inverse of
 * that curve makes a baked linear value render as that value, up to 6.
 */
const LIGHTMAP_CURVE = 0.7;
const LIGHTMAP_GAIN = 2 * 3;

function lightmapByte(light: number): number {
  return toByte((Math.max(0, light) / LIGHTMAP_GAIN) ** (1 / LIGHTMAP_CURVE));
}

interface Face {
  texture: number;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  /** Texture coordinate axes: s and t per world unit. */
  sAxis: Vec3;
  tAxis: Vec3;
  /** A sky surface: no lightmap; SHAG skips drawing it and shows the shader's skybox. */
  sky: boolean;
}

interface LightmapTile {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompiledBsp {
  bytes: Uint8Array;
  stats: { faces: number; brushes: number; lightmaps: number; lightVols: number; textures: string[] };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The six sides of a box as origin + u + v with u x v pointing out. */
function boxSides(box: Box): { key: "top" | "bottom" | "side"; origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 }[] {
  const [x0, y0, z0] = box.mins;
  const [x1, y1, z1] = box.maxs;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  return [
    { key: "top", origin: [x0, y0, z1], u: [dx, 0, 0], v: [0, dy, 0], normal: [0, 0, 1] },
    { key: "bottom", origin: [x0, y0, z0], u: [0, dy, 0], v: [dx, 0, 0], normal: [0, 0, -1] },
    { key: "side", origin: [x1, y0, z0], u: [0, dy, 0], v: [0, 0, dz], normal: [1, 0, 0] },
    { key: "side", origin: [x0, y0, z0], u: [0, 0, dz], v: [0, dy, 0], normal: [-1, 0, 0] },
    { key: "side", origin: [x0, y1, z0], u: [0, 0, dz], v: [dx, 0, 0], normal: [0, 1, 0] },
    { key: "side", origin: [x0, y0, z0], u: [dx, 0, 0], v: [0, 0, dz], normal: [0, -1, 0] },
  ];
}

/** True when another box covers this whole side, so it can never be seen. */
function sideHidden(boxes: Box[], self: Box, origin: Vec3, u: Vec3, v: Vec3, normal: Vec3): boolean {
  const axis = normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
  const plane = origin[axis];
  const far = add(add(origin, u), v);
  return boxes.some((other) => {
    if (other === self) return false;
    // You can see through water to what is behind it
    if (other.liquid && !self.liquid) return false;
    const touching = normal[axis] > 0 ? other.mins[axis] === plane : other.maxs[axis] === plane;
    if (!touching) return false;
    for (let a = 0; a < 3; a++) {
      if (a === axis) continue;
      const lo = Math.min(origin[a], far[a]);
      const hi = Math.max(origin[a], far[a]);
      if (other.mins[a] > lo || other.maxs[a] < hi) return false;
    }
    return true;
  });
}

/** Planar texture axes: tops map X/Y, sides map their horizontal axis and Z (t runs down). */
function textureAxes(normal: Vec3, textureScale: number): { sAxis: Vec3; tAxis: Vec3 } {
  const k = 1 / textureScale;
  if (normal[2] !== 0) return { sAxis: [k, 0, 0], tAxis: [0, -k, 0] };
  if (normal[0] !== 0) return { sAxis: [0, k * normal[0], 0], tAxis: [0, 0, -k] };
  return { sAxis: [-k * normal[1], 0, 0], tAxis: [0, 0, -k] };
}

/** Shelf packer over 128x128 lightmap pages. */
class LightmapAtlas {
  readonly pages: Uint8Array[] = [];
  private cursorX = 0;
  private cursorY = 0;
  private shelfHeight = 0;

  allocate(width: number, height: number): LightmapTile {
    if (this.pages.length === 0) this.newPage();
    if (this.cursorX + width > LIGHTMAP_SIZE) {
      this.cursorX = 0;
      this.cursorY += this.shelfHeight;
      this.shelfHeight = 0;
    }
    if (this.cursorY + height > LIGHTMAP_SIZE) this.newPage();
    const tile = { page: this.pages.length - 1, x: this.cursorX, y: this.cursorY, width, height };
    this.cursorX += width;
    this.shelfHeight = Math.max(this.shelfHeight, height);
    return tile;
  }

  private newPage(): void {
    this.pages.push(new Uint8Array(LIGHTMAP_SIZE * LIGHTMAP_SIZE * 3));
    this.cursorX = 0;
    this.cursorY = 0;
    this.shelfHeight = 0;
  }
}

/** Little-endian binary builder for lump payloads. */
class LumpBuilder {
  private bytes = new Uint8Array(1024);
  private view = new DataView(this.bytes.buffer);
  length = 0;

  private reserve(count: number): void {
    if (this.length + count <= this.bytes.length) return;
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + count));
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  int(value: number): this {
    this.reserve(4);
    this.view.setInt32(this.length, value, true);
    this.length += 4;
    return this;
  }

  float(value: number): this {
    this.reserve(4);
    this.view.setFloat32(this.length, value, true);
    this.length += 4;
    return this;
  }

  vec(value: Vec3): this {
    return this.float(value[0]).float(value[1]).float(value[2]);
  }

  ivec(value: Vec3): this {
    return this.int(value[0]).int(value[1]).int(value[2]);
  }

  byte(value: number): this {
    this.reserve(1);
    this.bytes[this.length++] = value;
    return this;
  }

  raw(data: Uint8Array): this {
    this.reserve(data.length);
    this.bytes.set(data, this.length);
    this.length += data.length;
    return this;
  }

  /** A fixed-size, zero-padded string field. */
  text(value: string, size: number): this {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length >= size) throw new Error(`String too long for ${size}-byte field: ${value}`);
    this.reserve(size);
    this.bytes.fill(0, this.length, this.length + size);
    this.bytes.set(encoded, this.length);
    this.length += size;
    return this;
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function entityText(entities: Record<string, string>[]): string {
  const blocks = entities.map((entity) => {
    const lines = Object.entries(entity).map(([key, value]) => {
      if (/["\n]/.test(key) || /["\n]/.test(value)) throw new Error(`Invalid entity key/value: ${key}`);
      return `"${key}" "${value}"`;
    });
    return `{\n${lines.join("\n")}\n}\n`;
  });
  return `${blocks.join("")}\0`;
}

/** Q3 light grid direction bytes (longitude from +Z, latitude around Z), for a unit vector. */
function encodeDirection(direction: Vec3): [number, number] {
  const turn = (angle: number) => Math.round((angle / (2 * Math.PI)) * 256) & 255;
  const longitude = Math.acos(Math.max(-1, Math.min(1, direction[2])));
  const latitude = (Math.atan2(direction[1], direction[0]) + 2 * Math.PI) % (2 * Math.PI);
  return [turn(longitude), turn(latitude)];
}

function normalizeDirection(direction: Vec3): Vec3 {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  return direction.map((value) => Number((value / length).toFixed(4))) as Vec3;
}

const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

export function compileBlockMap(input: BlockMap): CompiledBsp {
  // Stairs and arches are boxes too: expand them first
  const map: BlockMap = input.shapes?.length
    ? { ...input, boxes: [...input.boxes, ...expandShapes(input.shapes)], shapes: [] }
    : input;
  if (map.boxes.length === 0) throw new Error("Block map has no boxes");
  for (const box of map.boxes) {
    for (let a = 0; a < 3; a++) {
      if (!(box.maxs[a] > box.mins[a])) throw new Error(`Box has no volume: ${box.mins} ${box.maxs}`);
    }
  }

  const baker = new LightBaker(map.boxes, map.lighting);

  // A sky shader needs at least one surface that uses it: a slab under the
  // world whose top face is sky. SHAG skips drawing sky faces and draws the
  // shader's skybox instead.
  const boxes = [...map.boxes];
  let skyBox: Box | null = null;
  if (map.sky) {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const box of map.boxes) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], box.mins[a]);
        hi[a] = Math.max(hi[a], box.maxs[a]);
      }
    }
    skyBox = {
      mins: [lo[0], lo[1], lo[2] - 48],
      maxs: [hi[0], hi[1], lo[2] - 32],
      textures: { top: map.sky, side: map.sky },
    };
    boxes.push(skyBox);
  }

  // Textures: one entry per name, solid unless only liquid boxes use it
  const textureNames: string[] = [];
  const textureContents: number[] = [];
  for (const box of boxes) {
    const contents = box.liquid ? CONTENTS_WATER : CONTENTS_SOLID;
    for (const name of [box.textures.top, box.textures.side, box.textures.bottom ?? box.textures.side]) {
      const index = textureNames.indexOf(name);
      if (index < 0) {
        textureNames.push(name);
        textureContents.push(contents);
      } else if (textureContents[index] !== contents) {
        throw new Error(`Texture ${name} is used by both liquid and solid boxes`);
      }
    }
  }
  const textureIndex = (name: string) => textureNames.indexOf(name);
  const textureFlags = textureNames.map((name) => (name === map.sky ? SURF_SKY | SURF_NOLIGHTMAP : 0));

  // Planes come in pairs (p, -p), as q3map2 writes them
  const planes: { normal: Vec3; dist: number }[] = [];
  const planeIndex = (normal: Vec3, dist: number) => {
    // Adding 0 turns -0 into 0, so equal planes compare and serialise equal
    dist += 0;
    const found = planes.findIndex((p, i) => i % 2 === 0 && dot(p.normal, normal) > 0.9999 && p.dist === dist);
    if (found >= 0) return found;
    planes.push({ normal, dist }, { normal: scale(normal, -1).map((n) => n + 0) as Vec3, dist: 0 - dist });
    return planes.length - 2;
  };

  // Brushes: sides in the axial order -X, +X, -Y, +Y, -Z, +Z
  const brushes: { firstSide: number; texture: number }[] = [];
  const brushSides: { plane: number; texture: number }[] = [];
  for (const box of boxes) {
    const side = textureIndex(box.textures.side);
    const top = textureIndex(box.textures.top);
    const bottom = textureIndex(box.textures.bottom ?? box.textures.side);
    brushes.push({ firstSide: brushSides.length, texture: side });
    brushSides.push(
      { plane: planeIndex([-1, 0, 0], -box.mins[0]), texture: side },
      { plane: planeIndex([1, 0, 0], box.maxs[0]), texture: side },
      { plane: planeIndex([0, -1, 0], -box.mins[1]), texture: side },
      { plane: planeIndex([0, 1, 0], box.maxs[1]), texture: side },
      { plane: planeIndex([0, 0, -1], -box.mins[2]), texture: bottom },
      { plane: planeIndex([0, 0, 1], box.maxs[2]), texture: top },
    );
  }

  // Faces: visible box sides
  const faces: Face[] = [];
  for (const box of boxes) {
    for (const side of boxSides(box)) {
      if (box === skyBox && side.key !== "top") continue;
      if (side.key === "bottom" && !box.bottomFace) continue;
      // A liquid is drawn as its surface only: SHAG's water wants flat batches
      if (box.liquid && side.key !== "top") continue;
      if (sideHidden(boxes, box, side.origin, side.u, side.v, side.normal)) continue;
      const name =
        side.key === "top"
          ? box.textures.top
          : side.key === "bottom"
            ? (box.textures.bottom ?? box.textures.side)
            : box.textures.side;
      faces.push({
        texture: textureIndex(name),
        origin: side.origin,
        u: side.u,
        v: side.v,
        normal: side.normal,
        ...textureAxes(side.normal, map.textureScale),
        sky: box === skyBox,
      });
    }
  }

  // Lightmaps and render geometry
  const atlas = new LightmapAtlas();
  const vertices = new LumpBuilder();
  const meshVerts = new LumpBuilder();
  const faceLump = new LumpBuilder();
  let vertexCount = 0;
  for (const face of faces) {
    const uLength = length(face.u);
    const vLength = length(face.v);
    const width = face.sky ? 2 : Math.min(LIGHTMAP_SIZE, Math.ceil(uLength / map.luxelSize) + 1);
    const height = face.sky ? 2 : Math.min(LIGHTMAP_SIZE, Math.ceil(vLength / map.luxelSize) + 1);
    const tile = face.sky ? { page: -1, x: 0, y: 0, width, height } : atlas.allocate(width, height);
    const page = atlas.pages[tile.page] ?? new Uint8Array(LIGHTMAP_SIZE * LIGHTMAP_SIZE * 3);

    // A luxel samples its centre, kept half a unit inside the face so a
    // neighbouring box that shares the edge does not shadow it.
    for (let j = 0; j < (face.sky ? 0 : height); j++) {
      for (let i = 0; i < width; i++) {
        const a = Math.min(Math.max(i / (width - 1), 0.5 / uLength), 1 - 0.5 / uLength);
        const b = Math.min(Math.max(j / (height - 1), 0.5 / vLength), 1 - 0.5 / vLength);
        const point = add(add(face.origin, scale(face.u, a)), scale(face.v, b));
        const light = baker.shade(point, face.normal);
        const offset = ((tile.y + j) * LIGHTMAP_SIZE + tile.x + i) * 3;
        for (let c = 0; c < 3; c++) page[offset + c] = lightmapByte(light[c]);
      }
    }

    // Clockwise from the front: origin, +v, +u+v, +u
    const corners: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    for (const [a, b] of corners) {
      const position = add(add(face.origin, scale(face.u, a)), scale(face.v, b));
      const lmU = (tile.x + 0.5 + a * (width - 1)) / LIGHTMAP_SIZE;
      const lmV = (tile.y + 0.5 + b * (height - 1)) / LIGHTMAP_SIZE;
      vertices
        .vec(position)
        .float(dot(position, face.sAxis))
        .float(dot(position, face.tAxis))
        .float(lmU)
        .float(lmV)
        .vec(face.normal)
        .byte(255)
        .byte(255)
        .byte(255)
        .byte(255);
    }
    const firstMeshVert = meshVerts.length / 4;
    for (const index of [0, 1, 2, 0, 2, 3]) meshVerts.int(index);

    faceLump
      .int(face.texture)
      .int(-1) // effect (fog)
      .int(FACE_POLYGON)
      .int(vertexCount)
      .int(4)
      .int(firstMeshVert)
      .int(6)
      .int(tile.page)
      .int(tile.x)
      .int(tile.y)
      .int(width)
      .int(height)
      .vec(face.origin)
      .vec(scale(face.u, 1 / Math.max(1, width - 1)))
      .vec(scale(face.v, 1 / Math.max(1, height - 1)))
      .vec(face.normal)
      .int(0)
      .int(0);
    vertexCount += 4;
  }

  // World bounds
  const mins: Vec3 = [Infinity, Infinity, Infinity];
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let a = 0; a < 3; a++) {
      mins[a] = Math.min(mins[a], box.mins[a]);
      maxs[a] = Math.max(maxs[a], box.maxs[a]);
    }
  }

  // Light grid, sized exactly as BspLoader.calculateLightGrid predicts
  const grid = map.gridSize;
  const gridOrigin = mins.map((m, a) => Math.ceil(m / grid[a]) * grid[a]) as Vec3;
  const gridMax = maxs.map((m, a) => Math.floor(m / grid[a]) * grid[a]) as Vec3;
  const gridCount = gridOrigin.map((o, a) => Math.max(0, Math.floor((gridMax[a] - o) / grid[a])) + 1);
  const lightVols = new LumpBuilder();
  for (let z = 0; z < gridCount[2]; z++) {
    for (let y = 0; y < gridCount[1]; y++) {
      for (let x = 0; x < gridCount[0]; x++) {
        const point: Vec3 = [gridOrigin[0] + x * grid[0], gridOrigin[1] + y * grid[1], gridOrigin[2] + z * grid[2]];
        const sample = baker.gridSample(point);
        const direction = encodeDirection(sample.direction);
        for (let c = 0; c < 3; c++) lightVols.byte(toByte(sample.ambient[c] / 2));
        for (let c = 0; c < 3; c++) lightVols.byte(toByte(sample.directional[c] / 2));
        lightVols.byte(direction[0]).byte(direction[1]);
      }
    }
  }

  // One node splitting nothing: everything is in front, in leaf 0
  const nodePlane = planeIndex([0, 0, 1], Math.floor(mins[2]) - 64);
  const imins = mins.map(Math.floor) as Vec3;
  const imaxs = maxs.map(Math.ceil) as Vec3;

  const lumps: Uint8Array[] = [];
  lumps[0] = new TextEncoder().encode(
    entityText([
      {
        classname: "worldspawn",
        message: map.title,
        gridsize: map.gridSize.join(" "),
        // The baked sun, so a game can aim its real-time sun (sprite shadows) the same way
        _sun_direction: normalizeDirection(map.lighting.sunDirection).join(" "),
      },
      ...map.entities,
    ]),
  );
  const textures = new LumpBuilder();
  textureNames.forEach((name, i) => {
    textures.text(name, 64).int(textureFlags[i]).int(textureContents[i]);
  });
  lumps[1] = textures.finish();
  const planeLump = new LumpBuilder();
  for (const plane of planes) planeLump.vec(plane.normal).float(plane.dist);
  lumps[2] = planeLump.finish();
  lumps[3] = new LumpBuilder().int(nodePlane).int(-1).int(-2).ivec(imins).ivec(imaxs).finish();
  lumps[4] = new LumpBuilder()
    .int(0) // cluster
    .int(0) // area
    .ivec(imins)
    .ivec(imaxs)
    .int(0)
    .int(faces.length)
    .int(0)
    .int(brushes.length)
    .int(-1) // the empty leaf behind the node
    .int(0)
    .ivec(imins)
    .ivec(imaxs)
    .int(0)
    .int(0)
    .int(0)
    .int(0)
    .finish();
  const leafFaces = new LumpBuilder();
  for (let i = 0; i < faces.length; i++) leafFaces.int(i);
  lumps[5] = leafFaces.finish();
  const leafBrushes = new LumpBuilder();
  for (let i = 0; i < brushes.length; i++) leafBrushes.int(i);
  lumps[6] = leafBrushes.finish();
  lumps[7] = new LumpBuilder().vec(mins).vec(maxs).int(0).int(faces.length).int(0).int(brushes.length).finish();
  const brushLump = new LumpBuilder();
  for (const brush of brushes) brushLump.int(brush.firstSide).int(6).int(brush.texture);
  lumps[8] = brushLump.finish();
  const sideLump = new LumpBuilder();
  for (const side of brushSides) sideLump.int(side.plane).int(side.texture);
  lumps[9] = sideLump.finish();
  lumps[10] = vertices.finish();
  lumps[11] = meshVerts.finish();
  lumps[12] = new Uint8Array(0);
  lumps[13] = faceLump.finish();
  const lightmapLump = new LumpBuilder();
  for (const page of atlas.pages) lightmapLump.raw(page);
  lumps[14] = lightmapLump.finish();
  lumps[15] = lightVols.finish();
  lumps[16] = new LumpBuilder().int(1).int(1).byte(1).finish();

  // Header, lump directory, then 4-byte aligned lumps
  const headerSize = 8 + lumps.length * 8;
  let offset = headerSize;
  const offsets = lumps.map((lump) => {
    const start = offset;
    offset += (lump.length + 3) & ~3;
    return start;
  });
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("IBSP"), 0);
  view.setInt32(4, 46, true);
  lumps.forEach((lump, i) => {
    view.setInt32(8 + i * 8, offsets[i], true);
    view.setInt32(12 + i * 8, lump.length, true);
    bytes.set(lump, offsets[i]);
  });

  return {
    bytes,
    stats: {
      faces: faces.length,
      brushes: brushes.length,
      lightmaps: atlas.pages.length,
      lightVols: gridCount[0] * gridCount[1] * gridCount[2],
      textures: textureNames,
    },
  };
}
