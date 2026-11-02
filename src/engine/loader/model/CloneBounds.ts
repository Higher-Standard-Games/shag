import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

interface CloneInternals {
  _copySource?: (this: Mesh, source: Mesh, ...rest: unknown[]) => void;
  refreshBoundingInfo: (this: Mesh, ...args: unknown[]) => Mesh;
}

/**
 * Run `clone` with every mesh clone taking its source's bounds.
 *
 * Babylon ends each mesh clone with `refreshBoundingInfo(applySkeleton,
 * applyMorph)`, which skins every vertex on the CPU to bound the copy: about
 * half of cloning a weapon model (Voltaic 8 → 2.4 ms). A clone shares its
 * source's geometry, so its source's local bounds are the same box. `clone`
 * must be synchronous; without Babylon's internal `_copySource` the clone runs
 * unchanged.
 */
export function cloneWithSourceBounds<T>(clone: () => T): T {
  const proto = Mesh.prototype as unknown as CloneInternals;
  const copySource = proto._copySource;
  if (typeof copySource !== "function") return clone();
  const refresh = proto.refreshBoundingInfo;
  const keepBounds = function (this: Mesh): Mesh {
    return this;
  };
  proto._copySource = function (this: Mesh, source: Mesh, ...rest: unknown[]) {
    proto.refreshBoundingInfo = keepBounds;
    try {
      copySource.call(this, source, ...rest);
    } finally {
      proto.refreshBoundingInfo = refresh;
    }
    const bounds = source.getBoundingInfo();
    this.setBoundingInfo(new BoundingInfo(bounds.minimum, bounds.maximum));
  };
  try {
    return clone();
  } finally {
    proto._copySource = copySource;
  }
}
