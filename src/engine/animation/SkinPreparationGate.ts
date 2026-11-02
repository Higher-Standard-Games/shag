import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Skips a skeleton's skin-matrix rebuild when its pose has not changed.
 *
 * `Skeleton.prepare()` copies every linked TransformNode's position, rotation
 * and scale into its bone before checking whether anything is dirty, and those
 * setters mark the skeleton dirty even when the value is the same. A skeleton
 * driven by glTF animation therefore rebuilds every bone matrix and uploads its
 * matrix texture on every frame it is drawn: between the steps of a stepped
 * locomotion clip, while a weapon or pickup holds a fixed pose, always.
 *
 * When every bone is linked, the palette `prepare()` builds is a function of
 * those linked values alone, so equal values give an equal palette. The gate
 * keeps the values of the last build and compares them on each call: equal
 * means the previous palette and texture are still exact, and `prepare()` is
 * not called. A skeleton with any unlinked bone (a ragdoll), a linked node that
 * uses Euler rotation, or `needInitialSkinMatrix` always prepares natively. A
 * rig that keeps moving (a running player) skips most comparisons: they would
 * find it changed anyway.
 */
const VALUES_PER_BONE = 10;
/** Changed builds in a row after which a rig builds this many times without comparing. */
const MOVING_RUN = 8;

/** Linked values against the last build, or a skeleton the gate leaves alone. */
type Pose = "unchanged" | "changed" | "ungated";

const gated = new WeakSet<Skeleton>();

/** Gate one skeleton. Safe to call more than once. */
export function gateSkeletonPreparation(skeleton: Skeleton): void {
  if (gated.has(skeleton)) return;
  gated.add(skeleton);
  const prepare = skeleton.prepare;
  let values = new Float64Array(0);
  let built = false;
  let renderId = -1;
  let same = false;
  /** Builds in a row that compared changed, and builds left to make without comparing. */
  let changedRun = 0;
  let uncompared = 0;

  const store = (index: number, value: number): void => {
    if (values[index] === value) return;
    values[index] = value;
    same = false;
  };

  /** Compares the linked values with the last build's, storing the current ones. */
  const compare = (): Pose => {
    if (skeleton.needInitialSkinMatrix) return "ungated";
    const bones = skeleton.bones;
    if (bones.length === 0) return "ungated";
    if (values.length !== bones.length * VALUES_PER_BONE) {
      values = new Float64Array(bones.length * VALUES_PER_BONE);
      built = false;
    }
    same = built;
    let i = 0;
    for (const bone of bones) {
      const node = bone.getTransformNode();
      const rotation = node?.rotationQuaternion;
      if (!node || !rotation) return "ungated";
      const { position, scaling } = node;
      store(i, position.x);
      store(i + 1, position.y);
      store(i + 2, position.z);
      store(i + 3, rotation.x);
      store(i + 4, rotation.y);
      store(i + 5, rotation.z);
      store(i + 6, rotation.w);
      store(i + 7, scaling.x);
      store(i + 8, scaling.y);
      store(i + 9, scaling.z);
      i += VALUES_PER_BONE;
    }
    return same ? "unchanged" : "changed";
  };

  skeleton.prepare = function (this: Skeleton, dontCheckFrameId = false): void {
    if (!dontCheckFrameId) {
      const current = this.getScene().getRenderId();
      if (renderId === current) return;
      renderId = current;
    }
    // A rig that moved on every recent frame (a running player) builds without
    // the comparison for a while; the stored values are then stale, so the next
    // comparison counts as changed and builds once more
    if (uncompared > 0) {
      uncompared--;
      built = false;
      prepare.call(this, dontCheckFrameId);
      return;
    }
    const pose = compare();
    if (pose === "unchanged") {
      changedRun = 0;
      return;
    }
    prepare.call(this, dontCheckFrameId);
    // With every bone linked, the build that just ran used exactly the stored values
    built = pose === "changed";
    if (pose === "changed" && ++changedRun >= MOVING_RUN) {
      changedRun = 0;
      uncompared = MOVING_RUN;
    }
  };
}

/**
 * Gate every skeleton the scene has now or adds later. Babylon announces a new
 * skeleton on the next tick, so one drawn in the tick it was created prepares
 * natively until then.
 */
export function gateSkinPreparation(scene: Scene): void {
  for (const skeleton of scene.skeletons) gateSkeletonPreparation(skeleton);
  scene.onNewSkeletonAddedObservable.add(gateSkeletonPreparation);
}
