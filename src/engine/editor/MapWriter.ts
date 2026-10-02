import { type BoxBrush, type EditorDocumentData, type PointEntity, validateDocument } from "./EditorDocument";

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

/** classname, then origin, then every other key in name order. */
function entityLines(entity: PointEntity): string[] {
  const { x, y, z } = entity.origin;
  const keys = Object.entries(entity.keys).sort(([a], [b]) => codeOrder(a, b));
  return [
    "{",
    `"classname" "${entity.classname}"`,
    `"origin" "${fmt(x)} ${fmt(y)} ${fmt(z)}"`,
    ...keys.map(([key, value]) => `"${key}" "${value}"`),
    "}",
  ];
}

/** Deterministic source: objects in ID order, so selection and insertion order never change the bytes. */
export function writeMap(data: EditorDocumentData): string {
  validateDocument(data);
  const lines = ["{", '"classname" "worldspawn"'];
  for (const brush of [...data.brushes].sort(byId)) lines.push(...boxLines(brush));
  lines.push("}");
  for (const entity of [...data.entities].sort(byId)) lines.push(...entityLines(entity));
  return `${lines.join("\n")}\n`;
}
