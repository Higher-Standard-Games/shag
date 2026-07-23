/**
 * BspMeshBuilder.freezeStaticWorld (NullEngine). Verifies the static-BSP
 * world-matrix freeze optimization: static world meshes (`bsp_world` +
 * `bsp_tex_*`) get their world matrix + bounding-info sync frozen, while
 * autosprites (which rewrite vertex data every frame to billboard) are left
 * live so their per-frame update still works.
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
    const autosprite = new Mesh("bsp_autosprite_0", scene);
    autosprite.parent = worldMesh;
    autosprite.metadata = { autosprite: true };

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
    autosprite2.metadata = { autosprite2: true };

    const frozen = BspMeshBuilder.freezeStaticWorld({ worldMesh } as BspMeshBuildResult);

    expect(frozen).toBe(1); // world only
    expect(autosprite2.isWorldMatrixFrozen).toBe(false);
  });

  it("returns 0 when there is no world mesh", () => {
    expect(BspMeshBuilder.freezeStaticWorld({ worldMesh: null } as unknown as BspMeshBuildResult)).toBe(0);
  });
});
