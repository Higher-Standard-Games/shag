import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Matrix, type Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export interface PlayerModelFit {
  scale: number;
  offsetY: number;
}

/** Run `measure` on the template posed at the first frame of `clip`, then restore its pose. */
function withClipPose<T>(
  container: AssetContainer,
  clip: string,
  measure: (skeleton: Skeleton) => T | undefined,
): T | undefined {
  const skeleton = container.skeletons[0];
  const idle = container.animationGroups.find((group) => group.name === clip);
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
    return measure(skeleton);
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

/** Fit the standing idle silhouette once, preserving the template's original pose. */
export function measurePlayerModelFit(container: AssetContainer, height: number): PlayerModelFit | undefined {
  return withClipPose(container, "idle", (skeleton) => {
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
  });
}

/** A weapon hand's rotation and scale relative to its bone. */
export interface HandBasis {
  rotation: Quaternion;
  scale: Vector3;
}

/** The weapon hand's frame in the template's world, from the posed right hand. */
function weaponHandWorld(skeleton: Skeleton, handBasis: HandBasis): Matrix | undefined {
  const right = skeleton.bones.find((bone) => bone.name === "mixamorig:RightHand")?.getTransformNode();
  if (!right) return;
  return Matrix.Compose(handBasis.scale, handBasis.rotation, Vector3.Zero()).multiply(right.getWorldMatrix());
}

/** A palm's centre: between the wrist and the middle finger's base, where the finger has a joint. */
function palmCentre(skeleton: Skeleton, side: "Left" | "Right"): Vector3 | undefined {
  const node = (name: string) => skeleton.bones.find((bone) => bone.name === name)?.getTransformNode();
  const wrist = node(`mixamorig:${side}Hand`);
  if (!wrist) return;
  const palm = wrist.getAbsolutePosition().clone();
  const finger = node(`mixamorig:${side}HandMiddle1`);
  if (finger) palm.addInPlace(finger.getAbsolutePosition()).scaleInPlace(0.5);
  return palm;
}

/** What a held gun is fitted to, in the weapon hand's frame in the standing idle. */
export interface GunSupport {
  /** The supporting palm, which the gun's barrel rests on. */
  palm: Vector3;
  /** The body's front (+Z in the template), which the barrel points along. */
  forward: Vector3;
}

/** The supporting palm and the body's front in the weapon hand's frame in the standing idle. */
export function measureGunSupport(container: AssetContainer, handBasis: HandBasis): GunSupport | undefined {
  return withClipPose(container, "idle", (skeleton) => {
    const palm = palmCentre(skeleton, "Left");
    const weaponHand = weaponHandWorld(skeleton, handBasis);
    if (!palm || !weaponHand) return;
    const toHand = weaponHand.invert();
    const local = Vector3.TransformCoordinates(palm, toHand);
    const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), toHand).normalize();
    if (local.lengthSquared() < 1e-8 || !Number.isFinite(forward.x + forward.y + forward.z)) return;
    return { palm: local, forward };
  });
}

/** How a held blade stands in its stance, in the weapon hand's frame. */
export interface BladeStance {
  /** The blade's direction from its handle to its tip. */
  axis: Vector3;
  /** The body's sideways direction, square to `axis`: the blade's flat faces it, so an edge leads. */
  side: Vector3;
  /** The centre of the gun hand's fist, where the handle passes. */
  fist: Vector3;
}

/**
 * How a blade stands in `clip`'s first frame: up, leaning `lean` radians
 * toward the body's front (+Z in the template), with its handle through the
 * gun hand's fist. A rig without finger joints puts the fist a third of a
 * forearm along the fingers (the weapon hand's +Y) from the wrist.
 */
export function measureBladeStance(
  container: AssetContainer,
  handBasis: HandBasis,
  clip: string,
  lean: number,
): BladeStance | undefined {
  return withClipPose(container, clip, (skeleton) => {
    const node = (name: string) => skeleton.bones.find((bone) => bone.name === name)?.getTransformNode();
    const world = weaponHandWorld(skeleton, handBasis);
    const wrist = node("mixamorig:RightHand");
    const forearm = node("mixamorig:RightForeArm");
    if (!world || !wrist || !forearm) return;
    const toHand = world.clone().invert();
    const axis = Vector3.TransformNormal(new Vector3(0, Math.cos(lean), Math.sin(lean)), toHand).normalize();
    const across = Vector3.TransformNormal(new Vector3(1, 0, 0), toHand);
    const side = across.subtract(axis.scale(Vector3.Dot(across, axis))).normalize();
    const wristAt = wrist.getAbsolutePosition();
    const finger = node("mixamorig:RightHandMiddle1");
    const fingers = Vector3.TransformNormal(Vector3.Up(), world).normalize();
    const fistAt = finger
      ? wristAt.add(finger.getAbsolutePosition()).scale(0.5)
      : wristAt.add(fingers.scale(Vector3.Distance(wristAt, forearm.getAbsolutePosition()) / 3));
    const fist = Vector3.TransformCoordinates(fistAt, toHand);
    if (![axis, side, fist].every((v) => Number.isFinite(v.x + v.y + v.z))) return;
    return { axis, side, fist };
  });
}
