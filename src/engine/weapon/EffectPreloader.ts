/**
 * EffectPreloader — Warm up Babylon shader programs for visual effects
 *
 * Problem: The first time a StandardMaterial with a specific config
 * (emissive, alpha, disableLighting, lightmap, dynamic lights, etc.) is used,
 * the renderer must compile the corresponding shader program. This takes a frame or
 * two, causing visible flicker on the first projectile, explosion, or impact.
 *
 * Solution: During map load (while the loading screen is still visible),
 * create tiny off-screen meshes with every material permutation used by
 * the effect systems AND the BSP rendering pipeline. Explicitly compile their
 * materials, then dispose the fixtures. Matching configurations can reuse the
 * cached effects on either backend.
 *
 * Critical shader variants pre-compiled:
 * - StandardMaterial + lightmapTexture + useLightmapAsShadowmap (BSP surfaces)
 * - Above + PointLight (BSP surfaces lit by projectiles/explosions)
 * - StandardMaterial + emissive + alpha (trail ribbons)
 * - StandardMaterial + emissive + various mesh types (impacts, shockwaves)
 */

import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { prepareMaterial, sceneGpuReady, waitForGpuCondition } from "../loader/map/GpuPreparation";

interface Disposable {
  dispose: () => void;
}

/** Longest wait for a rendered frame. A stopped render loop draws nothing that could still need a retired light. */
const RETIRE_FRAME_TIMEOUT_MS = 250;

/** The next rendered frame, or the timeout; the observer is removed either way. */
function nextRenderedFrame(scene: Scene, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      scene.onAfterRenderObservable.remove(observer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, RETIRE_FRAME_TIMEOUT_MS);
    const observer = scene.onAfterRenderObservable.addOnce(finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/**
 * Dispose a temporary compile light only once nothing on the GPU still uses it.
 *
 * Disposing destroys the light's uniform buffer at once. A draw already
 * recorded with that buffer but not yet submitted then fails WebGPU validation
 * ("used in submit while destroyed") and the frame is lost. Disabled first, the
 * materials rebuild without the light while its buffer still exists. It is
 * disposed after two rendered frames and the GPU's queue has drained.
 */
export async function retireTemporaryLight(scene: Scene, light: PointLight): Promise<void> {
  light.setEnabled(false);
  // A frozen material ignores the light change and would keep binding this
  // light's buffer after it is destroyed; force those to rebuild as well.
  for (const material of scene.materials) {
    if (material.isFrozen) material.markDirty(true);
  }
  let gpuOwnsRetirement = false;
  try {
    await nextRenderedFrame(scene);
    await nextRenderedFrame(scene);
    const engine = scene.getEngine() as {
      isWebGPU?: boolean;
      _device?: { queue: { onSubmittedWorkDone(): Promise<void> } };
    };
    if (engine.isWebGPU && engine._device) {
      // A stalled queue must not hold startup, nor may we destroy an in-flight buffer.
      const submitted = engine._device.queue.onSubmittedWorkDone();
      gpuOwnsRetirement = true;
      let retired = false;
      const completion = submitted.then(
        () => {
          if (!light.isDisposed()) light.dispose();
          retired = true;
        },
        () => {
          if (!light.isDisposed()) light.dispose();
          retired = true;
        },
      );
      await Promise.race([
        completion,
        waitForGpuCondition(scene, () => retired, "retiring compile light", undefined, 1000, false).catch(() => {}),
      ]);
    }
  } finally {
    if (!gpuOwnsRetirement) light.dispose();
  }
}

/**
 * Pre-compile all effect shader permutations so they're cached before gameplay.
 * Call this during map load, after lightmaps are applied but BEFORE
 * scene.whenReadyAsync() so the compiled shaders are included in readiness check.
 *
 * Resolves after explicit compilation and the scene-material settling frames.
 * A shader compilation failure rejects; this is not a GPU validation/readback test.
 */
export async function preloadEffectShaders(scene: Scene, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
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
      dummyLightmapData,
      1,
      1,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    dummyLightmap.name = "_warmup_lightmap";
    warmupDisposables.push(dummyLightmap);

    // Variant A: lightmap WITHOUT dynamic PointLight
    const matA = new StandardMaterial("_warmup_bsp_nolight", scene);
    matA.diffuseColor = new Color3(1, 1, 1);
    matA.lightmapTexture = dummyLightmap;
    matA.lightmapTexture.coordinatesIndex = 1;
    matA.lightmapTexture.level = 2.0;
    matA.useLightmapAsShadowmap = true;
    applySafeMaxSimultaneousLights(matA);
    matA.emissiveColor = new Color3(0, 0, 0);
    warmupDisposables.push(matA);

    const meshA = MeshBuilder.CreatePlane("_warmup_bsp_a", { size: 0.01 }, scene);
    meshA.position = offscreen;
    meshA.material = matA;
    meshA.isPickable = false;
    warmupMeshes.push(meshA);

    // Variant B: lightmap WITH dynamic PointLight (the first-shot flicker fix)
    const matB = new StandardMaterial("_warmup_bsp_light", scene);
    matB.diffuseColor = new Color3(1, 1, 1);
    matB.lightmapTexture = dummyLightmap;
    matB.lightmapTexture.coordinatesIndex = 1;
    matB.lightmapTexture.level = 2.0;
    matB.useLightmapAsShadowmap = true;
    applySafeMaxSimultaneousLights(matB);
    matB.emissiveColor = new Color3(0, 0, 0);
    warmupDisposables.push(matB);

    const meshB = MeshBuilder.CreatePlane("_warmup_bsp_b", { size: 0.01 }, scene);
    meshB.position = offscreen;
    meshB.material = matB;
    meshB.isPickable = false;
    warmupMeshes.push(meshB);

    // Add a warm-up PointLight near meshB to force "material + light" shader compilation
    const warmupLight = new PointLight("_warmup_pointlight", offscreen.clone(), scene);
    warmupLight.diffuse = new Color3(1, 0.8, 0.3);
    warmupLight.intensity = 1;
    warmupLight.range = 10;
    // Range alone does not exclude a light from a mesh's shader defines.
    // Only variant B should include this temporary light.
    warmupLight.includedOnlyMeshes = [meshB];
    warmupDisposables.push(warmupLight);
  }

  // ─── Effect material variants ──────────────────────────────────────

  // 1. Trail ribbon (emissive + alpha + disableLighting + doubleside)
  {
    const mat = new StandardMaterial("_warmup_trail", scene);
    mat.emissiveColor = new Color3(0.3, 0.5, 1.0);
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.6;
    warmupDisposables.push(mat);

    const p1 = [offscreen, offscreen.add(new Vector3(1, 0, 0))];
    const p2 = [offscreen.add(new Vector3(0, 1, 0)), offscreen.add(new Vector3(1, 1, 0))];
    const mesh = MeshBuilder.CreateRibbon(
      "_warmup_ribbon",
      {
        pathArray: [p1, p2],
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene,
    );
    mesh.material = mat;
    mesh.isPickable = false;
    warmupMeshes.push(mesh);
  }

  // 2. Impact glow (emissive sphere)
  {
    const mat = new StandardMaterial("_warmup_impact", scene);
    mat.emissiveColor = new Color3(1, 0.8, 0.3);
    mat.diffuseColor = Color3.Black();
    mat.alpha = 1.0;
    mat.disableLighting = true;
    warmupDisposables.push(mat);

    const mesh = MeshBuilder.CreateSphere(
      "_warmup_sphere",
      {
        diameter: 0.01,
      },
      scene,
    );
    mesh.position = offscreen;
    mesh.material = mat;
    mesh.isPickable = false;
    warmupMeshes.push(mesh);
  }

  devLog(
    `[EffectPreloader] Warming up ${warmupMeshes.length} shader permutations (incl. lightmap + PointLight variants)...`,
  );

  // Off-screen fixtures may be culled. A rendered frame does not prove their
  // effects compiled; request each fixture's effect explicitly on both backends.
  try {
    // Sequential fixtures also ensure cleanup cannot dispose another fixture
    // while Babylon is still polling its compilation after an earlier failure.
    for (const mesh of warmupMeshes) await prepareMaterial(mesh.material!, mesh, signal);
    devLog(`[EffectPreloader] Shader warm-up complete — ${warmupMeshes.length} permutations compiled`);
  } finally {
    for (const mesh of warmupMeshes) mesh.dispose();
    for (const item of warmupDisposables) item.dispose();
  }

  // ─── PHASE 2: Force-compile ALL scene materials with PointLight variant ────
  // Each StandardMaterial instance needs its own "with dynamic light" shader
  // variant pre-compiled. Without this, the first PointLight (projectile,
  // explosion) entering range triggers synchronous shader recompilation →
  // visible wall flicker / disappearing geometry for 1-2 frames.
  //
  // We target ALL StandardMaterials, not just BSP — pickup models, weapon
  // models, and other geometry also need the dynamic-light variant cached.
  //
  // Let visible materials bind the temporary-light variant for one frame, then
  // retire the light (retireTemporaryLight) so no submitted draw outlives it.
  {
    // Create the effect dlight pool NOW, before force-compilation, so the
    // compiled shader variants include its 4 permanently-enabled lights.
    // The pool never toggles setEnabled (only intensity), so the light set —
    // and therefore every material's define set — is identical at runtime to
    // what gets compiled here. If the pool were created later (lazily, on the
    // first projectile), the light set would change mid-game and every
    // lightmapped material would recompile → first-shot flicker.
    const { getPointLightPool } = await import("./PointLightPool");
    getPointLightPool().init(scene);

    // Build mapping: material → first mesh that uses it (deduplicated)
    // Covers BOTH StandardMaterial (BSP/MD3) and PBRMaterial (GLB weapons)
    const matMeshMap = new Map<StandardMaterial, Mesh>();
    const pbrMatMeshMap = new Map<Material, Mesh>();
    for (const mesh of scene.meshes) {
      if (mesh.material instanceof StandardMaterial) {
        // Cap ALL StandardMaterials to prevent shader overflow from dynamic PointLights
        applySafeMaxSimultaneousLights(mesh.material);
        if (!matMeshMap.has(mesh.material)) {
          matMeshMap.set(mesh.material, mesh as Mesh);
        }
      } else if (mesh.material && mesh.material.getClassName() === "PBRMaterial") {
        applySafeMaxSimultaneousLights(mesh.material);
        if (!pbrMatMeshMap.has(mesh.material)) {
          pbrMatMeshMap.set(mesh.material, mesh as Mesh);
        }
      }
    }

    if (matMeshMap.size > 0 || pbrMatMeshMap.size > 0) {
      // Create temporary light so materials compile with the "has lights" variant
      const tmpLight = new PointLight("_warmup_bsp_light2", new Vector3(0, 0, 0), scene);
      tmpLight.intensity = 1;
      tmpLight.range = 999999; // Ensure it affects ALL materials
      tmpLight.diffuse = new Color3(1, 1, 1);

      devLog(
        `[EffectPreloader] Force-compiling ${matMeshMap.size} StandardMaterials + ${pbrMatMeshMap.size} PBRMaterials with PointLight variant...`,
      );

      try {
        await prepareSceneMaterials([...matMeshMap, ...pbrMatMeshMap], signal);
        await nextRenderedFrame(scene, signal);
      } finally {
        await retireTemporaryLight(scene, tmpLight);
      }
      devLog(
        `[EffectPreloader] Material force-compilation complete — ${matMeshMap.size + pbrMatMeshMap.size} materials`,
      );

      // Phase 3: Wait one more render frame for the "without light" variant
      // to settle. This prevents any dirty-flag cascade from the light removal
      // causing recompilation flicker during the first gameplay frame.
      await nextRenderedFrame(scene, signal);
      devLog(`[EffectPreloader] Shader settling complete`);
    }
  }
}

/**
 * Revalidate all scene materials after tab was backgrounded.
 *
 * Refresh bindings and observe material readiness after visibility resumes.
 * Context restoration belongs to the renderer; sampler changes do not restore pixels.
 * All polls are bounded and map cancellation releases their timers/observers.
 */
export async function revalidateMaterials(scene: Scene, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const startTime = performance.now();
  const engine = scene.getEngine();

  // Restore the owner's frozen state even when readiness rejects or is cancelled.
  const unfrozen: StandardMaterial[] = [];
  for (const mat of scene.materials) {
    if (mat instanceof StandardMaterial && mat.isFrozen) {
      mat.unfreeze();
      unfrozen.push(mat);
    }
  }
  const unfrozenCount = unfrozen.length;
  devLog(`[EffectPreloader] Unfroze ${unfrozenCount} materials for revalidation`);

  // 1. Reset the engine's internal texture cache — forces all textures
  //    to be re-bound to WebGL texture units on the next render pass
  engine.resetTextureCache?.();
  devLog(`[EffectPreloader] Reset engine texture cache`);

  try {
    // 3. Mark all materials as dirty to force shader re-evaluation
    const { Constants } = await import("@babylonjs/core/Engines/constants");
    scene.markAllMaterialsAsDirty(Constants.MATERIAL_AllDirtyFlag);
    devLog(`[EffectPreloader] Marked all materials dirty for revalidation`);

    // 4. Force-compile all StandardMaterials AND PBRMaterials with PointLight variant (same as Phase 2)
    const matMeshMap = new Map<StandardMaterial, Mesh>();
    const pbrMatMeshMap = new Map<Material, Mesh>();
    for (const mesh of scene.meshes) {
      if (mesh.material instanceof StandardMaterial) {
        applySafeMaxSimultaneousLights(mesh.material);
        if (!matMeshMap.has(mesh.material)) {
          matMeshMap.set(mesh.material, mesh as Mesh);
        }
      } else if (mesh.material && mesh.material.getClassName() === "PBRMaterial") {
        applySafeMaxSimultaneousLights(mesh.material);
        if (!pbrMatMeshMap.has(mesh.material)) {
          pbrMatMeshMap.set(mesh.material, mesh as Mesh);
        }
      }
    }

    if (matMeshMap.size > 0 || pbrMatMeshMap.size > 0) {
      const tmpLight = new PointLight("_revalidation_light", new Vector3(0, 0, 0), scene);
      tmpLight.intensity = 1;
      tmpLight.range = 999999;
      tmpLight.diffuse = new Color3(1, 1, 1);

      try {
        await prepareSceneMaterials([...matMeshMap, ...pbrMatMeshMap], signal);
        await nextRenderedFrame(scene, signal);
      } finally {
        await retireTemporaryLight(scene, tmpLight);
      }

      // Wait one settle frame
      await nextRenderedFrame(scene, signal);
    }

    // Observe the restored scene without leaving a global whenReadyAsync poll behind.
    await waitForGpuCondition(scene, () => sceneGpuReady(scene), "revalidating scene", signal);
  } finally {
    // 6. Re-freeze what step 0 unfroze, and nothing else. Their owners chose to
    //    freeze them and watch the light set for them (the map's world
    //    materials). A material nobody froze, such as a gib's, may meet a new
    //    light set later, and frozen it keeps a shader built for the old one:
    //    its draws then fail and it is never seen.
    let refrozenCount = 0;
    for (const mat of unfrozen) {
      if (scene.isDisposed || mat.isFrozen || !scene.materials.includes(mat)) continue;
      mat.freeze();
      refrozenCount++;
    }
    devLog(`[EffectPreloader] Re-froze ${refrozenCount} materials after revalidation`);
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  devLog(`[EffectPreloader] Material revalidation complete in ${elapsed}ms`);
}

async function prepareSceneMaterials(entries: [Material, Mesh][], signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const aborted = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", aborted, { once: true });
  if (signal?.aborted) aborted();
  try {
    await Promise.all(entries.map(([material, mesh]) => prepareMaterial(material, mesh, controller.signal)));
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", aborted);
  }
}
