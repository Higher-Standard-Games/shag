/**
 * PlayerModelManager — Shared player model loading, animation, and instancing
 *
 * Loads vanguard.glb once, filters root-motion from animations, and creates
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
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
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
import { resolvePlayerModelAsset, VANGUARD_ANIMATIONS, VANGUARD_MODEL, VANGUARD_ROOT } from "./PlayerModelAssets";

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
  currentAnim: string;
  /** Timestamp (performance.now) until which a one-shot anim has priority over locomotion */
  oneshotUntil: number;
  /**
   * Weapon mesh bone-attached to this model's hand (3rd-person view weapon).
   * Bone attachment means it is NOT a scene-graph child, so it must be disposed
   * explicitly with the model — otherwise it leaks (e.g. a dropped blade left
   * floating after death/ragdoll cleanup).
   */
  attachedWeapon?: TransformNode | null;
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
export const DEFAULT_ANIM_FILES: AnimFileConfig[] = VANGUARD_ANIMATIONS;

/** Victory-dance pool for the post-game winner showcase (random pick). */
export const DANCE_ANIMS = ["dance_1", "dance_2", "dance_3"];

// ─── Manager ─────────────────────────────────────────────────────

export class PlayerModelManager {
  private scene: Scene;
  private readonly activeOneShots = new Map<PlayerModelInstance, { group: AnimationGroup; baseSpeedRatio: number }>();
  /** Clip phase kept by hand for instances whose pose is sampled at a reduced rate; see stepAnimation. */
  private readonly stepped = new WeakMap<
    PlayerModelInstance,
    { group: AnimationGroup; frame: number; since: number }
  >();

  private loaded = false;
  private disposed = false;
  private loadPromise: Promise<void> | null = null;
  private sourceContainer: AssetContainer | null = null;
  private modelUrl = VANGUARD_ROOT + VANGUARD_MODEL;
  private outlineProxyWanted = false;
  private outlineRuntime?: PlayerOutlineProxyRuntime;
  private readonly instances = new Map<PlayerModelInstance, ReturnType<Mesh["onDisposeObservable"]["add"]>>();

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
    modelPath: string = VANGUARD_ROOT,
    modelFile: string = VANGUARD_MODEL,
    animFiles: AnimFileConfig[] = DEFAULT_ANIM_FILES,
  ): Promise<void> {
    if (this.disposed || this.loaded) return Promise.resolve();
    this.modelUrl = modelPath + modelFile;
    this.loadPromise ??= this.loadAssets(modelPath, modelFile, animFiles).finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async loadAssets(modelPath: string, modelFile: string, animFiles: AnimFileConfig[]): Promise<void> {
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
      // One skeleton per SKIN, and an exporter emits a skin per skinned submesh:
      // vanguard.glb ships three over one 65-joint rig. They share the joint
      // nodes, so the first skeleton's nodes drive every mesh and the rest are
      // redundant — createInstance collapses them once it can prove they match.
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
      } finally {
        for (const group of embedded) group.dispose();
      }
      for (const anim of animFiles) {
        let clip: AssetContainer | null = null;
        try {
          const asset = await resolvePlayerModelAsset(modelPath, anim.file, anim.optional);
          if (!asset || this.disposed) continue;
          clip = await LoadAssetContainerAsync(asset.source, this.scene, { ...asset.options, pluginOptions });
          if (this.disposed) return;
          if (!clip.animationGroups[0]) throw new Error(`No animation group in ${anim.file}`);
          this.storeAnimation(container, clip.animationGroups[0], anim.name, boneMap);
        } catch (error) {
          console.warn(`[PlayerModelManager] Failed to load ${anim.name}:`, error);
        } finally {
          clip?.dispose();
        }
      }
      // Only our template nodes are cleaned. Never stop/clear scene-wide animation.
      for (const node of [...container.meshes, ...container.transformNodes]) node.animations = [];
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

  /** Create an independent player; Babylon owns hierarchy, skeleton and clip retargeting. */
  createInstance(id: string, scale: number = 36): PlayerModelInstance | null {
    const container = this.sourceContainer;
    if (!container || this.disposed) return null;
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
      mesh.position.set(0, 0, 0);
      mesh.scaling.set(scale, scale, scale);
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, 0);
      for (const child of [mesh, ...mesh.getChildMeshes()]) {
        child.setEnabled(true);
        child.isVisible = true;
        child.visibility = 1;
        child.alwaysSelectAsActiveMesh = true;
      }
      const hips = skeleton.bones.find((bone) => bone.name.toLowerCase().includes("hips"))?.getTransformNode();
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
      };
      this.instances.set(
        instance,
        mesh.onDisposeObservable.add(() => {
          this.outlineRuntime?.unregister(this, instance);
          this.instances.delete(instance);
        }),
      );
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
    const group = instance.masterGroup;
    if (!group) return;
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
   * A one-shot owns the bones while it plays; the clip waits until it ends.
   * Returning to {@link setAnimationActive} resumes from the stepped phase.
   */
  stepAnimation(instance: PlayerModelInstance, dtSeconds: number, stepSeconds: number): void {
    const group = instance.masterGroup;
    if (!group || this.activeOneShots.has(instance)) return;
    let state = this.stepped.get(instance);
    if (!state || state.group !== group) {
      const frame = group.isPlaying ? group.getCurrentFrame() : group.from;
      state = { group, frame, since: Number.POSITIVE_INFINITY };
      this.stepped.set(instance, state);
    }
    if (group.isPlaying) group.pause();
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    state.frame = wrapFrame(state.frame + dtSeconds * fps * group.speedRatio, group.from, group.to);
    state.since += dtSeconds;
    if (state.since >= stepSeconds) {
      // Carry the remainder so the rate holds on any frame clock, but never
      // bank more than one step: a long hitch is followed by one pose, not a burst.
      state.since = Number.isFinite(state.since) ? Math.min(state.since - stepSeconds, stepSeconds) : 0;
      group.goToFrame(state.frame);
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
      group.goToFrame(state.frame);
      this.resetRootMotion(instance);
    }
  }

  playAnimation(instance: PlayerModelInstance, name: string): boolean {
    return PlayerModelManager.playAnimationOn(instance, name);
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
    const group = instance.masterGroup;
    if (!group) return;
    group.goToFrame(group.from);
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
      // A clip that did not load leaves the PREVIOUS one playing — it does not
      // fall back to idle. That reads in game as a player sliding in whatever
      // pose they last held, which is indistinguishable from a physics bug and
      // was silent, so say it once per missing clip.
      if (!PlayerModelManager.warnedMissingAnims.has(name)) {
        PlayerModelManager.warnedMissingAnims.add(name);
        console.warn(
          `[PlayerModelManager] animation "${name}" is not loaded; players needing it keep their previous pose`,
        );
      }
      return false;
    }

    // Tear down old
    if (instance.masterGroup) {
      instance.masterGroup.stop();
      instance.masterGroup.dispose();
    }

    // Build new
    instance.masterGroup = new AnimationGroup(`anim_${instance.id}_${name}`, instance.mesh.getScene());
    for (const item of animData.animations) {
      if (item.target) {
        instance.masterGroup.addTargetedAnimation(item.animation, item.target);
      }
    }
    instance.masterGroup.play(true);
    instance.currentAnim = name;
    return true;
  }

  /**
   * Play a one-shot animation on an instance (e.g. attack, hit reaction).
   * Uses an OVERLAY approach — does NOT touch the existing masterGroup.
   * The one-shot plays on top and auto-disposes when complete.
   * @param speedRatio - Optional playback speed multiplier (default 1.0, higher = faster)
   */
  playOnce(instance: PlayerModelInstance, name: string, speedRatio: number = 1.0): boolean {
    const animData = instance.anims.find((a) => a.name === name);
    if (!animData || animData.animations.length === 0) return false;
    this.stopOneShot(instance, false);

    // Create overlay animation group (separate from masterGroup)
    const group = new AnimationGroup(`anim_${instance.id}_${name}_overlay`, this.scene);
    for (const item of animData.animations) {
      if (item.target) {
        group.addTargetedAnimation(item.animation, item.target);
      }
    }

    // Apply speed ratio (higher = faster animation)
    group.speedRatio = speedRatio;

    // Stop the locomotion masterGroup while the one-shot plays.
    // This prevents both groups writing to the same bones simultaneously.
    if (instance.masterGroup) {
      instance.masterGroup.stop();
    }

    const durationMs = this.getOneShotDurationMs(instance, name, speedRatio);
    instance.oneshotUntil = performance.now() + durationMs;
    this.activeOneShots.set(instance, { group, baseSpeedRatio: speedRatio });

    // Play once (loop = false), auto-dispose when complete
    group.play(false);

    group.onAnimationEndObservable.addOnce(() => {
      if (this.activeOneShots.get(instance)?.group !== group) return;
      this.activeOneShots.delete(instance);
      group.stop();
      group.dispose();
      instance.oneshotUntil = 0;
      // Resume locomotion masterGroup after one-shot completes
      if (instance.masterGroup) {
        instance.masterGroup.play(true);
      }
    });

    return true;
  }

  /** Duration of a named one-shot at its authored 30fps and base speed. */
  getOneShotDurationMs(instance: PlayerModelInstance, name: string, speedRatio: number = 1.0): number {
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
    const active = this.activeOneShots.get(instance);
    if (active) active.group.speedRatio = active.baseSpeedRatio * timeScale;
  }

  isOneShotPlaying(instance: PlayerModelInstance): boolean {
    return this.activeOneShots.has(instance);
  }

  /** Stop and dispose an active overlay, optionally resuming locomotion. */
  stopOneShot(instance: PlayerModelInstance, resumeLocomotion: boolean = true): void {
    const active = this.activeOneShots.get(instance);
    if (active) {
      this.activeOneShots.delete(instance);
      active.group.stop();
      active.group.dispose();
    }
    instance.oneshotUntil = 0;
    if (resumeLocomotion && instance.masterGroup) {
      instance.masterGroup.play(true);
    }
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
    mesh.material = cloned;
    return cloned;
  }

  /**
   * Apply third-person player visibility styling to a model instance.
   * The tint still multiplies the model texture, while fullbright adds only a
   * small emissive lift so armor and fabric detail remain visible.
   */
  applyVisualStyle(instance: PlayerModelInstance, style: PlayerModelVisualStyle): void {
    const allMeshes: AbstractMesh[] = [instance.mesh, ...instance.mesh.getChildMeshes()];
    const tint = style.tintColor ?? Color3.White();
    const outlineWidth = Math.max(0, style.outlineWidth);

    for (const mesh of allMeshes) {
      const material = this.ensureInstanceMaterial(instance, mesh);
      const pbrMat = material as any;

      if (pbrMat?.albedoColor) {
        pbrMat.albedoColor.r = tint.r;
        pbrMat.albedoColor.g = tint.g;
        pbrMat.albedoColor.b = tint.b;
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
      mesh.outlineWidth = outlineWidth;
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
    const allMeshes: AbstractMesh[] = [instance.mesh, ...instance.mesh.getChildMeshes()];

    for (const mesh of allMeshes) {
      const pbrMat = mesh.material as unknown as GlowableMaterial | null;
      if (!pbrMat) continue;

      if (pbrMat.emissiveColor) {
        // Lift from the material's OWN base emissive, not from its current
        // value — accumulating onto the current value would ramp to white
        // within a second at 60fps.
        const base = pbrMat.__playerModelBaseEmissiveColor ?? Color3.Black();
        pbrMat.emissiveColor.r = base.r + color.r * intensity;
        pbrMat.emissiveColor.g = base.g + color.g * intensity;
        pbrMat.emissiveColor.b = base.b + color.b * intensity;
      }

      mesh.renderOutline = outlineWidth > 0;
      mesh.outlineColor = color;
      mesh.outlineWidth = outlineWidth;
    }
  }

  /** Back-compat wrapper for older callers that only know about team colors. */
  applyTeamColor(instance: PlayerModelInstance, team: PlayerModelTeamColor | null): void {
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
    instance.mesh.position.set(0, 0, 0);

    instance.rootMotionNodes ??= findRootMotionNodes(instance.mesh);
    for (const node of instance.rootMotionNodes) node.position.set(0, 0, 0);

    // Hips: restore the bind pose, killing both horizontal drift and the
    // vertical bob that would otherwise float the body off the ground.
    const bind = instance.hipsBind;
    if (bind) {
      bind.node.position.set(bind.x, bind.y, bind.z);
    }
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
    this.stopOneShot(instance, false);
    disposePlayerModel(instance);
    devLog(`[PlayerModelManager] Disposed instance: ${instance.id}`);
  }

  /** Dispose the manager and source model */
  dispose(): void {
    this.disposed = true;
    this.outlineRuntime?.release(this);
    this.outlineRuntime = undefined;
    for (const [instance, observer] of this.instances) instance.mesh.onDisposeObservable.remove(observer);
    this.instances.clear();
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

/** The nodes under a player mesh that carry root motion, by source name. */
function findRootMotionNodes(mesh: Mesh): TransformNode[] {
  return mesh.getChildTransformNodes(false).filter((node) => {
    // instantiateModelsToScene uses only id/sourceName, so ancestor names
    // cannot accidentally classify ordinary joints as root-motion nodes.
    const name = node.name.split("/").pop()!.toLowerCase();
    return name === "rootnode" || name === "armature" || name === "__root__";
  });
}

/**
 * Dispose a player model and everything it owns, on every path that removes one
 * (death, leaving, ragdoll expiry, shutdown): its hand weapon with whatever only
 * that used, its locomotion group, its nodes and skeleton, and the materials
 * cloned for it by the visibility style. The model's source materials and
 * textures are shared with every other instance and stay.
 *
 * A one-shot animation lives in the manager; `disposeInstance` stops it first.
 */
export function disposePlayerModel(instance: PlayerModelInstance): void {
  if (instance.attachedWeapon) {
    disposeModelResources([instance.attachedWeapon]);
    instance.attachedWeapon = null;
  }
  if (instance.masterGroup) {
    instance.masterGroup.stop();
    instance.masterGroup.dispose();
    instance.masterGroup = null;
  }
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
