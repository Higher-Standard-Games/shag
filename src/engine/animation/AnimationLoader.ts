/**
 * Animation Loader - Load and manage shared animation packs
 *
 * Handles loading Mixamo animations from GLB files and applying them
 * to any Mixamo-compatible skeleton.
 */

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { ImportAnimationsAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";

/**
 * Animation clip metadata
 */
export interface AnimationClipInfo {
  name: string;
  path: string;
  loop: boolean;
  speed: number;
}

/**
 * Standard animation set for humanoid characters
 * Mapped to actual Mixamo filenames in public/games/default/animations/
 */
export const STANDARD_ANIMATIONS: AnimationClipInfo[] = [
  { name: "idle", path: "rifle aiming idle.glb", loop: true, speed: 1.0 },
  { name: "run_forward", path: "rifle run.glb", loop: true, speed: 1.0 },
  { name: "run_backward", path: "run backwards.glb", loop: true, speed: 1.0 },
  { name: "strafe_left", path: "strafe left.glb", loop: true, speed: 1.0 },
  { name: "strafe_right", path: "strafe right.glb", loop: true, speed: 1.0 },
  { name: "jump_start", path: "rifle jump.glb", loop: false, speed: 1.0 },
  { name: "jump_air", path: "rifle jump.glb", loop: true, speed: 1.0 },
  { name: "jump_land", path: "rifle jump.glb", loop: false, speed: 1.0 },
  { name: "crouch_idle", path: "rifle aiming idle.glb", loop: true, speed: 1.0 },
  { name: "crouch_walk", path: "walking.glb", loop: true, speed: 1.0 },
  { name: "walk", path: "walking.glb", loop: true, speed: 1.0 },
  { name: "walk_backward", path: "walking backwards.glb", loop: true, speed: 1.0 },
  { name: "fire", path: "firing rifle.glb", loop: false, speed: 1.0 },
  { name: "reload", path: "reloading.glb", loop: false, speed: 1.0 },
  { name: "hit", path: "hit reaction.glb", loop: false, speed: 1.0 },
  { name: "wallrun", path: "wallrun.glb", loop: true, speed: 1.0 },
  { name: "grenade", path: "toss grenade.glb", loop: false, speed: 1.0 },
];

/**
 * AnimationLoader - Singleton for loading and caching animations
 */
export class AnimationLoader {
  private static instance: AnimationLoader;

  private scene: Scene | null = null;
  private animationsPath: string = "/games/default/animations/";
  private loadedAnimations: Map<string, AnimationGroup[]> = new Map();
  private loading: Map<string, Promise<AnimationGroup[]>> = new Map();

  private constructor() {}

  static getInstance(): AnimationLoader {
    if (!AnimationLoader.instance) {
      AnimationLoader.instance = new AnimationLoader();
    }
    return AnimationLoader.instance;
  }

  /**
   * Initialize with scene reference
   */
  initialize(scene: Scene, animationsPath?: string): void {
    this.scene = scene;
    if (animationsPath) {
      this.animationsPath = animationsPath;
    }
  }

  /**
   * Load a single animation file
   */
  async loadAnimation(name: string, filename: string): Promise<AnimationGroup[]> {
    if (!this.scene) {
      throw new Error("[AnimationLoader] Not initialized - call initialize() first");
    }

    // Return cached if available
    if (this.loadedAnimations.has(name)) {
      return this.loadedAnimations.get(name)!;
    }

    // Return pending promise if already loading
    if (this.loading.has(name)) {
      return this.loading.get(name)!;
    }

    // Start loading
    const loadPromise = this.doLoadAnimation(name, filename);
    this.loading.set(name, loadPromise);

    try {
      const groups = await loadPromise;
      this.loadedAnimations.set(name, groups);
      return groups;
    } finally {
      this.loading.delete(name);
    }
  }

  /**
   * Internal load implementation
   */
  private async doLoadAnimation(name: string, filename: string): Promise<AnimationGroup[]> {
    const fullPath = this.animationsPath + filename;

    try {
      console.log(`[AnimationLoader] Loading animation: ${name} from ${fullPath}`);

      await ImportAnimationsAsync(fullPath, this.scene!, {
        overwriteAnimations: false, // Don't overwrite existing animations
      });

      // The old static API returned the scene — keep operating on the scene's
      // animation groups exactly as before.
      const groups = this.scene!.animationGroups;

      // Rename animation groups for easier identification
      groups.forEach((group) => {
        group.name = `${name}_${group.name}`;
      });

      console.log(`[AnimationLoader] Loaded ${groups.length} animation groups for ${name}`);
      return groups;
    } catch (error) {
      console.error(`[AnimationLoader] Failed to load animation ${name}:`, error);
      return [];
    }
  }

  /**
   * Load all standard animations
   */
  async loadStandardAnimations(): Promise<Map<string, AnimationGroup[]>> {
    const results = new Map<string, AnimationGroup[]>();

    for (const clip of STANDARD_ANIMATIONS) {
      try {
        const groups = await this.loadAnimation(clip.name, clip.path);
        results.set(clip.name, groups);
      } catch (error) {
        console.warn(`[AnimationLoader] Could not load ${clip.name}:`, error);
      }
    }

    console.log(`[AnimationLoader] Loaded ${results.size}/${STANDARD_ANIMATIONS.length} standard animations`);
    return results;
  }

  /**
   * Apply an animation to a skeleton
   */
  applyToSkeleton(animationName: string, targetSkeleton: Skeleton): AnimationGroup | null {
    const groups = this.loadedAnimations.get(animationName);
    if (!groups || groups.length === 0) {
      console.warn(`[AnimationLoader] Animation not found: ${animationName}`);
      return null;
    }

    // Clone the animation group for this skeleton
    const sourceGroup = groups[0];
    const clonedGroup = sourceGroup.clone(
      `${animationName}_${targetSkeleton.name}`,
      // Retarget to new skeleton's bones
      (oldTarget) => {
        const boneName = oldTarget.name;
        const targetBone = targetSkeleton.bones.find((b) => b.name === boneName);
        return targetBone?.getTransformNode() || oldTarget;
      },
    );

    return clonedGroup;
  }

  /**
   * Get a loaded animation by name
   */
  getAnimation(name: string): AnimationGroup[] | undefined {
    return this.loadedAnimations.get(name);
  }

  /**
   * Check if an animation is loaded
   */
  hasAnimation(name: string): boolean {
    return this.loadedAnimations.has(name);
  }

  /**
   * Get all loaded animation names
   */
  getLoadedAnimationNames(): string[] {
    return Array.from(this.loadedAnimations.keys());
  }

  /**
   * Clear all cached animations
   */
  clearCache(): void {
    for (const groups of this.loadedAnimations.values()) {
      groups.forEach((g) => {
        g.dispose();
      });
    }
    this.loadedAnimations.clear();
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.clearCache();
    this.scene = null;
  }
}
