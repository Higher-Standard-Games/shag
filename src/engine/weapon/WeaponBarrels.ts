/**
 * WeaponBarrels — Loading and spinning of barrel sub-model attachments
 *
 * Handles GLB barrel sub-models (spinning chambers, rolling clips)
 * that attach to the main weapon model's authored GLB tags. Falls back to
 * tags.txt/skeleton positioning for older models.
 *
 * Used by: WeaponViewManager
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { devLog, devLogEnabled } from "../core/DevLog";
import { applySafeMaxSimultaneousLights, clampMaterialLightCap } from "../lighting/DynamicLightSafety";
import { resolveModelAsset } from "../loader/model/ModelAsset";
import { ModelInstanceCache } from "../loader/model/ModelInstanceCache";
import type { ModelAttachmentPoint, ModelLoadResult } from "../loader/model/ModelLoader";
import { disposeModelResources } from "../loader/model/ModelSourceCache";
import { findTag, loadTags, type TagDef } from "../loader/model/TagsLoader";

// Layer mask for weapon-only rendering (must match WeaponViewManager)
const WEAPON_LAYER_MASK = 0x10000000;

export interface BarrelDef {
  modelPath: string;
  spinSpeed: number;
  /** Spin speed while firing; spinSpeed when absent. */
  firingSpinSpeed?: number;
  /** Seconds to slow from the firing speed back to spinSpeed after the last shot. */
  spinDownSeconds?: number;
  spinDirection?: number;
  /** Offset from weapon origin (x, y, z in model space) */
  offset?: { x: number; y: number; z: number };
  /** Spin axis: 'x' (default), 'y', or 'z' */
  spinAxis?: "x" | "y" | "z";
  /** Degrees to turn the barrel around its spin axis for each shot, over the weapon's refire interval. */
  fireStepDegrees?: number;
  /**
   * Model units a sliding part (a bolt) moves back along its spin axis: it
   * cycles back and forward on each shot and is racked once while reloading.
   */
  slideDistance?: number;
}

/** Seconds a barrel takes to reach its firing speed. */
const SPIN_UP_SECONDS = 0.15;
/** A shot keeps barrels at firing speed this long when the refire interval is unknown. */
const DEFAULT_FIRING_HOLD_SECONDS = 0.15;
/** A shot's barrel step takes this long when the refire interval is unknown. */
const DEFAULT_STEP_SECONDS = 0.16;
/** A shot's slide cycle lasts at most this long. */
const SHOT_SLIDE_SECONDS = 0.1;
/** The reload rack: when it starts (share of the reload) and how long it lasts. */
const RELOAD_RACK_AT = 0.45;
const RELOAD_RACK_SECONDS = 0.35;

/** A slide cycle's offset at progress t: snaps back, then returns more slowly. */
export function slideCycle(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.3) {
    const back = t / 0.3;
    return 1 - (1 - back) * (1 - back);
  }
  const forward = (t - 0.3) / 0.7;
  return 1 - forward * forward * (3 - 2 * forward);
}

interface BarrelInstance {
  root: TransformNode;
  /** Idle speed */
  spinSpeed: number;
  firingSpinSpeed: number;
  spinDownSeconds: number;
  /** Current speed, between idle and firing */
  speed: number;
  /** Seconds left at firing speed since the last shot */
  firingHold: number;
  spinDirection: number;
  spinAxis: "x" | "y" | "z";
  rotation: number;
  targetRotation: number;
  fireStepRadians: number;
  /** The current step: where it started, how long it lasts, how far in it is */
  stepFrom: number;
  stepSeconds: number;
  stepElapsed: number;
  /** A sliding part: its distance, rest position, and the cycle under way */
  slideDistance: number;
  slideRest: number;
  slideDelay: number;
  slideSeconds: number;
  slideElapsed: number;
  resources?: ModelLoadResult;
}

/**
 * Draw a barrel sub-model's materials as the layers they are. The IQM→GLB
 * conversion baked every layer as an opaque, lit base texture: the energy
 * layers (`_plasma`, `_halo`, `_glow`, `_emit`: light on black) draw added
 * and self-lit, so their black drops out, and `_glass` draws translucent.
 * Call on a source model before it is cloned.
 */
export function prepareBarrelMaterials(meshes: readonly AbstractMesh[]): void {
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!(material instanceof PBRMaterial)) continue;
    const name = material.name.toLowerCase();
    if (/_(plasma|halo|glow|emit)$/.test(name)) {
      drawAsAddedLight(material);
    } else if (name.endsWith("_glass")) {
      material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      material.alpha = 0.35;
      material.backFaceCulling = false;
    }
  }
}

/**
 * Draw a baked energy layer (light on black: a glow, a halo, a plasma streak)
 * as light added over what is behind it, unlit, so its black drops out.
 */
export function drawAsAddedLight(material: PBRMaterial): void {
  material.unlit = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
}

/**
 * A weapon model drawn in the world (a pickup, a dropped weapon, another
 * player's gun): its glow gradients (`_glow`, light shining out of the gun on
 * black) draw as added light, as the first-person view draws them, instead
 * of as opaque black-edged panels.
 */
export function prepareWorldWeaponMaterials(meshes: readonly AbstractMesh[]): void {
  for (const mesh of meshes) {
    const material = mesh.material;
    if (material instanceof PBRMaterial && material.name.toLowerCase().endsWith("_glow")) drawAsAddedLight(material);
  }
}

/** Whether a mesh draws as added light, which an outline must not trace. */
export function drawsAddedLight(mesh: AbstractMesh): boolean {
  return mesh.material?.alphaMode === Constants.ALPHA_ADD && mesh.material.needAlphaBlending();
}

/**
 * Load a barrel sub-model as a source for clones: its imported nodes under a
 * neutral root, its materials prepared. Barrel GLBs ship inside the weapon
 * package, so the path resolves through the package index.
 */
export async function loadBarrelSource(path: string, scene: Scene, rootName: string): Promise<ModelLoadResult> {
  const { ImportMeshAsync } = await import("@babylonjs/core/Loading/sceneLoader");
  const asset = await resolveModelAsset(path);
  const result = await ImportMeshAsync(asset.source, scene, asset.options);
  const root = new TransformNode(rootName, scene);
  for (const node of [...result.transformNodes, ...result.meshes]) if (!node.parent) node.parent = root;
  prepareBarrelMaterials(result.meshes);
  return {
    root,
    meshes: result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh),
    skeletons: result.skeletons,
    animationGroups: result.animationGroups,
    lights: [],
  };
}

/** Where a world weapon model carries its barrels, in the leader mesh's space. */
interface BarrelMount {
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: Quaternion | null;
}

async function findBarrelMount(
  barrelDefs: readonly BarrelDef[],
  attachmentPoints: Readonly<Record<string, ModelAttachmentPoint>> | undefined,
  scene: Scene,
): Promise<BarrelMount> {
  const firstPath = barrelDefs[0].modelPath;
  const tags = await loadTags(firstPath.substring(0, firstPath.lastIndexOf("/") + 1));
  const tag = findTag(tags, "tag_barrel");
  // Authored GLB attachment nodes are the model-space anchors; the model
  // loader snapshots them, since cached clones flatten the node tree
  const attachment = (tag?.boneName && attachmentPoints?.[tag.boneName]) || attachmentPoints?.tag_barrel;
  const position = attachment?.position.clone() ?? Vector3.Zero();
  if (!attachment && tag?.boneName) {
    for (const skeleton of scene.skeletons) {
      const node = skeleton.bones.find((bone) => bone.name === tag.boneName)?.getTransformNode();
      if (node) {
        position.copyFrom(node.position);
        break;
      }
    }
  }
  if (tag) position.addInPlaceFromFloats(tag.offset.x, tag.offset.y, tag.offset.z);
  const q = attachment?.rotationQuaternion;
  return {
    position,
    rotationQuaternion: q ? new Quaternion(q.x, q.y, q.z, q.w) : null,
    rotation: attachment
      ? attachment.rotation.clone()
      : tag
        ? new Vector3(tag.rotation.x, tag.rotation.y, tag.rotation.z)
        : Vector3.Zero(),
  };
}

/**
 * Load a weapon's barrel sub-models and place them on a world weapon model
 * (a pickup, a dropped weapon, another player's gun): each barrel's root is
 * parented to `leader` at the weapon's barrel mount plus the barrel's own
 * offset. `load` returns a barrel instance, or null to skip it; `adopt` gives
 * the caller each placed instance, and `stale` stops a load whose weapon went
 * away. Barrels on world models do not spin.
 */
export async function attachWorldBarrels(options: {
  leader: TransformNode;
  barrels: readonly BarrelDef[];
  attachmentPoints?: Readonly<Record<string, ModelAttachmentPoint>>;
  scene: Scene;
  load: (path: string) => Promise<ModelLoadResult | null>;
  adopt?: (barrel: ModelLoadResult) => void;
  stale?: () => boolean;
  label: string;
}): Promise<void> {
  const { leader, barrels, scene, load, adopt, stale = () => false, label } = options;
  if (!barrels.length) return;
  const mount = await findBarrelMount(barrels, options.attachmentPoints, scene);
  for (const barrel of barrels) {
    if (stale()) return;
    try {
      const result = await load(barrel.modelPath);
      if (!result) continue;
      if (stale()) {
        disposeModelResources([result.root], result);
        return;
      }
      const root = result.meshes[0];
      if (!root) {
        disposeModelResources([result.root], result);
        continue;
      }
      root.parent = leader;
      root.position.copyFrom(mount.position);
      if (barrel.offset) root.position.addInPlaceFromFloats(barrel.offset.x, barrel.offset.y, barrel.offset.z);
      root.rotationQuaternion = mount.rotationQuaternion?.clone() ?? null;
      if (!root.rotationQuaternion) root.rotation.copyFrom(mount.rotation);
      for (const mesh of result.meshes) applySafeMaxSimultaneousLights(mesh.material);
      adopt?.(result);
    } catch (error) {
      console.warn(`[${label}] Barrel load failed:`, error);
    }
  }
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
    const source = await loadBarrelSource(path, scene, "viewBarrelSource");
    for (const mesh of source.meshes) {
      mesh.rotationQuaternion = null;
      mesh.renderingGroupId = 1;
      mesh.layerMask = WEAPON_LAYER_MASK;
      if (mesh.material instanceof PBRMaterial && !mesh.material.unlit) {
        const pbr = mesh.material;
        pbr.environmentIntensity = 2.0;
        pbr.directIntensity = 1.0;
        pbr.zOffset = -2;
        pbr.backFaceCulling = false;
        applySafeMaxSimultaneousLights(pbr);
      }
    }
    return source;
  }

  /** Update barrel spin (call each frame) */
  update(deltaTime: number): void {
    for (const barrel of this.barrels) {
      if (barrel.fireStepRadians) {
        // Each shot's turn runs eased over the refire interval: the barrel
        // brings the next round round while the weapon reloads
        barrel.stepElapsed = Math.min(barrel.stepSeconds, barrel.stepElapsed + deltaTime);
        const t = barrel.stepSeconds > 0 ? barrel.stepElapsed / barrel.stepSeconds : 1;
        const eased = t * t * (3 - 2 * t);
        barrel.rotation = barrel.stepFrom + (barrel.targetRotation - barrel.stepFrom) * eased;
      } else {
        // Spin up quickly while firing; after the last shot, slow back to
        // idle over spinDownSeconds
        const range = barrel.firingSpinSpeed - barrel.spinSpeed;
        barrel.firingHold = Math.max(0, barrel.firingHold - deltaTime);
        if (barrel.firingHold > 0) {
          barrel.speed = Math.min(barrel.firingSpinSpeed, barrel.speed + (range / SPIN_UP_SECONDS) * deltaTime);
        } else if (barrel.speed > barrel.spinSpeed) {
          const rate = barrel.spinDownSeconds > 0 ? range / barrel.spinDownSeconds : Infinity;
          barrel.speed = Math.max(barrel.spinSpeed, barrel.speed - rate * deltaTime);
        }
        barrel.rotation += barrel.speed * barrel.spinDirection * deltaTime;
      }
      if (barrel.slideDistance) this.updateSlide(barrel, deltaTime);
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

  /**
   * A shot is presented: turn shot-driven barrels one step over the refire
   * interval, and hold spinning barrels at firing speed until the next shot
   * is due.
   */
  fire(refireSeconds?: number): void {
    const hold = refireSeconds ? refireSeconds * 1.5 : DEFAULT_FIRING_HOLD_SECONDS;
    for (const barrel of this.barrels) {
      if (barrel.slideDistance)
        this.startSlide(barrel, 0, Math.min(SHOT_SLIDE_SECONDS, refireSeconds ?? SHOT_SLIDE_SECONDS));
      barrel.stepFrom = barrel.rotation;
      barrel.stepSeconds = refireSeconds ?? DEFAULT_STEP_SECONDS;
      barrel.stepElapsed = 0;
      barrel.targetRotation += barrel.fireStepRadians * barrel.spinDirection;
      barrel.firingHold = hold;
    }
  }

  /** The weapon reloads over `seconds`: sliding parts are racked once. */
  reload(seconds: number): void {
    for (const barrel of this.barrels) {
      if (barrel.slideDistance) this.startSlide(barrel, seconds * RELOAD_RACK_AT, RELOAD_RACK_SECONDS);
    }
  }

  private startSlide(barrel: BarrelInstance, delay: number, seconds: number): void {
    barrel.slideDelay = delay;
    barrel.slideSeconds = seconds;
    barrel.slideElapsed = 0;
  }

  private updateSlide(barrel: BarrelInstance, deltaTime: number): void {
    let offset = 0;
    if (barrel.slideSeconds > 0) {
      if (barrel.slideDelay > 0) barrel.slideDelay -= deltaTime;
      else {
        barrel.slideElapsed += deltaTime;
        const t = barrel.slideElapsed / barrel.slideSeconds;
        if (t >= 1) barrel.slideSeconds = 0;
        else offset = slideCycle(t);
      }
    }
    const position = barrel.root.position;
    const back = barrel.slideRest - offset * barrel.slideDistance;
    if (barrel.spinAxis === "y") position.y = back;
    else if (barrel.spinAxis === "z") position.z = back;
    else position.x = back;
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
      // Barrels only spin; their read-only PBR materials are shared (not on WebGPU)
      this.sources = new ModelInstanceCache(scene, (path) => this.loadSource(path, scene), {
        shareStaticMaterials: !scene.getEngine().isWebGPU,
      });
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
          firingSpinSpeed: Math.max(barrelDef.spinSpeed, barrelDef.firingSpinSpeed ?? barrelDef.spinSpeed),
          spinDownSeconds: barrelDef.spinDownSeconds ?? 0,
          speed: barrelDef.spinSpeed,
          firingHold: 0,
          spinDirection: barrelDef.spinDirection ?? 1,
          spinAxis: barrelDef.spinAxis ?? "x",
          rotation: 0,
          targetRotation: 0,
          fireStepRadians: ((barrelDef.fireStepDegrees ?? 0) * Math.PI) / 180,
          stepFrom: 0,
          stepSeconds: 0,
          stepElapsed: 0,
          slideDistance: barrelDef.slideDistance ?? 0,
          slideRest:
            barrelDef.spinAxis === "y"
              ? barrelRoot.position.y
              : barrelDef.spinAxis === "z"
                ? barrelRoot.position.z
                : barrelRoot.position.x,
          slideDelay: 0,
          slideSeconds: 0,
          slideElapsed: 0,
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
