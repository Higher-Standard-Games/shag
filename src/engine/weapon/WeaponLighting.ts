/**
 * WeaponLighting — BSP lightgrid illumination for first-person weapons.
 *
 * Extracted from WeaponViewManager. Samples the BSP lightgrid at the
 * camera position and smoothly applies the lighting color to weapon
 * material diffuse colors. This makes the weapon react to the map's
 * baked lighting so it looks embedded in the environment.
 */

import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { BspManager } from '../loader/bsp/BspManager';

// ── Constants ───────────────────────────────────────────────────────

const LIGHT_LERP_SPEED = 5.0;     // How fast to interpolate (higher = faster)
const LIGHT_INFLUENCE = 0.6;      // 0-1, how much lightgrid affects weapon (0.6 = 60%)

// ── Class ───────────────────────────────────────────────────────────

export class WeaponLighting {
    // Smoothed RGB (starts at white)
    private r = 1.0;
    private g = 1.0;
    private b = 1.0;

    /**
     * Sample the BSP lightgrid at camera position and smooth-apply to weapon meshes.
     *
     * @param deltaTime Frame delta (seconds)
     * @param scene     Active scene
     * @param meshes    Weapon meshes whose diffuseColor should be tinted
     */
    update(deltaTime: number, scene: Scene, meshes: AbstractMesh[]): void {
        try {
            const cameras = scene.activeCameras;
            if (!cameras || cameras.length === 0) return;

            const worldPos = cameras[0].globalPosition;
            const lighting = BspManager.getInstance().getLightingAt(worldPos);

            // Calculate target brightness from lightgrid
            let targetR = 1.0, targetG = 1.0, targetB = 1.0;

            if (lighting) {
                const rawR = (lighting.ambient[0] + lighting.directional[0]) / 255;
                const rawG = (lighting.ambient[1] + lighting.directional[1]) / 255;
                const rawB = (lighting.ambient[2] + lighting.directional[2]) / 255;

                const brightness = (rawR + rawG + rawB) / 3;
                const minLight = 0.15;
                const clampedBrightness = Math.min(1.0, Math.max(minLight, brightness));

                const colorScale = clampedBrightness / Math.max(0.01, brightness);
                const scaledR = Math.min(1.0, Math.max(minLight, rawR * colorScale));
                const scaledG = Math.min(1.0, Math.max(minLight, rawG * colorScale));
                const scaledB = Math.min(1.0, Math.max(minLight, rawB * colorScale));

                targetR = 1.0 * (1 - LIGHT_INFLUENCE) + scaledR * LIGHT_INFLUENCE;
                targetG = 1.0 * (1 - LIGHT_INFLUENCE) + scaledG * LIGHT_INFLUENCE;
                targetB = 1.0 * (1 - LIGHT_INFLUENCE) + scaledB * LIGHT_INFLUENCE;
            }

            // Smooth lerp toward target
            const lf = Math.min(1.0, deltaTime * LIGHT_LERP_SPEED);
            this.r += (targetR - this.r) * lf;
            this.g += (targetG - this.g) * lf;
            this.b += (targetB - this.b) * lf;

            // Apply to weapon materials
            for (const mesh of meshes) {
                const mat = mesh.material as StandardMaterial;
                if (mat?.diffuseColor) {
                    mat.diffuseColor.set(this.r, this.g, this.b);
                }
            }
        } catch {
            // BspManager not available — use default lighting
        }
    }

    /** Reset lighting to white (e.g. on weapon switch). */
    reset(): void {
        this.r = 1.0;
        this.g = 1.0;
        this.b = 1.0;
    }
}
