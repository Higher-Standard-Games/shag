/**
 * PVS visibility for moving things.
 *
 * Players carry no compiled cluster, so they ask per frame. The contract that
 * matters is the failure direction: a wrongly hidden player is an invisible
 * enemy, which is far worse than a wrongly drawn one. Every uncertainty must
 * therefore answer "visible".
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import type { BspFile } from "../loader/bsp/BspLoader";
import { PVSCuller } from "../loader/bsp/PVSCuller";

/** Two leaves either side of x=0, in their own clusters, with explicit vis. */
function twoRoomBsp(visData: BspFile["visData"]): BspFile {
  const big = 1e6;
  return {
    header: { isFBSP: false },
    entities: [],
    textures: [],
    planes: [{ normal: [1, 0, 0], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-1, -2], mins: [-big, -big, -big], maxs: [big, big, big] }],
    leafs: [
      {
        cluster: 0,
        area: 0,
        mins: [-big, -big, -big],
        maxs: [big, big, big],
        firstLeafFace: 0,
        numLeafFaces: 0,
        firstLeafBrush: 0,
        numLeafBrushes: 0,
      },
      {
        cluster: 1,
        area: 0,
        mins: [-big, -big, -big],
        maxs: [big, big, big],
        firstLeafFace: 0,
        numLeafFaces: 0,
        firstLeafBrush: 0,
        numLeafBrushes: 0,
      },
    ],
    leafFaces: [],
    leafBrushes: [],
    models: [],
    brushes: [],
    brushSides: [],
    vertices: [],
    meshVerts: [],
    effects: [],
    faces: [],
    lightmaps: [],
    lightVols: [],
    visData,
    lightmapSize: 128,
  } as unknown as BspFile;
}

/** Cluster 0 sees only itself; cluster 1 sees only itself. */
const ISOLATED = { numClusters: 2, bytesPerCluster: 1, bitVectors: new Uint8Array([0b01, 0b10]) };

describe("PVSCuller.isPositionVisible", () => {
  it("hides a body in a cluster the camera cannot see", () => {
    const culler = new PVSCuller(twoRoomBsp(ISOLATED));
    culler.setEnabled(true);
    culler.update(new Vector3(-100, 0, 0)); // camera in one room

    // Same room stays visible; the other room does not.
    expect(culler.isPositionVisible(new Vector3(-200, 0, 0))).toBe(true);
    expect(culler.isPositionVisible(new Vector3(200, 0, 0))).toBe(false);
  });

  it("shows everyone when PVS is disabled", () => {
    const culler = new PVSCuller(twoRoomBsp(ISOLATED));
    culler.update(new Vector3(-100, 0, 0));
    culler.setEnabled(false);

    expect(culler.isPositionVisible(new Vector3(200, 0, 0))).toBe(true);
  });

  it("shows everyone when the map has no vis data", () => {
    const culler = new PVSCuller(twoRoomBsp(null));
    culler.setEnabled(true);
    culler.update(new Vector3(-100, 0, 0));

    expect(culler.isPositionVisible(new Vector3(200, 0, 0))).toBe(true);
  });

  it("shows everyone before the camera has been placed", () => {
    const culler = new PVSCuller(twoRoomBsp(ISOLATED));
    culler.setEnabled(true);

    // No update() yet: there is no camera cluster to judge against.
    expect(culler.isPositionVisible(new Vector3(200, 0, 0))).toBe(true);
  });

  it("shows a body whose position cannot be resolved to a cluster", () => {
    const culler = new PVSCuller(twoRoomBsp(ISOLATED));
    culler.setEnabled(true);
    culler.update(new Vector3(-100, 0, 0));

    // NaN is what a half-initialised or detached entity reports.
    expect(culler.isPositionVisible(new Vector3(Number.NaN, 0, 0))).toBe(true);
  });

  it("shows everyone once the camera leaves the tree", () => {
    const culler = new PVSCuller(twoRoomBsp(ISOLATED));
    culler.setEnabled(true);
    culler.update(null);

    expect(culler.isPositionVisible(new Vector3(200, 0, 0))).toBe(true);
  });
});
