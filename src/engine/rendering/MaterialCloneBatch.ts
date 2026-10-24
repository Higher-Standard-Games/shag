import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { isSceneRendererPolicyApplied } from "./SceneRendererPolicy";

Cvar.register("r_material_clone_batch", 1, {
  type: "int",
  min: 0,
  max: 1,
  persist: false,
  description: "Batch fresh PBR material property updates and renderer policy during model cloning",
});

/**
 * Run `clone` with the source's textures cloning to themselves, so the copy
 * samples the very texture objects the source does. Babylon's material clone
 * clones every texture, and a texture made from bytes (a GLB's embedded images
 * are) has no URL to find its upload by, so each clone decoded and uploaded
 * the image again: a player respawning or a weapon being drawn in a fight cost
 * an image decode per texture. Disposal already keeps a texture while any
 * material samples it, and the cached source keeps sampling these.
 */
function withSharedTextures<T>(source: Material, clone: () => T): T {
  const materials = source instanceof MultiMaterial ? [source, ...source.subMaterials] : [source];
  const shared = new Set<BaseTexture>();
  for (const material of materials) for (const texture of material?.getActiveTextures() ?? []) shared.add(texture);
  for (const texture of shared) Object.defineProperty(texture, "clone", { value: () => texture, configurable: true });
  try {
    return clone();
  } finally {
    for (const texture of shared) delete (texture as { clone?: unknown }).clone;
  }
}

/** Keep Babylon's clone implementation, including plugins and MultiMaterial children; textures are shared. */
export function cloneModelMaterial(source: Material, name: string, cloneChildren = false): Material | null {
  const clone = () =>
    withSharedTextures(source, () =>
      source instanceof MultiMaterial ? source.clone(name, cloneChildren) : source.clone(name),
    );
  const prototype = Object.getPrototypeOf(source);
  const nativeChild = (material: Material | null) => {
    if (!material) return true;
    const proto = Object.getPrototypeOf(material);
    return (proto === PBRMaterial.prototype || proto === StandardMaterial.prototype) && material.clone === proto.clone;
  };
  // Custom clone implementations can render or do unrelated work. Leave them alone.
  if (
    !Cvar.getBool("r_material_clone_batch") ||
    (prototype !== PBRMaterial.prototype && prototype !== MultiMaterial.prototype) ||
    source.clone !== prototype.clone ||
    (source instanceof MultiMaterial && (!cloneChildren || !source.subMaterials.every(nativeChild)))
  ) {
    return clone();
  }

  const scene = source.getScene();
  const descriptor = Object.getOwnPropertyDescriptor(scene, "addMaterial");
  const original = scene.addMaterial;
  const blocked: Material[] = [];
  const addMaterial = function (this: Scene, material: Material): void {
    const materialPrototype = Object.getPrototypeOf(material);
    if (
      this === scene &&
      materialPrototype === PBRMaterial.prototype &&
      !material.blockDirtyMechanism &&
      !scene.materials.includes(material)
    ) {
      // addMaterial is called from Material's constructor, before Babylon copies
      // dirty-enabling properties into this new clone. No existing material is blocked.
      material.blockDirtyMechanism = true;
      blocked.push(material);
    }
    original.call(this, material);
  };
  scene.addMaterial = addMaterial;
  let completed = false;
  try {
    const result = clone();
    completed = true;
    return result;
  } finally {
    if (scene.addMaterial === addMaterial) {
      if (descriptor) Object.defineProperty(scene, "addMaterial", descriptor);
      else delete (scene as Partial<Scene>).addMaterial;
    }
    // Babylon's public setter invalidates readiness once on release. Fresh
    // defines are built on first draw; existing scene materials stay unchanged.
    for (const material of blocked) {
      try {
        if (completed && isSceneRendererPolicyApplied(scene)) applySafeMaxSimultaneousLights(material);
      } finally {
        material.blockDirtyMechanism = false;
      }
    }
  }
}
