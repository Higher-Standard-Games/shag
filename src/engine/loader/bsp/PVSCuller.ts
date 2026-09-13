/** Static BSP visibility using compiled face-to-leaf membership. */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { type BspFile, findLeafForPoint, isClusterVisible } from "./BspLoader";

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

export class PVSCuller {
  private meshClusters = new Map<AbstractMesh, Set<number>>();
  private originalVisibility = new Map<AbstractMesh, boolean>();
  private enabled = true;
  private currentCluster = -1;
  private visibleClusters = new Set<number>();
  private lastUpdateTime = 0;
  private cachedVisibleCount = 0;
  private cachedCulledCount = 0;
  private readonly _hasPVS: boolean;
  private lastCameraPos = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private forceUpdate = true;

  constructor(private readonly bsp: BspFile) {
    const vis = bsp.visData;
    this._hasPVS =
      !!vis &&
      vis.numClusters > 0 &&
      vis.bytesPerCluster >= Math.ceil(vis.numClusters / 8) &&
      vis.bitVectors.length >= vis.numClusters * vis.bytesPerCluster;
  }

  get hasPVS(): boolean {
    return this._hasPVS;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.invalidate();
    if (!enabled) this.restoreVisibility();
  }

  isEnabled(): boolean {
    return this.enabled && this.hasPVS;
  }

  /** Replaces registration and releases visibility owned by the previous set. */
  registerClusterMeshes(groups: ClusterMeshGroup[]): void {
    this.clearRegistration();
    for (const group of groups) {
      const cluster = this.validCluster(group.cluster) ? group.cluster : -1;
      for (const mesh of group.meshes) {
        if (mesh.isDisposed()) continue;
        let clusters = this.meshClusters.get(mesh);
        if (!clusters) {
          clusters = new Set();
          this.meshClusters.set(mesh, clusters);
          this.originalVisibility.set(mesh, mesh.isVisible);
        }
        clusters.add(cluster);
      }
    }
    this.refreshCounts();
  }

  /**
   * Only authored world surfaces are eligible. Untagged descendants can be
   * movers, entities or effects; leave them to their own visibility systems.
   * Bounds sampling cannot conservatively establish a batch's face membership.
   */
  registerFromWorldMesh(worldMesh: Mesh): void {
    const groups = new Map<number, AbstractMesh[]>();
    for (const mesh of worldMesh.getChildMeshes()) {
      const clusters: unknown = mesh.metadata?.bspPvsClusters;
      if (!Array.isArray(clusters)) continue;
      for (const cluster of clusters.length ? clusters : [-1]) {
        const key = this.validCluster(cluster) ? cluster : -1;
        const meshes = groups.get(key) ?? [];
        meshes.push(mesh);
        groups.set(key, meshes);
      }
    }
    this.registerClusterMeshes([...groups].map(([cluster, meshes]) => ({ cluster, meshes })));
    console.log(`[PVSCuller] Registered ${this.meshClusters.size} static world meshes from compiled face membership`);
  }

  private validCluster(cluster: number): boolean {
    return Number.isInteger(cluster) && cluster >= 0 && cluster < (this.bsp.visData?.numClusters ?? 0);
  }

  findClusterAtPosition(position: Vector3): number {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return -1;
    const leaf = findLeafForPoint(
      [position.x, position.z, position.y],
      this.bsp.nodes,
      this.bsp.leafs,
      this.bsp.planes,
    );
    const cluster = leaf?.cluster ?? -1;
    return this.validCluster(cluster) ? cluster : -1;
  }

  /**
   * Could a body standing at this position be seen from where the camera is?
   *
   * For moving things — players, gibs, dropped weapons — which have no compiled
   * cluster membership of their own and so are never registered for static
   * culling. The point is resolved to a leaf per call, then tested against the
   * visible set `update()` already computed for this camera position.
   *
   * **Fails open.** Every uncertainty — PVS disabled, no vis data, a position
   * outside the tree, a camera that has not been placed yet — returns true.
   * A wrongly hidden player is an invisible enemy, which is a far worse bug
   * than a wrongly drawn one, so nothing here may hide on a guess.
   *
   * Callers should sample more than one point on a body: a player straddling a
   * doorway has their origin in one cluster and their shoulders in another.
   */
  isPositionVisible(position: Vector3): boolean {
    if (!this.enabled || !this.hasPVS) return true;
    if (!this.validCluster(this.currentCluster)) return true;

    const cluster = this.findClusterAtPosition(position);
    if (cluster < 0) return true;
    if (cluster === this.currentCluster) return true;

    return this.visibleClusters.has(cluster);
  }

  getVisibleClusters(fromCluster: number): Set<number> {
    const visible = new Set<number>();
    for (let i = 0; i < (this.bsp.visData?.numClusters ?? 0); i++) {
      if (
        !this.hasPVS ||
        !this.validCluster(fromCluster) ||
        i === fromCluster ||
        isClusterVisible(this.bsp.visData, fromCluster, i)
      )
        visible.add(i);
    }
    return visible;
  }

  /**
   * Stationary/same-cluster frames never scan meshes. Any movement checks the
   * BSP leaf, including sub-unit boundary crossings. null conservatively shows
   * all registered surfaces (e.g. a missing camera or multiple primary views).
   * Call invalidate() after external changes to managed visibility.
   */
  update(cameraPosition: Vector3 | null): PVSCullerStats {
    if (!this.isEnabled()) return this.getCachedStats();
    if (!this.forceUpdate && cameraPosition?.equals(this.lastCameraPos)) return this.getCachedStats();

    const startTime = performance.now();
    const newCluster = cameraPosition ? this.findClusterAtPosition(cameraPosition) : -1;
    if (cameraPosition) this.lastCameraPos.copyFrom(cameraPosition);
    else this.lastCameraPos.set(Number.NaN, Number.NaN, Number.NaN);
    if (!this.forceUpdate && newCluster === this.currentCluster) return this.getCachedStats();

    this.forceUpdate = false;
    this.currentCluster = newCluster;
    this.visibleClusters = this.getVisibleClusters(newCluster);
    let visibleCount = 0;
    let culledCount = 0;
    for (const [mesh, clusters] of this.meshClusters) {
      if (mesh.isDisposed()) continue;
      let visible = false;
      for (const cluster of clusters) {
        if (cluster < 0 || this.visibleClusters.has(cluster)) {
          visible = this.originalVisibility.get(mesh) === true;
          break;
        }
      }
      if (mesh.isVisible !== visible) mesh.isVisible = visible;
      if (visible) visibleCount++;
      else culledCount++;
    }
    this.cachedVisibleCount = visibleCount;
    this.cachedCulledCount = culledCount;
    this.lastUpdateTime = performance.now() - startTime;
    return this.getCachedStats();
  }

  private getCachedStats(): PVSCullerStats {
    return {
      enabled: this.isEnabled(),
      currentCluster: this.currentCluster,
      totalClusters: this.bsp.visData?.numClusters ?? 0,
      visibleClusters: this.visibleClusters.size,
      totalMeshes: this.cachedVisibleCount + this.cachedCulledCount,
      visibleMeshes: this.cachedVisibleCount,
      culledMeshes: this.cachedCulledCount,
      lastUpdateTime: this.lastUpdateTime,
    };
  }

  /** Explicit diagnostic scan; normal frame updates use cached counts. */
  getStats(): PVSCullerStats {
    this.refreshCounts();
    return this.getCachedStats();
  }

  private refreshCounts(): void {
    this.cachedVisibleCount = 0;
    this.cachedCulledCount = 0;
    for (const mesh of this.meshClusters.keys()) {
      if (mesh.isDisposed()) continue;
      if (mesh.isVisible) this.cachedVisibleCount++;
      else this.cachedCulledCount++;
    }
  }

  invalidate(): void {
    this.forceUpdate = true;
  }

  getClusterInfo(): { cluster: number; meshCount: number; visible: boolean }[] {
    const counts = new Map<number, number>();
    for (const clusters of this.meshClusters.values()) {
      for (const cluster of clusters) counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
    }
    return [...counts]
      .map(([cluster, meshCount]) => ({
        cluster,
        meshCount,
        visible: cluster < 0 || this.visibleClusters.has(cluster),
      }))
      .sort((a, b) => a.cluster - b.cluster);
  }

  private restoreVisibility(): void {
    for (const [mesh, visible] of this.originalVisibility) {
      if (!mesh.isDisposed()) mesh.isVisible = visible;
    }
    this.refreshCounts();
  }

  private clearRegistration(): void {
    this.restoreVisibility();
    this.meshClusters.clear();
    this.originalVisibility.clear();
    this.visibleClusters.clear();
    this.currentCluster = -1;
    this.cachedVisibleCount = 0;
    this.cachedCulledCount = 0;
    this.lastUpdateTime = 0;
    this.invalidate();
  }

  dispose(): void {
    this.clearRegistration();
  }
}

export function createPVSCuller(bsp: BspFile): PVSCuller | null {
  const culler = new PVSCuller(bsp);
  return culler.hasPVS ? culler : null;
}
