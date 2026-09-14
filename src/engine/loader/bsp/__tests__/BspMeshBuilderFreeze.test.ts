/**
 * BspMeshBuilder.freezeStaticWorld (NullEngine). Verifies the static-BSP
 * world-matrix freeze optimization: static world meshes (`bsp_world` +
 * `bsp_tex_*`) get their world matrix + bounding-info sync frozen, while
 * autosprites (which rewrite vertex data every frame to billboard) are left
 * live so their per-frame update still works.
 *
 * Eligibility is the `bspPvsClusters` annotation the builder writes on authored
 * world surfaces. On the playable path gameplay movers are parented under the
 * same world root, and freezing one would pin its world matrix and stop it
 * moving — so the mover cases below are the ones that matter most.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BspMeshBuilder } from "../BspMeshBuilder";
import type { BspMeshBuildResult } from "../mesh/types";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("BspMeshBuilder.freezeStaticWorld", () => {
  it("freezes static world meshes and excludes autosprites", () => {
    const worldMesh = new Mesh("bsp_world", scene);
    const staticChild = new Mesh("bsp_tex_0", scene);
    staticChild.parent = worldMesh;
    staticChild.metadata = { bspPvsClusters: [0, 1] };
    const autosprite = new Mesh("bsp_autosprite_0", scene);
    autosprite.parent = worldMesh;
    autosprite.metadata = { autosprite: true, bspPvsClusters: [0] };

    const frozen = BspMeshBuilder.freezeStaticWorld({ worldMesh } as BspMeshBuildResult);

    // world + one static child frozen; the autosprite is skipped.
    expect(frozen).toBe(2);
    expect(worldMesh.isWorldMatrixFrozen).toBe(true);
    expect(staticChild.isWorldMatrixFrozen).toBe(true);
    expect(staticChild.doNotSyncBoundingInfo).toBe(true);
    expect(autosprite.isWorldMatrixFrozen).toBe(false);
    expect(autosprite.doNotSyncBoundingInfo).toBe(false);
  });

  it("excludes autosprite2 (cylindrical billboard) too", () => {
    const worldMesh = new Mesh("bsp_world", scene);
    const autosprite2 = new Mesh("bsp_autosprite2_0", scene);
    autosprite2.parent = worldMesh;
    autosprite2.metadata = { autosprite2: true, bspPvsClusters: [0] };

    const frozen = BspMeshBuilder.freezeStaticWorld({ worldMesh } as BspMeshBuildResult);

    expect(frozen).toBe(1); // world only
    expect(autosprite2.isWorldMatrixFrozen).toBe(false);
  });

  it("leaves a mover and its sub-meshes live, however they were attached", () => {
    // A lift is parented under the world root by MapLoader. buildBrushModel
    // writes no cluster annotation on the mover or its per-material children,
    // which is what keeps them out — not the order they happen to attach in.
    const worldMesh = new Mesh("bsp_world", scene);
    const surface = new Mesh("bsp_tex_0", scene);
    surface.parent = worldMesh;
    surface.metadata = { bspPvsClusters: [0] };

    const lift = new Mesh("bsp_lift_3", scene);
    lift.metadata = { mapOwned: true, entityType: "func_plat", isMover: true, brushModelIndex: 3 };
    const liftSurface = new Mesh("bsp_lift_3_tex_0", scene);
    liftSurface.parent = lift;
    liftSurface.metadata = { lightmapIndex: 0, textureName: "metal" };
    lift.parent = worldMesh;

    const frozen = BspMeshBuilder.freezeStaticWorld({ worldMesh } as BspMeshBuildResult);

    expect(frozen).toBe(2); // world root + the one authored surface
    expect(lift.isWorldMatrixFrozen).toBe(false);
    expect(lift.doNotSyncBoundingInfo).toBe(false);
    // getChildMeshes() is recursive, so the sub-mesh is reached and must also survive.
    expect(liftSurface.isWorldMatrixFrozen).toBe(false);
    expect(liftSurface.doNotSyncBoundingInfo).toBe(false);
  });

  it("returns 0 when there is no world mesh", () => {
    expect(BspMeshBuilder.freezeStaticWorld({ worldMesh: null } as unknown as BspMeshBuildResult)).toBe(0);
  });
});
