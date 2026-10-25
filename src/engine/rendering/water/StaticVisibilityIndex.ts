import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

interface Branch {
  min: Vector3;
  max: Vector3;
  left?: Branch;
  right?: Branch;
  triangles?: number[];
}

/** A short-lived world-space triangle BVH for static water-light visibility baking. */
export class StaticVisibilityIndex {
  private readonly vertices: number[] = [];
  private readonly root: Branch | null;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();

  constructor(meshes: readonly AbstractMesh[]) {
    const point = new Vector3();
    for (const mesh of meshes) {
      const source = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!source) continue;
      const matrix = mesh.computeWorldMatrix(true);
      const world = new Float64Array(source.length);
      for (let i = 0; i < source.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(source[i], source[i + 1], source[i + 2], matrix, point);
        world[i] = point.x;
        world[i + 1] = point.y;
        world[i + 2] = point.z;
      }
      const indices = mesh.getIndices();
      const count = mesh._unIndexed ? source.length / 3 : (indices?.length ?? 0);
      for (let i = 0; i + 2 < count; i += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const offset = (mesh._unIndexed ? i + corner : indices![i + corner]) * 3;
          this.vertices.push(world[offset], world[offset + 1], world[offset + 2]);
        }
      }
    }
    this.root = this.vertices.length ? this.build(Array.from({ length: this.vertices.length / 9 }, (_, i) => i)) : null;
  }

  hits(ray: Ray): boolean {
    return this.root !== null && this.intersects(ray, this.root);
  }

  private build(triangles: number[]): Branch {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const triangle of triangles) {
      for (let corner = 0; corner < 3; corner++) {
        const offset = triangle * 9 + corner * 3;
        min.x = Math.min(min.x, this.vertices[offset]);
        min.y = Math.min(min.y, this.vertices[offset + 1]);
        min.z = Math.min(min.z, this.vertices[offset + 2]);
        max.x = Math.max(max.x, this.vertices[offset]);
        max.y = Math.max(max.y, this.vertices[offset + 1]);
        max.z = Math.max(max.z, this.vertices[offset + 2]);
      }
    }
    if (triangles.length <= 16) return { min, max, triangles };
    const size = max.subtract(min);
    const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
    const centre = (id: number) =>
      this.vertices[id * 9 + axis] + this.vertices[id * 9 + axis + 3] + this.vertices[id * 9 + axis + 6];
    triangles.sort((a, b) => centre(a) - centre(b));
    const middle = Math.floor(triangles.length / 2);
    return { min, max, left: this.build(triangles.slice(0, middle)), right: this.build(triangles.slice(middle)) };
  }

  private intersects(ray: Ray, branch: Branch): boolean {
    if (!ray.intersectsBoxMinMax(branch.min, branch.max)) return false;
    if (!branch.triangles) return this.intersects(ray, branch.left!) || this.intersects(ray, branch.right!);
    for (const triangle of branch.triangles) {
      const offset = triangle * 9;
      Vector3.FromArrayToRef(this.vertices, offset, this.a);
      Vector3.FromArrayToRef(this.vertices, offset + 3, this.b);
      Vector3.FromArrayToRef(this.vertices, offset + 6, this.c);
      if (ray.intersectsTriangle(this.a, this.b, this.c)) return true;
    }
    return false;
  }
}
