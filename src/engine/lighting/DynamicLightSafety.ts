import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { supportsClusteredLighting } from "./DynamicLightCluster";

/**
 * Per-material `maxSimultaneousLights` budgets.
 *
 * Dynamic effect lights (the pool and charge glows) live in a
 * ClusteredLightContainer, and static map lights and street lamps in theirs. A
 * cluster is ONE entry in `mesh.lightSources` (a `CLUSTLIGHT<i>` slot, its
 * per-light data in a texture) and counts against `maxSimultaneousLights`. A
 * world surface's realistic light set is hemispheric ambient + directional sun
 * + static-map cluster + dynamic cluster + (optional) street-lamp cluster: up
 * to 5. A cap below that truncates clusters off world surfaces.
 *
 * WebGPU with clustered lighting keeps a tighter bound after glTF imports and
 * disables hot swapping; WebGPU without it keeps the conservative fallback.
 */
export const WEBGPU_CLUSTERED_MAX_SIMULTANEOUS_LIGHTS = 6;
export const WEBGPU_CLUSTERED_PBR_MAX_SIMULTANEOUS_LIGHTS = 4;

/**
 * WebGL2 budgets: the scene's whole light set. Babylon's glTF loader raises
 * every material's cap to the scene's light count at the end of each import,
 * and on WebGL that raise is kept, so a material compiled at a lower cap
 * compiled again, with only `MAXLIGHTCOUNT` changed, the first time a model
 * loaded during play. Starting at the cap the loader raises to leaves those
 * raises with nothing to change. A material's lights come from its own light
 * set, not this bound, so the larger cap draws the same.
 */
export const SAFE_MAX_SIMULTANEOUS_LIGHTS = 8;
export const SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS = 8;

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
  if (materialUsesWebGPU(material)) {
    if (!supportsClusteredLighting(material.getScene())) {
      return isPBR ? WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS : WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS;
    }
    return isPBR ? WEBGPU_CLUSTERED_PBR_MAX_SIMULTANEOUS_LIGHTS : WEBGPU_CLUSTERED_MAX_SIMULTANEOUS_LIGHTS;
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
    clampMaterialLightCap(material);
  }
}

/** Install the WebGPU guard on a clone without raising its deliberate lower cap. */
export function clampMaterialLightCap(material: Material | null | undefined): void {
  if (!material || !("maxSimultaneousLights" in material) || !materialUsesWebGPU(material)) return;
  const target = material as LightCapMaterial;
  guardLightCapRaises(target);
  const budget = getSafeMaxSimultaneousLights(material);
  if ((target.maxSimultaneousLights ?? 0) > budget) {
    setLightCap(target, budget);
    if (material.isFrozen) material.markDirty(true);
  }
}
