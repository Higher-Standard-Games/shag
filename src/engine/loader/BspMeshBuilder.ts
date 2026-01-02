/**
 * BspMeshBuilder - Convert BSP faces to Babylon.js meshes
 *
 * Handles:
 * - Polygon faces (type 1) - pre-triangulated meshes
 * - Patch faces (type 2) - bezier surfaces (tessellation)
 * - Mesh faces (type 3) - triangle soups (misc_model)
 * - Billboard faces (type 4) - flares/sprites
 */

import {
  Mesh,
  Scene,
  StandardMaterial,
  Color3,
  VertexData,
  Vector3,
  RawTexture,
  Texture,
} from "babylonjs";
import type {
  BspFile,
  BspFace,
  BspVertex,
  BspVertexIBSP,
  BspVertexFBSP,
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
  /** Statistics */
  stats: {
    totalFaces: number;
    polygonFaces: number;
    patchFaces: number;
    meshFaces: number;
    billboardFaces: number;
    totalVertices: number;
    totalTriangles: number;
  };
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

function q3ToBabylonVec3(pos: [number, number, number]): Vector3 {
  return new Vector3(pos[0], pos[2], pos[1]);
}

/**
 * Reverse triangle winding order to fix handedness change
 * Input: [i0, i1, i2, i3, i4, i5, ...]
 * Output: [i0, i2, i1, i3, i5, i4, ...]
 */
function reverseTriangleWinding(indices: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    result.push(indices[i], indices[i + 2], indices[i + 1]);
  }
  return result;
}

// ============================================================================
// Vertex Helpers
// ============================================================================

function isIBSPVertex(v: BspVertex): v is BspVertexIBSP {
  return 'lightmapCoord' in v;
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

export class BspMeshBuilder {
  private bsp: BspFile;
  private scene: Scene;

  private constructor(bsp: BspFile, scene: Scene) {
    this.bsp = bsp;
    this.scene = scene;
  }

  /**
   * Build meshes from BSP file
   */
  public static build(bsp: BspFile, scene: Scene): BspMeshBuildResult {
    const builder = new BspMeshBuilder(bsp, scene);
    return builder.buildAll();
  }

  private buildAll(): BspMeshBuildResult {
    console.log(`[BspMeshBuilder] Building meshes from ${this.bsp.faces.length} faces`);

    const stats = {
      totalFaces: this.bsp.faces.length,
      polygonFaces: 0,
      patchFaces: 0,
      meshFaces: 0,
      billboardFaces: 0,
      totalVertices: 0,
      totalTriangles: 0,
    };

    // Collect all geometry into single mesh for efficiency
    const allPositions: number[] = [];
    const allNormals: number[] = [];
    const allUVs: number[] = [];
    const allUV2s: number[] = []; // Lightmap UVs
    const allColors: number[] = [];
    const allIndices: number[] = [];

    let indexOffset = 0;

    // Build first model only (model 0 = world geometry)
    const worldModel = this.bsp.models[0];
    if (!worldModel) {
      throw new Error('[BspMeshBuilder] No world model found');
    }

    for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
      const face = this.bsp.faces[i];
      if (!face) continue;

      let faceData: { positions: number[]; normals: number[]; uvs: number[]; uv2s: number[]; colors: number[]; indices: number[] } | null = null;

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
        // Add positions
        for (const p of faceData.positions) {
          allPositions.push(p);
        }

        // Add normals
        for (const n of faceData.normals) {
          allNormals.push(n);
        }

        // Add UVs
        for (const uv of faceData.uvs) {
          allUVs.push(uv);
        }

        // Add lightmap UVs
        for (const uv2 of faceData.uv2s) {
          allUV2s.push(uv2);
        }

        // Add colors
        for (const c of faceData.colors) {
          allColors.push(c);
        }

        // Add indices (offset by current vertex count)
        const numVerts = faceData.positions.length / 3;
        for (const idx of faceData.indices) {
          allIndices.push(idx + indexOffset);
        }
        indexOffset += numVerts;

        stats.totalVertices += numVerts;
        stats.totalTriangles += faceData.indices.length / 3;
      }
    }

    // Create world mesh
    const worldMesh = new Mesh("bsp_world", this.scene);

    const vertexData = new VertexData();
    vertexData.positions = allPositions;
    vertexData.normals = allNormals;
    vertexData.uvs = allUVs;
    if (allUV2s.length > 0) {
      vertexData.uvs2 = allUV2s;
    }
    if (allColors.length > 0) {
      vertexData.colors = allColors;
    }
    vertexData.indices = allIndices;
    vertexData.applyToMesh(worldMesh);

    // Create default material
    const material = new StandardMaterial("bsp_material", this.scene);
    material.diffuseColor = new Color3(0.8, 0.8, 0.8);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    material.backFaceCulling = false; // BSP faces can be visible from both sides
    worldMesh.material = material;

    // Enable collisions
    worldMesh.checkCollisions = true;

    // Create lightmap textures
    const lightmapTextures = this.buildLightmapTextures();

    console.log(`[BspMeshBuilder] Built world mesh: ${stats.totalVertices} vertices, ${stats.totalTriangles} triangles`);
    console.log(`[BspMeshBuilder] Face breakdown: ${stats.polygonFaces} polygons, ${stats.patchFaces} patches, ${stats.meshFaces} meshes, ${stats.billboardFaces} billboards`);

    return {
      worldMesh,
      lightmapTextures,
      stats,
    };
  }

  // ============================================================================
  // Face Builders
  // ============================================================================

  /**
   * Build polygon face (type 1)
   * Vertices are referenced directly, meshverts provide triangle indices
   */
  private buildPolygonFace(face: BspFace): { positions: number[]; normals: number[]; uvs: number[]; uv2s: number[]; colors: number[]; indices: number[] } {
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
  private buildMeshFace(face: BspFace): { positions: number[]; normals: number[]; uvs: number[]; uv2s: number[]; colors: number[]; indices: number[] } {
    // Type 3 is identical to type 1 in terms of data layout
    return this.buildPolygonFace(face);
  }

  /**
   * Build patch face (type 2) - Bezier surface
   * Control points form a grid, we tessellate to create geometry
   */
  private buildPatchFace(face: BspFace): { positions: number[]; normals: number[]; uvs: number[]; uv2s: number[]; colors: number[]; indices: number[] } {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uv2s: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const width = face.patchSize[0];
    const height = face.patchSize[1];

    if (width < 3 || height < 3) {
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

    // Tessellation level (can be made dynamic based on distance)
    const tessLevel = 4;

    // Process each 3x3 patch segment
    const numPatchesX = (width - 1) / 2;
    const numPatchesY = (height - 1) / 2;

    let vertexIndex = 0;

    for (let py = 0; py < numPatchesY; py++) {
      for (let px = 0; px < numPatchesX; px++) {
        // Extract 3x3 control grid for this patch
        const ctrl: BspVertex[][] = [];
        for (let j = 0; j < 3; j++) {
          const row: BspVertex[] = [];
          for (let i = 0; i < 3; i++) {
            row.push(controlPoints[py * 2 + j][px * 2 + i]);
          }
          ctrl.push(row);
        }

        // Tessellate this patch
        const tessVerts: { pos: [number, number, number]; normal: [number, number, number]; uv: [number, number]; uv2: [number, number]; color: [number, number, number, number] }[][] = [];

        for (let v = 0; v <= tessLevel; v++) {
          const row: typeof tessVerts[0] = [];
          for (let u = 0; u <= tessLevel; u++) {
            const s = u / tessLevel;
            const t = v / tessLevel;
            row.push(this.evaluateBezierPatch(ctrl, s, t));
          }
          tessVerts.push(row);
        }

        // Generate triangles
        const startIdx = vertexIndex;
        for (let v = 0; v <= tessLevel; v++) {
          for (let u = 0; u <= tessLevel; u++) {
            const vert = tessVerts[v][u];
            positions.push(vert.pos[0], vert.pos[1], vert.pos[2]);
            normals.push(vert.normal[0], vert.normal[1], vert.normal[2]);
            uvs.push(vert.uv[0], vert.uv[1]);
            uv2s.push(vert.uv2[0], vert.uv2[1]);
            colors.push(vert.color[0], vert.color[1], vert.color[2], vert.color[3]);
            vertexIndex++;
          }
        }

        // Create indices for this patch (reversed winding for coordinate system change)
        for (let v = 0; v < tessLevel; v++) {
          for (let u = 0; u < tessLevel; u++) {
            const i00 = startIdx + v * (tessLevel + 1) + u;
            const i10 = i00 + 1;
            const i01 = i00 + (tessLevel + 1);
            const i11 = i01 + 1;

            // Two triangles per quad (winding reversed: CCW -> CW)
            indices.push(i00, i10, i01);
            indices.push(i10, i11, i01);
          }
        }
      }
    }

    return { positions, normals, uvs, uv2s, colors, indices };
  }

  /**
   * Evaluate bezier patch at (s, t) parameter
   */
  private evaluateBezierPatch(
    ctrl: BspVertex[][],
    s: number,
    t: number
  ): { pos: [number, number, number]; normal: [number, number, number]; uv: [number, number]; uv2: [number, number]; color: [number, number, number, number] } {
    // Quadratic bezier basis functions
    const b0s = (1 - s) * (1 - s);
    const b1s = 2 * s * (1 - s);
    const b2s = s * s;

    const b0t = (1 - t) * (1 - t);
    const b1t = 2 * t * (1 - t);
    const b2t = t * t;

    // Derivatives for normal calculation
    const db0s = -2 * (1 - s);
    const db1s = 2 - 4 * s;
    const db2s = 2 * s;

    const db0t = -2 * (1 - t);
    const db1t = 2 - 4 * t;
    const db2t = 2 * t;

    // Initialize outputs
    let px = 0, py = 0, pz = 0;
    let u = 0, v = 0;
    let lu = 0, lv = 0;
    let cr = 0, cg = 0, cb = 0, ca = 0;

    // Partial derivatives
    let dpdsx = 0, dpdsy = 0, dpdsz = 0;
    let dpdtx = 0, dpdty = 0, dpdtz = 0;

    const bs = [b0s, b1s, b2s];
    const bt = [b0t, b1t, b2t];
    const dbs = [db0s, db1s, db2s];
    const dbt = [db0t, db1t, db2t];

    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const cp = ctrl[j][i];
        const w = bs[i] * bt[j];
        const ws = dbs[i] * bt[j];
        const wt = bs[i] * dbt[j];

        const pos = getVertexPosition(cp);
        const tex = getVertexTexCoord(cp);
        const lm = getVertexLightmapCoord(cp);
        const col = getVertexColor(cp);

        px += pos[0] * w;
        py += pos[1] * w;
        pz += pos[2] * w;

        u += tex[0] * w;
        v += tex[1] * w;

        lu += lm[0] * w;
        lv += lm[1] * w;

        cr += col[0] * w;
        cg += col[1] * w;
        cb += col[2] * w;
        ca += col[3] * w;

        dpdsx += pos[0] * ws;
        dpdsy += pos[1] * ws;
        dpdsz += pos[2] * ws;

        dpdtx += pos[0] * wt;
        dpdty += pos[1] * wt;
        dpdtz += pos[2] * wt;
      }
    }

    // Calculate normal from cross product of partial derivatives
    const dpds = new Vector3(dpdsx, dpdsy, dpdsz);
    const dpdt = new Vector3(dpdtx, dpdty, dpdtz);
    const normal = Vector3.Cross(dpds, dpdt).normalize();

    return {
      pos: [px, py, pz],
      normal: [normal.x, normal.y, normal.z],
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
        rgba[j * 4 + 0] = Math.min(255, Math.pow(rgb[j * 3 + 0] / 255, 0.7) * 255 * 2);
        rgba[j * 4 + 1] = Math.min(255, Math.pow(rgb[j * 3 + 1] / 255, 0.7) * 255 * 2);
        rgba[j * 4 + 2] = Math.min(255, Math.pow(rgb[j * 3 + 2] / 255, 0.7) * 255 * 2);
        rgba[j * 4 + 3] = 255;
      }

      const texture = RawTexture.CreateRGBATexture(
        rgba,
        size,
        size,
        this.scene,
        false, // generateMipMaps
        false, // invertY
        Texture.BILINEAR_SAMPLINGMODE
      );
      texture.name = `lightmap_${i}`;

      textures.push(texture);
    }

    console.log(`[BspMeshBuilder] Created ${textures.length} lightmap textures (${size}x${size})`);

    return textures;
  }
}

// ============================================================================
// Utility: Get visible faces using PVS
// ============================================================================

export function getVisibleFaces(
  bsp: BspFile,
  cameraPosition: Vector3,
  leafFinder: (pos: [number, number, number]) => number // Returns cluster
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
