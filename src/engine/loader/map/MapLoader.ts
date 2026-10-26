/**
 * MapLoader - Unified map loading for both local .map files and PK3 BSPs
 *
 * Automatically detects map type and handles:
 * - Local .map files (development)
 * - BSP maps from PK3 archives (Quake3/Warsow)
 *
 * For BSP maps, automatically resolves and loads dependencies:
 * - Required texture PK3s
 * - Shader definitions
 * - Skybox textures
 */

import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import weaponModelRecipe from "../../../../config/weapon-models.json";
import { EntityRegistry } from "../../../shared/entities/EntityRegistry";
import { EntityType } from "../../../shared/entities/EntityType";
import { devLog } from "../../core/DevLog";
import { type EntityData, EntityHandlerRegistry } from "../../core/EntityHandlerRegistry";
import { EventBus } from "../../core/EventBus";
import { createLoadingOperationId, LOADING_EVENTS, type LoadingProgressEvent } from "../../core/LoadingEvents";
import { extractEmissiveSurfaces } from "../../lighting/MapEmissiveSurfaces";
import { trackFrozenWorldMaterials } from "../../rendering/FrozenWorldMaterials";
import RenderVars from "../../rendering/RenderVars";
import { parseSkyPortal, SkyPortalView } from "../../rendering/SkyPortal";
import { SkyVisibility, skyClusterBounds } from "../../rendering/SkyVisibility";
import { SurfaceCubemaps } from "../../rendering/SurfaceCubemaps";
import { WorldFogController } from "../../rendering/WorldFogController";
import { LiquidSurfaceSystem } from "../../rendering/water/LiquidSurfaceSystem";
import { waterMapLights, waterSurfaceLights } from "../../rendering/water/WaterSurfaceLighting";
import { registerBspEntityHandlers, setCurrentBspForHandlers } from "../bsp/BspEntityHandlers";
import { type BspFile, BspLoader } from "../bsp/BspLoader";
import { BspMeshBuilder, type BspMeshBuildResult } from "../bsp/BspMeshBuilder";
import { parseWorldFog } from "../bsp/WorldFog";
import { PK3Index } from "../pk3/PK3Index";
import { PK3Loader } from "../pk3/PK3Loader";
import type { PK3PackageScope } from "../pk3/PK3PackageScope";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import { shaderSourceBlocks } from "../shader/ShaderSourceBlocks";
import { PACKAGED_TEXTURE_EXTENSION, stripTextureExtension } from "../texture/TextureExtensions";
import { getGameMapEntities } from "./GameMapEntities";
import { sceneGpuReady, waitForGpuCondition } from "./GpuPreparation";
import { waitForMapAsset, waitForMapVisibility } from "./MapLoadWait";

/**
 * Entities the client draws or plays nothing for: map markers that only the
 * server or other entities read, and triggers the client takes from the
 * collision world. Anything else without a handler is reported once per map.
 */
const NEEDS_NO_CLIENT_HANDLER = new Set([
  "worldspawn",
  "target_position",
  "target_location",
  "misc_teleporter_dest",
  "trigger_teleport",
  "trigger_push",
  // Drawn by SkyPortalView, which the map loader starts after the entities
  "misc_skyportal",
  "props_skyportal",
]);

export interface MapLoadResult {
  success: boolean;
  mapName: string;
  mapType: "local" | "bsp";
  error?: string;
  /** BSP-specific results */
  bsp?: BspFile;
  meshResult?: BspMeshBuildResult;
  playerStartPosition?: Vector3;
}

export interface MapLoadProgress {
  phase: string;
  detail?: string;
  progress?: number; // 0-1
}

/** Baked-lighting gain for a Warsow-format map. */
const LIGHTMAP_INTENSITY_FBSP = 2.0;

/**
 * Baked-lighting gain for a Quake 3 format map.
 *
 * Higher than FBSP because the two toolchains bake to different targets: a Q3
 * map expects the engine to apply overbright AND a gamma ramp on top, and
 * rendering it at the Warsow gain leaves it visibly dim.
 *
 * This is a per-FORMAT bet on one map's worth of evidence. If a second IBSP map
 * disagrees, the honest conclusion is that this belongs per-map instead, and
 * `r_lightmapscale` is the escape hatch until then.
 */
const LIGHTMAP_INTENSITY_IBSP = 3.0;

/** Resolve the lightmap gain for a map, with the user's scale applied. */
export function lightmapIntensityFor(isFBSP: boolean, scale: number | undefined, authoredGain?: number): number {
  const base = isFBSP ? (authoredGain ?? LIGHTMAP_INTENSITY_FBSP) : LIGHTMAP_INTENSITY_IBSP;
  // A missing or nonsensical scale means "leave it alone" rather than "black".
  return base * (scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1);
}

export type ProgressCallback = (progress: MapLoadProgress) => void;
export interface MapLoadOptions {
  backgroundOnly?: boolean;
  signal?: AbortSignal;
  operationId?: string;
  finalizeScene?: (result: MapLoadResult) => Promise<void>;
}

/** How long a load waits for the scene to report ready before going on without it. */
const SCENE_READY_TIMEOUT_MS = 15000;

/** What is still keeping a scene from being ready, for the warning when the wait gives up. */
function describeNotReady(scene: Scene): string {
  const meshes = scene.meshes.filter((mesh) => !mesh.isReady(true)).map((mesh) => mesh.name);
  const particles = scene.particleSystems.filter((system) => !system.isReady()).map((system) => system.name);
  const textures = scene.textures.filter((texture) => !texture.isReady()).map((texture) => texture.name);
  const list = (label: string, names: string[]) =>
    names.length ? `${names.length} ${label} (${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""})` : "";
  return (
    [list("meshes", meshes), list("particle systems", particles), list("textures", textures)]
      .filter(Boolean)
      .join("; ") || "nothing reported"
  );
}

export class MapLoader {
  private static instance: MapLoader;

  private pk3Index: PK3Index;
  private pk3Loader: PK3Loader;
  private shaderRegistry: Q3ShaderRegistry;
  private renderVars: RenderVars;

  private currentMap: string | null = null;
  private currentBsp: BspFile | null = null;
  private currentMeshResult: BspMeshBuildResult | null = null;
  /** Owns the unified water materials for the loaded map; disposed with it. */
  private liquidSurfaces: LiquidSurfaceSystem | null = null;
  private surfaceCubemaps: SurfaceCubemaps | null = null;
  /** The sky portal's view while the map has one. */
  private skyPortal: SkyPortalView | null = null;

  /** True while a BSP map is being loaded */
  private isLoadingMap: boolean = false;
  /** Set to true if the tab was backgrounded during map loading */
  private wasBackgroundedDuringLoad: boolean = false;
  /** Cancels the pending check of world mesh readiness for when the loading screen closes. */
  private readinessCheck: (() => void) | null = null;
  private loadTail: Promise<void> = Promise.resolve();
  private requestedLoad: AbortController | null = null;

  private constructor() {
    this.pk3Index = PK3Index.getInstance();
    this.pk3Loader = PK3Loader.getInstance();
    this.shaderRegistry = Q3ShaderRegistry.getInstance();
    this.renderVars = RenderVars.getInstance();
    WorldFogController.getInstance().registerCvars();

    this.renderVars.onChange("r_deluxe", (value) => {
      if (!this.currentMeshResult) return;

      const enabled = value >= 0.5 ? 1 : 0;
      devLog(`[MapLoader] r_deluxe changed to ${enabled} - will apply on next BSP map reload`);
    });
    this.renderVars.onChange("r_bsp_pbr", (value) => {
      if (!this.currentMeshResult) return;

      const enabled = value >= 0.5 ? 1 : 0;
      devLog(`[MapLoader] r_bsp_pbr changed to ${enabled} - will apply on next BSP map reload`);
    });
  }

  static getInstance(): MapLoader {
    if (!MapLoader.instance) {
      MapLoader.instance = new MapLoader();
    }
    return MapLoader.instance;
  }

  /**
   * Load a map by name - auto-detects type (local .map or PK3 BSP)
   * @param opts.backgroundOnly - If true, load only geometry + textures + lightmaps.
   *   Skips collisions, entities, models, effects, shader warmup.
   *   Use for lobby/menu background maps.
   */
  async loadMap(
    mapName: string,
    scene: Scene,
    onProgress?: ProgressCallback,
    opts?: MapLoadOptions,
  ): Promise<MapLoadResult> {
    this.requestedLoad?.abort(new Error("Map load superseded"));
    const controller = new AbortController();
    const aborted = () => controller.abort(opts?.signal?.reason);
    opts?.signal?.addEventListener("abort", aborted, { once: true });
    if (opts?.signal?.aborted) aborted();
    this.requestedLoad = controller;
    const operation = this.loadTail.then(async () => {
      if (controller.signal.aborted) {
        opts?.signal?.removeEventListener("abort", aborted);
        if (this.requestedLoad === controller) this.requestedLoad = null;
        return { success: false, mapName, mapType: "bsp" as const, error: "Map load superseded" };
      }
      const observer = scene.onDisposeObservable.addOnce(() => controller.abort(new Error("Map scene disposed")));
      try {
        if (scene.isDisposed) controller.abort(new Error("Map scene disposed"));
        return await this.performLoadMap(mapName, scene, controller.signal, onProgress, opts);
      } finally {
        scene.onDisposeObservable.remove(observer);
        opts?.signal?.removeEventListener("abort", aborted);
        if (this.requestedLoad === controller) this.requestedLoad = null;
      }
    });
    this.loadTail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async performLoadMap(
    mapName: string,
    scene: Scene,
    signal: AbortSignal,
    onProgress?: ProgressCallback,
    opts?: MapLoadOptions,
  ): Promise<MapLoadResult> {
    const startTime = Date.now();
    const operationId = opts?.operationId ?? createLoadingOperationId();

    // Emit loading:start event
    EventBus.emit(LOADING_EVENTS.START, {
      type: "map",
      operationId,
      id: mapName,
      meta: { displayName: mapName },
    });

    const progress = (phase: string, detail?: string, percent?: number) => {
      signal.throwIfAborted();
      onProgress?.({ phase, detail, progress: percent });
      devLog(`[MapLoader] ${phase}${detail ? `: ${detail}` : ""}`);

      // Emit loading:progress event
      const progressEvent: LoadingProgressEvent = {
        type: "map",
        operationId,
        phase,
        detail,
        percent,
      };
      EventBus.emit(LOADING_EVENTS.PROGRESS, progressEvent);
    };

    try {
      signal.throwIfAborted();
      // Clean up previous map
      if (this.currentMeshResult) {
        progress("cleanup", "disposing previous map");
        await this.clearCurrentMap();
      }

      // Check if it's a BSP map in the index
      const bspPk3 = this.pk3Index.findMap(mapName);
      if (bspPk3) {
        const result = await this.loadBspMap(mapName, bspPk3, scene, progress, signal, opts?.backgroundOnly);
        signal.throwIfAborted();
        if (result.success && opts?.finalizeScene) {
          await opts.finalizeScene(result);
          signal.throwIfAborted();
          await waitForGpuCondition(
            scene,
            () => sceneGpuReady(scene),
            "final client scene",
            signal,
            SCENE_READY_TIMEOUT_MS,
          );
        }

        // Emit loading:complete event
        EventBus.emit(LOADING_EVENTS.COMPLETE, {
          type: "map",
          operationId,
          success: result.success,
          error: result.error,
          duration: Date.now() - startTime,
        });

        return result;
      }

      // TODO: Check for local .map file
      // For now, just report not found
      const error = `Map not found: ${mapName}. Run 'pk3 index build' if you haven't indexed PK3s yet.`;

      // Emit loading:complete event (failure)
      EventBus.emit(LOADING_EVENTS.COMPLETE, {
        type: "map",
        operationId,
        success: false,
        error,
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        mapName,
        mapType: "local",
        error,
      };
    } catch (e) {
      this.resetPackageScope();
      if (this.currentMeshResult) {
        try {
          await this.clearCurrentMap();
        } catch (cleanupError) {
          console.warn("[MapLoader] Failed to release incomplete map:", cleanupError);
        }
      }
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[MapLoader] Failed to load map ${mapName}:`, e);

      // Emit loading:complete event (failure)
      EventBus.emit(LOADING_EVENTS.COMPLETE, {
        type: "map",
        operationId,
        success: false,
        error,
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        mapName,
        mapType: "bsp",
        error,
      };
    }
  }

  /**
   * Load a BSP map from PK3 with full dependency resolution
   * @param backgroundOnly - Skip collisions, entities, models, effects (for menu background)
   */
  private async loadBspMap(
    mapName: string,
    mapPk3: string,
    scene: Scene,
    progress: (phase: string, detail?: string, pct?: number) => void,
    signal: AbortSignal,
    backgroundOnly?: boolean,
  ): Promise<MapLoadResult> {
    this.isLoadingMap = true;
    this.wasBackgroundedDuringLoad = document.hidden;
    const onVisibilityChange = () => {
      if (this.isLoadingMap && document.hidden) this.wasBackgroundedDuringLoad = true;
    };
    const cleanup = () => {
      this.isLoadingMap = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    signal.addEventListener("abort", cleanup, { once: true });
    try {
      signal.throwIfAborted();
      return await this.buildBspMap(mapName, mapPk3, scene, progress, signal, backgroundOnly);
    } finally {
      cleanup();
      signal.removeEventListener("abort", cleanup);
      this.wasBackgroundedDuringLoad = false;
    }
  }

  private async buildBspMap(
    mapName: string,
    mapPk3: string,
    scene: Scene,
    progress: (phase: string, detail?: string, pct?: number) => void,
    signal: AbortSignal,
    backgroundOnly?: boolean,
  ): Promise<MapLoadResult> {
    const deluxeEnabled = (this.renderVars.get("r_deluxe") ?? 0) >= 0.5;
    const bspPbrEnabled = (this.renderVars.get("r_bsp_pbr") ?? 0) >= 0.5;
    devLog(`[MapLoader] Deluxe shader branches: ${deluxeEnabled ? "enabled" : "disabled"} for this map load`);
    devLog(`[MapLoader] BSP PBR materials: ${bspPbrEnabled ? "enabled" : "disabled"} for this map load`);

    // Phase 1: Ensure map PK3 is loaded
    progress("Loading", `Map PK3: ${mapPk3}`);
    const mapPk3Path = this.pk3Index.getPK3Path(mapPk3);
    if (mapPk3Path) await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(mapPk3Path), signal);
    else await waitForMapAsset(this.pk3Loader.ensurePK3(mapPk3), signal);

    // Phase 2: Load BSP
    progress("Loading", "BSP data");
    const bspPath = `maps/${mapName}.bsp`;
    const bsp = await BspLoader.loadFromPK3(this.pk3Loader, bspPath);
    if (!bsp) {
      return {
        success: false,
        mapName,
        mapType: "bsp",
        error: `Failed to load BSP: ${bspPath}`,
      };
    }
    this.currentBsp = bsp;

    await this.prepareMapTextureBank(mapName, progress, signal);

    // Phase 3: Resolve and load texture dependencies
    progress("Dependencies", "Resolving required PK3s");
    const requiredPk3s = await this.resolveMapDependencies(bsp);

    let loaded = 0;
    await Promise.all(
      [...requiredPk3s].map(async (pk3) => {
        progress("Dependencies", `Loading ${pk3}`, loaded / requiredPk3s.size);
        try {
          const pk3Path = this.pk3Index.getPK3Path(pk3);
          if (pk3Path) await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(pk3Path), signal);
        } catch (e) {
          console.warn(`[MapLoader] Failed to load dependency ${pk3}:`, e);
        }
        loaded++;
      }),
    );

    // Phase 3b: Resolve entity model dependencies (weapons, ammo, items)
    // Skip for background-only loads — no gameplay entities needed
    if (!backgroundOnly) {
      progress("Dependencies", "Resolving entity model PK3s");
      getGameMapEntities()?.initializeDefinitions();
      const modelPk3s = this.resolveEntityModelDependencies(bsp);
      await Promise.all(
        [...modelPk3s].map(async (pk3) => {
          progress("Dependencies", `Loading model assets from ${pk3}`);
          try {
            const pk3Path = this.pk3Index.getPK3Path(pk3);
            if (pk3Path) await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(pk3Path), signal);
          } catch (e) {
            console.warn(`[MapLoader] Failed to load model dependency ${pk3}:`, e);
          }
        }),
      );

      const weaponPackage = weaponModelRecipe.package;
      if (this.pk3Index.getPK3Path(weaponPackage)) {
        try {
          await waitForMapAsset(this.pk3Loader.ensurePK3(weaponPackage), signal);
        } catch (e) {
          console.warn(`[MapLoader] ${weaponPackage} not loaded:`, e);
        }
      }
    }

    // Phase 4: Load shaders
    progress("Shaders", "Loading shader definitions");
    await this.shaderRegistry.loadShaders();

    // Phase 4b: Resolve sky texture dependencies (needs shaders loaded first)
    const skyPk3s = await this.resolveSkyDependencies(bsp);
    for (const pk3 of skyPk3s) {
      progress("Dependencies", `Loading sky textures from ${pk3}`);
      try {
        const pk3Path = this.pk3Index.getPK3Path(pk3);
        if (pk3Path) await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(pk3Path), signal);
      } catch (e) {
        console.warn(`[MapLoader] Failed to load sky dependency ${pk3}:`, e);
      }
    }

    // Phase 5: Build mesh
    progress("Geometry", "Building mesh");
    const meshResult = BspMeshBuilder.build(bsp, scene, {
      filterTextures: true,
      deluxe: deluxeEnabled,
      spatialCellSize: this.renderVars.get("r_bsp_cellsize") ?? 0,
    });
    this.currentMeshResult = meshResult;
    // Texture loading yields between materials. Keep incomplete materials out
    // of the render loop until fog and baked-lighting plugins own their layouts.
    meshResult.worldMesh.setEnabled(false);

    // Phase 6: Apply textures
    progress("Textures", "Loading and applying");
    await BspMeshBuilder.applyTextures(meshResult, bsp, scene, undefined, {
      deluxe: deluxeEnabled,
      pbr: bspPbrEnabled,
      signal,
    });

    // Phase 7: Apply skybox
    progress("Skybox", "Creating");
    const engine = scene.getEngine();
    const engineClass = engine?.getClassName?.();
    const engineCtorName = engine?.constructor?.name;
    const isHeadlessNullEngine = engineClass === "NullEngine" || engineCtorName === "NullEngine";
    let skyEnvironment: BaseTexture | null = null;
    if (!isHeadlessNullEngine) {
      const skyResult = await BspMeshBuilder.applySkybox(meshResult, scene);
      if (skyResult.success) {
        devLog(`[MapLoader] Skybox created (${meshResult.skyShaders.length} sky shaders)`);
        const reflectionTexture = (
          skyResult.skybox?.material as unknown as { reflectionTexture?: BaseTexture | null } | null
        )?.reflectionTexture;
        skyEnvironment = reflectionTexture?.isCube ? reflectionTexture : null;
      } else if (skyResult.error) {
        console.warn(`[MapLoader] Skybox failed: ${skyResult.error}`);
      }
    } else {
      progress("Skybox", "Skipped (NullEngine)");
    }

    // World fog from worldspawn; the sky stands at its shader's height for it
    const worldspawn = bsp.entities.find((e) => e.classname === "worldspawn");
    const skyHeight = meshResult.skyShaders.find((s) => s.skyParms)?.skyParms?.skyHeight;
    const worldFog = parseWorldFog(worldspawn?.properties ?? {});
    WorldFogController.getInstance().setMap(scene, worldFog, skyHeight);
    if (worldFog) {
      const fogDist = worldFog.density > 0 ? (3 / worldFog.density).toFixed(0) : "none";
      devLog(`[MapLoader] World fog: 95% at ${fogDist}, from ${worldFog.minDist}, colour ${worldFog.color.join(" ")}`);
    }

    // Phase 7: Apply lightmaps (baked lighting)
    progress("Lighting", "Applying lightmaps");
    try {
      const { bspLightingProfile } = await import("../bsp/BspLightingProfile");
      const intensity = lightmapIntensityFor(
        bsp.header.isFBSP,
        this.renderVars.get("r_lightmapscale"),
        bspLightingProfile(bsp).gain,
      );
      const lmCount = BspMeshBuilder.applyLightmaps(meshResult, { intensity });
      devLog(
        `[MapLoader] Applied ${lmCount} lightmaps (${bsp.header.isFBSP ? "FBSP" : "IBSP"}, intensity ${intensity.toFixed(2)})`,
      );
    } catch (e) {
      console.warn(`[MapLoader] Failed to apply lightmaps:`, e);
    }

    meshResult.worldMesh.setEnabled(true);

    // Disable dynamic day/night cycle for BSP maps - they use baked lightmaps
    // Import and configure SkyLightSystem to not interfere with lightmaps
    try {
      const { SkyLightSystem } = await import("../../lighting/SkyLightSystem");
      const skyLight = SkyLightSystem.getInstance();

      // CRITICAL: Ensure SkyLightSystem lights exist before configuring them
      // When loading via console, scene clear may have disposed the lights
      // CRITICAL: Force SkyLightSystem to sync with the current scene
      // This ensures we don't use a stale scene reference from a previous map
      // The init() method now handles cleanup of old lights automatically
      devLog("[MapLoader] Initializing SkyLightSystem for current scene...");
      skyLight.init(scene, {
        sunIntensity: 1.0,
        moonIntensity: 0,
        ambientIntensity: 0.5,
        enableShadows: false,
      });

      // Enable BSP Mode: Locks lighting to optimal state for BSPs
      // - Directional sun for normal maps
      // - Neutral ambient for lightmaps
      // - Disables day/night cycle updates
      skyLight.setBspMode(true);

      // Ensure blockMaterialDirtyMechanism is off so textures apply properly
      scene.blockMaterialDirtyMechanism = false;

      devLog("[MapLoader] Configured lighting for BSP map (BSP Mode enabled)");
    } catch (e) {
      console.warn("[MapLoader] Could not configure lighting:", e);

      // Fallback: Create basic ambient light if SkyLightSystem fails
      try {
        const { HemisphericLight } = await import("@babylonjs/core/Lights/hemisphericLight");
        const { Vector3 } = await import("@babylonjs/core/Maths/math.vector");
        const { Color3 } = await import("@babylonjs/core/Maths/math.color");

        if (scene.lights.length === 0) {
          devLog("[MapLoader] Creating fallback ambient light");
          const light = new HemisphericLight("bsp_ambient", new Vector3(0, 1, 0), scene);
          light.intensity = 1.0;
          light.diffuse = new Color3(1, 1, 1);
          light.groundColor = new Color3(0.5, 0.5, 0.5);
        }

        scene.ambientColor = new Color3(1, 1, 1);
      } catch (fallbackError) {
        console.error("[MapLoader] Failed to create fallback lighting:", fallbackError);
      }
    }

    // Water starts one-shot room captures as soon as it claims the map. Shader
    // readiness alone does not mean scene lighting is configured: placing this
    // before the awaited SkyLightSystem setup could permanently cache a black
    // room. Both baked lightmaps and BSP ambient lighting must be set first.
    await this.claimLiquidSurfaces(meshResult, scene, skyEnvironment, !isHeadlessNullEngine);
    this.surfaceCubemaps?.dispose();
    this.surfaceCubemaps = null;
    if (!isHeadlessNullEngine) {
      const cubemaps = new SurfaceCubemaps(scene);
      if (cubemaps.claim(meshResult.worldMesh)) this.surfaceCubemaps = cubemaps;
    }

    // Phase 8b: Register map-owned billboard updates after frame-level PVS.
    if (meshResult.autospriteMeshes && meshResult.autospriteMeshes.length > 0) {
      progress("Autosprites", `Registering ${meshResult.autospriteMeshes.length} billboard sprites`);
      BspMeshBuilder.registerAutospriteUpdates(meshResult);
    }

    // ── Phases 9-12: Gameplay-only (skip for background maps) ──
    if (!backgroundOnly) {
      // Phase 9: Generate collision meshes
      progress("Collision", "Building clip brush meshes");
      const clipMeshCount = 0; // DISABLED for testing
      devLog(`[MapLoader] TESTING: Collision mesh generation disabled - Generated ${clipMeshCount} meshes`);

      // Phase 9b: Initialize collision system
      progress("Collision", "Initializing");
      try {
        const { getCollisionManager } = await import("../../physics");
        const cm = getCollisionManager();
        await cm.init(bsp, scene, "q3");
        devLog(`[MapLoader] Collision initialized with ${cm.getBackendType()} backend`);
      } catch (e) {
        throw new Error(`Could not initialize required map collision: ${String(e)}`);
      }

      // Phase 10: Preload pickup assets (weapons/ammo models)
      progress("Assets", "Preloading pickup models");
      try {
        const { AssetPreloader } = await import("../AssetPreloader");
        const preloader = AssetPreloader.getInstance();
        const preloadCount = await preloader.preloadFromBsp(
          bsp,
          scene,
          (p) => {
            progress("Assets", `Preloading ${p.modelPath} (${p.current + 1}/${p.total})`);
          },
          signal,
        );
        devLog(`[MapLoader] Preloaded ${preloadCount} pickup models`);
      } catch (e) {
        signal.throwIfAborted();
        throw e;
      }

      // Store BSP and meshResult in BspManager for PVS system
      const { BspManager } = await import("../bsp/BspManager");
      const bspManager = BspManager.getInstance();
      bspManager.setBsp(mapName, bsp);
      bspManager.setMeshResult(meshResult);

      // Static world matrices and bounds do not change during shader preparation.
      // Movers are excluded by their annotation.
      if ((this.renderVars.get("r_bsp_freeze") ?? 1) >= 0.5) {
        const frozenMeshes = BspMeshBuilder.freezeStaticWorld(meshResult);
        devLog(`[MapLoader] Froze ${frozenMeshes} static world meshes (r_bsp_freeze)`);
      }
    } else {
      devLog(`[MapLoader] Background mode: skipped collisions, entities, assets`);
    }

    // Find player start position
    let playerStartPosition = new Vector3(0, 50, 0); // Default
    let playerStart = bsp.entities.find((e) => e.classname === "info_player_start");
    if (!playerStart) {
      playerStart = bsp.entities.find((e) => e.classname === "info_player_deathmatch");
    }
    if (playerStart?.properties.origin) {
      const parts = playerStart.properties.origin.split(" ").map(parseFloat);
      if (parts.length === 3 && !parts.some(Number.isNaN)) {
        playerStartPosition = new Vector3(parts[0], parts[2], parts[1]);
      }
    }

    // ── Shader warmup & GPU readiness: gameplay only ──
    if (!backgroundOnly) {
      progress("Finalizing", "Warming up effect shaders");
      try {
        const { preloadEffectShaders } = await import("../../weapon/EffectPreloader");
        await preloadEffectShaders(scene, signal);
      } catch (e) {
        signal.throwIfAborted();
        console.warn("[MapLoader] Effect shader warm-up failed, proceeding anyway:", e);
      }

      // A required scene that cannot draw fails the load instead of exposing holes.
      progress("Finalizing", "Waiting for GPU readiness");
      try {
        await waitForGpuCondition(scene, () => sceneGpuReady(scene), "map scene", signal, SCENE_READY_TIMEOUT_MS);
        devLog("[MapLoader] Scene fully ready — all textures and shaders compiled");
      } catch (e) {
        signal.throwIfAborted();
        throw new Error(`Map rendering did not become ready: ${describeNotReady(scene)} (${String(e)})`);
      }

      // Static reflection cubemaps render the world six times each: behind the
      // loading screen rather than as a stall when a pool first comes into view
      const camera = scene.activeCamera;
      if (camera && this.liquidSurfaces) {
        progress("Finalizing", "Capturing reflections");
        try {
          const captured = this.liquidSurfaces.captureReflections(camera);
          if (captured) devLog(`[MapLoader] Captured ${captured} water reflection cubemap(s)`);
        } catch (e) {
          console.warn("[MapLoader] Reflection capture failed, water will capture in play:", e);
        }
      }
      if (camera && this.surfaceCubemaps) {
        progress("Finalizing", "Capturing reflections");
        const captured = await this.surfaceCubemaps.captureAll(camera);
        devLog(`[MapLoader] Captured ${captured} $cubemap surface reflection(s)`);
        // The reflecting surfaces' shaders gained a cubemap: compile them here too
        if (captured)
          await waitForGpuCondition(
            scene,
            () => sceneGpuReady(scene),
            "reflection materials",
            signal,
            SCENE_READY_TIMEOUT_MS,
          ).catch(() => false);
      }
      this.surfaceCubemaps?.captureInPlay();
    } else {
      devLog("[MapLoader] Background mode: skipped shader warmup and GPU wait");
      this.surfaceCubemaps?.captureInPlay();
    }

    // ── Tab visibility recovery ──────────────────────────────────────────
    // Visibility suspends GPU scheduling. Verify resources on resume without
    // invalidating healthy material layouts merely because the tab was hidden.
    if (this.wasBackgroundedDuringLoad) {
      devLog("[MapLoader] Resuming rendering checks after hidden-tab suspension");
      progress("Recovery", "Checking rendering after returning to the tab");

      // If tab is still hidden, wait for it to become visible first
      if (document.hidden) {
        devLog("[MapLoader] Tab still hidden — waiting for visibility...");
        await waitForMapVisibility(signal);
        devLog("[MapLoader] Tab now visible — starting revalidation");
      }

      try {
        await waitForGpuCondition(
          scene,
          () => sceneGpuReady(scene),
          "resuming map rendering",
          signal,
          SCENE_READY_TIMEOUT_MS,
        );
        devLog("[MapLoader] Post-background revalidation complete");
      } catch (e) {
        signal.throwIfAborted();
        throw new Error(`Could not restore map rendering after returning to the tab: ${String(e)}`);
      }

      this.wasBackgroundedDuringLoad = false;
    }

    // Final gameplay phase: spawn a fresh entity generation only after the BSP,
    // collision, assets, shaders and tab recovery are complete. Pickup creation
    // is awaited by entity handlers, so no model work is left racing map readiness.
    if (!backgroundOnly) {
      progress("Entities", "Spawning final gameplay entities");
      registerBspEntityHandlers();
      getGameMapEntities()?.registerHandlers();
      setCurrentBspForHandlers(bsp);
      await this.processBspEntities(bsp, scene, signal);
      await waitForGpuCondition(
        scene,
        () => sceneGpuReady(scene),
        "final map entities",
        signal,
        SCENE_READY_TIMEOUT_MS,
      );

      // Before PVS hides most of the world: build WebGPU pipelines for every
      // surface and entity behind the loading screen, not on first sight in play
      progress("Finalizing", "Preparing render pipelines");
      const { warmRenderPipelines } = await import("../../rendering/PipelineWarmup");
      const warmStart = performance.now();
      const pipelines = await warmRenderPipelines(scene, signal);
      if (pipelines) {
        devLog(`[MapLoader] Built ${pipelines} render pipelines in ${Math.round(performance.now() - warmStart)} ms`);
      }

      // Keep every world surface live through temporary-light preparation,
      // including meshes sharing a material with the representative compiled.
      // Frozen PBR draw caches can otherwise reuse readiness from an old effect
      // while another mesh/pass has installed a pending replacement.
      const frozen = new Set<Material>();
      const seen = new Set<number>();
      let skippedCount = 0;
      for (const mesh of [meshResult.worldMesh, ...meshResult.worldMesh.getChildMeshes()]) {
        const mat = mesh.material;
        if (mat && !seen.has(mat.uniqueId)) {
          seen.add(mat.uniqueId);
          if (mesh.name.startsWith("skybox")) {
            skippedCount++;
            continue;
          }
          mat.freeze();
          frozen.add(mat);
        }
      }
      trackFrozenWorldMaterials(scene, frozen);
      devLog(`[MapLoader] Froze ${frozen.size} world materials, skipped ${skippedCount} sky`);

      // Start PVS after material setup and entity spawning have established the
      // world's intended visibility. The live camera may arrive on a later frame.
      const { BspManager } = await import("../bsp/BspManager");
      devLog(`[MapLoader] ${await BspManager.getInstance().enablePVS(scene)}`);

      // A sky portal draws the sky from its own camera, with its own PVS
      const portal = isHeadlessNullEngine ? null : parseSkyPortal(bsp.entities);
      const world = bsp.models[0];
      if (portal && world) {
        const worldMesh = meshResult.worldMesh;
        const sky = new SkyVisibility(meshResult.bspData, skyClusterBounds(meshResult.bspData, meshResult.skyFaces));
        this.skyPortal = new SkyPortalView(scene, portal, world, {
          setVisibilityFrom: (position) => BspManager.getInstance().getPvsCuller()?.update(position),
          setFogScale: (fogScale) => WorldFogController.getInstance().setPortalScale(fogScale),
          isMapMesh: (mesh) => mesh === worldMesh || mesh.isDescendantOf(worldMesh) || mesh.metadata?.mapOwned === true,
          isPositionVisible: (position) => BspManager.getInstance().getPvsCuller()?.isPositionVisible(position) ?? true,
          isSkyInView: (view) => sky.inView(view),
        });
        devLog(`[MapLoader] Sky portal at ${portal.origin.join(" ")}${portal.scale ? `, scale ${portal.scale}` : ""}`);
      }

      // A world mesh still not ready when the loading screen goes renders as a
      // hole until it is. Name those meshes and what each is waiting on.
      this.readinessCheck?.();
      this.readinessCheck = EventBus.once(LOADING_EVENTS.HIDDEN, async () => {
        this.readinessCheck = null;
        if (this.currentMeshResult !== meshResult || meshResult.worldMesh.isDisposed()) return;
        const { describeUnreadyMeshes } = await import("../../world/ModelRenderAudit");
        // Asked in the pass of the camera that draws the world, not the weapon view's
        const worldMask = meshResult.worldMesh.layerMask;
        const camera =
          scene.activeCameras?.find((candidate) => (candidate.layerMask & worldMask) !== 0) ?? scene.activeCamera;
        const unready = describeUnreadyMeshes([meshResult.worldMesh, ...meshResult.worldMesh.getChildMeshes()], camera);
        if (unready.length > 0) {
          console.warn(
            `[MapLoader] ${unready.length} world meshes were not ready to draw when the loading screen closed: ${unready.slice(0, 12).join("; ")}`,
          );
        }
      });
    }

    this.currentMap = mapName;
    progress("Complete", `Map ${mapName} loaded successfully`);

    return {
      success: true,
      mapName,
      mapType: "bsp",
      bsp,
      meshResult,
      playerStartPosition,
    };
  }

  /**
   * A companion is a complete map dependency bank; other maps' banks stay cached but hidden.
   */
  private async prepareMapTextureBank(
    mapName: string,
    progress: (phase: string, detail?: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.resetPackageScope();
    const filename = `tex_${mapName}.pk3`;
    const url = this.pk3Index.getPK3Path(filename);
    if (!url) return;
    progress("Dependencies", `Loading ${filename}`);
    await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(url), signal);
    const files = new Set(this.pk3Loader.getPackageFiles(filename));
    const manifestPath = `media-manifests/${mapName}.json`;
    const manifest = await waitForMapAsset(this.pk3Loader.getPackageFile(filename, manifestPath), signal);
    const metadata = manifest && JSON.parse(manifest);
    if (!metadata || metadata.map !== mapName) throw new Error(`Invalid map texture bank: ${filename}`);
    if (metadata.sharedDependencies !== undefined && !Array.isArray(metadata.sharedDependencies))
      throw new Error(`Invalid shared dependencies: ${filename}`);
    const sharedDependencies: Array<{ package: string; dynamic: boolean; texturePrefixes: string[] }> =
      metadata.sharedDependencies ?? [];
    const sidecarExcludedPrefixes: string[] = [];
    for (const dependency of sharedDependencies) {
      if (
        !dependency ||
        typeof dependency.package !== "string" ||
        !/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(dependency.package) ||
        dependency.package === filename ||
        typeof dependency.dynamic !== "boolean" ||
        !Array.isArray(dependency.texturePrefixes) ||
        dependency.texturePrefixes.some(
          (prefix) =>
            typeof prefix !== "string" ||
            !/^[a-z0-9][a-z0-9_./-]*\/$/i.test(prefix) ||
            prefix.split("/").some((part) => part === ".." || part === "."),
        )
      )
        throw new Error(`Invalid shared dependency: ${filename}`);
      if (dependency.dynamic)
        sidecarExcludedPrefixes.push(...dependency.texturePrefixes.map((prefix) => prefix.toLowerCase()));
    }
    const shaders = new Set<string>();
    for (const file of files) {
      if (!/^scripts\/.*\.shader$/i.test(file)) continue;
      const source = await waitForMapAsset(this.pk3Loader.getPackageFile(filename, file), signal);
      if (source === null) throw new Error(`Missing companion shader: ${filename}:${file}`);
      for (const block of shaderSourceBlocks(source)) {
        shaders.add(stripTextureExtension(block.name.toLowerCase()));
      }
    }
    const scope: PK3PackageScope = {
      package: filename,
      files,
      shaders,
      sidecarExcludedPrefixes,
      excludedPackages: new Set(
        this.pk3Index
          .getMapNames()
          .map((name) => `tex_${name}.pk3`)
          .filter((name) => name !== filename),
      ),
    };
    this.pk3Loader.setPackageScope(scope);
    this.pk3Index.setPackageScope(scope);
    const overrideFiles = new Set(files);
    for (const dependency of sharedDependencies) {
      const dependencyUrl = this.pk3Index.getPK3Path(dependency.package);
      if (!dependencyUrl || scope.excludedPackages.has(dependency.package))
        throw new Error(`Unavailable shared texture bank: ${dependency.package}`);
      const revision = this.pk3Index.getStats().lastUpdated?.getTime() ?? 0;
      const url = dependency.dynamic
        ? `${dependencyUrl}${dependencyUrl.includes("?") ? "&" : "?"}pk3v=${revision}`
        : dependencyUrl;
      progress("Dependencies", `Loading shared ${dependency.package}`);
      await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(url), signal);
      for (const file of this.pk3Loader.getPackageFiles(dependency.package)) overrideFiles.add(file);
    }
    const overrides = new Set<string>();
    const loadedOwners = new Set(this.pk3Loader.getPackageInfo().map((pkg) => pkg.filename));
    for (const file of overrideFiles) {
      if (file.startsWith("media-")) continue;
      const owner = this.pk3Index.findFile(file);
      if (owner && owner !== filename && !loadedOwners.has(owner)) overrides.add(owner);
    }
    for (const shader of shaders) {
      const owner = this.pk3Index.findShader(shader);
      if (owner && owner !== filename && !loadedOwners.has(owner)) overrides.add(owner);
    }
    for (const owner of overrides) {
      const overrideUrl = this.pk3Index.getPK3Path(owner);
      if (overrideUrl) {
        progress("Dependencies", `Loading override ${owner}`);
        await waitForMapAsset(this.pk3Loader.ensurePK3FromUrl(overrideUrl), signal);
      }
    }
  }

  private resetPackageScope(): void {
    this.pk3Index.setPackageScope(null);
    this.pk3Loader.setPackageScope(null);
    this.shaderRegistry.clear();
  }

  /**
   * Resolve all PK3 dependencies for a BSP map
   */
  private async resolveMapDependencies(bsp: BspFile): Promise<Set<string>> {
    const requiredPk3s = new Set<string>();
    const loadedPackages = new Set(this.pk3Loader.getPackageInfo().map((p) => p.filename));

    // Get texture references from BSP
    const textureNames = bsp.textures.map((t) => t.name);

    // Find PK3s for textures
    for (const texName of textureNames) {
      // Check if there's a shader for this texture
      const shaderPk3 = this.pk3Index.findShader(texName);
      if (shaderPk3 && !loadedPackages.has(shaderPk3)) {
        requiredPk3s.add(shaderPk3);
      }

      // Check for texture file
      const extensions = [PACKAGED_TEXTURE_EXTENSION, ".tga", ".jpg", ".png", ".ktx"];
      for (const ext of extensions) {
        const texPath = `textures/${texName}${ext}`;
        const pk3 = this.pk3Index.findFile(texPath);
        if (pk3 && !loadedPackages.has(pk3)) {
          requiredPk3s.add(pk3);
          break;
        }
        // Also check without textures/ prefix
        const pk3NoPrefix = this.pk3Index.findFile(`${texName}${ext}`);
        if (pk3NoPrefix && !loadedPackages.has(pk3NoPrefix)) {
          requiredPk3s.add(pk3NoPrefix);
          break;
        }
      }
    }

    // Also check the existing findPK3sForTextures for more comprehensive lookup
    const morePk3s = this.pk3Index.findPK3sForTextures(textureNames);
    for (const pk3 of morePk3s) {
      if (!loadedPackages.has(pk3)) {
        requiredPk3s.add(pk3);
      }
    }

    return requiredPk3s;
  }

  /**
   * Resolve sky texture dependencies (call after shaders are loaded)
   */
  private async resolveSkyDependencies(bsp: BspFile): Promise<Set<string>> {
    const requiredPk3s = new Set<string>();
    const loadedPackages = new Set(this.pk3Loader.getPackageInfo().map((p) => p.filename));

    const textureNames = bsp.textures.map((t) => t.name);

    for (const texName of textureNames) {
      const shader = this.shaderRegistry.getShader(texName);
      if (shader?.skyParms?.farbox) {
        // Sky textures have _ft, _bk, _lf, _rt, _up, _dn suffixes
        // farbox may or may not include "env/" prefix already
        let skyPath = shader.skyParms.farbox;
        if (!skyPath.startsWith("env/")) {
          skyPath = `env/${skyPath}`;
        }

        const suffixes = ["_ft", "_bk", "_lf", "_rt", "_up", "_dn"];
        const extensions = [PACKAGED_TEXTURE_EXTENSION, ".ktx", ".tga", ".jpg", ".png"];

        for (const suffix of suffixes) {
          for (const ext of extensions) {
            const envPath = `${skyPath}${suffix}${ext}`;
            const pk3 = this.pk3Index.findFile(envPath);
            if (pk3 && !loadedPackages.has(pk3)) {
              requiredPk3s.add(pk3);
              devLog(`[MapLoader] Sky texture dependency: ${envPath} -> ${pk3}`);
              break;
            }
          }
        }
      }
    }

    return requiredPk3s;
  }

  /**
   * Dispose current map resources
   */
  async disposeCurrentMap(): Promise<void> {
    this.requestedLoad?.abort(new Error("Map load cancelled"));
    const disposal = this.loadTail.then(() => this.clearCurrentMap());
    this.loadTail = disposal.catch(() => {});
    await disposal;
  }

  private async clearCurrentMap(): Promise<void> {
    this.resetPackageScope();
    devLog(`[MapLoader] disposeCurrentMap called at ${Date.now()}`);
    this.readinessCheck?.();
    this.readinessCheck = null;
    if (this.currentMap) {
      EventBus.emit("map:unloading", { mapName: this.currentMap });
    }

    // The map's fog and sky portal go with it
    WorldFogController.getInstance().setMap(null, null);
    this.skyPortal?.dispose();
    this.skyPortal = null;

    // Gameplay entities use independent root meshes, so disposing the BSP world
    // hierarchy alone does not remove them.
    getGameMapEntities()?.disposeMapEntities();

    // Pickup models were preloaded for this map, and its pickups are gone.
    // Release the sources; the next map preloads the models it needs.
    const { AssetPreloader } = await import("../AssetPreloader");
    AssetPreloader.getInstance().clearCache();

    // Hand liquid surfaces back before the meshes go, so nothing is left
    // pointing at a material that is about to be disposed.
    this.liquidSurfaces?.dispose();
    this.liquidSurfaces = null;
    this.surfaceCubemaps?.dispose();
    this.surfaceCubemaps = null;

    if (this.currentMeshResult) {
      // Dispose child meshes first
      for (const child of this.currentMeshResult.worldMesh.getChildMeshes()) {
        child.dispose();
      }
      this.currentMeshResult.worldMesh.dispose();
      // Dispose lightmap textures
      for (const tex of this.currentMeshResult.lightmapTextures) {
        tex.dispose();
      }
      this.currentMeshResult = null;
    }
    this.currentBsp = null;
    this.currentMap = null;

    // CRITICAL: Clear texture caches to prevent stale references
    // When textures are disposed, cached references become invalid
    // Without clearing caches, reload would return disposed textures (black walls)
    // MUST AWAIT to prevent race condition where new map's textures get disposed
    try {
      const { PK3TextureLoader } = await import("../pk3/PK3TextureLoader");
      PK3TextureLoader.getInstance().clearCache();
      devLog("[MapLoader] Cleared PK3TextureLoader cache");

      const { TextureManager } = await import("../texture/TextureManager");
      TextureManager.getInstance().clearCache();
      devLog("[MapLoader] Cleared TextureManager cache");
    } catch (e) {
      console.warn("[MapLoader] Error clearing caches:", e);
    }
  }

  /**
   * Get list of available maps (from PK3 index)
   */
  getAvailableMaps(): { name: string; pk3: string; type: "bsp" }[] {
    const maps: { name: string; pk3: string; type: "bsp" }[] = [];

    const mapNames = this.pk3Index.getMapNames();
    for (const name of mapNames) {
      const pk3 = this.pk3Index.findMap(name);
      if (pk3) {
        maps.push({ name, pk3, type: "bsp" });
      }
    }

    return maps.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get current map name
   */
  getCurrentMap(): string | null {
    return this.currentMap;
  }

  /**
   * Process BSP entities through EntityHandlerRegistry
   * This bridges BSP entities to the same handler system used by .map files
   */
  private async processBspEntities(bsp: BspFile, scene: Scene, signal?: AbortSignal): Promise<void> {
    // Convert BSP entities to EntityData format
    const entityDataList: EntityData[] = bsp.entities.map((e) => ({
      classname: e.classname,
      properties: e.properties,
    }));

    // Run pre-render hooks (game-specific initialization)
    await EntityHandlerRegistry.runPreRenderHooks(entityDataList, scene);

    // Process each entity through registered handlers
    let handledCount = 0;
    const unhandled = new Map<string, number>();
    for (const entity of entityDataList) {
      signal?.throwIfAborted();
      const handler = EntityHandlerRegistry.getHandler(entity.classname);
      if (handler) {
        try {
          const result = await handler(entity, scene);
          signal?.throwIfAborted();
          if (result.handled) {
            // Movers are separate inline models, but still belong to this map.
            // Parenting makes unload dispose their meshes and render observers.
            if (result.node?.metadata?.isMover && this.currentMeshResult) {
              result.node.parent = this.currentMeshResult.worldMesh;
            }
            handledCount++;
          }
        } catch (e) {
          signal?.throwIfAborted();
          console.warn(`[MapLoader] Entity handler failed for '${entity.classname}':`, e);
        }
      } else if (!NEEDS_NO_CLIENT_HANDLER.has(entity.classname) && !entity.classname.startsWith("info_")) {
        unhandled.set(entity.classname, (unhandled.get(entity.classname) ?? 0) + 1);
      }
    }
    if (unhandled.size > 0) {
      const list = [...unhandled].map(([classname, count]) => `${classname} ×${count}`).join(", ");
      console.warn(`[MapLoader] No client handler for: ${list}`);
    }

    if (handledCount > 0) {
      devLog(`[MapLoader] Processed ${handledCount} BSP entities via EntityHandlerRegistry`);
    }

    // Log registered handlers for debugging
    const registered = EntityHandlerRegistry.getRegisteredClassnames();
    if (registered.length > 0) {
      devLog(`[MapLoader] Available entity handlers: ${registered.join(", ")}`);
    }
  }

  /**
   * Resolve entity model dependencies — find which PK3s contain weapon/ammo models
   * referenced by BSP entities. Mirrors resolveMapDependencies() for textures.
   */
  private resolveEntityModelDependencies(bsp: BspFile): Set<string> {
    const requiredPk3s = new Set<string>();
    const registry = EntityRegistry.getInstance();
    const seenModels = new Set<string>();

    for (const entity of bsp.entities) {
      const classname = entity.classname;
      if (!classname) continue;

      const def = registry.getByClassname(classname);
      if (!def) continue;

      // Only resolve weapons and ammo
      if (def.type !== EntityType.WEAPON && def.type !== EntityType.AMMO) continue;

      const modelPath = def.modelPath;
      if (!modelPath || seenModels.has(modelPath)) continue;
      seenModels.add(modelPath);

      // Find which PK3 contains this model
      const virtualPath = modelPath.replace(/^\/?data\//i, "").replace(/^\/+/, "");
      const pk3 = this.pk3Index.findFile(virtualPath);
      if (pk3) {
        requiredPk3s.add(pk3);
        devLog(`[MapLoader] Entity model dependency: ${modelPath} → ${pk3}`);
      } else {
        console.warn(`[MapLoader] No PK3 found for entity model: ${modelPath}`);
      }
    }

    if (requiredPk3s.size > 0) {
      devLog(`[MapLoader] Resolved ${requiredPk3s.size} entity model PK3(s): ${[...requiredPk3s].join(", ")}`);
    }

    return requiredPk3s;
  }

  // NOTE: buildClipBrushMeshes, brushToBounds, intersectPlanes, and isInsideAllPlanes
  // were disabled for testing and have been removed. See git history if needed.

  /**
   * Hand every liquid surface in the built map to the unified water material.
   *
   * Gated by `r_water` so the legacy Q3/Warsow translation stays reachable —
   * it is the comparison baseline for tuning this, and the fallback if a
   * driver refuses the shader.
   */
  private async claimLiquidSurfaces(
    meshResult: BspMeshBuildResult,
    scene: Scene,
    skyEnvironment: BaseTexture | null,
    loadEnvironmentMaps: boolean,
  ): Promise<void> {
    this.liquidSurfaces?.dispose();
    this.liquidSurfaces = null;

    if (this.renderVars?.get("r_water") === 0) {
      devLog("[MapLoader] r_water 0 — liquid surfaces left on the legacy renderer");
      return;
    }

    const system = new LiquidSurfaceSystem(scene);
    system.mapLights = waterMapLights(this.currentBsp?.entities ?? []);
    if (this.currentBsp) {
      const panels = extractEmissiveSurfaces(this.currentBsp, (name) => {
        const strength = this.shaderRegistry.resolveMaterialProps(name).surfaceLight ?? 0;
        return { emissive: strength > 0, surfaceLight: strength };
      });
      system.mapLights = [...system.mapLights, ...waterSurfaceLights(panels)];
    }
    devLog(`[Water] Authored highlight candidates: ${system.mapLights.length}`);
    system.setEnvironmentTexture(skyEnvironment);

    if (loadEnvironmentMaps) {
      const hints = new Map<"water" | "slime" | "lava", string>();
      for (const mesh of [meshResult.worldMesh, ...meshResult.worldMesh.getChildMeshes(false)]) {
        const kind = mesh.metadata?.liquidKind as "water" | "slime" | "lava" | null | undefined;
        const environmentMap = mesh.metadata?.liquidEnvironmentMap as string | null | undefined;
        if (!kind || !environmentMap || hints.has(kind)) continue;
        hints.set(kind, environmentMap);
      }

      if (hints.size > 0) {
        const { SkyboxLoader } = await import("../texture/SkyboxLoader");
        const loader = SkyboxLoader.getInstance();
        loader.init(scene);
        for (const [kind, basePath] of hints) {
          const environment = await loader.loadEnvironmentCubemap(basePath);
          if (environment.success && environment.texture) {
            system.setEnvironmentTexture(environment.texture, { kind, owned: true });
          } else {
            console.warn(`[Water] Could not load ${kind} environment ${basePath}: ${environment.error}`);
          }
        }
      }
    }

    const claimed = system.claim(meshResult.worldMesh);

    if (claimed === 0) {
      // No liquid drawn in this map. Common and not a fault: a map can have
      // swimmable volumes with no visible surface at all.
      system.dispose();
      return;
    }

    this.liquidSurfaces = system;
    devLog(`[MapLoader] Unified water claimed ${claimed} liquid surface(s)`);
  }

  /**
   * Get current BSP
   */
  getCurrentBsp(): BspFile | null {
    return this.currentBsp;
  }

  /**
   * Get current mesh result
   */
  getCurrentMeshResult(): BspMeshBuildResult | null {
    return this.currentMeshResult;
  }
}
