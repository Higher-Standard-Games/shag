import { type BoxBrush, type EditorDocumentData, validateDocument } from "./EditorDocument";

const UV = "( ( 0.03125 0 0 ) ( 0 0.03125 0 ) )";
const fmt = (n: number): string => Number(n.toFixed(6)).toString();
const point = (x: number, y: number, z: number): string => `( ${fmt(x)} ${fmt(y)} ${fmt(z)} )`;

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

/** Deterministic source only; compile acceptance still needs the target MakeBSP binary. */
export function writeMap(data: EditorDocumentData): string {
  validateDocument(data);
  const lines = ["{", '"classname" "worldspawn"'];
  for (const brush of [...data.brushes].sort((a, b) => a.id.localeCompare(b.id))) lines.push(...boxLines(brush));
  lines.push("}");
  if (data.testSpawn) {
    const { x, y, z } = data.testSpawn;
    lines.push("{", '"classname" "info_player_deathmatch"', `"origin" "${fmt(x)} ${fmt(y)} ${fmt(z)}"`, "}");
  }
  return `${lines.join("\n")}\n`;
}
