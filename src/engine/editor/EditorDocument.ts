/** Pure Quake-space authoring state. Babylon meshes and pane state are derived. */
export interface Vec3q {
  x: number;
  y: number;
  z: number;
}
export type FaceKey = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export const FACE_KEYS: readonly FaceKey[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

/** One box face's material and alignment; see FaceUv.ts for how it becomes the face matrix. */
export interface FaceMaterial {
  /** Unprefixed, e.g. "blx/blx_dark": MakeBSP adds "textures/" itself. */
  shader: string;
  /** Texels. */
  shift: [number, number];
  /** World units per texel; negative flips. */
  scale: [number, number];
  /** Degrees. */
  rotation: number;
  /** The image's size in texels, recorded when the texture is assigned. */
  size: [number, number];
}

export interface BoxBrush {
  id: string;
  min: Vec3q;
  max: Vec3q;
  /** Every face without an override uses this shader and the fixed legacy alignment. */
  shader: string;
  /** Per-face overrides; absent in brushes made before face materials existed. */
  faces?: Partial<Record<FaceKey, FaceMaterial>>;
}
/** A Quake-space patchDef2 surface. Rows are V (height), columns are U (width). */
export interface PatchSurface {
  id: string;
  shader: string;
  width: number;
  height: number;
  controlPoints: Array<Array<Vec3q & { u: number; v: number }>>;
}
/** A point entity. `keys` holds every key except classname and origin, unknown ones included. */
export interface PointEntity {
  id: string;
  classname: string;
  origin: Vec3q;
  keys: Record<string, string>;
}
/**
 * A brush entity (trigger, door, plat) owns brushes by ID; owned brushes leave
 * worldspawn. `keys` never holds origin (the engine adds it to the already
 * world-space submodel box) or model (MakeBSP assigns `*N`).
 */
export interface BrushEntity {
  id: string;
  classname: string;
  keys: Record<string, string>;
  brushIds: string[];
}
export interface EditorDocumentData {
  schemaVersion: 2;
  draftId: string;
  /** Optional stable runtime name; older drafts retain their generated draft_<id> name. */
  mapName?: string;
  /** Compiler and runtime worldspawn settings, excluding structural identity keys. */
  worldKeys?: Record<string, string>;
  revision: number;
  brushes: BoxBrush[];
  /** Additive to v2 so existing drafts and server sidecars remain readable. */
  patches?: PatchSurface[];
  entities: PointEntity[];
  /** Absent in drafts saved before brush entities existed; read as empty. */
  brushEntities?: BrushEntity[];
}
/** Version 1 drafts had boxes and one optional test spawn. */
export interface EditorDocumentDataV1 {
  schemaVersion: 1;
  draftId: string;
  revision: number;
  brushes: BoxBrush[];
  testSpawn?: Vec3q;
}

const SHADER = /^[a-zA-Z0-9_./-]+$/;
/** Entity classnames and key names: what MakeBSP and the engine's entity lump readers accept. */
export const ENTITY_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_KEYS = new Set(["classname", "origin"]);
const RESERVED_BRUSH_ENTITY_KEYS = new Set(["classname", "origin", "model"]);
const MAX_KEYS = 64;
const MAX_VALUE_LENGTH = 1024;

/** Upgrades an older draft; a version 1 test spawn becomes an ordinary spawn entity. */
export function migrateDocument(data: EditorDocumentData | EditorDocumentDataV1): EditorDocumentData {
  if (data.schemaVersion !== 1)
    return { ...data, patches: data.patches ?? [], brushEntities: data.brushEntities ?? [] };
  const { testSpawn, ...rest } = data;
  return {
    ...rest,
    schemaVersion: 2,
    patches: [],
    brushEntities: [],
    entities: testSpawn
      ? [{ id: "test-spawn", classname: "info_player_deathmatch", origin: { ...testSpawn }, keys: {} }]
      : [],
  };
}

function validCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

export function validateDocument(data: EditorDocumentData): void {
  if (data.schemaVersion !== 2 || !data.draftId || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw new Error("Invalid editor document header");
  }
  if (data.mapName !== undefined && !/^[a-z][a-z0-9_]{0,47}$/.test(data.mapName))
    throw new Error("Map ID must be 1–48 lowercase letters, digits or underscores, starting with a letter");
  if (data.worldKeys !== undefined) {
    if (!data.worldKeys || typeof data.worldKeys !== "object" || Array.isArray(data.worldKeys))
      throw new Error("Invalid worldspawn keys");
    validateKeys("worldspawn", data.worldKeys, RESERVED_BRUSH_ENTITY_KEYS);
  }
  if (!Array.isArray(data.brushes) || data.brushes.length > 20_000) throw new Error("Invalid brush list");
  if (data.patches !== undefined && (!Array.isArray(data.patches) || data.patches.length > 20_000)) {
    throw new Error("Invalid patch list");
  }
  if (!Array.isArray(data.entities) || data.entities.length > 20_000) throw new Error("Invalid entity list");
  const ids = new Set<string>();
  for (const brush of data.brushes) {
    if (!brush.id || ids.has(brush.id)) throw new Error("Duplicate or missing brush ID");
    ids.add(brush.id);
    if (!SHADER.test(brush.shader) || brush.shader.startsWith("/") || brush.shader.includes("..")) {
      throw new Error(`Invalid shader on brush ${brush.id}`);
    }
    validateFaces(brush);
    for (const axis of ["x", "y", "z"] as const) {
      const lo = brush.min[axis];
      const hi = brush.max[axis];
      if (!validCoordinate(lo) || !validCoordinate(hi) || lo >= hi) {
        throw new Error(`Invalid ${axis} bounds on brush ${brush.id}`);
      }
    }
  }
  for (const patch of data.patches ?? []) {
    if (!patch.id || ids.has(patch.id)) throw new Error("Duplicate or missing patch ID");
    ids.add(patch.id);
    if (
      !SHADER.test(patch.shader) ||
      patch.shader.startsWith("/") ||
      patch.shader.includes("..") ||
      patch.shader.toLowerCase().startsWith("textures/")
    ) {
      throw new Error(`Invalid shader on patch ${patch.id}`);
    }
    if (
      !Number.isSafeInteger(patch.width) ||
      !Number.isSafeInteger(patch.height) ||
      patch.width < 3 ||
      patch.height < 3 ||
      patch.width > 31 ||
      patch.height > 31 ||
      patch.width % 2 !== 1 ||
      patch.height % 2 !== 1
    ) {
      throw new Error(`Invalid dimensions on patch ${patch.id}`);
    }
    if (
      !Array.isArray(patch.controlPoints) ||
      patch.controlPoints.length !== patch.height ||
      patch.controlPoints.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== patch.width ||
          row.some(
            (control) =>
              !control ||
              !validCoordinate(control.x) ||
              !validCoordinate(control.y) ||
              !validCoordinate(control.z) ||
              !validCoordinate(control.u) ||
              !validCoordinate(control.v),
          ),
      )
    ) {
      throw new Error(`Invalid control grid on patch ${patch.id}`);
    }
  }
  for (const entity of data.entities) {
    if (!entity.id || ids.has(entity.id)) throw new Error("Duplicate or missing entity ID");
    ids.add(entity.id);
    if (!ENTITY_KEY.test(entity.classname) || entity.classname === "worldspawn") {
      throw new Error(`Invalid classname on entity ${entity.id}`);
    }
    for (const axis of ["x", "y", "z"] as const) {
      if (!validCoordinate(entity.origin?.[axis])) throw new Error(`Invalid origin ${axis} on entity ${entity.id}`);
    }
    validateKeys(entity.id, entity.keys, RESERVED_KEYS);
  }
  const owners = new Map<string, string>();
  const brushIds = new Set(data.brushes.map((brush) => brush.id));
  for (const entity of data.brushEntities ?? []) {
    if (!entity.id || ids.has(entity.id)) throw new Error("Duplicate or missing entity ID");
    ids.add(entity.id);
    if (!ENTITY_KEY.test(entity.classname) || entity.classname === "worldspawn") {
      throw new Error(`Invalid classname on entity ${entity.id}`);
    }
    validateKeys(entity.id, entity.keys, RESERVED_BRUSH_ENTITY_KEYS);
    if (!Array.isArray(entity.brushIds) || entity.brushIds.length === 0) {
      throw new Error(`Brush entity ${entity.id} owns no brushes`);
    }
    for (const brushId of entity.brushIds) {
      if (!brushIds.has(brushId)) throw new Error(`Brush entity ${entity.id} references missing brush ${brushId}`);
      const owner = owners.get(brushId);
      if (owner) throw new Error(`Brush ${brushId} is owned by both ${owner} and ${entity.id}`);
      owners.set(brushId, entity.id);
    }
  }
}

const MAX_TEXTURE_SIZE = 16_384;

function validateFaces(brush: BoxBrush): void {
  if (brush.faces === undefined) return;
  if (!brush.faces || typeof brush.faces !== "object") throw new Error(`Invalid faces on brush ${brush.id}`);
  for (const [key, face] of Object.entries(brush.faces)) {
    const where = `face ${key} of brush ${brush.id}`;
    if (!FACE_KEYS.includes(key as FaceKey) || !face) throw new Error(`Invalid ${where}`);
    if (!SHADER.test(face.shader) || face.shader.startsWith("/") || face.shader.includes("..")) {
      throw new Error(`Invalid shader on ${where}`);
    }
    // MakeBSP prepends textures/ itself; a prefixed name compiles but loses its image and lightmap.
    if (face.shader.toLowerCase().startsWith("textures/")) {
      throw new Error(`Shader on ${where} must not start with textures/`);
    }
    const numbers = [...face.shift, ...face.scale, face.rotation];
    if (face.shift?.length !== 2 || face.scale?.length !== 2 || !numbers.every(Number.isFinite)) {
      throw new Error(`Invalid alignment on ${where}`);
    }
    if (face.scale.some((value) => value === 0 || Math.abs(value) > 10_000)) {
      throw new Error(`Invalid scale on ${where}`);
    }
    const [w, h] = face.size ?? [];
    if (![w, h].every((n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_TEXTURE_SIZE)) {
      throw new Error(`Invalid image size on ${where}`);
    }
  }
}

function validateKeys(id: string, keyMap: Record<string, string> | undefined, reserved: ReadonlySet<string>): void {
  const keys = Object.entries(keyMap ?? {});
  if (keys.length > MAX_KEYS) throw new Error(`Too many keys on entity ${id}`);
  for (const [key, value] of keys) {
    if (!ENTITY_KEY.test(key) || reserved.has(key)) throw new Error(`Invalid key "${key}" on entity ${id}`);
    // A .map value is a double-quoted string with no escape syntax.
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH || /["\r\n]/.test(value)) {
      throw new Error(`Invalid value for "${key}" on entity ${id}`);
    }
  }
}

/**
 * Drops brushes from brush entities when they no longer exist and removes
 * entities left with none, so deleting a brush can never leave a dangling
 * reference or an empty trigger. Mutates the draft passed to a transaction.
 */
export function pruneBrushEntities(data: EditorDocumentData): void {
  const present = new Set(data.brushes.map((brush) => brush.id));
  data.brushEntities = (data.brushEntities ?? [])
    .map((entity) => ({ ...entity, brushIds: entity.brushIds.filter((id) => present.has(id)) }))
    .filter((entity) => entity.brushIds.length > 0);
}

/** The brush entity that owns a brush, if any. */
export function ownerOf(data: EditorDocumentData, brushId: string): BrushEntity | undefined {
  return data.brushEntities?.find((entity) => entity.brushIds.includes(brushId));
}

function copy(data: EditorDocumentData): EditorDocumentData {
  return structuredClone(data);
}

export class EditorDocument {
  private data: EditorDocumentData;
  private undoStack: EditorDocumentData[] = [];
  private redoStack: EditorDocumentData[] = [];

  constructor(data?: EditorDocumentData | EditorDocumentDataV1) {
    this.data = data
      ? copy(migrateDocument(data))
      : {
          schemaVersion: 2,
          draftId: crypto.randomUUID(),
          revision: 0,
          brushes: [],
          patches: [],
          entities: [],
          brushEntities: [],
        };
    validateDocument(this.data);
  }

  snapshot(): EditorDocumentData {
    return copy(this.data);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  transact(change: (draft: EditorDocumentData) => void): void {
    const next = copy(this.data);
    change(next);
    validateDocument(next);
    this.undoStack.push(this.data);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    next.revision = this.data.revision + 1;
    this.data = next;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.data);
    this.data = { ...previous, revision: this.data.revision + 1 };
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.data);
    this.data = { ...next, revision: this.data.revision + 1 };
  }
}
