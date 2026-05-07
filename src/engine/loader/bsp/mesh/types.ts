import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { BspFile } from "../BspLoader";

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
    /** Editor image (qer_editorimage) - fallback when cubemap and stage textures are missing */
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
    isAutosprite2: boolean;
    // Normalized offsets for each vertex: [rightFrac, upFrac] where -1 to 1 maps to -halfWidth/halfHeight to +halfWidth/halfHeight
    vertexOffsets: [number, number][];
  }[];
}

export interface BuildOptions {
  /** Only render specific face types (1=polygon, 2=patch, 3=mesh) */
  faceTypes?: number[];
  /** Skip non-drawable textures */
  filterTextures?: boolean;
  /** Resolve Warsow/QFusion deluxe shader branches for this build */
  deluxe?: boolean;
}

export interface FaceGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  uv2s: number[];
  colors: number[];
  indices: number[];
}
