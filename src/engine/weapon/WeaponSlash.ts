/**
 * WeaponSlash — Melee slash animation offsets and trail effect
 *
 * Manages 3-phase slash animation (windup → swing → return)
 * with multiple concurrent trail ribbon instances.
 *
 * Used by WeaponViewManager.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';

// ─── Slash Animation Parameters ───────────────────────────────────────

/** Parameters for a single slash animation swing */
interface SlashParams {
    startPitch: number;
    startRoll: number;
    endPitch: number;
    endRoll: number;
    startYaw: number;
    endYaw: number;
    startOffset: { x: number; y: number; z: number };
    endOffset: { x: number; y: number; z: number };
    windupDuration: number;
    swingDuration: number;
    returnDuration: number;
}

/** Slash animation presets — cycled/randomized on each fire */
const SLASH_PRESETS: SlashParams[] = [
    // Slash 1: Big vertical down — raised high, sweeps down with lunge
    {
        startPitch: 0, startRoll: -2.0, startYaw: 0,
        endPitch: 0, endRoll: 1.4, endYaw: 0,
        startOffset: { x: 5, y: 30, z: -15 },    // raised way up, pulled back
        endOffset: { x: -5, y: -25, z: 18 },    // swept down, lunged forward hard
        windupDuration: 60,
        swingDuration: 160,
        returnDuration: 230,
    },
    // Slash 2: Diagonal upper-right to lower-left
    {
        startPitch: 0.7, startRoll: -1.8, startYaw: -0.4,
        endPitch: -0.7, endRoll: 1.2, endYaw: 0.4,
        startOffset: { x: -12, y: 28, z: -12 },
        endOffset: { x: 12, y: -22, z: 15 },
        windupDuration: 55,
        swingDuration: 165,
        returnDuration: 230,
    },
    // Slash 3: Diagonal upper-left to lower-right
    {
        startPitch: -0.7, startRoll: -1.8, startYaw: 0.4,
        endPitch: 0.7, endRoll: 1.2, endYaw: -0.4,
        startOffset: { x: 12, y: 28, z: -12 },
        endOffset: { x: -12, y: -22, z: 15 },
        windupDuration: 55,
        swingDuration: 165,
        returnDuration: 230,
    },
];

export interface SlashAnimOffsets {
    xOffset: number;
    yOffset: number;
    zOffset: number;
    pitch: number;
    yaw: number;
    roll: number;
}

// ─── Trail Instance ───────────────────────────────────────────────────

interface TrailInstance {
    tipPoints: Vector3[];
    handlePoints: Vector3[];
    mesh: Mesh | null;
    material: StandardMaterial | null;
    fadeStart: number;
    active: boolean;
}

// ─── WeaponSlash Class ────────────────────────────────────────────────

export class WeaponSlash {
    private static readonly TRAIL_FADE_MS = 800;

    // Slash animation state
    private slashActive = false;
    private slashStartTime = 0;
    private slashParams: SlashParams = SLASH_PRESETS[0];
    private slashPresetIndex = 0;

    // Trail instances
    private trails: TrailInstance[] = [];
    private trailWasActive = false;

    /** True if a slash is currently animating */
    get isActive(): boolean {
        return this.slashActive;
    }

    /** Trigger a new slash animation (cycles through presets) */
    trigger(): void {
        const preset = SLASH_PRESETS[this.slashPresetIndex % SLASH_PRESETS.length];
        this.slashPresetIndex++;
        this.slashActive = true;
        this.slashStartTime = performance.now();
        this.slashParams = preset;
    }

    /** Calculate animation offsets for current frame */
    getOffsets(): SlashAnimOffsets {
        const zero: SlashAnimOffsets = { xOffset: 0, yOffset: 0, zOffset: 0, pitch: 0, yaw: 0, roll: 0 };
        if (!this.slashActive) return zero;

        const now = performance.now();
        const elapsed = now - this.slashStartTime;
        const p = this.slashParams;
        const totalDuration = p.windupDuration + p.swingDuration + p.returnDuration;

        if (elapsed >= totalDuration) {
            this.slashActive = false;
            return zero;
        }

        let t: number;
        let fromPitch: number, fromRoll: number, fromYaw: number;
        let toPitch: number, toRoll: number, toYaw: number;
        let fromX: number, fromY: number, fromZ: number;
        let toX: number, toY: number, toZ: number;

        if (elapsed < p.windupDuration) {
            t = p.windupDuration > 0 ? elapsed / p.windupDuration : 1;
            t = t * t; // easeIn
            fromPitch = 0; fromRoll = 0; fromYaw = 0;
            toPitch = p.startPitch; toRoll = p.startRoll; toYaw = p.startYaw;
            fromX = 0; fromY = 0; fromZ = 0;
            toX = p.startOffset.x; toY = p.startOffset.y; toZ = p.startOffset.z;
        } else if (elapsed < p.windupDuration + p.swingDuration) {
            t = (elapsed - p.windupDuration) / p.swingDuration;
            t = 1 - (1 - t) * (1 - t); // easeOut
            fromPitch = p.startPitch; fromRoll = p.startRoll; fromYaw = p.startYaw;
            toPitch = p.endPitch; toRoll = p.endRoll; toYaw = p.endYaw;
            fromX = p.startOffset.x; fromY = p.startOffset.y; fromZ = p.startOffset.z;
            toX = p.endOffset.x; toY = p.endOffset.y; toZ = p.endOffset.z;
        } else {
            t = (elapsed - p.windupDuration - p.swingDuration) / p.returnDuration;
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOut
            fromPitch = p.endPitch; fromRoll = p.endRoll; fromYaw = p.endYaw;
            toPitch = 0; toRoll = 0; toYaw = 0;
            fromX = p.endOffset.x; fromY = p.endOffset.y; fromZ = p.endOffset.z;
            toX = 0; toY = 0; toZ = 0;
        }

        return {
            xOffset: fromX + (toX - fromX) * t,
            yOffset: fromY + (toY - fromY) * t,
            zOffset: fromZ + (toZ - fromZ) * t,
            pitch: fromPitch + (toPitch - fromPitch) * t,
            yaw: fromYaw + (toYaw - fromYaw) * t,
            roll: fromRoll + (toRoll - fromRoll) * t,
        };
    }

    /** Update trail effect — call each frame */
    updateTrail(scene: Scene | null, camera: FreeCamera | null): void {
        if (!scene || !camera) return;

        const now = performance.now();
        const isSlashing = this.slashActive;

        // Edge detect: new slash → create fresh trail
        if (isSlashing && !this.trailWasActive) {
            for (const trail of this.trails) {
                if (trail.active) {
                    trail.active = false;
                    trail.fadeStart = now;
                }
            }
            this.trails.push({
                tipPoints: [],
                handlePoints: [],
                mesh: null,
                material: null,
                fadeStart: 0,
                active: true,
            });
        }
        this.trailWasActive = isSlashing;

        // Collect points for active trail
        const activeTrail = this.trails.find(t => t.active);
        if (activeTrail && isSlashing) {
            const forward = camera.getDirection(Vector3.Forward());
            const up = camera.getDirection(Vector3.Up());
            const right = camera.getDirection(Vector3.Right());

            const slashOff = this.getOffsets();

            // Handle (pivot)
            const handle = camera.position.clone()
                .addInPlace(forward.scale(15))
                .addInPlace(up.scale(-4))
                .addInPlace(right.scale(2))
                .addInPlace(up.scale(slashOff.yOffset * 0.04))
                .addInPlace(right.scale(slashOff.xOffset * 0.04));

            // Tip (sweeps wide)
            const tip = camera.position.clone()
                .addInPlace(forward.scale(28))
                .addInPlace(up.scale(5))
                .addInPlace(right.scale(-2))
                .addInPlace(up.scale(slashOff.yOffset * 0.25))
                .addInPlace(right.scale(slashOff.xOffset * 0.25))
                .addInPlace(forward.scale(slashOff.zOffset * 0.1));

            activeTrail.tipPoints.push(tip);
            activeTrail.handlePoints.push(handle);

            if (activeTrail.tipPoints.length >= 2) {
                this.buildTrailMesh(scene, activeTrail);
            }
        }

        // When slash ends, start fading
        if (!isSlashing && activeTrail) {
            activeTrail.active = false;
            activeTrail.fadeStart = now;
        }

        // Update fading trails + clean up finished ones
        for (let i = this.trails.length - 1; i >= 0; i--) {
            const trail = this.trails[i];
            if (trail.active) continue;

            if (trail.fadeStart > 0) {
                const fadeProgress = (now - trail.fadeStart) / WeaponSlash.TRAIL_FADE_MS;
                if (fadeProgress >= 1.0) {
                    if (trail.mesh) trail.mesh.dispose();
                    if (trail.material) trail.material.dispose();
                    this.trails.splice(i, 1);
                } else {
                    if (trail.material) {
                        trail.material.alpha = 0.7 * (1.0 - fadeProgress);
                    }
                }
            }
        }
    }

    /** Build/rebuild ribbon mesh for a trail instance */
    private buildTrailMesh(scene: Scene, trail: TrailInstance): void {
        if (trail.tipPoints.length < 2) return;

        if (trail.mesh) {
            trail.mesh.dispose();
            trail.mesh = null;
        }

        trail.mesh = MeshBuilder.CreateRibbon('slashTrail', {
            pathArray: [trail.tipPoints, trail.handlePoints],
            updatable: false,
            sideOrientation: Mesh.DOUBLESIDE,
        }, scene);
        trail.mesh.isPickable = false;

        if (!trail.material) {
            const mat = new StandardMaterial('slashTrailMat', scene);
            mat.emissiveColor = new Color3(1.0, 0.15, 0.05);
            mat.diffuseColor = Color3.Black();
            mat.disableLighting = true;
            mat.backFaceCulling = false;
            mat.alpha = 0.7;
            trail.material = mat;
        }
        trail.material.alpha = 0.7;
        trail.mesh.material = trail.material;
    }

    /** Clean up all trails */
    dispose(): void {
        for (const trail of this.trails) {
            if (trail.mesh) trail.mesh.dispose();
            if (trail.material) trail.material.dispose();
        }
        this.trails = [];
    }
}
