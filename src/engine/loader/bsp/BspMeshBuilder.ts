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
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../../lighting/DynamicLightSafety";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import type { ResolvedMaterialProps } from "../shader/Q3ShaderTypes";
import type { BspFile } from "./BspLoader";
import { createRadialGradientTexture, createSolidColorTexture } from "./mesh/fallbackTextures";
import { buildMeshFace, buildPatchFace, buildPolygonFace } from "./mesh/faceBuilders";
import type { BspMeshBuildResult, BuildOptions } from "./mesh/types";

export type { BspMeshBuildResult, BuildOptions } from "./mesh/types";
export { q3ToBabylonVec3, reverseTriangleWinding } from "./mesh/coordinates";
export { buildBrushModel } from "./mesh/brushModelBuilder";
export { getVisibleFaces } from "./mesh/pvs";

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
    let _fogFacesCount = 0;

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
      const shaderProps = shaderRegistry.resolveMaterialProps(textureName, { deluxe: this.options.deluxe });
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
            faceData = buildPolygonFace(this.bsp, face);
            break;
          case 2:
            faceData = buildPatchFace(this.bsp, face);
            break;
          case 3:
            faceData = buildMeshFace(this.bsp, face);
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
          _fogFacesCount++;
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
          faceData = buildPolygonFace(this.bsp, face);
          break;
        case 2: // Patch
          stats.patchFaces++;
          faceData = buildPatchFace(this.bsp, face);
          break;
        case 3: // Mesh
          stats.meshFaces++;
          faceData = buildMeshFace(this.bsp, face);
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
    options?: { deluxe?: boolean; pbr?: boolean },
  ): Promise<number> {
    const { PK3TextureLoader } = await import("../pk3/PK3TextureLoader");
    const texLoader = PK3TextureLoader.getInstance();
    const engine = scene.getEngine();

    // Initialize texture loader if needed
    // biome-ignore lint/suspicious/noExplicitAny: BSP mesh builder internals
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
    const stripTextureExtension = (path: string): string => path.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
    const normalizeTexturePath = (path: string): string => path.replace(/\\/g, "/");
    const isSpecialTextureToken = (path?: string): boolean => Boolean(path?.startsWith("$"));
    const addTexturePrefixes = (path: string): string[] => {
      const normalized = normalizeTexturePath(path);
      if (isSpecialTextureToken(normalized)) {
        return [];
      }

      const paths = [normalized];
      const lower = normalized.toLowerCase();
      if (!lower.startsWith("textures/") && !lower.startsWith("models/")) {
        paths.push(`textures/${normalized}`);
      }
      return paths;
    };
    const dedupePaths = (paths: string[]): string[] => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const path of paths) {
        const normalized = normalizeTexturePath(path);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        deduped.push(normalized);
      }
      return deduped;
    };
    const buildTextureNameFallbacks = (textureName: string): string[] => {
      const paths: string[] = [textureName];
      if (textureName.includes("_") && !textureName.includes("/")) {
        const parts = textureName.split("_");
        if (parts.length >= 2) {
          paths.push(parts.join("/"));
          if (parts.length >= 3) {
            paths.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join("_")}`);
          }
          if (parts.length >= 4) {
            paths.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("_")}`);
          }
        }
      }
      return paths;
    };
    const buildDiffuseCandidates = (textureName: string, shaderProps: ResolvedMaterialProps): string[] => {
      const candidates: string[] = [];

      if (shaderProps.hasMaterialMetadata) {
        if (shaderProps.diffuseTexture && !isSpecialTextureToken(shaderProps.diffuseTexture)) {
          candidates.push(...addTexturePrefixes(shaderProps.diffuseTexture));
        } else if (!shaderProps.diffuseTexture) {
          for (const fallback of buildTextureNameFallbacks(textureName)) {
            candidates.push(...addTexturePrefixes(fallback));
          }
        }
        return dedupePaths(candidates);
      }

      if (shaderProps.diffuseTexture && !isSpecialTextureToken(shaderProps.diffuseTexture)) {
        candidates.push(...addTexturePrefixes(shaderProps.diffuseTexture));
      }
      for (const fallback of buildTextureNameFallbacks(textureName)) {
        candidates.push(...addTexturePrefixes(fallback));
      }
      return dedupePaths(candidates);
    };
    const loadFirstTexture = async (
      candidates: string[],
    ): Promise<{ texture: Texture | null; resolvedBasePath: string }> => {
      for (const candidate of candidates) {
        const texture = await texLoader.resolveAndLoadTexture(candidate);
        if (texture) {
          return {
            texture,
            resolvedBasePath: stripTextureExtension(candidate),
          };
        }
      }
      return { texture: null, resolvedBasePath: "" };
    };
    const loadOptionalTexture = async (
      explicitPath: string | undefined,
      explicitBlank: boolean,
      fallbackBasePath: string,
      suffixes: string[],
    ): Promise<Texture | null> => {
      if (explicitBlank) {
        return null;
      }

      if (explicitPath) {
        const { texture } = await loadFirstTexture(addTexturePrefixes(explicitPath));
        return texture;
      }

      if (!fallbackBasePath) {
        return null;
      }

      const candidates: string[] = [];
      for (const suffix of suffixes) {
        candidates.push(...addTexturePrefixes(`${fallbackBasePath}${suffix}`));
      }
      const { texture } = await loadFirstTexture(dedupePaths(candidates));
      return texture;
    };

    for (const group of result.textureGroups) {
      const texName = group.textureName;
      if (!texName || texName.toLowerCase().includes("common/")) continue;

      progressCallback?.(loadedCount, total, texName);

      const shaderProps = shaderRegistry.resolveMaterialProps(texName, { deluxe: options?.deluxe });
      const shader = shaderRegistry.getShader(texName);
      const diffuseCandidates = buildDiffuseCandidates(texName, shaderProps);
      let texture: Texture | null = null;
      let foundCleanPath = "";
      const diffuseResult = await loadFirstTexture(diffuseCandidates);
      texture = diffuseResult.texture;
      foundCleanPath = diffuseResult.resolvedBasePath;

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
          if (
            shader &&
            !shaderProps.hasMaterialMetadata &&
            shaderProps.resolvedBranch === "default" &&
            !shader.conditionalBlocks?.length
          ) {
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
                const glowResult = await loadFirstTexture(addTexturePrefixes(glowStage.map));
                glowTexture = glowResult.texture;
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
            let hasNormalMap = false;
            let hasGlossMap = false;

            const normalTexture = await loadOptionalTexture(
              shaderProps.normalTexture,
              shaderProps.normalTextureExplicitlyBlank,
              foundCleanPath,
              ["_norm", "_normal", "_bump"],
            );
            if (normalTexture) {
              mat.bumpTexture = normalTexture;
              mat.bumpTexture.level = 1.0;
              hasNormalMap = true;
              console.log(`[BspMeshBuilder] Loaded normal map for: ${texName}`);
            }

            const glossTexture = await loadOptionalTexture(
              shaderProps.glossTexture,
              shaderProps.glossTextureExplicitlyBlank,
              foundCleanPath,
              ["_gloss", "_spec"],
            );
            if (glossTexture) {
              mat.specularTexture = glossTexture;
              hasGlossMap = true;
              console.log(`[BspMeshBuilder] Loaded gloss map for: ${texName}`);
            }

            BspMeshBuilder.tuneCompanionSurfaceMaterial(mat, { hasNormalMap, hasGlossMap });

            const glowTexture = await loadOptionalTexture(
              shaderProps.glowTexture,
              shaderProps.glowTextureExplicitlyBlank,
              "",
              [],
            );
            if (glowTexture) {
              mat.emissiveTexture = glowTexture;
              mat.emissiveColor = new Color3(1, 1, 1);
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.preserveEmissive = true;
              console.log(`[BspMeshBuilder] Loaded glow map for: ${texName}`);
            }

            if (options?.pbr && BspMeshBuilder.shouldUseGeneratedPBR(shaderProps, hasNormalMap, hasGlossMap)) {
              const pbrMat = BspMeshBuilder.createGeneratedPBRMaterial(
                `${mesh.name}_pbr`,
                scene,
                shaderProps,
                texture,
                normalTexture,
                glossTexture,
                glowTexture,
              );
              mesh.material = pbrMat;
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.usesBspPbr = true;
              if (glowTexture) {
                mesh.metadata.preserveEmissive = true;
              }
              console.log(`[BspMeshBuilder] Created generated PBR material for: ${texName}`);
              loadedCount++;
              continue;
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
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.preserveEmissive = true;
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
              mat.emissiveTexture = glowTexture ?? texture;
              mat.emissiveColor = new Color3(1, 1, 1);
              mat.diffuseColor = new Color3(1, 1, 1);
              mat.disableLighting = true; // Immune to scene lights — renders at full brightness
              // Mark mesh to skip lightmap application
              if (mesh.metadata) {
                mesh.metadata.isFullbright = true;
                mesh.metadata.preserveEmissive = true;
              } else {
                mesh.metadata = { isFullbright: true, preserveEmissive: true };
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
  /**
   * Freeze world matrices + bounding info on the STATIC BSP world meshes
   * (`bsp_world` + `bsp_tex_*`), which never transform after build. This skips
   * the per-frame world-matrix recompute and bounding-info sync Babylon does for
   * every mesh, a pure CPU win that scales with the map's texture-group count.
   *
   * Safe because: PVS toggles `isVisible` (not transforms), and static geometry's
   * bounds never change. Autosprites are excluded — they billboard by rewriting
   * vertex positions every frame, so their world matrix must stay live. Returns
   * the number of meshes frozen. Gated by `r_bsp_freeze`; applied at map build.
   */
  public static freezeStaticWorld(result: BspMeshBuildResult): number {
    if (!result?.worldMesh) return 0;
    let frozen = 0;
    const freezeOne = (mesh: AbstractMesh): void => {
      if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2) return;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      frozen++;
    };
    freezeOne(result.worldMesh);
    for (const child of result.worldMesh.getChildMeshes()) {
      freezeOne(child);
    }
    return frozen;
  }

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
      const meshLightmapIndex = mesh.metadata?.lightmapIndex;
      if (meshLightmapIndex === undefined || meshLightmapIndex === null || meshLightmapIndex < 0) continue;

      // Skip fullbright surfaces - they should not receive lightmap darkening
      if (mesh.metadata?.isFullbright) continue;

      const lightmapIndex = meshLightmapIndex;
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
        applySafeMaxSimultaneousLights(mat);

        // Ensure diffuse is white so lightmap modulates at full range
        mat.diffuseColor = new Color3(1, 1, 1);

        // Clear stale emissive unless this surface deliberately uses a glow map.
        if (!mesh.metadata?.preserveEmissive) {
          mat.emissiveTexture = null;
          mat.emissiveColor = new Color3(0, 0, 0);
        }

        if (appliedCount === 0) {
          console.log(`[BspMeshBuilder] Applied first lightmap to ${mesh.name} (intensity: ${intensity})`);
        }

        appliedCount++;
      } else if (mat instanceof PBRMaterial) {
        mat.lightmapTexture = lightmapTex;
        mat.lightmapTexture.coordinatesIndex = 1; // Use UV2 (lightmap UVs)
        // PBR surfaces already respond more strongly to scene lighting than the
        // classic StandardMaterial BSP path, so use a softer lightmap gain to
        // avoid washing out normal/spec detail on metallic Warsow materials.
        mat.lightmapTexture.level = intensity * 0.6;
        const pbrWithShadowmap = mat as PBRMaterial & { useLightmapAsShadowmap?: boolean };
        pbrWithShadowmap.useLightmapAsShadowmap = true;

        applySafeMaxSimultaneousLights(mat);
        mat.albedoColor = new Color3(1, 1, 1);

        if (!mesh.metadata?.preserveEmissive) {
          mat.emissiveTexture = null;
          mat.emissiveColor = new Color3(0, 0, 0);
        }

        if (appliedCount === 0) {
          console.log(`[BspMeshBuilder] Applied first PBR lightmap to ${mesh.name} (intensity: ${intensity})`);
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
    applySafeMaxSimultaneousLights(mat);

    // Polygon offset for decals
    // NOTE: polygonOffset with multiply blend (decals) still has z-fighting issues
    // TODO: Investigate proper decal rendering with depth sorting or stencil buffer
    if (props.polygonOffset) {
      mat.zOffset = -2;
    }

    return mat;
  }

  /**
   * Tune StandardMaterial response for filename- or material-driven companion maps.
   * Warsow-style `_norm`/`_gloss` sets often expect a punchier metal response than
   * Babylon's conservative defaults provide out of the box.
   */
  private static tuneCompanionSurfaceMaterial(
    mat: StandardMaterial,
    options: {
      hasNormalMap: boolean;
      hasGlossMap: boolean;
    },
  ): void {
    if (options.hasGlossMap && mat.specularTexture) {
      // Boost gloss contribution and broaden highlights so dark grayscale gloss maps
      // still read as metal in the BSP + lightmap pipeline.
      mat.specularTexture.level = options.hasNormalMap ? 1.4 : 1.2;
      const specularStrength = options.hasNormalMap ? 0.65 : 0.5;
      mat.specularColor = new Color3(specularStrength, specularStrength, specularStrength);
      mat.specularPower = options.hasNormalMap ? 24 : 32;
      return;
    }

    if (options.hasNormalMap) {
      // Even without an explicit gloss map, a small specular term helps the relief
      // from companion normal maps show up on worn metal/concrete surfaces.
      mat.specularColor = new Color3(0.18, 0.18, 0.18);
      mat.specularPower = 48;
    }
  }

  private static shouldUseGeneratedPBR(
    props: ResolvedMaterialProps,
    hasNormalMap: boolean,
    hasGlossMap: boolean,
  ): boolean {
    if (!hasNormalMap || !hasGlossMap) return false;
    if (props.isTransparent || props.alphaMode !== "opaque") return false;
    if (props.alphaCutoff !== undefined) return false;
    if (props.isSky || props.isFullbright) return false;
    return true;
  }

  private static createGeneratedPBRMaterial(
    name: string,
    scene: Scene,
    props: ResolvedMaterialProps,
    diffuseTexture: Texture,
    normalTexture: Texture | null,
    glossTexture: Texture | null,
    glowTexture: Texture | null,
  ): PBRMaterial {
    const mat = new PBRMaterial(name, scene);
    mat.albedoTexture = diffuseTexture;
    mat.albedoColor = new Color3(1, 1, 1);
    mat.backFaceCulling = props.backFaceCulling;
    mat.twoSidedLighting = props.twoSidedLighting;
    applySafeMaxSimultaneousLights(mat);
    mat.usePhysicalLightFalloff = false;
    // BSP surfaces are primarily driven by baked lightmaps plus the fixed BSP
    // sun. Synthetic environment lighting tends to over-brighten and flatten
    // these materials, so keep it off for the generated path.
    mat.environmentIntensity = 0.0;
    mat.metallic = 0;
    // These assets are authored closer to an old spec/gloss workflow than a
    // modern metallic/roughness one. Keep metalness at 0 and let the gloss map
    // shape surface response instead of pretending it is a metalness map.
    mat.roughness = 0.78;
    mat.microSurface = 0.9;

    if (normalTexture) {
      mat.bumpTexture = normalTexture;
      mat.bumpTexture.level = 1.0;
    }

    if (glossTexture) {
      // Babylon treats microSurfaceTexture as grayscale glossiness in its
      // spec/gloss workflow, which is a closer fit for Warsow `_gloss` maps.
      mat.microSurfaceTexture = glossTexture;
      mat.microSurfaceTexture.level = 1.0;
      mat.reflectivityColor = new Color3(0.62, 0.62, 0.62);
      const pbrAny = mat as PBRMaterial & {
        useMicroSurfaceFromReflectivityMapAlpha?: boolean;
        useAutoMicroSurfaceFromReflectivityMap?: boolean;
      };
      pbrAny.useMicroSurfaceFromReflectivityMapAlpha = false;
      pbrAny.useAutoMicroSurfaceFromReflectivityMap = false;
    }

    if (glowTexture) {
      mat.emissiveTexture = glowTexture;
      mat.emissiveColor = new Color3(1, 1, 1);
    }

    return mat;
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
