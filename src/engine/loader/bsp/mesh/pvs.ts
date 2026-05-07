import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspFile } from "../BspLoader";

export function getVisibleFaces(
  bsp: BspFile,
  cameraPosition: Vector3,
  leafFinder: (pos: [number, number, number]) => number,
): number[] {
  if (!bsp.visData) {
    const allFaces: number[] = [];
    for (let i = 0; i < bsp.faces.length; i++) {
      allFaces.push(i);
    }
    return allFaces;
  }

  const q3Pos: [number, number, number] = [cameraPosition.x, cameraPosition.z, cameraPosition.y];
  const currentCluster = leafFinder(q3Pos);

  if (currentCluster < 0) {
    const allFaces: number[] = [];
    for (let i = 0; i < bsp.faces.length; i++) {
      allFaces.push(i);
    }
    return allFaces;
  }

  const visibleFaces = new Set<number>();

  for (let leafIdx = 0; leafIdx < bsp.leafs.length; leafIdx++) {
    const leaf = bsp.leafs[leafIdx];
    if (leaf.cluster < 0) continue;

    const byteIdx = currentCluster * bsp.visData.bytesPerCluster + Math.floor(leaf.cluster / 8);
    const bitIdx = leaf.cluster % 8;
    const visible = (bsp.visData.bitVectors[byteIdx] & (1 << bitIdx)) !== 0;

    if (visible) {
      for (let i = 0; i < leaf.numLeafFaces; i++) {
        visibleFaces.add(bsp.leafFaces[leaf.firstLeafFace + i]);
      }
    }
  }

  return Array.from(visibleFaces);
}
