/**
 * BspMeshBuilder - Convert BSP faces to Babylon.js meshes
 *
 * Handles:
 * - Polygon faces (type 1) - pre-triangulated meshes
 * - Patch faces (type 2) - bezier surfaces (tessellation)
 * - Mesh faces (type 3) - triangle soups (misc_model)
 * - Billboard faces (type 4) - flares/sprites
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Engine } from "@babylonjs/core/Engines/engine";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import type { ResolvedMaterialProps } from "../shader/Q3ShaderTypes";
import type {
  BspFace,
  BspFile,
  BspVertex,
  BspVertexIBSP,
  // BspVertexFBSP, // Currently unused
} from "./BspLoader";

// ============================================================================
// Types
// ============================================================================

export interface BspMeshBuildResult {
  /** Main world geometry mesh */
  worldMesh: Mesh;
  /** Individual face meshes (for debugging) */
  faceMeshes?: Mesh[];
  /** Lightmap textures */
  lightmapTextures: Texture[];
  /** Texture groups info for later texture loading */
  textureGroups?: { textureIndex: number; textureName: string }[];
  /** Sky shader names found in the map (for skybox creation) */
  skyShaders: {
    textureName: string;
    skyParms?: { farbox: string; cloudHeight: number; nearbox: string };
    /** Stage textures for sky shaders without skyparms (for textured skybox) */
    stageTextures?: string[];
    /** Editor image (qer_editorimage) — fallback when cubemap and stage textures are missing */
    editorImage?: string;
  }[];
  /** Statistics */
  stats: {
    totalFaces: number;
    polygonFaces: number;
    patchFaces: number;
    meshFaces: number;
    billboardFaces: number;
    skippedSkyFaces: number;
    totalVertices: number;
    totalTriangles: number;
  };
  /** Reference to BSP data for PVS culling */
  bspData: BspFile;
  /** Cluster info for PVS culling (cluster -> mesh indices) */
  clusterInfo?: {
    numClusters: number;
    hasPVS: boolean;
  };
  /** Fog volume meshes */
  fogVolumes?: Mesh[];
  /** Autosprite meshes that need per-frame billboard updates */
  autospriteMeshes?: {
    mesh: Mesh;
    center: [number, number, number];
    halfWidth: number;
    halfHeight: number;
    isAutosprite2: boolean; // true = Y-axis only, false = full billboard
    // Normalized offsets for each vertex: [rightFrac, upFrac] where -1 to 1 maps to -halfWidth/halfHeight to +halfWidth/halfHeight
    vertexOffsets: [number, number][];
  }[];
}

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert Q3 coordinates (Z-up, right-handed) to Babylon (Y-up, left-handed)
 *
 * Q3: X=right, Y=forward, Z=up
 * Babylon: X=right, Y=up, Z=forward
 *
 * Transform: (x, y, z) → (x, z, y)
 *
 * NOTE: This changes handedness! Triangle winding must be reversed.
 */
function q3ToBabylon(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/** Convert Q3 position array to Babylon Vector3 (exported for future use) */
export function q3ToBabylonVec3(pos: [number, number, number]): Vector3 {
  return new Vector3(pos[0], pos[2], pos[1]);
}

/**
 * Reverse triangle winding order to fix handedness change
 * Input: [i0, i1, i2, i3, i4, i5, ...]
 * Output: [i0, i2, i1, i3, i5, i4, ...]
 */
export function reverseTriangleWinding(indices: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    result.push(indices[i], indices[i + 2], indices[i + 1]);
  }
  return result;
}

// ============================================================================
// Fallback Texture Generation
// ============================================================================

/** Cache for generated fallback textures */
const fallbackTextureCache: Map<string, RawTexture> = new Map();

/**
 * Create a radial gradient texture for additive halos/flares
 * White center fading to transparent edges
 */
function createRadialGradientTexture(scene: Scene, size: number = 64): RawTexture {
  const cacheKey = `radial_${size}`;
  if (fallbackTextureCache.has(cacheKey)) {
    return fallbackTextureCache.get(cacheKey)!;
  }

  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const maxDist = center;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, 1 - dist / maxDist);
      // Smooth falloff using squared alpha
      const smoothAlpha = alpha * alpha;

      const idx = (y * size + x) * 4;
      data[idx + 0] = 255; // R
      data[idx + 1] = 255; // G
      data[idx + 2] = 255; // B
      data[idx + 3] = Math.floor(smoothAlpha * 255); // A
    }
  }

  const texture = new RawTexture(
    data,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false, // generateMipMaps
    false, // invertY
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.hasAlpha = true;
  texture.name = "fallback_radial_gradient";

  fallbackTextureCache.set(cacheKey, texture);
  console.log(`[BspMeshBuilder] Created fallback radial gradient texture`);
  return texture;
}

/**
 * Create a solid color texture ($whiteimage, $blackimage)
 */
function createSolidColorTexture(scene: Scene, r: number, g: number, b: number, a: number = 255): RawTexture {
  const cacheKey = `solid_${r}_${g}_${b}_${a}`;
  if (fallbackTextureCache.has(cacheKey)) {
    return fallbackTextureCache.get(cacheKey)!;
  }

  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }

  const texture = new RawTexture(
    data,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
  );
  texture.hasAlpha = a < 255;
  texture.name = `fallback_solid_${r}_${g}_${b}`;

  fallbackTextureCache.set(cacheKey, texture);
  return texture;
}

// ============================================================================
// Vertex Helpers
// ============================================================================

function isIBSPVertex(v: BspVertex): v is BspVertexIBSP {
  return "lightmapCoord" in v;
}

function getVertexPosition(v: BspVertex): [number, number, number] {
  return q3ToBabylon(v.position[0], v.position[1], v.position[2]);
}

function getVertexNormal(v: BspVertex): [number, number, number] {
  return q3ToBabylon(v.normal[0], v.normal[1], v.normal[2]);
}

function getVertexTexCoord(v: BspVertex): [number, number] {
  return [v.texCoord[0], v.texCoord[1]];
}

function getVertexLightmapCoord(v: BspVertex): [number, number] {
  if (isIBSPVertex(v)) {
    return [v.lightmapCoord[0], v.lightmapCoord[1]];
  }
  // FBSP: use first lightmap coord
  return [v.lightmapCoords[0][0], v.lightmapCoords[0][1]];
}

function getVertexColor(v: BspVertex): [number, number, number, number] {
  if (isIBSPVertex(v)) {
    return [v.color[0] / 255, v.color[1] / 255, v.color[2] / 255, v.color[3] / 255];
  }
  // FBSP: use first color
  return [v.colors[0][0] / 255, v.colors[0][1] / 255, v.colors[0][2] / 255, v.colors[0][3] / 255];
}

// ============================================================================
// BspMeshBuilder Class
// ============================================================================

// Textures that should not be rendered (tool textures)
const NON_DRAWABLE_TEXTURES = [
  "common/nodraw",
  "common/clip",
  "common/caulk",
  "common/trigger",
  "common/hint",
  "common/skip",
  "common/areaportal",
  "common/clusterportal",
  "common/donotenter",
  "common/origin",
  "common/noimpact",
  "common/invisible",
  "textures/common/",
  "noshader",
];

export interface BuildOptions {
  /** Only render specific face types (1=polygon, 2=patch, 3=mesh) */
  faceTypes?: number[];
  /** Skip non-drawable textures */
  filterTextures?: boolean;
}

export class BspMeshBuilder {
  private bsp: BspFile;
  private scene: Scene;
  private options: BuildOptions;

  private constructor(bsp: BspFile, scene: Scene, options: BuildOptions = {}) {
    this.bsp = bsp;
    this.scene = scene;
    this.options = {
      filterTextures: true,
      ...options,
    };
  }

  /**
   * Build meshes from BSP file
   */
  public static build(bsp: BspFile, scene: Scene, options?: BuildOptions): BspMeshBuildResult {
    const builder = new BspMeshBuilder(bsp, scene, options);
    return builder.buildAll();
  }

  /**
   * Check if a texture should be rendered
   */
  private shouldRenderTexture(textureIndex: number): boolean {
    if (!this.options.filterTextures) return true;
    if (textureIndex < 0 || textureIndex >= this.bsp.textures.length) return false;

    const texName = this.bsp.textures[textureIndex].name.toLowerCase();

    for (const skip of NON_DRAWABLE_TEXTURES) {
      if (texName.includes(skip)) {
        return false;
      }
    }

    return true;
  }

  private buildAll(): BspMeshBuildResult {
    console.log(`[BspMeshBuilder] Building meshes from ${this.bsp.faces.length} faces`);

    const stats = {
      totalFaces: this.bsp.faces.length,
      polygonFaces: 0,
      patchFaces: 0,
      meshFaces: 0,
      billboardFaces: 0,
      skippedSkyFaces: 0,
      totalVertices: 0,
      totalTriangles: 0,
    };

    // Group faces by (texture + lightmap) for correct lightmap UV alignment
    // Each face's UV2 coords reference a specific lightmap, so we must not mix them
    interface TextureGroup {
      textureIndex: number;
      textureName: string;
      lightmapIndex: number;
      shaderProps: ResolvedMaterialProps;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      colors: number[];
      indices: number[];
      indexOffset: number;
      // Fog params if any face in this group has a fog effect
      fogParams?: { color: [number, number, number]; depthForOpaque: number };
    }

    // Key: "textureIndex_lightmapIndex" for unique (texture, lightmap) pairs
    const textureGroups = new Map<string, TextureGroup>();
    const shaderRegistry = Q3ShaderRegistry.getInstance();

    // Track individual autosprite faces (not merged, each becomes its own mesh)
    interface AutospriteFace {
      faceIndex: number;
      textureIndex: number;
      textureName: string;
      shaderProps: ResolvedMaterialProps;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      colors: number[];
      indices: number[];
      center: [number, number, number];
    }
    const autospriteFaces: AutospriteFace[] = [];

    // Track fog effects found
    let fogFacesCount = 0;

    // Track sky shaders found
    const skyShaders: BspMeshBuildResult["skyShaders"] = [];
    const foundSkyTextures = new Set<number>();

    // Build first model only (model 0 = world geometry)
    const worldModel = this.bsp.models[0];
    if (!worldModel) {
      throw new Error("[BspMeshBuilder] No world model found");
    }

    let skippedTextures = 0;
    let skippedFaceTypes = 0;

    let detailFaceCount = 0;
    let detailFaceSkipped = 0;
    for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
      const face = this.bsp.faces[i];
      if (!face) continue;

      // Check if this face belongs to a detail brush (for debugging)
      const faceTexture = this.bsp.textures[face.textureIndex];
      const isDetail = faceTexture && (faceTexture.contentFlags & 0x8000000) !== 0;
      if (isDetail) {
        detailFaceCount++;
        if (detailFaceCount <= 3) {
          console.log(
            `[BspMeshBuilder] Detail face ${i}: tex="${faceTexture.name}" texIdx=${face.textureIndex} contentFlags=0x${faceTexture.contentFlags.toString(16)} surfaceFlags=0x${faceTexture.surfaceFlags.toString(16)}`,
          );
        }
      }

      // Skip non-drawable textures
      if (!this.shouldRenderTexture(face.textureIndex)) {
        skippedTextures++;
        if (isDetail) detailFaceSkipped++;
        continue;
      }

      // Skip face types if filtering is enabled
      if (this.options.faceTypes && !this.options.faceTypes.includes(face.faceType)) {
        skippedFaceTypes++;
        continue;
      }

      // Sky shader detection - track for skybox creation
      // Check both Q3 shader registry (surfaceparm sky / skyparms) and BSP surface flags (SURF_SKY = 0x4)
      const textureName = this.bsp.textures[face.textureIndex]?.name || "";
      const shaderProps = shaderRegistry.resolveMaterialProps(textureName);
      const bspSurfaceFlags = this.bsp.textures[face.textureIndex]?.surfaceFlags ?? 0;
      const isSkyFace = shaderProps.isSky || (bspSurfaceFlags & 0x4) !== 0;
      if (isSkyFace) {
        if (!foundSkyTextures.has(face.textureIndex)) {
          foundSkyTextures.add(face.textureIndex);
          // Get full shader to extract stage textures for fallback skybox
          const shader = shaderRegistry.getShader(textureName);
          const stageTextures = shader?.stages
            ?.map((s: { map?: string }) => s.map)
            .filter((m: string | undefined): m is string => !!m && m !== "$lightmap");
          skyShaders.push({
            textureName,
            skyParms: shaderProps.skyParms,
            stageTextures,
            editorImage: shader?.editorImage,
          });
          if (shaderProps.skyParms?.farbox) {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} -> farbox: ${shaderProps.skyParms.farbox}`);
          } else if (stageTextures?.length) {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} -> textured sky: ${stageTextures[0]}`);
          } else {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} (no skybox textures)`);
          }
        }
        stats.skippedSkyFaces++;
        continue; // Skip sky faces - will be rendered as skybox
      }

      // Autosprite faces need to be individual meshes (not merged)
      // Each sprite must rotate around its own center
      if (shaderProps.autosprite || shaderProps.autosprite2) {
        let faceData: {
          positions: number[];
          normals: number[];
          uvs: number[];
          uv2s: number[];
          colors: number[];
          indices: number[];
        } | null = null;

        switch (face.faceType) {
          case 1:
            faceData = this.buildPolygonFace(face);
            break;
          case 2:
            faceData = this.buildPatchFace(face);
            break;
          case 3:
            faceData = this.buildMeshFace(face);
            break;
        }

        if (faceData && faceData.positions.length > 0) {
          // Calculate center of this sprite face
          let cx = 0,
            cy = 0,
            cz = 0;
          const numVerts = faceData.positions.length / 3;
          for (let v = 0; v < numVerts; v++) {
            cx += faceData.positions[v * 3];
            cy += faceData.positions[v * 3 + 1];
            cz += faceData.positions[v * 3 + 2];
          }
          cx /= numVerts;
          cy /= numVerts;
          cz /= numVerts;

          autospriteFaces.push({
            faceIndex: i,
            textureIndex: face.textureIndex,
            textureName,
            shaderProps,
            positions: faceData.positions,
            normals: faceData.normals,
            uvs: faceData.uvs,
            uv2s: faceData.uv2s,
            colors: faceData.colors,
            indices: faceData.indices,
            center: [cx, cy, cz],
          });

          stats.totalVertices += numVerts;
          stats.totalTriangles += faceData.indices.length / 3;
        }
        continue; // Don't add to regular texture groups
      }

      // Get or create texture+lightmap group (key by both to preserve UV2 alignment)
      // Patch faces get their own group with two-sided rendering (Q3 patches are always two-sided)
      const lmIdx = face.lightmapIndex >= 0 ? face.lightmapIndex : -1;
      const isPatch = face.faceType === 2;
      const groupKey = `${face.textureIndex}_${lmIdx}${isPatch ? "_patch" : ""}`;
      let group = textureGroups.get(groupKey);
      if (!group) {
        // For patches, force two-sided rendering: bezier normals can face inward at edges
        const patchShaderProps = isPatch
          ? { ...shaderProps, backFaceCulling: false, twoSidedLighting: true }
          : shaderProps;

        // Debug: log transparent/special shaders (only once per texture)
        if ((shaderProps.isTransparent || shaderProps.alphaMode !== "opaque") && lmIdx === -1) {
          console.log(
            `[BspMeshBuilder] Transparent texture: ${textureName} -> alphaMode=${shaderProps.alphaMode}, backFaceCulling=${shaderProps.backFaceCulling}`,
          );
        }

        group = {
          textureIndex: face.textureIndex,
          textureName,
          lightmapIndex: lmIdx,
          shaderProps: patchShaderProps,
          positions: [],
          normals: [],
          uvs: [],
          uv2s: [],
          colors: [],
          indices: [],
          indexOffset: 0,
        };
        textureGroups.set(groupKey, group);
      }

      // Check for fog effect on this face
      if (face.effectIndex >= 0 && face.effectIndex < this.bsp.effects.length && !group.fogParams) {
        const effect = this.bsp.effects[face.effectIndex];
        const fogShader = shaderRegistry.getShader(effect.name);
        if (fogShader?.fogParms) {
          group.fogParams = {
            color: fogShader.fogParms.color,
            depthForOpaque: fogShader.fogParms.depthForOpaque,
          };
          fogFacesCount++;
          console.log(
            `[BspMeshBuilder] Face ${i} has fog effect: ${effect.name} -> color=(${fogShader.fogParms.color.join(",")}), depth=${fogShader.fogParms.depthForOpaque}`,
          );
        }
      }

      let faceData: {
        positions: number[];
        normals: number[];
        uvs: number[];
        uv2s: number[];
        colors: number[];
        indices: number[];
      } | null = null;

      switch (face.faceType) {
        case 1: // Polygon
          stats.polygonFaces++;
          faceData = this.buildPolygonFace(face);
          break;
        case 2: // Patch
          stats.patchFaces++;
          faceData = this.buildPatchFace(face);
          break;
        case 3: // Mesh
          stats.meshFaces++;
          faceData = this.buildMeshFace(face);
          break;
        case 4: // Billboard
          stats.billboardFaces++;
          // Skip billboards for now
          break;
      }

      if (faceData) {
        // Add to texture group
        const numVerts = faceData.positions.length / 3;

        for (const p of faceData.positions) group.positions.push(p);
        for (const n of faceData.normals) group.normals.push(n);
        for (const uv of faceData.uvs) group.uvs.push(uv);
        for (const uv2 of faceData.uv2s) group.uv2s.push(uv2);
        for (const c of faceData.colors) group.colors.push(c);

        // Add indices with offset
        for (const idx of faceData.indices) {
          group.indices.push(idx + group.indexOffset);
        }
        group.indexOffset += numVerts;

        stats.totalVertices += numVerts;
        stats.totalTriangles += faceData.indices.length / 3;
      }
    }

    // Log detail face statistics
    if (detailFaceCount > 0) {
      console.log(
        `[BspMeshBuilder] Detail faces: ${detailFaceCount} total, ${detailFaceSkipped} skipped (non-drawable), ${detailFaceCount - detailFaceSkipped} rendered`,
      );
    }

    // Separate opaque and transparent groups
    const opaqueGroups: TextureGroup[] = [];
    const transparentGroups: TextureGroup[] = [];

    for (const group of textureGroups.values()) {
      if (group.indices.length === 0) continue;

      if (group.shaderProps.isTransparent) {
        transparentGroups.push(group);
      } else {
        opaqueGroups.push(group);
      }
    }

    console.log(
      `[BspMeshBuilder] Texture groups: ${opaqueGroups.length} opaque, ${transparentGroups.length} transparent`,
    );

    // Create a parent mesh to hold all texture group meshes
    const worldMesh = new Mesh("bsp_world", this.scene);
    worldMesh.checkCollisions = true;
    worldMesh.isPickable = true; // Enable raycasting for gravity/picking

    // Combine all groups (opaque first, then transparent for proper sorting)
    const allGroups = [...opaqueGroups, ...transparentGroups];
    const childMeshes: Mesh[] = [];

    // Track alpha index for transparent meshes (higher = render later)
    let alphaIndex = 0;

    // Create a separate mesh for each texture group
    for (const group of allGroups) {
      if (group.indices.length === 0) continue;

      const meshName = `bsp_tex_${group.textureIndex}`;
      const mesh = new Mesh(meshName, this.scene);
      mesh.isPickable = true; // Ensure pickable

      const meshVertexData = new VertexData();
      meshVertexData.positions = group.positions;
      meshVertexData.normals = group.normals;
      meshVertexData.uvs = group.uvs;
      if (group.uv2s.length > 0) {
        meshVertexData.uvs2 = group.uv2s;
      }
      if (group.colors.length > 0) {
        meshVertexData.colors = group.colors;
      }
      meshVertexData.indices = group.indices;
      meshVertexData.applyToMesh(mesh);

      // Create material with shader properties
      const meshMaterial = this.createMaterialFromShaderProps(
        `bsp_mat_${group.textureIndex}`,
        group.shaderProps,
        group.textureName,
      );
      mesh.material = meshMaterial;

      // Store texture name, lightmap info, and fog params in metadata
      // Each group now has exactly one lightmap (grouped by texture+lightmap)
      const texFlags = this.bsp.textures[group.textureIndex];
      mesh.metadata = {
        textureName: group.textureName,
        textureIndex: group.textureIndex,
        lightmapIndex: group.lightmapIndex,
        contentFlags: texFlags?.contentFlags ?? 0,
        surfaceFlags: texFlags?.surfaceFlags ?? 0,
        fogParams: group.fogParams,
        autosprite: group.shaderProps.autosprite,
        autosprite2: group.shaderProps.autosprite2,
      };

      // Note: Per-face fog detection works, but applying global scene fog here is wrong
      // for Warsow maps with localized fog volumes (hallways, pits, etc.)
      // True per-volume fog would require custom shaders with volume bounds checking.
      // For now, just log that fog was detected - use 'fog on' command for global testing.
      if (group.fogParams) {
        console.log(`[BspMeshBuilder] Mesh ${meshName} has fog effect (use 'fog on' for global fog testing)`);
      }

      // Handle transparency sorting
      if (group.shaderProps.isTransparent) {
        // Additive blending (halos, lights) should render last
        if (group.shaderProps.alphaMode === "add") {
          mesh.alphaIndex = 1000 + alphaIndex;
        } else {
          mesh.alphaIndex = alphaIndex;
        }
        alphaIndex++;

        // Use back-to-front sorting for transparent meshes
        mesh.mustDepthSortFacets = true;
      }

      // Parent to world mesh for easy disposal
      mesh.parent = worldMesh;
      childMeshes.push(mesh);

      // Add Physics Body (Havok)
      // Only for opaque meshes that aren't specifically non-solid (we assume visible = solid for now)
      // TODO: Check surface flags for non-solid surfaces (noimpact, nomarks etc might still be solid)
      if (!group.shaderProps.isTransparent) {
        import("../../physics/PhysicsSystem").then(({ PhysicsSystem }) => {
          import("@babylonjs/core/Physics/v2/IPhysicsEnginePlugin").then(({ PhysicsShapeType }) => {
            PhysicsSystem.getInstance().createStaticBody(mesh, PhysicsShapeType.MESH);
          });
        });
      }
    }

    console.log(`[BspMeshBuilder] Created ${childMeshes.length} texture group meshes`);

    // Create individual meshes for autosprite faces with per-frame billboard updates
    const autospriteMeshData: BspMeshBuildResult["autospriteMeshes"] = [];

    for (let si = 0; si < autospriteFaces.length; si++) {
      const sprite = autospriteFaces[si];
      const spriteMeshName = `bsp_sprite_${sprite.textureIndex}_${si}`;
      const spriteMesh = new Mesh(spriteMeshName, this.scene);

      // Calculate sprite dimensions from original geometry
      // Find bounding box to get width/height
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;
      const numVerts = sprite.positions.length / 3;
      for (let v = 0; v < numVerts; v++) {
        const x = sprite.positions[v * 3];
        const y = sprite.positions[v * 3 + 1];
        const z = sprite.positions[v * 3 + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }

      // Calculate half-dimensions (sprite is a quad, find largest extent)
      const extentX = (maxX - minX) / 2;
      const extentY = (maxY - minY) / 2;
      const extentZ = (maxZ - minZ) / 2;
      // For a quad, two dimensions will be large, one will be ~0
      // halfWidth = horizontal extent, halfHeight = vertical extent
      const halfWidth = Math.max(extentX, extentZ);
      const halfHeight = extentY > 0.01 ? extentY : Math.max(extentX, extentZ);

      // Apply original geometry initially
      const spriteVertexData = new VertexData();
      spriteVertexData.positions = [...sprite.positions]; // Copy for modification
      spriteVertexData.normals = sprite.normals;
      spriteVertexData.uvs = sprite.uvs;
      if (sprite.uv2s.length > 0) {
        spriteVertexData.uvs2 = sprite.uv2s;
      }
      if (sprite.colors.length > 0) {
        spriteVertexData.colors = sprite.colors;
      }
      spriteVertexData.indices = sprite.indices;
      spriteVertexData.applyToMesh(spriteMesh, true); // updatable = true

      // Create material
      const spriteMaterial = this.createMaterialFromShaderProps(
        `bsp_sprite_mat_${sprite.textureIndex}_${si}`,
        sprite.shaderProps,
        sprite.textureName,
      );
      spriteMesh.material = spriteMaterial;

      // Store metadata for texture loading
      spriteMesh.metadata = {
        textureName: sprite.textureName,
        textureIndex: sprite.textureIndex,
        lightmapIndex: -1, // Sprites typically don't use lightmaps
        autosprite: sprite.shaderProps.autosprite,
        autosprite2: sprite.shaderProps.autosprite2,
      };

      // Transparency handling
      if (sprite.shaderProps.isTransparent) {
        if (sprite.shaderProps.alphaMode === "add") {
          spriteMesh.alphaIndex = 2000 + si; // After regular transparent meshes
        } else {
          spriteMesh.alphaIndex = 1500 + si;
        }
      }

      spriteMesh.parent = worldMesh;
      childMeshes.push(spriteMesh);

      // Calculate normalized vertex offsets from original positions relative to center
      // This allows proper interpolation for triangulated sprites (not just 4 corners)
      const [cx, cy, cz] = sprite.center;

      // Collect all vertex offsets from center
      const offsets: [number, number, number][] = [];
      for (let v = 0; v < numVerts; v++) {
        offsets.push([
          sprite.positions[v * 3] - cx,
          sprite.positions[v * 3 + 1] - cy,
          sprite.positions[v * 3 + 2] - cz,
        ]);
      }

      // Find max extent on each axis to determine sprite orientation
      let maxExtentX = 0,
        maxExtentY = 0,
        maxExtentZ = 0;
      for (const [ox, oy, oz] of offsets) {
        maxExtentX = Math.max(maxExtentX, Math.abs(ox));
        maxExtentY = Math.max(maxExtentY, Math.abs(oy));
        maxExtentZ = Math.max(maxExtentZ, Math.abs(oz));
      }

      // Calculate normalized offsets for each vertex
      // Maps each vertex position to a fraction of the quad (-1 to 1 range)
      const vertexOffsets: [number, number][] = [];
      for (const [ox, oy, oz] of offsets) {
        let rightFrac: number, upFrac: number;

        if (maxExtentY < maxExtentX && maxExtentY < maxExtentZ) {
          // Horizontal sprite (XZ plane) - Y is normal
          rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
          upFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
        } else if (maxExtentX < maxExtentY && maxExtentX < maxExtentZ) {
          // YZ plane - X is normal
          rightFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
          upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
        } else {
          // XY plane or default - Z is normal (most common for vertical sprites)
          rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
          upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
        }

        vertexOffsets.push([rightFrac, upFrac]);
      }

      // Track for per-frame billboard updates
      autospriteMeshData.push({
        mesh: spriteMesh,
        center: sprite.center,
        halfWidth,
        halfHeight,
        isAutosprite2: sprite.shaderProps.autosprite2,
        vertexOffsets,
      });
    }

    if (autospriteFaces.length > 0) {
      console.log(`[BspMeshBuilder] Created ${autospriteFaces.length} autosprite meshes (billboarded)`);
      // Debug: log sprite info with orientation details
      for (let sdi = 0; sdi < autospriteMeshData.length; sdi++) {
        const spriteData = autospriteMeshData[sdi];
        const sprite = autospriteFaces[sdi];
        const numVerts = spriteData.vertexOffsets.length;

        // Recalculate extents for logging
        const [cx, cy, cz] = spriteData.center;
        let maxX = 0,
          maxY = 0,
          maxZ = 0;
        for (let v = 0; v < numVerts; v++) {
          maxX = Math.max(maxX, Math.abs(sprite.positions[v * 3] - cx));
          maxY = Math.max(maxY, Math.abs(sprite.positions[v * 3 + 1] - cy));
          maxZ = Math.max(maxZ, Math.abs(sprite.positions[v * 3 + 2] - cz));
        }
        const orient = maxY < maxX && maxY < maxZ ? "XZ(horiz)" : maxX < maxY && maxX < maxZ ? "YZ" : "XY(vert)";

        console.log(
          `[BspMeshBuilder] Sprite "${spriteData.mesh.name}": ${numVerts}v, extents=[${maxX.toFixed(1)},${maxY.toFixed(1)},${maxZ.toFixed(1)}], orient=${orient}, hw=${spriteData.halfWidth.toFixed(1)}, hh=${spriteData.halfHeight.toFixed(1)}, as2=${spriteData.isAutosprite2}`,
        );
      }
    }

    // Create lightmap textures
    const lightmapTextures = this.buildLightmapTextures();

    console.log(
      `[BspMeshBuilder] Built world mesh: ${stats.totalVertices} vertices, ${stats.totalTriangles} triangles`,
    );
    console.log(
      `[BspMeshBuilder] Face breakdown: ${stats.polygonFaces} polygons, ${stats.patchFaces} patches, ${stats.meshFaces} meshes, ${stats.billboardFaces} billboards`,
    );
    if (skippedTextures > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedTextures} faces with non-drawable textures`);
    }
    if (skippedFaceTypes > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedFaceTypes} faces due to face type filter`);
    }

    // Collect texture group info for later loading (including autosprite textures)
    const allTextureGroups = [...opaqueGroups, ...transparentGroups]
      .filter((g) => g.indices.length > 0)
      .map((g) => ({ textureIndex: g.textureIndex, textureName: g.textureName }));

    // Add autosprite textures (deduplicated)
    const seenTextureIndices = new Set(allTextureGroups.map((g) => g.textureIndex));
    for (const sprite of autospriteFaces) {
      if (!seenTextureIndices.has(sprite.textureIndex)) {
        seenTextureIndices.add(sprite.textureIndex);
        allTextureGroups.push({ textureIndex: sprite.textureIndex, textureName: sprite.textureName });
      }
    }

    if (skyShaders.length > 0) {
      const hasCubemap = skyShaders.some((s) => s.skyParms?.farbox);
      const hasTextured = skyShaders.some((s) => !s.skyParms?.farbox && s.stageTextures?.length);
      if (hasCubemap) {
        console.log(
          `[BspMeshBuilder] Found ${skyShaders.length} sky shader(s), skipped ${stats.skippedSkyFaces} sky faces for cubemap skybox`,
        );
      } else if (hasTextured) {
        console.log(
          `[BspMeshBuilder] Found ${skyShaders.length} sky shader(s), skipped ${stats.skippedSkyFaces} sky faces for textured skybox`,
        );
      } else {
        console.log(`[BspMeshBuilder] Found ${skyShaders.length} sky shader(s) with no skybox textures`);
      }
    }

    return {
      worldMesh,
      lightmapTextures,
      textureGroups: allTextureGroups,
      skyShaders,
      stats,
      bspData: this.bsp,
      clusterInfo: {
        numClusters: this.bsp.visData?.numClusters ?? 0,
        hasPVS: this.bsp.visData !== null,
      },
      autospriteMeshes: autospriteMeshData.length > 0 ? autospriteMeshData : undefined,
    };
  }

  /**
   * Update autosprite meshes to face the camera (call each frame)
   * Q3 autosprite: full billboard, always faces camera
   * Q3 autosprite2: cylindrical billboard, rotates around Y axis only
   */
  public static updateAutosprites(result: BspMeshBuildResult, cameraPosition: Vector3): void {
    if (!result.autospriteMeshes || result.autospriteMeshes.length === 0) return;

    for (const sprite of result.autospriteMeshes) {
      const { mesh, center, halfWidth, halfHeight, isAutosprite2 } = sprite;

      // Calculate direction from sprite center to camera
      const cx = center[0],
        cy = center[1],
        cz = center[2];
      let dx = cameraPosition.x - cx;
      let dy = cameraPosition.y - cy;
      let dz = cameraPosition.z - cz;

      // Normalize direction
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.001) continue; // Camera at sprite center, skip
      dx /= dist;
      dy /= dist;
      dz /= dist;

      // Calculate right and up vectors for the sprite quad
      let rightX: number, rightY: number, rightZ: number;
      let upX: number, upY: number, upZ: number;

      if (isAutosprite2) {
        // Autosprite2: cylindrical billboard (rotate around Y axis only)
        // Right vector is perpendicular to camera direction in XZ plane
        const horizDist = Math.sqrt(dx * dx + dz * dz);
        if (horizDist < 0.001) {
          // Looking straight up/down, use default right
          rightX = 1;
          rightY = 0;
          rightZ = 0;
        } else {
          // Right = cross(up, forward) where up = (0,1,0)
          rightX = -dz / horizDist;
          rightY = 0;
          rightZ = dx / horizDist;
        }
        // Up is always world up for autosprite2
        upX = 0;
        upY = 1;
        upZ = 0;
      } else {
        // Autosprite: full billboard (face camera on all axes)
        // Up vector: world up projected onto plane perpendicular to view direction
        // Right = cross(worldUp, viewDir), then Up = cross(viewDir, right)
        const worldUpX = 0,
          worldUpY = 1,
          worldUpZ = 0;

        // Right = cross(worldUp, forward)
        rightX = worldUpY * dz - worldUpZ * dy;
        rightY = worldUpZ * dx - worldUpX * dz;
        rightZ = worldUpX * dy - worldUpY * dx;

        // Normalize right
        const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
        if (rightLen < 0.001) {
          // Looking straight up/down, use default
          rightX = 1;
          rightY = 0;
          rightZ = 0;
          upX = 0;
          upY = 0;
          upZ = -1;
        } else {
          rightX /= rightLen;
          rightY /= rightLen;
          rightZ /= rightLen;

          // Up = cross(forward, right)
          upX = dy * rightZ - dz * rightY;
          upY = dz * rightX - dx * rightZ;
          upZ = dx * rightY - dy * rightX;
        }
      }

      // Reconstruct all vertices using pre-calculated normalized offsets
      // This handles both simple quads and triangulated sprites correctly
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 12) continue;

      const numVerts = positions.length / 3;
      const hw = halfWidth,
        hh = halfHeight;

      // Use normalized offsets to position each vertex on the billboard
      for (let v = 0; v < numVerts; v++) {
        const [rightFrac, upFrac] = sprite.vertexOffsets[v] ?? [0, 0];
        // Position = center + right * (rightFrac * halfWidth) + up * (upFrac * halfHeight)
        positions[v * 3] = cx + rightX * (rightFrac * hw) + upX * (upFrac * hh);
        positions[v * 3 + 1] = cy + rightY * (rightFrac * hw) + upY * (upFrac * hh);
        positions[v * 3 + 2] = cz + rightZ * (rightFrac * hw) + upZ * (upFrac * hh);
      }

      // Update mesh vertices
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    }
  }

  /**
   * Apply textures to a rendered BSP from PK3
   * Call this after bsp render to load actual textures
   */
  public static async applyTextures(
    result: BspMeshBuildResult,
    _bsp: BspFile, // Reserved for future use
    scene: Scene,
    progressCallback?: (loaded: number, total: number, name: string) => void,
  ): Promise<number> {
    const { PK3TextureLoader } = await import("../pk3/PK3TextureLoader");
    const texLoader = PK3TextureLoader.getInstance();
    const engine = scene.getEngine();

    // Initialize texture loader if needed
    texLoader.init(engine as any, scene);

    if (!result.textureGroups || result.textureGroups.length === 0) {
      console.log("[BspMeshBuilder] No texture groups to load");
      return 0;
    }

    let loadedCount = 0;
    const total = result.textureGroups.length;

    // Get all materials from world mesh and children
    const meshes = [result.worldMesh, ...result.worldMesh.getChildMeshes()];

    // Get shader registry for looking up actual texture paths
    const { Q3ShaderRegistry } = await import("../shader/Q3ShaderRegistry");
    const shaderRegistry = Q3ShaderRegistry.getInstance();

    for (const group of result.textureGroups) {
      const texName = group.textureName;
      if (!texName || texName.toLowerCase().includes("common/")) continue;

      progressCallback?.(loadedCount, total, texName);

      // Build list of paths to try
      const pathsToTry: string[] = [];

      // 1. Check shader for actual texture path (override)
      const shader = shaderRegistry.getShader(texName);
      if (shader && shader.stages.length > 0) {
        const firstStage = shader.stages[0];
        if (firstStage.map && firstStage.map !== "$lightmap" && firstStage.map !== "$whiteimage") {
          pathsToTry.push(firstStage.map);
          console.log(`[BspMeshBuilder] Shader override: ${texName} -> ${firstStage.map}`);
        }
      }

      // 2. Try texture name as-is (for paths with slashes)
      pathsToTry.push(texName);

      // 3. If name has underscores but no slashes, try converting underscores to slashes
      if (texName.includes("_") && !texName.includes("/")) {
        // models_mapobjects_lamp_lamp_halo -> models/mapobjects/lamp/lamp_halo
        // But we need to be smart - not all underscores are path separators
        // Try progressively: first underscore, then second, etc.
        const parts = texName.split("_");
        if (parts.length >= 2) {
          // Try common patterns
          pathsToTry.push(parts.join("/")); // all underscores to slashes
          if (parts.length >= 3) {
            // First two segments as path: models/mapobjects/rest
            pathsToTry.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join("_")}`);
          }
          if (parts.length >= 4) {
            // First three segments as path
            pathsToTry.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("_")}`);
          }
        }
      }

      // 4. If doesn't start with textures/, add that prefix to each path
      const allPaths: string[] = [];
      for (const p of pathsToTry) {
        allPaths.push(p);
        if (!p.toLowerCase().startsWith("textures/") && !p.toLowerCase().startsWith("models/")) {
          allPaths.push(`textures/${p}`);
        }
      }

      // Try to load texture with various extensions
      const extensions = [".jpg", ".png", ".tga", ".ktx"];
      let texture: any = null;
      let foundCleanPath: string = ""; // Track which path succeeded for normal map loading

      for (const basePath of allPaths) {
        if (texture) break;

        // Strip any existing extension to avoid .tga.tga bug
        const cleanPath = basePath.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");

        for (const ext of extensions) {
          texture = await texLoader.loadTexture(`${cleanPath}${ext}`);
          if (texture) {
            foundCleanPath = cleanPath;
            break;
          }
        }
      }

      // Get shader props to check if we need fallback texture
      const shaderProps = shaderRegistry.resolveMaterialProps(texName);

      // If no texture found, check if we should generate a fallback
      if (!texture && shaderProps.alphaMode === "add") {
        // Additive shader with missing texture = generate radial gradient for halo effect
        texture = createRadialGradientTexture(scene);
        console.log(`[BspMeshBuilder] Using fallback radial gradient for: ${texName}`);
      } else if (!texture && shaderProps.diffuseTexture?.includes("$whiteimage")) {
        texture = createSolidColorTexture(scene, 255, 255, 255);
        console.log(`[BspMeshBuilder] Using fallback $whiteimage for: ${texName}`);
      } else if (!texture && shaderProps.diffuseTexture?.includes("$blackimage")) {
        texture = createSolidColorTexture(scene, 0, 0, 0);
        console.log(`[BspMeshBuilder] Using fallback $blackimage for: ${texName}`);
      }

      if (texture) {
        // Find ALL meshes for this texture index (there may be multiple with different lightmaps)
        // Also include sprite meshes which have names like bsp_sprite_${textureIndex}_*
        const meshName = `bsp_tex_${group.textureIndex}`;
        const spritePrefix = `bsp_sprite_${group.textureIndex}_`;
        const matchingMeshes = meshes.filter((m) => m.name === meshName || m.name.startsWith(spritePrefix));

        if (matchingMeshes.length === 0) continue;

        // Apply texture to all matching meshes
        for (const mesh of matchingMeshes) {
          if (loadedCount < 5) {
            console.log(
              `[BspMeshBuilder] Processing texture ${texName} for mesh ${mesh.name} (Material: ${mesh.material?.getClassName()})`,
            );
            if (shader) console.log(`[BspMeshBuilder] Shader props: ${JSON.stringify(shaderProps)}`);
          }

          // Check if this shader needs special material (glow overlay, etc.)
          if (shader) {
            const { analyzeShaderPattern, createQ3Material } = await import("../shader/Q3ShaderMaterialFactory");
            const analysis = analyzeShaderPattern(shader);

            if (analysis.pattern === "glow_overlay") {
              // Load all required textures for glow overlay
              const stages = shader.stages;
              const baseStage = stages[analysis.baseStageIndex];
              const glowStage = stages[analysis.glowStageIndex];

              // Load glow texture
              let glowTexture: Texture | null = null;
              if (glowStage?.map) {
                const glowPath = glowStage.map.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
                for (const ext of extensions) {
                  glowTexture = await texLoader.loadTexture(`${glowPath}${ext}`);
                  if (glowTexture) break;
                  // Try with textures/ prefix
                  if (!glowPath.startsWith("textures/")) {
                    glowTexture = await texLoader.loadTexture(`textures/${glowPath}${ext}`);
                    if (glowTexture) break;
                  }
                }
              }

              if (texture && glowTexture) {
                // Create glow overlay material
                const textureMap = new Map<string, Texture>();
                textureMap.set(baseStage.map, texture);
                textureMap.set(glowStage.map, glowTexture);

                const materialResult = createQ3Material(shader, scene, {
                  textures: textureMap,
                  lightmapTexture: undefined, // Will be set in applyLightmaps
                  lightmapIntensity: 2.0,
                  debug: false,
                });

                if (materialResult) {
                  mesh.material = materialResult.material;
                  // Store info for lightmap application later
                  if (!mesh.metadata) mesh.metadata = {};
                  mesh.metadata.isGlowOverlay = true;
                  mesh.metadata.needsAnimation = materialResult.needsAnimation;
                  console.log(`[BspMeshBuilder] Created glow overlay material: ${texName}`);
                  loadedCount++;
                  continue; // Skip StandardMaterial path
                }
              } else if (!glowTexture) {
                console.warn(`[BspMeshBuilder] Glow texture not found for: ${texName}`);
              }
            }
          }

          // Standard material path (fallback and non-glow shaders)
          if (mesh.material instanceof StandardMaterial) {
            const mat = mesh.material;
            mat.diffuseTexture = texture;

            // Try to load normal map companion texture (_norm, _normal, _bump)
            const normalSuffixes = ["_norm", "_normal", "_bump"];
            for (const suffix of normalSuffixes) {
              let normalTexFound = false;
              for (const ext of extensions) {
                const normalTex = await texLoader.loadTexture(`${foundCleanPath}${suffix}${ext}`);
                if (normalTex) {
                  mat.bumpTexture = normalTex;
                  mat.bumpTexture.level = 1.0;
                  console.log(`[BspMeshBuilder] Loaded normal map: ${foundCleanPath}${suffix}${ext}`);
                  normalTexFound = true;
                  break;
                }
              }
              if (normalTexFound) break;
            }

            if (shaderProps.alphaCutoff !== undefined && shaderProps.alphaCutoff > 0) {
              // Alpha testing mode - needs texture to be loaded
              mat.transparencyMode = 1; // MATERIAL_ALPHATEST
              mat.alphaCutOff = shaderProps.alphaCutoff;
              mat.useAlphaFromDiffuseTexture = true;
              // Force material to recognize the new texture's alpha
              texture.hasAlpha = true;
            } else if (shaderProps.alphaMode === "blend") {
              mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
              mat.alphaMode = Constants.ALPHA_COMBINE;
              mat.useAlphaFromDiffuseTexture = true;
              texture.hasAlpha = true;
            } else if (shaderProps.alphaMode === "add") {
              // Additive blending for glow effects (halos, flares, glass)
              mat.transparencyMode = 2; // MATERIAL_ALPHABLEND — enables alpha pipeline
              mat.alphaMode = Constants.ALPHA_ADD;
              mat.useAlphaFromDiffuseTexture = true;
              texture.hasAlpha = true;
              // Emissive makes bright pixels glow, diffuse=0 prevents double lighting
              mat.emissiveColor = new Color3(1, 1, 1);
              mat.diffuseColor = new Color3(0, 0, 0);
            } else if (shaderProps.alphaMode === "multiply") {
              // Multiply/filter blending for decals (blendFunc filter = GL_DST_COLOR, GL_ZERO)
              // Use custom shader that computes alpha from luminance (white = transparent)
              const { createFilterBlendMaterial } = await import("../shader/FilterBlendShaderMaterial");
              const filterMat = createFilterBlendMaterial(`filterBlend_${texName}`, scene, texture, {
                alphaThreshold: 0.85,
                alphaPower: 1.2,
                colorDarken: 0.5,
                alphaMultiplier: 0.6,
              });
              mesh.material = filterMat;
              // Skip the rest of the texture application for this mesh
              loadedCount++;
              continue;
            } else {
              // CRITICAL FIX: Explicitly force OPAQUE mode for everything else
              // This prevents Babylon from guessing transparency based on texture memory
              mat.transparencyMode = 0; // MATERIAL_OPAQUE
              mat.alpha = 1.0;
              texture.hasAlpha = false;

              if (loadedCount < 3) {
                console.log(`[BspMeshBuilder] Enforced OPAQUE for ${texName} (Mode: ${mat.transparencyMode})`);
              }
            }

            // Fullbright surfaces (lamps, light panels) - appear self-lit
            // These have surfaceparm nolightmap - they ARE the light sources
            if (shaderProps.isFullbright) {
              mat.emissiveTexture = texture;
              mat.emissiveColor = new Color3(1, 1, 1);
              mat.diffuseColor = new Color3(1, 1, 1);
              mat.disableLighting = true; // Immune to scene lights — renders at full brightness
              // Mark mesh to skip lightmap application
              if (mesh.metadata) {
                mesh.metadata.isFullbright = true;
              } else {
                mesh.metadata = { isFullbright: true };
              }
              console.log(`[BspMeshBuilder] Fullbright surface: ${texName}`);
            }

            // tcGen environment - spherical environment mapping for reflective surfaces
            if (shaderProps.tcGen?.mode === "environment") {
              // Use texture as reflection texture with spherical coordinates
              mat.reflectionTexture = texture;
              texture.coordinatesMode = Texture.SPHERICAL_MODE;
              // Clear diffuse since we're using reflection
              mat.diffuseTexture = null;
              // Slight ambient to prevent total darkness
              mat.ambientColor = new Color3(0.1, 0.1, 0.1);
              console.log(`[BspMeshBuilder] Environment mapping: ${texName}`);
            }

            // Register for shader animation if needed (tcMod, rgbGen wave, alphaGen wave)
            if (shaderProps.needsAnimation && shader) {
              const { ShaderAnimationSystem } = await import("../shader/ShaderAnimationSystem");
              const animSystem = ShaderAnimationSystem.getInstance();
              animSystem.init(scene);

              // Get animation data from first stage
              const firstStage = shader.stages[0];
              if (firstStage) {
                animSystem.registerMaterial(
                  texName,
                  mat,
                  texture,
                  firstStage.tcMod || [],
                  firstStage.rgbGen,
                  firstStage.alphaGen,
                );
              }
            }

            loadedCount++;
          }
        } // end for (const mesh of matchingMeshes)
      }
    }

    // Also try to apply texture to main world mesh (first opaque texture)
    // For now, just count what we loaded
    console.log(`[BspMeshBuilder] Applied ${loadedCount} textures`);
    return loadedCount;
  }

  /**
   * Apply lightmaps to BSP materials using Babylon.js lightmapTexture
   * Uses useLightmapAsShadowmap=true for Q3-style texture × lightmap multiplication
   *
   * The multiplicative flag is set IMMEDIATELY (not deferred). To avoid first-frame
   * flicker, the EffectPreloader pre-compiles the lightmap shader variant during
   * map load, and scene.whenReadyAsync() gates the loading screen until ready.
   */
  public static applyLightmaps(result: BspMeshBuildResult, options?: { intensity?: number }): number {
    const { intensity = 2.0 } = options || {};
    const lightmaps = result.lightmapTextures;

    if (lightmaps.length === 0) {
      console.log("[BspMeshBuilder] No lightmaps to apply");
      return 0;
    }

    // Get all meshes from world mesh and children
    const meshes = [result.worldMesh, ...result.worldMesh.getChildMeshes()];
    let appliedCount = 0;

    for (const mesh of meshes) {
      if (!mesh.metadata?.lightmapIndex || mesh.metadata.lightmapIndex < 0) continue;

      // Skip fullbright surfaces - they should not receive lightmap darkening
      if (mesh.metadata?.isFullbright) continue;

      const lightmapIndex = mesh.metadata.lightmapIndex;
      if (lightmapIndex >= lightmaps.length) continue;

      const lightmapTex = lightmaps[lightmapIndex];
      const mat = mesh.material;

      if (mat instanceof StandardMaterial) {
        // Q3 lighting formula: finalColor = diffuseTexture × lightmap × overbright
        // Babylon.js lightmapTexture with useLightmapAsShadowmap=true does texture × lightmap
        mat.lightmapTexture = lightmapTex;
        mat.lightmapTexture.coordinatesIndex = 1; // Use UV2 (lightmap UVs)
        mat.lightmapTexture.level = intensity;
        mat.useLightmapAsShadowmap = true; // Multiplicative — set immediately

        // Pre-allocate light slots so dynamic PointLights (projectiles, explosions)
        // work without shader recompilation (which frozen materials can't do)
        mat.maxSimultaneousLights = 4;

        // Ensure diffuse is white so lightmap modulates at full range
        mat.diffuseColor = new Color3(1, 1, 1);

        // Clear any stale emissive that might wash out the lightmap
        mat.emissiveTexture = null;
        mat.emissiveColor = new Color3(0, 0, 0);

        if (appliedCount === 0) {
          console.log(`[BspMeshBuilder] Applied first lightmap to ${mesh.name} (intensity: ${intensity})`);
        }

        appliedCount++;
      } else if (mesh.metadata?.isGlowOverlay) {
        // Glow overlay ShaderMaterial - update lightmap texture
        if (mat instanceof ShaderMaterial) {
          mat.setTexture("lightmapSampler", lightmapTex);
          mat.setFloat("hasLightmap", 1.0);
          mat.setFloat("lightmapIntensity", intensity);
          console.log(`[BspMeshBuilder] Applied lightmap to glow overlay: ${mesh.name}`);
          appliedCount++;
        }
      }
    }

    console.log(`[BspMeshBuilder] Applied ${appliedCount} lightmaps (intensity: ${intensity})`);
    return appliedCount;
  }

  /**
   * Apply skybox from BSP sky shaders
   * Call this after bsp render to create skybox from detected sky shaders
   * Supports both cubemap skyboxes (skyparms farbox) and textured skyboxes (stage textures)
   */
  public static async applySkybox(
    result: BspMeshBuildResult,
    scene: Scene,
  ): Promise<{ success: boolean; skybox?: Mesh; error?: string }> {
    if (result.skyShaders.length === 0) {
      return { success: false, error: "No sky shaders found in BSP" };
    }

    const { SkyboxLoader } = await import("../texture/SkyboxLoader");
    const skyboxLoader = SkyboxLoader.getInstance();
    skyboxLoader.init(scene);

    // Dispose existing skybox
    skyboxLoader.disposeSkybox();

    // Try cubemap skybox first (skyparms farbox)
    const cubemapShader = result.skyShaders.find((s) => s.skyParms?.farbox);
    if (cubemapShader?.skyParms?.farbox) {
      const loadResult = await skyboxLoader.loadSkybox(cubemapShader.skyParms.farbox);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created cubemap skybox from: ${cubemapShader.textureName}`);
        return loadResult;
      }
    }

    // Fallback: textured skybox from shader stage textures
    const texturedShader = result.skyShaders.find((s) => s.stageTextures?.length);
    if (texturedShader?.stageTextures?.length) {
      const skyTexture = texturedShader.stageTextures[0];
      const loadResult = await skyboxLoader.loadSkyboxFromTexture(skyTexture);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created textured skybox from: ${skyTexture}`);
        return loadResult;
      }
    }

    // Fallback: try qer_editorimage as sky sphere texture
    // (tried before raw texture name because editorImage is a curated preview
    // while the BSP texture name might match a tiny star/dot texture)
    for (const sky of result.skyShaders) {
      if (!sky.editorImage) continue;

      console.log(`[BspMeshBuilder] Trying editorImage as sky texture: ${sky.editorImage}`);
      const editorResult = await skyboxLoader.loadSkyboxFromTexture(sky.editorImage);
      if (editorResult.success) {
        console.log(`[BspMeshBuilder] Created sky sphere from editorImage: ${sky.editorImage}`);
        return editorResult;
      }
    }

    // Last resort: try sky texture name as cubemap prefix only
    for (const sky of result.skyShaders) {
      const texName = sky.textureName;
      if (!texName) continue;

      console.log(`[BspMeshBuilder] Trying sky texture name as cubemap: ${texName}`);
      const loadResult = await skyboxLoader.loadSkybox(texName);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created cubemap skybox from texture name: ${texName}`);
        return loadResult;
      }
    }

    return {
      success: false,
      error: `No skybox textures found for ${result.skyShaders.length} sky shader(s): ${result.skyShaders.map((s) => s.textureName).join(", ")}`,
    };
  }

  /**
   * Create a Babylon material from resolved shader properties
   */
  private createMaterialFromShaderProps(
    name: string,
    props: ResolvedMaterialProps,
    _textureName: string, // Will be used for texture loading later
  ): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);

    // Base color - white so texture shows properly
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.emissiveColor = new Color3(0, 0, 0);

    // Culling
    mat.backFaceCulling = props.backFaceCulling;
    mat.twoSidedLighting = props.twoSidedLighting;

    // Alpha testing (for things like plant leaves with alpha cutout)
    if (props.alphaCutoff !== undefined && props.alphaCutoff > 0) {
      // Use alpha test mode - pixels below cutoff are discarded
      mat.transparencyMode = 1; // MATERIAL_ALPHATEST
      mat.alphaCutOff = props.alphaCutoff;
      mat.useAlphaFromDiffuseTexture = true;
      // Don't set alphaMode for alpha test - it uses the cutoff instead
    } else {
      // Alpha blending modes
      switch (props.alphaMode) {
        case "add":
          // Additive blending (GL_ONE, GL_ONE)
          mat.transparencyMode = 2; // MATERIAL_ALPHABLEND — enables alpha pipeline
          mat.alphaMode = Constants.ALPHA_ADD;
          mat.alpha = 1;
          // Make emissive for additive glow effect
          mat.emissiveColor = new Color3(1, 1, 1);
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.useAlphaFromDiffuseTexture = true;
          break;
        case "blend":
          // Standard alpha blending
          mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
          mat.alphaMode = Constants.ALPHA_COMBINE;
          mat.alpha = 1;
          mat.useAlphaFromDiffuseTexture = true;
          break;
        case "multiply":
          // Multiply/filter blending (GL_DST_COLOR, GL_ZERO) - for decals
          // Use alpha blend - decal textures should have alpha for transparency
          mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
          mat.alphaMode = Constants.ALPHA_COMBINE;
          mat.alpha = 1;
          mat.useAlphaFromDiffuseTexture = true;
          break;
        default:
          // Opaque
          mat.transparencyMode = 0; // MATERIAL_OPAQUE
          mat.alphaMode = Constants.ALPHA_DISABLE;
          break;
      }
    }

    // Depth write
    mat.disableDepthWrite = !props.depthWrite;

    // Cap light slots to avoid shader uniform block overflow (WebGL2 limit)
    mat.maxSimultaneousLights = 4;

    // Polygon offset for decals
    // NOTE: polygonOffset with multiply blend (decals) still has z-fighting issues
    // TODO: Investigate proper decal rendering with depth sorting or stencil buffer
    if (props.polygonOffset) {
      mat.zOffset = -2;
    }

    return mat;
  }

  // ============================================================================
  // Face Builders
  // ============================================================================

  /**
   * Build polygon face (type 1)
   * Vertices are referenced directly, meshverts provide triangle indices
   */
  private buildPolygonFace(face: BspFace): {
    positions: number[];
    normals: number[];
    uvs: number[];
    uv2s: number[];
    colors: number[];
    indices: number[];
  } {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uv2s: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // Get face vertices
    for (let i = 0; i < face.numVertices; i++) {
      const v = this.bsp.vertices[face.firstVertex + i];
      const pos = getVertexPosition(v);
      const normal = getVertexNormal(v);
      const uv = getVertexTexCoord(v);
      const uv2 = getVertexLightmapCoord(v);
      const color = getVertexColor(v);

      positions.push(pos[0], pos[1], pos[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(uv[0], uv[1]);
      uv2s.push(uv2[0], uv2[1]);
      colors.push(color[0], color[1], color[2], color[3]);
    }

    // Get indices from meshverts and reverse winding for coordinate system change
    const rawIndices: number[] = [];
    for (let i = 0; i < face.numMeshVerts; i++) {
      rawIndices.push(this.bsp.meshVerts[face.firstMeshVert + i]);
    }

    // Reverse triangle winding: (i0, i1, i2) -> (i0, i2, i1)
    for (let i = 0; i < rawIndices.length; i += 3) {
      indices.push(rawIndices[i], rawIndices[i + 2], rawIndices[i + 1]);
    }

    return { positions, normals, uvs, uv2s, colors, indices };
  }

  /**
   * Build mesh face (type 3)
   * Same as polygon, vertices + meshverts define triangles
   */
  private buildMeshFace(face: BspFace): {
    positions: number[];
    normals: number[];
    uvs: number[];
    uv2s: number[];
    colors: number[];
    indices: number[];
  } {
    // Type 3 is identical to type 1 in terms of data layout
    return this.buildPolygonFace(face);
  }

  /**
   * Build patch face (type 2) - Bezier surface
   *
   * Uses a shared vertex grid across all sub-patches to eliminate seam gaps.
   * For an NxM quilt of 3×3 sub-patches (numPatchesX × numPatchesY):
   *   - Total grid = (numPatchesX * tessLevel + 1) × (numPatchesY * tessLevel + 1)
   *   - Adjacent sub-patches share their edge vertices exactly
   *
   * This matches Q3/Warsow rendering where curved surfaces are seamless.
   */
  private buildPatchFace(face: BspFace): {
    positions: number[];
    normals: number[];
    uvs: number[];
    uv2s: number[];
    colors: number[];
    indices: number[];
  } {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uv2s: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const width = face.patchSize[0];
    const height = face.patchSize[1];

    if (width < 3 || height < 3) {
      console.warn(`[BspMeshBuilder] Skipping patch with invalid size: ${width}x${height}`);
      return { positions, normals, uvs, uv2s, colors, indices };
    }

    // Get control points
    const controlPoints: BspVertex[][] = [];
    for (let row = 0; row < height; row++) {
      const rowPoints: BspVertex[] = [];
      for (let col = 0; col < width; col++) {
        const idx = face.firstVertex + row * width + col;
        rowPoints.push(this.bsp.vertices[idx]);
      }
      controlPoints.push(rowPoints);
    }

    // Tessellation level per sub-patch (Q3 "high" geometry used ~8)
    const tessLevel = 8;

    // Number of 3×3 sub-patches in each direction
    const numPatchesX = Math.floor((width - 1) / 2);
    const numPatchesY = Math.floor((height - 1) / 2);

    if (numPatchesX <= 0 || numPatchesY <= 0) {
      console.warn(`[BspMeshBuilder] Invalid patch size: ${width}x${height}`);
      return { positions, normals, uvs, uv2s, colors, indices };
    }

    // Total grid dimensions (shared edges between sub-patches)
    const gridW = numPatchesX * tessLevel + 1;
    const gridH = numPatchesY * tessLevel + 1;

    // Build shared vertex grid
    type TessVert = {
      pos: [number, number, number];
      normal: [number, number, number];
      uv: [number, number];
      uv2: [number, number];
      color: [number, number, number, number];
    };
    const grid: TessVert[] = new Array(gridW * gridH);

    for (let py = 0; py < numPatchesY; py++) {
      for (let px = 0; px < numPatchesX; px++) {
        // Extract 3×3 control grid for this sub-patch
        const ctrl: BspVertex[][] = [];
        for (let j = 0; j < 3; j++) {
          const row: BspVertex[] = [];
          for (let i = 0; i < 3; i++) {
            row.push(controlPoints[py * 2 + j][px * 2 + i]);
          }
          ctrl.push(row);
        }

        // Tessellate this sub-patch into the shared grid
        // Only write interior + right/bottom edges; left/top edges come from adjacent sub-patch
        const uStart = px === 0 ? 0 : 1; // skip left edge if not first column
        const vStart = py === 0 ? 0 : 1; // skip top edge if not first row

        for (let v = vStart; v <= tessLevel; v++) {
          for (let u = uStart; u <= tessLevel; u++) {
            const s = u / tessLevel;
            const t = v / tessLevel;
            const gridX = px * tessLevel + u;
            const gridY = py * tessLevel + v;
            grid[gridY * gridW + gridX] = this.evaluateBezierPatch(ctrl, s, t);
          }
        }
      }
    }

    // Emit vertices from grid
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const vert = grid[gy * gridW + gx];
        positions.push(vert.pos[0], vert.pos[1], vert.pos[2]);
        normals.push(vert.normal[0], vert.normal[1], vert.normal[2]);
        uvs.push(vert.uv[0], vert.uv[1]);
        uv2s.push(vert.uv2[0], vert.uv2[1]);
        colors.push(vert.color[0], vert.color[1], vert.color[2], vert.color[3]);
      }
    }

    // Create indices (reversed winding for Q3→Babylon coordinate system change)
    for (let gy = 0; gy < gridH - 1; gy++) {
      for (let gx = 0; gx < gridW - 1; gx++) {
        const i00 = gy * gridW + gx;
        const i10 = i00 + 1;
        const i01 = i00 + gridW;
        const i11 = i01 + 1;

        // Two triangles per quad (CW winding for Babylon)
        indices.push(i00, i10, i01);
        indices.push(i10, i11, i01);
      }
    }

    return { positions, normals, uvs, uv2s, colors, indices };
  }

  /**
   * Evaluate bezier patch at (s, t) parameter
   *
   * Normals are interpolated from control point normals using the same bezier
   * basis functions (matching Q3/ioquake3). This avoids degenerate normals at
   * patch corners where the cross-product of partial derivatives goes to zero.
   */
  private evaluateBezierPatch(
    ctrl: BspVertex[][],
    s: number,
    t: number,
  ): {
    pos: [number, number, number];
    normal: [number, number, number];
    uv: [number, number];
    uv2: [number, number];
    color: [number, number, number, number];
  } {
    // Quadratic bezier basis functions
    const b0s = (1 - s) * (1 - s);
    const b1s = 2 * s * (1 - s);
    const b2s = s * s;

    const b0t = (1 - t) * (1 - t);
    const b1t = 2 * t * (1 - t);
    const b2t = t * t;

    // Initialize outputs
    let px = 0,
      py = 0,
      pz = 0;
    let nx = 0,
      ny = 0,
      nz = 0;
    let u = 0,
      v = 0;
    let lu = 0,
      lv = 0;
    let cr = 0,
      cg = 0,
      cb = 0,
      ca = 0;

    const bs = [b0s, b1s, b2s];
    const bt = [b0t, b1t, b2t];

    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const cp = ctrl[j][i];
        const w = bs[i] * bt[j];

        const pos = getVertexPosition(cp);
        const norm = getVertexNormal(cp);
        const tex = getVertexTexCoord(cp);
        const lm = getVertexLightmapCoord(cp);
        const col = getVertexColor(cp);

        px += pos[0] * w;
        py += pos[1] * w;
        pz += pos[2] * w;

        // Interpolate control point normals (Q3 approach)
        nx += norm[0] * w;
        ny += norm[1] * w;
        nz += norm[2] * w;

        u += tex[0] * w;
        v += tex[1] * w;

        lu += lm[0] * w;
        lv += lm[1] * w;

        cr += col[0] * w;
        cg += col[1] * w;
        cb += col[2] * w;
        ca += col[3] * w;
      }
    }

    // Normalize the interpolated normal
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0.0001) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      // Degenerate — fall back to up vector
      nx = 0;
      ny = 1;
      nz = 0;
    }

    return {
      pos: [px, py, pz],
      normal: [nx, ny, nz],
      uv: [u, v],
      uv2: [lu, lv],
      color: [cr, cg, cb, ca],
    };
  }

  // ============================================================================
  // Lightmap Building
  // ============================================================================

  /**
   * Convert raw lightmap data to Babylon textures
   */
  private buildLightmapTextures(): Texture[] {
    const textures: Texture[] = [];
    const size = this.bsp.lightmapSize;

    for (let i = 0; i < this.bsp.lightmaps.length; i++) {
      const rgb = this.bsp.lightmaps[i];

      // Convert RGB to RGBA (Babylon needs RGBA)
      const rgba = new Uint8Array(size * size * 4);
      for (let j = 0; j < size * size; j++) {
        // Apply gamma correction (Q3 lightmaps are in linear space)
        rgba[j * 4 + 0] = Math.min(255, (rgb[j * 3 + 0] / 255) ** 0.7 * 255 * 2);
        rgba[j * 4 + 1] = Math.min(255, (rgb[j * 3 + 1] / 255) ** 0.7 * 255 * 2);
        rgba[j * 4 + 2] = Math.min(255, (rgb[j * 3 + 2] / 255) ** 0.7 * 255 * 2);
        rgba[j * 4 + 3] = 255;
      }

      const texture = RawTexture.CreateRGBATexture(
        rgba,
        size,
        size,
        this.scene,
        false, // generateMipMaps
        false, // invertY
        Texture.BILINEAR_SAMPLINGMODE,
      );
      texture.name = `lightmap_${i}`;

      textures.push(texture);
    }

    console.log(`[BspMeshBuilder] Created ${textures.length} lightmap textures (${size}x${size})`);

    return textures;
  }

  /**
   * Apply fog volumes from BSP effects
   * Call this after bsp render to create fog volume meshes
   */
  public static async applyFogVolumes(
    result: BspMeshBuildResult,
    scene: Scene,
  ): Promise<{ success: boolean; fogMeshes: Mesh[]; error?: string }> {
    try {
      const { FogVolumeManager } = await import("./BspFogVolume");
      const fogManager = new FogVolumeManager();
      const fogResult = await fogManager.buildFogVolumes(result.bspData, scene);

      if (fogResult.meshes.length > 0) {
        result.fogVolumes = fogResult.meshes;
        return { success: true, fogMeshes: fogResult.meshes };
      } else {
        return { success: false, fogMeshes: [], error: "No fog volumes found in BSP" };
      }
    } catch (error) {
      console.error("[BspMeshBuilder] Failed to apply fog volumes:", error);
      return { success: false, fogMeshes: [], error: String(error) };
    }
  }
}

// ============================================================================
// Utility: Get visible faces using PVS
// ============================================================================

export function getVisibleFaces(
  bsp: BspFile,
  cameraPosition: Vector3,
  leafFinder: (pos: [number, number, number]) => number, // Returns cluster
): number[] {
  if (!bsp.visData) {
    // No PVS, return all faces
    const allFaces: number[] = [];
    for (let i = 0; i < bsp.faces.length; i++) {
      allFaces.push(i);
    }
    return allFaces;
  }

  // Convert camera to Q3 coords
  const q3Pos: [number, number, number] = [cameraPosition.x, cameraPosition.z, cameraPosition.y];
  const currentCluster = leafFinder(q3Pos);

  if (currentCluster < 0) {
    // Outside world, show everything
    const allFaces: number[] = [];
    for (let i = 0; i < bsp.faces.length; i++) {
      allFaces.push(i);
    }
    return allFaces;
  }

  // Collect visible faces from visible clusters
  const visibleFaces = new Set<number>();

  for (let leafIdx = 0; leafIdx < bsp.leafs.length; leafIdx++) {
    const leaf = bsp.leafs[leafIdx];
    if (leaf.cluster < 0) continue;

    // Check if this leaf's cluster is visible from current cluster
    const byteIdx = currentCluster * bsp.visData.bytesPerCluster + Math.floor(leaf.cluster / 8);
    const bitIdx = leaf.cluster % 8;
    const visible = (bsp.visData.bitVectors[byteIdx] & (1 << bitIdx)) !== 0;

    if (visible) {
      // Add all faces in this leaf
      for (let i = 0; i < leaf.numLeafFaces; i++) {
        visibleFaces.add(bsp.leafFaces[leaf.firstLeafFace + i]);
      }
    }
  }

  return Array.from(visibleFaces);
}

// ============================================================================
// Brush Model Builder (for func_door, func_button, etc.)
// ============================================================================

/**
 * Build a mesh for a specific brush model (inline model like *5, *6, etc.)
 * Used for func_door, func_button, func_rotating, etc.
 *
 * Creates a parent mesh with child meshes per texture group for proper texturing.
 */
export async function buildBrushModel(
  bsp: BspFile,
  modelIndex: number,
  scene: Scene,
  name: string,
): Promise<Mesh | null> {
  if (modelIndex < 0 || modelIndex >= bsp.models.length) {
    console.warn(`[BspMeshBuilder] Invalid model index: ${modelIndex}`);
    return null;
  }

  const model = bsp.models[modelIndex];
  if (model.numFaces === 0) {
    console.warn(`[BspMeshBuilder] Model ${modelIndex} has no faces`);
    return null;
  }

  // Group faces by texture (like main builder)
  const textureGroups = new Map<
    number,
    {
      textureIndex: number;
      textureName: string;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[]; // Lightmap UVs
      indices: number[];
      vertexOffset: number;
      lightmapIndex: number; // Primary lightmap for this group
    }
  >();

  for (let i = model.firstFace; i < model.firstFace + model.numFaces; i++) {
    const face = bsp.faces[i];
    if (!face || face.numVertices < 3) continue;

    // Skip non-polygon/mesh face types for now (patches need tessellation)
    if (face.faceType !== 1 && face.faceType !== 3) continue;

    // Get or create texture group
    let group = textureGroups.get(face.textureIndex);
    if (!group) {
      const textureName = bsp.textures[face.textureIndex]?.name || "";
      group = {
        textureIndex: face.textureIndex,
        textureName,
        positions: [],
        normals: [],
        uvs: [],
        uv2s: [],
        indices: [],
        vertexOffset: 0,
        lightmapIndex: face.lightmapIndex,
      };
      textureGroups.set(face.textureIndex, group);
    }

    const vertexOffset = group.vertexOffset;

    // Get face vertices with proper coordinate conversion
    for (let v = 0; v < face.numVertices; v++) {
      const vertex = bsp.vertices[face.firstVertex + v];
      if (!vertex) continue;

      // Convert Q3 (Z-up) to Babylon (Y-up): [x, y, z] -> [x, z, y]
      group.positions.push(vertex.position[0], vertex.position[2], vertex.position[1]);
      group.normals.push(vertex.normal[0], vertex.normal[2], vertex.normal[1]);
      group.uvs.push(vertex.texCoord[0], vertex.texCoord[1]);
      const lmCoord = getVertexLightmapCoord(vertex);
      group.uv2s.push(lmCoord[0], lmCoord[1]);
    }

    // Get indices from meshVerts (proper triangle indices, not fan)
    // Reverse winding for coordinate system change: (i0, i1, i2) -> (i0, i2, i1)
    for (let m = 0; m < face.numMeshVerts; m += 3) {
      const i0 = bsp.meshVerts[face.firstMeshVert + m] + vertexOffset;
      const i1 = bsp.meshVerts[face.firstMeshVert + m + 1] + vertexOffset;
      const i2 = bsp.meshVerts[face.firstMeshVert + m + 2] + vertexOffset;
      group.indices.push(i0, i2, i1); // Reversed winding
    }

    group.vertexOffset += face.numVertices;
  }

  if (textureGroups.size === 0) {
    console.warn(`[BspMeshBuilder] Model ${modelIndex} produced no geometry`);
    return null;
  }

  // Create parent mesh
  const parentMesh = new Mesh(name, scene);

  // Calculate model center for pivot (convert Q3 to Babylon coords)
  const centerX = (model.mins[0] + model.maxs[0]) / 2;
  const centerY = (model.mins[2] + model.maxs[2]) / 2; // Z->Y
  const centerZ = (model.mins[1] + model.maxs[1]) / 2; // Y->Z

  // Get texture loader
  const { PK3TextureLoader } = await import("../pk3/PK3TextureLoader");
  const texLoader = PK3TextureLoader.getInstance();

  let totalVertices = 0;
  let totalTriangles = 0;

  // Create child mesh for each texture group
  for (const [texIndex, group] of textureGroups) {
    if (group.indices.length === 0) continue;

    const childName = `${name}_tex${texIndex}`;
    const childMesh = new Mesh(childName, scene);

    const vertexData = new VertexData();
    vertexData.positions = group.positions;
    vertexData.normals = group.normals;
    vertexData.uvs = group.uvs;
    if (group.uv2s.length > 0) {
      vertexData.uvs2 = group.uv2s;
    }
    vertexData.indices = group.indices;
    vertexData.applyToMesh(childMesh);

    // Store lightmap index for later application
    const texFlags = bsp.textures[texIndex];
    childMesh.metadata = {
      lightmapIndex: group.lightmapIndex,
      textureName: group.textureName,
      textureIndex: texIndex,
      contentFlags: texFlags?.contentFlags ?? 0,
      surfaceFlags: texFlags?.surfaceFlags ?? 0,
    };

    // Create material and try to load texture
    const mat = new StandardMaterial(`${childName}_mat`, scene);
    mat.backFaceCulling = true;
    mat.maxSimultaneousLights = 4;

    // Try to load texture (use same path resolution as main BSP)
    if (group.textureName && !group.textureName.toLowerCase().includes("common/")) {
      const texName = group.textureName;
      const { Q3ShaderRegistry } = await import("../shader/Q3ShaderRegistry");
      const shaderRegistry = Q3ShaderRegistry.getInstance();

      // Build paths to try
      const pathsToTry: string[] = [];

      // 1. Check shader for texture override
      const shader = shaderRegistry.getShader(texName);
      if (shader && shader.stages.length > 0) {
        const firstStage = shader.stages[0];
        if (firstStage.map && firstStage.map !== "$lightmap" && firstStage.map !== "$whiteimage") {
          pathsToTry.push(firstStage.map);
        }
      }

      // 2. Try texture name as-is
      pathsToTry.push(texName);

      // 3. Add textures/ prefix if needed
      const allPaths: string[] = [];
      for (const p of pathsToTry) {
        allPaths.push(p);
        if (!p.toLowerCase().startsWith("textures/") && !p.toLowerCase().startsWith("models/")) {
          allPaths.push(`textures/${p}`);
        }
      }

      // Try loading with various extensions
      const extensions = [".jpg", ".png", ".tga", ".ktx"];
      let texture: Texture | null = null;

      for (const basePath of allPaths) {
        if (texture) break;
        const cleanPath = basePath.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
        for (const ext of extensions) {
          texture = await texLoader.loadTexture(`${cleanPath}${ext}`);
          if (texture) break;
        }
      }

      if (texture) {
        mat.diffuseTexture = texture;
        // Try to load and apply lightmap
        if (group.lightmapIndex >= 0 && group.lightmapIndex < bsp.lightmaps.length) {
          const lmData = bsp.lightmaps[group.lightmapIndex];
          if (lmData && lmData.length > 0) {
            const lmSize = bsp.lightmapSize;
            const lmTex = new RawTexture(
              lmData,
              lmSize,
              lmSize,
              Engine.TEXTUREFORMAT_RGB,
              scene,
              false, // generateMipMaps
              false, // invertY
              Texture.BILINEAR_SAMPLINGMODE,
            );
            lmTex.name = `${childName}_lightmap`;
            mat.lightmapTexture = lmTex;
            mat.useLightmapAsShadowmap = true;
            mat.lightmapTexture.coordinatesIndex = 1; // Use UV2
          }
        }
        // Slight emissive boost for visibility
        mat.emissiveColor = new Color3(0.15, 0.15, 0.15);
      } else {
        mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
        mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
      }
    } else {
      mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
      mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
    }

    childMesh.material = mat;
    childMesh.parent = parentMesh;

    totalVertices += group.positions.length / 3;
    totalTriangles += group.indices.length / 3;
  }

  // Set pivot to model center
  parentMesh.setPivotPoint(new Vector3(centerX, centerY, centerZ));

  // Store model info in metadata
  parentMesh.metadata = {
    brushModelIndex: modelIndex,
    modelBounds: {
      min: new Vector3(model.mins[0], model.mins[2], model.mins[1]),
      max: new Vector3(model.maxs[0], model.maxs[2], model.maxs[1]),
    },
  };

  console.log(
    `[BspMeshBuilder] Built brush model *${modelIndex}: ${totalVertices} vertices, ${totalTriangles} triangles, ${textureGroups.size} textures`,
  );

  return parentMesh;
}
