/**
 * EffectPreloader — Warm up WebGL shader programs for all visual effects
 *
 * Problem: The first time a StandardMaterial with a specific config
 * (emissive, alpha, disableLighting, lightmap, dynamic lights, etc.) is used,
 * WebGL must compile the corresponding shader program. This takes a frame or
 * two, causing visible flicker on the first projectile, explosion, or impact.
 *
 * Solution: During map load (while the loading screen is still visible),
 * create tiny off-screen meshes with every material permutation used by
 * the effect systems AND the BSP rendering pipeline. Babylon renders them
 * once → shader compiled → dispose. All subsequent rendering uses cached
 * shaders instantly.
 *
 * Critical shader variants pre-compiled:
 * - StandardMaterial + lightmapTexture + useLightmapAsShadowmap (BSP surfaces)
 * - Above + PointLight (BSP surfaces lit by projectiles/explosions)
 * - StandardMaterial + emissive + alpha (trail ribbons, explosions)
 * - StandardMaterial + emissive + various mesh types (impacts, shockwaves)
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PointLight } from '@babylonjs/core/Lights/pointLight';

interface Disposable {
    dispose: () => void;
}

/**
 * Pre-compile all effect shader permutations so they're cached before gameplay.
 * Call this during map load, after lightmaps are applied but BEFORE
 * scene.whenReadyAsync() so the compiled shaders are included in readiness check.
 *
 * Returns a promise that resolves after one render frame (guaranteeing compilation).
 */
export async function preloadEffectShaders(scene: Scene): Promise<void> {
    const warmupMeshes: Mesh[] = [];
    const warmupDisposables: Disposable[] = [];

    // Place warm-up geometry far off-screen so it's invisible
    const offscreen = new Vector3(99999, 99999, 99999);

    // ─── CRITICAL: BSP lightmapped material + dynamic PointLight ──────────
    // This is the #1 cause of both dark textures AND wall flicker.
    // BSP materials use: lightmapTexture + useLightmapAsShadowmap + dynamic lights
    // We must pre-compile BOTH the "no dynamic light" AND "1+ dynamic light" variants.
    {
        // Create a tiny 1x1 white dummy lightmap texture
        const dummyLightmapData = new Uint8Array([255, 255, 255, 255]); // 1 white pixel
        const dummyLightmap = RawTexture.CreateRGBATexture(
            dummyLightmapData, 1, 1, scene,
            false, false, Texture.BILINEAR_SAMPLINGMODE
        );
        dummyLightmap.name = '_warmup_lightmap';
        warmupDisposables.push(dummyLightmap);

        // Variant A: lightmap WITHOUT dynamic PointLight
        const matA = new StandardMaterial('_warmup_bsp_nolight', scene);
        matA.diffuseColor = new Color3(1, 1, 1);
        matA.lightmapTexture = dummyLightmap;
        matA.lightmapTexture.coordinatesIndex = 1;
        matA.lightmapTexture.level = 2.0;
        matA.useLightmapAsShadowmap = true;
        matA.maxSimultaneousLights = 8;
        matA.emissiveColor = new Color3(0, 0, 0);
        warmupDisposables.push(matA);

        const meshA = MeshBuilder.CreatePlane('_warmup_bsp_a', { size: 0.01 }, scene);
        meshA.position = offscreen;
        meshA.material = matA;
        meshA.isPickable = false;
        warmupMeshes.push(meshA);

        // Variant B: lightmap WITH dynamic PointLight (the first-shot flicker fix)
        const matB = new StandardMaterial('_warmup_bsp_light', scene);
        matB.diffuseColor = new Color3(1, 1, 1);
        matB.lightmapTexture = dummyLightmap;
        matB.lightmapTexture.coordinatesIndex = 1;
        matB.lightmapTexture.level = 2.0;
        matB.useLightmapAsShadowmap = true;
        matB.maxSimultaneousLights = 8;
        matB.emissiveColor = new Color3(0, 0, 0);
        warmupDisposables.push(matB);

        const meshB = MeshBuilder.CreatePlane('_warmup_bsp_b', { size: 0.01 }, scene);
        meshB.position = offscreen;
        meshB.material = matB;
        meshB.isPickable = false;
        warmupMeshes.push(meshB);

        // Add a warm-up PointLight near meshB to force "material + light" shader compilation
        const warmupLight = new PointLight('_warmup_pointlight', offscreen.clone(), scene);
        warmupLight.diffuse = new Color3(1, 0.8, 0.3);
        warmupLight.intensity = 1;
        warmupLight.range = 10;
        warmupDisposables.push(warmupLight);
    }

    // ─── Effect material variants ──────────────────────────────────────

    // 1. Trail ribbon (emissive + alpha + disableLighting + doubleside)
    {
        const mat = new StandardMaterial('_warmup_trail', scene);
        mat.emissiveColor = new Color3(0.3, 0.5, 1.0);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.6;
        warmupDisposables.push(mat);

        const p1 = [offscreen, offscreen.add(new Vector3(1, 0, 0))];
        const p2 = [offscreen.add(new Vector3(0, 1, 0)), offscreen.add(new Vector3(1, 1, 0))];
        const mesh = MeshBuilder.CreateRibbon('_warmup_ribbon', {
            pathArray: [p1, p2],
            sideOrientation: Mesh.DOUBLESIDE,
        }, scene);
        mesh.material = mat;
        mesh.isPickable = false;
        warmupMeshes.push(mesh);
    }

    // 2. Explosion fireball (emissive + alpha + backFace off)
    {
        const mat = new StandardMaterial('_warmup_fireball', scene);
        mat.emissiveColor = new Color3(1.0, 0.95, 0.6);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.9;
        warmupDisposables.push(mat);

        const mesh = MeshBuilder.CreateIcoSphere('_warmup_icosphere', {
            radius: 0.01, subdivisions: 2,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;
        warmupMeshes.push(mesh);
    }

    // 3. Explosion ray (emissive cone)
    {
        const mat = new StandardMaterial('_warmup_ray', scene);
        mat.emissiveColor = new Color3(1.0, 0.4, 0.05);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.alpha = 0.8;
        warmupDisposables.push(mat);

        const mesh = MeshBuilder.CreateCylinder('_warmup_cone', {
            height: 0.01, diameterTop: 0, diameterBottom: 0.01, tessellation: 6,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;
        warmupMeshes.push(mesh);
    }

    // 4. Shockwave disc
    {
        const mat = new StandardMaterial('_warmup_shockwave', scene);
        mat.emissiveColor = new Color3(1.0, 0.4, 0.05);
        mat.diffuseColor = Color3.Black();
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.alpha = 0.7;
        warmupDisposables.push(mat);

        const mesh = MeshBuilder.CreateDisc('_warmup_disc', {
            radius: 0.01, tessellation: 8,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;
        warmupMeshes.push(mesh);
    }

    // 5. Impact glow (emissive sphere)
    {
        const mat = new StandardMaterial('_warmup_impact', scene);
        mat.emissiveColor = new Color3(1, 0.8, 0.3);
        mat.diffuseColor = Color3.Black();
        mat.alpha = 1.0;
        mat.disableLighting = true;
        warmupDisposables.push(mat);

        const mesh = MeshBuilder.CreateSphere('_warmup_sphere', {
            diameter: 0.01,
        }, scene);
        mesh.position = offscreen;
        mesh.material = mat;
        mesh.isPickable = false;
        warmupMeshes.push(mesh);
    }

    console.log(`[EffectPreloader] Warming up ${warmupMeshes.length} shader permutations (incl. lightmap + PointLight variants)...`);

    // Wait for one render frame so all dummy shaders get compiled by WebGL
    await new Promise<void>((resolve) => {
        scene.onAfterRenderObservable.addOnce(() => {
            // Cleanup all warm-up geometry, materials, textures, lights
            for (const mesh of warmupMeshes) {
                mesh.dispose();
            }
            for (const item of warmupDisposables) {
                item.dispose();
            }
            console.log(`[EffectPreloader] Shader warm-up complete — ${warmupMeshes.length} permutations compiled`);
            resolve();
        });
    });

    // ─── PHASE 2: Force-compile ALL scene materials with PointLight variant ────
    // Each StandardMaterial instance needs its own "with dynamic light" shader
    // variant pre-compiled. Without this, the first PointLight (projectile,
    // explosion) entering range triggers synchronous shader recompilation →
    // visible wall flicker / disappearing geometry for 1-2 frames.
    //
    // We target ALL StandardMaterials, not just BSP — pickup models, weapon
    // models, and other geometry also need the dynamic-light variant cached.
    //
    // CRITICAL: After compilation, we must wait one render frame BEFORE
    // disposing the PointLight. This ensures the GPU actually processes the
    // compiled shaders. Disposing immediately can cause the GPU to discard
    // the pending compilation work.
    {
        // Build mapping: material → first mesh that uses it (deduplicated)
        const matMeshMap = new Map<StandardMaterial, Mesh>();
        for (const mesh of scene.meshes) {
            if (mesh.material instanceof StandardMaterial) {
                if (!matMeshMap.has(mesh.material)) {
                    matMeshMap.set(mesh.material, mesh as Mesh);
                }
            }
        }

        if (matMeshMap.size > 0) {
            // Create temporary light so materials compile with the "has lights" variant
            const tmpLight = new PointLight('_warmup_bsp_light2', new Vector3(0, 0, 0), scene);
            tmpLight.intensity = 1;
            tmpLight.range = 999999; // Ensure it affects ALL materials
            tmpLight.diffuse = new Color3(1, 1, 1);

            console.log(`[EffectPreloader] Force-compiling ${matMeshMap.size} scene materials with PointLight variant...`);

            // Force-compile all materials with the light active, using their actual meshes
            const compilations: Promise<void>[] = [];
            for (const [mat, mesh] of matMeshMap) {
                compilations.push(new Promise<void>((resolve) => {
                    mat.forceCompilation(mesh, () => resolve(), { clipPlane: false });
                }));
            }

            await Promise.all(compilations);

            // Wait one render frame WITH the light still active so the GPU
            // fully processes all compiled shaders before we remove the light
            await new Promise<void>((resolve) => {
                scene.onAfterRenderObservable.addOnce(() => resolve());
            });

            // Dispose temporary light
            tmpLight.dispose();
            console.log(`[EffectPreloader] Material force-compilation complete — ${matMeshMap.size} materials`);

            // Phase 3: Wait one more render frame for the "without light" variant
            // to settle. This prevents any dirty-flag cascade from the light removal
            // causing recompilation flicker during the first gameplay frame.
            await new Promise<void>((resolve) => {
                scene.onAfterRenderObservable.addOnce(() => resolve());
            });
            console.log(`[EffectPreloader] Shader settling complete`);
        }
    }
}

/**
 * Revalidate all scene materials after tab was backgrounded.
 *
 * When the browser tab is hidden during map loading, WebGL texture uploads
 * and shader compilations silently fail. This function forces:
 * 0. Unfreeze all materials — frozen materials have stale texture bindings
 * 1. Engine texture cache reset — forces all textures to re-bind on next render
 * 2. All textures to re-upload to GPU via updateSamplingMode()
 * 3. All materials marked dirty — forces shader re-evaluation
 * 4. All StandardMaterials force-compiled with PointLight variant
 * 5. Scene whenReadyAsync — final GPU readiness gate
 * 6. Re-freeze non-lightmapped materials (matches MapLoader freeze logic)
 *
 * Called by MapLoader when it detects the tab was backgrounded during load.
 */
export async function revalidateMaterials(scene: Scene): Promise<void> {
    const startTime = performance.now();
    const engine = scene.getEngine();

    // 0. CRITICAL: Unfreeze ALL materials first.
    //    Materials frozen during a backgrounded load have stale/empty texture
    //    handles baked into them. Unfreezing allows them to pick up the
    //    re-uploaded textures during recompilation.
    let unfrozenCount = 0;
    for (const mat of scene.materials) {
        if (mat instanceof StandardMaterial && mat.isFrozen) {
            mat.unfreeze();
            unfrozenCount++;
        }
    }
    console.log(`[EffectPreloader] Unfroze ${unfrozenCount} materials for revalidation`);

    // 1. Reset the engine's internal texture cache — forces all textures
    //    to be re-bound to WebGL texture units on the next render pass
    (engine as any).resetTextureCache?.();
    console.log(`[EffectPreloader] Reset engine texture cache`);

    // 2. Force all textures to re-upload to GPU
    //    When backgrounded, texture.isReady() may return true but the
    //    actual WebGL texture handle may be empty. Calling updateSamplingMode()
    //    forces Babylon to re-bind and re-upload the texture data.
    let texCount = 0;
    for (const tex of scene.textures) {
        if (tex && tex.isReady()) {
            try {
                // Force the texture to re-initialize its WebGL sampler
                // This triggers an internal _rebuild-like path
                const sampling = tex.samplingMode;
                tex.updateSamplingMode(sampling);
                texCount++;
            } catch (_) {
                // Some texture types may not support this — skip
            }
        }
    }
    console.log(`[EffectPreloader] Forced ${texCount} textures to re-upload`);

    // 3. Mark all materials as dirty to force shader re-evaluation
    const { Constants } = await import('@babylonjs/core/Engines/constants');
    scene.markAllMaterialsAsDirty(Constants.MATERIAL_AllDirtyFlag);
    console.log(`[EffectPreloader] Marked all materials dirty for revalidation`);

    // 4. Force-compile all StandardMaterials with PointLight variant (same as Phase 2)
    const matMeshMap = new Map<StandardMaterial, Mesh>();
    for (const mesh of scene.meshes) {
        if (mesh.material instanceof StandardMaterial) {
            if (!matMeshMap.has(mesh.material)) {
                matMeshMap.set(mesh.material, mesh as Mesh);
            }
        }
    }

    if (matMeshMap.size > 0) {
        const tmpLight = new PointLight('_revalidation_light', new Vector3(0, 0, 0), scene);
        tmpLight.intensity = 1;
        tmpLight.range = 999999;
        tmpLight.diffuse = new Color3(1, 1, 1);

        const compilations: Promise<void>[] = [];
        for (const [mat, mesh] of matMeshMap) {
            compilations.push(new Promise<void>((resolve) => {
                mat.forceCompilation(mesh, () => resolve(), { clipPlane: false });
            }));
        }

        await Promise.all(compilations);

        // Wait one render frame with light active
        await new Promise<void>((resolve) => {
            scene.onAfterRenderObservable.addOnce(() => resolve());
        });

        tmpLight.dispose();

        // Wait one settle frame
        await new Promise<void>((resolve) => {
            scene.onAfterRenderObservable.addOnce(() => resolve());
        });
    }

    // 5. Wait for scene readiness (ensures all textures are GPU-uploaded)
    await scene.whenReadyAsync();

    // 6. Re-freeze non-lightmapped materials (matches MapLoader freeze logic)
    //    Lightmapped materials stay unfrozen so dynamic lights work correctly.
    let refrozenCount = 0;
    for (const mat of scene.materials) {
        if (mat instanceof StandardMaterial && !mat.isFrozen) {
            const matAny = mat as any;
            if (matAny.lightmapTexture) continue; // Skip lightmapped
            if (mat.name === 'skybox') continue;
            mat.freeze();
            refrozenCount++;
        }
    }
    console.log(`[EffectPreloader] Re-froze ${refrozenCount} materials after revalidation`);

    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`[EffectPreloader] Material revalidation complete — ${matMeshMap.size} materials, ${texCount} textures, ${unfrozenCount} unfrozen→${refrozenCount} refrozen in ${elapsed}ms`);
}

