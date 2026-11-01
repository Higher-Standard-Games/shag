import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { HitscanEffects } from "../weapon/HitscanEffects";

it("slides a pellet tracer along its ray, keeping the rotation it got at spawn", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const fx = HitscanEffects.getInstance();
  fx.init(scene);
  let clock = 10;
  (fx as unknown as { presentationClock: () => number }).presentationClock = () => clock;
  const origin = new Vector3(0, 0, 0);
  const end = new Vector3(300, 0, 400); // length 500
  (fx as unknown as { spawnTravelingPellet(...a: unknown[]): void }).spawnTravelingPellet(
    origin,
    end,
    Color3.White(),
    1,
    clock,
  );
  const internals = fx as unknown as {
    pelletMatrices: Float32Array;
    pelletColors: Float32Array;
    pelletMesh: { thinInstanceCount: number };
  };
  // Every pellet is an instance of one cone: its pose is a slot in the matrix buffer
  const pose = () => {
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    Matrix.FromArray(internals.pelletMatrices, 0).decompose(scaling, rotation, position);
    return { scaling, rotation, position };
  };

  clock = 10.1;
  fx.update(0.016);
  const rotation = pose().rotation.clone();

  clock = 10.5; // halfway: head at 0.5, tail at 0.35 of the ray
  fx.update(0.016);
  expect(internals.pelletMesh.thinInstanceCount).toBe(1);
  expect(pose().position.x).toBeCloseTo(300 * 0.425, 3);
  expect(pose().position.z).toBeCloseTo(400 * 0.425, 3);
  expect(pose().scaling.y).toBeCloseTo(500 * 0.15, 3);
  expect(pose().rotation.equalsWithEpsilon(rotation, 1e-6)).toBe(true);
  expect(internals.pelletColors[3]).toBe(1);

  // The last 30% of the flight fades it, then it is gone
  clock = 10.85;
  fx.update(0.016);
  expect(internals.pelletColors[3]).toBeCloseTo(0.5, 5);
  clock = 11.01;
  fx.update(0.016);
  expect(internals.pelletMesh.thinInstanceCount).toBe(0);
  fx.clear();
  scene.dispose();
  engine.dispose();
});
