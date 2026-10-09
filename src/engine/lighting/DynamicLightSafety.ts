import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { supportsClusteredLighting } from "./DynamicLightCluster";

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
 * WebGPU uses the same budgets when clustered lighting is supported, while
 * retaining a strict upper bound after glTF imports and disabling hot swapping.
 */
export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 6;
export const SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 4;

/**
 * WebGPU's guaranteed per-stage uniform-buffer limit is 12. Babylon allocates
 * one UBO per forward light in addition to material resources. Retain the
 * conservative fallback for backends that cannot use clustered lighting.
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
  if (materialUsesWebGPU(material) && !supportsClusteredLighting(material.getScene())) {
    return isPBR ? WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS : WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS;
  }
  return isPBR ? SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS : SAFE_MAX_SIMULTANEOUS_LIGHTS;
}

type LightCapMaterial = Material & { maxSimultaneousLights?: number };

/** Unguarded setters of materials whose cap writes are guarded; see guardLightCapRaises. */
const policySetters = new WeakMap<Material, (value: number) => void>();

/**
 * On WebGPU only this policy may raise a material's light cap; any other write
 * may only lower it.
 *
 * Babylon's glTF loader raises the cap of EVERY scene material to the scene's
 * light count at the end of each import. Clamped back afterwards, every import
 * toggled every material twice, and each change marks all its submeshes
 * light-dirty: during first-person spectating, where weapon models keep
 * loading, that re-prepared the whole scene's effects and bind groups every
 * frame and stalled WebGPU. Ignoring the raise leaves the value unchanged, and
 * Babylon's setter skips unchanged values, so nothing goes dirty.
 *
 * Only materials whose cap is an accessor (Babylon's Standard and PBR) are
 * guarded; anything else keeps plain writes.
 */
function guardLightCapRaises(material: LightCapMaterial): void {
  if (policySetters.has(material)) return;
  let proto: object | null = Object.getPrototypeOf(material);
  let accessor: PropertyDescriptor | undefined;
  while (proto && !accessor) {
    accessor = Object.getOwnPropertyDescriptor(proto, "maxSimultaneousLights");
    proto = Object.getPrototypeOf(proto);
  }
  const { get, set } = accessor ?? {};
  if (!get || !set) return;
  Object.defineProperty(material, "maxSimultaneousLights", {
    configurable: true,
    enumerable: accessor?.enumerable ?? false,
    get() {
      return get.call(this);
    },
    set(value: number) {
      if (value <= get.call(this)) set.call(this, value);
    },
  });
  policySetters.set(material, (value) => set.call(material, value));
}

function setLightCap(material: LightCapMaterial, value: number): void {
  const set = policySetters.get(material);
  if (set) set(value);
  else material.maxSimultaneousLights = value;
}

/**
 * Apply the backend-specific light budget. WebGL2 raises low caps to admit its
 * clustered containers; WebGPU sets the budget exactly to protect its command
 * stream, and from then on refuses raises from anywhere else.
 */
export function applySafeMaxSimultaneousLights(material: Material | null | undefined): void {
  if (!material || !("maxSimultaneousLights" in material)) return;

  const budget = getSafeMaxSimultaneousLights(material);
  const target = material as LightCapMaterial;
  if (materialUsesWebGPU(material)) {
    // Babylon can keep drawing an old effect while its replacement compiles.
    // After a light-count change, BindLights already uses the new count while
    // that old layout still requires the removed LightN buffers. WebGPU rejects
    // the bind group. Skip draws until the matching effect is ready instead.
    material.allowShaderHotSwapping = false;
    guardLightCapRaises(target);
    if (target.maxSimultaneousLights !== budget) {
      setLightCap(target, budget);
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

/**
 * After a glTF import on WebGPU: guard every material and only lower caps above
 * the budget. Never raises, so a material deliberately kept under budget (the
 * view weapon's) is not bumped back up and recompiled by each import.
 */
export function clampSceneLightCaps(scene: Scene): void {
  for (const material of scene.materials) {
    if (!("maxSimultaneousLights" in material) || !materialUsesWebGPU(material)) continue;
    const target = material as LightCapMaterial;
    guardLightCapRaises(target);
    const budget = getSafeMaxSimultaneousLights(material);
    if ((target.maxSimultaneousLights ?? 0) > budget) {
      setLightCap(target, budget);
      if (material.isFrozen) material.markDirty(true);
    }
  }
}
