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
 * WebGPU does not use these raised budgets; its compatibility path below
 * disables clustered containers and restores strict forward-light caps.
 */
export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 6;
export const SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 4;

/**
 * WebGPU's guaranteed per-stage uniform-buffer limit is 12. Babylon allocates
 * one UBO per forward light in addition to Scene/Mesh/Material (and bones for
 * skinned meshes), so the WebGL clustered-light budgets above are not safe on
 * all WebGPU adapters. Keep the original conservative caps until clustered
 * lighting passes the WebGPU acceptance gate.
 */
export const WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS = 2;
export const WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 1;

function getMaterialClassName(material: Material): string {
  return typeof material.getClassName === "function" ? material.getClassName() : material.constructor?.name || "";
}

function materialUsesWebGPU(material: Material): boolean {
  return material.getScene().getEngine().isWebGPU === true;
}

export function getSafeMaxSimultaneousLights(material: Material): number {
  const isPBR = getMaterialClassName(material) === "PBRMaterial";
  if (materialUsesWebGPU(material)) {
    return isPBR ? WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS : WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS;
  }
  return isPBR ? SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS : SAFE_MAX_SIMULTANEOUS_LIGHTS;
}

/**
 * Apply the backend-specific light budget. WebGL2 raises low caps to admit its
 * clustered containers; WebGPU clamps high caps to protect its command stream.
 */
export function applySafeMaxSimultaneousLights(material: Material | null | undefined): void {
  if (!material || !("maxSimultaneousLights" in material)) return;

  const budget = getSafeMaxSimultaneousLights(material);
  const target = material as Material & { maxSimultaneousLights?: number };
  if (materialUsesWebGPU(material)) {
    // Babylon can keep drawing an old effect while its replacement compiles.
    // After a light-count change, BindLights already uses the new count while
    // that old layout still requires the removed LightN buffers. WebGPU rejects
    // the bind group. Skip draws until the matching effect is ready instead.
    material.allowShaderHotSwapping = false;
    if (target.maxSimultaneousLights !== budget) {
      target.maxSimultaneousLights = budget;
      // Frozen StandardMaterial otherwise bypasses the dirty light defines.
      if (material.isFrozen) material.markDirty(true);
    }
    return;
  }
  if (target.maxSimultaneousLights === undefined || target.maxSimultaneousLights < budget) {
    target.maxSimultaneousLights = budget;
  }
}

export function applySafeSceneLightCaps(scene: Scene): void {
  for (const material of scene.materials) {
    applySafeMaxSimultaneousLights(material);
  }
}
