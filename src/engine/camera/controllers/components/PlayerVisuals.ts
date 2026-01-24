import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Animation } from "@babylonjs/core/Animations/animation";
import { FPSController } from "../FPSController";
import { Cvar } from "../../../core/Cvar";

/**
 * PlayerVisuals - Handles the visual representation of the player
 * 
 * Includes:
 * - Debug bounding box visualization
 * - Debug player model (Vanguard)
 * - Animation state machine and playback
 * - Position/Rotation smoothing
 */
export class PlayerVisuals {
    private controller: FPSController;
    private scene: Scene;

    // Debug visualization (cl_debugbbox cvar)
    private debugBboxMesh: Mesh | null = null;

    // Debug player model visualization (cl_debugplayer cvar)
    private debugPlayerMesh: Mesh | null = null;
    private debugPlayerSkeleton: Skeleton | null = null;
    private debugPlayerAnims: { name: string; animations: { target: TransformNode; animation: Animation }[] }[] = [];
    private debugPlayerMasterGroup: AnimationGroup | null = null;
    private debugPlayerCurrentAnim: string = "";
    private debugPlayerAnchor: TransformNode | null = null;

    // Smoothed tracking to prevent idle jitter
    private debugPlayerSmoothedYaw: number = 0;
    private debugPlayerSmoothedPos: Vector3 = new Vector3(0, 0, 0);

    private debugPlayerLoading: boolean = false;

    constructor(controller: FPSController, scene: Scene) {
        this.controller = controller;
        this.scene = scene;
    }

    /**
     * Update visual elements (bbox, player model)
     */
    public update(deltaTime: number): void {
        this.updateDebugBbox();
        this.updateDebugPlayer(deltaTime);
    }

    public dispose(): void {
        this.disposeDebugPlayer();
        if (this.debugBboxMesh) {
            this.debugBboxMesh.dispose();
            this.debugBboxMesh = null;
        }
    }

    /**
     * Update the debug bounding box visualization
     */
    private updateDebugBbox(): void {
        const debugBboxVal = Cvar.get('cl_debugbbox');
        const showBbox = debugBboxVal !== undefined && Number(debugBboxVal) > 0;

        if (!showBbox) {
            if (this.debugBboxMesh) {
                this.debugBboxMesh.dispose();
                this.debugBboxMesh = null;
            }
            return;
        }

        if (!this.debugBboxMesh) {
            const width = this.controller.radius * 2;
            const height = this.controller.height; // Use current height (crouch aware)
            const depth = this.controller.radius * 2;

            this.debugBboxMesh = MeshBuilder.CreateBox("debugBbox", { width, height, depth }, this.scene);
            this.debugBboxMesh.isPickable = false;
            this.debugBboxMesh.renderingGroupId = 1; // Draw over geometry if depth test allows

            // Wireframe material is complex in BJS, simpler to use edges or just CreateBox lines?
            // MeshBuilder.CreateBox creates a solid mesh. For lines we want edges renderer or CreateLines
            // Let's stick to simple box for now but make it wireframe via material if we had one.
            // Better: CreateLines for a box shape.

            this.debugBboxMesh.dispose(); // Discard the solid box

            // Manual box lines
            const w = this.controller.radius;
            const h = this.controller.height / 2;
            const d = this.controller.radius;

            // 8 corners... actually let's use CreateBox with enableEdgesRendering? 
            // Or just standard BJS EdgesRenderer.
            // Simplest for now: CreateBox with visibility 0.2
            this.debugBboxMesh = MeshBuilder.CreateBox("debugBbox", { width, height, depth }, this.scene) as LinesMesh;
            this.debugBboxMesh.visibility = 0.3;
            this.debugBboxMesh.isPickable = false;
        }

        // Update size if changed (crouch)
        const height = this.controller.height;
        if (this.debugBboxMesh.scaling.y !== height) {
            // Recreating is easier than rescaling non-uniform with absolute dimensions
            this.debugBboxMesh.dispose();
            const width = this.controller.radius * 2;
            const depth = this.controller.radius * 2;
            this.debugBboxMesh = MeshBuilder.CreateBox("debugBbox", { width, height, depth }, this.scene) as LinesMesh;
            this.debugBboxMesh.visibility = 0.3;
            this.debugBboxMesh.isPickable = false;
        }

        // Position: Physics origin is 24 units above feet.
        // Box origin is center.
        // If player is standing (height 56), feet are at origin-24. Top is feet+56 = origin+32.
        // Box center should be feet + height/2.
        // Box center = (origin - 24) + height/2.

        // Q3 Mins/Maxs for player: [-15, -15, -24] to [15, 15, 32] (Total height 56)
        // Origin is at (0,0,0) relative to these bounds.

        // So box center relative to physics origin: (-24 + 32) / 2 = 4 for Z?
        // Wait, Box center Z = (MinZ + MaxZ) / 2 = (-24 + 32) / 2 = 4.

        const aheadPos = this.controller.getPlayerPosition().clone();

        // Look direction for offset
        const yaw = this.controller.getRotation().y;
        const offset = 100;
        aheadPos.x += Math.sin(yaw) * offset;
        aheadPos.z += Math.cos(yaw) * offset;

        // Adjust y to center of box
        // Controller physicsY is origin. 
        // Box center needs to be shift based on height
        // If Standing: Center is y + 4.
        // If Crouching: Mins/Maxs are [-15, -15, -24] to [15, 15, 12] (Total 36). Center = -6.

        // Dynamic calculation:
        // Feet Y = physicsY - 24 (always)
        // Center Y = Feet Y + height/2
        // Center Y = physicsY - 24 + height/2

        // Correct crouch behavior: feet stay on ground, head lowers
        // When crouched, origin drops by (PLAYER_MINS_Z - CROUCH_MINS_Z) = 20 units
        // to keep feet at the same level as standing
        // In FPSController, this logic is handled by setting physicsY.
        // But we are visualizing the hitbox relative to the ghost player.

        // Let's align with FPSController updateDebugBbox logic exactly:
        /*
        const crouchOriginDrop = isCrouched ? (PLAYER_MINS_Z - CROUCH_MINS_Z) : 0; 
        aheadPos.y = this.physicsY + crouchOriginDrop; // This puts it at feet level? No...
        */

        // The previous code in FPSController:
        // const crouchOriginDrop = isCrouched ? (PLAYER_MINS_Z - CROUCH_MINS_Z) : 0;
        // aheadPos.y = this.physicsY + crouchOriginDrop;

        // This looks like it was just placing the box at the origin? 
        // If strict bounding box visualization is needed, we should be precise.
        // For now, porting the existing logic logic:

        const isCrouched = height < 56; // approximate check
        const PLAYER_MINS_Z = -24;
        const CROUCH_MINS_Z = -24 + 20; // Actually crouch mins is -24, Maxs changes? 
        // In Quake 3:
        // Standard: -24 to 32 (56 units)
        // Crouch: -24 to 12 (36 units)
        // The origin stays at same relative point? No, viewheight changes.

        // Let's just copy exactly what was in FPSController to maintain behavior
        // it was: const crouchOriginDrop = isCrouched ? (PLAYER_MINS_Z - CROUCH_MINS_Z) : 0;
        // But PLAYER_MINS_Z etc are private constants in FPSController? 
        // We'll need to define them or access them.

        // Checking FPSController imports... they are constants.
        // I will redefine them here for simplicity or export them.
        const CONST_PLAYER_MINS_Z = -24;
        const CONST_CROUCH_MINS_Z = -4; // Based on comment in FPSController: "-24 - (-4) = -20" -> Wait, 
        // "origin drops by (PLAYER_MINS_Z - CROUCH_MINS_Z) = 20 units"
        // -24 - (-4) = -20. So CROUCH_MINS_Z is -4?

        const crouchOriginDrop = isCrouched ? (CONST_PLAYER_MINS_Z - CONST_CROUCH_MINS_Z) : 0;
        aheadPos.y += crouchOriginDrop;

        this.debugBboxMesh.position.copyFrom(aheadPos);
        this.debugBboxMesh.isVisible = true;
    }

    /**
     * Initialize debug player model and load animations
     */
    private async initDebugPlayer(): Promise<void> {
        if (!this.scene || this.debugPlayerLoading || this.debugPlayerMesh) return;

        this.debugPlayerLoading = true;
        console.log("[DebugPlayer] Loading vanguard.glb...");

        try {
            const result = await SceneLoader.ImportMeshAsync(
                "",
                "games/default/animations/",
                "vanguard.glb",
                this.scene
            );

            if (result.meshes.length === 0) {
                console.error("[DebugPlayer] No meshes in model");
                return;
            }

            this.debugPlayerMesh = result.meshes[0] as Mesh;
            this.debugPlayerSkeleton = result.skeletons[0] || null;

            // === CREATE PARENT ANCHOR NODE ===
            this.debugPlayerAnchor = new TransformNode("debugPlayerAnchor", this.scene);

            // Unparent mesh from any existing parent and reparent to our anchor
            this.debugPlayerMesh.setParent(this.debugPlayerAnchor);

            // Reset mesh local position to zero - it will be relative to anchor
            this.debugPlayerMesh.position.set(0, 0, 0);

            // Initialize smoothed values to prevent fly-in from origin
            const yaw = this.controller.getRotation().y;
            const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            const myPos = this.controller.getPlayerPosition();
            const initialPos = new Vector3(myPos.x, myPos.y, myPos.z);
            initialPos.addInPlace(forward.scale(100)); // default offset

            // Need CONST_PLAYER_MINS_Z again (assuming -24)
            const CONST_PLAYER_MINS_Z = -24;
            initialPos.y = myPos.y + CONST_PLAYER_MINS_Z;

            this.debugPlayerSmoothedPos.copyFrom(initialPos);
            this.debugPlayerSmoothedYaw = yaw;

            // Stop embedded animation
            result.animationGroups.forEach(g => g.stop());

            // Build bone map
            const targetBoneMap = new Map<string, TransformNode>();
            if (this.debugPlayerSkeleton) {
                for (const bone of this.debugPlayerSkeleton.bones) {
                    const node = bone.getTransformNode();
                    if (node) targetBoneMap.set(bone.name, node);
                }
            }

            // Store embedded animation (with position filtering)
            if (result.animationGroups.length > 0) {
                const embeddedAnims: { target: TransformNode; animation: Animation }[] = [];
                for (const ta of result.animationGroups[0].targetedAnimations) {
                    const targetName = (ta.target as TransformNode).name;
                    const prop = ta.animation.targetProperty;

                    // Skip position animations ONLY on Hips (root motion)
                    const isHipsBone = targetName.toLowerCase().includes('hips');
                    if (prop === 'position' && isHipsBone) {
                        console.log(`[DebugPlayer] Filtering root motion: ${targetName}`);
                        continue;
                    }

                    embeddedAnims.push({
                        target: ta.target as TransformNode,
                        animation: ta.animation.clone()
                    });
                }
                this.debugPlayerAnims.push({ name: "embedded", animations: embeddedAnims });
                result.animationGroups[0].dispose();
            }

            // Create master group
            this.debugPlayerMasterGroup = new AnimationGroup("debugPlayerMaster", this.scene);

            // Load external animations
            const animFiles = [
                { name: "idle", file: "rifle aiming idle.glb" },
                { name: "run", file: "rifle run.glb" },
                { name: "strafe_l", file: "strafe left.glb" },
                { name: "strafe_r", file: "strafe right.glb" },
                { name: "jump", file: "rifle jump.glb" },
                { name: "walk", file: "walking.glb" },
                { name: "reload", file: "reloading.glb" },
            ];

            for (const anim of animFiles) {
                try {
                    // CRITICAL: Stop ALL animation groups BEFORE importing
                    for (const g of this.scene!.animationGroups) {
                        g.stop();
                    }

                    const animResult = await SceneLoader.ImportAnimationsAsync(
                        "",
                        "games/default/animations/" + anim.file,
                        this.scene,
                        false
                    );

                    // CRITICAL: Stop ALL animation groups IMMEDIATELY after import
                    for (const g of this.scene!.animationGroups) {
                        g.stop();
                    }

                    if (animResult.animationGroups.length > 0) {
                        const sourceGroup = animResult.animationGroups[0];
                        const storedAnims: { target: TransformNode; animation: Animation }[] = [];

                        for (const ta of sourceGroup.targetedAnimations) {
                            const targetName = (ta.target as TransformNode).name;

                            const ourBone = targetBoneMap.get(targetName);
                            if (ourBone) {
                                const prop = ta.animation.targetProperty;

                                // Skip position animations ONLY on Hips (root motion)
                                const isHipsBone = targetName.toLowerCase().includes('hips');
                                if (prop === 'position' && isHipsBone) {
                                    continue; // Filter out root motion
                                }

                                const clonedAnim = ta.animation.clone();
                                clonedAnim.name = `${anim.name}_${ta.animation.name}`;
                                storedAnims.push({ target: ourBone, animation: clonedAnim });
                            }
                        }

                        if (storedAnims.length > 0) {
                            this.debugPlayerAnims.push({ name: anim.name, animations: storedAnims });
                            console.log(`[DebugPlayer] Loaded ${anim.name}: ${storedAnims.length} channels`);
                        } else {
                            console.warn(`[DebugPlayer] ${anim.name} has 0 channels - animation may not work!`);
                        }
                        sourceGroup.dispose();

                        // CRITICAL: Stop ALL animation groups in scene after each import
                        for (const g of this.scene!.animationGroups) {
                            g.stop();
                        }
                    }
                } catch (err) {
                    console.error(`[DebugPlayer] Error loading ${anim.file}:`, err);
                }
            }

            console.log(`[DebugPlayer] Loaded ${this.debugPlayerAnims.length} animations`);
            this.playAnimation("idle");
        } catch (error) {
            console.error("[DebugPlayer] Load error:", error);
        } finally {
            this.debugPlayerLoading = false;
        }
    }

    /**
     * Update debug player model position and animation
     */
    private updateDebugPlayer(deltaTime: number): void {
        if (!this.scene) return;

        const debugCvar = Cvar.get('cl_debugplayer');
        const debugEnabled = debugCvar !== undefined && Number(debugCvar) > 0;

        if (!debugEnabled) {
            // Hide anchor and mesh if exists
            if (this.debugPlayerAnchor) this.debugPlayerAnchor.setEnabled(false);
            if (this.debugPlayerMesh) {
                this.debugPlayerMesh.isVisible = false;
                this.debugPlayerMesh.getChildMeshes().forEach(m => m.isVisible = false);
            }
            return;
        }

        // Initialize if needed
        if (!this.debugPlayerMesh && !this.debugPlayerLoading) {
            this.initDebugPlayer();
            return;
        }

        if (!this.debugPlayerMesh || !this.debugPlayerAnchor) return;

        // Get cvars
        const offsetCvar = Cvar.get('cl_debugplayer_offset');
        const offset = offsetCvar !== undefined ? Number(offsetCvar) : 100;
        const scaleCvar = Cvar.get('cl_debugplayer_scale');
        const scale = scaleCvar !== undefined ? Number(scaleCvar) : 36;

        // Position the ANCHOR using stable physics coordinates
        const yaw = this.controller.getRotation().y;
        const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

        // Calculate target position
        const myPos = this.controller.getPlayerPosition();
        const targetPos = new Vector3(myPos.x, myPos.y, myPos.z);
        targetPos.addInPlace(forward.scale(offset));

        const CONST_PLAYER_MINS_Z = -24;
        targetPos.y = myPos.y + CONST_PLAYER_MINS_Z;

        // Smooth position
        const velocity = this.controller.getVelocity();
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        const positionSmoothFactor = speed > 10 ? 0.3 : 0.1;

        this.debugPlayerSmoothedPos.x += (targetPos.x - this.debugPlayerSmoothedPos.x) * positionSmoothFactor;
        this.debugPlayerSmoothedPos.y += (targetPos.y - this.debugPlayerSmoothedPos.y) * positionSmoothFactor;
        this.debugPlayerSmoothedPos.z += (targetPos.z - this.debugPlayerSmoothedPos.z) * positionSmoothFactor;

        // Smooth rotation
        let yawDelta = yaw - this.debugPlayerSmoothedYaw;
        while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
        while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
        this.debugPlayerSmoothedYaw += yawDelta * 0.15;

        // Set anchor position and rotation
        this.debugPlayerAnchor.position.copyFrom(this.debugPlayerSmoothedPos);
        if (this.debugPlayerAnchor.rotationQuaternion) {
            this.debugPlayerAnchor.rotationQuaternion = null;
        }
        this.debugPlayerAnchor.rotation.set(0, this.debugPlayerSmoothedYaw, 0);
        this.debugPlayerAnchor.setEnabled(true);

        // Force positions to zero
        this.debugPlayerMesh.position.set(0, 0, 0);
        for (const child of this.debugPlayerMesh.getChildTransformNodes(true)) {
            const name = child.name.toLowerCase();
            if (name.includes("armature") || name.includes("root") || name.includes("hips")) {
                child.position.set(0, 0, 0);
            }
        }

        // Apply scale
        this.debugPlayerMesh.scaling.set(scale, scale, scale);

        // Clear rotation
        if (this.debugPlayerMesh.rotationQuaternion) {
            this.debugPlayerMesh.rotationQuaternion = null;
        }
        this.debugPlayerMesh.rotation.set(0, 0, 0);

        // Make visible
        this.debugPlayerMesh.isVisible = true;
        this.debugPlayerMesh.getChildMeshes().forEach(m => m.isVisible = true);

        // Determine animation from movement state
        const derivedAnim = this.deriveAnimationState();

        if (derivedAnim !== this.debugPlayerCurrentAnim) {
            console.log(`[DebugPlayer] Switching to: ${derivedAnim} (speed: ${speed.toFixed(1)})`);
            this.playAnimation(derivedAnim);
        }

        // Anim speed scaling
        if (this.debugPlayerMasterGroup) {
            const walkNaturalCvar = Cvar.get('cl_debugplayer_walk_speed');
            const runNaturalCvar = Cvar.get('cl_debugplayer_run_speed');
            const WALK_NATURAL_SPEED = walkNaturalCvar !== undefined ? Number(walkNaturalCvar) : 50;
            const RUN_NATURAL_SPEED = runNaturalCvar !== undefined ? Number(runNaturalCvar) : 400;

            let naturalSpeed = WALK_NATURAL_SPEED;
            if (this.debugPlayerCurrentAnim === 'run') {
                naturalSpeed = RUN_NATURAL_SPEED;
            } else if (this.debugPlayerCurrentAnim === 'walk') {
                naturalSpeed = WALK_NATURAL_SPEED;
            }

            const velocityDir = new Vector3(velocity.x, 0, velocity.z);
            const forwardDot = Vector3.Dot(forward, velocityDir);
            const isMovingBackwards = forwardDot < 0;

            let speedRatio = speed / naturalSpeed;
            if (isMovingBackwards) speedRatio = -speedRatio;

            const clampedRatio = Math.max(-3.0, Math.min(3.0, speedRatio));

            if (this.debugPlayerCurrentAnim === 'walk' || this.debugPlayerCurrentAnim === 'run') {
                this.debugPlayerMasterGroup.speedRatio = clampedRatio;
            } else {
                this.debugPlayerMasterGroup.speedRatio = 1.0;
            }
        }
    }

    private deriveAnimationState(): string {
        // Replicate getDebugPlayerAnimationFromState logic
        // Requires exposing state from controller

        // Public properties on FPSController needed:
        // - isSliding
        // - getWallJumpState()
        // - isPlayerGrounded()
        // - getVelocity()
        // - mouseRotationY? (already have via getRotation)

        if (this.controller.isSliding) return "walk"; // Fallback

        // Need to check walljump state... FPSController has `getWallJumpState()` which returns complex object
        // But internal property `wallJumpState` is what we checked.
        // Access via public getter or add one.
        const wj = this.controller.getWallJumpState();
        if (wj.state !== 'none') return "jump";

        const velocity = this.controller.getVelocity();

        if (!this.controller.isPlayerGrounded() && velocity.y > 50) return "jump";

        const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

        if (speed > 50) {
            const rotation = this.controller.getRotation();
            const forward = new Vector3(Math.sin(rotation.y), 0, Math.cos(rotation.y));
            const right = new Vector3(forward.z, 0, -forward.x);

            const forwardDot = forward.x * velocity.x + forward.z * velocity.z;
            const rightDot = right.x * velocity.x + right.z * velocity.z;

            if (Math.abs(rightDot) > Math.abs(forwardDot) * 1.5) {
                return rightDot > 0 ? "strafe_r" : "strafe_l";
            }

            return speed > 300 ? "run" : "walk";
        }

        return "idle";
    }

    private playAnimation(name: string): void {
        if (!this.debugPlayerMasterGroup || !this.scene) return;

        const animData = this.debugPlayerAnims.find(a => a.name === name);
        if (!animData) return;

        // Stop current master
        this.debugPlayerMasterGroup.stop();
        this.debugPlayerMasterGroup.dispose();

        // Create new master
        this.debugPlayerMasterGroup = new AnimationGroup("debugPlayerMaster", this.scene);

        for (const item of animData.animations) {
            if (item.target) {
                this.debugPlayerMasterGroup.addTargetedAnimation(item.animation, item.target);
            }
        }

        this.debugPlayerMasterGroup.play(true);
        this.debugPlayerCurrentAnim = name;
    }

    /**
     * Clean up resources
     */
    private disposeDebugPlayer(): void {
        if (this.debugPlayerMesh) {
            this.debugPlayerMesh.dispose();
            this.debugPlayerMesh = null;
        }
        if (this.debugPlayerSkeleton) {
            this.debugPlayerSkeleton.dispose();
            this.debugPlayerSkeleton = null;
        }
        if (this.debugPlayerMasterGroup) {
            this.debugPlayerMasterGroup.dispose();
            this.debugPlayerMasterGroup = null;
        }
        if (this.debugPlayerAnchor) {
            this.debugPlayerAnchor.dispose();
            this.debugPlayerAnchor = null;
        }
        this.debugPlayerAnims = [];
    }
}
