/**
 * BspManager - High-level BSP map management
 *
 * Coordinates BSP loading, rendering, and querying across subsystems:
 * - BspLoader: Parses BSP files
 * - BspMeshBuilder: Creates renderable meshes
 * - PVSCuller: Visibility culling
 * - Collision: Physics collision detection
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PK3Loader } from "../pk3/PK3Loader";
import { type BspFile, type BspLightVol, BspLoader } from "./BspLoader";
import { BspMeshBuilder, type BspMeshBuildResult } from "./BspMeshBuilder";

export interface BspLoadOptions {
  autoLoadPK3?: boolean;
}

export interface BspRenderOptions {
  faceTypes?: number[];
  filterTextures?: boolean;
}

export interface BspManagerState {
  bsp: BspFile | null;
  meshResult: BspMeshBuildResult | null;
  mapName: string | null;
}

/**
 * Singleton manager for BSP map operations
 */
export class BspManager {
  private static instance: BspManager | null = null;

  private loadedBsp: BspFile | null = null;
  private meshResult: BspMeshBuildResult | null = null;
  private currentMapName: string | null = null;

  private constructor() {}

  static getInstance(): BspManager {
    if (!BspManager.instance) {
      BspManager.instance = new BspManager();
    }
    return BspManager.instance;
  }

  // ============================================================================
  // State Access
  // ============================================================================

  getBsp(): BspFile | null {
    return this.loadedBsp;
  }

  /**
   * Get current mesh result
   */
  // biome-ignore lint/suspicious/noExplicitAny: Babylon.js internal API access
  getMeshResult(): any {
    return this.meshResult;
  }

  /**
   * Set mesh result (used by MapLoader)
   */
  // biome-ignore lint/suspicious/noExplicitAny: Babylon.js internal API access
  setMeshResult(result: any): void {
    this.meshResult = result;
  }

  /**
   * Set already-loaded BSP data (used by MapLoader)
   */
  setBsp(mapName: string, bsp: BspFile): void {
    this.loadedBsp = bsp;
    this.currentMapName = mapName;
  }

  getMapName(): string | null {
    return this.currentMapName;
  }

  getState(): BspManagerState {
    return {
      bsp: this.loadedBsp,
      meshResult: this.meshResult,
      mapName: this.currentMapName,
    };
  }

  isLoaded(): boolean {
    return this.loadedBsp !== null;
  }

  isRendered(): boolean {
    return this.meshResult !== null;
  }

  // ============================================================================
  // Loading
  // ============================================================================

  /**
   * Load a BSP map by name
   */
  async load(mapName: string, options: BspLoadOptions = {}): Promise<string> {
    const pk3 = PK3Loader.getInstance();
    const { autoLoadPK3 = true } = options;

    // Check if map PK3 is loaded, if not load it
    if (autoLoadPK3) {
      const pk3Name = `map_${mapName}.pk3`;
      const packages = pk3.getPackageInfo();
      const isLoaded = packages.some((p) => p.filename === pk3Name);

      if (!isLoaded) {
        try {
          await pk3.loadPK3(pk3Name);
        } catch (e) {
          throw new Error(`Failed to load PK3 ${pk3Name}: ${e}`);
        }
      }
    }

    // Load BSP from PK3
    const bspPath = `maps/${mapName}.bsp`;
    const bsp = await BspLoader.loadFromPK3(pk3, bspPath);

    if (!bsp) {
      throw new Error(`Failed to load BSP: ${bspPath}`);
    }

    this.loadedBsp = bsp;
    this.currentMapName = mapName;

    return this.getLoadSummary();
  }

  /**
   * Get summary of loaded BSP
   */
  getLoadSummary(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const bsp = this.loadedBsp;
    const format = bsp.header.isFBSP ? "FBSP" : "IBSP";

    return [
      `Format: ${format} v${bsp.header.version}`,
      `Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`,
      `Entities: ${bsp.entities.length}`,
      `Faces: ${bsp.faces.length}`,
      `Vertices: ${bsp.vertices.length}`,
      `Lightmaps: ${bsp.lightmaps.length}`,
      `Textures: ${bsp.textures.length}`,
    ].join("\n");
  }

  // ============================================================================
  // Info Queries
  // ============================================================================

  getInfo(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const bsp = this.loadedBsp;
    const format = bsp.header.isFBSP ? "FBSP" : "IBSP";

    return [
      `=== BSP Info ===`,
      `Format: ${format} v${bsp.header.version}`,
      `Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`,
      "",
      `Entities: ${bsp.entities.length}`,
      `Textures: ${bsp.textures.length}`,
      `Planes: ${bsp.planes.length}`,
      `Nodes: ${bsp.nodes.length}`,
      `Leafs: ${bsp.leafs.length}`,
      `Models: ${bsp.models.length}`,
      `Brushes: ${bsp.brushes.length}`,
      `Vertices: ${bsp.vertices.length}`,
      `Faces: ${bsp.faces.length}`,
      `MeshVerts: ${bsp.meshVerts.length}`,
      `Lightmaps: ${bsp.lightmaps.length}`,
      `LightVols: ${bsp.lightVols.length}`,
      `VisData: ${bsp.visData ? `${bsp.visData.numClusters} clusters` : "none"}`,
    ].join("\n");
  }

  getFaceStats(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const counts = { polygon: 0, patch: 0, mesh: 0, billboard: 0 };
    for (const face of this.loadedBsp.faces) {
      switch (face.faceType) {
        case 1:
          counts.polygon++;
          break;
        case 2:
          counts.patch++;
          break;
        case 3:
          counts.mesh++;
          break;
        case 4:
          counts.billboard++;
          break;
      }
    }

    return [
      `=== Face Types ===`,
      `Polygons (type 1): ${counts.polygon}`,
      `Patches (type 2): ${counts.patch}`,
      `Meshes (type 3): ${counts.mesh}`,
      `Billboards (type 4): ${counts.billboard}`,
      `Total: ${this.loadedBsp.faces.length}`,
    ].join("\n");
  }

  getEntities(filter?: string, showDetails = false): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    // If showing details for a specific classname
    if (filter && showDetails) {
      const matching = this.loadedBsp.entities.filter((e) => e.classname.toLowerCase().includes(filter.toLowerCase()));

      if (matching.length === 0) {
        return `No entities matching "${filter}"`;
      }

      const lines = [`=== Entities matching "${filter}" (${matching.length}) ===`];
      for (const ent of matching.slice(0, 10)) {
        lines.push(`\n[${ent.classname}]`);
        for (const [key, value] of Object.entries(ent.properties)) {
          lines.push(`  ${key}: ${value}`);
        }
      }
      if (matching.length > 10) {
        lines.push(`\n... and ${matching.length - 10} more`);
      }
      return lines.join("\n");
    }

    // Count entity types
    const entityTypes: Record<string, number> = {};
    for (const ent of this.loadedBsp.entities) {
      if (filter && !ent.classname.toLowerCase().includes(filter.toLowerCase())) continue;
      entityTypes[ent.classname] = (entityTypes[ent.classname] || 0) + 1;
    }

    const sorted = Object.entries(entityTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    const lines = [`=== Entity Types${filter ? ` (filter: ${filter})` : ""} ===`];
    for (const [type, count] of sorted) {
      lines.push(`  ${type}: ${count}`);
    }

    const total = Object.values(entityTypes).reduce((a, b) => a + b, 0);
    if (sorted.length < Object.keys(entityTypes).length) {
      lines.push(`  ... and ${Object.keys(entityTypes).length - sorted.length} more types`);
    }
    lines.push(`Total: ${total}`);

    return lines.join("\n");
  }

  getTextures(filter?: string): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    let textures = this.loadedBsp.textures.map((tex, i) => ({ index: i, name: tex.name }));

    if (filter) {
      textures = textures.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()));
    }

    const lines = filter
      ? [`=== Textures matching "${filter}" (${textures.length} of ${this.loadedBsp.textures.length}) ===`]
      : [`=== All Textures (${this.loadedBsp.textures.length}) ===`];

    textures.forEach((tex) => {
      lines.push(`${tex.index}: ${tex.name}`);
    });

    if (textures.length === 0) {
      lines.push(`  No textures found${filter ? ` matching "${filter}"` : ""}`);
    }

    return lines.join("\n");
  }

  getWorldspawn(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const worldspawn = this.loadedBsp.entities.find((e) => e.classname === "worldspawn");
    if (!worldspawn) {
      return "No worldspawn entity found";
    }

    const lines = ["=== Worldspawn Properties ==="];
    for (const [key, value] of Object.entries(worldspawn.properties)) {
      if (key !== "classname") {
        lines.push(`  ${key}: ${value}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get a specific worldspawn property value
   */
  getWorldspawnProperty(key: string): string | undefined {
    if (!this.loadedBsp) return undefined;
    const worldspawn = this.loadedBsp.entities.find((e) => e.classname === "worldspawn");
    return worldspawn?.properties[key];
  }

  getClusterInfo(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const vis = this.loadedBsp.visData;
    if (!vis) {
      return "No visibility data in this BSP";
    }

    // Count leafs per cluster
    const clusterLeafs: Record<number, number> = {};
    for (const leaf of this.loadedBsp.leafs) {
      if (leaf.cluster >= 0) {
        clusterLeafs[leaf.cluster] = (clusterLeafs[leaf.cluster] || 0) + 1;
      }
    }

    return [
      `=== PVS Cluster Info ===`,
      `Total clusters: ${vis.numClusters}`,
      `Bytes per cluster: ${vis.bytesPerCluster}`,
      `PVS data size: ${vis.bitVectors.length} bytes`,
      `Leafs with clusters: ${Object.keys(clusterLeafs).length}`,
      `Leafs outside world: ${this.loadedBsp.leafs.filter((l) => l.cluster < 0).length}`,
    ].join("\n");
  }

  getLightmapInfo(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const count = this.loadedBsp.lightmaps.length;
    const size = this.loadedBsp.lightmapSize;
    const bytesEach = size * size * 3;
    const totalMB = ((count * bytesEach) / 1024 / 1024).toFixed(2);

    // Count faces using lightmaps
    const lmFaces = this.loadedBsp.faces.filter((f) => f.lightmapIndex >= 0).length;

    return [
      `=== Lightmap Info ===`,
      `Count: ${count}`,
      `Size: ${size}x${size} (${this.loadedBsp.header.isFBSP ? "FBSP" : "IBSP"})`,
      `Format: RGB (3 bytes/pixel)`,
      `Total size: ${totalMB} MB`,
      `Faces using lightmaps: ${lmFaces}`,
    ].join("\n");
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Render BSP to scene
   */
  render(scene: Scene, options: BspRenderOptions = {}): string {
    if (!this.loadedBsp) {
      throw new Error("No BSP loaded");
    }

    // Clear previous render
    this.clearRender();

    try {
      this.meshResult = BspMeshBuilder.build(this.loadedBsp, scene, {
        faceTypes: options.faceTypes,
        filterTextures: options.filterTextures ?? true,
      });

      const filterInfo = options.faceTypes ? ` (types: ${options.faceTypes.join(",")})` : "";

      return [
        `=== BSP Rendered${filterInfo} ===`,
        `Vertices: ${this.meshResult.stats.totalVertices}`,
        `Triangles: ${this.meshResult.stats.totalTriangles}`,
        `Lightmaps: ${this.meshResult.lightmapTextures.length}`,
        `Faces: ${this.meshResult.stats.polygonFaces} poly, ${this.meshResult.stats.patchFaces} patch, ${this.meshResult.stats.meshFaces} mesh`,
      ].join("\n");
    } catch (e) {
      throw new Error(`Render failed: ${e}`);
    }
  }

  /**
   * Clear rendered BSP geometry
   */
  clearRender(): void {
    if (this.meshResult) {
      this.meshResult.worldMesh.dispose();
      for (const tex of this.meshResult.lightmapTextures) {
        tex.dispose();
      }
      this.meshResult = null;
    }
  }

  /**
   * Apply textures to rendered BSP
   */
  async applyTextures(
    scene: Scene,
    onProgress?: (loaded: number, total: number, name: string) => void,
  ): Promise<number> {
    if (!this.loadedBsp || !this.meshResult) {
      throw new Error("No BSP rendered");
    }

    return BspMeshBuilder.applyTextures(this.meshResult, this.loadedBsp, scene, onProgress);
  }

  /**
   * Apply lightmaps to rendered BSP
   */
  applyLightmaps(intensity = 2.0): number {
    if (!this.meshResult) {
      throw new Error("No BSP rendered");
    }

    return BspMeshBuilder.applyLightmaps(this.meshResult, {
      intensity,
    });
  }

  /**
   * Set lightmap intensity for day/night cycle
   * @param intensity 0.0-1.0 (or higher for overbright)
   */
  setLightmapIntensity(intensity: number): void {
    if (!this.meshResult?.worldMesh) {
      return;
    }

    // BSP materials are on child meshes, not the parent worldMesh
    const childMeshes = this.meshResult.worldMesh.getChildMeshes();
    let _count = 0;

    for (const mesh of childMeshes) {
      // biome-ignore lint/suspicious/noExplicitAny: BSP loader internals
      const mat = mesh.material as any;
      if (!mat) continue;

      // Store original colors on first call
      if (mat._origDiffuse === undefined && mat.diffuseColor) {
        mat._origDiffuse = mat.diffuseColor.clone();
      }
      if (mat._origEmissive === undefined && mat.emissiveColor) {
        mat._origEmissive = mat.emissiveColor.clone();
      }

      // Modulate diffuse color by intensity
      if (mat._origDiffuse) {
        mat.diffuseColor.r = mat._origDiffuse.r * intensity;
        mat.diffuseColor.g = mat._origDiffuse.g * intensity;
        mat.diffuseColor.b = mat._origDiffuse.b * intensity;
        _count++;
      }

      // Also try lightmap level as backup
      if (mat.lightmapTexture) {
        mat.lightmapTexture.level = intensity;
      }
    }
  }

  /**
   * Get the scene the BSP is rendered in
   */
  getScene(): Scene | null {
    return this.meshResult?.worldMesh?.getScene() ?? null;
  }

  /**
   * Get center position of the map
   */
  getMapCenter(): Vector3 | null {
    if (!this.loadedBsp) return null;

    const world = this.loadedBsp.models[0];
    if (!world) return null;

    return new Vector3(
      (world.mins[0] + world.maxs[0]) / 2,
      (world.mins[2] + world.maxs[2]) / 2, // Z -> Y
      (world.mins[1] + world.maxs[1]) / 2, // Y -> Z
    );
  }

  /**
   * Get lighting information (LightGrid) at a specific Babylon.js position
   */
  getLightingAt(position: Vector3): BspLightVol | null {
    if (!this.loadedBsp || !this.loadedBsp.lightGridOrigin) {
      return null;
    }

    const bsp = this.loadedBsp;
    const origin = bsp.lightGridOrigin!;
    const size = bsp.lightGridSize!;
    const step = bsp.lightGridStep!;

    // Convert Babylon (Y-up) to Q3 (Z-up)
    // Babylon: X, Y, Z -> Q3: X, Z, Y
    const qx = position.x;
    const qy = position.z;
    const qz = position.y;

    // Calculate grid coordinates (floating point)
    const gx = (qx - origin[0]) / step[0];
    const gy = (qy - origin[1]) / step[1];
    const gz = (qz - origin[2]) / step[2];

    // Integer base
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const z0 = Math.floor(gz);

    // Fractions
    const fx = gx - x0;
    const fy = gy - y0;
    const fz = gz - z0;

    // Bounds check
    const nx = size[0];
    const ny = size[1];
    const nz = size[2];

    if (x0 < 0 || x0 >= nx - 1 || y0 < 0 || y0 >= ny - 1 || z0 < 0 || z0 >= nz - 1) {
      // Return nearest if out of interpolation bounds but inside grid
      // Or just return null if completely outside
      if (x0 < -1 || x0 >= nx || y0 < -1 || y0 >= ny || z0 < -1 || z0 >= nz) {
        return null;
      }
      // Fallback to nearest for edge cases
      const ix = Math.max(0, Math.min(nx - 1, Math.round(gx)));
      const iy = Math.max(0, Math.min(ny - 1, Math.round(gy)));
      const iz = Math.max(0, Math.min(nz - 1, Math.round(gz)));
      const idx = ix + iy * nx + iz * nx * ny;
      return bsp.lightVols[idx];
    }

    // Helper to get index
    const getIdx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;

    // Sample 8 neighbors
    const c000 = bsp.lightVols[getIdx(x0, y0, z0)];
    const c100 = bsp.lightVols[getIdx(x0 + 1, y0, z0)];
    const c010 = bsp.lightVols[getIdx(x0, y0 + 1, z0)];
    const c110 = bsp.lightVols[getIdx(x0 + 1, y0 + 1, z0)];
    const c001 = bsp.lightVols[getIdx(x0, y0, z0 + 1)];
    const c101 = bsp.lightVols[getIdx(x0 + 1, y0, z0 + 1)];
    const c011 = bsp.lightVols[getIdx(x0, y0 + 1, z0 + 1)];
    const c111 = bsp.lightVols[getIdx(x0 + 1, y0 + 1, z0 + 1)];

    // Linear interpolation helper
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Interpolate Ambient and Directional Color
    const interpColor = (c0: number[], c1: number[], t: number) => [
      lerp(c0[0], c1[0], t),
      lerp(c0[1], c1[1], t),
      lerp(c0[2], c1[2], t),
    ];

    // Trilinear interpolation for Ambient
    // Lerp X
    const amb00 = interpColor(c000.ambient, c100.ambient, fx);
    const amb01 = interpColor(c001.ambient, c101.ambient, fx);
    const amb10 = interpColor(c010.ambient, c110.ambient, fx);
    const amb11 = interpColor(c011.ambient, c111.ambient, fx);
    // Lerp Y
    const amb0 = interpColor(amb00, amb10, fy);
    const amb1 = interpColor(amb01, amb11, fy);
    // Lerp Z
    const finalAmb = interpColor(amb0, amb1, fz);

    // Trilinear interpolation for Directional Color
    // Lerp X
    const dir00 = interpColor(c000.directional, c100.directional, fx);
    const dir01 = interpColor(c001.directional, c101.directional, fx);
    const dir10 = interpColor(c010.directional, c110.directional, fx);
    const dir11 = interpColor(c011.directional, c111.directional, fx);
    // Lerp Y
    const dir0 = interpColor(dir00, dir10, fy);
    const dir1 = interpColor(dir01, dir11, fy);
    // Lerp Z
    const finalDirColor = interpColor(dir0, dir1, fz);

    // Direction Vector Interpolation
    // This is more complex because they are spherical coords (theta, phi)
    // For simplicity, we'll just pick the nearest neighbor direction or average them roughly
    // Averaging angles is tricky due to wrap-around, but for small grid steps it might be okay.
    // Better: Convert to vector, average vectors, convert back.

    // For now, let's use nearest neighbor for DIRECTION VECTOR only, but interpolated INTENSITY (color)
    // This avoids weird spinning lights between grid points
    const nearestDir =
      fx < 0.5
        ? fy < 0.5
          ? fz < 0.5
            ? c000.direction
            : c001.direction
          : fz < 0.5
            ? c010.direction
            : c011.direction
        : fy < 0.5
          ? fz < 0.5
            ? c100.direction
            : c101.direction
          : fz < 0.5
            ? c110.direction
            : c111.direction;

    // However, if we are in a spot where one neighbor has direction and others don't (0,0),
    // we should prefer the one that has light.
    // Let's stick to nearest for now.

    return {
      ambient: [finalAmb[0], finalAmb[1], finalAmb[2]],
      directional: [finalDirColor[0], finalDirColor[1], finalDirColor[2]],
      direction: nearestDir, // Keep original byte array format
    };
  }

  // ============================================================================
  // Sky
  // ============================================================================

  getSkyInfo(): string {
    if (!this.meshResult) {
      return "No BSP rendered";
    }

    const skyShaders = this.meshResult.skyShaders;
    if (skyShaders.length === 0) {
      return "No sky shaders found in this map.";
    }

    const lines = [`=== Sky Shaders (${skyShaders.length}) ===`];
    for (const sky of skyShaders) {
      lines.push(`  ${sky.textureName}`);
      if (sky.skyParms) {
        lines.push(`    farbox: ${sky.skyParms.farbox || "(none)"}`);
        lines.push(`    cloudHeight: ${sky.skyParms.cloudHeight || 0}`);
        lines.push(`    nearbox: ${sky.skyParms.nearbox || "(none)"}`);
      }
    }
    return lines.join("\n");
  }

  async applySkybox(scene: Scene): Promise<{ success: boolean; error?: string }> {
    if (!this.meshResult) {
      return { success: false, error: "No BSP rendered" };
    }

    return BspMeshBuilder.applySkybox(this.meshResult, scene);
  }

  // ============================================================================
  // Fog
  // ============================================================================

  getFogInfo(): string {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const effects = this.loadedBsp.effects;
    if (effects.length === 0) {
      return "No effects (fog) entries in this BSP.";
    }

    const lines: string[] = ["Effects lump entries:"];
    for (let i = 0; i < Math.min(effects.length, 20); i++) {
      const eff = effects[i];
      lines.push(`  [${i}] "${eff.name}" brush=${eff.brushIndex}`);
    }
    if (effects.length > 20) {
      lines.push(`  ... and ${effects.length - 20} more`);
    }
    return lines.join("\n");
  }

  async applyFogVolumes(scene: Scene): Promise<{ success: boolean; count: number; error?: string }> {
    if (!this.meshResult) {
      return { success: false, count: 0, error: "No BSP rendered" };
    }

    const result = await BspMeshBuilder.applyFogVolumes(this.meshResult, scene);
    return {
      success: result.success,
      count: result.fogMeshes?.length || 0,
      error: result.error,
    };
  }

  clearFogVolumes(): void {
    if (!this.meshResult?.fogVolumes) return;

    for (const mesh of this.meshResult.fogVolumes) {
      if (mesh.material) {
        mesh.material.dispose();
      }
      mesh.dispose();
    }
    this.meshResult.fogVolumes = [];
  }

  // ============================================================================
  // PVS Culling
  // ============================================================================

  private pvsCuller: import("./PVSCuller").PVSCuller | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Babylon.js internal API access
  private pvsObserver: any = null;

  /**
   * Initialize PVS culling system
   */
  async initPVS(): Promise<string | null> {
    console.log(`[PVS] initPVS called: loadedBsp=${!!this.loadedBsp}, meshResult=${!!this.meshResult}`);

    if (!this.loadedBsp) {
      return "No BSP loaded";
    }
    if (!this.meshResult) {
      console.log(`[PVS] BSP loaded but not rendered. Current map: ${this.currentMapName}`);
      return "BSP not rendered yet - try waiting a moment";
    }

    if (!this.pvsCuller) {
      const { createPVSCuller } = await import("./PVSCuller");
      this.pvsCuller = createPVSCuller(this.loadedBsp);
      if (this.pvsCuller) {
        this.pvsCuller.registerFromWorldMesh(this.meshResult.worldMesh);
      }
    }

    return this.pvsCuller ? null : "Failed to create PVS culler";
  }

  /**
   * Enable PVS culling with automatic updates
   */
  async enablePVS(scene: Scene, camera: import("@babylonjs/core/Cameras/camera").Camera): Promise<string> {
    if (!this.loadedBsp) {
      return "No BSP loaded. Load a map first.";
    }

    const error = await this.initPVS();
    if (error || !this.pvsCuller) {
      return error || "PVS data not available in this map";
    }

    this.pvsCuller.setEnabled(true);

    // Start update loop
    if (!this.pvsObserver) {
      this.pvsObserver = scene.onBeforeRenderObservable.add(() => {
        if (this.pvsCuller?.isEnabled() && camera) {
          this.pvsCuller.update(camera.position);
        }
      });
    }

    return "PVS culling: ON";
  }

  /**
   * Disable PVS culling
   */
  disablePVS(scene: Scene): string {
    if (this.pvsCuller) {
      this.pvsCuller.setEnabled(false);
    }

    if (this.pvsObserver) {
      scene.onBeforeRenderObservable.remove(this.pvsObserver);
      this.pvsObserver = null;
    }

    return "PVS culling: OFF";
  }

  /**
   * Get PVS status
   */
  getPVSStatus(camera?: import("@babylonjs/core/Cameras/camera").Camera): string {
    if (!this.pvsCuller) {
      if (!this.loadedBsp) {
        return "No BSP loaded";
      }
      return this.loadedBsp.visData
        ? `PVS available: ${this.loadedBsp.visData.numClusters} clusters (not initialized)`
        : "No PVS data in this map";
    }

    // Force update for fresh stats
    if (camera) {
      this.pvsCuller.update(camera.position);
    }

    const stats = this.pvsCuller.getStats();
    const culledPct = stats.totalMeshes > 0 ? ((stats.culledMeshes / stats.totalMeshes) * 100).toFixed(1) : "0";

    return [
      "=== PVS Culling Status ===",
      `Enabled: ${stats.enabled ? "YES" : "NO"}`,
      `Current cluster: ${stats.currentCluster}`,
      `Total clusters: ${stats.totalClusters}`,
      `Visible clusters: ${stats.visibleClusters}`,
      "",
      `Total meshes: ${stats.totalMeshes}`,
      `Visible meshes: ${stats.visibleMeshes}`,
      `Culled meshes: ${stats.culledMeshes} (${culledPct}%)`,
      `Update time: ${stats.lastUpdateTime.toFixed(2)}ms`,
    ].join("\n");
  }

  /**
   * Get current cluster info for camera position
   */
  async getCameraClusterInfo(camera: import("@babylonjs/core/Cameras/camera").Camera): Promise<string> {
    if (!this.loadedBsp) {
      return "No BSP loaded";
    }

    const { findLeafForPoint } = await import("./BspLoader");
    const q3Pos: [number, number, number] = [camera.position.x, camera.position.z, camera.position.y];
    const leaf = findLeafForPoint(q3Pos, this.loadedBsp.nodes, this.loadedBsp.leafs, this.loadedBsp.planes);

    if (!leaf) {
      return "Camera position not in BSP tree (outside world?)";
    }

    const visData = this.loadedBsp.visData;
    let visibleCount = 0;
    if (visData && leaf.cluster >= 0) {
      for (let i = 0; i < visData.numClusters; i++) {
        const byteIdx = leaf.cluster * visData.bytesPerCluster + Math.floor(i / 8);
        const bitIdx = i % 8;
        if (visData.bitVectors[byteIdx] & (1 << bitIdx)) {
          visibleCount++;
        }
      }
    }

    return [
      `=== Current Cluster Info ===`,
      `Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`,
      `Cluster: ${leaf.cluster}`,
      `Area: ${leaf.area}`,
      `Leaf bounds:`,
      `  min: (${leaf.mins.join(", ")})`,
      `  max: (${leaf.maxs.join(", ")})`,
      `Faces in leaf: ${leaf.numLeafFaces}`,
      `Brushes in leaf: ${leaf.numLeafBrushes}`,
      visData ? `Visible clusters: ${visibleCount} / ${visData.numClusters}` : "No PVS data",
    ].join("\n");
  }

  /**
   * Get PVS culler instance (for advanced usage)
   */
  getPVSCuller(): import("./PVSCuller").PVSCuller | null {
    return this.pvsCuller;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Unload everything
   */
  unload(): void {
    this.clearRender();
    this.loadedBsp = null;
    this.currentMapName = null;
    this.pvsCuller = null;
    this.pvsObserver = null;
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    if (BspManager.instance) {
      BspManager.instance.unload();
      BspManager.instance = null;
    }
  }
}
