import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export interface PlayerModelFit {
  scale: number;
  offsetY: number;
}

/** Fit the standing idle silhouette once, preserving the template's original pose. */
export function measurePlayerModelFit(container: AssetContainer, height: number): PlayerModelFit | undefined {
  const skeleton = container.skeletons[0];
  const idle = container.animationGroups.find((group) => group.name === "idle");
  if (!skeleton || !idle || !skeleton.bones.some((bone) => bone.name === "mixamorig:Head")) return;
  const states = skeleton.bones.flatMap((bone) => {
    const node = bone.getTransformNode();
    return node
      ? [
          {
            node,
            position: node.position.clone(),
            scale: node.scaling.clone(),
            rotation: node.rotation.clone(),
            quaternion: node.rotationQuaternion?.clone(),
          },
        ]
      : [];
  });
  try {
    idle.start(false);
    idle.goToFrame(idle.from);
    for (const state of states) state.node.computeWorldMatrix(true);
    skeleton.prepare(true);
    let minY = Infinity,
      maxY = -Infinity;
    const point = new Vector3();
    for (const part of container.meshes) {
      const mesh = part as Mesh;
      if (mesh.skeleton !== skeleton) continue;
      const positions = mesh.getPositionData(true, false);
      if (!positions) continue;
      const world = mesh.computeWorldMatrix(true);
      for (let index = 0; index < positions.length; index += 3) {
        point.set(positions[index], positions[index + 1], positions[index + 2]);
        Vector3.TransformCoordinatesToRef(point, world, point);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
    if (!Number.isFinite(minY + maxY) || maxY - minY < 0.001) return;
    const scale = height / (maxY - minY);
    return { scale, offsetY: -minY * scale };
  } finally {
    idle.stop();
    for (const state of states) {
      state.node.position.copyFrom(state.position);
      state.node.scaling.copyFrom(state.scale);
      state.node.rotation.copyFrom(state.rotation);
      if (state.quaternion) state.node.rotationQuaternion = state.quaternion;
      else state.node.rotationQuaternion = null;
      state.node.computeWorldMatrix(true);
    }
    skeleton.prepare(true);
  }
}
