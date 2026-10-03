/** Pure Quake-space authoring state. Babylon meshes and pane state are derived. */
export interface Vec3q {
  x: number;
  y: number;
  z: number;
}
export interface BoxBrush {
  id: string;
  min: Vec3q;
  max: Vec3q;
  shader: string;
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
  revision: number;
  brushes: BoxBrush[];
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
  if (data.schemaVersion !== 1) return { ...data, brushEntities: data.brushEntities ?? [] };
  const { testSpawn, ...rest } = data;
  return {
    ...rest,
    schemaVersion: 2,
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
  if (!Array.isArray(data.brushes) || data.brushes.length > 20_000) throw new Error("Invalid brush list");
  if (!Array.isArray(data.entities) || data.entities.length > 20_000) throw new Error("Invalid entity list");
  const ids = new Set<string>();
  for (const brush of data.brushes) {
    if (!brush.id || ids.has(brush.id)) throw new Error("Duplicate or missing brush ID");
    ids.add(brush.id);
    if (!SHADER.test(brush.shader) || brush.shader.startsWith("/") || brush.shader.includes("..")) {
      throw new Error(`Invalid shader on brush ${brush.id}`);
    }
    for (const axis of ["x", "y", "z"] as const) {
      const lo = brush.min[axis];
      const hi = brush.max[axis];
      if (!validCoordinate(lo) || !validCoordinate(hi) || lo >= hi) {
        throw new Error(`Invalid ${axis} bounds on brush ${brush.id}`);
      }
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
      : { schemaVersion: 2, draftId: crypto.randomUUID(), revision: 0, brushes: [], entities: [], brushEntities: [] };
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
