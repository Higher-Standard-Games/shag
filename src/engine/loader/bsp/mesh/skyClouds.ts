import type { Q3ShaderStage } from "../../shader/Q3ShaderTypes";
import type { SkyCloudLayer } from "../../texture/SkyboxLoader";

/** A blendFunc as one of the ways a cloud layer can combine with the sky behind it. */
function cloudBlend(stage: Q3ShaderStage, first: boolean): SkyCloudLayer["blend"] {
  const blend = stage.blendFunc;
  if (!blend) return first ? "opaque" : "add";
  const [src, dst] = blend;
  if (src === "GL_ONE" && dst === "GL_ZERO") return "opaque";
  if ((src === "GL_DST_COLOR" && dst === "GL_ZERO") || (src === "GL_ZERO" && dst === "GL_SRC_COLOR")) return "multiply";
  if (src === "GL_SRC_ALPHA" && dst === "GL_ONE_MINUS_SRC_ALPHA") return "alpha";
  return "add";
}

/**
 * A sky shader's texture stages as cloud layers: scale and scroll from its
 * tcMods, tint from rgbGen const, blend from blendFunc. Stages without an image
 * (lightmap, white) are left out.
 */
export function cloudLayersFromStages(stages: readonly Q3ShaderStage[] | undefined): SkyCloudLayer[] {
  const layers: SkyCloudLayer[] = [];
  for (const stage of stages ?? []) {
    const map = stage.map ?? stage.animMap?.frames[0];
    if (!map || map.startsWith("$")) continue;
    const scale = stage.tcMod?.find((mod) => mod.type === "scale");
    const scroll = stage.tcMod?.find((mod) => mod.type === "scroll");
    const color = stage.rgbGen?.type === "const" && stage.rgbGen.color ? stage.rgbGen.color : [1, 1, 1];
    layers.push({
      texture: map,
      scale: scale ? [scale.sScale, scale.tScale] : [1, 1],
      scroll: scroll ? [scroll.sSpeed, scroll.tSpeed] : [0, 0],
      color: [color[0], color[1], color[2]],
      blend: cloudBlend(stage, layers.length === 0),
    });
  }
  return layers;
}
