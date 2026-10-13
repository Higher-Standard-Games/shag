/**
 * The sky shows only through sky faces: a view sees the sky when one is in its
 * PVS and its frustum, and only then is a sky portal drawn.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import type { BspFile } from "../../loader/bsp/BspLoader";
import { SkyVisibility, skyClusterBounds } from "../SkyVisibility";

/**
 * Two clusters split at BSP x = 0: cluster 0 behind, cluster 1 in front, with
 * one sky face in cluster 1 at x = 100. `seesAcross` lets each cluster see the other.
 */
function twoRooms(seesAcross: boolean): BspFile {
  const across = seesAcross ? 0b11 : 0;
  const corner = (y: number, z: number) => ({ position: [100, y, z] as [number, number, number] });
  return {
    planes: [{ normal: [1, 0, 0], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-2, -1], mins: [0, 0, 0], maxs: [0, 0, 0] }],
    leafs: [
      { cluster: 0, area: 0, mins: [0, 0, 0], maxs: [0, 0, 0], firstLeafFace: 0, numLeafFaces: 0 },
      { cluster: 1, area: 0, mins: [0, 0, 0], maxs: [0, 0, 0], firstLeafFace: 0, numLeafFaces: 1 },
    ],
    leafFaces: [0],
    faces: [{ firstVertex: 0, numVertices: 4 }],
    vertices: [corner(-50, 0), corner(50, 0), corner(50, 100), corner(-50, 100)],
    visData: { numClusters: 2, bytesPerCluster: 1, bitVectors: new Uint8Array([0b01 | across, 0b10 | across]) },
  } as unknown as BspFile;
}

function view(scene: Scene, from: [number, number, number], toward: [number, number, number]): FreeCamera {
  const camera = new FreeCamera("view", new Vector3(...from), scene);
  camera.setTarget(new Vector3(...toward));
  camera.computeWorldMatrix();
  return camera;
}

describe("sky visibility", () => {
  const scene = new Scene(new NullEngine());

  it("keeps sky face bounds per cluster, in engine space", () => {
    const [box] = skyClusterBounds(twoRooms(false), [0]);
    expect(box.cluster).toBe(1);
    const xs = box.corners.map((c) => c.x);
    const ys = box.corners.map((c) => c.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 100]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 100]);
  });

  it("sees the sky when a sky face is in the frustum and the PVS", () => {
    const bsp = twoRooms(false);
    const sky = new SkyVisibility(bsp, skyClusterBounds(bsp, [0]));
    expect(sky.inView(view(scene, [50, 50, 0], [200, 50, 0]))).toBe(true);
    expect(sky.inView(view(scene, [50, 50, 0], [-200, 50, 0]))).toBe(false);
  });

  it("sees no sky from a cluster whose PVS leaves the sky face out", () => {
    const shut = twoRooms(false);
    const open = twoRooms(true);
    const facing: [[number, number, number], [number, number, number]] = [
      [-50, 50, 0],
      [200, 50, 0],
    ];
    expect(new SkyVisibility(shut, skyClusterBounds(shut, [0])).inView(view(scene, ...facing))).toBe(false);
    expect(new SkyVisibility(open, skyClusterBounds(open, [0])).inView(view(scene, ...facing))).toBe(true);
  });

  it("tests the frustum alone when the map has no vis data", () => {
    const bsp = { ...twoRooms(false), visData: null } as BspFile;
    const sky = new SkyVisibility(bsp, skyClusterBounds(bsp, [0]));
    expect(sky.inView(view(scene, [-50, 50, 0], [200, 50, 0]))).toBe(true);
    expect(sky.inView(view(scene, [-50, 50, 0], [-200, 50, 0]))).toBe(false);
  });
});
