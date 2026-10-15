/**
 * BspLoader - Load Quake 3 IBSP and Warsow FBSP binary map files
 *
 * Supports:
 * - IBSP v46 (Quake 3)
 * - FBSP v1 (Warsow/qfusion) - primary target
 *
 * FBSP differences from IBSP:
 * - Authored lightmap dimensions, defaulting to 512x512 (vs 128x128)
 * - Up to 4 lightmaps per surface (lightstyles)
 * - RBSP-style vertex format
 */

// ============================================================================
// BSP Format Constants
// ============================================================================

const BSP_MAGIC_IBSP = 0x50534249; // "IBSP" little-endian
const BSP_MAGIC_FBSP = 0x50534246; // "FBSP" little-endian

const IBSP_VERSION = 46;
const FBSP_VERSION = 1;

// Lump indices (same for IBSP and FBSP)
enum LumpIndex {
  ENTITIES = 0,
  TEXTURES = 1,
  PLANES = 2,
  NODES = 3,
  LEAFS = 4,
  LEAFFACES = 5,
  LEAFBRUSHES = 6,
  MODELS = 7,
  BRUSHES = 8,
  BRUSHSIDES = 9,
  VERTICES = 10,
  MESHVERTS = 11,
  EFFECTS = 12,
  FACES = 13,
  LIGHTMAPS = 14,
  LIGHTVOLS = 15,
  VISDATA = 16,
  LIGHTARRAY = 17,
}

const LUMP_COUNT = 17;

// Face types
enum FaceType {
  POLYGON = 1, // Regular polygon
  PATCH = 2, // Bezier patch
  MESH = 3, // Triangle mesh (misc_model)
  BILLBOARD = 4, // Flare/sprite
}

// Lightmap dimensions
const IBSP_LIGHTMAP_SIZE = 128;
const FBSP_LIGHTMAP_SIZE = 512;

// Max lightmaps per surface (FBSP supports lightstyles)
export const MAX_LIGHTMAPS = 4;

// ============================================================================
// BSP Data Structures
// ============================================================================

export interface BspHeader {
  magic: number;
  version: number;
  isFBSP: boolean;
}

export interface BspLump {
  offset: number;
  length: number;
}

export interface BspTexture {
  name: string;
  surfaceFlags: number;
  contentFlags: number;
}

export interface BspPlane {
  normal: [number, number, number];
  dist: number;
}

export interface BspNode {
  planeIndex: number;
  children: [number, number]; // negative = -(leaf+1)
  mins: [number, number, number];
  maxs: [number, number, number];
}

export interface BspLeaf {
  cluster: number;
  area: number;
  mins: [number, number, number];
  maxs: [number, number, number];
  firstLeafFace: number;
  numLeafFaces: number;
  firstLeafBrush: number;
  numLeafBrushes: number;
}

export interface BspModel {
  mins: [number, number, number];
  maxs: [number, number, number];
  firstFace: number;
  numFaces: number;
  firstBrush: number;
  numBrushes: number;
}

export interface BspBrush {
  firstSide: number;
  numSides: number;
  shaderIndex: number;
}

export interface BspBrushSide {
  planeIndex: number;
  shaderIndex: number;
  surfaceNum?: number;
}

/** IBSP vertex (Q3 format) - 44 bytes */
export interface BspVertexIBSP {
  position: [number, number, number];
  texCoord: [number, number];
  lightmapCoord: [number, number];
  normal: [number, number, number];
  color: [number, number, number, number];
}

/** FBSP vertex (RBSP format) - 68 bytes with 4 lightmap slots */
export interface BspVertexFBSP {
  position: [number, number, number];
  texCoord: [number, number];
  lightmapCoords: [[number, number], [number, number], [number, number], [number, number]];
  normal: [number, number, number];
  colors: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ];
}

export type BspVertex = BspVertexIBSP | BspVertexFBSP;

export interface BspFace {
  textureIndex: number;
  effectIndex: number;
  faceType: FaceType;
  firstVertex: number;
  numVertices: number;
  firstMeshVert: number;
  numMeshVerts: number;
  lightmapIndex: number; // IBSP: single lightmap, FBSP: first of up to 4
  lightmapIndices?: [number, number, number, number]; // FBSP only
  lightmapStart: [number, number];
  lightmapSize: [number, number];
  lightmapOrigin: [number, number, number];
  lightmapVecs: [[number, number, number], [number, number, number]];
  normal: [number, number, number];
  patchSize: [number, number]; // For FaceType.PATCH
}

export interface BspEffect {
  name: string;
  brushIndex: number;
  unknown: number;
}

export interface BspVisData {
  numClusters: number;
  bytesPerCluster: number;
  bitVectors: Uint8Array;
}

export interface BspLightVol {
  /** Unreachable compressed-grid sites are excluded from interpolation. */
  valid?: boolean;
  ambient: [number, number, number];
  directional: [number, number, number];
  direction: [number, number]; // phi, theta
}

/** Parsed entity from the entities lump */
export interface BspEntity {
  classname: string;
  properties: Record<string, string>;
}

// ============================================================================
// Main BSP File Structure
// ============================================================================

export interface BspFile {
  header: BspHeader;
  lumps: BspLump[];

  // Parsed lump data
  entities: BspEntity[];
  textures: BspTexture[];
  planes: BspPlane[];
  nodes: BspNode[];
  leafs: BspLeaf[];
  leafFaces: number[];
  leafBrushes: number[];
  models: BspModel[];
  brushes: BspBrush[];
  brushSides: BspBrushSide[];
  vertices: BspVertex[];
  meshVerts: number[];
  effects: BspEffect[];
  faces: BspFace[];
  lightmaps: Uint8Array[]; // Raw RGB data, size depends on format
  lightVols: BspLightVol[];
  visData: BspVisData | null;

  // Metadata
  lightmapSize: number; // IBSP: 128; FBSP: authored size or 512

  // LightGrid Metadata (for model lighting)
  lightGridOrigin?: [number, number, number];
  lightGridSize?: [number, number, number];
  lightGridStep?: [number, number, number];
}

// ============================================================================
// BspLoader Class
// ============================================================================

export class BspLoader {
  private data: DataView;
  private isFBSP: boolean = false;
  private lumps: BspLump[] = [];

  private constructor(buffer: ArrayBuffer) {
    this.data = new DataView(buffer);
  }

  /**
   * Load and parse a BSP file from ArrayBuffer
   */
  public static load(buffer: ArrayBuffer): BspFile {
    const loader = new BspLoader(buffer);
    return loader.parse();
  }

  /**
   * Load BSP from PK3Loader by path
   */
  public static async loadFromPK3(
    pk3Loader: { getFile(path: string): Promise<ArrayBuffer | null> },
    path: string,
  ): Promise<BspFile | null> {
    const buffer = await pk3Loader.getFile(path);
    if (!buffer) {
      console.error(`[BspLoader] File not found: ${path}`);
      return null;
    }
    return BspLoader.load(buffer);
  }

  private parse(): BspFile {
    const header = this.readHeader();
    this.lumps = this.readLumpDirectory();

    console.log(`[BspLoader] Parsing ${header.isFBSP ? "FBSP" : "IBSP"} v${header.version}`);

    // Parse all lumps into local variables
    const entities = this.parseEntities();
    const lightmapSize = this.resolveLightmapSize(header.isFBSP, entities);
    const textures = this.parseTextures();
    const planes = this.parsePlanes();
    const nodes = this.parseNodes();
    const leafs = this.parseLeafs();
    const leafFaces = this.parseLeafFaces();
    const leafBrushes = this.parseLeafBrushes();
    const models = this.parseModels();
    const brushes = this.parseBrushes();
    const brushSides = this.parseBrushSides();
    const vertices = this.parseVertices();
    const meshVerts = this.parseMeshVerts();
    const effects = this.parseEffects();
    const faces = this.parseFaces();
    const lightmaps = this.parseLightmaps(lightmapSize);
    const lightVols = this.parseLightVols();
    const visData = this.parseVisData();

    // Calculate Grid parameters
    const { lightGridOrigin, lightGridSize, lightGridStep } = this.calculateLightGrid(
      entities,
      models,
      lightVols.length,
    );

    return {
      header,
      lumps: this.lumps,
      entities,
      textures,
      planes,
      nodes,
      leafs,
      leafFaces,
      leafBrushes,
      models,
      brushes,
      brushSides,
      vertices,
      meshVerts,
      effects,
      faces,
      lightmaps,
      lightVols,
      visData,
      lightmapSize,
      lightGridOrigin,
      lightGridSize,
      lightGridStep,
    };
  }

  private calculateLightGrid(entities: BspEntity[], models: BspModel[], lightVolCount: number): Partial<BspFile> {
    const worldModel = models[0];
    if (!worldModel) return {};

    const worldspawn = entities.find((e) => e.classname === "worldspawn");

    // Default gridsize for Quake 3 is 64 64 128
    let gridsize: [number, number, number] = [64, 64, 128];
    if (worldspawn?.properties.gridsize) {
      const parts = worldspawn.properties.gridsize.split(/\s+/).map(parseFloat);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 1)) {
        gridsize = [parts[0], parts[1], parts[2]];
      }
    }

    // Calculate grid dimensions
    // Sample sites are inside the unpadded BSP bounds, as in Qfusion.
    const origin: [number, number, number] = [
      Math.ceil(worldModel.mins[0] / gridsize[0]) * gridsize[0],
      Math.ceil(worldModel.mins[1] / gridsize[1]) * gridsize[1],
      Math.ceil(worldModel.mins[2] / gridsize[2]) * gridsize[2],
    ];

    const maxs: [number, number, number] = [
      Math.floor(worldModel.maxs[0] / gridsize[0]) * gridsize[0],
      Math.floor(worldModel.maxs[1] / gridsize[1]) * gridsize[1],
      Math.floor(worldModel.maxs[2] / gridsize[2]) * gridsize[2],
    ];

    // Base float dimensions
    const baseSize: [number, number, number] = [
      (maxs[0] - origin[0]) / gridsize[0],
      (maxs[1] - origin[1]) / gridsize[1],
      (maxs[2] - origin[2]) / gridsize[2],
    ];

    // Calculate size using naive approach
    const size: [number, number, number] = [
      Math.max(0, Math.floor(baseSize[0])) + 1,
      Math.max(0, Math.floor(baseSize[1])) + 1,
      Math.max(0, Math.floor(baseSize[2])) + 1,
    ];

    const predictedCount = size[0] * size[1] * size[2];
    const actualCount = lightVolCount;

    console.log(
      `[BspLoader] LightGrid: origin=(${origin.join(",")}) size=(${size.join(",")}) step=(${gridsize.join(",")})`,
    );
    console.log(`[BspLoader] LightGrid Counts: Predicted=${predictedCount}, Actual=${actualCount}`);

    if (predictedCount !== actualCount) {
      console.warn(
        `[BspLoader] LightGrid dimension mismatch! The map bounds imply ${predictedCount} vols, but lump has ${actualCount}. Lighting will be aligned incorrectly.`,
      );
    }

    return {
      lightGridOrigin: origin,
      lightGridSize: size,
      lightGridStep: gridsize,
    };
  }

  // ============================================================================
  // Header & Lump Directory
  // ============================================================================

  private readHeader(): BspHeader {
    const magic = this.data.getUint32(0, true);
    const version = this.data.getInt32(4, true);

    let isFBSP = false;

    if (magic === BSP_MAGIC_FBSP) {
      isFBSP = true;
      this.isFBSP = true;
      if (version !== FBSP_VERSION) {
        console.warn(`[BspLoader] Unexpected FBSP version: ${version} (expected ${FBSP_VERSION})`);
      }
    } else if (magic === BSP_MAGIC_IBSP) {
      if (version !== IBSP_VERSION) {
        console.warn(`[BspLoader] Unexpected IBSP version: ${version} (expected ${IBSP_VERSION})`);
      }
    } else {
      const magicStr = String.fromCharCode(
        magic & 0xff,
        (magic >> 8) & 0xff,
        (magic >> 16) & 0xff,
        (magic >> 24) & 0xff,
      );
      throw new Error(`[BspLoader] Invalid BSP magic: 0x${magic.toString(16)} ("${magicStr}")`);
    }

    return { magic, version, isFBSP };
  }

  private readLumpDirectory(): BspLump[] {
    const lumps: BspLump[] = [];
    let offset = 8; // After header

    for (let i = 0; i < LUMP_COUNT + (this.isFBSP ? 1 : 0); i++) {
      const lumpOffset = this.data.getInt32(offset, true);
      const lumpLength = this.data.getInt32(offset + 4, true);
      lumps.push({ offset: lumpOffset, length: lumpLength });
      offset += 8;
    }

    return lumps;
  }

  private getLump(index: LumpIndex): { offset: number; length: number; data: DataView } {
    const lump = this.lumps[index];
    return {
      offset: lump.offset,
      length: lump.length,
      data: new DataView(this.data.buffer, lump.offset, lump.length),
    };
  }

  // ============================================================================
  // Lump Parsers
  // ============================================================================

  private parseEntities(): BspEntity[] {
    const lump = this.getLump(LumpIndex.ENTITIES);
    const decoder = new TextDecoder("utf-8");
    const bytes = new Uint8Array(this.data.buffer, lump.offset, lump.length);

    // Remove null terminator if present
    let text = decoder.decode(bytes);
    if (text.endsWith("\0")) {
      text = text.slice(0, -1);
    }

    return this.parseEntityString(text);
  }

  private parseEntityString(text: string): BspEntity[] {
    const entities: BspEntity[] = [];
    let current: BspEntity | null = null;

    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "{") {
        current = { classname: "", properties: {} };
      } else if (trimmed === "}") {
        if (current) {
          entities.push(current);
          current = null;
        }
      } else if (current) {
        // Parse "key" "value"
        const match = trimmed.match(/"([^"]+)"\s+"([^"]*)"/);
        if (match) {
          const [, key, value] = match;
          current.properties[key] = value;
          if (key === "classname") {
            current.classname = value;
          }
        }
      }
    }

    return entities;
  }

  private parseTextures(): BspTexture[] {
    const lump = this.getLump(LumpIndex.TEXTURES);
    const TEXTURE_SIZE = 72; // 64 bytes name + 4 flags + 4 contents
    const count = Math.floor(lump.length / TEXTURE_SIZE);
    const textures: BspTexture[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * TEXTURE_SIZE;

      // Read null-terminated string (64 bytes max)
      const nameBytes = new Uint8Array(this.data.buffer, lump.offset + offset, 64);
      let nameEnd = nameBytes.indexOf(0);
      if (nameEnd === -1) nameEnd = 64;
      const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd));

      const surfaceFlags = lump.data.getInt32(offset + 64, true);
      const contentFlags = lump.data.getInt32(offset + 68, true);

      textures.push({ name, surfaceFlags, contentFlags });
    }

    return textures;
  }

  private parsePlanes(): BspPlane[] {
    const lump = this.getLump(LumpIndex.PLANES);
    const PLANE_SIZE = 16; // 3 floats normal + 1 float dist
    const count = Math.floor(lump.length / PLANE_SIZE);
    const planes: BspPlane[] = [];

    // Q3 NORMAL_EPSILON: snap near-zero normal components to exactly 0.
    // Without this, floating-point noise in BSP normals (e.g. 0.0000001 instead of 0)
    // causes traceBrush to select the wrong AABB corner for distance calculation,
    // leading to false collisions and player stuckage on brush edges.
    const NORMAL_EPSILON = 0.00001;

    for (let i = 0; i < count; i++) {
      const offset = i * PLANE_SIZE;
      const normal: [number, number, number] = [
        lump.data.getFloat32(offset, true),
        lump.data.getFloat32(offset + 4, true),
        lump.data.getFloat32(offset + 8, true),
      ];

      // Snap near-zero components to exactly 0 (Q3 CM_SnapVector)
      for (let j = 0; j < 3; j++) {
        if (Math.abs(normal[j]) < NORMAL_EPSILON) {
          normal[j] = 0;
        }
      }

      planes.push({
        normal,
        dist: lump.data.getFloat32(offset + 12, true),
      });
    }

    return planes;
  }

  private parseNodes(): BspNode[] {
    const lump = this.getLump(LumpIndex.NODES);
    const NODE_SIZE = 36;
    const count = Math.floor(lump.length / NODE_SIZE);
    const nodes: BspNode[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * NODE_SIZE;
      nodes.push({
        planeIndex: lump.data.getInt32(offset, true),
        children: [lump.data.getInt32(offset + 4, true), lump.data.getInt32(offset + 8, true)],
        mins: [
          lump.data.getInt32(offset + 12, true),
          lump.data.getInt32(offset + 16, true),
          lump.data.getInt32(offset + 20, true),
        ],
        maxs: [
          lump.data.getInt32(offset + 24, true),
          lump.data.getInt32(offset + 28, true),
          lump.data.getInt32(offset + 32, true),
        ],
      });
    }

    return nodes;
  }

  private parseLeafs(): BspLeaf[] {
    const lump = this.getLump(LumpIndex.LEAFS);
    const LEAF_SIZE = 48;
    const count = Math.floor(lump.length / LEAF_SIZE);
    const leafs: BspLeaf[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * LEAF_SIZE;
      leafs.push({
        cluster: lump.data.getInt32(offset, true),
        area: lump.data.getInt32(offset + 4, true),
        mins: [
          lump.data.getInt32(offset + 8, true),
          lump.data.getInt32(offset + 12, true),
          lump.data.getInt32(offset + 16, true),
        ],
        maxs: [
          lump.data.getInt32(offset + 20, true),
          lump.data.getInt32(offset + 24, true),
          lump.data.getInt32(offset + 28, true),
        ],
        firstLeafFace: lump.data.getInt32(offset + 32, true),
        numLeafFaces: lump.data.getInt32(offset + 36, true),
        firstLeafBrush: lump.data.getInt32(offset + 40, true),
        numLeafBrushes: lump.data.getInt32(offset + 44, true),
      });
    }

    return leafs;
  }

  private parseLeafFaces(): number[] {
    const lump = this.getLump(LumpIndex.LEAFFACES);
    const count = Math.floor(lump.length / 4);
    const leafFaces: number[] = [];

    for (let i = 0; i < count; i++) {
      leafFaces.push(lump.data.getInt32(i * 4, true));
    }

    return leafFaces;
  }

  private parseLeafBrushes(): number[] {
    const lump = this.getLump(LumpIndex.LEAFBRUSHES);
    const count = Math.floor(lump.length / 4);
    const leafBrushes: number[] = [];

    for (let i = 0; i < count; i++) {
      leafBrushes.push(lump.data.getInt32(i * 4, true));
    }

    return leafBrushes;
  }

  private parseModels(): BspModel[] {
    const lump = this.getLump(LumpIndex.MODELS);
    const MODEL_SIZE = 40;
    const count = Math.floor(lump.length / MODEL_SIZE);
    const models: BspModel[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * MODEL_SIZE;
      models.push({
        mins: [
          lump.data.getFloat32(offset, true),
          lump.data.getFloat32(offset + 4, true),
          lump.data.getFloat32(offset + 8, true),
        ],
        maxs: [
          lump.data.getFloat32(offset + 12, true),
          lump.data.getFloat32(offset + 16, true),
          lump.data.getFloat32(offset + 20, true),
        ],
        firstFace: lump.data.getInt32(offset + 24, true),
        numFaces: lump.data.getInt32(offset + 28, true),
        firstBrush: lump.data.getInt32(offset + 32, true),
        numBrushes: lump.data.getInt32(offset + 36, true),
      });
    }

    return models;
  }

  private parseBrushes(): BspBrush[] {
    const lump = this.getLump(LumpIndex.BRUSHES);
    const BRUSH_SIZE = 12;
    const count = Math.floor(lump.length / BRUSH_SIZE);
    const brushes: BspBrush[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * BRUSH_SIZE;
      brushes.push({
        firstSide: lump.data.getInt32(offset, true),
        numSides: lump.data.getInt32(offset + 4, true),
        shaderIndex: lump.data.getInt32(offset + 8, true),
      });
    }

    return brushes;
  }

  private parseBrushSides(): BspBrushSide[] {
    const lump = this.getLump(LumpIndex.BRUSHSIDES);
    const SIDE_SIZE = this.isFBSP ? 12 : 8;
    const count = Math.floor(lump.length / SIDE_SIZE);
    const sides: BspBrushSide[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * SIDE_SIZE;
      const planeIndex = lump.data.getInt32(offset, true);
      const shaderIndex = lump.data.getInt32(offset + 4, true);
      if (this.isFBSP) {
        const surfaceNum = lump.data.getInt32(offset + 8, true);
        sides.push({ planeIndex, shaderIndex, surfaceNum });
      } else {
        sides.push({ planeIndex, shaderIndex });
      }
    }

    return sides;
  }

  private parseVertices(): BspVertex[] {
    const lump = this.getLump(LumpIndex.VERTICES);

    if (this.isFBSP) {
      return this.parseVerticesFBSP(lump);
    } else {
      return this.parseVerticesIBSP(lump);
    }
  }

  private parseVerticesIBSP(lump: { offset: number; length: number; data: DataView }): BspVertexIBSP[] {
    const VERTEX_SIZE = 44;
    const count = Math.floor(lump.length / VERTEX_SIZE);
    const vertices: BspVertexIBSP[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * VERTEX_SIZE;
      vertices.push({
        position: [
          lump.data.getFloat32(offset, true),
          lump.data.getFloat32(offset + 4, true),
          lump.data.getFloat32(offset + 8, true),
        ],
        texCoord: [lump.data.getFloat32(offset + 12, true), lump.data.getFloat32(offset + 16, true)],
        lightmapCoord: [lump.data.getFloat32(offset + 20, true), lump.data.getFloat32(offset + 24, true)],
        normal: [
          lump.data.getFloat32(offset + 28, true),
          lump.data.getFloat32(offset + 32, true),
          lump.data.getFloat32(offset + 36, true),
        ],
        color: [
          lump.data.getUint8(offset + 40),
          lump.data.getUint8(offset + 41),
          lump.data.getUint8(offset + 42),
          lump.data.getUint8(offset + 43),
        ],
      });
    }

    return vertices;
  }

  private parseVerticesFBSP(lump: { offset: number; length: number; data: DataView }): BspVertexFBSP[] {
    // FBSP/RBSP vertex: position(12) + texCoord(8) + 4×lightmapCoord(32) + normal(12) + 4×color(16) = 80 bytes
    const VERTEX_SIZE = 80;
    const count = Math.floor(lump.length / VERTEX_SIZE);
    const vertices: BspVertexFBSP[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * VERTEX_SIZE;

      // Position (12 bytes)
      const position: [number, number, number] = [
        lump.data.getFloat32(offset, true),
        lump.data.getFloat32(offset + 4, true),
        lump.data.getFloat32(offset + 8, true),
      ];

      // Texture coord (8 bytes)
      const texCoord: [number, number] = [
        lump.data.getFloat32(offset + 12, true),
        lump.data.getFloat32(offset + 16, true),
      ];

      // 4 lightmap coords (32 bytes)
      const lightmapCoords: [[number, number], [number, number], [number, number], [number, number]] = [
        [lump.data.getFloat32(offset + 20, true), lump.data.getFloat32(offset + 24, true)],
        [lump.data.getFloat32(offset + 28, true), lump.data.getFloat32(offset + 32, true)],
        [lump.data.getFloat32(offset + 36, true), lump.data.getFloat32(offset + 40, true)],
        [lump.data.getFloat32(offset + 44, true), lump.data.getFloat32(offset + 48, true)],
      ];

      // Normal (12 bytes)
      const normal: [number, number, number] = [
        lump.data.getFloat32(offset + 52, true),
        lump.data.getFloat32(offset + 56, true),
        lump.data.getFloat32(offset + 60, true),
      ];

      // 4 colors (16 bytes)
      const colors: [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
      ] = [
        [
          lump.data.getUint8(offset + 64),
          lump.data.getUint8(offset + 65),
          lump.data.getUint8(offset + 66),
          lump.data.getUint8(offset + 67),
        ],
        [
          lump.data.getUint8(offset + 68),
          lump.data.getUint8(offset + 69),
          lump.data.getUint8(offset + 70),
          lump.data.getUint8(offset + 71),
        ],
        [
          lump.data.getUint8(offset + 72),
          lump.data.getUint8(offset + 73),
          lump.data.getUint8(offset + 74),
          lump.data.getUint8(offset + 75),
        ],
        [
          lump.data.getUint8(offset + 76),
          lump.data.getUint8(offset + 77),
          lump.data.getUint8(offset + 78),
          lump.data.getUint8(offset + 79),
        ],
      ];

      vertices.push({ position, texCoord, lightmapCoords, normal, colors });
    }

    return vertices;
  }

  private parseMeshVerts(): number[] {
    const lump = this.getLump(LumpIndex.MESHVERTS);
    const count = Math.floor(lump.length / 4);
    const meshVerts: number[] = [];

    for (let i = 0; i < count; i++) {
      meshVerts.push(lump.data.getInt32(i * 4, true));
    }

    return meshVerts;
  }

  private parseEffects(): BspEffect[] {
    const lump = this.getLump(LumpIndex.EFFECTS);
    const EFFECT_SIZE = 72;
    const count = Math.floor(lump.length / EFFECT_SIZE);
    const effects: BspEffect[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * EFFECT_SIZE;

      // Name is 64 bytes null-terminated
      const nameBytes = new Uint8Array(this.data.buffer, lump.offset + offset, 64);
      let nameEnd = nameBytes.indexOf(0);
      if (nameEnd === -1) nameEnd = 64;
      const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd));

      effects.push({
        name,
        brushIndex: lump.data.getInt32(offset + 64, true),
        unknown: lump.data.getInt32(offset + 68, true),
      });
    }

    return effects;
  }

  private parseFaces(): BspFace[] {
    const lump = this.getLump(LumpIndex.FACES);

    if (this.isFBSP) {
      return this.parseFacesFBSP(lump);
    } else {
      return this.parseFacesIBSP(lump);
    }
  }

  private parseFacesIBSP(lump: { offset: number; length: number; data: DataView }): BspFace[] {
    const FACE_SIZE = 104;
    const count = Math.floor(lump.length / FACE_SIZE);
    const faces: BspFace[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * FACE_SIZE;
      faces.push({
        textureIndex: lump.data.getInt32(offset, true),
        effectIndex: lump.data.getInt32(offset + 4, true),
        faceType: lump.data.getInt32(offset + 8, true) as FaceType,
        firstVertex: lump.data.getInt32(offset + 12, true),
        numVertices: lump.data.getInt32(offset + 16, true),
        firstMeshVert: lump.data.getInt32(offset + 20, true),
        numMeshVerts: lump.data.getInt32(offset + 24, true),
        lightmapIndex: lump.data.getInt32(offset + 28, true),
        lightmapStart: [lump.data.getInt32(offset + 32, true), lump.data.getInt32(offset + 36, true)],
        lightmapSize: [lump.data.getInt32(offset + 40, true), lump.data.getInt32(offset + 44, true)],
        lightmapOrigin: [
          lump.data.getFloat32(offset + 48, true),
          lump.data.getFloat32(offset + 52, true),
          lump.data.getFloat32(offset + 56, true),
        ],
        lightmapVecs: [
          [
            lump.data.getFloat32(offset + 60, true),
            lump.data.getFloat32(offset + 64, true),
            lump.data.getFloat32(offset + 68, true),
          ],
          [
            lump.data.getFloat32(offset + 72, true),
            lump.data.getFloat32(offset + 76, true),
            lump.data.getFloat32(offset + 80, true),
          ],
        ],
        normal: [
          lump.data.getFloat32(offset + 84, true),
          lump.data.getFloat32(offset + 88, true),
          lump.data.getFloat32(offset + 92, true),
        ],
        patchSize: [lump.data.getInt32(offset + 96, true), lump.data.getInt32(offset + 100, true)],
      });
    }

    return faces;
  }

  private parseFacesFBSP(lump: { offset: number; length: number; data: DataView }): BspFace[] {
    // RBSP/FBSP face structure (148 bytes):
    // - textureIndex: 0 (4)
    // - effectIndex: 4 (4)
    // - faceType: 8 (4)
    // - firstVertex: 12 (4)
    // - numVertices: 16 (4)
    // - firstMeshVert: 20 (4)
    // - numMeshVerts: 24 (4)
    // - lightmapStyles[4]: 28 (4 bytes as uint8)
    // - vertexStyles[4]: 32 (4 bytes as uint8)
    // - lightmapNum[4]: 36 (16)
    // - lightmapX[4]: 52 (16)
    // - lightmapY[4]: 68 (16)
    // - lightmapWidth: 84 (4)
    // - lightmapHeight: 88 (4)
    // - lightmapOrigin: 92 (12)
    // - lightmapVecs[2]: 104 (24)
    // - normal: 128 (12)
    // - patchWidth: 140 (4)
    // - patchHeight: 144 (4)
    // Total: 148 bytes
    const FACE_SIZE = 148;
    const count = Math.floor(lump.length / FACE_SIZE);
    const faces: BspFace[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * FACE_SIZE;

      // 4 lightmap indices at offset 36
      const lightmapIndices: [number, number, number, number] = [
        lump.data.getInt32(offset + 36, true),
        lump.data.getInt32(offset + 40, true),
        lump.data.getInt32(offset + 44, true),
        lump.data.getInt32(offset + 48, true),
      ];

      faces.push({
        textureIndex: lump.data.getInt32(offset, true),
        effectIndex: lump.data.getInt32(offset + 4, true),
        faceType: lump.data.getInt32(offset + 8, true) as FaceType,
        firstVertex: lump.data.getInt32(offset + 12, true),
        numVertices: lump.data.getInt32(offset + 16, true),
        firstMeshVert: lump.data.getInt32(offset + 20, true),
        numMeshVerts: lump.data.getInt32(offset + 24, true),
        lightmapIndex: lightmapIndices[0],
        lightmapIndices,
        // lightmapX[0] and lightmapY[0] for lightmapStart
        lightmapStart: [lump.data.getInt32(offset + 52, true), lump.data.getInt32(offset + 68, true)],
        // lightmapWidth and lightmapHeight for lightmapSize
        lightmapSize: [lump.data.getInt32(offset + 84, true), lump.data.getInt32(offset + 88, true)],
        lightmapOrigin: [
          lump.data.getFloat32(offset + 92, true),
          lump.data.getFloat32(offset + 96, true),
          lump.data.getFloat32(offset + 100, true),
        ],
        lightmapVecs: [
          [
            lump.data.getFloat32(offset + 104, true),
            lump.data.getFloat32(offset + 108, true),
            lump.data.getFloat32(offset + 112, true),
          ],
          [
            lump.data.getFloat32(offset + 116, true),
            lump.data.getFloat32(offset + 120, true),
            lump.data.getFloat32(offset + 124, true),
          ],
        ],
        normal: [
          lump.data.getFloat32(offset + 128, true),
          lump.data.getFloat32(offset + 132, true),
          lump.data.getFloat32(offset + 136, true),
        ],
        patchSize: [lump.data.getInt32(offset + 140, true), lump.data.getInt32(offset + 144, true)],
      });
    }

    return faces;
  }

  private resolveLightmapSize(isFBSP: boolean, entities: BspEntity[]): number {
    if (!isFBSP) return IBSP_LIGHTMAP_SIZE;
    const worldspawn = entities.find((entity) => entity.classname === "worldspawn");
    const declaration = Object.entries(worldspawn?.properties ?? {}).find(
      ([key]) => key.toLowerCase() === "_lightmapimagesize",
    );
    if (!declaration) return FBSP_LIGHTMAP_SIZE;
    const size = Number(declaration[1]);
    if (!Number.isSafeInteger(size) || size <= 0 || !Number.isInteger(Math.log2(size))) {
      throw new Error(`[BspLoader] Invalid _lightmapImageSize: ${declaration[1]}`);
    }
    if (!Number.isSafeInteger(size * size * 3)) {
      throw new Error(`[BspLoader] _lightmapImageSize is too large: ${size}`);
    }
    return size;
  }

  private parseLightmaps(lightmapSize: number): Uint8Array[] {
    const lump = this.getLump(LumpIndex.LIGHTMAPS);
    const LIGHTMAP_BYTES = lightmapSize * lightmapSize * 3; // RGB
    if (lump.length % LIGHTMAP_BYTES !== 0) {
      throw new Error(
        `[BspLoader] Lightmap lump (${lump.length} bytes) does not contain complete ${lightmapSize}x${lightmapSize} RGB pages`,
      );
    }
    const count = Math.floor(lump.length / LIGHTMAP_BYTES);
    const lightmaps: Uint8Array[] = [];

    for (let i = 0; i < count; i++) {
      const offset = lump.offset + i * LIGHTMAP_BYTES;
      lightmaps.push(new Uint8Array(this.data.buffer, offset, LIGHTMAP_BYTES));
    }

    console.log(`[BspLoader] Loaded ${count} lightmaps (${lightmapSize}x${lightmapSize})`);

    return lightmaps;
  }

  private parseLightVols(): BspLightVol[] {
    const lump = this.getLump(LumpIndex.LIGHTVOLS);

    if (this.isFBSP) {
      if (lump.length % 30 !== 0) throw new Error("[BspLoader] Invalid FBSP lightgrid record size");
      const records: BspLightVol[] = [];
      for (let offset = 0; offset < lump.length; offset += 30) {
        const ambient: [number, number, number] = [0, 0, 0];
        const directional: [number, number, number] = [0, 0, 0];
        for (let style = 0; style < 4; style++) {
          if (lump.data.getUint8(offset + 24 + style) === 255) continue;
          for (let channel = 0; channel < 3; channel++) {
            ambient[channel] += lump.data.getUint8(offset + style * 3 + channel);
            directional[channel] += lump.data.getUint8(offset + 12 + style * 3 + channel);
          }
        }
        records.push({
          ambient,
          directional,
          direction: [lump.data.getUint8(offset + 28), lump.data.getUint8(offset + 29)],
        });
      }
      const array = this.getLump(LumpIndex.LIGHTARRAY);
      if (array.length % 2 !== 0) throw new Error("[BspLoader] Invalid FBSP lightarray size");
      const sites: BspLightVol[] = [];
      const invalid: BspLightVol = { valid: false, ambient: [0, 0, 0], directional: [0, 0, 0], direction: [0, 0] };
      for (let offset = 0; offset < array.length; offset += 2) {
        const index = array.data.getUint16(offset, true);
        if (index === 0xffff) sites.push(invalid);
        else if (index < records.length) sites.push(records[index]);
        else throw new Error(`[BspLoader] FBSP lightarray index ${index} exceeds ${records.length} records`);
      }
      return sites;
    }

    const LIGHTVOL_SIZE = 8;
    const count = Math.floor(lump.length / LIGHTVOL_SIZE);
    const lightVols: BspLightVol[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * LIGHTVOL_SIZE;
      lightVols.push({
        ambient: [lump.data.getUint8(offset), lump.data.getUint8(offset + 1), lump.data.getUint8(offset + 2)],
        directional: [lump.data.getUint8(offset + 3), lump.data.getUint8(offset + 4), lump.data.getUint8(offset + 5)],
        direction: [lump.data.getUint8(offset + 6), lump.data.getUint8(offset + 7)],
      });
    }

    return lightVols;
  }

  private parseVisData(): BspVisData | null {
    const lump = this.getLump(LumpIndex.VISDATA);

    if (lump.length === 0) {
      return null;
    }

    const numClusters = lump.data.getInt32(0, true);
    const bytesPerCluster = lump.data.getInt32(4, true);
    const bitVectors = new Uint8Array(this.data.buffer, lump.offset + 8, numClusters * bytesPerCluster);

    console.log(`[BspLoader] Loaded PVS: ${numClusters} clusters, ${bytesPerCluster} bytes/cluster`);

    return { numClusters, bytesPerCluster, bitVectors };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if cluster B is visible from cluster A using PVS data
 */
export function isClusterVisible(visData: BspVisData | null, clusterA: number, clusterB: number): boolean {
  if (!visData || clusterA < 0 || clusterB < 0) {
    return true; // No PVS or invalid cluster = assume visible
  }

  const byteIndex = clusterA * visData.bytesPerCluster + Math.floor(clusterB / 8);
  const bitIndex = clusterB % 8;

  return (visData.bitVectors[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Find which leaf a point is in using BSP tree traversal
 */
export function findLeafForPoint(
  point: [number, number, number],
  nodes: BspNode[],
  leafs: BspLeaf[],
  planes: BspPlane[],
): BspLeaf | null {
  if (nodes.length === 0) return null;

  let nodeIndex = 0;

  while (nodeIndex >= 0) {
    const node = nodes[nodeIndex];
    const plane = planes[node.planeIndex];

    // Calculate distance from point to plane
    const dist = plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] - plane.dist;

    // Choose child based on which side of plane
    nodeIndex = dist >= 0 ? node.children[0] : node.children[1];
  }

  // Negative index means leaf: -(leafIndex + 1)
  const leafIndex = -(nodeIndex + 1);
  return leafs[leafIndex] ?? null;
}

/**
 * Get list of texture names used by a BSP
 * Useful for pre-loading required PK3s
 */
export function getBspTextureNames(bsp: BspFile): string[] {
  return bsp.textures.map((t) => t.name);
}

/**
 * Get unique texture names actually used by faces (not just defined)
 */
export function getBspUsedTextures(bsp: BspFile): string[] {
  const usedIndices = new Set<number>();

  for (const face of bsp.faces) {
    if (face.textureIndex >= 0 && face.textureIndex < bsp.textures.length) {
      usedIndices.add(face.textureIndex);
    }
  }

  return Array.from(usedIndices)
    .map((idx) => bsp.textures[idx].name)
    .filter((name) => !name.toLowerCase().includes("common/"));
}
