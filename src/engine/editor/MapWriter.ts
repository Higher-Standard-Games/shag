import {
  type BoxBrush,
  type BrushEntity,
  type EditorDocumentData,
  type PointEntity,
  validateDocument,
} from "./EditorDocument";

const UV = "( ( 0.03125 0 0 ) ( 0 0.03125 0 ) )";
const fmt = (n: number): string => Number(n.toFixed(6)).toString();
const point = (x: number, y: number, z: number): string => `( ${fmt(x)} ${fmt(y)} ${fmt(z)} )`;
// Code-unit order, not localeCompare: export bytes must not depend on the machine's locale.
const codeOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: { id: string }, b: { id: string }): number => codeOrder(a.id, b.id);

function boxLines(brush: BoxBrush): string[] {
  const { x: x0, y: y0, z: z0 } = brush.min;
  const { x: x1, y: y1, z: z1 } = brush.max;
  const face = (a: string, b: string, c: string) => `${a} ${b} ${c} ${UV} ${brush.shader} 0 0 0`;
  return [
    "{",
    "brushDef",
    "{",
    face(point(x0, y0, z1), point(x0, y1, z1), point(x1, y0, z1)),
    face(point(x0, y1, z0), point(x0, y0, z0), point(x1, y1, z0)),
    face(point(x0, y0, z1), point(x1, y0, z1), point(x0, y0, z0)),
    face(point(x1, y1, z1), point(x0, y1, z1), point(x1, y1, z0)),
    face(point(x0, y1, z1), point(x0, y0, z1), point(x0, y1, z0)),
    face(point(x1, y0, z1), point(x1, y1, z1), point(x1, y0, z0)),
    "}",
    "}",
  ];
}

const keyLines = (keys: Record<string, string>): string[] =>
  Object.entries(keys)
    .sort(([a], [b]) => codeOrder(a, b))
    .map(([key, value]) => `"${key}" "${value}"`);

/** classname, then origin, then every other key in name order. */
function entityLines(entity: PointEntity): string[] {
  const { x, y, z } = entity.origin;
  return [
    "{",
    `"classname" "${entity.classname}"`,
    `"origin" "${fmt(x)} ${fmt(y)} ${fmt(z)}"`,
    ...keyLines(entity.keys),
    "}",
  ];
}

/** classname, keys, then the owned brushes in ID order. No origin: MakeBSP assigns the submodel. */
function brushEntityLines(entity: BrushEntity, brushes: ReadonlyMap<string, BoxBrush>): string[] {
  const owned = [...entity.brushIds].sort(codeOrder).map((id) => brushes.get(id)!);
  return ["{", `"classname" "${entity.classname}"`, ...keyLines(entity.keys), ...owned.flatMap(boxLines), "}"];
}

/** Deterministic source: objects in ID order, so selection and insertion order never change the bytes. */
export function writeMap(data: EditorDocumentData): string {
  validateDocument(data);
  const brushEntities = data.brushEntities ?? [];
  const owned = new Set(brushEntities.flatMap((entity) => entity.brushIds));
  const brushes = new Map(data.brushes.map((brush) => [brush.id, brush]));
  const lines = ["{", '"classname" "worldspawn"'];
  for (const brush of [...data.brushes].sort(byId)) if (!owned.has(brush.id)) lines.push(...boxLines(brush));
  lines.push("}");
  // Point and brush entities share one ID order.
  const entities: Array<{ id: string; lines: () => string[] }> = [
    ...data.entities.map((entity) => ({ id: entity.id, lines: () => entityLines(entity) })),
    ...brushEntities.map((entity) => ({ id: entity.id, lines: () => brushEntityLines(entity, brushes) })),
  ];
  for (const entity of entities.sort(byId)) lines.push(...entity.lines());
  return `${lines.join("\n")}\n`;
}
