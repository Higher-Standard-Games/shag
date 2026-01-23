/**
 * AnimTestCommand - Test animation system with a player model
 * 
 * Usage:
 *   animtest load              - Load the test model with animations
 *   animtest play <animation>  - Play a specific animation (idle, run_forward, etc.)
 *   animtest list              - List available animations
 *   animtest state             - Show current animation state
 *   animtest dispose           - Remove the test model
 */

import { Scene, SceneLoader, Mesh, Skeleton, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/FBX";
import { Command, CommandDef } from "../Command";
import {
    PlayerAnimationController,
    AnimationLoader,
    AnimationStateName,
} from "../../animation";

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
    private animController: PlayerAnimationController | null = null;
    private scene: Scene | null = null;

    async execute(args: string[]): Promise<string | void> {
        const subcommand = args[0]?.toLowerCase() || "help";

        switch (subcommand) {
            case "load":
                return this.loadModel();
            case "play":
                return this.playAnimation(args[1]);
            case "list":
                return this.listAnimations();
            case "state":
                return this.showState();
            case "dispose":
                return this.disposeModel();
            default:
                return [
                    "Animation Test Commands:",
                    "  animtest load              - Load vanguard.fbx with animations",
                    "  animtest play <animation>  - Play animation (idle, run_forward, strafe_left, etc.)",
                    "  animtest list              - List available animations",
                    "  animtest state             - Show current animation state",
                    "  animtest dispose           - Remove test model",
                ].join("\n");
        }
    }

    private async loadModel(): Promise<string> {
        // Get scene from camera system
        const { CameraSystem } = await import("../../camera/CameraSystem");
        const camera = CameraSystem.getInstance().getCamera();

        if (!camera) {
            return "No active camera";
        }

        this.scene = camera.getScene();
        if (!this.scene) {
            return "No scene available";
        }

        // Dispose existing if any
        if (this.testMesh) {
            this.disposeModel();
        }

        try {
            console.log("[AnimTest] Loading vanguard.fbx...");

            // Load the model
            const result = await SceneLoader.ImportMeshAsync(
                "",
                "games/default/animations/",
                "vanguard.fbx",
                this.scene
            );

            if (result.meshes.length === 0) {
                return "No meshes found in model";
            }

            // Find the root mesh and skeleton
            this.testMesh = result.meshes[0] as Mesh;
            this.testSkeleton = result.skeletons[0] || null;

            if (!this.testSkeleton) {
                return "No skeleton found in model - is it rigged?";
            }

            // Position the model in front of the camera
            const forward = camera.getDirection(Vector3.Forward());
            const spawnPos = camera.position.add(forward.scale(200));
            spawnPos.y = 0; // Ground level

            this.testMesh.position = spawnPos;
            this.testMesh.scaling = new Vector3(1, 1, 1);

            console.log(`[AnimTest] Loaded model with ${result.meshes.length} meshes, ${this.testSkeleton.bones.length} bones`);

            // Log bone names for debugging
            console.log("[AnimTest] Bone names:", this.testSkeleton.bones.map(b => b.name).slice(0, 10).join(", "), "...");

            // Initialize animation loader
            const animLoader = AnimationLoader.getInstance();
            animLoader.initialize(this.scene, "games/default/animations/");

            // Try to load standard animations
            console.log("[AnimTest] Loading animations...");
            await animLoader.loadStandardAnimations();

            // Create animation controller
            this.animController = new PlayerAnimationController(
                this.testMesh,
                this.testSkeleton,
                this.scene,
                { debug: true }
            );

            await this.animController.initialize();

            // Also play any animations that came with the model
            if (result.animationGroups.length > 0) {
                console.log("[AnimTest] Model has embedded animations:");
                result.animationGroups.forEach((ag, i) => {
                    console.log(`  [${i}] ${ag.name}`);
                });
                // Play first animation
                result.animationGroups[0].play(true);
            }

            return [
                "Model loaded successfully!",
                `  Position: (${spawnPos.x.toFixed(0)}, ${spawnPos.y.toFixed(0)}, ${spawnPos.z.toFixed(0)})`,
                `  Meshes: ${result.meshes.length}`,
                `  Bones: ${this.testSkeleton.bones.length}`,
                `  Embedded Anims: ${result.animationGroups.length}`,
                "",
                "Use 'animtest play idle' to play an animation",
                "Use 'animtest list' to see available animations",
            ].join("\n");
        } catch (error) {
            console.error("[AnimTest] Load error:", error);
            return `Load failed: ${error}`;
        }
    }

    private playAnimation(animName: string | undefined): string {
        if (!this.animController) {
            return "No model loaded. Use 'animtest load' first.";
        }

        if (!animName) {
            return "Specify animation name. Use 'animtest list' to see options.";
        }

        // Map common names to enum values
        const animMap: Record<string, AnimationStateName> = {
            idle: AnimationStateName.Idle,
            run: AnimationStateName.RunForward,
            run_forward: AnimationStateName.RunForward,
            run_backward: AnimationStateName.RunBackward,
            strafe_left: AnimationStateName.StrafeLeft,
            strafe_right: AnimationStateName.StrafeRight,
            jump: AnimationStateName.JumpAir,
            crouch: AnimationStateName.CrouchIdle,
            slide: AnimationStateName.Slide,
            walljump: AnimationStateName.WallJump,
        };

        const targetAnim = animMap[animName.toLowerCase()] || (animName as AnimationStateName);

        try {
            this.animController.forcePlay(targetAnim);
            return `Playing animation: ${targetAnim}`;
        } catch (error) {
            return `Failed to play animation: ${error}`;
        }
    }

    private listAnimations(): string {
        const animations = Object.values(AnimationStateName);
        return [
            "Available animations:",
            ...animations.map(a => `  - ${a}`),
            "",
            "Use 'animtest play <name>' to play",
        ].join("\n");
    }

    private showState(): string {
        if (!this.animController) {
            return "No model loaded.";
        }

        const state = this.animController.getCurrentState();
        const currentAnim = this.animController.getCurrentAnimation();

        return [
            "Current Animation State:",
            `  Current Animation: ${currentAnim}`,
            `  Grounded: ${state.grounded}`,
            `  Speed: ${state.speed.toFixed(2)}`,
            `  Crouching: ${state.isCrouching}`,
            `  Sliding: ${state.isSliding}`,
            `  Wall Jumping: ${state.isWallJumping}`,
            `  Aim Pitch: ${state.aimPitch.toFixed(1)}°`,
        ].join("\n");
    }

    private disposeModel(): string {
        if (this.animController) {
            this.animController.dispose();
            this.animController = null;
        }

        if (this.testMesh) {
            this.testMesh.dispose();
            this.testMesh = null;
        }

        this.testSkeleton = null;

        return "Test model disposed.";
    }

    getCompletions(_input: string, args: string[]): string[] {
        if (args.length === 0) {
            return ["load", "play", "list", "state", "dispose"];
        }

        if (args[0] === "play") {
            return Object.values(AnimationStateName);
        }

        return [];
    }
}
