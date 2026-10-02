/**
 * Point-entity classes for the SHAGGED inspector and palette, read from the
 * Washoi NetRadiant definitions (editor/gamepacks/washoi.game/basewashoi/entities.def).
 * That file is derived from the engine's own entity readers, so the editor
 * offers what the compiled-BSP game path actually reads.
 */

import washoiEntityDefs from "../../../editor/gamepacks/washoi.game/basewashoi/entities.def?raw";
import type { Vec3q } from "./EditorDocument";

export interface EntityKeyDef {
  name: string;
  label: string;
  defaultValue?: string;
}

export interface EntityClassDef {
  classname: string;
  section: string;
  /** Marker colour, 0..1 per channel. */
  color: [number, number, number];
  mins: Vec3q;
  maxs: Vec3q;
  /** Documented keys other than origin. */
  keys: EntityKeyDef[];
}

const HEADER = /^\/\*QUAKED (\S+) \(([^)]*)\) (?:\(([^)]*)\) \(([^)]*)\))?/;
const KEY_LINE = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
const DEFAULT = /\(default:\s*([^)]*)\)/;

function vec(text: string): Vec3q {
  const [x, y, z] = text.trim().split(/\s+/).map(Number);
  return { x, y, z };
}

/**
 * Point classes from the gameplay sections of an entities.def. Brush classes
 * (no bounding box) and the compiler-only and raw-.map-only sections are left
 * out: placing those as points would export entities the game never reads.
 */
export function parseEntityDefs(text: string): EntityClassDef[] {
  const classes: EntityClassDef[] = [];
  const lines = text.split(/\r?\n/);
  let section = "";
  let afterRule = false;
  let current: EntityClassDef | null = null;
  let inKeys = false;
  for (const line of lines) {
    if (current) {
      if (line.trim() === "*/") {
        current = null;
        inKeys = false;
        continue;
      }
      if (line.includes("-------- KEYS --------")) {
        inKeys = true;
        continue;
      }
      if (/^\s*--------/.test(line)) continue;
      const key = inKeys ? KEY_LINE.exec(line) : null;
      if (key && key[1] !== "origin" && !current.keys.some((existing) => existing.name === key[1])) {
        const defaultValue = DEFAULT.exec(key[2])?.[1].trim();
        const label = key[2].replace(DEFAULT, "").trim();
        current.keys.push({ name: key[1], label: label || key[1], ...(defaultValue ? { defaultValue } : {}) });
      }
      continue;
    }
    if (/^\/\/ -{10,}/.test(line)) {
      afterRule = true;
      continue;
    }
    if (afterRule && line.startsWith("//  "))
      section = line
        .slice(4)
        .split(/\s{2,}/)[0]
        .trim();
    afterRule = false;
    const header = HEADER.exec(line);
    if (!header || !header[3] || /^(COMPILER|RAW)/.test(section)) continue;
    const [r, g, b] = header[2].trim().split(/\s+/).map(Number);
    current = {
      classname: header[1],
      section,
      color: [r, g, b],
      mins: vec(header[3]),
      maxs: vec(header[4]),
      keys: [],
    };
    classes.push(current);
  }
  return classes;
}

export const POINT_ENTITY_CLASSES: readonly EntityClassDef[] = parseEntityDefs(washoiEntityDefs);

const BY_NAME = new Map(POINT_ENTITY_CLASSES.map((entity) => [entity.classname, entity]));

/** A class's definition, or a neutral 32-unit marker for a classname the catalog doesn't know. */
export function entityClass(classname: string): EntityClassDef {
  return (
    BY_NAME.get(classname) ?? {
      classname,
      section: "Other",
      color: [0.6, 0.6, 0.6],
      mins: { x: -16, y: -16, z: -16 },
      maxs: { x: 16, y: 16, z: 16 },
      keys: [],
    }
  );
}
