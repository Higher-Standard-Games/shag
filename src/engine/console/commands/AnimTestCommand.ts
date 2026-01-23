/**
 * AnimTestCommand - Test animation system with a player model
 * 
 * Usage:
 *   animtest load              - Load the test model with animations
 *   animtest play <animation>  - Play a specific animation by index or name
 *   animtest list              - List available animations
 *   animtest state             - Show current animation state
 *   animtest dispose           - Remove the test model
 */

import { Scene, SceneLoader, Mesh, Skeleton, Vector3, AnimationGroup } from "@babylonjs/core";
import "@babylonjs/loaders";
import { Command, CommandDef } from "../Command";
import { AnimationLoader } from "../../animation";

export default class AnimTestCommand extends Command {
    readonly definition: CommandDef = {
        name: "animtest",
        aliases: ["at"],
        description: "Test animation system with player model",
        usage: "animtest <load|play|list|state|dispose> [animation]",
        developer: true,
    };

    private testMesh: Mesh | null = null;
    private testSkeleton: Skeleton | null = null;
    private scene: Scene | null = null;
    private loadedAnimGroups: AnimationGroup[] = [];
    private currentAnim: AnimationGroup | null = null;

    async execute(args: string[]): Promise<string | void> {
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
                return [
                    "Animation Test Commands:",
                    "  animtest load              - Load vanguard.glb with animations",
                    "  animtest play <name|index> - Play animation",
                    "  animtest list              - List loaded animations",
                    "  animtest stop              - Stop current animation",
                    "  animtest dispose           - Remove test model",
                ].join("\n");
        }
    }

    private async loadModel(): Promise<string> {
        const { CameraSystem } = await import("../../camera/CameraSystem");
        const camera = CameraSystem.getInstance().getCamera();

        if (!camera) {
            return "No active camera";
        }

        this.scene = camera.getScene();
        if (!this.scene) {
            return "No scene available";
        }

        if (this.testMesh) {
            this.disposeModel();
        }

        try {
            console.log("[AnimTest] Loading vanguard.glb...");

            const result = await SceneLoader.ImportMeshAsync(
                "",
                "games/default/animations/",
                "vanguard.glb",
                this.scene
            );

            if (result.meshes.length === 0) {
                return "No meshes found in model";
            }

            this.testMesh = result.meshes[0] as Mesh;
            this.testSkeleton = result.skeletons[0] || null;

            if (!this.testSkeleton) {
                return "No skeleton found in model - is it rigged?";
            }

            // Position in front of camera
            const forward = camera.getDirection(Vector3.Forward());
            const spawnPos = camera.position.add(forward.scale(150));
            this.testMesh.position = spawnPos;
            this.testMesh.scaling = new Vector3(50, 50, 50);

            // Store embedded animations
            this.loadedAnimGroups = result.animationGroups;

            console.log(`[AnimTest] Model has ${this.loadedAnimGroups.length} embedded animations`);

            // Load additional animation GLB files and apply to this skeleton
            const animLoader = AnimationLoader.getInstance();
            animLoader.initialize(this.scene, "games/default/animations/");

            // Load all standard animations
            const animFiles = [
                { name: "idle", file: "rifle aiming idle.glb" },
                { name: "run", file: "rifle run.glb" },
                { name: "run_back", file: "run backwards.glb" },
                { name: "strafe_l", file: "strafe left.glb" },
                { name: "strafe_r", file: "strafe right.glb" },
                { name: "jump", file: "rifle jump.glb" },
                { name: "walk", file: "walking.glb" },
                { name: "walk_back", file: "walking backwards.glb" },
                { name: "fire", file: "firing rifle.glb" },
                { name: "reload", file: "reloading.glb" },
                { name: "hit", file: "hit reaction.glb" },
                { name: "wallrun", file: "wallrun.glb" },
                { name: "grenade", file: "toss grenade.glb" },
            ];

            // Load each animation file
            for (const anim of animFiles) {
                try {
                    const animResult = await SceneLoader.ImportAnimationsAsync(
                        "",
                        `games/default/animations/${anim.file}`,
                        this.scene,
                        false
                    );

                    if (animResult.animationGroups.length > 0) {
                        // Retarget to our skeleton
                        const group = animResult.animationGroups[0];
                        group.name = anim.name;

                        // Stop and add to our list
                        group.stop();
                        this.loadedAnimGroups.push(group);
                        console.log(`[AnimTest] Loaded animation: ${anim.name}`);
                    }
                } catch (err) {
                    console.warn(`[AnimTest] Could not load ${anim.file}:`, err);
                }
            }

            // Play first animation by default
            if (this.loadedAnimGroups.length > 0) {
                this.loadedAnimGroups[0].play(true);
                this.currentAnim = this.loadedAnimGroups[0];
            }

            return [
                "Model loaded successfully!",
                `  Position: (${spawnPos.x.toFixed(0)}, ${spawnPos.y.toFixed(0)}, ${spawnPos.z.toFixed(0)})`,
                `  Bones: ${this.testSkeleton.bones.length}`,
                `  Animations: ${this.loadedAnimGroups.length}`,
                "",
                "Use 'animtest list' to see animations",
                "Use 'animtest play <name>' to play",
            ].join("\n");
        } catch (error) {
            console.error("[AnimTest] Load error:", error);
            return `Load failed: ${error}`;
        }
    }

    private playAnimation(nameOrIndex: string | undefined): string {
        if (!this.testMesh || this.loadedAnimGroups.length === 0) {
            return "No model loaded. Use 'animtest load' first.";
        }

        if (!nameOrIndex) {
            return "Specify animation name or index. Use 'animtest list' to see options.";
        }

        // Stop current animation
        if (this.currentAnim) {
            this.currentAnim.stop();
        }

        // Find animation by index or name
        let targetGroup: AnimationGroup | undefined;

        const index = parseInt(nameOrIndex);
        if (!isNaN(index) && index >= 0 && index < this.loadedAnimGroups.length) {
            targetGroup = this.loadedAnimGroups[index];
        } else {
            // Search by name (partial match)
            const searchName = nameOrIndex.toLowerCase();
            targetGroup = this.loadedAnimGroups.find(g =>
                g.name.toLowerCase().includes(searchName)
            );
        }

        if (!targetGroup) {
            return `Animation not found: ${nameOrIndex}. Use 'animtest list' to see options.`;
        }

        // Play the animation
        targetGroup.reset();
        targetGroup.play(true);
        this.currentAnim = targetGroup;

        return `Playing: ${targetGroup.name}`;
    }

    private listAnimations(): string {
        if (this.loadedAnimGroups.length === 0) {
            return "No animations loaded. Use 'animtest load' first.";
        }

        const lines = ["Loaded animations:"];
        this.loadedAnimGroups.forEach((group, i) => {
            const playing = group.isPlaying ? " (playing)" : "";
            lines.push(`  [${i}] ${group.name}${playing}`);
        });
        lines.push("", "Use 'animtest play <index|name>' to play");

        return lines.join("\n");
    }

    private stopAnimation(): string {
        if (this.currentAnim) {
            this.currentAnim.stop();
            this.currentAnim = null;
            return "Animation stopped.";
        }
        return "No animation playing.";
    }

    private disposeModel(): string {
        // Stop all animations
        this.loadedAnimGroups.forEach(g => g.stop());
        this.loadedAnimGroups = [];
        this.currentAnim = null;

        if (this.testMesh) {
            this.testMesh.dispose();
            this.testMesh = null;
        }

        this.testSkeleton = null;

        return "Test model disposed.";
    }

    getCompletions(_input: string, args: string[]): string[] {
        if (args.length === 0) {
            return ["load", "play", "list", "stop", "dispose"];
        }

        if (args[0] === "play" && this.loadedAnimGroups.length > 0) {
            return this.loadedAnimGroups.map(g => g.name);
        }

        return [];
    }
}
