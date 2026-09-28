import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraSystem } from "../camera/CameraSystem";
import { ShaderCommand } from "../console/commands/ShaderCommand";
import { inspectAimedSurfaces } from "../rendering/SurfaceDiagnostics";

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("world", new Vector3(0, 0, -3), scene);
  camera.setTarget(Vector3.Zero());
  camera.layerMask = 1;
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function plane(name: string, z: number) {
  const mesh = CreatePlane(name, {}, scene);
  mesh.position.z = z;
  mesh.layerMask = 1;
  mesh.computeWorldMatrix(true);
  return mesh;
}

describe("aimed surface diagnostic", () => {
  it("reports overlapping layers and actual texture state through the console command without altering them", async () => {
    const floor = plane("floor", 0);
    floor.metadata = { textureName: "textures/floor", lightmapIndex: 3 };
    const decal = plane("decal", -0.01);
    decal.metadata = { textureName: "textures/decal", lightmapIndex: -1 };
    const material = new StandardMaterial("decal-material", scene);
    decal.material = material;
    const texture = new Texture(null, scene);
    texture.name = "asymmetric";
    texture.url = "/data/ktx2cache/asymmetric.ktx2";
    texture.vScale = -1;
    texture.vOffset = 1;
    material.diffuseTexture = texture;
    material.disableDepthWrite = true;
    material.zOffset = -2;
    material.freeze();
    const meshes = [...scene.meshes];
    const textures = [...scene.textures];
    const materials = [...scene.materials];
    vi.spyOn(CameraSystem.getInstance(), "getCamera").mockReturnValue(camera);
    const text = await new ShaderCommand().execute(["surface"]);
    const report = JSON.parse(text.replace("RENDERER_SURFACE_REPORT ", ""));
    expect(report.backend).toBe("null");
    expect(report.surfaces.map((surface: { mesh: string }) => surface.mesh)).toEqual(["decal", "floor"]);
    expect(report.surfaces[0].material).toMatchObject({ frozen: true, disableDepthWrite: true, zOffset: -2 });
    expect(report.surfaces[0].material.textures[0]).toMatchObject({
      name: "asymmetric",
      url: texture.url,
      scale: [1, -1],
      offset: [0, 1],
    });
    expect(report.surfaces[0].uv).toEqual([0.5, 0.5]);
    expect(report.surfaces[1].lightmapPage).toBe(3);
    expect(scene.meshes).toEqual(meshes);
    expect(scene.textures).toEqual(textures);
    expect(scene.materials).toEqual(materials);
    expect(material.isFrozen).toBe(true);
    expect(texture.vScale).toBe(-1);
  });

  it("excludes hidden, disabled, non-pickable and other-camera meshes, and bounds the result", () => {
    plane("hidden", -2).isVisible = false;
    plane("disabled", -2).setEnabled(false);
    plane("non-pickable", -2).isPickable = false;
    plane("weapon-layer", -2).layerMask = 2;
    for (let i = 0; i < 10; i++) plane(`layer-${i}`, i * 0.01);
    const report = inspectAimedSurfaces(scene, camera);
    expect(report.hitCount).toBe(10);
    expect(report.surfaces.map((surface) => surface.mesh)).toEqual(Array.from({ length: 8 }, (_, i) => `layer-${i}`));
    camera.setTarget(new Vector3(0, 10, -3));
    expect(inspectAimedSurfaces(scene, camera).hitCount).toBe(0);
  });
});
