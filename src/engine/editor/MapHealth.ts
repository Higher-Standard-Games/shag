import { SPAWN_CLASSNAMES, TEAM_SPAWN_CLASSNAMES } from "../../shared/bsp/SpawnPointTable";
import { type EditorDocumentData, FACE_KEYS, type FaceKey } from "./EditorDocument";
import { BRUSH_ENTITY_CLASSES, EDITOR_POINT_CLASSES, missingRequiredKeys } from "./EntityCatalog";
import { modelReferenceIssue } from "./ModelReference";
import type { TextureEntry } from "./TextureCatalog";

export type MapHealthSeverity = "warning" | "info";
export type MapHealthCode =
  | "no-spawn"
  | "required-key"
  | "invalid-model"
  | "unresolved-target"
  | "duplicate-targetname"
  | "unknown-class"
  | "unknown-shader"
  | "missing-shader-image";

export interface MapHealthIssue {
  code: MapHealthCode;
  severity: MapHealthSeverity;
  message: string;
  /** Stable document ID, suitable for selecting and framing the affected object. */
  objectId: string | null;
  face?: FaceKey;
}

const LINK_CLASSES = new Set([
  "trigger_teleport",
  "trigger_push",
  "trigger_once",
  "trigger_multiple",
  "func_button",
  "trigger_capture_area",
]);
const POINT_CLASSES = new Set(EDITOR_POINT_CLASSES.map((entry) => entry.classname));
const BRUSH_CLASSES = new Set(BRUSH_ENTITY_CLASSES.map((entry) => entry.classname));

/** Advisory diagnostics for a valid editable document; this never changes export bytes. */
export function inspectMapHealth(data: EditorDocumentData, textures?: readonly TextureEntry[]): MapHealthIssue[] {
  const issues: MapHealthIssue[] = [];
  const add = (
    code: MapHealthCode,
    severity: MapHealthSeverity,
    message: string,
    objectId: string | null,
    face?: FaceKey,
  ) => issues.push({ code, severity, message, objectId, ...(face ? { face } : {}) });

  if (
    !data.entities.some(
      (entity) => SPAWN_CLASSNAMES.includes(entity.classname) || entity.classname in TEAM_SPAWN_CLASSNAMES,
    )
  ) {
    add("no-spawn", "warning", "Map has no player spawn point.", null);
  }

  const targets = new Map<string, string[]>();
  for (const entity of [...data.entities, ...(data.brushEntities ?? [])]) {
    const name = entity.keys.targetname?.trim();
    if (name) targets.set(name, [...(targets.get(name) ?? []), entity.id]);
  }
  for (const [name, ids] of targets) {
    if (ids.length > 1) {
      for (const id of ids)
        add("duplicate-targetname", "info", `Target name "${name}" is shared by ${ids.length} entities.`, id);
    }
  }

  for (const entity of data.entities) {
    if (!POINT_CLASSES.has(entity.classname))
      add("unknown-class", "info", `Unlisted point class: ${entity.classname}.`, entity.id);
    for (const key of missingRequiredKeys(entity.classname, entity.keys)) {
      add("required-key", "warning", `${entity.classname} needs "${key}".`, entity.id);
    }
    if (entity.classname === "misc_model" && entity.keys.model) {
      const issue = modelReferenceIssue(entity);
      if (issue) add("invalid-model", "warning", issue, entity.id);
    }
    if (LINK_CLASSES.has(entity.classname) && entity.keys.target?.trim() && !targets.has(entity.keys.target.trim())) {
      add("unresolved-target", "warning", `${entity.classname} targets missing "${entity.keys.target}".`, entity.id);
    }
  }
  for (const entity of data.brushEntities ?? []) {
    if (!BRUSH_CLASSES.has(entity.classname))
      add("unknown-class", "info", `Unlisted brush class: ${entity.classname}.`, entity.id);
    for (const key of missingRequiredKeys(entity.classname, entity.keys)) {
      add("required-key", "warning", `${entity.classname} needs "${key}".`, entity.id);
    }
    if (LINK_CLASSES.has(entity.classname) && entity.keys.target?.trim() && !targets.has(entity.keys.target.trim())) {
      add("unresolved-target", "warning", `${entity.classname} targets missing "${entity.keys.target}".`, entity.id);
    }
  }

  if (textures) {
    const shaders = new Map(textures.map((entry) => [entry.name.toLowerCase(), entry]));
    const checkShader = (shader: string, objectId: string, face?: FaceKey) => {
      const entry = shaders.get(shader.toLowerCase());
      if (!entry)
        add("unknown-shader", "warning", `Shader "${shader}" is absent from the mounted catalog.`, objectId, face);
      else if (entry.missing)
        add("missing-shader-image", "warning", `Shader "${shader}" references a missing image.`, objectId, face);
    };
    for (const brush of data.brushes) {
      if (brush.hull) {
        for (const side of brush.hull.sides) checkShader(side.material?.shader ?? brush.shader, brush.id);
        continue;
      }
      for (const face of FACE_KEYS) checkShader(brush.faces?.[face]?.shader ?? brush.shader, brush.id, face);
    }
    for (const patch of data.patches ?? []) checkShader(patch.shader, patch.id);
  }
  return issues;
}
