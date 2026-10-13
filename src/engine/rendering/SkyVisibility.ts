/**
 * Whether a view can see the sky: a sky face in the view's PVS and frustum.
 *
 * Sky faces are not drawn as geometry; the sky shows through where they are.
 * Their bounds are kept per PVS cluster. A view whose PVS and frustum hold none
 * of them shows no sky, and a sky portal need not be drawn for it.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import type { Plane } from "@babylonjs/core/Maths/math.plane";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type BspFile, findLeafForPoint, isClusterVisible } from "../loader/bsp/BspLoader";
import { buildFaceClusters } from "../loader/bsp/mesh/pvs";

/** The bounds (engine space) of the sky faces in one cluster; -1 for faces in none. */
export interface SkyClusterBounds {
  cluster: number;
  corners: Vector3[];
}

export function skyClusterBounds(bsp: BspFile, skyFaces: readonly number[]): SkyClusterBounds[] {
  const faceClusters = buildFaceClusters(bsp);
  const boxes = new Map<number, { mins: number[]; maxs: number[] }>();
  for (const index of skyFaces) {
    const face = bsp.faces[index];
    if (!face) continue;
    for (const cluster of faceClusters[index] ?? [-1]) {
      let box = boxes.get(cluster);
      if (!box) {
        box = { mins: [Infinity, Infinity, Infinity], maxs: [-Infinity, -Infinity, -Infinity] };
        boxes.set(cluster, box);
      }
      // A patch's control points bound its curve
      for (let v = face.firstVertex; v < face.firstVertex + face.numVertices; v++) {
        const position = bsp.vertices[v]?.position;
        if (!position) continue;
        for (let axis = 0; axis < 3; axis++) {
          box.mins[axis] = Math.min(box.mins[axis], position[axis]);
          box.maxs[axis] = Math.max(box.maxs[axis], position[axis]);
        }
      }
    }
  }
  const bounds: SkyClusterBounds[] = [];
  for (const [cluster, { mins, maxs }] of boxes) {
    if (mins[0] > maxs[0]) continue;
    // BSP Z is engine Y
    const min = new Vector3(mins[0], mins[2], mins[1]);
    const max = new Vector3(maxs[0], maxs[2], maxs[1]);
    bounds.push({ cluster, corners: new BoundingBox(min, max).vectorsWorld.map((corner) => corner.clone()) });
  }
  return bounds;
}

export class SkyVisibility {
  private fromCluster = Number.NaN;
  private candidates: SkyClusterBounds[];
  private readonly transform = new Matrix();
  private readonly planes: Plane[] = Frustum.GetPlanes(Matrix.Identity());

  constructor(
    private readonly bsp: BspFile,
    private readonly bounds: readonly SkyClusterBounds[],
  ) {
    this.candidates = [...bounds];
  }

  /**
   * Fails open: a view outside the tree or in a map without vis data tests
   * every sky face against its frustum alone.
   */
  inView(camera: Camera): boolean {
    const position = camera.globalPosition;
    const leaf = findLeafForPoint(
      [position.x, position.z, position.y],
      this.bsp.nodes,
      this.bsp.leafs,
      this.bsp.planes,
    );
    const vis = this.bsp.visData;
    const valid = !!vis && leaf !== null && leaf.cluster >= 0 && leaf.cluster < vis.numClusters;
    const cluster = valid ? leaf.cluster : -1;
    if (cluster !== this.fromCluster) {
      this.fromCluster = cluster;
      this.candidates = this.bounds.filter(
        (box) =>
          cluster < 0 || box.cluster < 0 || box.cluster === cluster || isClusterVisible(vis, cluster, box.cluster),
      );
    }
    if (!this.candidates.length) return false;
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), this.transform);
    Frustum.GetPlanesToRef(this.transform, this.planes);
    return this.candidates.some((box) => BoundingBox.IsInFrustum(box.corners, this.planes));
  }
}
