/**
 * PVSCuller - Potentially Visible Set culling system for BSP maps
 *
 * Uses precomputed visibility data from BSP files to efficiently cull
 * geometry that cannot be seen from the current camera position.
 *
 * How it works:
 * 1. BSP maps are divided into "clusters" (leaf nodes of the BSP tree)
 * 2. Each cluster has a precomputed bitfield showing which other clusters are visible from it
 * 3. At runtime, we find which cluster the camera is in
 * 4. We then show only meshes belonging to visible clusters
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BspFile } from "./BspLoader";
import { findLeafForPoint, isClusterVisible } from "./BspLoader";

export interface PVSCullerStats {
  enabled: boolean;
  currentCluster: number;
  totalClusters: number;
  visibleClusters: number;
  totalMeshes: number;
  visibleMeshes: number;
  culledMeshes: number;
  lastUpdateTime: number;
}

export interface ClusterMeshGroup {
  cluster: number;
  meshes: AbstractMesh[];
}

/**
 * PVS Culling Manager
 *
 * Manages visibility of BSP geometry based on camera position and PVS data.
 */
export class PVSCuller {
  private bsp: BspFile;
  // Map from mesh to all clusters it intersects
  private meshClusters: Map<AbstractMesh, Set<number>> = new Map();
  // Reverse map: cluster -> meshes for faster updates
  private clusterMeshes: Map<number, AbstractMesh[]> = new Map();
  private allManagedMeshes: AbstractMesh[] = [];
  private enabled: boolean = true;
  private currentCluster: number = -1;
  private visibleClusters: Set<number> = new Set();
  private lastUpdateTime: number = 0;

  // Cached stats to avoid recalculating every frame
  private cachedVisibleCount: number = 0;
  private cachedCulledCount: number = 0;

  // Cache hasPVS result (doesn't change after construction)
  private readonly _hasPVS: boolean;

  // Cache for performance
  private lastCameraPos: Vector3 = new Vector3(0, 0, 0);
  private updateThreshold: number = 10; // Only update if camera moved more than this
  private forceUpdate: boolean = true;

  constructor(bsp: BspFile) {
    this.bsp = bsp;
    this._hasPVS = bsp.visData !== null && bsp.visData.numClusters > 0;
    console.log(`[PVSCuller] Initialized with ${bsp.visData?.numClusters ?? 0} clusters`);
  }

  /**
   * Check if PVS data is available
   */
  get hasPVS(): boolean {
    return this._hasPVS;
  }

  /**
   * Enable or disable PVS culling
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.forceUpdate = true;

    if (!enabled) {
      // Show all meshes when disabled
      for (const mesh of this.allManagedMeshes) {
        mesh.isVisible = true;
      }
    }

    console.log(`[PVSCuller] ${enabled ? "Enabled" : "Disabled"}`);
  }

  /**
   * Check if culling is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.hasPVS;
  }

  /**
   * Register meshes with their cluster assignments
   * Called after building BSP meshes with cluster info
   */
  registerClusterMeshes(clusterMeshGroups: ClusterMeshGroup[]): void {
    this.meshClusters.clear();
    this.clusterMeshes.clear();
    this.allManagedMeshes = [];

    for (const group of clusterMeshGroups) {
      // Build reverse map
      if (!this.clusterMeshes.has(group.cluster)) {
        this.clusterMeshes.set(group.cluster, []);
      }
      const clusterMeshList = this.clusterMeshes.get(group.cluster)!;

      for (const mesh of group.meshes) {
        if (!this.meshClusters.has(mesh)) {
          this.meshClusters.set(mesh, new Set());
          this.allManagedMeshes.push(mesh);
        }
        this.meshClusters.get(mesh)!.add(group.cluster);
        clusterMeshList.push(mesh);
      }
    }

    console.log(`[PVSCuller] Registered ${this.allManagedMeshes.length} meshes`);
    this.forceUpdate = true;
  }

  /**
   * Register meshes from an existing world mesh by sampling bounding box points
   * Each mesh is assigned to ALL clusters its bounding box intersects
   */
  registerFromWorldMesh(worldMesh: Mesh): void {
    const childMeshes = worldMesh.getChildMeshes();

    this.meshClusters.clear();
    this.allManagedMeshes = [];

    let totalClusterAssignments = 0;

    for (const mesh of childMeshes) {
      const bounds = mesh.getBoundingInfo();
      const bb = bounds.boundingBox;
      const min = bb.minimumWorld;
      const max = bb.maximumWorld;

      // Sample 8 corners + center + face centers = 15 points for better coverage
      const clusters = new Set<number>();
      const midX = (min.x + max.x) / 2;
      const midY = (min.y + max.y) / 2;
      const midZ = (min.z + max.z) / 2;

      // Sample points as [x, y, z] tuples to avoid Vector3 allocation
      const samples: [number, number, number][] = [
        // 8 corners
        [min.x, min.y, min.z],
        [max.x, min.y, min.z],
        [min.x, max.y, min.z],
        [max.x, max.y, min.z],
        [min.x, min.y, max.z],
        [max.x, min.y, max.z],
        [min.x, max.y, max.z],
        [max.x, max.y, max.z],
        // Center
        [midX, midY, midZ],
        // Face centers
        [midX, min.y, midZ],
        [midX, max.y, midZ],
        [min.x, midY, midZ],
        [max.x, midY, midZ],
        [midX, midY, min.z],
        [midX, midY, max.z],
      ];

      for (const [x, y, z] of samples) {
        // Convert Babylon coords (Y-up) to Q3 coords (Z-up)
        const q3Point: [number, number, number] = [x, z, y];
        const leaf = findLeafForPoint(q3Point, this.bsp.nodes, this.bsp.leafs, this.bsp.planes);
        const cluster = leaf?.cluster ?? -1;
        clusters.add(cluster);
      }

      this.meshClusters.set(mesh, clusters);
      this.allManagedMeshes.push(mesh);
      totalClusterAssignments += clusters.size;

      // Build reverse map
      for (const cluster of clusters) {
        if (!this.clusterMeshes.has(cluster)) {
          this.clusterMeshes.set(cluster, []);
        }
        this.clusterMeshes.get(cluster)!.push(mesh);
      }
    }

    const avgClusters =
      this.allManagedMeshes.length > 0 ? (totalClusterAssignments / this.allManagedMeshes.length).toFixed(1) : "0";

    console.log(`[PVSCuller] Registered ${this.allManagedMeshes.length} meshes (avg ${avgClusters} clusters per mesh)`);
    this.forceUpdate = true;
  }

  /**
   * Find which cluster a world position is in
   */
  findClusterAtPosition(position: Vector3): number {
    // Convert from Babylon.js coords (Y-up) to Q3 coords (Z-up)
    const q3Pos: [number, number, number] = [position.x, position.z, position.y];
    const leaf = findLeafForPoint(q3Pos, this.bsp.nodes, this.bsp.leafs, this.bsp.planes);
    return leaf?.cluster ?? -1;
  }

  /**
   * Get all clusters visible from a given cluster
   */
  getVisibleClusters(fromCluster: number): Set<number> {
    const visible = new Set<number>();

    if (!this.bsp.visData || fromCluster < 0) {
      // No PVS or invalid cluster - mark all as visible
      for (let i = 0; i < (this.bsp.visData?.numClusters ?? 0); i++) {
        visible.add(i);
      }
      return visible;
    }

    // Always include current cluster
    visible.add(fromCluster);

    // Check visibility for each cluster
    for (let i = 0; i < this.bsp.visData.numClusters; i++) {
      if (isClusterVisible(this.bsp.visData, fromCluster, i)) {
        visible.add(i);
      }
    }

    return visible;
  }

  /**
   * Update visibility based on camera position
   * Call this every frame or when camera moves significantly
   */
  update(cameraPosition: Vector3): PVSCullerStats {
    const startTime = performance.now();

    // Check if we need to update
    const distMoved = Vector3.Distance(cameraPosition, this.lastCameraPos);

    if (!this.forceUpdate && distMoved < this.updateThreshold) {
      // No significant movement, return cached stats
      return this.getStats();
    }

    this.lastCameraPos.copyFrom(cameraPosition);
    this.forceUpdate = false;

    // Find current cluster
    const newCluster = this.findClusterAtPosition(cameraPosition);

    // Only recalculate visibility if cluster changed
    if (newCluster !== this.currentCluster || this.visibleClusters.size === 0) {
      this.currentCluster = newCluster;
      this.visibleClusters = this.getVisibleClusters(newCluster);
    }

    // Update mesh visibility
    let visibleCount = 0;
    let culledCount = 0;

    if (this.enabled && this._hasPVS) {
      for (const [mesh, clusters] of this.meshClusters) {
        // Mesh is visible if ANY of its clusters is visible
        // Cluster -1 means outside world or unassigned - always show
        let shouldBeVisible = false;
        for (const cluster of clusters) {
          if (cluster < 0 || this.visibleClusters.has(cluster)) {
            shouldBeVisible = true;
            break;
          }
        }
        // Only update if changed (avoid triggering Babylon state changes)
        if (mesh.isVisible !== shouldBeVisible) {
          mesh.isVisible = shouldBeVisible;
        }
        if (shouldBeVisible) {
          visibleCount++;
        } else {
          culledCount++;
        }
      }
    } else {
      visibleCount = this.allManagedMeshes.length;
    }

    // Cache stats
    this.cachedVisibleCount = visibleCount;
    this.cachedCulledCount = culledCount;
    this.lastUpdateTime = performance.now() - startTime;

    return this.getCachedStats();
  }

  /**
   * Get cached stats without recalculating (fast)
   */
  private getCachedStats(): PVSCullerStats {
    return {
      enabled: this.enabled && this._hasPVS,
      currentCluster: this.currentCluster,
      totalClusters: this.bsp.visData?.numClusters ?? 0,
      visibleClusters: this.visibleClusters.size,
      totalMeshes: this.allManagedMeshes.length,
      visibleMeshes: this.cachedVisibleCount,
      culledMeshes: this.cachedCulledCount,
      lastUpdateTime: this.lastUpdateTime,
    };
  }

  /**
   * Get current culling statistics
   * For real-time display, use getCachedStats() which is faster
   */
  getStats(): PVSCullerStats {
    // Recalculate for accuracy (used by status command)
    let visibleMeshes = 0;
    let culledMeshes = 0;

    for (const mesh of this.allManagedMeshes) {
      if (mesh.isVisible) {
        visibleMeshes++;
      } else {
        culledMeshes++;
      }
    }

    return {
      enabled: this.enabled && this._hasPVS,
      currentCluster: this.currentCluster,
      totalClusters: this.bsp.visData?.numClusters ?? 0,
      visibleClusters: this.visibleClusters.size,
      totalMeshes: this.allManagedMeshes.length,
      visibleMeshes,
      culledMeshes,
      lastUpdateTime: this.lastUpdateTime,
    };
  }

  /**
   * Force a visibility update on next frame
   */
  invalidate(): void {
    this.forceUpdate = true;
  }

  /**
   * Get cluster info for debugging
   */
  getClusterInfo(): { cluster: number; meshCount: number; visible: boolean }[] {
    // Build a reverse map: cluster -> count of meshes that include it
    const clusterCounts = new Map<number, number>();

    for (const [, clusters] of this.meshClusters) {
      for (const cluster of clusters) {
        clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
      }
    }

    const info: { cluster: number; meshCount: number; visible: boolean }[] = [];

    for (const [cluster, count] of clusterCounts) {
      info.push({
        cluster,
        meshCount: count,
        visible: cluster < 0 || this.visibleClusters.has(cluster),
      });
    }

    return info.sort((a, b) => a.cluster - b.cluster);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.meshClusters.clear();
    this.clusterMeshes.clear();
    this.allManagedMeshes = [];
    this.visibleClusters.clear();
  }
}

/**
 * Create a PVS culler for a BSP file
 */
export function createPVSCuller(bsp: BspFile): PVSCuller | null {
  if (!bsp.visData) {
    console.log("[PVSCuller] No visibility data in BSP, PVS culling unavailable");
    return null;
  }

  return new PVSCuller(bsp);
}
