// Research-only synthetic experiment. Run from the assembled repository root.
import fs from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate.js";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import { Ragdoll } from "@babylonjs/core/Physics/v2/ragdoll.js";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent.js";
import HavokPhysics from "@babylonjs/havok";

fs.mkdirSync(".cache/cpu-study", { recursive: true });
const hk = await HavokPhysics({ wasmBinary: new Uint8Array(fs.readFileSync("public/wasm/HavokPhysics.wasm")) });
function run(disablePreStep) {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    plugin = new HavokPlugin(true, hk);
  scene.enablePhysics(new Vector3(0, -10, 0), plugin);
  const floor = CreateBox("floor", { width: 30, height: 1, depth: 30 }, scene);
  floor.position.y = -0.5;
  const floorBody = new PhysicsAggregate(floor, 3, { mass: 0 }, scene);
  const mesh = new Mesh("rig", scene);
  mesh.position.y = 5;
  mesh.computeWorldMatrix(true);
  const sk = new Skeleton("rig", "rig", scene);
  for (let i = 0; i < 3; i++) new Bone("b" + i, sk, i ? sk.bones[i - 1] : null, Matrix.Translation(0, i ? 1 : 0, 0));
  mesh.skeleton = sk;
  sk.computeAbsoluteMatrices(true);
  const rd = new Ragdoll(
    sk,
    mesh,
    [0, 1, 2].map((i) => ({ bone: "b" + i, width: 0.4, height: 0.6, depth: 0.4, mass: 1, boxOffset: 0 })),
  );
  rd.ragdoll();
  const bodies = [0, 1, 2].map((i) => rd.getAggregate(i).body);
  for (const b of bodies) {
    b.disablePreStep = disablePreStep;
    b.setLinearVelocity(new Vector3(1, 0, 0.2));
  }
  let preSteps = 0;
  const original = plugin.setPhysicsBodyTransformation.bind(plugin);
  plugin.setPhysicsBodyTransformation = (...args) => {
    preSteps++;
    return original(...args);
  };
  const poses = [];
  for (let i = 0; i < 1200; i++) {
    scene.getPhysicsEngine()._step(1 / 125);
    rd._syncBonesAndBoxes();
    poses.push(
      bodies.flatMap((b) => [
        ...b.transformNode.position.asArray(),
        ...b.transformNode.rotationQuaternion.asArray(),
        ...b.getLinearVelocity().asArray(),
      ]),
    );
  }
  rd.dispose();
  floorBody.dispose();
  scene.dispose();
  engine.dispose();
  return { disablePreStep, preSteps, poses };
}
const baseline = run(false),
  baselineRepeat = run(false),
  disabled = run(true);
let controlMaxDifference = 0;
for (let i = 0; i < baseline.poses.length; i++)
  for (let j = 0; j < baseline.poses[i].length; j++)
    controlMaxDifference = Math.max(controlMaxDifference, Math.abs(baseline.poses[i][j] - baselineRepeat.poses[i][j]));
let maxDifference = 0,
  maxPosition = 0,
  maxQuaternion = 0,
  maxVelocity = 0,
  firstDivergedTick = null;
for (let i = 0; i < baseline.poses.length; i++)
  for (let j = 0; j < baseline.poses[i].length; j++) {
    const diff = Math.abs(baseline.poses[i][j] - disabled.poses[i][j]);
    maxDifference = Math.max(maxDifference, diff);
    if (j % 10 < 3) maxPosition = Math.max(maxPosition, diff);
    else if (j % 10 < 7) maxQuaternion = Math.max(maxQuaternion, diff);
    else maxVelocity = Math.max(maxVelocity, diff);
    if (diff > 1e-4 && firstDivergedTick === null) firstDivergedTick = i;
  }
if (controlMaxDifference > 1e-6) throw new Error("Unstable same-configuration Havok control");
const result = {
  synthetic: true,
  bones: 3,
  ticks: 1200,
  tickHz: 125,
  baselinePreSteps: baseline.preSteps,
  disabledPreSteps: disabled.preSteps,
  maxPositionQuaternionVelocityComponentDifference: maxDifference,
  maxPosition,
  maxQuaternionComponentDifferenceSignSensitive: maxQuaternion,
  maxVelocity,
  firstDivergedTick,
  controlMaxDifference,
  limitation:
    "Small synthetic jointed ragdoll with floor, not Vanguard asset parity or a performance benchmark. Quaternion component differences are sign-sensitive, not orientation error.",
};
fs.writeFileSync(".cache/cpu-study/havok-prestep-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
