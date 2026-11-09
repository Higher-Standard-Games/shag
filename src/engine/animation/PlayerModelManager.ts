import { AnimatorAvatar } from "@babylonjs/core/Animations/animatorAvatar";
import { PLAYER_HEIGHT } from "../physics/PlayerPhysicsConstants";
import { PlayerOutlineSmoothing } from "../rendering/PlayerOutlineSmoothing";
import { PlayerAimPose } from "./PlayerAimPose";
import { measurePlayerModelFit, type PlayerModelFit } from "./PlayerModelFit";
/**
 * PlayerModelManager — Shared player model loading, animation, and instancing
 *
 * Loads the selected player GLB once, filters root-motion from animations, and creates
 * clean cloned instances for any consumer (debug player, remote players, bots).
 *
 * Design:
 *  - One manager per scene; loadModel() is idempotent.
 *  - The manager does NOT handle positioning or animation-state derivation —
 *    those are the caller's responsibility.
 *  - Each instance has its own skeleton, bone map, AnimationGroup, and anchor.
 */

import type { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AnimationGroupMask, AnimationGroupMaskMode } from "@babylonjs/core/Animations/animationGroupMask";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
// Side effect: registers the OutlineRenderer scene component — required for
// mesh.renderOutline (team outlines) to draw. Previously loaded implicitly by
// bare @babylonjs/core barrel imports; must be explicit with per-module imports.
import "@babylonjs/core/Rendering/outlineRenderer";
import { type Scene, Scene as SceneClass } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { disposeModelResources } from "../loader/model/ModelSourceCache";
import { cloneModelMaterial } from "../rendering/MaterialCloneBatch";
import { PlayerOutlineProxyRuntime } from "../rendering/PlayerOutlineProxyRuntime";
import { markSnapshotMaterialDynamic } from "../rendering/SnapshotFrames";
import {
  PLAYER_ANIMATION_ROOT,
  PLAYER_ANIMATIONS,
  PLAYER_MODEL_FILE,
  PLAYER_MODEL_ROOT,
  resolvePlayerModelAsset,
} from "./PlayerModelAssets";

// ─── Types ───────────────────────────────────────────────────────

/** A stored animation: name + array of (bone target, animation curve) */
export interface StoredAnim {
  name: string;
  animations: { target: TransformNode; animation: Animation }[];
}

/**
 * Seconds the scene's animations advance this frame: the same clamped engine
 * delta and time scale Babylon applies, so a stepped clip keeps pace with the
 * ones it plays itself.
 */
export function animationDeltaSeconds(scene: Scene): number {
  const delta = scene.useConstantAnimationDeltaTime
    ? 16
    : Math.max(SceneClass.MinDeltaTime, Math.min(scene.getEngine().getDeltaTime(), SceneClass.MaxDeltaTime));
  return (delta * scene.animationTimeScale) / 1000;
}

/**
 * Babylon remembers a `goToFrame` until the group next animates, and while it
 * remembers, every speed-ratio change re-poses the whole skeleton at that
 * frame. A paused group never animates, and the renderer sets the speed ratio
 * every frame, so a stepped player would be re-posed every frame after all.
 * Forgetting the jump stops that; `leaveStepped` jumps again before playing,
 * so resuming still starts at the right phase. (`_goToFrame` is Babylon 9.17
 * internal; PlayerModelPoseStepping.test.ts fails if it stops working.)
 */
function forgetPendingJump(group: AnimationGroup): void {
  for (const animatable of group.animatables)
    (animatable as unknown as { _goToFrame: number | null })._goToFrame = null;
}

/** Sample only locomotion-owned joints; AnimationGroup.goToFrame also writes masked targets. */
function poseLocomotionFrame(group: AnimationGroup, frame: number): void {
  if (!group.mask) {
    group.goToFrame(frame);
    return;
  }
  for (const animatable of group.animatables) {
    if (group.mask.retainsTarget(animatable.target.name)) animatable.goToFrame(frame);
  }
}

function locomotionFrame(group: AnimationGroup): number {
  return (
    group.animatables.find((animatable) => !group.mask || group.mask.retainsTarget(animatable.target.name))
      ?.masterFrame ?? group.getCurrentFrame()
  );
}

/** A looping clip's frame, wrapped into [from, to) in either direction. */
export function wrapFrame(frame: number, from: number, to: number): number {
  const range = to - from;
  if (!(range > 0) || !Number.isFinite(frame)) return from;
  return from + ((((frame - from) % range) + range) % range);
}

/** Per-entity instance returned to callers */
export interface PlayerModelInstance {
  id: string;
  anchor: TransformNode;
  mesh: Mesh;
  skeleton: Skeleton | null;
  anims: StoredAnim[];
  masterGroup: AnimationGroup | null;
  /**
   * Locomotion groups built so far, one per clip, reused on every switch.
   * `masterGroup` is whichever of them is current.
   */
  clipGroups?: Map<string, AnimationGroup>;
  /** Excludes upper-body joints from locomotion while an overlay owns them. */
  upperBodyMask?: AnimationGroupMask;
  currentAnim: string;
  /** Wall-clock deadline for a live one-shot; demos use their recorded timeline. */
  oneshotUntil: number;
  /**
   * Weapon mesh bone-attached to this model's hand (3rd-person view weapon).
   * Bone attachment means it is NOT a scene-graph child, so it must be disposed
   * explicitly with the model — otherwise it leaks (e.g. a dropped blade left
   * floating after death/ragdoll cleanup).
   */
  attachedWeapon?: TransformNode | null;
  /** Normalized hand frame for weapon attachments across exported rig units. */
  weaponHand?: TransformNode;
  /** Skinned mesh whose world transform converts joint units to world units. */
  rigMesh?: Mesh;
  /** Calibrated root scale and feet offset for the standing silhouette. */
  modelScale?: number;
  modelScaleFactor?: number;
  modelOffsetY?: number;
  /** Asset variant selected when the instance was created. */
  modelKey?: string;
  /**
   * Bind-pose local position of the Hips node, captured at instance creation.
   * `resetRootMotion` restores it every frame so root motion can never move the
   * body away from the anchor. Y is part of the bind pose (the skeleton's natural
   * hip height above the feet), so it is restored rather than zeroed.
   */
  hipsBind?: { node: TransformNode; x: number; y: number; z: number } | null;
  /**
   * The root-motion nodes under the mesh (`RootNode`, `Armature`, `__root__`),
   * found by `resetRootMotion` on its first call. The rig is cloned once per
   * instance and never re-parented, so the same nodes are found every time;
   * walking the skeleton per frame to find them again was most of the remote
   * renderer's garbage (B12 stage 1).
   */
  rootMotionNodes?: TransformNode[];
  /**
   * Each skeleton bone's transform node when the body was made. Babylon's
   * ragdoll unlinks every bone from its node; a body put away after one is
   * linked back so its animations drive it again.
   */
  boneNodes?: (TransformNode | null)[];
  /**
   * What a ragdoll takes from a body and a kept body gets back: its clips
   * (the ragdoll empties `anims`), its root mesh's name and each part's
   * pickability.
   */
  restore?: { anims: StoredAnim[]; name: string; pickable: boolean[] };
}

/**
 * Anchor-space cylinder that holds every pose the player rig reaches, in world
 * units (the anchor is unscaled and sits at the feet). Measured on vanguard.glb
 * by CPU-skinning 9 actors through a minute of FFA demo playback: at most
 * 41.3u from the vertical axis, -2.6u to 65.9u high. Padded by about half
 * again so an unmeasured clip or a heavier model does not clip at a screen edge.
 */
export const PLAYER_POSE_BOUNDS = { radius: 64, minY: -32, maxY: 96 } as const;

export type PlayerModelTeamColor = "alpha" | "beta" | "bravo" | "ffa";

/**
 * The material fields the powerup glow writes. Structural rather than
 * `StandardMaterial | PBRMaterial` because player models arrive from glTF with
 * either, and only these three fields are ever touched.
 */
interface GlowableMaterial {
  emissiveColor?: Color3;
  /** Stashed by applyVisualStyle so lifts are applied from a stable base. */
  __playerModelBaseEmissiveColor?: Color3;
}

/** GlowableMaterial plus the albedo tint applyVisualStyle writes (PBR only). */
interface TintableMaterial extends GlowableMaterial {
  albedoColor?: Color3;
  __playerModelBaseAlbedoColor?: Color3;
}

export interface PlayerModelVisualStyle {
  tintColor: Color3 | null;
  fullbrightEnabled: boolean;
  fullbrightIntensity: number;
  outlineEnabled: boolean;
  outlineColor: Color3;
  outlineWidth: number;
}

/** Animation file descriptor */
export interface AnimFileConfig {
  name: string;
  file: string;
  optional?: boolean;
}

// ─── Default animation set ──────────────────────────────────────

// Shared with the package builder. Missing optional victory dances fall back
// to idle without HTTP errors or re-downloading the archive for every clip.
export const DEFAULT_ANIM_FILES: AnimFileConfig[] = PLAYER_ANIMATIONS;

/** Victory-dance pool for the post-game winner showcase (random pick). */
export const DANCE_ANIMS = ["dance_1", "dance_2", "dance_3"];

// ─── Manager ─────────────────────────────────────────────────────

const NO_EMISSIVE: Readonly<Color3> = Color3.Black();

/** Bodies kept per player for their next lives: a ragdoll can still hold the last one at respawn. */
const MAX_PARKED_PER_PLAYER = 2;

/** The manager that made each body, for `releasePlayerModel`. */
const modelOwners = new WeakMap<PlayerModelInstance, PlayerModelManager>();

export class PlayerModelManager {
  /** applyPowerupGlow's mesh list per model. */
  private readonly glowMeshes = new WeakMap<PlayerModelInstance, AbstractMesh[]>();

  private scene: Scene;
  private readonly activeOneShots = new Map<
    PlayerModelInstance,
    { group: AnimationGroup; baseSpeedRatio: number; upperBodyOnly?: boolean }
  >();
  private readonly upperBodyTargets = new WeakMap<PlayerModelInstance, ReadonlySet<TransformNode>>();
  private readonly lowerBodyMasks = new WeakMap<PlayerModelInstance, AnimationGroupMask>();
  /** Clip phase kept by hand for instances whose pose is sampled at a reduced rate; see stepAnimation. */
  private readonly stepped = new WeakMap<
    PlayerModelInstance,
    { group: AnimationGroup; frame: number; upperFrame: number; since: number }
  >();
  /** Share of the locomotion clip's speed its upper-body joints play at; see setUpperBodyShare. */
  private readonly upperBodyShares = new WeakMap<PlayerModelInstance, number>();

  private readonly aimPoses = new Map<PlayerModelInstance, PlayerAimPose>();
  private aimBefore?: ReturnType<Scene["onBeforeAnimationsObservable"]["add"]>;
  private aimAfter?: ReturnType<Scene["onAfterAnimationsObservable"]["add"]>;

  /** View pitch is visual only; the anchor and lower-body locomotion stay upright. */
  setAimPitch(instance: PlayerModelInstance, pitch: number): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.setAimPitch(instance, pitch);
      return;
    }
    const safePitch = Number.isFinite(pitch) ? Math.max(-1.4, Math.min(1.4, pitch)) : 0;
    let pose = this.aimPoses.get(instance);
    if (!safePitch) {
      pose?.restore();
      this.aimPoses.delete(instance);
      return;
    }
    if (!pose) {
      pose = new PlayerAimPose(instance);
      this.aimPoses.set(instance, pose);
    }
    pose.pitch = safePitch;
    if (!this.aimBefore) {
      this.aimBefore = this.scene.onBeforeAnimationsObservable.add(() => {
        for (const item of this.aimPoses.values()) item.restore();
      });
      this.aimAfter = this.scene.onAfterAnimationsObservable.add(() => {
        for (const item of this.aimPoses.values()) item.apply();
      });
    }
  }

  private loaded = false;
  private disposed = false;
  private loadPromise: Promise<void> | null = null;
  private sourceContainer: AssetContainer | null = null;
  private modelFit?: PlayerModelFit;
  private handBasis: { rotation: Quaternion; scale: Vector3 } | null = null;
  private modelUrl = PLAYER_MODEL_ROOT + PLAYER_MODEL_FILE;
  private outlineProxyWanted = false;
  private outlineRuntime?: PlayerOutlineProxyRuntime;
  private outlineSmoothing?: PlayerOutlineSmoothing;
  private readonly instances = new Map<PlayerModelInstance, ReturnType<Mesh["onDisposeObservable"]["add"]>>();
  private readonly variants = new Map<string, PlayerModelManager>();
  /**
   * Bodies put away by player id, whole (rig, clip groups, materials), for
   * that player's next body: building one took 3.5 ms and its frames about
   * 30 ms more, and every body disposed and rebuilt changed the frame's draw
   * list.
   */
  private readonly parked = new Map<string, PlayerModelInstance[]>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Whether the model + animations are ready */
  get isLoaded(): boolean {
    return this.loaded;
  }

  // ── Loading ──────────────────────────────────────────────────

  /**
   * Load the player model and all animation files.
   * Idempotent — calling multiple times is safe; only loads once.
   */
  loadModel(
    modelPath: string = PLAYER_MODEL_ROOT,
    modelFile: string = PLAYER_MODEL_FILE,
    animFiles: AnimFileConfig[] = DEFAULT_ANIM_FILES,
    animationPath = modelPath === PLAYER_MODEL_ROOT ? PLAYER_ANIMATION_ROOT : modelPath,
  ): Promise<void> {
    if (this.disposed || this.loaded) return Promise.resolve();
    this.modelUrl = modelPath + modelFile;
    this.loadPromise ??= this.loadAssets(modelPath, modelFile, animFiles, animationPath).finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async loadAssets(
    modelPath: string,
    modelFile: string,
    animFiles: AnimFileConfig[],
    animationPath: string,
  ): Promise<void> {
    let container: AssetContainer | null = null;
    try {
      // Keep both model and clip imports out of the live scene. ImportAnimationsAsync
      // defaults to Clean even with overwriteAnimations:false, destroying OTHER
      // managers' animation groups (e.g. players when the teleport pool loads).
      const model = await resolvePlayerModelAsset(modelPath, modelFile);
      if (!model || this.disposed) return;
      const pluginOptions = { gltf: { animationStartMode: 0 } };
      container = await LoadAssetContainerAsync(model.source, this.scene, { ...model.options, pluginOptions });
      if (this.disposed) return;
      // Multiple skins may share the same linked joint nodes.
      const [sourceSkeleton] = container.skeletons;
      if (!sourceSkeleton) throw new Error("Player model has no skeleton");
      const boneMap = new Map<string, TransformNode>();
      for (const bone of sourceSkeleton.bones) {
        const node = bone.getTransformNode();
        if (node) boneMap.set(bone.name, node);
      }

      const embedded = container.animationGroups.splice(0);
      try {
        if (embedded[0]) this.storeAnimation(container, embedded[0], "embedded", boneMap);
        const running = embedded.find((group) => group.name === "Running");
        if (running) this.storeAnimation(container, running, "run_relaxed", boneMap);
      } finally {
        for (const group of embedded) group.dispose();
      }
      const avatar = new AnimatorAvatar("player", undefined, false);
      avatar.skeletons.add(sourceSkeleton);
      avatar.showWarnings = false;
      for (const anim of animFiles) {
        let clip: AssetContainer | null = null;
        try {
          const asset = await resolvePlayerModelAsset(animationPath, anim.file, anim.optional);
          if (!asset || this.disposed) continue;
          clip = await LoadAssetContainerAsync(asset.source, this.scene, { ...asset.options, pluginOptions });
          if (this.disposed) return;
          if (!clip.animationGroups[0]) throw new Error(`No animation group in ${anim.file}`);
          const source = clip.animationGroups[0];
          if (animationPath !== modelPath && !this.handBasis) {
            const referenceHand = source.targetedAnimations.find(
              (channel) => channel.target.name === "mixamorig:RightHand",
            )?.target as TransformNode | undefined;
            const hand = boneMap.get("mixamorig:RightHand");
            if (referenceHand && hand) {
              sourceSkeleton.returnToRest();
              sourceSkeleton.prepare(true);
              referenceHand.computeWorldMatrix(true);
              hand.computeWorldMatrix(true);
              // Include handedness reflections as well as export scale in the basis.
              const correction = referenceHand.getWorldMatrix().multiply(hand.getWorldMatrix().clone().invert());
              const rotation = new Quaternion();
              const scale = new Vector3();
              correction.decompose(scale, rotation);
              this.handBasis = { rotation, scale };
            }
          }
          if (animationPath !== modelPath) {
            // Finger and terminal toe tracks have no counterpart on the compact rig.
            for (const channel of source.targetedAnimations) {
              const name = (channel.target as TransformNode).name;
              if (
                !boneMap.has(name) &&
                !/^mixamorig:(Left|Right)(Hand(Thumb|Index|Middle|Ring|Pinky)[1-4]|Toe_End)$/.test(name)
              ) {
                throw new Error(`Unmapped source animation target: ${name}`);
              }
            }
            const retargeted = avatar.retargetAnimationGroup(source, { fixRootPosition: false });
            try {
              this.storeAnimation(container, retargeted, anim.name, boneMap);
            } finally {
              retargeted.dispose();
            }
          } else {
            this.storeAnimation(container, source, anim.name, boneMap);
          }
        } catch (error) {
          console.warn(`[PlayerModelManager] Failed to load ${anim.name}:`, error);
        } finally {
          clip?.dispose();
        }
      }
      // Only our template nodes are cleaned. Never stop/clear scene-wide animation.
      for (const node of [...container.meshes, ...container.transformNodes]) node.animations = [];
      if (animationPath !== modelPath) {
        // Slight visual oversize keeps animated silhouettes readable around the fixed player hull.
        this.modelFit = measurePlayerModelFit(container, (PLAYER_HEIGHT * 1.1) / 36);
        this.outlineSmoothing = new PlayerOutlineSmoothing(this.scene);
      }
      this.sourceContainer = container;
      this.loaded = true;
      devLog(`[PlayerModelManager] Ready: ${container.animationGroups.length} animations`);
      container = null; // Ownership transfers to this manager only after a complete load.
    } catch (error) {
      console.error("[PlayerModelManager] Load error:", error);
    } finally {
      container?.dispose();
    }
  }

  private storeAnimation(
    container: AssetContainer,
    source: AnimationGroup,
    name: string,
    boneMap: Map<string, TransformNode>,
  ): void {
    const channels = this.extractAnimChannels(source, boneMap);
    if (!channels.length) throw new Error(`Player animation "${name}" has no usable channels`);
    const group = new AnimationGroup(name, this.scene);
    this.scene.removeAnimationGroup(group);
    for (const channel of channels) group.addTargetedAnimation(channel.animation, channel.target);
    container.animationGroups.push(group);
  }

  /** Load a named body with its own containers and instance pool. */
  async loadVariant(key: string, root: string, file: string, animationRoot: string): Promise<void> {
    if (this.disposed) return;
    let manager = this.variants.get(key);
    if (!manager) {
      manager = new PlayerModelManager(this.scene);
      this.variants.set(key, manager);
    }
    await manager.loadModel(root, file, DEFAULT_ANIM_FILES, animationRoot);
    if (!manager.isLoaded && !this.disposed) throw new Error(`Player model variant failed: ${key}`);
  }

  /** Create an independent player; Babylon owns hierarchy, skeleton and clip retargeting. */
  createInstance(id: string, scale: number = 36, variant?: string): PlayerModelInstance | null {
    if (variant) {
      const model = this.variants.get(variant)?.createInstance(id, scale) ?? null;
      if (model) model.modelKey = variant;
      return model;
    }
    const container = this.sourceContainer;
    if (!container || this.disposed) return null;
    const parked = this.takeParked(id);
    if (parked) return parked;
    // One prefix per node, not an ancestor path containing RootNode on every joint.
    const entries = container.instantiateModelsToScene((name) => `${id}/${name}`, false, { doNotInstantiate: true });
    const mesh = entries.rootNodes[0];
    try {
      if (entries.rootNodes.length !== 1 || !(mesh instanceof Mesh) || !entries.skeletons.length) {
        throw new Error("Player model must instantiate one mesh root and at least one skeleton");
      }
      const owns = (node: TransformNode) => node === mesh || node.isDescendantOf(mesh);
      const [skeleton, ...redundant] = entries.skeletons;
      for (const bone of skeleton.bones) {
        const node = bone.getTransformNode();
        if (node && !owns(node)) throw new Error(`Player bone escaped its instance: ${bone.name}`);
      }
      // Duplicate skins only cost frames if they survive: every skeleton is
      // evaluated per frame, over the same bones. Collapsing needs them to be
      // driven by the same nodes, so prove that rather than assume it.
      for (const extra of redundant) {
        const matches =
          extra.bones.length === skeleton.bones.length &&
          extra.bones.every((bone, index) => bone.getTransformNode() === skeleton.bones[index].getTransformNode());
        if (!matches) throw new Error("Player model skins disagree on their rig");
      }
      for (const child of [mesh, ...mesh.getChildMeshes()]) {
        if (child.skeleton) child.skeleton = skeleton;
      }
      for (const extra of redundant) extra.dispose();
      if (entries.animationGroups.length !== container.animationGroups.length) {
        throw new Error("Player instance lost animation clips");
      }
      const anims: StoredAnim[] = entries.animationGroups.map((group, index) => {
        const source = container.animationGroups[index];
        if (!group.targetedAnimations.length || group.targetedAnimations.length !== source.targetedAnimations.length) {
          throw new Error(`Player instance lost channels for "${source.name}"`);
        }
        for (const channel of group.targetedAnimations) {
          if (!(channel.target instanceof TransformNode) || !owns(channel.target)) {
            throw new Error(`Unmapped player animation target in "${source.name}": ${channel.target?.name}`);
          }
        }
        return {
          name: source.name,
          animations: group.targetedAnimations.map(({ target, animation }) => ({ target, animation })),
        };
      });
      // The existing locomotion/one-shot controller owns playback groups. Retain
      // the already-retargeted channels, release these inactive template groups.
      for (const group of entries.animationGroups) group.dispose();
      const anchor = new TransformNode(`anchor_${id}`, this.scene);
      mesh.parent = anchor;
      const modelScaleFactor = this.modelFit?.scale ?? 1;
      const modelScale = scale * modelScaleFactor;
      const modelOffsetY = scale * (this.modelFit?.offsetY ?? 0);
      mesh.position.set(0, modelOffsetY, 0);
      mesh.scaling.setAll(modelScale);
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, 0);
      for (const child of [mesh, ...mesh.getChildMeshes()]) {
        child.setEnabled(true);
        child.isVisible = true;
        child.visibility = 1;
        child.alwaysSelectAsActiveMesh = true;
      }
      const hips = skeleton.bones.find((bone) => bone.name.toLowerCase().includes("hips"))?.getTransformNode();
      const boneNodes = skeleton.bones.map((bone) => bone.getTransformNode());
      let weaponHand: TransformNode | undefined;
      const handBone = skeleton.bones.find((bone) => bone.name === "mixamorig:RightHand");
      const rigMesh = mesh.getChildMeshes().find((part) => part.skeleton === skeleton) as Mesh | undefined;
      const hand = handBone?.getTransformNode();
      if (this.handBasis && hand) {
        weaponHand = new TransformNode(`${id}/weapon_hand`, this.scene);
        weaponHand.attachToBone(handBone!, rigMesh ?? mesh);
        weaponHand.rotationQuaternion = this.handBasis.rotation.clone();
        weaponHand.scaling.copyFrom(this.handBasis.scale);
      }
      const instance: PlayerModelInstance = {
        id,
        anchor,
        mesh,
        skeleton,
        anims,
        masterGroup: null,
        currentAnim: "",
        oneshotUntil: 0,
        hipsBind: hips ? { node: hips, x: hips.position.x, y: hips.position.y, z: hips.position.z } : null,
        boneNodes,
        weaponHand,
        rigMesh,
        modelScale,
        modelScaleFactor,
        modelOffsetY,
      };
      const parts = [mesh, ...mesh.getChildMeshes()];
      instance.restore = { anims, name: mesh.name, pickable: parts.map((part) => part.isPickable) };
      modelOwners.set(instance, this);
      this.instances.set(
        instance,
        mesh.onDisposeObservable.add(() => {
          this.outlineRuntime?.unregister(this, instance);
          this.aimPoses.delete(instance);
          this.instances.delete(instance);
        }),
      );
      this.outlineSmoothing?.attach(mesh, container);
      if (this.outlineProxyWanted) this.outlineRuntime?.register(this, instance);
      return instance;
    } catch (error) {
      entries.dispose();
      throw error;
    }
  }

  /**
   * Let cameras and render passes frustum-cull the body.
   *
   * Imported skinned bounds describe the bind pose, not the animated one, which
   * is why bodies are created always-selected. This replaces each part's local
   * bounds (and its submeshes') with the part-space box around
   * {@link PLAYER_POSE_BOUNDS}, then lets Babylon cull per camera: the main
   * view, a water mirror and any other pass each test their own frustum, and
   * the body stays enabled for all of them.
   *
   * The parts hang rigidly off the anchor (root motion is cancelled every
   * frame), so a box computed once holds wherever the anchor moves or turns.
   * Only for bodies standing on their anchor: a ragdoll moves the bones away
   * from it and must go back to {@link selectAlways}.
   */
  useConservativeBounds(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.useConservativeBounds(instance);
      return;
    }
    const { radius, minY, maxY } = PLAYER_POSE_BOUNDS;
    const anchorToPart = new Matrix();
    const corner = new Vector3();
    const min = new Vector3();
    const max = new Vector3();
    const anchorWorld = instance.anchor.computeWorldMatrix(true);
    for (const part of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
      if (!part.getTotalVertices()) continue;
      part.computeWorldMatrix(true).invertToRef(anchorToPart);
      anchorWorld.multiplyToRef(anchorToPart, anchorToPart);
      min.setAll(Number.POSITIVE_INFINITY);
      max.setAll(Number.NEGATIVE_INFINITY);
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? radius : -radius, i & 2 ? maxY : minY, i & 4 ? radius : -radius);
        Vector3.TransformCoordinatesToRef(corner, anchorToPart, corner);
        min.minimizeInPlace(corner);
        max.maximizeInPlace(corner);
      }
      part.setBoundingInfo(new BoundingInfo(min, max, part.getWorldMatrix()));
      for (const subMesh of part.subMeshes ?? [])
        subMesh.setBoundingInfo(new BoundingInfo(min, max, part.getWorldMatrix()));
      part.alwaysSelectAsActiveMesh = false;
    }
  }

  /** Draw the body regardless of bounds, as created: for poses that leave the anchor. */
  selectAlways(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.selectAlways(instance);
      return;
    }
    for (const part of [instance.mesh, ...instance.mesh.getChildMeshes()]) part.alwaysSelectAsActiveMesh = true;
  }

  /**
   * Switch an instance to a named animation. Skips if already playing.
   * @returns true if animation was changed
   */
  /**
   * Pause or resume an instance's skeleton work.
   *
   * AnimationGroups run at the scene level, so a hidden mesh keeps evaluating
   * its bones every frame — disabling the mesh saves the draw call and nothing
   * else. For a map full of bots that animation cost is the larger half, and
   * it is spent entirely on players nobody can see.
   *
   * Paused instances keep their pose, so a player who walks back into view
   * resumes mid-stride rather than snapping to a bind pose.
   */
  setAnimationActive(instance: PlayerModelInstance, active: boolean): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.setAnimationActive(instance, active);
      return;
    }
    const group = instance.masterGroup;
    if (!group || this.isFullBodyOneShotPlaying(instance)) return;
    this.leaveStepped(instance, group);

    if (active) {
      if (!group.isPlaying) group.play(true);
      return;
    }
    if (group.isPlaying) group.pause();
  }

  /**
   * Run the locomotion clip at full speed but pose the skeleton only every
   * `stepSeconds`.
   *
   * Babylon has no per-group update rate: a playing group is evaluated every
   * rendered frame. So the group is paused and its phase kept here, advanced
   * by the same clock Babylon uses (`dtSeconds` already includes the scene's
   * time scale) times the group's speed ratio, which carries walking backwards,
   * crouch-idle freezes and demo playback speed. The pose is written with
   * `goToFrame` only when a step is due, which is also when the skeleton is
   * re-prepared. Movement is untouched: the anchor still moves every frame.
   *
   * A full-body one-shot suspends this clip; an upper-body overlay masks only its joints.
   * Returning to {@link setAnimationActive} resumes from the stepped phase.
   */
  stepAnimation(instance: PlayerModelInstance, dtSeconds: number, stepSeconds: number): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.stepAnimation(instance, dtSeconds, stepSeconds);
      return;
    }
    const group = instance.masterGroup;
    if (!group || this.isFullBodyOneShotPlaying(instance)) return;
    let state = this.stepped.get(instance);
    if (!state || state.group !== group) {
      const frame = group.isPlaying ? locomotionFrame(group) : group.from;
      const upperFrame = group.isPlaying ? (this.upperBodyFrame(instance, group) ?? frame) : frame;
      state = { group, frame, upperFrame, since: Number.POSITIVE_INFINITY };
      this.stepped.set(instance, state);
    }
    if (group.isPlaying) group.pause();
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    const advance = dtSeconds * fps * group.speedRatio;
    state.frame = wrapFrame(state.frame + advance, group.from, group.to);
    // While an overlay owns the upper body it rejoins the legs' phase, as a played clip does
    const share = this.upperBodyShares.get(instance) ?? 1;
    state.upperFrame = group.mask ? state.frame : wrapFrame(state.upperFrame + advance * share, group.from, group.to);
    state.since += dtSeconds;
    if (state.since >= stepSeconds) {
      // Carry the remainder so the rate holds on any frame clock, but never
      // bank more than one step: a long hitch is followed by one pose, not a burst.
      state.since = Number.isFinite(state.since) ? Math.min(state.since - stepSeconds, stepSeconds) : 0;
      poseLocomotionFrame(group, state.frame);
      if (state.upperFrame !== state.frame) this.poseUpperBody(instance, group, state.upperFrame);
      // Written after this frame's reset, so cancel root motion again.
      this.resetRootMotion(instance);
      forgetPendingJump(group);
    }
  }

  /** Hand a stepped clip back to Babylon at the phase it reached. */
  private leaveStepped(instance: PlayerModelInstance, group: AnimationGroup): void {
    const state = this.stepped.get(instance);
    if (!state) return;
    this.stepped.delete(instance);
    if (state.group === group) {
      poseLocomotionFrame(group, state.frame);
      if (state.upperFrame !== state.frame) this.poseUpperBody(instance, group, state.upperFrame);
      this.resetRootMotion(instance);
    }
  }

  /**
   * Play the locomotion clip's spine, arms and head at `share` of the clip's
   * speed, and its hips and legs at the clip's speed; 1 plays the body as one.
   * Call after every change of the clip's speed ratio, which puts every joint
   * back on the clip's speed. The halves drift apart in phase; when an
   * upper-body overlay ends, the upper body rejoins the legs' phase.
   */
  setUpperBodyShare(instance: PlayerModelInstance, share: number): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.setUpperBodyShare(instance, share);
      return;
    }
    this.upperBodyShares.set(instance, share);
    const group = instance.masterGroup;
    const upper = group && this.getUpperBodyTargets(instance);
    if (!group || !upper) return;
    for (const animatable of group.animatables) {
      const speed = upper.has(animatable.target) ? group.speedRatio * share : group.speedRatio;
      if (animatable.speedRatio !== speed) animatable.speedRatio = speed;
    }
  }

  /** The upper body's frame in a playing clip, when the clip owns an upper-body joint. */
  private upperBodyFrame(instance: PlayerModelInstance, group: AnimationGroup): number | undefined {
    const upper = this.getUpperBodyTargets(instance);
    return group.animatables.find(
      (animatable) =>
        upper?.has(animatable.target) && (!group.mask || group.mask.retainsTarget(animatable.target.name)),
    )?.masterFrame;
  }

  /** Pose the upper-body joints the clip owns at their own phase. */
  private poseUpperBody(instance: PlayerModelInstance, group: AnimationGroup, frame: number): void {
    const upper = this.getUpperBodyTargets(instance);
    if (!upper) return;
    for (const animatable of group.animatables) {
      if (upper.has(animatable.target) && (!group.mask || group.mask.retainsTarget(animatable.target.name))) {
        animatable.goToFrame(frame);
      }
    }
  }

  playAnimation(instance: PlayerModelInstance, name: string): boolean {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) return owner.playAnimation(instance, name);
    const changed = PlayerModelManager.playAnimationOn(instance, name);
    // Full-body one-shots own every joint; upper-body swings leave the legs running.
    if (this.isFullBodyOneShotPlaying(instance)) instance.masterGroup?.stop();
    return changed;
  }

  /**
   * Evaluate the current clip now instead of waiting for the next render.
   *
   * `play()` only schedules an animatable, so a body created this tick still
   * holds the bind pose — a T-pose — until a frame is drawn. Anything that
   * reads the pose in the same tick it built the model needs this first. The
   * corpse handed to the ragdoll is the case that matters: physics lays its
   * bone bodies out from whatever pose it finds, so a T-pose there is frozen
   * in permanently.
   *
   * The source model used to be posed by accident — it was loaded into the
   * live scene with the glTF plugin's default start mode, so frames elapsed
   * with its embedded clip running and every clone inherited the result. It
   * now loads into an out-of-scene container with animations explicitly off,
   * which is correct, and makes this evaluation the caller's job.
   */
  settlePose(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.settlePose(instance);
      return;
    }
    const group = instance.masterGroup;
    if (!group) return;
    poseLocomotionFrame(group, group.from);
  }

  /**
   * Static variant of playAnimation — plays a looping animation on any
   * PlayerModelInstance without needing the owning manager (the post-game
   * winner showcase holds only the instance). Scene comes from the instance.
   */
  /** Clips already reported missing, so the warning is one line, not one per frame. */
  private static readonly warnedMissingAnims = new Set<string>();

  static playAnimationOn(instance: PlayerModelInstance, name: string): boolean {
    if (instance.currentAnim === name) return false;
    const animData = instance.anims.find((a) => a.name === name);
    if (!animData) {
      if (!PlayerModelManager.warnedMissingAnims.has(name)) {
        PlayerModelManager.warnedMissingAnims.add(name);
        console.warn(
          `[PlayerModelManager] animation "${name}" is not loaded; players needing it keep their previous pose`,
        );
      }
      return false;
    }
    instance.masterGroup?.stop();
    instance.clipGroups ??= new Map();
    let group = instance.clipGroups.get(name);
    if (!group) {
      group = new AnimationGroup(`anim_${instance.id}_${name}`, instance.mesh.getScene());
      for (const item of animData.animations) {
        if (item.target) group.addTargetedAnimation(item.animation, item.target);
      }
      instance.clipGroups.set(name, group);
    }
    group.mask = instance.upperBodyMask ?? null;
    group.speedRatio = 1;
    instance.masterGroup = group;
    group.play(true);
    instance.currentAnim = name;
    return true;
  }

  /** Play an exclusive one-shot, or a spine-and-arms overlay for the blade swing. */
  playOnce(instance: PlayerModelInstance, name: string, speedRatio: number = 1.0): boolean {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) return owner.playOnce(instance, name, speedRatio);
    const animData = instance.anims.find((a) => a.name === name);
    if (!animData || animData.animations.length === 0) return false;
    this.stopOneShot(instance, false);
    const upperTargets = name === "blade_slash" ? this.getUpperBodyTargets(instance) : undefined;
    const upperBodyOnly = !!upperTargets?.size;
    const group = new AnimationGroup(`anim_${instance.id}_${name}_overlay`, this.scene);
    for (const item of animData.animations) {
      if (item.target && (!upperBodyOnly || upperTargets?.has(item.target))) {
        group.addTargetedAnimation(item.animation, item.target);
      }
    }
    if (!group.targetedAnimations.length) {
      group.dispose();
      return false;
    }
    group.speedRatio = speedRatio;
    this.activeOneShots.set(instance, { group, baseSpeedRatio: speedRatio, upperBodyOnly });
    if (upperBodyOnly && upperTargets) {
      let mask = this.lowerBodyMasks.get(instance);
      if (!mask) {
        mask = new AnimationGroupMask(
          [...upperTargets].map((target) => target.name),
          AnimationGroupMaskMode.Exclude,
        );
        this.lowerBodyMasks.set(instance, mask);
      }
      this.setUpperBodyMask(instance, mask);
    } else {
      instance.masterGroup?.stop();
    }
    instance.oneshotUntil = performance.now() + this.getOneShotDurationMs(instance, name, speedRatio);
    group.play(false);
    group.onAnimationEndObservable.addOnce(() => {
      if (this.activeOneShots.get(instance)?.group === group) this.stopOneShot(instance);
    });
    return true;
  }

  private getUpperBodyTargets(instance: PlayerModelInstance): ReadonlySet<TransformNode> | undefined {
    let targets = this.upperBodyTargets.get(instance);
    if (targets) return targets;
    const spine = instance.skeleton?.bones.find((bone) => bone.name === "mixamorig:Spine")?.getTransformNode();
    if (!spine) return;
    targets = new Set([
      spine,
      ...spine.getDescendants(false).filter((node): node is TransformNode => node instanceof TransformNode),
    ]);
    this.upperBodyTargets.set(instance, targets);
    return targets;
  }

  private setUpperBodyMask(instance: PlayerModelInstance, mask: AnimationGroupMask | undefined): void {
    instance.upperBodyMask = mask;
    const group = instance.masterGroup;
    if (!group || group.mask === (mask ?? null)) return;
    const previous = group.mask;
    const frame = locomotionFrame(group);
    const playing = group.isPlaying;
    group.mask = mask ?? null;
    if (!mask && previous) {
      // Resume upper joints at the legs' current phase, without restarting the stride.
      for (const animatable of group.animatables) {
        if (!previous.retainsTarget(animatable.target.name)) animatable.goToFrame(frame);
      }
    }
    if (!playing) group.pause();
    forgetPendingJump(group);
  }

  /** Full-body clips suspend locomotion; upper-body overlays do not. */
  isFullBodyOneShotPlaying(instance: PlayerModelInstance): boolean {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) return owner.isFullBodyOneShotPlaying(instance);
    const active = this.activeOneShots.get(instance);
    return !!active && !active.upperBodyOnly;
  }

  /** Duration of a named one-shot at its authored 30fps and base speed. */
  getOneShotDurationMs(instance: PlayerModelInstance, name: string, speedRatio: number = 1.0): number {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) return owner.getOneShotDurationMs(instance, name, speedRatio);
    const animData = instance.anims.find((a) => a.name === name);
    if (!animData || speedRatio <= 0) return 0;
    let maxFrames = 0;
    for (const item of animData.animations) {
      const keys = item.animation.getKeys();
      if (keys.length > 0) {
        maxFrames = Math.max(maxFrames, keys[keys.length - 1].frame);
      }
    }
    return ((maxFrames / 30) * 1000) / speedRatio;
  }

  /** Multiply an active one-shot's authored speed by an external clock scale. */
  setOneShotTimeScale(instance: PlayerModelInstance, timeScale: number): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.setOneShotTimeScale(instance, timeScale);
      return;
    }
    const active = this.activeOneShots.get(instance);
    if (active) active.group.speedRatio = active.baseSpeedRatio * timeScale;
  }

  isOneShotPlaying(instance: PlayerModelInstance): boolean {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) return owner.isOneShotPlaying(instance);
    return this.activeOneShots.has(instance);
  }

  /** Stop and dispose an active overlay, optionally resuming locomotion. */
  stopOneShot(instance: PlayerModelInstance, resumeLocomotion: boolean = true): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.stopOneShot(instance, resumeLocomotion);
      return;
    }
    const active = this.activeOneShots.get(instance);
    if (active) {
      this.activeOneShots.delete(instance);
      active.group.stop();
      active.group.dispose();
    }
    instance.oneshotUntil = 0;
    this.setUpperBodyMask(instance, undefined);
    if (resumeLocomotion && instance.masterGroup && !active?.upperBodyOnly) instance.masterGroup.play(true);
  }

  // --- Player Visibility Styling ------------------------------------------

  /** Predefined team colors (match UI palette). Values may exceed 1 for HDR tint pop. */
  static readonly TEAM_COLORS: Record<PlayerModelTeamColor, { r: number; g: number; b: number }> = {
    alpha: { r: 0.1, g: 1.15, b: 1.85 },
    beta: { r: 1.55, g: 0.2, b: 1.35 },
    bravo: { r: 1.55, g: 0.2, b: 1.35 },
    ffa: { r: 0.1, g: 1.15, b: 1.85 },
  };

  private ensureInstanceMaterial(instance: PlayerModelInstance, mesh: AbstractMesh): Material | null {
    if (!mesh.material) return null;

    const material = mesh.material;
    const visibilityCloneName = `playerMat_${instance.id}_${mesh.name}`;
    const legacyCloneName = `teamMat_${instance.id}_${mesh.name}`;

    if (material.name === visibilityCloneName || material.name === legacyCloneName) {
      return material;
    }

    const cloned = cloneModelMaterial(material, visibilityCloneName);
    if (!cloned) return null;
    markSnapshotMaterialDynamic(cloned);
    // Babylon clones texture wrappers along with a material. They share GPU
    // storage with the source but hold their own references to it. Release
    // only those wrappers when this player's style material goes away.
    const sourceTextures = new Set(material.getActiveTextures());
    const ownedTextures = new Set(cloned.getActiveTextures().filter((texture) => !sourceTextures.has(texture)));
    cloned.onDisposeObservable.addOnce(() => {
      for (const texture of ownedTextures) texture.dispose();
    });
    mesh.material = cloned;
    return cloned;
  }

  /**
   * Apply third-person player visibility styling to a model instance.
   * The tint still multiplies the model texture, while fullbright adds only a
   * small emissive lift so armor and fabric detail remain visible.
   */
  applyVisualStyle(instance: PlayerModelInstance, style: PlayerModelVisualStyle): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.applyVisualStyle(instance, style);
      return;
    }
    const allMeshes: AbstractMesh[] = [instance.mesh, ...instance.mesh.getChildMeshes()];
    const tint = style.tintColor ?? Color3.White();
    const outlineWidth = Math.max(0, style.outlineWidth);

    for (const mesh of allMeshes) {
      const material = this.ensureInstanceMaterial(instance, mesh);
      const pbrMat = material as unknown as TintableMaterial | null;

      if (pbrMat?.albedoColor) {
        pbrMat.__playerModelBaseAlbedoColor ??= pbrMat.albedoColor.clone();
        pbrMat.albedoColor.copyFrom(style.tintColor ?? pbrMat.__playerModelBaseAlbedoColor);
      }

      if (pbrMat?.emissiveColor) {
        if (!pbrMat.__playerModelBaseEmissiveColor) {
          pbrMat.__playerModelBaseEmissiveColor = pbrMat.emissiveColor.clone
            ? pbrMat.emissiveColor.clone()
            : new Color3(0, 0, 0);
        }
        const base = pbrMat.__playerModelBaseEmissiveColor as Color3;
        if (style.fullbrightEnabled && style.fullbrightIntensity > 0) {
          pbrMat.emissiveColor.r = base.r + tint.r * style.fullbrightIntensity;
          pbrMat.emissiveColor.g = base.g + tint.g * style.fullbrightIntensity;
          pbrMat.emissiveColor.b = base.b + tint.b * style.fullbrightIntensity;
        } else {
          pbrMat.emissiveColor.r = base.r;
          pbrMat.emissiveColor.g = base.g;
          pbrMat.emissiveColor.b = base.b;
        }
      }

      mesh.renderOutline = style.outlineEnabled && outlineWidth > 0;
      mesh.outlineColor = style.outlineColor;
      mesh.outlineWidth = outlineWidth / (instance.modelScaleFactor ?? 1);
    }
  }

  /**
   * Overlay a powerup glow on top of whatever visual style is already applied.
   *
   * Separate from `applyVisualStyle` because this runs EVERY FRAME while a
   * powerup is held (the pulse is time-driven), so it deliberately does the
   * minimum: no material cloning, no albedo writes, just emissive and the
   * outline. `applyVisualStyle` remains the thing that establishes the base
   * look, and clearing the glow is done by re-applying that base.
   *
   * Assumes `applyVisualStyle` already ran for this instance, so the per-mesh
   * material clone and `__playerModelBaseEmissiveColor` both exist.
   */
  applyPowerupGlow(instance: PlayerModelInstance, color: Color3, intensity: number, outlineWidth: number): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.applyPowerupGlow(instance, color, intensity, outlineWidth);
      return;
    }
    // Listed once per model: this runs every frame for every quad carrier, and
    // walking the rig (every bone node) built two arrays each time. The rig is
    // cloned once and never gains or loses a mesh.
    let allMeshes = this.glowMeshes.get(instance);
    if (!allMeshes) {
      allMeshes = [instance.mesh, ...instance.mesh.getChildMeshes()];
      this.glowMeshes.set(instance, allMeshes);
    }

    for (const mesh of allMeshes) {
      const pbrMat = mesh.material as unknown as GlowableMaterial | null;
      if (!pbrMat) continue;

      if (pbrMat.emissiveColor) {
        // Lift from the material's OWN base emissive, not from its current
        // value — accumulating onto the current value would ramp to white
        // within a second at 60fps.
        const base = pbrMat.__playerModelBaseEmissiveColor ?? NO_EMISSIVE;
        pbrMat.emissiveColor.r = base.r + color.r * intensity;
        pbrMat.emissiveColor.g = base.g + color.g * intensity;
        pbrMat.emissiveColor.b = base.b + color.b * intensity;
      }

      mesh.renderOutline = outlineWidth > 0;
      mesh.outlineColor = color;
      mesh.outlineWidth = outlineWidth / (instance.modelScaleFactor ?? 1);
    }
  }

  /** Back-compat wrapper for older callers that only know about team colors. */
  applyTeamColor(instance: PlayerModelInstance, team: PlayerModelTeamColor | null): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.applyTeamColor(instance, team);
      return;
    }
    const color = team ? PlayerModelManager.TEAM_COLORS[team] : null;
    this.applyVisualStyle(instance, {
      tintColor: color ? new Color3(color.r, color.g, color.b) : null,
      fullbrightEnabled: false,
      fullbrightIntensity: 0,
      outlineEnabled: false,
      outlineColor: Color3.Black(),
      outlineWidth: 0,
    });

    devLog(`[PlayerModelManager] Applied team color: ${team ?? "none"} to ${instance.id}`);
  }

  // ── Per-Frame Utilities ──────────────────────────────────────

  /**
   * Cancel root motion each frame so the body always renders on its anchor.
   *
   * The Mixamo clips carry large root motion on `mixamorig:Hips` — measured
   * against MODEL_SCALE 36: run travels 82u forward, strafes 39–51u sideways,
   * slide 246u. That displacement lives in the anchor's LOCAL space, so the
   * anchor's yaw rotates it: a turning player's body swings around its true
   * position instead of standing on it.
   *
   * MUST traverse the full subtree. In vanguard.glb the hierarchy is
   * `__root__ > RootNode > mixamorig:Hips`, so `getChildTransformNodes(true)`
   * (direct descendants) sees only `RootNode` and the Hips branch below never
   * ran. Identify roots from SOURCE names: Babylon prefixes clone names with
   * ancestor paths, so every cloned joint below RootNode contains "root".
   *
   * Hips Y is restored to its BIND value, not zeroed: it is the skeleton's
   * natural hip height above the feet, and zeroing it collapses the skeleton to
   * mesh origin, dropping the legs ~35 units through the floor.
   */
  resetRootMotion(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.resetRootMotion(instance);
      return;
    }
    cancelRootMotion(instance);
  }

  // ── Cleanup ──────────────────────────────────────────────────

  /** Dispose a single instance, including a one-shot animation it is playing. */
  setOutlineProxyEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve();
    PlayerOutlineProxyRuntime.existing(this.scene)?.setEnabled(enabled);
    if (!enabled) {
      this.outlineProxyWanted = false;
      return Promise.resolve();
    }
    const runtime = PlayerOutlineProxyRuntime.acquire(this.scene);
    runtime.setEnabled(true);
    if (!this.outlineProxyWanted || this.outlineRuntime !== runtime) {
      this.outlineProxyWanted = true;
      this.outlineRuntime = runtime;
      const ready = runtime.prepare(this, this.modelUrl);
      for (const instance of this.instances.keys()) runtime.register(this, instance);
      return ready;
    }
    return runtime.prepare(this, this.modelUrl);
  }

  disposeInstance(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.disposeInstance(instance);
      return;
    }
    this.setAimPitch(instance, 0);
    this.stopOneShot(instance, false);
    disposePlayerModel(instance);
    devLog(`[PlayerModelManager] Disposed instance: ${instance.id}`);
  }

  /**
   * Put a finished body away for its player's next one, or dispose it when
   * enough are kept. Its hand weapon goes back to its own pool, a ragdoll's
   * unlinked bones are linked again, and each part is hidden itself (a WebGPU
   * snapshot recording draws a part hidden that way, not one hidden by a
   * disabled ancestor).
   */
  releaseInstance(instance: PlayerModelInstance): void {
    const owner = modelOwners.get(instance);
    if (owner && owner !== this) {
      owner.releaseInstance(instance);
      return;
    }
    this.setAimPitch(instance, 0);
    const kept = this.parked.get(instance.id) ?? [];
    if (
      this.disposed ||
      kept.length >= MAX_PARKED_PER_PLAYER ||
      !instance.boneNodes ||
      instance.mesh.isDisposed() ||
      instance.anchor.isDisposed()
    ) {
      this.disposeInstance(instance);
      return;
    }
    this.stopOneShot(instance, false);
    if (instance.attachedWeapon) {
      disposeModelResources([instance.attachedWeapon]);
      instance.attachedWeapon = null;
    }
    instance.masterGroup?.stop();
    instance.currentAnim = "";
    instance.oneshotUntil = 0;
    const restore = instance.restore;
    if (restore) {
      instance.anims = restore.anims;
      instance.mesh.name = restore.name;
      const parts = [instance.mesh, ...instance.mesh.getChildMeshes()];
      for (let i = 0; i < parts.length; i++) parts[i].isPickable = restore.pickable[i] ?? parts[i].isPickable;
    }
    const bones = instance.skeleton?.bones ?? [];
    for (let i = 0; i < bones.length; i++) {
      const node = instance.boneNodes[i];
      if (node && !node.isDisposed() && bones[i].getTransformNode() !== node) bones[i].linkTransformNode(node);
    }
    instance.anchor.parent = null;
    instance.anchor.setEnabled(true);
    for (const part of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
      part.visibility = 1;
      part.setEnabled(false);
    }
    kept.push(instance);
    this.parked.set(instance.id, kept);
    devLog(`[PlayerModelManager] Parked instance: ${instance.id}`);
  }

  /** A kept body of this player, shown again as `createInstance` makes one; null when there is none. */
  private takeParked(id: string): PlayerModelInstance | null {
    const kept = this.parked.get(id);
    for (let instance = kept?.pop(); instance; instance = kept?.pop()) {
      if (instance.mesh.isDisposed() || instance.anchor.isDisposed()) {
        disposePlayerModel(instance);
        continue;
      }
      instance.anchor.position.setAll(0);
      instance.anchor.rotation.setAll(0);
      for (const part of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
        part.setEnabled(true);
        part.isVisible = true;
        part.visibility = 1;
        part.alwaysSelectAsActiveMesh = true;
      }
      return instance;
    }
    return null;
  }

  /** Dispose the bodies kept for a player who has gone. */
  disposeParked(id: string): void {
    for (const manager of this.variants.values()) manager.disposeParked(id);
    for (const instance of this.parked.get(id) ?? []) disposePlayerModel(instance);
    this.parked.delete(id);
  }

  /** Dispose the manager and source model */
  dispose(): void {
    this.disposed = true;
    if (this.aimBefore) this.scene.onBeforeAnimationsObservable.remove(this.aimBefore);
    if (this.aimAfter) this.scene.onAfterAnimationsObservable.remove(this.aimAfter);
    for (const pose of this.aimPoses.values()) pose.restore();
    this.aimPoses.clear();
    for (const manager of this.variants.values()) manager.dispose();
    this.variants.clear();
    for (const id of [...this.parked.keys()]) this.disposeParked(id);
    this.outlineRuntime?.release(this);
    this.outlineRuntime = undefined;
    for (const [instance, observer] of this.instances) instance.mesh.onDisposeObservable.remove(observer);
    this.instances.clear();
    this.outlineSmoothing?.dispose();
    this.outlineSmoothing = undefined;
    this.sourceContainer?.dispose();
    this.sourceContainer = null;
    this.loaded = false;
  }

  // ── Internal ─────────────────────────────────────────────────

  /**
   * Extract animation channels from an AnimationGroup, filtering out
   * root-motion (Hips position track).
   */
  private extractAnimChannels(
    group: AnimationGroup,
    boneMap: Map<string, TransformNode>,
  ): { target: TransformNode; animation: Animation }[] {
    const channels: { target: TransformNode; animation: Animation }[] = [];

    for (const ta of group.targetedAnimations) {
      const targetName = (ta.target as TransformNode).name;
      const prop = ta.animation.targetProperty;

      // Strip ALL position tracks — every Mixamo animation has exactly one
      // position track (mixamorig:Hips) which is always root-motion data.
      // Headless inspection confirmed: no animation has useful position data.
      if (prop === "position") {
        continue;
      }

      const ourBone = boneMap.get(targetName);
      if (!ourBone) throw new Error(`Unmapped source animation target: ${targetName} (${prop})`);
      channels.push({ target: ourBone, animation: ta.animation.clone() });
    }

    return channels;
  }
}

/**
 * Put the body back on its anchor after a clip has posed it: the mesh at its
 * offset, root nodes at the origin and the hips at their bind position (see
 * `PlayerModelManager.resetRootMotion`). Needs no manager, so a detached
 * corpse can use it.
 */
export function cancelRootMotion(instance: PlayerModelInstance): void {
  instance.mesh.position.set(0, instance.modelOffsetY ?? 0, 0);

  instance.rootMotionNodes ??= findRootMotionNodes(instance.mesh);
  for (const node of instance.rootMotionNodes) node.position.set(0, 0, 0);

  // Hips: restore the bind pose, killing both horizontal drift and the
  // vertical bob that would otherwise float the body off the ground.
  const bind = instance.hipsBind;
  if (bind) {
    bind.node.position.set(bind.x, bind.y, bind.z);
  }
}

/** The nodes under a player mesh that carry root motion, by source name. */
function findRootMotionNodes(mesh: Mesh): TransformNode[] {
  return mesh.getChildTransformNodes(false).filter((node) => {
    // instantiateModelsToScene uses only id/sourceName, so ancestor names
    // cannot accidentally classify ordinary joints as root-motion nodes.
    const name = node.name.split("/").pop()!.toLowerCase();
    return name === "rootnode" || name === "armature" || name === "__root__";
  });
}

/** Stop and dispose every locomotion group an instance has built. */
export function releaseLocomotionGroups(instance: PlayerModelInstance): void {
  instance.masterGroup?.stop();
  instance.masterGroup?.dispose();
  for (const group of instance.clipGroups?.values() ?? []) {
    if (group === instance.masterGroup) continue;
    group.stop();
    group.dispose();
  }
  instance.clipGroups?.clear();
  instance.masterGroup = null;
}

/**
 * Dispose a player model and everything it owns, on every path that removes one
 * (death, leaving, ragdoll expiry, shutdown): its hand weapon with whatever only
 * that used, its locomotion groups, its nodes and skeleton, and the materials
 * cloned for it by the visibility style. The model's source materials and
 * textures are shared with every other instance and stay.
 *
 * A one-shot animation lives in the manager; `disposeInstance` stops it first.
 */
/**
 * The end of a body that may live again: its manager keeps it for the player's
 * next body (`releaseInstance`), and one without a manager is disposed.
 */
export function releasePlayerModel(instance: PlayerModelInstance): void {
  const owner = modelOwners.get(instance);
  if (owner) owner.releaseInstance(instance);
  else disposePlayerModel(instance);
}

export function disposePlayerModel(instance: PlayerModelInstance): void {
  if (instance.attachedWeapon) {
    disposeModelResources([instance.attachedWeapon]);
    instance.attachedWeapon = null;
  }
  instance.weaponHand?.dispose();
  releaseLocomotionGroups(instance);
  const cloned = clonedMaterialsOf(instance);
  if (instance.mesh && !instance.mesh.isDisposed()) instance.mesh.dispose();
  instance.skeleton?.dispose();
  if (instance.anchor && !instance.anchor.isDisposed()) instance.anchor.dispose();
  for (const material of cloned) material.dispose(false, false);
}

/** The materials `applyVisualStyle` cloned for this instance alone (see ensureInstanceMaterial). */
function clonedMaterialsOf(instance: PlayerModelInstance): Material[] {
  if (!instance.mesh || instance.mesh.isDisposed()) return [];
  const prefixes = [`playerMat_${instance.id}_`, `teamMat_${instance.id}_`];
  const owned = new Set<Material>();
  for (const mesh of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
    const material = mesh.material;
    if (material && prefixes.some((prefix) => material.name.startsWith(prefix))) owned.add(material);
  }
  return [...owned];
}
