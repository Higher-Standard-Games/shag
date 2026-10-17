import type { EntityClassDef, EntityKeyDef } from "./EntityCatalog";

/** Supported authoring keys from the bundled MakeBSP README's entity sections. */
const projection: EntityKeyDef[] = [
  { name: "angles", label: "Projection pitch yaw roll; pitch 90 projects down", defaultValue: "0 0 0" },
  { name: "target", label: "Aim projection at this targetname" },
  { name: "rotate", label: "Rotation around projection axis in degrees" },
  { name: "distance", label: "Projection depth in world units (alias: depth)", defaultValue: "64" },
  { name: "decalgroup", label: "Project only onto receivers with this decalgroup" },
  { name: "vertexcolor", label: "Generated vertex tint: R G B or #RRGGBB" },
  { name: "vertexalpha", label: "Generated vertex opacity: 0..1 or 0..255" },
];
const marker = {
  color: [0.5, 0.7, 0.8] as [number, number, number],
  mins: { x: -16, y: -16, z: -16 },
  maxs: { x: 16, y: 16, z: 32 },
  section: "COMPILER",
  compilerOnly: true as const,
};

export const COMPILER_POINT_CLASSES: readonly EntityClassDef[] = [
  {
    ...marker,
    classname: "misc_decal",
    description: "Compiler-projected quad decal; inspect the compiled BSP. Limit distance to avoid adjacent faces.",
    keys: [
      { name: "shader", label: "Shader to project, e.g. textures/decals/logo", required: true },
      { name: "width", label: "Quad width; defaults to image width * 0.25 or 64" },
      { name: "height", label: "Quad height; defaults to image height * 0.25 or 64" },
      { name: "scale", label: "Uniform width/height multiplier", defaultValue: "1" },
      ...projection,
    ],
  },
  {
    ...marker,
    classname: "misc_text_decal",
    description:
      "Compiler-projected text using a packaged font atlas descriptor. No runtime entity or editor text preview.",
    keys: [
      { name: "text", label: "Text to project", required: true },
      { name: "font", label: "Font descriptor path/name (shader or texture are compiler fallbacks)" },
      { name: "height", label: "Character height in world units (alias: size)", defaultValue: "32" },
      { name: "align", label: "Horizontal: left, center/middle, right", defaultValue: "left" },
      { name: "valign", label: "Vertical: baseline, top, center/middle, bottom", defaultValue: "baseline" },
      { name: "tracking", label: "Extra spacing between characters", defaultValue: "0" },
      ...projection,
    ],
  },
];

export const COMPILER_BRUSH_CLASSES: readonly EntityClassDef[] = [
  {
    ...marker,
    classname: "func_group",
    mins: { x: 0, y: 0, z: 0 },
    maxs: { x: 0, y: 0, z: 0 },
    description:
      "Compile-only brush grouping. Chamfers alter draw surfaces; fast compilation disables chamfering. Grouping does not make geometry nonsolid.",
    keys: [
      { name: "chamfer_convexwidth", label: "Convex surface chamfer width" },
      { name: "chamfer_concavewidth", label: "Concave surface chamfer width" },
      { name: "smooth", label: "Lightmap smoothing filter radius" },
      { name: "vertexcolor", label: "Surface vertex tint" },
      { name: "vertexalpha", label: "Surface vertex opacity: 0..1 or 0..255" },
      { name: "samplesize", label: "Surface lightmap sample size (alias: lightmapsamplesize)" },
      { name: "castshadows", label: "Cast baked shadows: 1 or 0", defaultValue: "1" },
      { name: "modelgroup", label: "Include misc_model entities with this modelgroup" },
      { name: "decalgroup", label: "Receiver group for projected decals" },
    ],
  },
];
