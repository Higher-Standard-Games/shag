/**
 * Which object each `map $cubemap` face belongs to.
 *
 * Every object drawn with `$cubemap` reflects its own capture, so its faces
 * must form a mesh apart from other objects sharing the shader. Faces that
 * share a vertex position are one object.
 */

import type { BspFile } from "../BspLoader";

/** Map each face in `[firstFace, firstFace + numFaces)` whose texture is a `$cubemap` shader to its object's id. */
export function cubemapObjectOfFaces(
  bsp: Pick<BspFile, "faces" | "vertices">,
  firstFace: number,
  numFaces: number,
  isCubemapTexture: (textureIndex: number) => boolean,
): Map<number, number> {
  const parent = new Map<number, number>();
  const find = (face: number): number => {
    let root = face;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let node = face;
    while (node !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const faceAt = new Map<string, number>();
  for (let i = firstFace; i < firstFace + numFaces; i++) {
    const face = bsp.faces[i];
    if (!face || !isCubemapTexture(face.textureIndex)) continue;
    parent.set(i, i);
    for (let v = face.firstVertex; v < face.firstVertex + face.numVertices; v++) {
      const position = bsp.vertices[v]?.position;
      if (!position) continue;
      const key = position.map((n) => Math.round(n * 10)).join(",");
      const other = faceAt.get(key);
      if (other === undefined) faceAt.set(key, i);
      else {
        const a = find(i);
        const b = find(other);
        if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
      }
    }
  }
  const objects = new Map<number, number>();
  for (const face of parent.keys()) objects.set(face, find(face));
  return objects;
}
