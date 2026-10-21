import { devLog } from "../../core/DevLog";
import { sampleLightGrid, sampleLightGridInto } from "./LightGridSampling";
/**
 * BspManager - High-level BSP map management
 *
 * Coordinates BSP loading, rendering, and querying across subsystems:
 * - BspLoader: Parses BSP files
 * - BspMeshBuilder: Creates renderable meshes
 * - PVSCuller: Visibility culling
 * - Collision: Physics collision detection
 */

import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import RenderVars from "../../rendering/RenderVars";
import { PK3Loader } from "../pk3/PK3Loader";
import { type BspEntity, type BspFile, type BspLightVol, BspLoader } from "./BspLoader";
import { BspMeshBuilder, type BspMeshBuildResult } from "./BspMeshBuilder";
import { createPVSCuller, type PVSCuller } from "./PVSCuller";

/**
 * The material fields setLightmapIntensity reads and writes. Structural because
 * BSP surfaces use more than one material class; `_orig*` are stashed here.
 */
interface LightmapTintMaterial {
  diffuseColor?: Color3;
  emissiveColor?: Color3;
  lightmapTexture?: BaseTexture | null;
  _origDiffuse?: Color3;
  _origEmissive?: Color3;
}

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
  getMeshResult(): BspMeshBuildResult | null {
    return this.meshResult;
  }

  /**
   * Set mesh result (used by MapLoader)
   */
  setMeshResult(result: BspMeshBuildResult | null): void {
    if (this.meshResult !== result) this.disposePVS();
    this.meshResult = result;
  }

  /**
   * Set already-loaded BSP data (used by MapLoader)
   */
  setBsp(mapName: string, bsp: BspFile): void {
    if (this.loadedBsp !== bsp) this.disposePVS();
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

    this.clearRender();
    this.setBsp(mapName, bsp);
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

  /** Typed access to all parsed entities (empty if no BSP is loaded). */
  getRawEntities(): BspEntity[] {
    return this.loadedBsp?.entities ?? [];
  }

  /** The parsed BSP file, or null if none is loaded (for surface extraction). */
  getLoadedBsp(): BspFile | null {
    return this.loadedBsp;
  }

  /** All entities of a given classname (empty if no BSP is loaded). */
  getEntitiesByClassname(classname: string): BspEntity[] {
    if (!this.loadedBsp) return [];
    return this.loadedBsp.entities.filter((e) => e.classname === classname);
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
      const deluxeEnabled = (RenderVars.getInstance().get("r_deluxe") ?? 0) >= 0.5;
      this.meshResult = BspMeshBuilder.build(this.loadedBsp, scene, {
        faceTypes: options.faceTypes,
        filterTextures: options.filterTextures ?? true,
        deluxe: deluxeEnabled,
        spatialCellSize: RenderVars.getInstance().get("r_bsp_cellsize") ?? 0,
      });

      // Freeze static world geometry (world matrix + bounding info) to skip its
      // per-frame recompute. Static BSP meshes never transform; PVS only toggles
      // visibility. Gated by r_bsp_freeze (default on); applies per map build.
      if ((RenderVars.getInstance().get("r_bsp_freeze") ?? 1) >= 0.5) {
        const frozen = BspMeshBuilder.freezeStaticWorld(this.meshResult);
        devLog(`[BspManager] Froze ${frozen} static world meshes (r_bsp_freeze)`);
      }

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
    this.disposePVS();
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

    const deluxeEnabled = (RenderVars.getInstance().get("r_deluxe") ?? 0) >= 0.5;
    const bspPbrEnabled = (RenderVars.getInstance().get("r_bsp_pbr") ?? 0) >= 0.5;
    return BspMeshBuilder.applyTextures(this.meshResult, this.loadedBsp, scene, onProgress, {
      deluxe: deluxeEnabled,
      pbr: bspPbrEnabled,
    });
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
      const mat = mesh.material as unknown as LightmapTintMaterial | null;
      if (!mat) continue;

      // Store original colors on first call
      if (mat._origDiffuse === undefined && mat.diffuseColor) {
        mat._origDiffuse = mat.diffuseColor.clone();
      }
      if (mat._origEmissive === undefined && mat.emissiveColor) {
        mat._origEmissive = mat.emissiveColor.clone();
      }

      // Modulate diffuse color by intensity
      if (mat._origDiffuse && mat.diffuseColor) {
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
    if (!this.loadedBsp) return null;
    return sampleLightGrid(this.loadedBsp, [position.x, position.z, position.y]);
  }

  /** `getLightingAt` into a caller-owned result, for callers sampling every frame. */
  getLightingInto(position: Vector3, out: BspLightVol): BspLightVol | null {
    if (!this.loadedBsp) return null;
    return sampleLightGridInto(this.loadedBsp, position.x, position.z, position.y, out);
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

  private pvsCuller: PVSCuller | null = null;

  /**
   * The active culler, for callers that need to test moving things.
   *
   * Static world surfaces are culled by the manager itself; entities have no
   * compiled cluster and must ask per frame (see PVSCuller.isPositionVisible).
   */
  getPvsCuller(): PVSCuller | null {
    return this.pvsCuller;
  }
  private pvsCleanup: (() => void) | null = null;
  private pvsLifetimeCleanup: (() => void) | null = null;

  /**
   * Initialize PVS culling system
   */
  async initPVS(): Promise<string | null> {
    devLog(`[PVS] initPVS called: loadedBsp=${!!this.loadedBsp}, meshResult=${!!this.meshResult}`);

    if (!this.loadedBsp) {
      return "No BSP loaded";
    }
    if (!this.meshResult) {
      devLog(`[PVS] BSP loaded but not rendered. Current map: ${this.currentMapName}`);
      return "BSP not rendered yet - try waiting a moment";
    }

    if (!this.pvsCuller) {
      this.pvsCuller = createPVSCuller(this.loadedBsp);
      if (this.pvsCuller) {
        this.pvsCuller.registerFromWorldMesh(this.meshResult.worldMesh);
      }
    }

    return this.pvsCuller ? null : "PVS unavailable: missing or invalid visibility data; world remains visible";
  }

  /**
   * Enable PVS culling with automatic updates. A camera can be assigned later;
   * until then the registered world surfaces retain their original visibility.
   */
  async enablePVS(scene: Scene, _camera?: import("@babylonjs/core/Cameras/camera").Camera): Promise<string> {
    if (!this.loadedBsp) {
      return "No BSP loaded. Load a map first.";
    }

    const bsp = this.loadedBsp;
    const result = this.meshResult;
    const error = await this.initPVS();
    if (this.loadedBsp !== bsp || this.meshResult !== result) return "Map changed while enabling PVS; try again";
    if (error || !this.pvsCuller) {
      return error || "PVS data not available in this map";
    }

    this.pvsCleanup?.();
    this.pvsLifetimeCleanup?.();
    this.pvsCuller.setEnabled(true);
    const update = () => {
      if (!this.pvsCuller?.isEnabled()) return;
      // The FPS viewmodel has its own camera on layer 0x10000000. It cannot
      // see the BSP and must not disable culling for the normal [eye, weapon] pair.
      // Multiple world views still need a union; conservatively show all for now.
      const cameras = (scene.activeCameras?.length ? scene.activeCameras : [scene.activeCamera]).filter(
        (candidate) => candidate && (candidate.layerMask & ~0x10000000) !== 0,
      );
      const camera = cameras.length === 1 ? cameras[0] : null;
      camera?.getViewMatrix();
      this.pvsCuller.update(camera?.globalPosition ?? null);
    };
    const observer = scene.onBeforeRenderObservable.add(update);
    const sceneDispose = scene.onDisposeObservable.addOnce(() => this.disposePVS());
    const world = this.meshResult!.worldMesh;
    const worldDispose = world.onDisposeObservable.addOnce(() => this.disposePVS());
    this.pvsCleanup = () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
    this.pvsLifetimeCleanup = () => {
      scene.onDisposeObservable.remove(sceneDispose);
      world.onDisposeObservable.remove(worldDispose);
    };
    update();

    return "PVS culling: ON";
  }

  /**
   * Disable PVS culling
   */
  disablePVS(_scene: Scene): string {
    if (this.pvsCuller) {
      this.pvsCuller.setEnabled(false);
    }

    this.pvsCleanup?.();
    this.pvsCleanup = null;

    return "PVS culling: OFF";
  }

  /**
   * Get PVS status
   */
  getPVSStatus(_camera?: import("@babylonjs/core/Cameras/camera").Camera): string {
    if (!this.pvsCuller) {
      if (!this.loadedBsp) {
        return "No BSP loaded";
      }
      return this.loadedBsp.visData
        ? `PVS available: ${this.loadedBsp.visData.numClusters} clusters (not initialized)`
        : "No PVS data in this map";
    }

    // Report the last rendered view; a diagnostic must not change visibility
    // (particularly when multiple primary cameras conservatively show all).
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
    camera.getViewMatrix();
    const position = camera.globalPosition;
    const q3Pos: [number, number, number] = [position.x, position.z, position.y];
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
      `Camera: (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
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

  private disposePVS(): void {
    this.pvsCleanup?.();
    this.pvsCleanup = null;
    this.pvsLifetimeCleanup?.();
    this.pvsLifetimeCleanup = null;
    this.pvsCuller?.dispose();
    this.pvsCuller = null;
  }

  /**
   * Unload everything
   */
  unload(): void {
    this.clearRender();
    this.loadedBsp = null;
    this.currentMapName = null;
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
