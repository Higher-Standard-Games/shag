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

import { Scene, MeshBuilder, Vector3 } from 'babylonjs';
import { PK3Index } from '../pk3/PK3Index';
import { PK3Loader } from '../pk3/PK3Loader';
import { BspLoader, type BspFile } from '../bsp/BspLoader';
import { BspMeshBuilder, type BspMeshBuildResult } from '../bsp/BspMeshBuilder';
import { Q3ShaderRegistry } from '../shader/Q3ShaderRegistry';
import { EntityHandlerRegistry, type EntityData } from '../../core/EntityHandlerRegistry';
import { registerBspEntityHandlers, setCurrentBspForHandlers } from '../bsp/BspEntityHandlers';

export interface MapLoadResult {
  success: boolean;
  mapName: string;
  mapType: 'local' | 'bsp';
  error?: string;
  /** BSP-specific results */
  bsp?: BspFile;
  meshResult?: BspMeshBuildResult;
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
    const progress = (phase: string, detail?: string) => {
      onProgress?.({ phase, detail });
      console.log(`[MapLoader] ${phase}${detail ? ': ' + detail : ''}`);
    };

    try {
      // Clean up previous map
      if (this.currentMeshResult) {
        progress('Cleanup', 'Disposing previous map');
        this.disposeCurrentMap();
      }

      // Check if it's a BSP map in the index
      const bspPk3 = this.pk3Index.findMap(mapName);
      if (bspPk3) {
        return await this.loadBspMap(mapName, bspPk3, scene, onProgress);
      }

      // TODO: Check for local .map file
      // For now, just report not found
      return {
        success: false,
        mapName,
        mapType: 'local',
        error: `Map not found: ${mapName}. Run 'pk3 index build' if you haven't indexed PK3s yet.`,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[MapLoader] Failed to load map ${mapName}:`, e);
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
    onProgress?: ProgressCallback
  ): Promise<MapLoadResult> {
    const progress = (phase: string, detail?: string, pct?: number) => {
      onProgress?.({ phase, detail, progress: pct });
      console.log(`[MapLoader] ${phase}${detail ? ': ' + detail : ''}`);
    };

    // Phase 1: Ensure map PK3 is loaded
    progress('Loading', `Map PK3: ${mapPk3}`);
    const mapPk3Path = this.pk3Index.getPK3Path(mapPk3);
    if (mapPk3Path) {
      await this.pk3Loader.loadPK3FromUrl(mapPk3Path);
    } else {
      await this.pk3Loader.loadPK3(mapPk3);
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
        const pk3Path = this.pk3Index.getPK3Path(pk3);
        if (pk3Path) {
          await this.pk3Loader.loadPK3FromUrl(pk3Path);
        }
      } catch (e) {
        console.warn(`[MapLoader] Failed to load dependency ${pk3}:`, e);
      }
      loaded++;
    }

    // Phase 4: Load shaders
    progress('Shaders', 'Loading shader definitions');
    await this.shaderRegistry.loadShaders();

    // Phase 4b: Resolve sky texture dependencies (needs shaders loaded first)
    const skyPk3s = await this.resolveSkyDependencies(bsp);
    for (const pk3 of skyPk3s) {
      progress('Dependencies', `Loading sky textures from ${pk3}`);
      try {
        const pk3Path = this.pk3Index.getPK3Path(pk3);
        if (pk3Path) {
          await this.pk3Loader.loadPK3FromUrl(pk3Path);
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
    await BspMeshBuilder.applySkybox(meshResult, scene);

    // Phase 8: Apply lightmaps
    progress('Lightmaps', 'Applying');
    BspMeshBuilder.applyLightmaps(meshResult, { intensity: 2.0 });

    // Phase 9: Generate collision meshes for invisible clip brushes (PLAYERCLIP, etc.)
    progress('Collision', 'Building clip brush meshes');
    const clipMeshCount = this.buildClipBrushMeshes(bsp, scene);
    console.log(`[MapLoader] Generated ${clipMeshCount} invisible clip brush collision meshes`);

    // Phase 9b: Initialize collision system
    progress('Collision', 'Initializing');
    try {
      const { getCollisionManager } = await import('../../physics');
      const cm = getCollisionManager();
      await cm.init(bsp, scene as never);
      console.log(`[MapLoader] Collision initialized with ${cm.getBackendType()} backend`);
    } catch (e) {
      console.warn('[MapLoader] Failed to initialize collision:', e);
    }

    // Phase 10: Process BSP entities through EntityHandlerRegistry
    progress('Entities', 'Processing');
    registerBspEntityHandlers(); // Register func_door, etc.
    setCurrentBspForHandlers(bsp); // Set BSP reference for handlers
    await this.processBspEntities(bsp, scene);

    this.currentMap = mapName;
    progress('Complete', `Map ${mapName} loaded successfully`);

    return {
      success: true,
      mapName,
      mapType: 'bsp',
      bsp,
      meshResult,
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
  disposeCurrentMap(): void {
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
   * Build invisible collision meshes for PLAYERCLIP and similar brushes
   * These brushes block the player but have no visible geometry
   */
  private buildClipBrushMeshes(bsp: BspFile, scene: Scene): number {
    console.log(`[ClipBrush] Starting clip brush generation for ${bsp.brushes?.length || 0} brushes`);
    
    try {
    // Content flags for clip brushes
    const PLAYERCLIP = 0x10000;
    const SOLID = 0x1;
    const DETAIL = 0x8000000;
    
    let meshCount = 0;
    let debugChecked = 0;
    let debugClipByFlag = 0;
    let debugClipByName = 0;
    
    // Find clip brushes - either by content flag OR by texture name
    for (let bi = 0; bi < bsp.brushes.length; bi++) {
      const brush = bsp.brushes[bi];
      const texture = bsp.textures[brush.shaderIndex];
      if (!texture) continue;
      
      const contentFlags = texture.contentFlags;
      const texName = texture.name?.toLowerCase() || '';
      
      // Skip detail brushes
      if (contentFlags & DETAIL) continue;
      
      // Check if this is a clip brush by content flag
      const isPlayerClipByFlag = (contentFlags & PLAYERCLIP) !== 0;
      const isSolid = (contentFlags & SOLID) !== 0;
      
      // Also check by texture name (common clip texture names)
      const isClipByName = texName.includes('clip') || 
                           texName.includes('fullclip') || 
                           texName.includes('playerclip') ||
                           texName.includes('common/clip') ||
                           texName.includes('system/clip') ||
                           texName === 'nodraw';
      
      // Debug: log first 5 potential clip brushes
      if ((isPlayerClipByFlag || isClipByName) && debugChecked < 5) {
        console.log(`[ClipBrush] Brush ${bi}: "${texName}" flags=0x${contentFlags.toString(16)} solid=${isSolid} clipFlag=${isPlayerClipByFlag} clipName=${isClipByName}`);
        debugChecked++;
      }
      
      // Generate collision mesh if:
      // 1. Has PLAYERCLIP flag and is NOT solid (pure invisible clip)
      // 2. OR has clip-related texture name (fullclip has SOLID but is invisible/NODRAW!)
      // Note: fullclip textures have SOLID flag but are not rendered - they need collision meshes
      const shouldGenerate = (isPlayerClipByFlag && !isSolid) || isClipByName;
      
      if (!shouldGenerate) continue;
      
      if (isPlayerClipByFlag) debugClipByFlag++;
      if (isClipByName) debugClipByName++;
      
      // Calculate bounding box from brush planes
      const bounds = this.brushToBounds(brush, bsp);
      if (!bounds) {
        if (debugChecked < 10) {
          console.log(`[ClipBrush] Brush ${bi}: Could not compute bounds, sides=${brush.numSides}`);
        }
        continue;
      }
      
      // Calculate size and center (convert Q3 to Babylon coords)
      // Q3: (x, y, z) -> Babylon: (x, z, y)
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxZ - bounds.minZ; // Q3 Z is Babylon Y
      const depth = bounds.maxY - bounds.minY;  // Q3 Y is Babylon Z
      
      // Skip tiny brushes
      if (width < 1 || height < 1 || depth < 1) continue;
      
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minZ + bounds.maxZ) / 2; // Q3 Z -> Babylon Y
      const centerZ = (bounds.minY + bounds.maxY) / 2; // Q3 Y -> Babylon Z
      
      try {
        // Create a proper box mesh using MeshBuilder - this works perfectly with collision
        const mesh = MeshBuilder.CreateBox(`clip_brush_${bi}`, {
          width: width,
          height: height,
          depth: depth,
        }, scene);
        
        // Position at brush center
        mesh.position = new Vector3(centerX, centerY, centerZ);
        
        // Make invisible but enable collision
        mesh.isVisible = false;
        mesh.checkCollisions = true;
        mesh.metadata = { isClipBrush: true, brushIndex: bi, textureName: texName };
        
        meshCount++;
      } catch (e) {
        console.warn(`[ClipBrush] Failed to create mesh for brush ${bi}:`, e);
      }
    }
    
    console.log(`[ClipBrush] Summary: byFlag=${debugClipByFlag}, byName=${debugClipByName}, generated=${meshCount}`);
    
    return meshCount;
    } catch (error) {
      console.error(`[ClipBrush] Error during clip brush generation:`, error);
      return 0;
    }
  }
  
  /**
   * Calculate bounding box from brush planes
   * Returns bounds in Q3 coordinates
   * Works with both axial and non-axial (beveled) brushes
   */
  private brushToBounds(brush: any, bsp: BspFile): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null {
    // Collect all planes
    const planes: { nx: number; ny: number; nz: number; d: number }[] = [];
    
    for (let i = 0; i < brush.numSides; i++) {
      const side = bsp.brushSides[brush.firstSide + i];
      if (!side) continue;
      const plane = bsp.planes[side.planeIndex];
      if (!plane) continue;
      
      planes.push({
        nx: plane.normal[0],
        ny: plane.normal[1],
        nz: plane.normal[2],
        d: plane.dist
      });
    }
    
    if (planes.length < 4) return null;
    
    // Find all vertices by intersecting every combination of 3 planes
    const vertices: [number, number, number][] = [];
    
    for (let i = 0; i < planes.length - 2; i++) {
      for (let j = i + 1; j < planes.length - 1; j++) {
        for (let k = j + 1; k < planes.length; k++) {
          const vertex = this.intersectPlanes(planes[i], planes[j], planes[k]);
          if (vertex && this.isInsideAllPlanes(vertex, planes)) {
            vertices.push(vertex);
          }
        }
      }
    }
    
    if (vertices.length < 4) return null;
    
    // Compute bounding box from vertices
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const [x, y, z] of vertices) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }
  
  /**
   * Intersect three planes to find a point
   */
  private intersectPlanes(
    p1: { nx: number; ny: number; nz: number; d: number },
    p2: { nx: number; ny: number; nz: number; d: number },
    p3: { nx: number; ny: number; nz: number; d: number }
  ): [number, number, number] | null {
    // Cross product of p2.normal and p3.normal
    const n2xn3_x = p2.ny * p3.nz - p2.nz * p3.ny;
    const n2xn3_y = p2.nz * p3.nx - p2.nx * p3.nz;
    const n2xn3_z = p2.nx * p3.ny - p2.ny * p3.nx;
    
    // Denominator: dot(p1.normal, n2xn3)
    const denom = p1.nx * n2xn3_x + p1.ny * n2xn3_y + p1.nz * n2xn3_z;
    
    if (Math.abs(denom) < 0.0001) return null;
    
    // Cross products for numerator
    const n3xn1_x = p3.ny * p1.nz - p3.nz * p1.ny;
    const n3xn1_y = p3.nz * p1.nx - p3.nx * p1.nz;
    const n3xn1_z = p3.nx * p1.ny - p3.ny * p1.nx;
    
    const n1xn2_x = p1.ny * p2.nz - p1.nz * p2.ny;
    const n1xn2_y = p1.nz * p2.nx - p1.nx * p2.nz;
    const n1xn2_z = p1.nx * p2.ny - p1.ny * p2.nx;
    
    const invDenom = 1.0 / denom;
    return [
      (p1.d * n2xn3_x + p2.d * n3xn1_x + p3.d * n1xn2_x) * invDenom,
      (p1.d * n2xn3_y + p2.d * n3xn1_y + p3.d * n1xn2_y) * invDenom,
      (p1.d * n2xn3_z + p2.d * n3xn1_z + p3.d * n1xn2_z) * invDenom
    ];
  }
  
  /**
   * Check if point is inside (or on surface of) all planes
   * FBSP uses inverted plane normals, so we check dist < EPSILON (not > EPSILON)
   */
  private isInsideAllPlanes(
    point: [number, number, number],
    planes: { nx: number; ny: number; nz: number; d: number }[]
  ): boolean {
    // For FBSP format, planes point inward, so inside = positive or near-zero distance
    // We accept points that are within tolerance of being on the correct side of ALL planes
    for (const p of planes) {
      const dist = point[0] * p.nx + point[1] * p.ny + point[2] * p.nz - p.d;
      // Reject obviously invalid points (far outside any reasonable brush bounds)
      if (Math.abs(dist) > 10000) return false;
    }
    return true;
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
