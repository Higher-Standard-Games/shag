import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Per-material `maxSimultaneousLights` budgets.
 *
 * WS1 (clustered dynamic lights): these were 2 (Standard) / 1 (PBR) under the
 * old forward-light SCARCITY system — every raw dynamic light cost a define +
 * uniforms, so materials were clamped hard and effect lights rationed to a
 * 4-light pool. Now the dynamic effect lights (pool + charge glows) live in a
 * ClusteredLightContainer, and static map lights + street lamps live in theirs.
 *
 * A cluster is ONE entry in `mesh.lightSources` (a `CLUSTLIGHT<i>` slot, its
 * per-light data in a texture) and IS counted against `maxSimultaneousLights`.
 * So a world surface's realistic light set is: hemispheric ambient + directional
 * sun + static-map cluster + dynamic cluster + (optional) street-lamp cluster =
 * up to 5. If the cap stays at 2, the dynamic cluster is truncated off world
 * surfaces and clustering buys nothing. Hence the budget is raised to admit all
 * the base lights and clusters, with headroom.
 *
 * This is a small fixed slot count (clusters hold their many lights in textures,
 * not uniforms), so it stays comfortably within WebGL2 uniform limits.
 */
export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 6;
export const SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 4;

function getMaterialClassName(material: Material): string {
  return typeof material.getClassName === "function" ? material.getClassName() : material.constructor?.name || "";
}

export function getSafeMaxSimultaneousLights(material: Material): number {
  return getMaterialClassName(material) === "PBRMaterial"
    ? SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS
    : SAFE_MAX_SIMULTANEOUS_LIGHTS;
}

/**
 * Ensure a material's `maxSimultaneousLights` is at least the budget above, so
 * the clustered dynamic/static lights are not truncated off the surface. (Names
 * kept for call-site stability; this now RAISES an under-budget cap rather than
 * clamping down a scarcity limit.)
 */
export function applySafeMaxSimultaneousLights(material: Material | null | undefined): void {
  if (!material || !("maxSimultaneousLights" in material)) return;

  const budget = getSafeMaxSimultaneousLights(material);
  const target = material as Material & { maxSimultaneousLights?: number };
  if (target.maxSimultaneousLights === undefined || target.maxSimultaneousLights < budget) {
    target.maxSimultaneousLights = budget;
  }
}

export function applySafeSceneLightCaps(scene: Scene): void {
  for (const material of scene.materials) {
    applySafeMaxSimultaneousLights(material);
  }
}
