import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PlayerModelInstance } from "./PlayerModelManager";

/** An additive spine bend, restored before clips evaluate so paused poses never accumulate it. */
export class PlayerAimPose {
  pitch = 0;
  private readonly joints: { node: TransformNode; base: Quaternion; applied: Quaternion; active: boolean }[];
  private readonly inverse = Matrix.Identity();
  private readonly axis = Vector3.Zero();
  private readonly rotation = Quaternion.Identity();
  private readonly worldRight = Vector3.Zero();

  constructor(private readonly instance: PlayerModelInstance) {
    this.joints = ["mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2"].flatMap((name) => {
      const node = instance.skeleton?.bones.find((bone) => bone.name === name)?.getTransformNode();
      return node?.rotationQuaternion
        ? [{ node, base: Quaternion.Identity(), applied: Quaternion.Identity(), active: false }]
        : [];
    });
  }

  restore(): void {
    for (const joint of this.joints) {
      // A goToFrame between renders may already have replaced the additive pose.
      if (joint.active && joint.node.rotationQuaternion?.equals(joint.applied)) {
        joint.node.rotationQuaternion.copyFrom(joint.base);
      }
      joint.active = false;
    }
  }

  apply(): void {
    this.restore();
    if (
      !this.pitch ||
      !this.joints.length ||
      this.instance.mesh.isDisposed() ||
      !this.instance.mesh.isEnabled() ||
      !this.instance.skeleton?.bones.some((bone) => bone.getTransformNode() === this.joints[0].node)
    )
      return;
    this.worldRight.set(Math.cos(this.instance.anchor.rotation.y), 0, -Math.sin(this.instance.anchor.rotation.y));
    for (const joint of this.joints) {
      const parent = joint.node.parent;
      const quaternion = joint.node.rotationQuaternion;
      if (!parent || !quaternion) continue;
      const world = parent.computeWorldMatrix(true);
      world.invertToRef(this.inverse);
      Vector3.TransformNormalToRef(this.worldRight, this.inverse, this.axis);
      this.axis.normalize();
      const angle = (this.pitch / this.joints.length) * (world.determinant() < 0 ? -1 : 1);
      Quaternion.RotationAxisToRef(this.axis, angle, this.rotation);
      joint.base.copyFrom(quaternion);
      this.rotation.multiplyToRef(quaternion, joint.applied);
      quaternion.copyFrom(joint.applied);
      joint.active = true;
    }
  }
}
