/**
 * Typed edit operations over the SHAGGED map document, for scripts and AI
 * agents. Pure: no DOM, Babylon or server. A batch applies as one validated
 * transaction (one undo step in the editor) or not at all.
 *
 * Coordinates are Quake units, Z up. IDs are readable and deterministic:
 * callers may name objects, otherwise the next free `brush-N`, `ent-N`,
 * `bent-N` is used, so the same script always yields the same document.
 */

import { fromWorldHull, type HullSide, prismBrush, rotateBrush } from "../ConvexBrush";
import {
  type BoxBrush,
  type EditorDocumentData,
  FACE_KEYS,
  type FaceKey,
  migrateDocument,
  type PatchSurface,
  pruneBrushEntities,
  type Vec3q,
  validateDocument,
} from "../EditorDocument";
import { brushEntityShader } from "../EntityCatalog";
import { naturalFace } from "../FaceUv";
import { inspectMapHealth, type MapHealthIssue } from "../MapHealth";
import { boxesOverlap, subtractBox } from "./BoxCsg";
import { alignCreatedBrush, type CreationMaterials } from "./CreationMaterials";
import {
  type ConnectSpec,
  type CorridorSpec,
  generateConnect,
  generateCorridor,
  generateJumpPad,
  generateRoom,
  generateStairs,
  generateTeleporter,
  type JumpPadSpec,
  type Linked,
  type RoomSpec,
  type StairsSpec,
  type TeleporterSpec,
} from "./Generators";

export const DEFAULT_SHADER = "blx/blx_grid";

export type EditOp =
  | ({
      op: "convex.create";
      id?: string;
      vertices: Vec3q[];
      sides: HullSide[];
      shader?: string;
      detail?: boolean;
    } & CreationMaterials)
  | ({
      op: "gen.prism";
      id: string;
      footprint: Array<{ x: number; y: number }>;
      bottom: number;
      top: number;
      shader?: string;
      detail?: boolean;
    } & CreationMaterials)
  | { op: "brush.rotate"; id: string; axis: keyof Vec3q; degrees: number; pivot?: Vec3q }
  | { op: "world.keys"; keys: Record<string, string> }
  | ({ op: "patch.create" } & Omit<PatchSurface, "id"> & { id?: string })
  | ({ op: "box.create"; id?: string; min: Vec3q; max: Vec3q; shader?: string; detail?: boolean } & CreationMaterials)
  | { op: "box.update"; id: string; min?: Vec3q; max?: Vec3q; shader?: string; detail?: boolean }
  | {
      op: "face.material";
      id: string;
      faces: FaceKey[] | number[] | "all";
      shader: string;
      /** The image's size in texels; required except for common/* tool shaders. */
      size?: [number, number];
    }
  | { op: "entity.place"; id?: string; classname: string; origin: Vec3q; keys?: Record<string, string> }
  | { op: "entity.update"; id: string; classname?: string; origin?: Vec3q; keys?: Record<string, string> }
  | { op: "brushEntity.assign"; id?: string; classname: string; brushIds: string[]; keys?: Record<string, string> }
  | { op: "object.move"; ids: string[]; delta: Vec3q }
  | { op: "object.duplicate"; ids: string[]; delta: Vec3q; suffix?: string }
  | { op: "object.delete"; ids: string[] }
  | ({ op: "gen.room" } & RoomSpec & CreationMaterials)
  | { op: "brush.carve"; min: Vec3q; max: Vec3q }
  | ({ op: "gen.corridor" } & CorridorSpec & CreationMaterials)
  | ({ op: "gen.connect" } & ConnectSpec & CreationMaterials)
  | ({ op: "gen.stairs" } & StairsSpec & CreationMaterials)
  | ({ op: "gen.teleporter" } & TeleporterSpec & CreationMaterials)
  | ({ op: "gen.jumppad" } & JumpPadSpec & CreationMaterials);

export interface ApplyResult {
  doc: EditorDocumentData;
  created: string[];
  changed: string[];
  deleted: string[];
  issues: MapHealthIssue[];
  worldChanged: boolean;
}

export class OperationError extends Error {
  constructor(
    readonly index: number,
    readonly operation: string,
    message: string,
  ) {
    super(`op ${index} (${operation}): ${message}`);
  }
}

/** Tool shaders whose look does not depend on texture size. */
const isToolShader = (shader: string) => shader.startsWith("common/");

/**
 * Apply a batch. Throws {@link OperationError} naming the first failing
 * operation; the input document is never modified.
 */
export function applyOperations(input: EditorDocumentData, ops: readonly EditOp[]): ApplyResult {
  const doc = structuredClone(migrateDocument(input));
  const before = new Set(allIds(doc));
  const changed = new Set<string>();
  ops.forEach((op, index) => {
    try {
      applyOne(doc, op, changed);
      // Validate after every operation so an error names the one that caused it.
      pruneBrushEntities(doc);
      validateDocument(doc);
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError(index, op?.op ?? "?", error instanceof Error ? error.message : String(error));
    }
  });
  pruneBrushEntities(doc);
  try {
    validateDocument(doc);
  } catch (error) {
    throw new OperationError(ops.length - 1, "batch", error instanceof Error ? error.message : String(error));
  }
  if (ops.length > 0) doc.revision = input.revision + 1;
  const after = new Set(allIds(doc));
  return {
    doc,
    created: [...after].filter((id) => !before.has(id)),
    changed: [...changed].filter((id) => before.has(id) && after.has(id)),
    deleted: [...before].filter((id) => !after.has(id)),
    issues: inspectMapHealth(doc),
    worldChanged: JSON.stringify(input.worldKeys ?? {}) !== JSON.stringify(doc.worldKeys ?? {}),
  };
}

/** A new, empty document. */
export function emptyDocument(mapName?: string): EditorDocumentData {
  const doc: EditorDocumentData = {
    schemaVersion: 2,
    draftId: crypto.randomUUID(),
    revision: 0,
    brushes: [],
    patches: [],
    entities: [],
    brushEntities: [],
  };
  if (mapName) doc.mapName = mapName;
  validateDocument(doc);
  return doc;
}

function allIds(doc: EditorDocumentData): string[] {
  return [
    ...doc.brushes.map((b) => b.id),
    ...(doc.patches ?? []).map((p) => p.id),
    ...doc.entities.map((e) => e.id),
    ...(doc.brushEntities ?? []).map((e) => e.id),
  ];
}

/** The next unused `<prefix>-N`. */
export function nextId(doc: EditorDocumentData, prefix: string): string {
  const used = new Set(allIds(doc));
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

function claimId(doc: EditorDocumentData, id: string | undefined, prefix: string): string {
  if (id === undefined) return nextId(doc, prefix);
  if (!/^[A-Za-z0-9_.:+-]{1,96}$/.test(id)) throw new Error(`invalid id "${id}": use letters, digits and _ . : + -`);
  if (allIds(doc).includes(id)) throw new Error(`id "${id}" already exists`);
  return id;
}

function vec(value: Vec3q | undefined, name: string): Vec3q {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${name} must be {x, y, z} with finite numbers`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function brush(doc: EditorDocumentData, id: string): BoxBrush {
  const found = doc.brushes.find((b) => b.id === id);
  if (!found) throw new Error(`no brush "${id}"`);
  return found;
}

function mergeKeys(target: Record<string, string>, keys: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(keys ?? {})) {
    if (value === "") delete target[key];
    else target[key] = value;
  }
}

const add = (a: Vec3q, b: Vec3q): Vec3q => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

function applyOne(doc: EditorDocumentData, op: EditOp, changed: Set<string>): void {
  switch (op.op) {
    case "convex.create": {
      const id = claimId(doc, op.id, "brush");
      doc.brushes.push(
        alignCreatedBrush(fromWorldHull(id, op.vertices, op.sides, op.shader ?? DEFAULT_SHADER, op.detail), op),
      );
      return;
    }
    case "gen.prism": {
      const id = claimId(doc, op.id, "brush");
      doc.brushes.push(
        alignCreatedBrush(prismBrush(id, op.footprint, op.bottom, op.top, op.shader ?? DEFAULT_SHADER, op.detail), op),
      );
      return;
    }
    case "brush.rotate": {
      const target = brush(doc, op.id);
      doc.brushes[doc.brushes.indexOf(target)] = rotateBrush(target, op.axis, op.degrees, op.pivot);
      changed.add(op.id);
      return;
    }
    case "world.keys": {
      doc.worldKeys ??= {};
      mergeKeys(doc.worldKeys, op.keys);
      return;
    }
    case "patch.create": {
      const id = claimId(doc, op.id, "patch");
      const { shader, width, height, controlPoints } = op;
      doc.patches ??= [];
      doc.patches.push({ id, shader, width, height, controlPoints: structuredClone(controlPoints) });
      return;
    }
    case "box.create": {
      const id = claimId(doc, op.id, "brush");
      doc.brushes.push(
        alignCreatedBrush(
          { id, min: vec(op.min, "min"), max: vec(op.max, "max"), shader: op.shader ?? DEFAULT_SHADER },
          op,
        ),
      );
      if (op.detail !== undefined) doc.brushes[doc.brushes.length - 1].detail = op.detail;
      return;
    }
    case "box.update": {
      const target = brush(doc, op.id);
      if (op.min) target.min = vec(op.min, "min");
      if (op.max) target.max = vec(op.max, "max");
      if (op.shader) target.shader = op.shader;
      if (op.detail !== undefined) target.detail = op.detail;
      changed.add(op.id);
      return;
    }
    case "face.material": {
      const target = brush(doc, op.id);
      if (target.hull) {
        const indices = op.faces === "all" ? target.hull.sides.map((_, i) => i) : op.faces;
        if (
          !Array.isArray(indices) ||
          !indices.length ||
          indices.some((i) => !Number.isSafeInteger(i) || Number(i) < 0 || Number(i) >= target.hull!.sides.length)
        )
          throw new Error("Convex faces must be all or valid numeric side indices");
        const size = op.size ?? (isToolShader(op.shader) ? ([64, 64] as [number, number]) : undefined);
        if (!size) throw new Error(`unknown texture ${op.shader}: no image size`);
        for (const index of indices) target.hull.sides[Number(index)].material = naturalFace(op.shader, [...size]);
        changed.add(op.id);
        return;
      }
      const faces = op.faces === "all" ? FACE_KEYS : op.faces;
      // Array.isArray would widen the readonly FaceKey[] to any[].
      if (!faces?.length || typeof faces === "string" || faces.some((f) => !FACE_KEYS.includes(f as FaceKey))) {
        throw new Error(`faces must be "all" or a list of ${FACE_KEYS.join(", ")}`);
      }
      const size = op.size ?? (isToolShader(op.shader) ? ([64, 64] as [number, number]) : undefined);
      if (!size)
        throw new Error(`unknown texture ${op.shader}: no image size; find texture names with the texture search`);
      target.faces ??= {};
      for (const face of faces) target.faces[face as FaceKey] = naturalFace(op.shader, [...size]);
      changed.add(op.id);
      return;
    }
    case "entity.place": {
      const id = claimId(doc, op.id, "ent");
      doc.entities.push({
        id,
        classname: op.classname,
        origin: vec(op.origin, "origin"),
        keys: { ...(op.keys ?? {}) },
      });
      return;
    }
    case "entity.update": {
      const target = doc.entities.find((e) => e.id === op.id) ?? doc.brushEntities?.find((e) => e.id === op.id);
      if (!target) throw new Error(`no entity "${op.id}"`);
      if (op.classname) target.classname = op.classname;
      if (op.origin) {
        if (!("origin" in target)) throw new Error(`brush entity "${op.id}" has no origin; move its brushes`);
        target.origin = vec(op.origin, "origin");
      }
      mergeKeys(target.keys, op.keys);
      changed.add(op.id);
      return;
    }
    case "brushEntity.assign": {
      if (!Array.isArray(op.brushIds) || op.brushIds.length === 0) throw new Error("brushIds must list brushes");
      const owned = op.brushIds.map((id) => brush(doc, id));
      // A brush belongs to one entity: take it from any previous owner.
      for (const entity of doc.brushEntities ?? []) {
        entity.brushIds = entity.brushIds.filter((id) => !op.brushIds.includes(id));
      }
      const id = claimId(doc, op.id, "bent");
      doc.brushEntities ??= [];
      doc.brushEntities.push({ id, classname: op.classname, keys: { ...(op.keys ?? {}) }, brushIds: [...op.brushIds] });
      const shader = brushEntityShader(op.classname);
      if (shader)
        for (const b of owned) {
          b.shader = shader;
          delete b.faces;
          for (const side of b.hull?.sides ?? []) delete side.material;
          changed.add(b.id);
        }
      return;
    }
    case "object.move": {
      const delta = vec(op.delta, "delta");
      for (const id of op.ids) moveObject(doc, id, delta);
      for (const id of op.ids) changed.add(id);
      return;
    }
    case "object.duplicate": {
      const delta = vec(op.delta, "delta");
      const suffix = op.suffix ?? "copy";
      for (const id of op.ids) duplicateObject(doc, id, delta, suffix);
      return;
    }
    case "object.delete": {
      const ids = new Set(op.ids);
      for (const id of ids) if (!allIds(doc).includes(id)) throw new Error(`no object "${id}"`);
      doc.brushes = doc.brushes.filter((b) => !ids.has(b.id));
      doc.patches = (doc.patches ?? []).filter((p) => !ids.has(p.id));
      doc.entities = doc.entities.filter((e) => !ids.has(e.id));
      doc.brushEntities = (doc.brushEntities ?? []).filter((e) => !ids.has(e.id));
      return;
    }
    case "gen.room": {
      const out = generateRoom(op);
      for (const b of out.brushes) doc.brushes.push(alignCreatedBrush({ ...b, id: claimId(doc, b.id, "brush") }, op));
      for (const e of out.entities) doc.entities.push({ ...e, id: claimId(doc, e.id, "ent") });
      return;
    }
    case "gen.corridor": {
      const out = generateCorridor(op);
      for (const b of out.brushes) doc.brushes.push(alignCreatedBrush({ ...b, id: claimId(doc, b.id, "brush") }, op));
      for (const e of out.entities) doc.entities.push({ ...e, id: claimId(doc, e.id, "ent") });
      return;
    }
    case "brush.carve": {
      for (const id of carve(doc, { min: vec(op.min, "min"), max: vec(op.max, "max") })) changed.add(id);
      return;
    }
    case "gen.connect": {
      const out = generateConnect(op);
      carve(doc, out.carve);
      for (const b of out.brushes) doc.brushes.push(alignCreatedBrush({ ...b, id: claimId(doc, b.id, "brush") }, op));
      for (const e of out.entities) doc.entities.push({ ...e, id: claimId(doc, e.id, "ent") });
      return;
    }
    case "gen.teleporter":
    case "gen.jumppad": {
      const out: Linked = op.op === "gen.teleporter" ? generateTeleporter(op) : generateJumpPad(op);
      const brushIds = out.trigger.map((b) => {
        const id = claimId(doc, b.id, "brush");
        doc.brushes.push(alignCreatedBrush({ ...b, id }, op));
        return id;
      });
      doc.brushEntities ??= [];
      doc.brushEntities.push({ id: claimId(doc, op.id, "bent"), classname: out.classname, keys: out.keys, brushIds });
      for (const e of out.entities) doc.entities.push({ ...e, id: claimId(doc, e.id, "ent") });
      return;
    }
    case "gen.stairs": {
      for (const b of generateStairs(op).brushes)
        doc.brushes.push(alignCreatedBrush({ ...b, id: claimId(doc, b.id, "brush") }, op));
      return;
    }
    default:
      throw new Error(`unknown operation "${(op as { op?: unknown }).op}"`);
  }
}

/**
 * Subtract a box from every brush it cuts. A cut brush is replaced by the
 * pieces left over, named `<id>`, `<id>-2`… and keeping its material and its
 * brush-entity owner. Returns the IDs of the brushes that were cut.
 */
function carve(doc: EditorDocumentData, box: { min: Vec3q; max: Vec3q }): string[] {
  for (const axis of ["x", "y", "z"] as const) {
    if (!(box.min[axis] < box.max[axis])) throw new Error(`carve box ${axis}: min must be below max`);
  }
  const cut: string[] = [];
  const result: BoxBrush[] = [];
  for (const brush of doc.brushes) {
    if (brush.hull && boxesOverlap(brush, box))
      throw new Error(`Cannot carve convex brush ${brush.id}; convex subtraction is not supported`);
    const pieces = subtractBox(brush, box);
    if (
      pieces.length === 1 &&
      pieces[0].min.x === brush.min.x &&
      pieces[0].max.x === brush.max.x &&
      pieces[0].min.y === brush.min.y &&
      pieces[0].max.y === brush.max.y &&
      pieces[0].min.z === brush.min.z &&
      pieces[0].max.z === brush.max.z
    ) {
      result.push(brush);
      continue;
    }
    cut.push(brush.id);
    const owner = doc.brushEntities?.find((e) => e.brushIds.includes(brush.id));
    const ids: string[] = [];
    pieces.forEach((piece, index) => {
      const id = index === 0 ? brush.id : nextFree(doc, `${brush.id}-${index + 1}`, result);
      ids.push(id);
      result.push({ ...structuredClone(brush), id, min: piece.min, max: piece.max });
    });
    if (owner) owner.brushIds = owner.brushIds.flatMap((id) => (id === brush.id ? ids : [id]));
  }
  doc.brushes = result;
  return cut;
}

function moveObject(doc: EditorDocumentData, id: string, delta: Vec3q): void {
  const b = doc.brushes.find((x) => x.id === id);
  if (b) {
    b.min = add(b.min, delta);
    b.max = add(b.max, delta);
    return;
  }
  const e = doc.entities.find((x) => x.id === id);
  if (e) {
    e.origin = add(e.origin, delta);
    return;
  }
  const be = doc.brushEntities?.find((x) => x.id === id);
  if (be) {
    for (const owned of be.brushIds) moveObject(doc, owned, delta);
    return;
  }
  const p = doc.patches?.find((x) => x.id === id);
  if (p) {
    p.controlPoints = p.controlPoints.map((row) => row.map((c) => ({ ...c, ...add(c, delta) })));
    return;
  }
  throw new Error(`no object "${id}"`);
}

function duplicateObject(doc: EditorDocumentData, id: string, delta: Vec3q, suffix: string): void {
  const copyId = (source: string) => claimId(doc, nextFree(doc, `${source}-${suffix}`), "brush");
  const b = doc.brushes.find((x) => x.id === id);
  if (b) {
    doc.brushes.push({ ...structuredClone(b), id: copyId(id), min: add(b.min, delta), max: add(b.max, delta) });
    return;
  }
  const e = doc.entities.find((x) => x.id === id);
  if (e) {
    doc.entities.push({ ...structuredClone(e), id: copyId(id), origin: add(e.origin, delta) });
    return;
  }
  const be = doc.brushEntities?.find((x) => x.id === id);
  if (be) {
    const brushIds = be.brushIds.map((owned) => {
      const source = brush(doc, owned);
      const ownedCopy = copyId(owned);
      doc.brushes.push({
        ...structuredClone(source),
        id: ownedCopy,
        min: add(source.min, delta),
        max: add(source.max, delta),
      });
      return ownedCopy;
    });
    doc.brushEntities?.push({ ...structuredClone(be), id: copyId(id), brushIds });
    return;
  }
  throw new Error(`no brush or entity "${id}" to duplicate`);
}

/** `<base>`, or `<base>-2`, `<base>-3`… if taken (also by brushes not yet in the document). */
function nextFree(doc: EditorDocumentData, base: string, pending: readonly BoxBrush[] = []): string {
  const used = new Set([...allIds(doc), ...pending.map((b) => b.id)]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
