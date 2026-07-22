/**
 * MapEmissiveSurfaces — derive area-light candidates from a BSP's emissive
 * ("fullbright") world surfaces: glowing signs, lamps, LED strips. These are
 * the surfaces Q3 shaders mark `isFullbright` (emissive, no lightmap), so a
 * co-located `RectAreaLight` makes them actually illuminate the room instead of
 * just glowing.
 *
 * Pure (no Babylon scene): reads the parsed BSP + an `isFullbright(texture)`
 * probe, returns candidates in Babylon space, ranked by area (biggest first) so
 * a per-map cap keeps the largest hero signs. Placement quality (which surfaces,
 * facing sign, size, intensity) is browser-tuned — this feature is opt-in behind
 * `r_arealights_auto` (default off).
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspFile } from "../loader/bsp/BspLoader";

export interface EmissiveSurface {
  /** Babylon-space centroid of the surface. */
  position: Vector3;
  /** Babylon-space outward normal (the direction the panel emits). */
  normal: Vector3;
  width: number;
  height: number;
  /** Planar area (width×height), used for ranking. */
  area: number;
  textureName: string;
}

/** Ignore fullbright specks (tiny detail faces, highlights) below this area. */
const MIN_SURFACE_AREA = 256;

/**
 * Extract emissive area-light candidates from the BSP world model, ranked by
 * area (largest first). `isFullbright` is probed once per texture index.
 */
export function extractEmissiveSurfaces(
  bsp: BspFile,
  isFullbright: (textureName: string) => boolean,
): EmissiveSurface[] {
  const model = bsp.models?.[0];
  if (!model) return [];

  const fullbrightCache = new Map<number, boolean>();
  const surfaces: EmissiveSurface[] = [];

  for (let i = model.firstFace; i < model.firstFace + model.numFaces; i++) {
    const face = bsp.faces[i];
    if (!face || face.numVertices <= 0) continue;

    let emissive = fullbrightCache.get(face.textureIndex);
    if (emissive === undefined) {
      const texName = bsp.textures[face.textureIndex]?.name ?? "";
      emissive = texName ? isFullbright(texName) : false;
      fullbrightCache.set(face.textureIndex, emissive);
    }
    if (!emissive) continue;

    // Centroid + AABB from the face's vertex range (Quake Z-up → Babylon Y-up).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let count = 0;
    for (let v = face.firstVertex; v < face.firstVertex + face.numVertices; v++) {
      const p = bsp.vertices[v]?.position;
      if (!p) continue;
      const bx = p[0];
      const by = p[2];
      const bz = p[1];
      cx += bx;
      cy += by;
      cz += bz;
      if (bx < minX) minX = bx;
      if (by < minY) minY = by;
      if (bz < minZ) minZ = bz;
      if (bx > maxX) maxX = bx;
      if (by > maxY) maxY = by;
      if (bz > maxZ) maxZ = bz;
      count++;
    }
    if (count === 0) continue;

    // Size = the two largest AABB extents (orientation-agnostic: wall vs ceiling).
    const extents = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => b - a);
    const width = extents[0];
    const height = extents[1];
    const area = width * height;
    if (area < MIN_SURFACE_AREA) continue;

    const normal = new Vector3(face.normal[0], face.normal[2], face.normal[1]);
    if (normal.lengthSquared() < 1e-6) continue;
    normal.normalize();

    surfaces.push({
      position: new Vector3(cx / count, cy / count, cz / count),
      normal,
      width,
      height,
      area,
      textureName: bsp.textures[face.textureIndex]?.name ?? "",
    });
  }

  surfaces.sort((a, b) => b.area - a.area);
  return surfaces;
}
