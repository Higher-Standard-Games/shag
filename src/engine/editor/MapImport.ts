/**
 * Quake 3 .map source to an editable SHAGGED document: the inverse of MapWriter.
 *
 * MapParser reads the patchDef2 grids, but it normalizes brush faces to plane
 * points and drops the brushDef texture matrix and content flags, so brush
 * faces are read here from tokens. Brushes become boxes when they are six
 * axis-aligned planes and convex hulls otherwise. Classic face alignment
 * (shift, rotation, scale in texels) becomes the face matrix q3map2 would
 * compute, so the compiled texture lands where the original map put it.
 * Content the document can't hold is skipped and counted in `issues`.
 */

import { MapParser } from "../loader/map/MapParser";
import { cross, dot, fromWorldHull, planeTextureAxes, subtract, validateHull } from "./ConvexBrush";
import {
  type BoxBrush,
  type BrushEntity,
  type EditorDocumentData,
  ENTITY_KEY,
  type FaceKey,
  type FaceMaterial,
  type PatchSurface,
  type PointEntity,
  type Vec3q,
  validateDocument,
} from "./EditorDocument";
import { FACE_AXES, FIXED_MATRIX, faceTexMatrix, matrixToFace, type TexMatrix } from "./FaceUv";
import { modelReferenceIssue } from "./ModelReference";

export interface MapImportOptions {
  draftId: string;
  mapName?: string;
  /**
   * The image size of an unprefixed shader name, when known. Classic faces
   * align in texels, so without one they assume 64×64 and are marked
   * `sizeKnown: false`; brushDef matrices are exact either way.
   */
  textureSize?: (shader: string) => readonly [number, number] | null | undefined;
}
export interface MapImportResult {
  data: EditorDocumentData;
  issues: string[];
}

/** A classic (Quake 3 standard) face alignment: texels and degrees. */
interface StandardAlignment {
  shift: [number, number];
  rotation: number;
  scale: [number, number];
}

interface Token {
  text: string;
  quoted: boolean;
  start: number;
  end: number;
}
interface RawFace {
  points: [Vec3q, Vec3q, Vec3q];
  shader: string;
  /** brushDef faces carry their matrix; classic faces their shift/rotation/scale. */
  matrix?: TexMatrix;
  standard?: StandardAlignment;
  /** contents, surface flags, value. */
  flags: number[];
}
type Skip = "valve" | "doom3" | "unreadableBrush" | "patchType" | "unreadablePatch";
type RawPrimitive =
  | { kind: "brush"; faces: RawFace[] }
  | { kind: "patch"; text: string }
  | { kind: "skip"; skip: Skip };
interface RawEntity {
  keys: Array<[string, string]>;
  primitives: RawPrimitive[];
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const NOTES = {
  valve: (n: number) => `Skipped ${plural(n, "brush", "brushes")} in Valve 220 format`,
  doom3: (n: number) => `Skipped ${plural(n, "Doom 3 brushDef3 brush", "Doom 3 brushDef3 brushes")}`,
  unreadableBrush: (n: number) => `Skipped ${plural(n, "unreadable brush", "unreadable brushes")}`,
  degenerate: (n: number) => `Skipped ${plural(n, "brush", "brushes")} with no volume or open sides`,
  complex: (n: number) => `Skipped ${plural(n, "brush", "brushes")} with more than 64 sides or 128 corners`,
  badShader: (n: number) => `Skipped ${plural(n, "brush", "brushes")} with unsupported texture names`,
  patchType: (n: number) => `Skipped ${plural(n, "patch", "patches")} of a type other than patchDef2`,
  unreadablePatch: (n: number) => `Skipped ${plural(n, "unreadable patch", "unreadable patches")}`,
  patchSize: (n: number) => `Skipped ${plural(n, "patch", "patches")} with even or over-31 grid sizes`,
  badPatch: (n: number) => `Skipped ${plural(n, "patch", "patches")} with unsupported textures or coordinates`,
  entityPatch: (n: number) =>
    `Skipped ${plural(n, "patch", "patches")} inside brush entities (only world patches are supported)`,
  emptyEntity: (n: number) => `Dropped ${plural(n, "brush entity", "brush entities")} left with no brushes`,
  noClassname: (n: number) => `Skipped ${plural(n, "entity", "entities")} without a valid classname`,
  noOrigin: (n: number) => `Placed ${plural(n, "point entity", "point entities")} with no valid origin at 0 0 0`,
  badKey: (n: number) => `Dropped ${plural(n, "key")} with names or values the editor can't store`,
  reservedKey: (n: number) => `Dropped ${plural(n, "origin or model key")} on worldspawn or brush entities`,
  groupKey: (n: number) => `Dropped ${plural(n, "func_group key")} (their brushes moved to worldspawn)`,
  manyKeys: (n: number) => `Dropped keys past the 64th on ${plural(n, "entity", "entities")}`,
  alignment: (n: number) => `Reset unusable texture alignment on ${plural(n, "face")}`,
  extraWorld: (n: number) =>
    `Merged ${plural(n, "extra worldspawn entity", "extra worldspawn entities")} into the world`,
  modelPath: (n: number) => `${plural(n, "misc_model needs", "misc_models need")} a valid model path before export`,
  tooMany: (n: number) => `Skipped ${plural(n, "object")} past the editor's 20,000 per kind`,
} as const;
type Note = keyof typeof NOTES;

const DELIMITERS = "{}()[]";
const SHADER = /^[a-zA-Z0-9_./-]+$/;
const DETAIL = 0x8000000;
const UNKNOWN_SIZE: [number, number] = [64, 64];
const MAX_OBJECTS = 20_000;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const space = (ch: string) => ch <= " " || ch === "﻿";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (space(ch)) i++;
    else if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== "\n") j++;
      tokens.push({ text: source.slice(i + 1, j), quoted: true, start: i, end: j + 1 });
      i = j + 1;
    } else if (DELIMITERS.includes(ch)) {
      tokens.push({ text: ch, quoted: false, start: i, end: i + 1 });
      i++;
    } else {
      let j = i;
      while (j < source.length && !space(source[j]) && !DELIMITERS.includes(source[j]) && source[j] !== '"') j++;
      tokens.push({ text: source.slice(i, j), quoted: false, start: i, end: j });
      i = j;
    }
  }
  return tokens;
}

const is = (token: Token | undefined, text: string): boolean => !!token && !token.quoted && token.text === text;

/** Index of the brace closing the one at `open`, or -1 when the source ends first. */
function closing(tokens: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (is(tokens[i], "{")) depth++;
    else if (is(tokens[i], "}") && --depth === 0) return i;
  }
  return -1;
}

function readFaces(tokens: Token[], primitive: boolean): RawFace[] | "valve" {
  let i = 0;
  const fail = (): never => {
    throw new Error("unreadable face");
  };
  const expect = (text: string) => {
    if (!is(tokens[i++], text)) fail();
  };
  const num = (): number => {
    const token = tokens[i++];
    const value = token && !token.quoted ? Number(token.text) : Number.NaN;
    return Number.isFinite(value) ? value : fail();
  };
  const triple = (): [number, number, number] => {
    expect("(");
    const values: [number, number, number] = [num(), num(), num()];
    expect(")");
    return values;
  };
  const point = (): Vec3q => {
    const [x, y, z] = triple();
    return { x, y, z };
  };
  const faces: RawFace[] = [];
  while (i < tokens.length) {
    const points: [Vec3q, Vec3q, Vec3q] = [point(), point(), point()];
    let matrix: TexMatrix | undefined;
    if (primitive) {
      expect("(");
      matrix = [triple(), triple()];
      expect(")");
    }
    const shader = tokens[i++];
    if (!shader || (!shader.quoted && DELIMITERS.includes(shader.text))) fail();
    if (!primitive && is(tokens[i], "[")) return "valve";
    const numbers: number[] = [];
    while (i < tokens.length && !is(tokens[i], "(")) numbers.push(num());
    if (primitive) faces.push({ points, shader: shader.text, matrix, flags: numbers });
    else {
      if (numbers.length < 5) fail();
      const [sx, sy, rotation, ux, uy, ...flags] = numbers;
      faces.push({ points, shader: shader.text, standard: { shift: [sx, sy], rotation, scale: [ux, uy] }, flags });
    }
  }
  return faces;
}

/** One `{ ... }` block inside an entity, given the tokens between its braces. */
function readPrimitive(source: string, inner: Token[]): RawPrimitive {
  const head = inner[0];
  try {
    if (is(head, "(")) {
      const faces = readFaces(inner, false);
      return faces === "valve" ? { kind: "skip", skip: "valve" } : { kind: "brush", faces };
    }
    if (is(head, "brushDef")) {
      if (!is(inner[1], "{") || !is(inner.at(-1), "}")) return { kind: "skip", skip: "unreadableBrush" };
      const faces = readFaces(inner.slice(2, -1), true);
      return faces === "valve" ? { kind: "skip", skip: "valve" } : { kind: "brush", faces };
    }
  } catch {
    return { kind: "skip", skip: "unreadableBrush" };
  }
  if (is(head, "brushDef3")) return { kind: "skip", skip: "doom3" };
  if (is(head, "patchDef2")) {
    if (!is(inner[1], "{")) return { kind: "skip", skip: "unreadablePatch" };
    return { kind: "patch", text: source.slice(inner[1].start, inner.at(-1)!.end) };
  }
  if (head && !head.quoted && /^[A-Za-z]/.test(head.text)) return { kind: "skip", skip: "patchType" };
  return { kind: "skip", skip: "unreadableBrush" };
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}

function readEntities(source: string, issues: string[]): RawEntity[] {
  const tokens = tokenize(source);
  const entities: RawEntity[] = [];
  let i = 0;
  let error: string | null = null;
  outer: while (i < tokens.length) {
    if (!is(tokens[i], "{")) {
      error = `Unexpected "${tokens[i].text}" on line ${lineOf(source, tokens[i].start)}`;
      break;
    }
    const entity: RawEntity = { keys: [], primitives: [] };
    entities.push(entity);
    i++;
    for (;;) {
      const token = tokens[i];
      if (!token) {
        error = "The file ends inside an entity";
        break outer;
      }
      if (is(token, "}")) {
        i++;
        break;
      }
      if (token.quoted && tokens[i + 1]?.quoted) {
        entity.keys.push([token.text, tokens[i + 1].text]);
        i += 2;
      } else if (is(token, "{")) {
        const end = closing(tokens, i);
        if (end < 0) {
          error = "The file ends inside a brush or patch";
          break outer;
        }
        entity.primitives.push(readPrimitive(source, tokens.slice(i + 1, end)));
        i = end + 1;
      } else {
        error = `Unexpected "${token.text}" on line ${lineOf(source, token.start)}`;
        break outer;
      }
    }
  }
  if (!entities.some((entity) => entity.keys.some(([key]) => key === "classname")))
    throw new Error(`Not a Quake 3 .map file${error ? `: ${error}` : ""}`);
  if (error) issues.push(`${error}; everything after it was skipped`);
  return entities;
}

interface Solid {
  vertices: Vec3q[];
  /** Counterclockwise from outside; `face` indexes the source faces. */
  sides: Array<{ vertices: number[]; face: number; normal: Vec3q; distance: number }>;
}

const scaleVec = (v: Vec3q, s: number): Vec3q => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const addVec = (a: Vec3q, b: Vec3q): Vec3q => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const snap = (value: number): number => {
  const rounded = Math.round(value);
  return (Math.abs(value - rounded) < 1e-6 ? rounded : value) || 0;
};

/** The intersection of the faces' back half-spaces; q3map2's PlaneFromPoints gives outward normals. */
function solidFromPlanes(faces: readonly RawFace[]): Solid | "degenerate" | "complex" {
  const planes: Array<{ normal: Vec3q; distance: number; face: number }> = [];
  for (const [face, { points }] of faces.entries()) {
    const n = cross(subtract(points[0], points[1]), subtract(points[2], points[1]));
    const length = Math.hypot(n.x, n.y, n.z);
    if (!(length > 1e-9)) return "degenerate";
    const normal = scaleVec(n, 1 / length);
    const distance = dot(normal, points[0]);
    // A repeated plane adds nothing; the first one keeps its texture.
    if (planes.some((p) => dot(p.normal, normal) > 1 - 1e-9 && Math.abs(p.distance - distance) < 1e-4)) continue;
    planes.push({ normal, distance, face });
  }
  if (planes.length < 4) return "degenerate";
  if (planes.length > 256) return "complex";
  const found: Vec3q[] = [];
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const [a, b, c] = [planes[i], planes[j], planes[k]];
        const bc = cross(b.normal, c.normal);
        const det = dot(a.normal, bc);
        if (Math.abs(det) < 1e-9) continue;
        const p = scaleVec(
          addVec(
            addVec(scaleVec(bc, a.distance), scaleVec(cross(c.normal, a.normal), b.distance)),
            scaleVec(cross(a.normal, b.normal), c.distance),
          ),
          1 / det,
        );
        if (planes.some((q) => dot(q.normal, p) - q.distance > 1e-4)) continue;
        const v = { x: snap(p.x), y: snap(p.y), z: snap(p.z) };
        if (!found.some((q) => Math.hypot(q.x - v.x, q.y - v.y, q.z - v.z) < 1e-4)) found.push(v);
      }
  // Rounded, so the order survives the six decimals the writer prints.
  const key = (v: Vec3q) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e5));
  const vertices = found
    .map((v) => ({ v, key: key(v) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map(({ v }) => v);
  const sides: Solid["sides"] = [];
  for (const plane of planes) {
    const ids = vertices.flatMap((p, i) => (Math.abs(dot(plane.normal, p) - plane.distance) < 1e-4 ? [i] : []));
    if (ids.length < 3) continue; // touches the solid at an edge or corner, or misses it
    const center = scaleVec(
      ids.reduce((sum, i) => addVec(sum, vertices[i]), { x: 0, y: 0, z: 0 }),
      1 / ids.length,
    );
    const first = subtract(vertices[ids[0]], center);
    const u = scaleVec(first, 1 / Math.hypot(first.x, first.y, first.z));
    const v = cross(plane.normal, u);
    const angle = (i: number) => {
      const d = subtract(vertices[i], center);
      return Math.atan2(dot(d, v), dot(d, u));
    };
    ids.sort((a, b) => angle(a) - angle(b));
    const start = ids.indexOf(Math.min(...ids));
    sides.push({ ...plane, vertices: [...ids.slice(start), ...ids.slice(0, start)] });
  }
  if (sides.length < 4 || vertices.length < 4) return "degenerate";
  if (sides.length > 64 || vertices.length > 128) return "complex";
  return { vertices, sides };
}

/** q3map2 TextureAxisFromPlane: floor, ceiling, then the four walls. */
const BASE_AXES: ReadonlyArray<readonly [Vec3q, Vec3q, Vec3q]> = [
  [
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  ],
  [
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  ],
  [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 },
  ],
  [
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 },
  ],
  [
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ],
  [
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ],
];

/**
 * The face matrix for classic alignment. q3map2's QuakeTextureVecs gives
 * st = (p·vecs[i] + shift[i]) / size[i]; restricted to the face plane, that
 * is an affine map of the editor's (u, v) plane axes.
 */
function standardFaceMatrix(
  standard: StandardAlignment,
  normal: Vec3q,
  distance: number,
  axes: { u: Vec3q; v: Vec3q },
  size: readonly [number, number],
): TexMatrix {
  let best = 0;
  let bestAxis = 0;
  BASE_AXES.forEach(([axis], i) => {
    const value = dot(normal, axis);
    if (value > best + 0.0001) {
      best = value;
      bestAxis = i;
    }
  });
  const vecs = [BASE_AXES[bestAxis][1], BASE_AXES[bestAxis][2]].map((v) => [v.x, v.y, v.z]);
  const r = standard.rotation;
  const [sin, cos] =
    r === 0
      ? [0, 1]
      : r === 90
        ? [1, 0]
        : r === 180
          ? [0, -1]
          : r === 270
            ? [-1, 0]
            : [Math.sin((r * Math.PI) / 180), Math.cos((r * Math.PI) / 180)];
  const sv = vecs[0][0] ? 0 : vecs[0][1] ? 1 : 2;
  const tv = vecs[1][0] ? 0 : vecs[1][1] ? 1 : 2;
  for (const vec of vecs) {
    const [s, t] = [vec[sv], vec[tv]];
    vec[sv] = cos * s - sin * t;
    vec[tv] = sin * s + cos * t;
  }
  const origin = scaleVec(normal, distance);
  const rows = [0, 1].map((i) => {
    const k = 1 / ((standard.scale[i] || 1) * size[i]);
    const axis = { x: vecs[i][0] * k, y: vecs[i][1] * k, z: vecs[i][2] * k };
    const a = dot(axis, axes.u);
    const b = dot(axis, axes.v);
    return [a, b, dot(axis, origin) + standard.shift[i] / size[i] - a * dot(origin, axes.u) - b * dot(origin, axes.v)];
  });
  return rows as TexMatrix;
}

const tenth = (n: number): number => Number(n.toFixed(10));
/** Same export text, allowing whole-repeat offsets: matrixToFace wraps shift into one image. */
function sameMatrix(a: TexMatrix, b: TexMatrix): boolean {
  return [0, 1].every((row) => {
    const offset = a[row][2] - b[row][2];
    return (
      tenth(a[row][0]) === tenth(b[row][0]) &&
      tenth(a[row][1]) === tenth(b[row][1]) &&
      Math.abs(offset - Math.round(offset)) < 1e-10
    );
  });
}

/** Round shift, rotation, scale and skew to clean values, each only when the exported matrix stays the same. */
function tidyMaterial(raw: FaceMaterial, matrix: TexMatrix): FaceMaterial {
  const step = (value: number, size: number) => Number((Math.round(value / size) * size).toFixed(8)) || 0;
  const wrap = (value: number, period: number) => (value >= period ? value - period : value);
  const edits: Array<(face: FaceMaterial) => FaceMaterial> = [
    (face) => ({ ...face, shift: [wrap(step(face.shift[0], 1e-3), face.size[0]), face.shift[1]] }),
    (face) => ({ ...face, shift: [face.shift[0], wrap(step(face.shift[1], 1e-3), face.size[1])] }),
    (face) => ({ ...face, rotation: wrap(step(face.rotation, 1e-4), 360) }),
    (face) => ({ ...face, scale: [Number(face.scale[0].toPrecision(7)), face.scale[1]] }),
    (face) => ({ ...face, scale: [face.scale[0], Number(face.scale[1].toPrecision(7))] }),
    ({ skew, ...face }) => {
      const tidy = skew === undefined ? 0 : step(skew, 1e-4);
      return tidy ? { ...face, skew: tidy } : face;
    },
  ];
  return edits.reduce((face, edit) => {
    const next = edit(face);
    return sameMatrix(faceTexMatrix(next), matrix) ? next : face;
  }, raw);
}

function usableMaterial(face: FaceMaterial): boolean {
  return (
    [...face.shift, ...face.scale, face.rotation, face.skew ?? 0].every(Number.isFinite) &&
    face.scale.every((s) => s !== 0 && Math.abs(s) <= 10_000) &&
    (face.skew === undefined || Math.abs(Math.cos((face.skew * Math.PI) / 180)) >= 1e-8)
  );
}

/** MakeBSP adds textures/ itself; a name the document can't hold returns null. */
function cleanShader(name: string): string | null {
  const shader = name.replace(/^textures\//i, "");
  return SHADER.test(shader) && !shader.startsWith("/") && !shader.includes("..") ? shader : null;
}

function axialKey(n: Vec3q): FaceKey | null {
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(Math.abs(n[axis]) - 1) < 1e-9) return `${n[axis] > 0 ? "+" : "-"}${axis.toUpperCase()}` as FaceKey;
  }
  return null;
}

class Importer {
  private readonly notes = new Map<Note, number>();
  private readonly unknownSizes = new Set<string>();
  private readonly sizes = new Map<string, [number, number] | null>();
  private nextId = 0;
  readonly issues: string[] = [];

  constructor(
    private readonly options: MapImportOptions,
    private readonly idWidth: number,
  ) {}

  note(note: Note, count = 1): void {
    this.notes.set(note, (this.notes.get(note) ?? 0) + count);
  }

  /** IDs sort in source order, so export keeps the source's object order. */
  id(): string {
    return `import-${String(++this.nextId).padStart(this.idWidth, "0")}`;
  }

  report(): string[] {
    const lines = [
      ...this.issues,
      ...(Object.keys(NOTES) as Note[]).flatMap((note) =>
        this.notes.has(note) ? [NOTES[note](this.notes.get(note)!)] : [],
      ),
    ];
    if (this.unknownSizes.size) {
      const names = [...this.unknownSizes].sort();
      lines.push(
        `Assumed 64×64 images for ${plural(names.length, "texture")} with no known size (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}); pick them again to fix their alignment`,
      );
    }
    return lines;
  }

  private size(shader: string): [number, number] | null {
    if (!this.sizes.has(shader)) {
      const size = this.options.textureSize?.(shader);
      const valid = size?.length === 2 && size.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 16_384);
      this.sizes.set(shader, valid ? [size[0], size[1]] : null);
    }
    return this.sizes.get(shader)!;
  }

  private material(
    face: RawFace,
    shader: string,
    brushShader: string,
    side: Solid["sides"][number],
    axes: { u: Vec3q; v: Vec3q },
  ): FaceMaterial | undefined {
    const known = this.size(shader);
    const size = known ?? UNKNOWN_SIZE;
    const matrix = face.matrix ?? standardFaceMatrix(face.standard!, side.normal, side.distance, axes, size);
    if (shader === brushShader && sameMatrix(matrix, FIXED_MATRIX)) return undefined;
    // Tool textures under common/ draw nothing, so their alignment doesn't matter.
    if (face.standard && !known && !shader.startsWith("common/")) this.unknownSizes.add(shader);
    let material = matrixToFace(matrix, shader, size);
    if (usableMaterial(material)) material = tidyMaterial(material, matrix);
    else {
      this.note("alignment");
      material = matrixToFace(FIXED_MATRIX, shader, size);
    }
    if (!known) material.sizeKnown = false;
    return material;
  }

  brush(faces: readonly RawFace[]): BoxBrush | null {
    const solid = solidFromPlanes(faces);
    if (solid === "degenerate" || solid === "complex") {
      this.note(solid);
      return null;
    }
    const shaders = solid.sides.map((side) => cleanShader(faces[side.face].shader));
    if (shaders.some((shader) => shader === null)) {
      this.note("badShader");
      return null;
    }
    // The brush shader is the commonest one on the fixed alignment, so those faces need no override.
    const fixed = solid.sides.filter((side) => {
      const matrix = faces[side.face].matrix;
      return matrix && sameMatrix(matrix, FIXED_MATRIX);
    });
    const pool = (fixed.length ? fixed : solid.sides).map((side) => shaders[solid.sides.indexOf(side)]!);
    const counts = new Map<string, number>();
    for (const shader of pool) counts.set(shader, (counts.get(shader) ?? 0) + 1);
    const brushShader = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    // q3map2 takes every other content and surface flag from the shader, so only detail matters.
    const detail = solid.sides.some((side) => ((faces[side.face].flags[0] ?? 0) & DETAIL) !== 0);
    const keys = solid.sides.map((side) => axialKey(side.normal));
    const id = this.id();
    let brush: BoxBrush;
    if (solid.sides.length === 6 && keys.every(Boolean) && new Set(keys).size === 6) {
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const p of solid.vertices)
        for (const axis of ["x", "y", "z"] as const) {
          min[axis] = Math.min(min[axis], p[axis]);
          max[axis] = Math.max(max[axis], p[axis]);
        }
      brush = { id, min, max, shader: brushShader };
      const materials: Partial<Record<FaceKey, FaceMaterial>> = {};
      solid.sides.forEach((side, i) => {
        const key = keys[i]!;
        const axes = { u: FACE_AXES[key].texX, v: FACE_AXES[key].texY };
        const material = this.material(faces[side.face], shaders[i]!, brushShader, side, axes);
        if (material) materials[key] = material;
      });
      if (Object.keys(materials).length) brush.faces = materials;
    } else {
      const sides = solid.sides.map((side, i) => {
        const material = this.material(faces[side.face], shaders[i]!, brushShader, side, planeTextureAxes(side.normal));
        return { vertices: side.vertices, ...(material ? { material } : {}) };
      });
      try {
        brush = fromWorldHull(id, solid.vertices, sides, brushShader);
        validateHull(brush);
      } catch {
        this.note("degenerate");
        return null;
      }
    }
    if (detail) brush.detail = true;
    if (!fits({ brushes: [brush] })) {
      this.note("degenerate");
      return null;
    }
    return brush;
  }

  patch(text: string): PatchSurface | null {
    const parsed = MapParser.parse(`{\npatchDef2\n${text}\n}\n`)[0]?.patches[0];
    if (!parsed) {
      this.note("unreadablePatch");
      return null;
    }
    const { width, height } = parsed;
    if (width % 2 === 0 || height % 2 === 0 || width < 3 || height < 3 || width > 31 || height > 31) {
      this.note("patchSize");
      return null;
    }
    const shader = cleanShader(parsed.texture);
    const patch: PatchSurface = {
      id: this.id(),
      shader: shader ?? "",
      width,
      height,
      controlPoints: parsed.controlPoints.map((row) => row.map(({ x, y, z, u, v }) => ({ x, y, z, u, v }))),
    };
    if (!shader || !fits({ patches: [patch] })) {
      this.note("badPatch");
      return null;
    }
    return patch;
  }

  /** Keys the document can store; `reserved` ones are dropped and noted as `reservedNote`. */
  keys(
    pairs: ReadonlyArray<[string, string]>,
    reserved: readonly string[],
    reservedNote?: Note,
  ): Record<string, string> {
    const keys: Record<string, string> = {};
    let count = 0;
    let truncated = false;
    for (const [key, value] of pairs) {
      if (key === "classname") continue;
      if (reserved.includes(key)) {
        if (reservedNote) this.note(reservedNote);
        continue;
      }
      if (!ENTITY_KEY.test(key) || value.length > 1024 || /["\r\n]/.test(value)) {
        this.note("badKey");
        continue;
      }
      if (!(key in keys) && count === 64) {
        truncated = true;
        continue;
      }
      if (!(key in keys)) count++;
      keys[key] = value;
    }
    if (truncated) this.note("manyKeys");
    return keys;
  }
}

function fits(part: Partial<EditorDocumentData>): boolean {
  try {
    validateDocument({ schemaVersion: 2, draftId: "import", revision: 0, brushes: [], entities: [], ...part });
    return true;
  } catch {
    return false;
  }
}

function parseOrigin(value: string | undefined): Vec3q | null {
  const parts = value?.trim().split(/\s+/).map(Number);
  if (parts?.length !== 3 || !parts.every((n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000)) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

/**
 * Reads .map source into a new document. Throws only when the text isn't a
 * .map at all; anything inside it the editor can't represent is skipped and
 * described in `issues`.
 */
export function importMapSource(source: string, options: MapImportOptions): MapImportResult {
  const early: string[] = [];
  const entities = readEntities(source, early);
  const total = entities.reduce((sum, entity) => sum + 2 + entity.primitives.length, 0);
  const importer = new Importer(options, Math.max(4, String(total).length));
  importer.issues.push(...early);
  const data: EditorDocumentData = {
    schemaVersion: 2,
    draftId: options.draftId,
    ...(options.mapName !== undefined ? { mapName: options.mapName } : {}),
    revision: 0,
    brushes: [],
    patches: [],
    entities: [],
    brushEntities: [],
  };
  const patches = data.patches!;
  const groups: NonNullable<EditorDocumentData["editorGroups"]> = [];
  const room = (list: unknown[]) => {
    if (list.length < MAX_OBJECTS) return true;
    importer.note("tooMany");
    return false;
  };
  let world = false;
  for (const entity of entities) {
    const classname = entity.keys.find(([key]) => key === "classname")?.[1] ?? "";
    for (const primitive of entity.primitives) if (primitive.kind === "skip") importer.note(primitive.skip);
    const brushes = entity.primitives.flatMap((p) => (p.kind === "brush" ? [p.faces] : []));
    const patchTexts = entity.primitives.flatMap((p) => (p.kind === "patch" ? [p.text] : []));
    if (classname === "worldspawn" || classname === "func_group") {
      // func_group is an editor convenience MakeBSP merges into the world; it becomes an editor group.
      if (classname === "worldspawn" && world) importer.note("extraWorld");
      const groupId = classname === "func_group" ? importer.id() : null;
      const members: string[] = [];
      // Source order, so IDs keep brushes and patches interleaved as they were.
      for (const primitive of entity.primitives) {
        if (primitive.kind === "brush") {
          const brush = room(data.brushes) && importer.brush(primitive.faces);
          if (!brush) continue;
          data.brushes.push(brush);
          members.push(brush.id);
        } else if (primitive.kind === "patch") {
          const patch = room(patches) && importer.patch(primitive.text);
          if (!patch) continue;
          patches.push(patch);
          members.push(patch.id);
        }
      }
      if (classname === "worldspawn" && !world) {
        world = true;
        const keys = importer.keys(entity.keys, ["origin", "model"], "reservedKey");
        if (Object.keys(keys).length) data.worldKeys = keys;
      } else if (groupId) {
        const extra = entity.keys.filter(([key]) => key !== "classname" && !key.startsWith("_tb_")).length;
        if (extra) importer.note("groupKey", extra);
        const name = entity.keys
          .find(([key]) => key === "_tb_name")?.[1]
          ?.trim()
          .slice(0, 64);
        if (members.length > 1)
          groups.push({ id: groupId, name: name || `func_group ${groups.length + 1}`, objectIds: members });
      }
      continue;
    }
    if (!ENTITY_KEY.test(classname)) {
      importer.note("noClassname");
      continue;
    }
    const id = importer.id();
    if (brushes.length || patchTexts.length) {
      if (patchTexts.length) importer.note("entityPatch", patchTexts.length);
      const owned: string[] = [];
      for (const faces of brushes) {
        const brush = room(data.brushes) && importer.brush(faces);
        if (!brush) continue;
        data.brushes.push(brush);
        owned.push(brush.id);
      }
      if (!owned.length) {
        importer.note("emptyEntity");
        continue;
      }
      const brushEntity: BrushEntity = {
        id,
        classname,
        keys: importer.keys(entity.keys, ["origin", "model"], "reservedKey"),
        brushIds: owned,
      };
      data.brushEntities!.push(brushEntity);
      continue;
    }
    if (!room(data.entities)) continue;
    const origin = parseOrigin([...entity.keys].reverse().find(([key]) => key === "origin")?.[1]);
    if (!origin) importer.note("noOrigin");
    const point: PointEntity = {
      id,
      classname,
      origin: origin ?? { x: 0, y: 0, z: 0 },
      keys: importer.keys(entity.keys, ["origin"]),
    };
    if (modelReferenceIssue(point)) importer.note("modelPath");
    data.entities.push(point);
  }
  if (!world) importer.issues.push("The map has no worldspawn entity");
  if (groups.length) data.editorGroups = groups;
  validateDocument(data);
  return { data, issues: importer.report() };
}
