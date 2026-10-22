import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { type Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
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
  const pellet = (
    fx as unknown as {
      travelingPellets: { mesh: { position: Vector3; scaling: Vector3; rotationQuaternion: Quaternion } }[];
    }
  ).travelingPellets[0];
  const rotation = pellet.mesh.rotationQuaternion.clone();

  clock = 10.5; // halfway: head at 0.5, tail at 0.35 of the ray
  fx.update(0.016);
  expect(pellet.mesh.position.x).toBeCloseTo(300 * 0.425, 5);
  expect(pellet.mesh.position.z).toBeCloseTo(400 * 0.425, 5);
  expect(pellet.mesh.scaling.y).toBeCloseTo(500 * 0.15, 5);
  expect(pellet.mesh.rotationQuaternion.equalsWithEpsilon(rotation, 1e-9)).toBe(true);
  scene.dispose();
  engine.dispose();
});
