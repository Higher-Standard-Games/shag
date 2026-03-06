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

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Animation } from '@babylonjs/core/Animations/animation';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';

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
}

/** Animation file descriptor */
export interface AnimFileConfig {
    name: string;
    file: string;
}

// ─── Default animation set ──────────────────────────────────────

export const DEFAULT_ANIM_FILES: AnimFileConfig[] = [
    { name: 'idle', file: 'rifle aiming idle.glb' },
    { name: 'run', file: 'rifle run.glb' },
    { name: 'strafe_l', file: 'strafe left.glb' },
    { name: 'strafe_r', file: 'strafe right.glb' },
    { name: 'jump', file: 'rifle jump.glb' },
    { name: 'walk', file: 'walking.glb' },
    { name: 'reload', file: 'reloading.glb' },
    { name: 'blade_slash', file: 'blade_slash.glb' },
    { name: 'slide', file: 'slide.glb' },
    { name: 'crouch_walk', file: 'crouch_walk_forward.glb' },
    { name: 'crouch_walk_back', file: 'crouch_walk_backward.glb' },
    { name: 'crouch_strafe_l', file: 'crouch_walk_left.glb' },
    { name: 'crouch_strafe_r', file: 'crouch_walk_right.glb' },
];

// ─── Manager ─────────────────────────────────────────────────────

export class PlayerModelManager {
    private scene: Scene;

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
    get isLoaded(): boolean { return this.loaded; }

    // ── Loading ──────────────────────────────────────────────────

    /**
     * Load the player model and all animation files.
     * Idempotent — calling multiple times is safe; only loads once.
     */
    async loadModel(
        modelPath: string = '/games/default/animations/',
        modelFile: string = 'vanguard.glb',
        animFiles: AnimFileConfig[] = DEFAULT_ANIM_FILES,
    ): Promise<void> {
        if (this.loading || this.loaded) return;
        this.loading = true;

        console.log('[PlayerModelManager] Loading source model...');

        try {
            const result = await SceneLoader.ImportMeshAsync(
                '', modelPath, modelFile, this.scene,
            );

            if (result.meshes.length === 0) {
                console.error('[PlayerModelManager] No meshes in model');
                return;
            }

            this.sourceMesh = result.meshes[0] as Mesh;
            this.sourceSkeleton = result.skeletons[0] || null;

            // Hide source — used only for cloning
            this.sourceMesh.isVisible = false;
            this.sourceMesh.getChildMeshes().forEach(m => m.isVisible = false);

            // Stop embedded anims immediately
            result.animationGroups.forEach(g => g.stop());

            // Build bone map
            if (this.sourceSkeleton) {
                for (const bone of this.sourceSkeleton.bones) {
                    const node = bone.getTransformNode();
                    if (node) this.sourceBoneMap.set(bone.name, node);
                }
            }

            // Store embedded animation (with root-motion filtering)
            if (result.animationGroups.length > 0) {
                const embedded = this.extractAnimChannels(
                    result.animationGroups[0], this.sourceBoneMap,
                );
                if (embedded.length > 0) {
                    this.sourceAnims.push({ name: 'embedded', animations: embedded });
                }
                result.animationGroups[0].dispose();
            }

            // CRITICAL: Clear ALL direct .animations on every node in the source.
            // Babylon's scene animation system evaluates these independently of
            // AnimationGroups. mesh.clone() copies them, causing root-motion drift
            // on clones. Our AnimationGroups hold their own references and are
            // unaffected by this clear.
            this.sourceMesh.animations = [];
            for (const node of this.sourceMesh.getChildTransformNodes(true)) {
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

                    const animResult = await SceneLoader.ImportAnimationsAsync(
                        '', modelPath + anim.file, this.scene, false,
                    );

                    // CRITICAL: Stop ALL animation groups IMMEDIATELY after import
                    for (const g of this.scene.animationGroups) g.stop();

                    if (animResult.animationGroups.length > 0) {
                        const sourceGroup = animResult.animationGroups[0];
                        const channels = this.extractAnimChannels(
                            sourceGroup, this.sourceBoneMap,
                        );
                        if (channels.length > 0) {
                            this.sourceAnims.push({ name: anim.name, animations: channels });
                            console.log(`[PlayerModelManager] Loaded ${anim.name}: ${channels.length} channels`);
                        } else {
                            console.warn(`[PlayerModelManager] ${anim.name} has 0 channels`);
                        }
                        sourceGroup.dispose();

                        // Stop again after dispose
                        for (const g of this.scene.animationGroups) g.stop();

                        // CRITICAL: Clear any .animations injected onto source bones by the import.
                        // Without this, FBX-converted GLBs (like blade_slash) can leave auto-playing
                        // animation data on skeleton nodes, causing exaggerated idle on clones.
                        if (this.sourceMesh) {
                            this.sourceMesh.animations = [];
                            for (const node of this.sourceMesh.getChildTransformNodes(true)) {
                                node.animations = [];
                            }
                            for (const child of this.sourceMesh.getChildMeshes()) {
                                child.animations = [];
                            }
                        }
                        if (this.sourceSkeleton) {
                            for (const bone of this.sourceSkeleton.bones) {
                                const node = bone.getTransformNode();
                                if (node) node.animations = [];
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[PlayerModelManager] Failed to load ${anim.file}:`, err);
                }
            }

            // FINAL CLEANUP: After all animations loaded, aggressively clear any
            // residual .animations left on nodes by FBX-converted GLB imports.
            // This prevents the scene's animation system from auto-playing stray data.
            for (const g of this.scene.animationGroups) g.stop();
            if (this.sourceMesh) {
                this.sourceMesh.animations = [];
                for (const node of this.sourceMesh.getChildTransformNodes(true)) {
                    node.animations = [];
                }
                for (const child of this.sourceMesh.getChildMeshes()) {
                    child.animations = [];
                }
            }
            if (this.sourceSkeleton) {
                for (const bone of this.sourceSkeleton.bones) {
                    const node = bone.getTransformNode();
                    if (node) node.animations = [];
                }
            }

            console.log(`[PlayerModelManager] Ready: ${this.sourceAnims.length} animations`);
            this.loaded = true;
        } catch (err) {
            console.error('[PlayerModelManager] Load error:', err);
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
        console.log(`[PlayerModelManager] createInstance called for ${id}. sourceMesh=${!!this.sourceMesh}, sourceSkeleton=${!!this.sourceSkeleton}`);
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

        // Visible
        clonedMesh.isVisible = true;
        clonedMesh.getChildMeshes().forEach(m => m.isVisible = true);

        // CRITICAL: Clear ALL .animations on cloned nodes.
        // mesh.clone() / skeleton.clone() copies residual .animations arrays
        // from source nodes. Babylon's scene animation system auto-evaluates
        // these independently of our AnimationGroups, causing root-motion drift
        // (model slides away from hitbox). Our AnimationGroups hold their own
        // channel references and are NOT affected by this clear.
        clonedMesh.animations = [];
        for (const node of clonedMesh.getChildTransformNodes(true)) {
            node.animations = [];
        }
        for (const child of clonedMesh.getChildMeshes()) {
            child.animations = [];
        }
        for (const bone of clonedSkeleton.bones) {
            const node = bone.getTransformNode();
            if (node) node.animations = [];
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

        const instance: PlayerModelInstance = {
            id,
            anchor,
            mesh: clonedMesh,
            skeleton: clonedSkeleton,
            anims: clonedAnims,
            masterGroup: null,
            currentAnim: '',
        };

        console.log(`[PlayerModelManager] Created instance: ${id}`);
        return instance;
    }

    // ── Animation Playback ───────────────────────────────────────

    /**
     * Switch an instance to a named animation. Skips if already playing.
     * @returns true if animation was changed
     */
    playAnimation(instance: PlayerModelInstance, name: string): boolean {
        if (instance.currentAnim === name) return false;

        const animData = instance.anims.find(a => a.name === name);
        if (!animData) return false;

        // Tear down old
        if (instance.masterGroup) {
            instance.masterGroup.stop();
            instance.masterGroup.dispose();
        }

        // Build new
        instance.masterGroup = new AnimationGroup(
            `anim_${instance.id}_${name}`, this.scene,
        );
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
        const animData = instance.anims.find(a => a.name === name);
        if (!animData || animData.animations.length === 0) return false;

        // Create overlay animation group (separate from masterGroup)
        const group = new AnimationGroup(
            `anim_${instance.id}_${name}_overlay`, this.scene,
        );
        for (const item of animData.animations) {
            if (item.target) {
                group.addTargetedAnimation(item.animation, item.target);
            }
        }

        // Apply speed ratio (higher = faster animation)
        group.speedRatio = speedRatio;

        // Play once (loop = false), auto-dispose when complete
        group.play(false);

        group.onAnimationEndObservable.addOnce(() => {
            group.stop();
            group.dispose();
        });

        return true;
    }

    // ── Team Colors ─────────────────────────────────────────────

    /** Predefined team colors (match UI palette) */
    static readonly TEAM_COLORS = {
        alpha: { r: 0.05, g: 0.9, b: 1.5 },   // Teal/cyan — blue-biased to counteract warm base texture
        bravo: { r: 1.4, g: 0.2, b: 1.2 },    // Neon hot pink (HDR for vivid pop)
    };

    /**
     * Apply a team color tint to a player model instance.
     * Clones all PBR materials on the mesh and sets albedoColor to the team color.
     * The albedoColor multiplies the albedoTexture — light armor takes the tint,
     * dark undersuit/visor areas remain dark.
     *
     * @param instance The player model instance to tint
     * @param team 'alpha' (teal) or 'bravo' (magenta), or null to reset
     */
    applyTeamColor(instance: PlayerModelInstance, team: 'alpha' | 'bravo' | null): void {
        const allMeshes = [instance.mesh, ...instance.mesh.getChildMeshes()];

        for (const mesh of allMeshes) {
            if (!mesh.material) continue;

            // Clone material so each instance has its own
            const mat = mesh.material;
            const cloneName = `teamMat_${instance.id}_${mesh.name}`;

            // Avoid re-cloning if already team-colored
            if (mat.name === cloneName) {
                // Already cloned — just update the color
                const pbrMat = mat as any;
                if (team && pbrMat.albedoColor) {
                    const c = PlayerModelManager.TEAM_COLORS[team];
                    pbrMat.albedoColor.r = c.r;
                    pbrMat.albedoColor.g = c.g;
                    pbrMat.albedoColor.b = c.b;
                } else if (!team && pbrMat.albedoColor) {
                    // Reset to white (no tint)
                    pbrMat.albedoColor.r = 1;
                    pbrMat.albedoColor.g = 1;
                    pbrMat.albedoColor.b = 1;
                }
                continue;
            }

            // Clone the material
            const cloned = mat.clone(cloneName);
            if (!cloned) continue;
            mesh.material = cloned;

            // Apply team color
            const pbrCloned = cloned as any;
            if (team && pbrCloned.albedoColor) {
                const c = PlayerModelManager.TEAM_COLORS[team];
                pbrCloned.albedoColor.r = c.r;
                pbrCloned.albedoColor.g = c.g;
                pbrCloned.albedoColor.b = c.b;
            }
        }

        console.log(`[PlayerModelManager] Applied team color: ${team ?? 'none'} to ${instance.id}`);
    }

    // ── Per-Frame Utilities ──────────────────────────────────────

    /**
     * Zero out root-motion bone positions each frame.
     * Call this every frame to prevent animation drift.
     */
    resetRootMotion(instance: PlayerModelInstance): void {
        instance.mesh.position.set(0, 0, 0);
        for (const child of instance.mesh.getChildTransformNodes(true)) {
            const name = child.name.toLowerCase();
            if (name.includes('armature') || name.includes('root') || name.includes('hips')) {
                child.position.set(0, 0, 0);
            }
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────

    /** Dispose a single instance */
    disposeInstance(instance: PlayerModelInstance): void {
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

            // Skip root motion on any root-level bone (Hips, Armature, Root, RootNode)
            const nameLower = targetName.toLowerCase();
            const isRootBone = nameLower.includes('hips') ||
                nameLower.includes('armature') ||
                nameLower.includes('rootnode') ||
                nameLower === 'root' ||
                nameLower.includes('mixamorig:hips');
            if (prop === 'position' && isRootBone) {
                console.log(`[PlayerModelManager] Filtering root motion: ${targetName}.${prop}`);
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
