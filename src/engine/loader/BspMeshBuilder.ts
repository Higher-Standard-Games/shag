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
  Constants,
} from "babylonjs";
import type {
  BspFile,
  BspFace,
  BspVertex,
  BspVertexIBSP,
  BspVertexFBSP,
} from "./BspLoader";
import { Q3ShaderRegistry } from "./Q3ShaderRegistry";
import type { ResolvedMaterialProps } from "./Q3ShaderTypes";

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

// Textures that should not be rendered (tool textures)
const NON_DRAWABLE_TEXTURES = [
  'common/nodraw',
  'common/clip',
  'common/caulk',
  'common/trigger',
  'common/hint',
  'common/skip',
  'common/areaportal',
  'common/clusterportal',
  'common/donotenter',
  'common/origin',
  'common/noimpact',
  'common/invisible',
  'textures/common/',
  'noshader',
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
      totalVertices: 0,
      totalTriangles: 0,
    };

    // Group faces by texture for proper material assignment
    interface TextureGroup {
      textureIndex: number;
      textureName: string;
      shaderProps: ResolvedMaterialProps;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      colors: number[];
      indices: number[];
      indexOffset: number;
    }

    const textureGroups = new Map<number, TextureGroup>();
    const shaderRegistry = Q3ShaderRegistry.getInstance();

    // Build first model only (model 0 = world geometry)
    const worldModel = this.bsp.models[0];
    if (!worldModel) {
      throw new Error('[BspMeshBuilder] No world model found');
    }

    let skippedTextures = 0;
    let skippedFaceTypes = 0;

    for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
      const face = this.bsp.faces[i];
      if (!face) continue;

      // Skip non-drawable textures
      if (!this.shouldRenderTexture(face.textureIndex)) {
        skippedTextures++;
        continue;
      }

      // Skip face types if filtering is enabled
      if (this.options.faceTypes && !this.options.faceTypes.includes(face.faceType)) {
        skippedFaceTypes++;
        continue;
      }

      // Get or create texture group
      let group = textureGroups.get(face.textureIndex);
      if (!group) {
        const textureName = this.bsp.textures[face.textureIndex]?.name || '';
        const shaderProps = shaderRegistry.resolveMaterialProps(textureName);
        
        // Debug: log transparent/special shaders
        if (shaderProps.isTransparent || shaderProps.alphaMode !== 'opaque') {
          console.log(`[BspMeshBuilder] Transparent texture: ${textureName} -> alphaMode=${shaderProps.alphaMode}, backFaceCulling=${shaderProps.backFaceCulling}`);
        }
        
        group = {
          textureIndex: face.textureIndex,
          textureName,
          shaderProps,
          positions: [],
          normals: [],
          uvs: [],
          uv2s: [],
          colors: [],
          indices: [],
          indexOffset: 0,
        };
        textureGroups.set(face.textureIndex, group);
      }

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

    console.log(`[BspMeshBuilder] Texture groups: ${opaqueGroups.length} opaque, ${transparentGroups.length} transparent`);

    // Create a parent mesh to hold all texture group meshes
    const worldMesh = new Mesh("bsp_world", this.scene);
    worldMesh.checkCollisions = true;

    // Combine all groups (opaque first, then transparent for proper sorting)
    const allGroups = [...opaqueGroups, ...transparentGroups];
    const childMeshes: Mesh[] = [];

    // Create a separate mesh for each texture group
    for (const group of allGroups) {
      if (group.indices.length === 0) continue;
      
      const meshName = `bsp_tex_${group.textureIndex}`;
      const mesh = new Mesh(meshName, this.scene);
      
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
        group.textureName
      );
      mesh.material = meshMaterial;
      
      // Store texture name in metadata for later texture loading
      mesh.metadata = { textureName: group.textureName, textureIndex: group.textureIndex };
      
      // Parent to world mesh for easy disposal
      mesh.parent = worldMesh;
      childMeshes.push(mesh);
    }

    console.log(`[BspMeshBuilder] Created ${childMeshes.length} texture group meshes`);

    // Create lightmap textures
    const lightmapTextures = this.buildLightmapTextures();

    console.log(`[BspMeshBuilder] Built world mesh: ${stats.totalVertices} vertices, ${stats.totalTriangles} triangles`);
    console.log(`[BspMeshBuilder] Face breakdown: ${stats.polygonFaces} polygons, ${stats.patchFaces} patches, ${stats.meshFaces} meshes, ${stats.billboardFaces} billboards`);
    if (skippedTextures > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedTextures} faces with non-drawable textures`);
    }
    if (skippedFaceTypes > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedFaceTypes} faces due to face type filter`);
    }

    // Collect texture group info for later loading
    const allTextureGroups = [...opaqueGroups, ...transparentGroups]
      .filter(g => g.indices.length > 0)
      .map(g => ({ textureIndex: g.textureIndex, textureName: g.textureName }));

    return {
      worldMesh,
      lightmapTextures,
      textureGroups: allTextureGroups,
      stats,
    };
  }

  /**
   * Apply textures to a rendered BSP from PK3
   * Call this after bsp render to load actual textures
   */
  public static async applyTextures(
    result: BspMeshBuildResult,
    _bsp: BspFile, // Reserved for future use
    scene: Scene,
    progressCallback?: (loaded: number, total: number, name: string) => void
  ): Promise<number> {
    const { PK3TextureLoader } = await import('./PK3TextureLoader');
    const texLoader = PK3TextureLoader.getInstance();
    const engine = scene.getEngine();
    
    // Initialize texture loader if needed
    texLoader.init(engine as any, scene);
    
    if (!result.textureGroups || result.textureGroups.length === 0) {
      console.log('[BspMeshBuilder] No texture groups to load');
      return 0;
    }

    let loadedCount = 0;
    const total = result.textureGroups.length;
    
    // Get all materials from world mesh and children
    const meshes = [result.worldMesh, ...result.worldMesh.getChildMeshes()];
    
    // Get shader registry for looking up actual texture paths
    const { Q3ShaderRegistry } = await import('./Q3ShaderRegistry');
    const shaderRegistry = Q3ShaderRegistry.getInstance();

    for (const group of result.textureGroups) {
      const texName = group.textureName;
      if (!texName || texName.toLowerCase().includes('common/')) continue;
      
      progressCallback?.(loadedCount, total, texName);
      
      // Build list of paths to try
      const pathsToTry: string[] = [];
      
      // 1. Check shader for actual texture path
      const shader = shaderRegistry.getShader(texName);
      if (shader && shader.stages.length > 0) {
        const firstStage = shader.stages[0];
        if (firstStage.map && firstStage.map !== '$lightmap' && firstStage.map !== '$whiteimage') {
          pathsToTry.push(firstStage.map);
        }
      }
      
      // 2. Try texture name as-is (for paths with slashes)
      pathsToTry.push(texName);
      
      // 3. If name has underscores but no slashes, try converting underscores to slashes
      if (texName.includes('_') && !texName.includes('/')) {
        // models_mapobjects_lamp_lamp_halo -> models/mapobjects/lamp/lamp_halo
        // But we need to be smart - not all underscores are path separators
        // Try progressively: first underscore, then second, etc.
        const parts = texName.split('_');
        if (parts.length >= 2) {
          // Try common patterns
          pathsToTry.push(parts.join('/')); // all underscores to slashes
          if (parts.length >= 3) {
            // First two segments as path: models/mapobjects/rest
            pathsToTry.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join('_')}`);
          }
          if (parts.length >= 4) {
            // First three segments as path
            pathsToTry.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join('_')}`);
          }
        }
      }
      
      // 4. If doesn't start with textures/, add that prefix to each path
      const allPaths: string[] = [];
      for (const p of pathsToTry) {
        allPaths.push(p);
        if (!p.toLowerCase().startsWith('textures/') && !p.toLowerCase().startsWith('models/')) {
          allPaths.push(`textures/${p}`);
        }
      }
      
      // Try to load texture with various extensions
      const extensions = ['.tga', '.jpg', '.png', '.ktx'];
      let texture: any = null;
      
      for (const basePath of allPaths) {
        if (texture) break;
        for (const ext of extensions) {
          texture = await texLoader.loadTexture(`${basePath}${ext}`);
          if (texture) break;
        }
      }
      
      if (texture) {
        // Find the mesh/material for this texture index (new naming: bsp_tex_)
        const meshName = `bsp_tex_${group.textureIndex}`;
        const mesh = meshes.find(m => m.name === meshName);
        
        if (mesh && mesh.material instanceof StandardMaterial) {
          mesh.material.diffuseTexture = texture;
          loadedCount++;
        }
      }
    }
    
    // Also try to apply texture to main world mesh (first opaque texture)
    // For now, just count what we loaded
    console.log(`[BspMeshBuilder] Applied ${loadedCount} textures`);
    return loadedCount;
  }

  /**
   * Create a Babylon material from resolved shader properties
   */
  private createMaterialFromShaderProps(
    name: string,
    props: ResolvedMaterialProps,
    _textureName: string // Will be used for texture loading later
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
        case 'add':
          // Additive blending (GL_ONE, GL_ONE)
          mat.alphaMode = Constants.ALPHA_ADD;
          mat.alpha = 1;
          // Make emissive for additive glow effect
          mat.emissiveColor = new Color3(1, 1, 1);
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.useAlphaFromDiffuseTexture = true;
          break;
        case 'blend':
          // Standard alpha blending
          mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
          mat.alphaMode = Constants.ALPHA_COMBINE;
          mat.alpha = 1;
          mat.useAlphaFromDiffuseTexture = true;
          break;
        case 'multiply':
          // Multiply blending
          mat.alphaMode = Constants.ALPHA_MULTIPLY;
          mat.alpha = 1;
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
    
    // Polygon offset for decals - use larger offset to prevent z-fighting
    if (props.polygonOffset) {
      mat.zOffset = -2;
      // Also slightly reduce depth for decals
      mat.separateCullingPass = true;
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
      console.warn(`[BspMeshBuilder] Skipping patch with invalid size: ${width}x${height}`);
      return { positions, normals, uvs, uv2s, colors, indices };
    }
    
    console.log(`[BspMeshBuilder] Building patch: ${width}x${height} control points`);

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
    // Patches are stored as overlapping 3x3 grids: width=3 means 1 patch, width=5 means 2, etc.
    const numPatchesX = Math.floor((width - 1) / 2);
    const numPatchesY = Math.floor((height - 1) / 2);
    
    if (numPatchesX <= 0 || numPatchesY <= 0) {
      console.warn(`[BspMeshBuilder] Invalid patch size: ${width}x${height}`);
      return { positions, normals, uvs, uv2s, colors, indices };
    }

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
