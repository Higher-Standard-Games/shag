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
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { ImportAnimationsAsync, ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
// Side effect: registers the OutlineRenderer scene component — required for
// mesh.renderOutline (team outlines) to draw. Previously loaded implicitly by
// bare @babylonjs/core barrel imports; must be explicit with per-module imports.
import "@babylonjs/core/Rendering/outlineRenderer";
import type { Scene } from "@babylonjs/core/scene";

// ─── Types ───────────────────────────────────────────────────────

/** A stored animation: name + array of (bone target, animation curve) */
export interface StoredAnim {
  name: string;
  animations: { target: TransformNode; animation: Animation }[];
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
}

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
}

// ─── Default animation set ──────────────────────────────────────

export const DEFAULT_ANIM_FILES: AnimFileConfig[] = [
  { name: "idle", file: "rifle aiming idle.glb" },
  { name: "run", file: "rifle run.glb" },
  { name: "strafe_l", file: "strafe left.glb" },
  { name: "strafe_r", file: "strafe right.glb" },
  { name: "jump", file: "rifle jump.glb" },
  { name: "walk", file: "walking.glb" },
  { name: "reload", file: "reloading.glb" },
  { name: "blade_slash", file: "blade_slash.glb" },
  { name: "slide", file: "slide.glb" },
  { name: "crouch_walk", file: "crouch_walk_forward.glb" },
  { name: "crouch_walk_back", file: "crouch_walk_backward.glb" },
  { name: "crouch_strafe_l", file: "crouch_walk_left.glb" },
  { name: "crouch_strafe_r", file: "crouch_walk_right.glb" },
  { name: "walljump", file: "wallrun.glb" },
  // Swimming. The moving clip lays the body flat; the idle one treads upright.
  // The hull follows suit — see RemotePlayerRenderer and the swim hull in
  // MovementProfile — so the two must stay paired.
  { name: "swim", file: "swimming.glb" },
  { name: "swim_idle", file: "swimming_idle.glb" },
  { name: "climb", file: "climbing_ladder.glb" },
  // Victory dances (post-game winner showcase) — Mixamo dance clips exported
  // as GLB into public/games/default/animations/. Missing files are tolerated
  // (per-file try/catch above; playAnimation falls back to idle), so ship as
  // many or as few as are downloaded.
  { name: "dance_1", file: "dance_1.glb" },
  { name: "dance_2", file: "dance_2.glb" },
  { name: "dance_3", file: "dance_3.glb" },
];

/** Victory-dance pool for the post-game winner showcase (random pick). */
export const DANCE_ANIMS = ["dance_1", "dance_2", "dance_3"];

// ─── Manager ─────────────────────────────────────────────────────

export class PlayerModelManager {
  private scene: Scene;
  private readonly activeOneShots = new Map<PlayerModelInstance, { group: AnimationGroup; baseSpeedRatio: number }>();

  // Source model (loaded once)
  private loaded = false;
  private loading = false;
  private sourceMesh: Mesh | null = null;
  private sourceSkeleton: Skeleton | null = null;
  private sourceAnims: StoredAnim[] = [];
  private sourceBoneMap: Map<string, TransformNode> = new Map();

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
  async loadModel(
    modelPath: string = "/games/default/animations/",
    modelFile: string = "vanguard.glb",
    animFiles: AnimFileConfig[] = DEFAULT_ANIM_FILES,
  ): Promise<void> {
    if (this.loading || this.loaded) return;
    this.loading = true;

    console.log("[PlayerModelManager] Loading source model...");

    try {
      const result = await ImportMeshAsync(modelFile, this.scene, { rootUrl: modelPath });

      if (result.meshes.length === 0) {
        console.error("[PlayerModelManager] No meshes in model");
        return;
      }

      this.sourceMesh = result.meshes[0] as Mesh;
      this.sourceSkeleton = result.skeletons[0] || null;

      // Hide source — used only for cloning
      this.sourceMesh.isVisible = false;
      this.sourceMesh.getChildMeshes().forEach((m) => {
        m.isVisible = false;
      });

      // Stop embedded anims immediately
      result.animationGroups.forEach((g) => {
        g.stop();
      });

      // Build bone map
      if (this.sourceSkeleton) {
        for (const bone of this.sourceSkeleton.bones) {
          const node = bone.getTransformNode();
          if (node) this.sourceBoneMap.set(bone.name, node);
        }
      }

      // Store embedded animation (with root-motion filtering)
      if (result.animationGroups.length > 0) {
        const embedded = this.extractAnimChannels(result.animationGroups[0], this.sourceBoneMap);
        if (embedded.length > 0) {
          this.sourceAnims.push({ name: "embedded", animations: embedded });
        }
        result.animationGroups[0].dispose();
      }

      // CRITICAL: Clear ALL direct .animations on every node in the source.
      // Babylon's scene animation system evaluates these independently of
      // AnimationGroups. mesh.clone() copies them, causing root-motion drift
      // on clones. Our AnimationGroups hold their own references and are
      // unaffected by this clear.
      this.sourceMesh.animations = [];
      for (const node of this.sourceMesh.getChildTransformNodes(false)) {
        node.animations = [];
      }
      for (const child of this.sourceMesh.getChildMeshes()) {
        child.animations = [];
      }
      if (this.sourceSkeleton) {
        for (const bone of this.sourceSkeleton.bones) {
          const node = bone.getTransformNode();
          if (node) node.animations = [];
        }
      }

      // Load external animations
      for (const anim of animFiles) {
        try {
          // CRITICAL: Stop ALL animation groups BEFORE importing
          for (const g of this.scene.animationGroups) g.stop();

          await ImportAnimationsAsync(modelPath + anim.file, this.scene, { overwriteAnimations: false });

          // CRITICAL: Stop ALL animation groups IMMEDIATELY after import
          for (const g of this.scene.animationGroups) g.stop();

          // Old static API returned the scene — keep reading scene.animationGroups.
          if (this.scene.animationGroups.length > 0) {
            const sourceGroup = this.scene.animationGroups[0];
            const channels = this.extractAnimChannels(sourceGroup, this.sourceBoneMap);
            if (channels.length > 0) {
              this.sourceAnims.push({ name: anim.name, animations: channels });
              console.log(`[PlayerModelManager] Loaded ${anim.name}: ${channels.length} channels`);
            } else {
              console.warn(`[PlayerModelManager] ${anim.name} has 0 channels`);
            }
            sourceGroup.dispose();

            // Stop again after dispose
            for (const g of this.scene.animationGroups) g.stop();

            // CRITICAL: Clear any .animations injected onto nodes by the import.
            // ImportAnimationsAsync retargets to existing skeleton, injecting
            // .animations on TransformNodes that may not be mesh children.
            // Iterate ALL scene transform nodes to catch everything.
            if (this.sourceMesh) {
              this.sourceMesh.animations = [];
            }
            for (const node of this.scene.transformNodes) {
              node.animations = [];
            }
            for (const mesh of this.scene.meshes) {
              mesh.animations = [];
            }
          }
        } catch (err) {
          console.warn(`[PlayerModelManager] Failed to load ${anim.file}:`, err);
        }
      }

      // FINAL CLEANUP: Same broad sweep over ALL scene transform nodes.
      for (const g of this.scene.animationGroups) g.stop();
      for (const node of this.scene.transformNodes) {
        node.animations = [];
      }
      for (const mesh of this.scene.meshes) {
        mesh.animations = [];
      }

      // NUCLEAR: Stop ALL scene-level Animatables.
      // ImportAnimationsAsync can create scene.beginAnimation() calls
      // that survive AnimationGroup disposal and .animations[] cleanup.
      this.scene.stopAllAnimations();

      console.log(`[PlayerModelManager] Ready: ${this.sourceAnims.length} animations`);
      // Debug: log what channels each animation has
      for (const anim of this.sourceAnims) {
        const posChannels = anim.animations.filter((a) => a.animation.targetProperty === "position");
        console.log(
          `  ${anim.name}: ${anim.animations.length} channels (${posChannels.length} position tracks: ${posChannels.map((p) => p.target.name).join(", ")})`,
        );
      }
      this.loaded = true;
    } catch (err) {
      console.error("[PlayerModelManager] Load error:", err);
    } finally {
      this.loading = false;
    }
  }

  // ── Instance Management ──────────────────────────────────────

  /**
   * Create a new player model instance (clone of source mesh + skeleton).
   * Returns null if sources aren't loaded yet.
   *
   * @param id  Unique identifier (entity id, "debug", etc.)
   * @param scale  Mixamo → BSP scale factor (default 36)
   */
  createInstance(id: string, scale: number = 36): PlayerModelInstance | null {
    console.log(
      `[PlayerModelManager] createInstance called for ${id}. sourceMesh=${!!this.sourceMesh}, sourceSkeleton=${!!this.sourceSkeleton}`,
    );
    if (!this.sourceMesh || !this.sourceSkeleton) return null;

    // Clone mesh
    const clonedMesh = this.sourceMesh.clone(`player_${id}`, null);
    if (!clonedMesh) return null;

    // Clone skeleton
    const clonedSkeleton = this.sourceSkeleton.clone(`skel_${id}`);

    // Build bone map for clone
    const cloneBoneMap = new Map<string, TransformNode>();
    for (const bone of clonedSkeleton.bones) {
      const node = bone.getTransformNode();
      if (node) cloneBoneMap.set(bone.name, node);
    }

    // Link
    clonedMesh.skeleton = clonedSkeleton;
    for (const child of clonedMesh.getChildMeshes()) {
      child.skeleton = clonedSkeleton;
    }

    // Anchor (caller sets position/rotation on this)
    const anchor = new TransformNode(`anchor_${id}`, this.scene);
    clonedMesh.setParent(anchor);
    clonedMesh.position.set(0, 0, 0);

    // Scale and orient
    clonedMesh.scaling.set(scale, scale, scale);
    if (clonedMesh.rotationQuaternion) clonedMesh.rotationQuaternion = null;
    clonedMesh.rotation.set(0, 0, 0);

    // Visible and never culled. Skinned clone bounds can be stale after GLB
    // cloning/retargeted animations; if Babylon culls the body, the separately
    // bone-attached weapon still renders and looks like a floating gun.
    clonedMesh.setEnabled(true);
    clonedMesh.isVisible = true;
    clonedMesh.visibility = 1;
    clonedMesh.alwaysSelectAsActiveMesh = true;
    clonedMesh.getChildMeshes().forEach((m) => {
      m.setEnabled(true);
      m.isVisible = true;
      m.visibility = 1;
      m.alwaysSelectAsActiveMesh = true;
    });

    // CRITICAL: Clear ALL .animations on cloned nodes.
    // mesh.clone() / skeleton.clone() copies residual .animations arrays
    // from source nodes. Babylon's scene animation system auto-evaluates
    // these independently of our AnimationGroups, causing root-motion drift
    // (model slides away from hitbox). Our AnimationGroups hold their own
    // channel references and are NOT affected by this clear.
    // Traverse the FULL subtree: the skeleton nodes sit under RootNode, not
    // directly under __root__, so a direct-descendants-only walk clears nothing
    // but RootNode and leaves the 69 nodes below it still animating.
    clonedMesh.animations = [];
    for (const node of clonedMesh.getChildTransformNodes(false)) {
      node.animations = [];
    }
    for (const child of clonedMesh.getChildMeshes()) {
      child.animations = [];
    }
    for (const bone of clonedSkeleton.bones) {
      const node = bone.getTransformNode();
      if (node) node.animations = [];
    }
    // Also stop any scene-level Animatables targeting cloned nodes
    this.scene.stopAnimation(clonedMesh);
    for (const node of clonedMesh.getChildTransformNodes(false)) {
      this.scene.stopAnimation(node);
    }
    for (const bone of clonedSkeleton.bones) {
      const node = bone.getTransformNode();
      if (node) this.scene.stopAnimation(node);
    }

    // Clone animations retargeted to clone's bones
    const clonedAnims: StoredAnim[] = [];
    for (const srcAnim of this.sourceAnims) {
      const channels: { target: TransformNode; animation: Animation }[] = [];
      for (const ch of srcAnim.animations) {
        const cloneBone = cloneBoneMap.get(ch.target.name);
        if (cloneBone) {
          channels.push({ target: cloneBone, animation: ch.animation.clone() });
        }
      }
      if (channels.length > 0) {
        clonedAnims.push({ name: srcAnim.name, animations: channels });
      }
    }

    // Capture the Hips bind pose now, before any animation has run, so
    // resetRootMotion can never mistake a drifted pose for the bind pose.
    let hipsBind: PlayerModelInstance["hipsBind"] = null;
    for (const node of clonedMesh.getChildTransformNodes(false)) {
      if (node.name.toLowerCase().includes("hips")) {
        hipsBind = { node, x: node.position.x, y: node.position.y, z: node.position.z };
        break;
      }
    }

    const instance: PlayerModelInstance = {
      id,
      anchor,
      mesh: clonedMesh,
      skeleton: clonedSkeleton,
      anims: clonedAnims,
      masterGroup: null,
      currentAnim: "",
      oneshotUntil: 0,
      hipsBind,
    };

    console.log(`[PlayerModelManager] Created instance: ${id}`);
    return instance;
  }

  // ── Animation Playback ───────────────────────────────────────

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

    if (active) {
      if (!group.isPlaying) group.play(true);
      return;
    }
    if (group.isPlaying) group.pause();
  }

  playAnimation(instance: PlayerModelInstance, name: string): boolean {
    return PlayerModelManager.playAnimationOn(instance, name);
  }

  /**
   * Static variant of playAnimation — plays a looping animation on any
   * PlayerModelInstance without needing the owning manager (the post-game
   * winner showcase holds only the instance). Scene comes from the instance.
   */
  static playAnimationOn(instance: PlayerModelInstance, name: string): boolean {
    if (instance.currentAnim === name) return false;

    const animData = instance.anims.find((a) => a.name === name);
    if (!animData) return false;

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

    const cloned = material.clone(visibilityCloneName);
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

    console.log(`[PlayerModelManager] Applied team color: ${team ?? "none"} to ${instance.id}`);
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
   * ran. Only `RootNode` and `mixamorig:Hips` match these names anywhere in the
   * 70-node subtree, so the recursive walk stays targeted.
   *
   * Hips Y is restored to its BIND value, not zeroed: it is the skeleton's
   * natural hip height above the feet, and zeroing it collapses the skeleton to
   * mesh origin, dropping the legs ~35 units through the floor.
   */
  resetRootMotion(instance: PlayerModelInstance): void {
    instance.mesh.position.set(0, 0, 0);

    for (const child of instance.mesh.getChildTransformNodes(false)) {
      const name = child.name.toLowerCase();
      if (name.includes("armature") || name.includes("root")) {
        // Armature/root nodes should always be at mesh origin
        child.position.set(0, 0, 0);
      }
    }

    // Hips: restore the bind pose, killing both horizontal drift and the
    // vertical bob that would otherwise float the body off the ground.
    const bind = instance.hipsBind;
    if (bind) {
      bind.node.position.set(bind.x, bind.y, bind.z);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────

  /** Dispose a single instance */
  disposeInstance(instance: PlayerModelInstance): void {
    this.stopOneShot(instance, false);
    if (instance.attachedWeapon) {
      instance.attachedWeapon.dispose(false, true);
      instance.attachedWeapon = null;
    }
    if (instance.masterGroup) {
      instance.masterGroup.stop();
      instance.masterGroup.dispose();
    }
    if (instance.mesh) instance.mesh.dispose();
    if (instance.skeleton) instance.skeleton.dispose();
    if (instance.anchor) instance.anchor.dispose();
    console.log(`[PlayerModelManager] Disposed instance: ${instance.id}`);
  }

  /** Dispose the manager and source model */
  dispose(): void {
    if (this.sourceMesh) {
      this.sourceMesh.dispose();
      this.sourceMesh = null;
    }
    if (this.sourceSkeleton) {
      this.sourceSkeleton.dispose();
      this.sourceSkeleton = null;
    }
    this.sourceAnims = [];
    this.sourceBoneMap.clear();
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
      if (ourBone) {
        const clonedAnim = ta.animation.clone();
        channels.push({ target: ourBone, animation: clonedAnim });
      }
    }

    return channels;
  }
}
