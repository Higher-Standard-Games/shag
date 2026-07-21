/**
 * bakeWorldTransformIntoVertices — flatten a glTF-imported mesh's world
 * transform (notably Babylon's `__root__` handedness flip) into its geometry.
 *
 * Babylon's glTF loader parents imported meshes under a `__root__` node that
 * carries a `(1,1,-1)` scale to convert glTF's right-handed space to Babylon's
 * left-handed one. That negative determinant makes Babylon flip cull order at
 * draw time so faces read correctly WHILE the mesh stays under `__root__`.
 *
 * Any path that reparents such a mesh away from `__root__` to an identity parent
 * (e.g. the pickup preloader cloning cached child meshes to a fresh root) drops
 * that flip, so the effective winding reverses and every face becomes a
 * backface — the mesh renders invisible. Baking the world matrix into the
 * vertices flips the indices for the negative determinant
 * (`Mesh.bakeTransformIntoVertices`), leaving a self-contained, correctly-wound
 * mesh at the identity transform — the origin-baked shape MD3-style consumers
 * expect. See the Babylon 9 upgrade notes (this was a regression: pre-9 glTF
 * loading baked the flip into vertices, so cloning already worked).
 */

import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export function bakeWorldTransformIntoVertices(mesh: Mesh): void {
  mesh.computeWorldMatrix(true);
  const worldMatrix = mesh.getWorldMatrix().clone();
  mesh.parent = null;
  mesh.bakeTransformIntoVertices(worldMatrix);
  mesh.position.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.rotation.setAll(0);
  mesh.scaling.setAll(1);
  mesh.refreshBoundingInfo();
}
