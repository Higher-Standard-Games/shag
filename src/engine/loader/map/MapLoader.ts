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

import { Scene, Mesh, VertexData } from 'babylonjs';
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
    // Mesh and VertexData imported at top of file
    
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
      
      // Generate mesh from brush planes
      const vertices = this.brushToVertices(brush, bsp);
      if (vertices.length < 4) {
        // Debug: log why we're skipping
        if (debugChecked < 10) {
          console.log(`[ClipBrush] Brush ${bi}: Only ${vertices.length} vertices (need 4+), sides=${brush.numSides}`);
        }
        continue;
      }
      
      try {
        // Create convex hull mesh from vertices
        const mesh = new Mesh(`clip_brush_${bi}`, scene);
        
        // For simple collision, create a convex hull
        // Use vertex data to create the mesh
        const positions: number[] = [];
        const indices: number[] = [];
        
        // Add all vertices
        for (const v of vertices) {
          positions.push(v[0], v[2], v[1]); // Q3 to Babylon: (x,y,z) -> (x,z,y)
        }
        
        // Create simple triangle fan from center (approximate convex hull)
        if (vertices.length >= 4) {
          // Calculate center
          let cx = 0, cy = 0, cz = 0;
          for (const v of vertices) {
            cx += v[0]; cy += v[1]; cz += v[2];
          }
          cx /= vertices.length;
          cy /= vertices.length;
          cz /= vertices.length;
          
          // Add center vertex
          const centerIdx = vertices.length;
          positions.push(cx, cz, cy); // Q3 to Babylon conversion
          
          // Create triangles from center to each edge
          for (let i = 0; i < vertices.length; i++) {
            const next = (i + 1) % vertices.length;
            indices.push(centerIdx, i, next);
            indices.push(centerIdx, next, i); // Double-sided
          }
        }
        
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.applyToMesh(mesh);
        
        // Make invisible but enable collision
        mesh.isVisible = false;
        mesh.checkCollisions = true;
        mesh.metadata = { isClipBrush: true, brushIndex: bi };
        
        meshCount++;
      } catch (e) {
        // Skip invalid brushes
        console.warn(`[ClipBrush] Failed to create mesh for brush ${bi}:`, e);
      }
    }
    
    console.log(`[ClipBrush] Summary: byFlag=${debugClipByFlag}, byName=${debugClipByName}, generated=${meshCount}`);
    
    return meshCount;
  }
  
  /**
   * Convert brush planes to vertex positions
   */
  private brushToVertices(brush: any, bsp: BspFile): [number, number, number][] {
    const vertices: [number, number, number][] = [];
    const planes: { normal: [number, number, number]; dist: number }[] = [];
    
    // Collect all planes for this brush
    for (let i = 0; i < brush.numSides; i++) {
      const side = bsp.brushSides[brush.firstSide + i];
      if (!side) continue;
      const plane = bsp.planes[side.planeIndex];
      if (!plane) continue;
      planes.push({
        normal: [plane.normal[0], plane.normal[1], plane.normal[2]],
        dist: plane.dist
      });
    }
    
    if (planes.length < 4) return vertices;
    
    // Find vertices by intersecting every combination of 3 planes
    for (let i = 0; i < planes.length - 2; i++) {
      for (let j = i + 1; j < planes.length - 1; j++) {
        for (let k = j + 1; k < planes.length; k++) {
          const vertex = this.intersectThreePlanes(planes[i], planes[j], planes[k]);
          if (vertex && this.isVertexInsideBrush(vertex, planes)) {
            // Check for duplicate
            let isDupe = false;
            for (const v of vertices) {
              const dx = v[0] - vertex[0];
              const dy = v[1] - vertex[1];
              const dz = v[2] - vertex[2];
              if (dx*dx + dy*dy + dz*dz < 1) {
                isDupe = true;
                break;
              }
            }
            if (!isDupe) {
              vertices.push(vertex);
            }
          }
        }
      }
    }
    
    return vertices;
  }
  
  /**
   * Intersect three planes to find a point
   */
  private intersectThreePlanes(
    p1: { normal: [number, number, number]; dist: number },
    p2: { normal: [number, number, number]; dist: number },
    p3: { normal: [number, number, number]; dist: number }
  ): [number, number, number] | null {
    // Cross product of p2.normal and p3.normal
    const n2xn3 = [
      p2.normal[1] * p3.normal[2] - p2.normal[2] * p3.normal[1],
      p2.normal[2] * p3.normal[0] - p2.normal[0] * p3.normal[2],
      p2.normal[0] * p3.normal[1] - p2.normal[1] * p3.normal[0]
    ];
    
    // Denominator: dot(p1.normal, n2xn3)
    const denom = p1.normal[0] * n2xn3[0] + p1.normal[1] * n2xn3[1] + p1.normal[2] * n2xn3[2];
    
    if (Math.abs(denom) < 0.0001) return null; // Planes don't intersect at a point
    
    // Cross products for numerator
    const n3xn1 = [
      p3.normal[1] * p1.normal[2] - p3.normal[2] * p1.normal[1],
      p3.normal[2] * p1.normal[0] - p3.normal[0] * p1.normal[2],
      p3.normal[0] * p1.normal[1] - p3.normal[1] * p1.normal[0]
    ];
    const n1xn2 = [
      p1.normal[1] * p2.normal[2] - p1.normal[2] * p2.normal[1],
      p1.normal[2] * p2.normal[0] - p1.normal[0] * p2.normal[2],
      p1.normal[0] * p2.normal[1] - p1.normal[1] * p2.normal[0]
    ];
    
    const invDenom = 1.0 / denom;
    return [
      (p1.dist * n2xn3[0] + p2.dist * n3xn1[0] + p3.dist * n1xn2[0]) * invDenom,
      (p1.dist * n2xn3[1] + p2.dist * n3xn1[1] + p3.dist * n1xn2[1]) * invDenom,
      (p1.dist * n2xn3[2] + p2.dist * n3xn1[2] + p3.dist * n1xn2[2]) * invDenom
    ];
  }
  
  /**
   * Check if a vertex is inside (or on) all brush planes
   * Note: BSP brush planes point outward, so inside = negative distance from all planes
   * But FBSP might use different convention, so we check both directions
   */
  private isVertexInsideBrush(
    vertex: [number, number, number],
    planes: { normal: [number, number, number]; dist: number }[]
  ): boolean {
    const EPSILON = 1.0; // More lenient epsilon for brush vertex detection
    
    // Count how many planes this vertex is on the "inside" of
    let insideCount = 0;
    let outsideCount = 0;
    
    for (const plane of planes) {
      const dist = 
        vertex[0] * plane.normal[0] +
        vertex[1] * plane.normal[1] +
        vertex[2] * plane.normal[2] -
        plane.dist;
      
      if (dist > EPSILON) outsideCount++;
      else insideCount++;
    }
    
    // Vertex is valid if it's inside most planes (allows for some floating point error)
    // A proper brush vertex should be inside ALL planes, but be lenient
    return outsideCount <= 1; // Allow 1 plane to be "outside" due to precision
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
