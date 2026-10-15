/**
 * WeaponBarrels — Loading and spinning of barrel sub-model attachments
 *
 * Handles GLB barrel sub-models (spinning chambers, rolling clips)
 * that attach to the main weapon model's authored GLB tags. Falls back to
 * tags.txt/skeleton positioning for older models.
 *
 * Used by: WeaponViewManager
 */

import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { devLog, devLogEnabled } from "../core/DevLog";
import { applySafeMaxSimultaneousLights, clampMaterialLightCap } from "../lighting/DynamicLightSafety";
import { resolveModelAsset } from "../loader/model/ModelAsset";
import { ModelInstanceCache } from "../loader/model/ModelInstanceCache";
import type { ModelLoadResult } from "../loader/model/ModelLoader";
import { disposeModelResources } from "../loader/model/ModelSourceCache";
import { findTag, loadTags, type TagDef } from "../loader/model/TagsLoader";

// Layer mask for weapon-only rendering (must match WeaponViewManager)
const WEAPON_LAYER_MASK = 0x10000000;

export interface BarrelDef {
  modelPath: string;
  spinSpeed: number;
  spinDirection?: number;
  /** Offset from weapon origin (x, y, z in model space) */
  offset?: { x: number; y: number; z: number };
  /** Spin axis: 'x' (default), 'y', or 'z' */
  spinAxis?: "x" | "y" | "z";
  /** Degrees to index the barrel around its spin axis for each shot. */
  fireStepDegrees?: number;
}

interface BarrelInstance {
  root: TransformNode;
  spinSpeed: number;
  spinDirection: number;
  spinAxis: "x" | "y" | "z";
  rotation: number;
  targetRotation: number;
  fireStepRadians: number;
  resources?: ModelLoadResult;
}

/** A tags.txt rule takes precedence over a same-named GLB node. */
export function findViewBarrelSocket(
  barrelTag: TagDef | undefined,
  attachmentNodes: readonly TransformNode[],
): TransformNode | null {
  if (barrelTag) return null;
  return attachmentNodes.find((node) => node.name === "tag_barrel") ?? null;
}

/**
 * Manages spinning barrel sub-models attached to a weapon.
 */
export class WeaponBarrels {
  private barrels: BarrelInstance[] = [];
  private sources: ModelInstanceCache | null = null;
  private sourceScene: Scene | null = null;
  private generation = 0;

  /** Dispose all barrel meshes and clear state */
  dispose(): void {
    ++this.generation;
    for (const b of this.barrels) disposeModelResources([b.root, b.resources?.root], b.resources ?? {});
    this.barrels = [];
  }

  /** A switch retires clones; only view teardown/re-init retires sources. */
  releaseSources(): void {
    this.dispose();
    this.sources?.dispose();
    this.sources = null;
    this.sourceScene = null;
  }

  private async loadSource(path: string, scene: Scene): Promise<ModelLoadResult> {
    const { ImportMeshAsync } = await import("@babylonjs/core/Loading/sceneLoader");
    const asset = await resolveModelAsset(path);
    const result = await ImportMeshAsync(asset.source, scene, asset.options);
    const root = new TransformNode("viewBarrelSource", scene);
    try {
      for (const node of [...result.transformNodes, ...result.meshes]) if (!node.parent) node.parent = root;
      for (const mesh of result.meshes) {
        mesh.rotationQuaternion = null;
        mesh.renderingGroupId = 1;
        mesh.layerMask = WEAPON_LAYER_MASK;
        if (mesh.material instanceof PBRMaterial) {
          const pbr = mesh.material;
          pbr.environmentIntensity = 2.0;
          pbr.directIntensity = 1.0;
          pbr.zOffset = -2;
          pbr.backFaceCulling = false;
          applySafeMaxSimultaneousLights(pbr);
        }
      }
      return {
        root,
        meshes: result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh),
        skeletons: result.skeletons,
        animationGroups: result.animationGroups,
        lights: [],
      };
    } catch (error) {
      disposeModelResources([root, ...result.meshes, ...result.transformNodes], result);
      throw error;
    }
  }

  /** Update barrel spin (call each frame) */
  update(deltaTime: number): void {
    for (const barrel of this.barrels) {
      if (barrel.fireStepRadians) {
        const remaining = barrel.targetRotation - barrel.rotation;
        const maxTurn = (barrel.fireStepRadians / 0.16) * deltaTime;
        barrel.rotation += Math.sign(remaining) * Math.min(Math.abs(remaining), maxTurn);
      } else {
        barrel.rotation += barrel.spinSpeed * barrel.spinDirection * deltaTime;
      }
      switch (barrel.spinAxis) {
        case "y":
          barrel.root.rotation.y = barrel.rotation;
          break;
        case "z":
          barrel.root.rotation.z = barrel.rotation;
          break;
        default:
          barrel.root.rotation.x = barrel.rotation;
          break;
      }
    }
  }

  /** Index shot-driven barrels once when a shot is presented. */
  fire(): void {
    for (const barrel of this.barrels) {
      barrel.targetRotation += barrel.fireStepRadians * barrel.spinDirection;
    }
  }

  /** Number of loaded barrels */
  get count(): number {
    return this.barrels.length;
  }

  /**
   * Load barrel sub-model GLBs and attach to the weapon's GLB root.
   * Reads tags.txt from the weapon model directory for positioning.
   * Safe for concurrent loads — checks loadGen to bail if weapon changed.
   */
  async load(
    barrelDefs: BarrelDef[],
    glbRoot: TransformNode,
    weaponName: string,
    scene: Scene,
    loadGen: number,
    currentLoadGen: () => number,
    attachmentNodes: readonly TransformNode[] = [],
  ): Promise<void> {
    if (this.sourceScene !== scene) {
      this.releaseSources();
      this.sourceScene = scene;
      this.sources = new ModelInstanceCache(scene, (path) => this.loadSource(path, scene));
    }
    const sources = this.sources!;
    const generation = this.generation;
    const stale = () =>
      generation !== this.generation || currentLoadGen() !== loadGen || glbRoot.isDisposed() || scene.isDisposed;

    // Derive model directory from first barrel path for tags.txt lookup
    const firstPath = barrelDefs[0]?.modelPath;
    if (!firstPath) return;
    const modelDir = firstPath.substring(0, firstPath.lastIndexOf("/") + 1);

    // Load tags.txt from the weapon model directory
    const tags = await loadTags(modelDir);
    const barrelTag = findTag(tags, "tag_barrel");
    const attachment = findViewBarrelSocket(barrelTag, attachmentNodes);

    if (barrelTag) {
      devLog(
        `[WeaponBarrels] Found tag_barrel: bone="${barrelTag.boneName}" offset=(${barrelTag.offset.x},${barrelTag.offset.y},${barrelTag.offset.z})`,
      );
    } else {
      devLog(`[WeaponBarrels] No tag_barrel in tags.txt, using GLB socket or model origin`);
    }

    // Debug: log all skeleton bones in scene to find IQM tags
    if (devLogEnabled())
      for (const skeleton of scene.skeletons) {
        const boneNames = skeleton.bones.map((b) => b.name);
        devLog(`[WeaponBarrels] Skeleton "${skeleton.name}": ${boneNames.length} bones: [${boneNames.join(", ")}]`);
      }

    for (let i = 0; i < barrelDefs.length; i++) {
      const barrelDef = barrelDefs[i];
      try {
        // Check if weapon was switched during async load
        if (stale()) return;

        const lastSlash = barrelDef.modelPath.lastIndexOf("/");
        const file = barrelDef.modelPath.substring(lastSlash + 1);

        const result = await sources.createInstance(barrelDef.modelPath, 1);
        if (!result) continue;
        for (const mesh of result.meshes) {
          clampMaterialLightCap(mesh.material);
          if (scene.getEngine().isWebGPU && mesh.material) mesh.material.allowShaderHotSwapping = false;
        }

        // Check again after async
        if (stale()) {
          disposeModelResources([result.root], result);
          return;
        }

        const barrelRoot = result.meshes[0];
        if (!barrelRoot) {
          disposeModelResources([result.root], result);
          continue;
        }

        // Authored GLB tags are children of the weapon's view hierarchy.
        // Skeleton bone nodes can be at scene root, so the fallback uses glbRoot.
        barrelRoot.parent = attachment ?? glbRoot;
        result.root.setEnabled(false);
        if (barrelRoot.rotationQuaternion) barrelRoot.rotationQuaternion = null;

        // Read bone position for offset (if tag references a bone)
        let boneOffX = 0,
          boneOffY = 0,
          boneOffZ = 0;
        if (!attachment && barrelTag?.boneName) {
          for (const skeleton of scene.skeletons) {
            const bone = skeleton.bones.find((b) => b.name === barrelTag.boneName);
            if (bone) {
              const boneNode = bone.getTransformNode();
              if (
                boneNode &&
                (boneNode.isDescendantOf(glbRoot) || (glbRoot.parent && boneNode.isDescendantOf(glbRoot.parent)))
              ) {
                // Read the bone's local position (within skeleton space)
                boneOffX = boneNode.position.x;
                boneOffY = boneNode.position.y;
                boneOffZ = boneNode.position.z;
                devLog(
                  `[WeaponBarrels] Bone ${barrelTag.boneName} position: (${boneOffX.toFixed(2)},${boneOffY.toFixed(2)},${boneOffZ.toFixed(2)})`,
                );
                break;
              }
            }
          }
        }

        // Apply: bone position + tag offset + per-barrel BarrelDef offset
        const tagOff = barrelTag?.offset;
        const defOff = barrelDef.offset;
        barrelRoot.position.set(
          boneOffX + (tagOff?.x ?? 0) + (defOff?.x ?? 0),
          boneOffY + (tagOff?.y ?? 0) + (defOff?.y ?? 0),
          boneOffZ + (tagOff?.z ?? 0) + (defOff?.z ?? 0),
        );
        if (tagOff && !attachment) {
          // Barrel inherits glbRoot's rotation; only apply tag rotation delta
          barrelRoot.rotation.set(barrelTag!.rotation.x, barrelTag!.rotation.y, barrelTag!.rotation.z);
        } else {
          barrelRoot.rotation.setAll(0);
        }

        this.barrels.push({
          root: barrelRoot as TransformNode,
          resources: result,
          spinSpeed: barrelDef.spinSpeed,
          spinDirection: barrelDef.spinDirection ?? 1,
          spinAxis: barrelDef.spinAxis ?? "x",
          rotation: 0,
          targetRotation: 0,
          fireStepRadians: ((barrelDef.fireStepDegrees ?? 0) * Math.PI) / 180,
        });

        devLog(
          `[WeaponBarrels] Loaded barrel ${i} for ${weaponName}: ${file} (${result.meshes.length} meshes, pos: (${barrelRoot.position.x.toFixed(1)},${barrelRoot.position.y.toFixed(1)},${barrelRoot.position.z.toFixed(1)}))`,
        );
      } catch (e) {
        console.warn(`[WeaponBarrels] Failed to load barrel ${i} for ${weaponName}:`, e);
      }
    }
  }
}
