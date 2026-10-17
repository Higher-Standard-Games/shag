import { type EditorDocumentData, pruneBrushEntities, pruneEditorGroups, type Vec3q } from "./EditorDocument";
import { lockBrushBounds } from "./TextureLock";

export function expandSelection(doc: EditorDocumentData, ids: Iterable<string>, selectGroups = false): string[] {
  const leaves = new Set([...doc.brushes, ...(doc.patches ?? []), ...doc.entities].map((item) => item.id));
  const result = new Set<string>();
  for (const id of ids) {
    const group = doc.editorGroups?.find((group) => group.id === id || (selectGroups && group.objectIds.includes(id)));
    const entity = doc.brushEntities?.find((entity) => entity.id === id);
    const members = group?.objectIds ?? entity?.brushIds ?? [id];
    for (const member of members) {
      if (!leaves.has(member)) throw new Error(`no object "${member}"`);
      result.add(member);
    }
  }
  return [...result];
}

export function moveSelection(doc: EditorDocumentData, ids: Iterable<string>, delta: Vec3q): string[] {
  if (![delta.x, delta.y, delta.z].every(Number.isFinite)) throw new Error("Move needs finite coordinates");
  const selected = new Set(expandSelection(doc, ids));
  const add = (point: Vec3q): Vec3q => ({ x: point.x + delta.x, y: point.y + delta.y, z: point.z + delta.z });
  doc.brushes = doc.brushes.map((brush) =>
    selected.has(brush.id) ? lockBrushBounds(brush, { ...brush, min: add(brush.min), max: add(brush.max) }) : brush,
  );
  for (const patch of doc.patches ?? [])
    if (selected.has(patch.id))
      patch.controlPoints = patch.controlPoints.map((row) => row.map((point) => ({ ...point, ...add(point) })));
  for (const entity of doc.entities) if (selected.has(entity.id)) entity.origin = add(entity.origin);
  return [...selected];
}

/** Full compiler owners are copied; partial copies follow the caller's ownership policy. */
export function duplicateSelection(
  doc: EditorDocumentData,
  ids: Iterable<string>,
  delta: Vec3q,
  newId: (source: string) => string,
  joinPartialOwners = true,
): string[] {
  const selected = new Set(expandSelection(doc, ids)),
    copies = new Map<string, string>();
  const source = structuredClone(doc);
  const copyCollection = <T extends { id: string }>(collection: T[]) => {
    for (const item of [...collection]) {
      if (!selected.has(item.id)) continue;
      const copy = structuredClone(item);
      copy.id = newId(item.id);
      copies.set(item.id, copy.id);
      collection.push(copy);
    }
  };
  copyCollection(doc.brushes);
  copyCollection(doc.patches ?? []);
  copyCollection(doc.entities);
  // Older documents may omit the patch collection; no selected patch can exist then.
  const copied = [...copies.values()];
  moveSelection(doc, copied, delta);
  for (const owner of source.brushEntities ?? []) {
    const brushIds = owner.brushIds.filter((id) => copies.has(id)).map((id) => copies.get(id)!);
    if (!brushIds.length) continue;
    if (brushIds.length === owner.brushIds.length) {
      doc.brushEntities ??= [];
      doc.brushEntities.push({ ...owner, id: newId(owner.id), brushIds });
    } else if (joinPartialOwners)
      doc.brushEntities!.find((entity) => entity.id === owner.id)!.brushIds.push(...brushIds);
  }
  for (const group of source.editorGroups ?? [])
    if (group.objectIds.every((id) => copies.has(id))) {
      doc.editorGroups ??= [];
      doc.editorGroups.push({ ...group, id: newId(group.id), objectIds: group.objectIds.map((id) => copies.get(id)!) });
    }
  return copied;
}

export function deleteSelection(doc: EditorDocumentData, ids: Iterable<string>): void {
  const selected = new Set(expandSelection(doc, ids));
  doc.brushes = doc.brushes.filter((item) => !selected.has(item.id));
  doc.patches = (doc.patches ?? []).filter((item) => !selected.has(item.id));
  doc.entities = doc.entities.filter((item) => !selected.has(item.id));
  pruneBrushEntities(doc);
  pruneEditorGroups(doc);
}

export function groupSelection(doc: EditorDocumentData, ids: Iterable<string>, id: string, name = "Group"): void {
  const objects = expandSelection(doc, ids, true);
  if (objects.length < 2) throw new Error("Select at least two objects to group");
  const selected = new Set(objects);
  doc.editorGroups = (doc.editorGroups ?? []).filter(
    (group) => !group.objectIds.some((member) => selected.has(member)),
  );
  doc.editorGroups.push({ id, name, objectIds: objects });
}

export function ungroupSelection(doc: EditorDocumentData, ids: Iterable<string>): void {
  const selected = new Set(ids);
  doc.editorGroups = (doc.editorGroups ?? []).filter(
    (group) => !selected.has(group.id) && !group.objectIds.some((id) => selected.has(id)),
  );
}
