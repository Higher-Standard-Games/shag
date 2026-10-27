// Research-only synthetic experiment. Run from the assembled repository root.
import fs from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
fs.mkdirSync(".cache/cpu-study", { recursive: true });
const engine = new NullEngine(),
  scene = new Scene(engine);
let seed = 941;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const randomQ = () => Quaternion.RotationYawPitchRoll(random() * 1.4 - 0.7, random() * 0.8 - 0.4, random() * 0.6 - 0.3);
let maxMatrixError = 0,
  nativeRebuilds = 0,
  batchedRebuilds = 0;
function rig(id, locals, rotation) {
  const mesh = new Mesh(id, scene);
  mesh.rotationQuaternion = rotation.clone();
  mesh.scaling.setAll(2);
  mesh.position.set(3, 4, 5);
  mesh.computeWorldMatrix(true);
  const skeleton = new Skeleton(id, id, scene);
  for (let i = 0; i < 64; i++)
    new Bone(
      "b" + i,
      skeleton,
      i ? skeleton.bones[Math.floor((i - 1) / 2)] : null,
      Matrix.Compose(Vector3.One(), locals[i], new Vector3(0, 1, 0)),
    );
  mesh.skeleton = skeleton;
  skeleton.computeAbsoluteMatrices(true);
  return { mesh, skeleton };
}
try {
  for (let trial = 0; trial < 32; trial++) {
    const locals = Array.from({ length: 64 }, randomQ),
      rotation = randomQ();
    const native = rig("native" + trial, locals, rotation),
      batch = rig("batch" + trial, locals, rotation);
    const targets = Array.from({ length: 16 }, randomQ);
    for (const [obj, key] of [
      [native, "native"],
      [batch, "batch"],
    ]) {
      const original = obj.skeleton.computeAbsoluteMatrices;
      obj.skeleton.computeAbsoluteMatrices = function (force) {
        if (this._absoluteTransformIsDirty || force) {
          if (key === "native") nativeRebuilds++;
          else batchedRebuilds++;
        }
        return original.call(this, force);
      };
    }
    for (let i = 0; i < targets.length; i++) native.skeleton.bones[i].setRotationQuaternion(targets[i], 1, native.mesh);
    const world = [];
    for (let i = 0; i < 64; i++) {
      const parent = i ? world[Math.floor((i - 1) / 2)] : rotation;
      if (i < targets.length) {
        world[i] = targets[i];
        const local = Quaternion.Inverse(parent).multiply(world[i]);
        batch.skeleton.bones[i].setRotationQuaternion(local, 0);
      } else world[i] = parent.multiply(locals[i]);
    }
    native.skeleton.computeAbsoluteMatrices();
    batch.skeleton.computeAbsoluteMatrices();
    for (let i = 0; i < 64; i++)
      for (let j = 0; j < 16; j++)
        maxMatrixError = Math.max(
          maxMatrixError,
          Math.abs(
            native.skeleton.bones[i].getAbsoluteMatrix().m[j] - batch.skeleton.bones[i].getAbsoluteMatrix().m[j],
          ),
        );
    native.mesh.dispose();
    native.skeleton.dispose();
    batch.mesh.dispose();
    batch.skeleton.dispose();
  }
  if (maxMatrixError > 1e-5) throw new Error("Synthetic batched-pose parity failed");
  const result = {
    synthetic: true,
    trials: 32,
    bones: 64,
    controlledBones: 16,
    nativeRebuilds,
    batchedRebuilds,
    maxMatrixError,
    limitation:
      "Positive uniform mesh scale, parent-first synthetic binary rig. No negative/nonuniform scale, Vanguard bind conventions, root position transfer, live physics or visual parity claim.",
  };
  fs.writeFileSync(".cache/cpu-study/batched-bone-proof-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  scene.dispose();
  engine.dispose();
}
