# Patch & Mesh Collision System Research

## Objective
Implement player collision detection for curved surfaces (patches), bevels, and triangle meshes (misc_model) in the BSP engine. Currently, `BspCollision.ts` only handles convex brushes.

## Current Architecture
- **BspCollision.ts**:
  - Traces Ray or Box through BSP Tree (Nodes -> Leafs -> LeafBrushes).
  - Performs SAT-like check against Brush planes.
  - Ignores `leafFaces` entirely.
- **BspMeshBuilder.ts**:
  - Handles visual generation of patches (Face Type 2).
  - Tessellates Bezier control points into a grid of vertices/triangles.
  - Generates `Mesh` objects for Babylon.

## Challenge
Patches are mathematical surfaces (Quadratic Bezier) defined by control points. They defined "curvature" but physics engines usually require discrete geometry.
Quake 3 handles this by tessellating patches into a "collision mesh" (usually lower LOD than render mesh, but often same) and performing collision against these triangles.

## Proposed Implementation

### 1. Data Structures
We need a lightweight structure to store the collision geometry for faces (specifically Type 2 PATCH and Type 3 MESH).

```typescript
interface CollisionMesh {
  vertices: Vector3[];
  indices: number[]; // Triangle indices
  planes: BspPlane[]; // Triangle planes for quick rejection
  bounds: { min: Vector3; max: Vector3 }; // AABB for broadphase
}
```

### 2. Pre-processing (Load Time)
In `BspCollision.setBsp()` or a new `CollisionGeometryBuilder`:
1. Iterate all `bsp.faces`.
2. Filter for Type 2 (Patch) and Type 3 (Mesh).
3. **For Patches**:
   - Re-use the math from `BspMeshBuilder.buildPatchFace` / `evaluateBezierPatch`.
   - Strip visual data (UVs, Colors, Normals) - keep only Positions.
   - Use a fixed tessellation level (e.g., 4 or 5) to match Q3A physics fidelity.
4. **For Meshes**:
   - Re-use `BspMeshBuilder.buildMeshFace`.
   - Store raw vertices and indices.
5. Store in a lookup array `faceCollisionMeshes: (CollisionMesh | null)[]`.

### 3. Usage (Collision Time)
Modify `BspCollision.traceLeaf` (and `traceLeafBox`):
1. After iterating brushes (`leaf.leafBrushes`), iterate `leaf.leafFaces`.
2. Look up `faceCollisionMeshes[faceIndex]`.
3. Perform AABB check (TraceBox vs Mesh Bounds).
4. If overlapping, iterate Triangles.
5. Perform **Triangle Intersection**:
   - `tracePoint` (Ray): `Ray.intersectsTriangle` (Babylon math).
   - `traceBox` (AABB Check):
     - Check separating axis of Triangle Plane.
     - Check box edges vs triangle edges (Standard AABB-Triangle overlap).

### 4. Triangle-Box Collision Math
For Q3 movement (AABB sliding), we treat the triangle as a "thin brush" or use a specialized test.
An effective approach for `traceBox` against a triangle:
1. **Plane Test**: Check if Box intersects the triangle's infinite plane.
2. **Polygon Test**: Check if the Box (projected onto plane) overlaps the Triangle.
   - Since the box is axis-aligned, this simplification works well.
   - Alternatively, finding the *closest point* on the triangle to the box center and checking radius is simpler (Treat Box as Sphere).
   - **Better for Q3**: Expand the triangle by the box extents (Minkowski sum) and raycast against it?
   - **Simplest Implementation**:
     - Check if box intersects triangle plane (dist < boxProjection).
     - If yes, use SAT for the 3 edges + 3 face normals.

## Execution Plan
1. **Refactor**: Extract `buildPatchFace` logic from `BspMeshBuilder` into a shared `GeometryUtils` or reuse via static helper (simpler to copy-paste core math to avoid dependency hell with `Scene`/`Mesh`).
2. **Implementation**: Add `faces: CollisionMesh[]` to `BspCollision`.
3. **Logic**: Add `traceTriangle` and `traceLeafFaces` methods.
4. **Integration**: Call `traceLeafFaces` inside `traceLeaf`.
