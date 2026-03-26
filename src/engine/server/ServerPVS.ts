/**
 * ServerPVS - Server-side Potentially Visible Set for network culling
 *
 * Lightweight wrapper around BSP PVS data for determining entity visibility
 * between positions. Used by GameServer to filter entities per-client,
 * reducing bandwidth by not sending entities outside a client's PVS.
 *
 * Uses the same BSP tree traversal and bit-vector checks as the rendering
 * PVSCuller, but without any Babylon.js/mesh dependencies.
 */

import type { BspLeaf, BspNode, BspPlane, BspVisData } from "../loader/bsp/BspLoader";
import { findLeafForPoint, isClusterVisible } from "../loader/bsp/BspLoader";

export interface ServerPVSData {
  nodes: BspNode[];
  leafs: BspLeaf[];
  planes: BspPlane[];
  visData: BspVisData | null;
}

export class ServerPVS {
  private nodes: BspNode[];
  private leafs: BspLeaf[];
  private planes: BspPlane[];
  private visData: BspVisData | null;

  constructor(data: ServerPVSData) {
    this.nodes = data.nodes;
    this.leafs = data.leafs;
    this.planes = data.planes;
    this.visData = data.visData;
  }

  /** Whether this map has PVS data (some BSPs have none) */
  get enabled(): boolean {
    return this.visData !== null && this.visData.numClusters > 0;
  }

  /** Number of clusters in the PVS */
  get numClusters(): number {
    return this.visData?.numClusters ?? 0;
  }

  /**
   * Check if targetPos is visible from viewerPos.
   *
   * Positions are in Babylon.js coordinates (Y-up).
   * Internally converts to Q3 coordinates (Z-up) for BSP lookup.
   *
   * Returns true if:
   * - No PVS data (fallback: everything visible)
   * - Either position is outside the BSP (outside world = visible)
   * - Target's cluster is in viewer's PVS bit-vector
   */
  isVisible(viewerPos: { x: number; y: number; z: number }, targetPos: { x: number; y: number; z: number }): boolean {
    if (!this.visData) return true;

    const viewerCluster = this.getCluster(viewerPos);
    const targetCluster = this.getCluster(targetPos);

    // Outside BSP = assume visible (safe fallback)
    if (viewerCluster < 0 || targetCluster < 0) return true;

    // Same cluster = always visible
    if (viewerCluster === targetCluster) return true;

    return isClusterVisible(this.visData, viewerCluster, targetCluster);
  }

  /**
   * Get BSP cluster ID for a world position.
   * Converts from Babylon.js Y-up to Q3 Z-up coordinates.
   *
   * Returns -1 if position is outside the BSP tree.
   */
  getCluster(pos: { x: number; y: number; z: number }): number {
    // Babylon.js (Y-up) → Q3 (Z-up): swap Y and Z
    const q3Pos: [number, number, number] = [pos.x, pos.z, pos.y];
    const leaf = findLeafForPoint(q3Pos, this.nodes, this.leafs, this.planes);
    return leaf?.cluster ?? -1;
  }

  /**
   * Get all clusters visible from a given position.
   * Useful for debugging and diagnostics.
   */
  getVisibleClusters(pos: { x: number; y: number; z: number }): Set<number> {
    const visible = new Set<number>();
    const cluster = this.getCluster(pos);

    if (!this.visData || cluster < 0) {
      // No PVS or outside BSP — everything visible
      for (let i = 0; i < (this.visData?.numClusters ?? 0); i++) {
        visible.add(i);
      }
      return visible;
    }

    for (let i = 0; i < this.visData.numClusters; i++) {
      if (isClusterVisible(this.visData, cluster, i)) {
        visible.add(i);
      }
    }

    return visible;
  }
}
