import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ResolvedMaterialProps } from "./Q3ShaderTypes";

/** Alpha testing and framebuffer blending are independent Q3 stage operations. */
export function configureQ3Alpha(material: StandardMaterial, props: ResolvedMaterialProps): void {
  const test = props.alphaCutoff !== undefined;
  const blend = ["blend", "add", "multiply"].includes(props.alphaMode);
  material.transparencyMode = test
    ? blend
      ? Material.MATERIAL_ALPHATESTANDBLEND
      : Material.MATERIAL_ALPHATEST
    : blend
      ? Material.MATERIAL_ALPHABLEND
      : Material.MATERIAL_OPAQUE;
  material.alphaMode = q3AlphaMode(props);
  material.alphaCutOff = props.alphaCutoff ?? 0.5;
  material.useAlphaFromDiffuseTexture = test || blend;
  material.disableDepthWrite = props.depthWrite === false;
  // Babylon disables depth writes for the transparent queue unless forced.
  material.forceDepthWrite = props.depthWrite !== false && props.primaryStage?.depthWrite === true;
}

/** Preserve the authored source factor; Q3 add does not use texture alpha. */
export function q3AlphaMode(props: Pick<ResolvedMaterialProps, "alphaMode" | "blendFunc">): number {
  switch (props.alphaMode) {
    case "add":
      return props.blendFunc?.[0] === "GL_SRC_ALPHA" ? Constants.ALPHA_ADD : Constants.ALPHA_ONEONE;
    case "multiply":
      return Constants.ALPHA_MULTIPLY;
    case "blend":
      return Constants.ALPHA_COMBINE;
    default:
      return Constants.ALPHA_DISABLE;
  }
}
