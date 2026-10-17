import type { EditorDocumentData, Vec3q } from "../EditorDocument";

export interface QueryBounds {
  min: Vec3q;
  max: Vec3q;
}
export type DocumentObjectKind = "brush" | "patch" | "entity" | "brushEntity" | "editorGroup";
export interface DocumentQuery {
  bounds?: QueryBounds;
  relation?: "intersects" | "contained";
  kinds?: DocumentObjectKind[];
  ids?: string[];
  offset?: number;
  limit?: number;
}

export function pointBounds(points: Iterable<Vec3q>): QueryBounds | null {
  let result: QueryBounds | null = null;
  for (const p of points) {
    if (!result) result = { min: { x: p.x, y: p.y, z: p.z }, max: { x: p.x, y: p.y, z: p.z } };
    else
      for (const axis of ["x", "y", "z"] as const) {
        result.min[axis] = Math.min(result.min[axis], p[axis]);
        result.max[axis] = Math.max(result.max[axis], p[axis]);
      }
  }
  return result;
}

export const documentSnapshot = (doc: EditorDocumentData) => ({ ok: true, document: structuredClone(doc) });

/** Authoring-space bounds: patch control hulls, entity origins, and owned brushes. */
export function queryDocument(doc: EditorDocumentData, query: DocumentQuery = {}) {
  const { offset = 0, limit = 100, relation = "intersects" } = query;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Query offset must be nonnegative and limit must be 1–500");
  if (!["intersects", "contained"].includes(relation)) throw new Error("Invalid query relation");
  if (query.kinds?.some((kind) => !["brush", "patch", "entity", "brushEntity", "editorGroup"].includes(kind)))
    throw new Error("Invalid object kind");
  const region = query.bounds;
  if (region)
    for (const axis of ["x", "y", "z"] as const)
      if (
        !Number.isFinite(region.min[axis]) ||
        !Number.isFinite(region.max[axis]) ||
        region.min[axis] > region.max[axis]
      )
        throw new Error("Query bounds must be finite with min <= max on every axis");
  const owner = new Map(
    (doc.brushEntities ?? []).flatMap((entity) => entity.brushIds.map((id) => [id, entity.id] as const)),
  );
  type Data =
    | EditorDocumentData["brushes"][number]
    | EditorDocumentData["entities"][number]
    | NonNullable<EditorDocumentData["patches"]>[number]
    | NonNullable<EditorDocumentData["brushEntities"]>[number]
    | NonNullable<EditorDocumentData["editorGroups"]>[number];
  const objects: Array<{ kind: DocumentObjectKind; data: Data; bounds: QueryBounds | null; ownerId?: string }> = [];
  for (const brush of doc.brushes)
    objects.push({
      kind: "brush",
      data: brush,
      bounds: { min: brush.min, max: brush.max },
      ...(owner.has(brush.id) ? { ownerId: owner.get(brush.id) } : {}),
    });
  for (const patch of doc.patches ?? [])
    objects.push({ kind: "patch", data: patch, bounds: pointBounds(patch.controlPoints.flat()) });
  for (const entity of doc.entities)
    objects.push({ kind: "entity", data: entity, bounds: pointBounds([entity.origin]) });
  const brushes = new Map(doc.brushes.map((brush) => [brush.id, brush]));
  for (const group of doc.brushEntities ?? [])
    objects.push({
      kind: "brushEntity",
      data: group,
      bounds: pointBounds(
        group.brushIds.flatMap((id) => {
          const brush = brushes.get(id);
          return brush ? [brush.min, brush.max] : [];
        }),
      ),
    });
  const leaves = new Map(
    objects.filter((object) => object.kind !== "brushEntity").map((object) => [object.data.id, object.bounds]),
  );
  for (const group of doc.editorGroups ?? [])
    objects.push({
      kind: "editorGroup",
      data: group,
      bounds: pointBounds(
        group.objectIds.flatMap((id) => {
          const bounds = leaves.get(id);
          return bounds ? [bounds.min, bounds.max] : [];
        }),
      ),
    });
  const matches = objects
    .filter((object) => {
      if (query.kinds && !query.kinds.includes(object.kind)) return false;
      if (query.ids && !query.ids.includes(object.data.id)) return false;
      if (!region) return true;
      const b = object.bounds;
      return (
        b !== null &&
        (["x", "y", "z"] as const).every((axis) =>
          relation === "contained"
            ? b.min[axis] >= region.min[axis] && b.max[axis] <= region.max[axis]
            : b.min[axis] <= region.max[axis] && b.max[axis] >= region.min[axis],
        )
      );
    })
    .sort((a, b) => `${a.kind}:${a.data.id}`.localeCompare(`${b.kind}:${b.data.id}`));
  const next = offset + Math.min(limit, Math.max(0, matches.length - offset));
  return {
    ok: true,
    mapName: doc.mapName ?? null,
    revision: doc.revision,
    total: matches.length,
    offset,
    nextOffset: next < matches.length ? next : null,
    objects: structuredClone(matches.slice(offset, offset + limit)),
  };
}
