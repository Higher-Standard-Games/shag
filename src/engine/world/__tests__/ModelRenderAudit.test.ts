/**
 * ModelRenderAudit (NullEngine). pickup_audit and the map load's readiness
 * check have to say why an enabled mesh is not on screen from a single
 * capture, so their fields are pinned here.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeModelRender, describeUnreadyMeshes } from "../ModelRenderAudit";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.activeCamera = new FreeCamera("camera", new Vector3(0, 0, -100), scene);
});

afterEach(() => engine.dispose());

/** A box whose material samples a texture that has been released, so it can never be ready. */
function waitingOnReleasedTexture(name: string): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
  const material = new StandardMaterial(`${name}_material`, scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  texture.name = `${name}_texture`;
  material.diffuseTexture = texture;
  mesh.material = material;
  texture.dispose();
  return mesh;
}

describe("describeModelRender", () => {
  it("reports where the vertices are in world space, not only the transform", () => {
    const leader = MeshBuilder.CreateBox("leader", { size: 2 }, scene);
    leader.position.set(10, 20, 30);
    leader.scaling.setAll(2);

    const report = describeModelRender(leader, scene);

    expect(report).toContain("skinned=@10,20,30 size=4x4x4");
    expect(report).toContain("meshes=1");
    expect(report).toContain("physics=none");
    expect(report).toContain(`layer=0x${leader.layerMask.toString(16)},group=0`);
  });

  it("counts child meshes and reports how many are enabled", () => {
    const leader = MeshBuilder.CreateBox("leader", { size: 1 }, scene);
    const child = MeshBuilder.CreateBox("child", { size: 1 }, scene);
    child.parent = leader;
    child.setEnabled(false);

    expect(describeModelRender(leader, scene)).toContain("enabled=1/2");
  });

  it("names a released texture that a mesh that is not ready is waiting on", () => {
    const leader = MeshBuilder.CreateBox("leader", { size: 1 }, scene);
    const material = new StandardMaterial("models/weapons/rlauncher/rlauncher", scene);
    const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
    texture.name = "rlauncher_body";
    material.diffuseTexture = texture;
    leader.material = material;
    texture.dispose();

    const report = describeModelRender(leader, scene);

    expect(report).toContain("ready=0/1");
    expect(report).toContain("notReady=[models/weapons/rlauncher/rlauncher:textures(rlauncher_body[released])]");
  });
});

describe("describeUnreadyMeshes", () => {
  it("names each mesh that would be drawn but is not ready, with what it waits on", () => {
    const wall = waitingOnReleasedTexture("bsp_tex_3");

    expect(describeUnreadyMeshes([wall])).toEqual([
      "bsp_tex_3(bsp_tex_3_material:textures(bsp_tex_3_texture[released]))",
    ]);
  });

  it("leaves out meshes nothing is drawn for: hidden, disabled or empty", () => {
    const hidden = waitingOnReleasedTexture("hidden_by_pvs");
    hidden.isVisible = false;
    const disabled = waitingOnReleasedTexture("disabled");
    disabled.setEnabled(false);
    const empty = new Mesh("empty", scene);

    expect(describeUnreadyMeshes([hidden, disabled, empty])).toEqual([]);
  });
});
