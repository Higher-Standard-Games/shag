/**
 * Lightmap atlas: a Q3 (IBSP) map's lightmap pages packed into one square
 * texture, and every surface's lightmap UVs moved onto its page's cell.
 *
 * The builder makes one mesh per texture and lightmap page, and the
 * texture-array merge (`mergeBspSurfaceArrays`) only joins surfaces that
 * share a lightmap. On a map with many small pages most surfaces then stay
 * meshes of their own, each a draw. On one atlas they share a lightmap, and
 * the merge can join them. (FBSP maps layer their pages in an array instead;
 * see `BspMeshBuilder.canLayerLightmaps`.)
 *
 * Each page sits in a cell one texel wider on every side, the border a copy
 * of the page's edge texels. Bilinear sampling (lightmaps have no mips) at
 * any UV inside a page then reads exactly what clamped sampling of the page
 * alone would. Pages are written in the encoding `createBspLightmapTexture`
 * uses (`Q3_LIGHTMAP_CURVE`), so the light is byte for byte the same.
 *
 * Off unless called: `MapLoader` does not call it. Leaves FBSP maps, meshes
 * without a page and meshes whose material does not read the page alone.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { BspFile } from "./BspLoader";
import { Q3_LIGHTMAP_CURVE } from "./mesh/lightmaps";
import type { BspMeshBuildResult } from "./mesh/types";

/** Where each page sits in the atlas. */
export interface LightmapAtlasLayout {
  /** A page's side, texels. */
  pageSize: number;
  /** Pages it holds. */
  pages: number;
  /** Cells per row (and rows). */
  columns: number;
  /** A cell's side: the page and a one-texel border round it. */
  cell: number;
  /** The atlas's side, texels. */
  size: number;
}

/** Largest atlas side this will build. */
const MAX_ATLAS_SIZE = 8192;

/** The layout for `pages` pages of `pageSize` texels, or null when they would not fit. */
export function lightmapAtlasLayout(pages: number, pageSize: number): LightmapAtlasLayout | null {
  if (pages < 1 || pageSize < 1) return null;
  const columns = Math.ceil(Math.sqrt(pages));
  const cell = pageSize + 2;
  const size = columns * cell;
  if (size > MAX_ATLAS_SIZE) return null;
  return { pageSize, pages, columns, cell, size };
}

/**
 * Pack RGB pages (`pageSize` squared x 3 bytes each) into the layout's bordered
 * cells as RGBA in the Q3 lightmap encoding, written into `out` from
 * `offset` (a layer of an array). Unused cells stay as `out` had them.
 */
export function packLightmapAtlas(
  pages: readonly Uint8Array[],
  layout: LightmapAtlasLayout,
  out = new Uint8Array(layout.size * layout.size * 4),
  offset = 0,
): Uint8Array {
  const { pageSize, columns, cell, size } = layout;
  const curve = Q3_LIGHTMAP_CURVE;
  const count = Math.min(pages.length, layout.pages);
  for (let p = 0; p < count; p++) {
    const page = pages[p];
    const x0 = (p % columns) * cell;
    const y0 = Math.floor(p / columns) * cell;
    for (let y = -1; y <= pageSize; y++) {
      const sy = Math.min(pageSize - 1, Math.max(0, y));
      const row = (y0 + 1 + y) * size;
      for (let x = -1; x <= pageSize; x++) {
        const sx = Math.min(pageSize - 1, Math.max(0, x));
        const from = (sy * pageSize + sx) * 3;
        const to = offset + (row + x0 + 1 + x) * 4;
        out[to] = curve[page[from]];
        out[to + 1] = curve[page[from + 1]];
        out[to + 2] = curve[page[from + 2]];
        out[to + 3] = 255;
      }
    }
  }
  return out;
}

/** The atlas as a texture, sampled as a lightmap page is (bilinear, no mips), clamped. */
export function createLightmapAtlasTexture(
  pages: readonly Uint8Array[],
  layout: LightmapAtlasLayout,
  scene: Scene,
  name: string,
): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    packLightmapAtlas(pages, layout),
    layout.size,
    layout.size,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.name = name;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** Several sets of pages (one bake each) packed alike, one layer per set. */
export function createLightmapAtlasArray(
  sets: readonly (readonly Uint8Array[])[],
  layout: LightmapAtlasLayout,
  scene: Scene,
  name: string,
): RawTexture2DArray {
  const layer = layout.size * layout.size * 4;
  const rgba = new Uint8Array(layer * sets.length);
  sets.forEach((pages, i) => {
    packLightmapAtlas(pages, layout, rgba, i * layer);
  });
  const texture = new RawTexture2DArray(
    rgba,
    layout.size,
    layout.size,
    sets.length,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.name = name;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** A page-local lightmap UV pair moved to its cell in the atlas, in place. */
export function atlasLightmapUVs(uvs: Float32Array | number[], page: number, layout: LightmapAtlasLayout): void {
  const { pageSize, columns, cell, size } = layout;
  const x0 = (page % columns) * cell + 1;
  const y0 = Math.floor(page / columns) * cell + 1;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    uvs[i] = (x0 + uvs[i] * pageSize) / size;
    uvs[i + 1] = (y0 + uvs[i + 1] * pageSize) / size;
  }
}

export interface LightmapAtlasResult {
  layout: LightmapAtlasLayout;
  texture: Texture;
  /** Meshes now reading the atlas. */
  meshes: number;
}

/** The lightmap a mesh's material reads, if it reads one the way `applyLightmaps` set up. */
function readsPage(mesh: AbstractMesh, material: Material | null): boolean {
  if (material instanceof StandardMaterial || material instanceof PBRMaterial)
    return !!material.lightmapTexture && material.lightmapTexture.coordinatesIndex === 1;
  return material instanceof ShaderMaterial && !!mesh.metadata?.isGlowOverlay;
}

/**
 * Move a built Q3 map's lightmapped surfaces onto one atlas. Run after
 * `BspMeshBuilder.applyLightmaps` and before `mergeBspSurfaceArrays`. Each
 * moved mesh keeps its page as `metadata.lightmapPage`, takes
 * `metadata.lightmapIndex` 0 and `metadata.lightmapAtlas` true. The atlas
 * joins `result.lightmapTextures`, so it is disposed with them. Null (and
 * nothing changed) for FBSP maps, maps without pages, or too many pages.
 */
export function atlasBspLightmaps(result: BspMeshBuildResult, bsp: BspFile, scene: Scene): LightmapAtlasResult | null {
  if (bsp.header.isFBSP || !bsp.lightmaps.length) return null;
  const layout = lightmapAtlasLayout(bsp.lightmaps.length, bsp.lightmapSize);
  if (!layout) return null;
  const pages = result.lightmapTextures;
  const texture = createLightmapAtlasTexture(bsp.lightmaps, layout, scene, "lightmap_atlas");
  let moved = 0;
  const swapped = new Set<Material>();
  for (const mesh of result.worldMesh.getChildMeshes()) {
    const page = mesh.metadata?.lightmapIndex;
    if (!(mesh instanceof Mesh) || typeof page !== "number" || page < 0 || page >= layout.pages) continue;
    if (mesh.metadata?.lightmapLayered) continue;
    const material = mesh.material;
    if (!readsPage(mesh, material)) continue;
    const uvs = mesh.getVerticesData(VertexBuffer.UV2Kind);
    if (!uvs) continue;
    const atlasUVs = Float32Array.from(uvs);
    atlasLightmapUVs(atlasUVs, page, layout);
    mesh.setVerticesData(VertexBuffer.UV2Kind, atlasUVs, false, 2);
    mesh.metadata = { ...mesh.metadata, lightmapPage: page, lightmapIndex: 0, lightmapAtlas: true };
    moved++;
    if (!material || swapped.has(material)) continue;
    swapped.add(material);
    if (material instanceof StandardMaterial || material instanceof PBRMaterial) {
      const old = material.lightmapTexture as BaseTexture;
      texture.level = old.level;
      texture.coordinatesIndex = 1;
      material.lightmapTexture = texture;
    } else if (material instanceof ShaderMaterial) {
      material.setTexture("lightmapSampler", texture);
    }
  }
  if (!moved) {
    texture.dispose();
    return null;
  }
  texture.coordinatesIndex = 1;
  pages.push(texture);
  return { layout, texture, meshes: moved };
}
