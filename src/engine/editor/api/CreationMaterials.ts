import { type BoxBrush, FACE_KEYS } from "../EditorDocument";
import { naturalFace } from "../FaceUv";

/** Creation-only alignment; resolved image sizes are stored in ordinary face materials. */
export interface CreationMaterials {
  alignment?: "natural" | "legacy";
  /** Required by direct API callers for natural non-tool materials; MCP/CLI resolve missing sizes. */
  textureSizes?: Record<string, [number, number]>;
}

export function alignCreatedBrush(brush: BoxBrush, options: CreationMaterials): BoxBrush {
  if (options.alignment !== undefined && options.alignment !== "natural" && options.alignment !== "legacy")
    throw new Error('alignment must be "natural" or "legacy"');
  if (options.alignment !== "natural") return brush;
  if (brush.hull) {
    return {
      ...brush,
      hull: {
        ...brush.hull,
        sides: brush.hull.sides.map((side) => {
          const shader = side.material?.shader ?? brush.shader;
          const aligned = alignCreatedBrush({ id: brush.id, min: brush.min, max: brush.max, shader }, options);
          return { ...side, material: aligned.faces!["+X"] };
        }),
      },
    };
  }
  const faces: NonNullable<BoxBrush["faces"]> = {};
  for (const key of FACE_KEYS) {
    const shader = brush.faces?.[key]?.shader ?? brush.shader;
    const size = shader.startsWith("common/")
      ? ([64, 64] as [number, number])
      : Object.entries(options.textureSizes ?? {}).find(([name]) => name.toLowerCase() === shader.toLowerCase())?.[1];
    if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isFinite(n) && n > 0))
      throw new Error(
        `natural alignment needs a positive image size for ${shader}; use texture discovery or supply textureSizes`,
      );
    faces[key] = naturalFace(shader, [...size]);
  }
  return { ...brush, faces };
}
