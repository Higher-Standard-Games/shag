/**
 * MD3Loader - Parse and load Quake 3 MD3 model format
 * 
 * MD3 is a vertex animation format where each frame stores all vertex positions.
 * Used by Quake 3, Warsow, and other id-tech derived games.
 * 
 * Structure:
 * - Header: magic, version, name, counts, offsets
 * - Frames: bounding box per frame
 * - Tags: attachment points (weapon to hand, etc.)
 * - Surfaces: mesh data with vertices, triangles, UVs
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// MD3 Constants
const MD3_IDENT = 0x33504449; // "IDP3" in little-endian
const MD3_VERSION = 15;
const MD3_XYZ_SCALE = 1.0 / 64.0;
const MAX_QPATH = 64;

// MD3 Header structure
interface MD3Header {
    ident: number;
    version: number;
    name: string;
    flags: number;
    numFrames: number;
    numTags: number;
    numSurfaces: number;
    numSkins: number;
    ofsFrames: number;
    ofsTags: number;
    ofsSurfaces: number;
    ofsEnd: number;
}

// Frame data (bounding box per animation frame)
interface MD3Frame {
    minBounds: Vector3;
    maxBounds: Vector3;
    localOrigin: Vector3;
    radius: number;
    name: string;
}

// Tag - attachment point (e.g., "tag_weapon")
interface MD3Tag {
    name: string;
    origin: Vector3;
    axis: Matrix;
}

// Surface header
interface MD3SurfaceHeader {
    ident: number;
    name: string;
    flags: number;
    numFrames: number;
    numShaders: number;
    numVerts: number;
    numTriangles: number;
    ofsTriangles: number;
    ofsShaders: number;
    ofsST: number;
    ofsXYZNormal: number;
    ofsEnd: number;
}

// Shader reference
interface MD3Shader {
    name: string;
    shaderIndex: number;
}

// Parsed surface with mesh data
interface MD3Surface {
    header: MD3SurfaceHeader;
    shaders: MD3Shader[];
    triangles: number[][]; // Array of [i0, i1, i2]
    texCoords: number[];   // Flat array [u, v, u, v, ...]
    vertices: Float32Array[]; // Per-frame vertex positions
    normals: Float32Array[];  // Per-frame normals
}

// Complete parsed MD3 model
export interface MD3Model {
    header: MD3Header;
    frames: MD3Frame[];
    tags: MD3Tag[][];  // [frameIndex][tagIndex]
    surfaces: MD3Surface[];
}

// Result of loading MD3 to Babylon
export interface MD3LoadResult {
    root: TransformNode;
    meshes: Mesh[];
    model: MD3Model;
    currentFrame: number;
    setFrame: (frame: number) => void;
    getTag: (name: string, frame?: number) => { origin: Vector3; axis: Matrix } | null;
}

/**
 * MD3Loader singleton class
 */
export class MD3Loader {
    private static instance: MD3Loader;
    private scene: Scene | null = null;

    private constructor() { }

    public static getInstance(): MD3Loader {
        if (!MD3Loader.instance) {
            MD3Loader.instance = new MD3Loader();
        }
        return MD3Loader.instance;
    }

    public init(scene: Scene): void {
        this.scene = scene;
    }

    /**
     * Parse MD3 binary data into model structure
     */
    public parseMD3(buffer: ArrayBuffer): MD3Model {
        const view = new DataView(buffer);
        let offset = 0;

        // Read header
        const header = this.readHeader(view, offset);

        if (header.ident !== MD3_IDENT) {
            throw new Error(`Invalid MD3 file: bad magic number (got ${header.ident.toString(16)})`);
        }
        if (header.version !== MD3_VERSION) {
            console.warn(`MD3 version mismatch: expected ${MD3_VERSION}, got ${header.version}`);
        }

        console.log(`[MD3] Loading: ${header.name}`);
        console.log(`[MD3] Frames: ${header.numFrames}, Tags: ${header.numTags}, Surfaces: ${header.numSurfaces}`);

        // Read frames
        const frames: MD3Frame[] = [];
        offset = header.ofsFrames;
        for (let i = 0; i < header.numFrames; i++) {
            frames.push(this.readFrame(view, offset));
            offset += 56; // Frame size: 3*4 + 3*4 + 3*4 + 4 + 16 = 56 bytes
        }

        // Read tags (numFrames * numTags)
        const tags: MD3Tag[][] = [];
        offset = header.ofsTags;
        for (let f = 0; f < header.numFrames; f++) {
            const frameTags: MD3Tag[] = [];
            for (let t = 0; t < header.numTags; t++) {
                frameTags.push(this.readTag(view, offset));
                offset += 112; // Tag size: 64 + 3*4 + 3*3*4 = 112 bytes
            }
            tags.push(frameTags);
        }

        // Read surfaces
        const surfaces: MD3Surface[] = [];
        offset = header.ofsSurfaces;
        for (let s = 0; s < header.numSurfaces; s++) {
            const surface = this.readSurface(view, offset, header.numFrames);
            surfaces.push(surface);
            offset += surface.header.ofsEnd;
        }

        return { header, frames, tags, surfaces };
    }

    private readHeader(view: DataView, offset: number): MD3Header {
        return {
            ident: view.getInt32(offset, true),
            version: view.getInt32(offset + 4, true),
            name: this.readString(view, offset + 8, MAX_QPATH),
            flags: view.getInt32(offset + 72, true),
            numFrames: view.getInt32(offset + 76, true),
            numTags: view.getInt32(offset + 80, true),
            numSurfaces: view.getInt32(offset + 84, true),
            numSkins: view.getInt32(offset + 88, true),
            ofsFrames: view.getInt32(offset + 92, true),
            ofsTags: view.getInt32(offset + 96, true),
            ofsSurfaces: view.getInt32(offset + 100, true),
            ofsEnd: view.getInt32(offset + 104, true),
        };
    }

    private readFrame(view: DataView, offset: number): MD3Frame {
        return {
            minBounds: new Vector3(
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true)
            ),
            maxBounds: new Vector3(
                view.getFloat32(offset + 12, true),
                view.getFloat32(offset + 16, true),
                view.getFloat32(offset + 20, true)
            ),
            localOrigin: new Vector3(
                view.getFloat32(offset + 24, true),
                view.getFloat32(offset + 28, true),
                view.getFloat32(offset + 32, true)
            ),
            radius: view.getFloat32(offset + 36, true),
            name: this.readString(view, offset + 40, 16),
        };
    }

    private readTag(view: DataView, offset: number): MD3Tag {
        const name = this.readString(view, offset, MAX_QPATH);
        const origin = new Vector3(
            view.getFloat32(offset + 64, true),
            view.getFloat32(offset + 68, true),
            view.getFloat32(offset + 72, true)
        );

        // Read 3x3 rotation matrix (column-major in MD3), expand to 4x4
        const matrixValues = new Float32Array(16);
        // Identity matrix base
        matrixValues[15] = 1;

        for (let col = 0; col < 3; col++) {
            for (let row = 0; row < 3; row++) {
                matrixValues[row * 4 + col] = view.getFloat32(offset + 76 + (col * 3 + row) * 4, true);
            }
        }

        const axis = Matrix.FromArray(matrixValues);

        return { name, origin, axis };
    }

    private readSurface(view: DataView, surfaceStart: number, numFrames: number): MD3Surface {
        const header: MD3SurfaceHeader = {
            ident: view.getInt32(surfaceStart, true),
            name: this.readString(view, surfaceStart + 4, MAX_QPATH),
            flags: view.getInt32(surfaceStart + 68, true),
            numFrames: view.getInt32(surfaceStart + 72, true),
            numShaders: view.getInt32(surfaceStart + 76, true),
            numVerts: view.getInt32(surfaceStart + 80, true),
            numTriangles: view.getInt32(surfaceStart + 84, true),
            ofsTriangles: view.getInt32(surfaceStart + 88, true),
            ofsShaders: view.getInt32(surfaceStart + 92, true),
            ofsST: view.getInt32(surfaceStart + 96, true),
            ofsXYZNormal: view.getInt32(surfaceStart + 100, true),
            ofsEnd: view.getInt32(surfaceStart + 104, true),
        };

        console.log(`[MD3]   Surface: ${header.name}, verts: ${header.numVerts}, tris: ${header.numTriangles}`);

        // Read shaders
        const shaders: MD3Shader[] = [];
        let offset = surfaceStart + header.ofsShaders;
        for (let i = 0; i < header.numShaders; i++) {
            shaders.push({
                name: this.readString(view, offset, MAX_QPATH),
                shaderIndex: view.getInt32(offset + 64, true),
            });
            offset += 68;
        }

        // Read triangles
        const triangles: number[][] = [];
        offset = surfaceStart + header.ofsTriangles;
        for (let i = 0; i < header.numTriangles; i++) {
            triangles.push([
                view.getInt32(offset, true),
                view.getInt32(offset + 4, true),
                view.getInt32(offset + 8, true),
            ]);
            offset += 12;
        }

        // Read texture coordinates (same for all frames)
        const texCoords: number[] = [];
        offset = surfaceStart + header.ofsST;
        for (let i = 0; i < header.numVerts; i++) {
            texCoords.push(view.getFloat32(offset, true));     // U
            texCoords.push(view.getFloat32(offset + 4, true)); // V
            offset += 8;
        }

        // Read vertices per frame
        const vertices: Float32Array[] = [];
        const normals: Float32Array[] = [];

        for (let f = 0; f < numFrames; f++) {
            const frameVerts = new Float32Array(header.numVerts * 3);
            const frameNormals = new Float32Array(header.numVerts * 3);

            offset = surfaceStart + header.ofsXYZNormal + f * header.numVerts * 8;

            for (let v = 0; v < header.numVerts; v++) {
                // Vertex position (scaled S16)
                const x = view.getInt16(offset, true) * MD3_XYZ_SCALE;
                const y = view.getInt16(offset + 2, true) * MD3_XYZ_SCALE;
                const z = view.getInt16(offset + 4, true) * MD3_XYZ_SCALE;

                // Normal (encoded as lat/lng)
                const normal = view.getInt16(offset + 6, true);
                const { nx, ny, nz } = this.decodeNormal(normal);

                frameVerts[v * 3 + 0] = x;
                frameVerts[v * 3 + 1] = y;
                frameVerts[v * 3 + 2] = z;

                frameNormals[v * 3 + 0] = nx;
                frameNormals[v * 3 + 1] = ny;
                frameNormals[v * 3 + 2] = nz;

                offset += 8;
            }

            vertices.push(frameVerts);
            normals.push(frameNormals);
        }

        return { header, shaders, triangles, texCoords, vertices, normals };
    }

    private decodeNormal(encoded: number): { nx: number; ny: number; nz: number } {
        const lat = ((encoded >> 8) & 0xFF) * (2 * Math.PI) / 255;
        const lng = (encoded & 0xFF) * (2 * Math.PI) / 255;

        return {
            nx: Math.cos(lat) * Math.sin(lng),
            ny: Math.sin(lat) * Math.sin(lng),
            nz: Math.cos(lng),
        };
    }

    private readString(view: DataView, offset: number, maxLength: number): string {
        let str = '';
        for (let i = 0; i < maxLength; i++) {
            const char = view.getUint8(offset + i);
            if (char === 0) break;
            str += String.fromCharCode(char);
        }
        return str;
    }

    /**
     * Create Babylon.js meshes from parsed MD3 model
     */
    public createMeshes(
        model: MD3Model,
        name: string,
        options?: {
            frame?: number;
            textureUrl?: string;
        }
    ): MD3LoadResult | null {
        if (!this.scene) {
            console.error('[MD3] Loader not initialized with scene');
            return null;
        }

        const frame = options?.frame ?? 0;
        const root = new TransformNode(`md3_${name}`, this.scene);
        const meshes: Mesh[] = [];

        // Create mesh for each surface
        for (const surface of model.surfaces) {
            const mesh = this.createSurfaceMesh(surface, name, frame);
            if (mesh) {
                mesh.parent = root;
                meshes.push(mesh);

                // Apply texture if provided
                if (options?.textureUrl) {
                    const mat = new StandardMaterial(`${name}_mat`, this.scene);
                    mat.diffuseTexture = new Texture(options.textureUrl, this.scene);
                    mat.specularColor.set(0.1, 0.1, 0.1);
                    mesh.material = mat;
                }
            }
        }

        // Frame setter closure
        let currentFrame = frame;
        const setFrame = (newFrame: number) => {
            if (newFrame < 0 || newFrame >= model.header.numFrames) return;
            currentFrame = newFrame;

            for (let i = 0; i < model.surfaces.length; i++) {
                const surface = model.surfaces[i];
                if (!meshes[i]) continue;

                const vertexData = new VertexData();
                vertexData.positions = Array.from(surface.vertices[newFrame]);
                vertexData.normals = Array.from(surface.normals[newFrame]);
                vertexData.uvs = surface.texCoords;
                vertexData.indices = surface.triangles.flat();
                vertexData.applyToMesh(meshes[i], true);
            }
        };

        // Tag getter
        const getTag = (tagName: string, tagFrame?: number) => {
            const f = tagFrame ?? currentFrame;
            if (f < 0 || f >= model.tags.length) return null;

            const tag = model.tags[f].find(t => t.name === tagName);
            if (!tag) return null;

            return { origin: tag.origin, axis: tag.axis };
        };

        return {
            root,
            meshes,
            model,
            currentFrame,
            setFrame,
            getTag,
        };
    }

    private createSurfaceMesh(surface: MD3Surface, name: string, frame: number): Mesh | null {
        if (!this.scene) return null;

        const mesh = new Mesh(`${name}_${surface.header.name}`, this.scene);

        const vertexData = new VertexData();

        // Convert to Babylon coordinate system (swap Y/Z, negate Z for right-hand)
        const positions = surface.vertices[frame];
        const normals = surface.normals[frame];

        // Babylon uses right-handed, MD3 uses... let's figure it out
        // For now, just use positions directly
        vertexData.positions = Array.from(positions);
        vertexData.normals = Array.from(normals);
        vertexData.uvs = surface.texCoords;

        // Flatten triangles to indices (reverse winding for Babylon)
        vertexData.indices = surface.triangles.flatMap(t => [t[2], t[1], t[0]]);

        vertexData.applyToMesh(mesh, true);

        return mesh;
    }
}

// Convenience function
export function getMD3Loader(): MD3Loader {
    return MD3Loader.getInstance();
}
