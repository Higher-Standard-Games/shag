/**
 * EffectPreloader — Warm up WebGL shader programs for all visual effects
 *
 * Problem: The first time a StandardMaterial with a specific config
 * (emissive, alpha, disableLighting, etc.) is used, WebGL must compile
 * the corresponding shader program. This takes a frame or two, causing
 * visible flicker on the first projectile, explosion, or impact.
 *
 * Solution: During map load (while the loading screen is still visible),
 * create tiny off-screen meshes with every material permutation used by
 * the effect systems. Babylon renders them once → shader compiled → dispose.
 * All subsequent effect spawns use cached shaders instantly.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

/**
 * Pre-compile all effect shader permutations so they're cached before gameplay.
 * Call this during map load, after the scene is set up but before the loading
 * screen is dismissed.
 *
 * Returns a promise that resolves after one render frame (guaranteeing compilation).
 */
export async function preloadEffectShaders(scene: Scene): Promise<void> {
    const warmupMeshes: Mesh[] = [];
    const warmupMaterials: StandardMaterial[] = [];

    // Place warm-up geometry far off-screen so it's invisible
    const offscreen = new Vector3(99999, 99999, 99999);

    // ─── 1. Trail ribbon material (emissive + alpha + disableLighting + doubleside) ──
    {
        const mat = new StandardMaterial('_warmup_trail', scene);
        mat.emissiveColor = new Color3(0.3, 0.5, 1.0);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.6;

        // Ribbon needs at least 2 paths of 2 points each
        const p1 = [offscreen, offscreen.add(new Vector3(1, 0, 0))];
        const p2 = [offscreen.add(new Vector3(0, 1, 0)), offscreen.add(new Vector3(1, 1, 0))];
        const mesh = MeshBuilder.CreateRibbon('_warmup_ribbon', {
            pathArray: [p1, p2],
            sideOrientation: Mesh.DOUBLESIDE,
        }, scene);
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    // ─── 2. Explosion fireball material (emissive + alpha + backFace off) ──
    {
        const mat = new StandardMaterial('_warmup_fireball', scene);
        mat.emissiveColor = new Color3(1.0, 0.95, 0.6);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.9;

        const mesh = MeshBuilder.CreateIcoSphere('_warmup_icosphere', {
            radius: 0.01,
            subdivisions: 2,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    // ─── 3. Explosion ray material (emissive cone) ──
    {
        const mat = new StandardMaterial('_warmup_ray', scene);
        mat.emissiveColor = new Color3(1.0, 0.4, 0.05);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.alpha = 0.8;

        const mesh = MeshBuilder.CreateCylinder('_warmup_cone', {
            height: 0.01,
            diameterTop: 0,
            diameterBottom: 0.01,
            tessellation: 6,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    // ─── 4. Shockwave disc material ──
    {
        const mat = new StandardMaterial('_warmup_shockwave', scene);
        mat.emissiveColor = new Color3(1.0, 0.4, 0.05);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.7;

        const mesh = MeshBuilder.CreateDisc('_warmup_disc', {
            radius: 0.01,
            tessellation: 8,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    // ─── 5. Impact glow material (emissive sphere with alpha) ──
    {
        const mat = new StandardMaterial('_warmup_impact', scene);
        mat.emissiveColor = new Color3(1, 0.8, 0.3);
        mat.diffuseColor = Color3.Black();
        mat.alpha = 1.0;
        mat.disableLighting = true;

        const mesh = MeshBuilder.CreateSphere('_warmup_sphere', {
            diameter: 0.01,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    // ─── 6. Impact with diffuse texture + emissive (texture-based impacts) ──
    {
        const mat = new StandardMaterial('_warmup_impact_tex', scene);
        mat.emissiveColor = new Color3(1, 0.8, 0.3);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.useAlphaFromDiffuseTexture = true;

        const mesh = MeshBuilder.CreateSphere('_warmup_sphere2', {
            diameter: 0.01,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;

        warmupMeshes.push(mesh);
        warmupMaterials.push(mat);
    }

    console.log(`[EffectPreloader] Warming up ${warmupMeshes.length} effect shader permutations...`);

    // Wait for one render frame so all shaders get compiled
    await new Promise<void>((resolve) => {
        scene.onAfterRenderObservable.addOnce(() => {
            // Cleanup all warm-up geometry
            for (const mesh of warmupMeshes) {
                mesh.dispose();
            }
            for (const mat of warmupMaterials) {
                mat.dispose();
            }
            console.log(`[EffectPreloader] Shader warm-up complete — ${warmupMeshes.length} permutations compiled`);
            resolve();
        });
    });
}
