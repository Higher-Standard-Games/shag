import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { BspVertexLightingPlugin } from "../loader/bsp/BspVertexLightingPlugin";
import { configureQ3DistanceRamp } from "../loader/shader/Q3DistanceRampPlugin";
import { Q3EnvironmentPlugin } from "../loader/shader/Q3EnvironmentPlugin";
import type { ResolvedMaterialProps } from "../loader/shader/Q3ShaderTypes";
import { configureQ3SoftParticle } from "../loader/shader/Q3SoftParticlePlugin";
import { Q3StageColorPlugin } from "../loader/shader/Q3StageColorPlugin";

it("keeps shader programs distinct for different Quake plugin layouts and code variants", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera("camera", new Vector3(0, 0, -3), scene);
  const texture = new Texture(null, scene);
  texture.isReady = () => true;
  const ramp = (material: StandardMaterial) =>
    configureQ3DistanceRamp(material, {
      map: "test",
      alphaGen: { type: "distanceRamp", distanceRamp: { from: 0, to: 1, near: 0, far: 10 } },
    });
  const soft = (material: StandardMaterial) =>
    configureQ3SoftParticle(material, {
      softParticle: true,
      isTransparent: true,
    } as ResolvedMaterialProps);
  const setups = [
    ramp,
    (material: StandardMaterial) => {
      ramp(material);
      soft(material);
    },
    (material: StandardMaterial) => {
      new Q3StageColorPlugin(material, [1, 1, 1]);
      soft(material);
    },
    (material: StandardMaterial) => {
      new Q3StageColorPlugin(material, [1, 1, 1], true);
      soft(material);
    },
    (material: StandardMaterial) => {
      new Q3EnvironmentPlugin(material, texture, false);
      soft(material);
    },
    (material: StandardMaterial) => {
      new Q3EnvironmentPlugin(material, texture, true);
      soft(material);
    },
    (material: StandardMaterial) => {
      new BspVertexLightingPlugin(material);
      soft(material);
    },
    soft,
  ];
  try {
    const effects = [];
    for (const [i, setup] of setups.entries()) {
      const material = new StandardMaterial(`variant_${i}`, scene);
      material.disableLighting = true;
      const mesh = MeshBuilder.CreatePlane(`variant_${i}`, {}, scene);
      mesh.material = material;
      setup(material);
      await material.forceCompilationAsync(mesh);
      material.isReadyForSubMesh(mesh, mesh.subMeshes[0]);
      effects.push(mesh.subMeshes[0].effect);
    }
    expect(effects.every(Boolean)).toBe(true);
    expect(new Set(effects).size).toBe(setups.length);
    expect(effects[0]!.defines).toContain("#define Q3_DISTANCE_RAMP");
    expect(effects[0]!.defines).not.toContain("#define Q3_SOFT_PARTICLE");
    expect(effects[1]!.defines).toContain("#define Q3_SOFT_PARTICLE");
    expect(effects[2]!.defines).not.toContain("#define Q3_STAGE_VERTEX");
    expect(effects[3]!.defines).toContain("#define Q3_STAGE_VERTEX");
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
