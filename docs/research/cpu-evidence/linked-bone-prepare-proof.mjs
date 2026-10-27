// Research-only reproduction. Run from the assembled repository root.
import fs from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";

fs.mkdirSync(".cache/cpu-study", { recursive: true });
const engine = new NullEngine(),
  scene = new Scene(engine);
try {
  const skeleton = new Skeleton("linked", "linked", scene);
  const bone = new Bone("bone", skeleton, null, Matrix.Identity());
  bone.linkTransformNode(new TransformNode("link", scene));
  let builds = 0;
  const original = skeleton._computeTransformMatrices;
  skeleton._computeTransformMatrices = function (...args) {
    builds++;
    return original.apply(this, args);
  };
  scene.incrementRenderId();
  skeleton.prepare();
  builds = 0;
  for (let i = 0; i < 16; i++) {
    scene.incrementRenderId();
    skeleton.prepare();
  }
  const linked = builds;
  bone.linkTransformNode(null);
  scene.incrementRenderId();
  skeleton.prepare();
  builds = 0;
  for (let i = 0; i < 16; i++) {
    scene.incrementRenderId();
    skeleton.prepare();
  }
  const result = {
    synthetic: true,
    unchangedPoseFrames: 16,
    linkedSkinMatrixBuilds: linked,
    unlinkedControlBuilds: builds,
    limitation:
      "One static linked bone. Detaching links is a diagnostic control, not a proposed game change. Does not quantify current Vanguard pose-LOD uploads.",
  };
  fs.writeFileSync(".cache/cpu-study/linked-bone-prepare-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  scene.dispose();
  engine.dispose();
}
