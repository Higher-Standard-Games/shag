import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 2;
export const SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 1;

function getMaterialClassName(material: Material): string {
  return typeof material.getClassName === "function" ? material.getClassName() : material.constructor?.name || "";
}

export function getSafeMaxSimultaneousLights(material: Material): number {
  return getMaterialClassName(material) === "PBRMaterial"
    ? SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS
    : SAFE_MAX_SIMULTANEOUS_LIGHTS;
}

export function applySafeMaxSimultaneousLights(material: Material | null | undefined): void {
  if (!material || !("maxSimultaneousLights" in material)) return;

  const safeLimit = getSafeMaxSimultaneousLights(material);
  const target = material as Material & { maxSimultaneousLights?: number };
  if (target.maxSimultaneousLights === undefined || target.maxSimultaneousLights > safeLimit) {
    target.maxSimultaneousLights = safeLimit;
  }
}

export function applySafeSceneLightCaps(scene: Scene): void {
  for (const material of scene.materials) {
    applySafeMaxSimultaneousLights(material);
  }
}
