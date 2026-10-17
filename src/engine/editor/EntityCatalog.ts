/**
 * Point-entity classes for the SHAGGED inspector and palette, read from the
 * Washoi NetRadiant definitions (editor/gamepacks/washoi.game/basewashoi/entities.def).
 * Gameplay definitions follow the engine entity readers. Explicit compiler
 * classes extend the editor palette with supported baked authoring entities.
 */

import washoiEntityDefs from "../../../editor/gamepacks/washoi.game/basewashoi/entities.def?raw";
import { COMPILER_BRUSH_CLASSES, COMPILER_POINT_CLASSES } from "./CompilerEntityCatalog";
import type { Vec3q } from "./EditorDocument";

export interface EntityKeyDef {
  name: string;
  label: string;
  defaultValue?: string;
  /** The definition marks it "-- required": the engine drops the entity without it. */
  required?: true;
}

export interface EntityClassDef {
  compilerOnly?: true;
  description?: string;
  classname: string;
  section: string;
  /** Marker colour, 0..1 per channel. */
  color: [number, number, number];
  /** Point classes: the marker box around the origin. Brush classes: zero (their brushes are the volume). */
  mins: Vec3q;
  maxs: Vec3q;
  /** Documented keys other than origin, and for brush classes other than the compiler-assigned model. */
  keys: EntityKeyDef[];
}

type ParsedClass = EntityClassDef & { kind: "point" | "brush" };

const HEADER = /^\/\*QUAKED (\S+) \(([^)]*)\) (?:\(([^)]*)\) \(([^)]*)\))?/;
const KEY_LINE = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
const DEFAULT = /\(default:\s*([^)]*)\)/;
const REQUIRED = /\s*--\s*required\s*$/;
const NO_BOX: Vec3q = { x: 0, y: 0, z: 0 };

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
  return parseClasses(text)
    .filter((entity) => entity.kind === "point")
    .map(({ kind: _kind, ...entity }) => entity);
}

/** Brush classes (triggers, movers, capture areas) from the same gameplay sections. */
export function parseBrushEntityDefs(text: string): EntityClassDef[] {
  return parseClasses(text)
    .filter((entity) => entity.kind === "brush")
    .map(({ kind: _kind, ...entity }) => entity);
}

function parseClasses(text: string): ParsedClass[] {
  const classes: ParsedClass[] = [];
  const lines = text.split(/\r?\n/);
  let section = "";
  let afterRule = false;
  let current: ParsedClass | null = null;
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
      // origin is an editor field; a brush class's model is assigned by MakeBSP.
      const skip = key && (key[1] === "origin" || (current.kind === "brush" && key[1] === "model"));
      if (key && !skip && !current.keys.some((existing) => existing.name === key[1])) {
        const defaultValue = DEFAULT.exec(key[2])?.[1].trim();
        const required = REQUIRED.test(key[2]);
        const label = key[2].replace(DEFAULT, "").replace(REQUIRED, "").trim();
        current.keys.push({
          name: key[1],
          label: label || key[1],
          ...(defaultValue ? { defaultValue } : {}),
          ...(required ? { required: true as const } : {}),
        });
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
    if (!header || header[1] === "worldspawn" || /^(COMPILER|RAW)/.test(section)) continue;
    const [r, g, b] = header[2].trim().split(/\s+/).map(Number);
    const point = Boolean(header[3]);
    current = {
      kind: point ? "point" : "brush",
      classname: header[1],
      section,
      color: [r, g, b],
      mins: point ? vec(header[3]) : { ...NO_BOX },
      maxs: point ? vec(header[4]) : { ...NO_BOX },
      keys: [],
    };
    classes.push(current);
  }
  return classes;
}

export const POINT_ENTITY_CLASSES: readonly EntityClassDef[] = parseEntityDefs(washoiEntityDefs);
/** Compiler-baked model reference. The raw-map definition's `scale` and collision keys do not apply here. */
const MISC_MODEL: EntityClassDef = {
  compilerOnly: true,
  classname: "misc_model",
  section: "MODEL PROPS",
  color: [0.62, 0.83, 0.45],
  mins: { x: -16, y: -16, z: 0 },
  maxs: { x: 16, y: 16, z: 32 },
  keys: [
    { name: "model", label: "Compiler VFS model path", required: true },
    { name: "angle", label: "Yaw in degrees", defaultValue: "0" },
    { name: "modelscale", label: "Uniform compiler scale", defaultValue: "1" },
  ],
};
export const EDITOR_POINT_CLASSES: readonly EntityClassDef[] = [
  ...POINT_ENTITY_CLASSES,
  MISC_MODEL,
  ...COMPILER_POINT_CLASSES,
];
export const BRUSH_ENTITY_CLASSES: readonly EntityClassDef[] = [
  ...parseBrushEntityDefs(washoiEntityDefs),
  ...COMPILER_BRUSH_CLASSES,
];

const BY_NAME = new Map([...EDITOR_POINT_CLASSES, ...BRUSH_ENTITY_CLASSES].map((entity) => [entity.classname, entity]));

/**
 * The shader a new brush entity's faces get. The definitions say to texture
 * every face of a trigger with textures/common/trigger (written unprefixed in a
 * .map); movers and buttons keep their visible material.
 */
export function brushEntityShader(classname: string): string | null {
  return classname.startsWith("trigger_") ? "common/trigger" : null;
}

/** Required keys the entity doesn't have yet, per its class definition. */
export function missingRequiredKeys(classname: string, keys: Record<string, string>): string[] {
  return entityClass(classname)
    .keys.filter((key) => key.required && !keys[key.name])
    .map((key) => key.name);
}

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
