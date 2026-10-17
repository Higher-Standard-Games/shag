import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { hullWorldVertices } from "./ConvexBrush";
import type { BoxBrush, Vec3q } from "./EditorDocument";
import { shaderBatches } from "./TexturedPreview";

export function hullEdges(brush: BoxBrush): Array<[Vec3q, Vec3q]> {
  if (!brush.hull) return [];
  const vertices = hullWorldVertices(brush);
  const seen = new Set<string>();
  const edges: Array<[Vec3q, Vec3q]> = [];
  for (const side of brush.hull.sides)
    side.vertices.forEach((a, i) => {
      const b = side.vertices[(i + 1) % side.vertices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([vertices[a], vertices[b]]);
      }
    });
  return edges;
}

/** Actual hull mesh for selection, brush mode and gesture previews. */
export function createConvexPreview(brush: BoxBrush, scene: Scene, name = brush.id): Mesh {
  const mesh = new Mesh(name, scene);
  mesh.metadata = { convexPreview: true };
  const data = new VertexData();
  data.positions = [];
  data.normals = [];
  data.indices = [];
  data.uvs = [];
  const faceIndices: number[] = [];
  for (const batch of shaderBatches([brush])) {
    const offset = data.positions.length / 3;
    data.positions.push(...batch.positions);
    data.normals.push(...batch.normals);
    data.uvs.push(...batch.uvs);
    data.indices.push(...batch.indices.map((i) => i + offset));
    brush.hull?.sides.forEach((side, index) => {
      if ((side.material?.shader ?? brush.shader) === batch.shader)
        for (let triangle = 0; triangle < side.vertices.length - 2; triangle++) faceIndices.push(index);
    });
  }
  mesh.metadata.convexFaceIndices = faceIndices;
  data.applyToMesh(mesh);
  return mesh;
}
