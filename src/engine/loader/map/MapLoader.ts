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

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PK3Index } from '../pk3/PK3Index';
import { PK3Loader } from '../pk3/PK3Loader';
import { BspLoader, type BspFile } from '../bsp/BspLoader';
import { BspMeshBuilder, type BspMeshBuildResult } from '../bsp/BspMeshBuilder';
import { Q3ShaderRegistry } from '../shader/Q3ShaderRegistry';
import { EntityHandlerRegistry, type EntityData } from '../../core/EntityHandlerRegistry';
import { registerBspEntityHandlers, setCurrentBspForHandlers } from '../bsp/BspEntityHandlers';
import { EntityManager } from '../../entities/EntityManager';
import { EntityRegistry } from '../../../shared/entities/EntityRegistry';
import { EntityType } from '../../../shared/entities/EntityType';
import { initializeEntityDefs } from '../../../shared/entities';
import { EventBus } from '../../core/EventBus';
import { LOADING_EVENTS, type LoadingProgressEvent, type LoadingCompleteEvent } from '../../core/LoadingEvents';

export interface MapLoadResult {
  success: boolean;
  mapName: string;
  mapType: 'local' | 'bsp';
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

export type ProgressCallback = (progress: MapLoadProgress) => void;

export class MapLoader {
  private static instance: MapLoader;

  private pk3Index: PK3Index;
  private pk3Loader: PK3Loader;
  private shaderRegistry: Q3ShaderRegistry;

  private currentMap: string | null = null;
  private currentBsp: BspFile | null = null;
  private currentMeshResult: BspMeshBuildResult | null = null;

  private constructor() {
    this.pk3Index = PK3Index.getInstance();
    this.pk3Loader = PK3Loader.getInstance();
    this.shaderRegistry = Q3ShaderRegistry.getInstance();
  }

  static getInstance(): MapLoader {
    if (!MapLoader.instance) {
      MapLoader.instance = new MapLoader();
    }
    return MapLoader.instance;
  }

  /**
   * Load a map by name - auto-detects type (local .map or PK3 BSP)
   */
  async loadMap(
    mapName: string,
    scene: Scene,
    onProgress?: ProgressCallback
  ): Promise<MapLoadResult> {
    const startTime = Date.now();

    // Emit loading:start event
    EventBus.emit(LOADING_EVENTS.START, {
      type: 'map',
      id: mapName,
      meta: { displayName: mapName },
    });

    const progress = (phase: string, detail?: string, percent?: number) => {
      onProgress?.({ phase, detail, progress: percent });
      console.log(`[MapLoader] ${phase}${detail ? ': ' + detail : ''}`);

      // Emit loading:progress event
      const progressEvent: LoadingProgressEvent = {
        type: 'map',
        phase,
        detail,
        percent,
      };
      EventBus.emit(LOADING_EVENTS.PROGRESS, progressEvent);
    };

    try {
      // Clean up previous map
      if (this.currentMeshResult) {
        progress('cleanup', 'disposing previous map');
        await this.disposeCurrentMap();
      }

      // Check if it's a BSP map in the index
      const bspPk3 = this.pk3Index.findMap(mapName);
      if (bspPk3) {
        const result = await this.loadBspMap(mapName, bspPk3, scene, progress);

        // Emit loading:complete event
        EventBus.emit(LOADING_EVENTS.COMPLETE, {
          type: 'map',
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
        type: 'map',
        success: false,
        error,
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        mapName,
        mapType: 'local',
        error,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[MapLoader] Failed to load map ${mapName}:`, e);

      // Emit loading:complete event (failure)
      EventBus.emit(LOADING_EVENTS.COMPLETE, {
        type: 'map',
        success: false,
        error,
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        mapName,
        mapType: 'bsp',
        error,
      };
    }
  }

  /**
   * Load a BSP map from PK3 with full dependency resolution
   */
  private async loadBspMap(
    mapName: string,
    mapPk3: string,
    scene: Scene,
    progress: (phase: string, detail?: string, pct?: number) => void
  ): Promise<MapLoadResult> {
    const loadedPk3s = new Set(this.pk3Loader.getPackageInfo().map((p) => p.filename));

    // Phase 1: Ensure map PK3 is loaded
    progress('Loading', `Map PK3: ${mapPk3}`);
    if (!loadedPk3s.has(mapPk3)) {
      const mapPk3Path = this.pk3Index.getPK3Path(mapPk3);
      if (mapPk3Path) {
        await this.pk3Loader.loadPK3FromUrl(mapPk3Path);
      } else {
        await this.pk3Loader.loadPK3(mapPk3);
      }
    }

    // Phase 2: Load BSP
    progress('Loading', 'BSP data');
    const bspPath = `maps/${mapName}.bsp`;
    const bsp = await BspLoader.loadFromPK3(this.pk3Loader, bspPath);
    if (!bsp) {
      return {
        success: false,
        mapName,
        mapType: 'bsp',
        error: `Failed to load BSP: ${bspPath}`,
      };
    }
    this.currentBsp = bsp;

    // Phase 3: Resolve and load texture dependencies
    progress('Dependencies', 'Resolving required PK3s');
    const requiredPk3s = await this.resolveMapDependencies(bsp);

    let loaded = 0;
    for (const pk3 of requiredPk3s) {
      progress('Dependencies', `Loading ${pk3}`, loaded / requiredPk3s.size);
      try {
        if (!loadedPk3s.has(pk3)) {
          const pk3Path = this.pk3Index.getPK3Path(pk3);
          if (pk3Path) {
            await this.pk3Loader.loadPK3FromUrl(pk3Path);
          }
        }
      } catch (e) {
        console.warn(`[MapLoader] Failed to load dependency ${pk3}:`, e);
      }
      loaded++;
    }

    // Phase 3b: Resolve entity model dependencies (weapons, ammo, items)
    // Mirror of Phase 3 but for BSP entity models instead of textures.
    progress('Dependencies', 'Resolving entity model PK3s');
    initializeEntityDefs(); // Ensure entity definitions are populated
    const modelPk3s = this.resolveEntityModelDependencies(bsp);
    for (const pk3 of modelPk3s) {
      if (!loadedPk3s.has(pk3)) {
        progress('Dependencies', `Loading model assets from ${pk3}`);
        try {
          const pk3Path = this.pk3Index.getPK3Path(pk3);
          if (pk3Path) {
            await this.pk3Loader.loadPK3FromUrl(pk3Path);
            loadedPk3s.add(pk3);
          }
        } catch (e) {
          console.warn(`[MapLoader] Failed to load model dependency ${pk3}:`, e);
        }
      }
    }

    // Phase 4: Load shaders
    progress('Shaders', 'Loading shader definitions');
    await this.shaderRegistry.loadShaders();

    // Phase 4b: Resolve sky texture dependencies (needs shaders loaded first)
    const skyPk3s = await this.resolveSkyDependencies(bsp);
    for (const pk3 of skyPk3s) {
      progress('Dependencies', `Loading sky textures from ${pk3}`);
      try {
        if (!loadedPk3s.has(pk3)) {
          const pk3Path = this.pk3Index.getPK3Path(pk3);
          if (pk3Path) {
            await this.pk3Loader.loadPK3FromUrl(pk3Path);
          }
        }
      } catch (e) {
        console.warn(`[MapLoader] Failed to load sky dependency ${pk3}:`, e);
      }
    }

    // Phase 5: Build mesh
    progress('Geometry', 'Building mesh');
    const meshResult = BspMeshBuilder.build(bsp, scene, {
      filterTextures: true,
    });
    this.currentMeshResult = meshResult;

    // Phase 6: Apply textures
    progress('Textures', 'Loading and applying');
    await BspMeshBuilder.applyTextures(meshResult, bsp, scene);

    // Phase 7: Apply skybox
    progress('Skybox', 'Creating');
    const engineAny = scene.getEngine() as any;
    const engineClass = engineAny?.getClassName?.();
    const engineCtorName = engineAny?.constructor?.name;
    const isHeadlessNullEngine = engineClass === 'NullEngine' || engineCtorName === 'NullEngine';
    if (!isHeadlessNullEngine) {
      const skyResult = await BspMeshBuilder.applySkybox(meshResult, scene);
      if (skyResult.success) {
        console.log(`[MapLoader] Skybox created (${meshResult.skyShaders.length} sky shaders)`);
      } else if (skyResult.error) {
        console.warn(`[MapLoader] Skybox failed: ${skyResult.error}`);
      }
    } else {
      progress('Skybox', 'Skipped (NullEngine)');
    }

    // Phase 7: Apply lightmaps (Q3 baked lighting)
    progress('Lighting', 'Applying lightmaps');
    try {
      const lmCount = BspMeshBuilder.applyLightmaps(meshResult, { intensity: 2.0 });
      console.log(`[MapLoader] Applied ${lmCount} lightmaps`);
    } catch (e) {
      console.warn(`[MapLoader] Failed to apply lightmaps:`, e);
    }

    // (Post-Lightmap pause removed to reduce noise)

    // Disable dynamic day/night cycle for BSP maps - they use baked lightmaps
    // Import and configure SkyLightSystem to not interfere with lightmaps
    try {
      const { SkyLightSystem } = await import('../../lighting/SkyLightSystem');
      const skyLight = SkyLightSystem.getInstance();

      // CRITICAL: Ensure SkyLightSystem lights exist before configuring them
      // When loading via console, scene clear may have disposed the lights
      // CRITICAL: Force SkyLightSystem to sync with the current scene
      // This ensures we don't use a stale scene reference from a previous map
      // The init() method now handles cleanup of old lights automatically
      console.log('[MapLoader] Initializing SkyLightSystem for current scene...');
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

      console.log('[MapLoader] Configured lighting for BSP map (BSP Mode enabled)');

    } catch (e) {
      console.warn('[MapLoader] Could not configure lighting:', e);

      // Fallback: Create basic ambient light if SkyLightSystem fails
      try {
        const { HemisphericLight } = await import('@babylonjs/core/Lights/hemisphericLight');
        const { Vector3 } = await import('@babylonjs/core/Maths/math.vector');
        const { Color3 } = await import('@babylonjs/core/Maths/math.color');

        if (scene.lights.length === 0) {
          console.log('[MapLoader] Creating fallback ambient light');
          const light = new HemisphericLight("bsp_ambient", new Vector3(0, 1, 0), scene);
          light.intensity = 1.0;
          light.diffuse = new Color3(1, 1, 1);
          light.groundColor = new Color3(0.5, 0.5, 0.5);
        }

        scene.ambientColor = new Color3(1, 1, 1);
      } catch (fallbackError) {
        console.error('[MapLoader] Failed to create fallback lighting:', fallbackError);
      }
    }

    // Phase 8b: Register autosprite billboard updates (per-frame)
    if (meshResult.autospriteMeshes && meshResult.autospriteMeshes.length > 0) {
      progress('Autosprites', `Registering ${meshResult.autospriteMeshes.length} billboard sprites`);
      scene.registerBeforeRender(() => {
        if (scene.activeCamera) {
          BspMeshBuilder.updateAutosprites(meshResult, scene.activeCamera.position);
        }
      });
    }

    // Phase 9: Generate collision meshes for invisible clip brushes (PLAYERCLIP, etc.)
    // TEMPORARILY DISABLED TO TEST IF COLLISION MESHES CAUSE STUCK CAMERA
    progress('Collision', 'Building clip brush meshes');
    const clipMeshCount = 0; // DISABLED: this.buildClipBrushMeshes(bsp as BspFile, scene);
    console.log(`[MapLoader] TESTING: Collision mesh generation disabled - Generated ${clipMeshCount} meshes`);

    // Phase 9b: Initialize collision system
    progress('Collision', 'Initializing');
    try {
      const { getCollisionManager } = await import('../../physics');
      const cm = getCollisionManager();
      await cm.init(bsp, scene as never, 'q3'); // Use 'q3' sweep collision for reliable floor detection
      console.log(`[MapLoader] Collision initialized with ${cm.getBackendType()} backend`);
    } catch (e) {
      console.warn('[MapLoader] Failed to initialize collision:', e);
    }

    // Phase 10: Preload pickup assets (weapons/ammo models)
    progress('Assets', 'Preloading pickup models');
    try {
      const { AssetPreloader } = await import('../AssetPreloader');
      const preloader = AssetPreloader.getInstance();
      const preloadCount = await preloader.preloadFromBsp(bsp, scene, (p) => {
        progress('Assets', `Preloading ${p.modelPath} (${p.current + 1}/${p.total})`);
      });
      console.log(`[MapLoader] Preloaded ${preloadCount} pickup models`);
    } catch (e) {
      console.warn('[MapLoader] Failed to preload assets:', e);
    }

    // Phase 11: Process BSP entities through EntityHandlerRegistry
    progress('Entities', 'Processing');
    registerBspEntityHandlers(); // Register func_door, etc.
    EntityManager.getInstance().registerHandlers(); // Register weapons, pickups via EntityManager
    setCurrentBspForHandlers(bsp); // Set BSP reference for handlers
    await this.processBspEntities(bsp, scene);

    // Store BSP and meshResult in BspManager for PVS system
    const { BspManager } = await import('../bsp/BspManager');
    const bspManager = BspManager.getInstance();
    bspManager.setBsp(mapName, bsp); // Set BSP data
    bspManager.setMeshResult(meshResult); // Store mesh result

    // Phase 12: Freeze materials that don't need dynamic light updates.
    // Lightmapped BSP materials are NOT frozen — they need to respond to
    // dynamic PointLights from projectiles, explosions, and muzzle flashes.
    // mat.freeze() blocks isReadyForSubMesh() which prevents new light binding.
    let frozenCount = 0;
    let skippedCount = 0;
    const frozenMats = new Set<number>();
    for (const mesh of scene.meshes) {
      const mat = mesh.material as any;
      if (mat && !frozenMats.has(mat.uniqueId)) {
        frozenMats.add(mat.uniqueId);
        // Skip freeze for lightmapped materials (they need dynamic light binding)
        if (mat.lightmapTexture) {
          skippedCount++;
          continue;
        }
        // Skip skybox material — its cube texture may still be loading.
        // Freezing a not-ready material locks it permanently in a non-rendering state.
        if (mesh.name === 'skybox') {
          skippedCount++;
          continue;
        }
        mat.freeze();
        frozenCount++;
      }
    }
    console.log(`[MapLoader] Froze ${frozenCount} materials, skipped ${skippedCount} lightmapped (need dynamic lights)`);

    this.currentMap = mapName;
    progress('Complete', `Map ${mapName} loaded successfully`);

    // Find player start position
    let playerStartPosition = new Vector3(0, 50, 0); // Default
    let playerStart = bsp.entities.find(e => e.classname === 'info_player_start');

    // Fallback to deathmatch start
    if (!playerStart) {
      playerStart = bsp.entities.find(e => e.classname === 'info_player_deathmatch');
    }

    if (playerStart && playerStart.properties.origin) {
      const parts = playerStart.properties.origin.split(' ').map(parseFloat);
      if (parts.length === 3 && !parts.some(isNaN)) {
        // Convert Q3 (X, Y, Z) to Babylon (X, Z, Y) because Q3 Z-up -> Babylon Y-up
        playerStartPosition = new Vector3(parts[0], parts[2], parts[1]);
      }
    }

    // Pre-compile all shader permutations used during gameplay:
    // - BSP lightmap + useLightmapAsShadowmap (with AND without dynamic PointLight)
    // - Trail ribbons, explosions, impacts, shockwaves
    // This runs BEFORE scene.whenReadyAsync() so shader compilations from warm-up
    // are included in the readiness check.
    progress('Finalizing', 'Warming up effect shaders');
    try {
      const { preloadEffectShaders } = await import('../../weapon/EffectPreloader');
      await preloadEffectShaders(scene);
    } catch (e) {
      console.warn('[MapLoader] Effect shader warm-up failed, proceeding anyway:', e);
    }

    // Final gate: Wait for scene to be fully ready (all textures GPU-uploaded,
    // all shaders compiled including the warm-up variants above).
    // This keeps the loading screen visible until everything is guaranteed ready.
    progress('Finalizing', 'Waiting for GPU readiness');
    try {
      await scene.whenReadyAsync();
      console.log('[MapLoader] Scene fully ready — all textures and shaders compiled');
    } catch (e) {
      console.warn('[MapLoader] scene.whenReadyAsync() failed, proceeding anyway:', e);
    }

    // Emit loading:complete event
    const completeEvent: LoadingCompleteEvent = {
      type: 'map',
      success: true,
      duration: 0,
    };
    EventBus.emit(LOADING_EVENTS.COMPLETE, completeEvent);

    return {
      success: true,
      mapName,
      mapType: 'bsp',
      bsp,
      meshResult,
      playerStartPosition,
    };
  }

  /**
   * Resolve all PK3 dependencies for a BSP map
   */
  private async resolveMapDependencies(bsp: BspFile): Promise<Set<string>> {
    const requiredPk3s = new Set<string>();
    const loadedPackages = new Set(
      this.pk3Loader.getPackageInfo().map(p => p.filename)
    );

    // Get texture references from BSP
    const textureNames = bsp.textures.map(t => t.name);

    // Find PK3s for textures
    for (const texName of textureNames) {
      // Check if there's a shader for this texture
      const shaderPk3 = this.pk3Index.findShader(texName);
      if (shaderPk3 && !loadedPackages.has(shaderPk3)) {
        requiredPk3s.add(shaderPk3);
      }

      // Check for texture file
      const extensions = ['.tga', '.jpg', '.png', '.ktx'];
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
    const loadedPackages = new Set(
      this.pk3Loader.getPackageInfo().map(p => p.filename)
    );

    const textureNames = bsp.textures.map(t => t.name);

    for (const texName of textureNames) {
      const shader = this.shaderRegistry.getShader(texName);
      if (shader?.skyParms?.farbox) {
        // Sky textures have _ft, _bk, _lf, _rt, _up, _dn suffixes
        // farbox may or may not include "env/" prefix already
        let skyPath = shader.skyParms.farbox;
        if (!skyPath.startsWith('env/')) {
          skyPath = `env/${skyPath}`;
        }

        const suffixes = ['_ft', '_bk', '_lf', '_rt', '_up', '_dn'];
        const extensions = ['.tga', '.jpg', '.png'];

        for (const suffix of suffixes) {
          for (const ext of extensions) {
            const envPath = `${skyPath}${suffix}${ext}`;
            const pk3 = this.pk3Index.findFile(envPath);
            if (pk3 && !loadedPackages.has(pk3)) {
              requiredPk3s.add(pk3);
              console.log(`[MapLoader] Sky texture dependency: ${envPath} -> ${pk3}`);
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
    console.log(`[MapLoader] disposeCurrentMap called at ${Date.now()}`);
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
      const { PK3TextureLoader } = await import('../pk3/PK3TextureLoader');
      PK3TextureLoader.getInstance().clearCache();
      console.log('[MapLoader] Cleared PK3TextureLoader cache');

      const { TextureManager } = await import('../texture/TextureManager');
      TextureManager.getInstance().clearCache();
      console.log('[MapLoader] Cleared TextureManager cache');
    } catch (e) {
      console.warn('[MapLoader] Error clearing caches:', e);
    }
  }

  /**
   * Get list of available maps (from PK3 index)
   */
  getAvailableMaps(): { name: string; pk3: string; type: 'bsp' }[] {
    const maps: { name: string; pk3: string; type: 'bsp' }[] = [];

    const mapNames = this.pk3Index.getMapNames();
    for (const name of mapNames) {
      const pk3 = this.pk3Index.findMap(name);
      if (pk3) {
        maps.push({ name, pk3, type: 'bsp' });
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
  private async processBspEntities(bsp: BspFile, scene: Scene): Promise<void> {
    // Convert BSP entities to EntityData format
    const entityDataList: EntityData[] = bsp.entities.map(e => ({
      classname: e.classname,
      properties: e.properties,
    }));

    // Run pre-render hooks (game-specific initialization)
    await EntityHandlerRegistry.runPreRenderHooks(entityDataList, scene);

    // Process each entity through registered handlers
    let handledCount = 0;
    for (const entity of entityDataList) {
      const handler = EntityHandlerRegistry.getHandler(entity.classname);
      if (handler) {
        try {
          const result = await handler(entity, scene);
          if (result.handled) {
            handledCount++;
          }
        } catch (e) {
          console.warn(`[MapLoader] Entity handler failed for '${entity.classname}':`, e);
        }
      } else {
        // DEBUG: Log unhandled non-worldspawn entities
        if (entity.classname !== 'worldspawn' && !entity.classname.startsWith('info_')) {
          console.warn(`[MapLoader] No handler for entity: ${entity.classname}`);
        }
      }
    }

    if (handledCount > 0) {
      console.log(`[MapLoader] Processed ${handledCount} BSP entities via EntityHandlerRegistry`);
    }

    // Log registered handlers for debugging
    const registered = EntityHandlerRegistry.getRegisteredClassnames();
    if (registered.length > 0) {
      console.log(`[MapLoader] Available entity handlers: ${registered.join(', ')}`);
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

      const modelPath = (def as any).modelPath as string | undefined;
      if (!modelPath || seenModels.has(modelPath)) continue;
      seenModels.add(modelPath);

      // Find which PK3 contains this model
      const pk3 = this.pk3Index.findFile(modelPath);
      if (pk3) {
        requiredPk3s.add(pk3);
        console.log(`[MapLoader] Entity model dependency: ${modelPath} → ${pk3}`);
      } else {
        console.warn(`[MapLoader] No PK3 found for entity model: ${modelPath}`);
      }
    }

    if (requiredPk3s.size > 0) {
      console.log(`[MapLoader] Resolved ${requiredPk3s.size} entity model PK3(s): ${[...requiredPk3s].join(', ')}`);
    }

    return requiredPk3s;
  }

  // NOTE: buildClipBrushMeshes, brushToBounds, intersectPlanes, and isInsideAllPlanes
  // were disabled for testing and have been removed. See git history if needed.

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
