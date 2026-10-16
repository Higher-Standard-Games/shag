import { Constants } from "@babylonjs/core/Engines/constants";
import type { ResolvedMaterialProps } from "./Q3ShaderTypes";

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
