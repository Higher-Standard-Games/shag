/**
 * AnimTestCommand - Test animation system with a player model
 *
 * Fix: Use a SINGLE AnimationGroup and swap animations into it when switching.
 * Multiple AnimationGroups targeting the same bones overwrite each other.
 */

import type { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { ImportAnimationsAsync, ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders";
import { resolvePlayerModelAsset, VANGUARD_MODEL, VANGUARD_ROOT } from "../../animation/PlayerModelAssets";
import { Command, type CommandDef } from "../Command";

interface StoredAnimation {
  name: string;
  animations: { target: TransformNode; animation: Animation }[];
}

export default class AnimTestCommand extends Command {
  readonly definition: CommandDef = {
    name: "animtest",
    aliases: ["at"],
    description: "Test animation system with player model",
    usage: "animtest <load|play|list|stop|dispose> [animation]",
    developer: true,
  };

  private testMesh: Mesh | null = null;
  private testSkeleton: Skeleton | null = null;
  private scene: Scene | null = null;

  // Store animations as raw data, not as AnimationGroups
  private storedAnims: StoredAnimation[] = [];

  // Single master AnimationGroup used for playback
  private masterGroup: AnimationGroup | null = null;
  private currentAnimName: string = "";

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase() || "help";

    switch (subcommand) {
      case "load":
        return this.loadModel();
      case "play":
        return this.playAnimation(args[1]);
      case "list":
        return this.listAnimations();
      case "stop":
        return this.stopAnimation();
      case "dispose":
        return this.disposeModel();
      default:
        return "animtest load | play <n> | list | stop | dispose";
    }
  }

  private async loadModel(): Promise<string> {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    const camera = CameraSystem.getInstance().getCamera();

    if (!camera) return "No active camera";

    this.scene = camera.getScene();
    if (!this.scene) return "No scene available";

    if (this.testMesh) this.disposeModel();

    try {
      console.log("[AnimTest] Loading vanguard.glb...");

      const model = await resolvePlayerModelAsset(VANGUARD_ROOT, VANGUARD_MODEL);
      if (!model) return "Player model missing";
      const result = await ImportMeshAsync(model.source, this.scene, model.options);

      if (result.meshes.length === 0) return "No meshes found";

      this.testMesh = result.meshes[0] as Mesh;
      this.testSkeleton = result.skeletons[0] || null;
      if (!this.testSkeleton) return "No skeleton found";

      // Position in front of camera
      const forward = camera.getDirection(Vector3.Forward());
      const spawnPos = camera.position.add(forward.scale(150));
      this.testMesh.position = spawnPos;
      this.testMesh.scaling = new Vector3(50, 50, 50);

      // Stop and store embedded animation
      if (result.animationGroups.length > 0) {
        const embeddedGroup = result.animationGroups[0];
        embeddedGroup.stop();

        // Extract animations from embedded group
        const embeddedAnims: StoredAnimation = {
          name: "embedded",
          animations: [],
        };
        for (const ta of embeddedGroup.targetedAnimations) {
          embeddedAnims.animations.push({
            target: ta.target as TransformNode,
            animation: ta.animation.clone(),
          });
        }
        this.storedAnims.push(embeddedAnims);
        embeddedGroup.dispose();
      }

      // Build map: bone name -> TransformNode
      const targetBoneMap = new Map<string, TransformNode>();
      for (const bone of this.testSkeleton.bones) {
        const node = bone.getTransformNode();
        if (node) {
          targetBoneMap.set(bone.name, node);
        }
      }
      console.log(`[AnimTest] Target skeleton: ${targetBoneMap.size} bones`);

      // Create master group for playback
      this.masterGroup = new AnimationGroup("master", this.scene);

      // Load animations and store them
      const animFiles = [
        { name: "idle", file: "rifle aiming idle.glb" },
        { name: "run", file: "rifle run.glb" },
        { name: "strafe_l", file: "strafe left.glb" },
        { name: "strafe_r", file: "strafe right.glb" },
        { name: "jump", file: "rifle jump.glb" },
        { name: "walk", file: "walking.glb" },
        { name: "reload", file: "reloading.glb" },
        { name: "wallrun", file: "wallrun.glb" },
      ];

      for (const anim of animFiles) {
        try {
          console.log(`[AnimTest] Loading ${anim.file}...`);

          const asset = await resolvePlayerModelAsset(VANGUARD_ROOT, anim.file);
          if (!asset) continue;
          await ImportAnimationsAsync(asset.source, this.scene, {
            ...asset.options,
            overwriteAnimations: false,
          });

          // The old static API returned the scene — keep operating on the
          // scene's animation groups exactly as before.
          if (this.scene.animationGroups.length > 0) {
            const sourceGroup = this.scene.animationGroups[0];

            // Store animations with retargeted bones
            const storedAnim: StoredAnimation = {
              name: anim.name,
              animations: [],
            };

            for (const ta of sourceGroup.targetedAnimations) {
              const targetName = (ta.target as TransformNode).name;
              const ourBone = targetBoneMap.get(targetName);

              if (ourBone) {
                // Clone animation with unique name
                const clonedAnim = ta.animation.clone();
                clonedAnim.name = `${anim.name}_${ta.animation.name}`;

                storedAnim.animations.push({
                  target: ourBone,
                  animation: clonedAnim,
                });
              }
            }

            if (storedAnim.animations.length > 0) {
              this.storedAnims.push(storedAnim);
              console.log(`[AnimTest] Stored ${anim.name}: ${storedAnim.animations.length} channels`);
            }

            sourceGroup.dispose();
          }
        } catch (err) {
          console.error(`[AnimTest] Error loading ${anim.file}:`, err);
        }
      }

      // Play idle by default
      this.playAnimation("idle");

      return [
        "Model loaded!",
        `  Bones: ${this.testSkeleton.bones.length}`,
        `  Animations: ${this.storedAnims.length}`,
        "",
        "animtest list | animtest play <name>",
      ].join("\n");
    } catch (error) {
      console.error("[AnimTest] Load error:", error);
      return `Load failed: ${error}`;
    }
  }

  private playAnimation(nameOrIndex: string | undefined): string {
    if (!this.masterGroup || this.storedAnims.length === 0) return "No model.";
    if (!nameOrIndex) return "Specify animation.";

    // Find the animation
    let target: StoredAnimation | undefined;
    const idx = parseInt(nameOrIndex, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < this.storedAnims.length) {
      target = this.storedAnims[idx];
    } else {
      target = this.storedAnims.find((a) => a.name.toLowerCase().includes(nameOrIndex.toLowerCase()));
    }

    if (!target) return `Not found: ${nameOrIndex}`;

    // Stop and clear the master group
    this.masterGroup.stop();

    // Remove all current animations from master group
    // We need to recreate it because there's no clear() method
    this.masterGroup.dispose();
    this.masterGroup = new AnimationGroup("master", this.scene!);

    // Add the new animation's channels
    for (const anim of target.animations) {
      this.masterGroup.addTargetedAnimation(anim.animation, anim.target);
    }

    // Play the master group
    this.masterGroup.play(true);
    this.currentAnimName = target.name;

    return `Playing: ${target.name} (${target.animations.length} ch)`;
  }

  private listAnimations(): string {
    if (this.storedAnims.length === 0) return "No animations.";

    const lines = ["Loaded animations:"];
    this.storedAnims.forEach((a, i) => {
      const active = a.name === this.currentAnimName ? " *" : "";
      lines.push(`  [${i}] ${a.name} (${a.animations.length} ch)${active}`);
    });
    return lines.join("\n");
  }

  private stopAnimation(): string {
    if (this.masterGroup) {
      this.masterGroup.stop();
    }
    this.currentAnimName = "";
    return "Stopped.";
  }

  private disposeModel(): string {
    if (this.masterGroup) {
      this.masterGroup.stop();
      this.masterGroup.dispose();
      this.masterGroup = null;
    }

    this.storedAnims = [];
    this.currentAnimName = "";

    if (this.testMesh) {
      this.testMesh.dispose();
      this.testMesh = null;
    }

    this.testSkeleton = null;
    return "Disposed.";
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) return ["load", "play", "list", "stop", "dispose"];
    if (args[0] === "play") return this.storedAnims.map((a) => a.name);
    return [];
  }
}
