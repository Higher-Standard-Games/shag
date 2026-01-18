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

import { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Q3ShaderRegistry } from '../shader/Q3ShaderRegistry';
import { PK3Loader } from '../pk3/PK3Loader';
import { decodeTGA } from '../texture/TgaDecoder';

// MD3 Constants
const MD3_IDENT = 0x33504449; // "IDP3" in little-endian
const MD3_VERSION = 15;
const MD3_XYZ_SCALE = 1.0 / 64.0;
const MAX_QPATH = 64;

/**
 * Quake/MD3 Coordinate System Helpers
 * 
 * Quake: X = right, Y = forward, Z = up (left-handed)
 * Babylon: X = right, Y = up, Z = forward (right-handed)
 * 
 * Conversion: swap Y and Z
 */
export const MD3Coords = {
    /**
     * Convert Quake position to Babylon position
     */
    positionToBabylon(quakeX: number, quakeY: number, quakeZ: number): Vector3 {
        return new Vector3(quakeX, quakeZ, quakeY);
    },

    /**
     * Rotation to make MD3 model face forward in Babylon
     * MD3 weapons typically point along +Y in Quake space
     * We need them to point along +Z in Babylon space
     */
    viewModelRotation(): Vector3 {
        // Rotate -90 degrees around Y to face forward
        return new Vector3(0, -Math.PI / 2, 0);
    },

    /**
     * Get standard view model transform for FPS weapons
     * @param rightOffset - How far to the right (positive = right)
     * @param downOffset - How far down (positive = down)
     * @param forwardOffset - How far forward (positive = forward)
     */
    viewModelOffset(rightOffset: number, downOffset: number, forwardOffset: number): Vector3 {
        return new Vector3(rightOffset, -downOffset, forwardOffset);
    },
};

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
    /** Promises that resolve when all textures are loaded */
    textureLoadPromises?: Promise<void>[];
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

        // Read Quake origin (X, Y=Forward, Z=Up)
        const qOrigin = new Vector3(
            view.getFloat32(offset + 64, true),
            view.getFloat32(offset + 68, true),
            view.getFloat32(offset + 72, true)
        );

        // Convert to Babylon origin (X, Y=Up, Z=Forward)
        // Swap Y and Z
        const origin = new Vector3(qOrigin.x, qOrigin.z, qOrigin.y);

        // Read 3x3 rotation matrix (column-major in MD3)
        // Quake Axes:
        // Col 0: X axis
        // Col 1: Y axis (Forward)
        // Col 2: Z axis (Up)
        const qAxes: Vector3[] = [];
        for (let col = 0; col < 3; col++) {
            qAxes[col] = new Vector3(
                view.getFloat32(offset + 76 + (col * 3 + 0) * 4, true),
                view.getFloat32(offset + 76 + (col * 3 + 1) * 4, true),
                view.getFloat32(offset + 76 + (col * 3 + 2) * 4, true)
            );
        }

        // Convert Axes to Babylon (Swap Y/Z components)
        // bAxis = (qAxis.x, qAxis.z, qAxis.y)
        const bAxes: Vector3[] = qAxes.map(v => new Vector3(v.x, v.z, v.y));

        // Reassign columns to Babylon Axes
        // Quake Axes (Row 0, 1, 2 = Fwd, Left, Up)

        const matrixValues = new Float32Array(16);
        matrixValues[15] = 1; // Identity w

        // Babylon Col 0 (X / Right) <- From Q-Col 1 (Left) [Negated]
        matrixValues[0] = -bAxes[1].x;
        matrixValues[1] = -bAxes[1].y;
        matrixValues[2] = -bAxes[1].z;
        matrixValues[3] = 0;

        // Babylon Col 1 (Y / Up) <- From Q-Col 2 (Up)
        matrixValues[4] = bAxes[2].x;
        matrixValues[5] = bAxes[2].y;
        matrixValues[6] = bAxes[2].z;
        matrixValues[7] = 0;

        // Babylon Col 2 (Z / Fwd) <- From Q-Col 0 (Fwd)
        matrixValues[8] = bAxes[0].x;
        matrixValues[9] = bAxes[0].y;
        matrixValues[10] = bAxes[0].z;
        matrixValues[11] = 0;

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
        // console.log(`[MD3]   Surface: ${header.name}, verts: ${header.numVerts}, tris: ${header.numTriangles}`);

        // Read shaders
        const shaders: MD3Shader[] = [];
        let offset = surfaceStart + header.ofsShaders;
        for (let i = 0; i < header.numShaders; i++) {
            const shaderName = this.readString(view, offset, MAX_QPATH);
            shaders.push({
                name: shaderName,
                shaderIndex: view.getInt32(offset + 64, true),
            });
            // console.log(`[MD3]     Shader ${i}: "${shaderName}"`);
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
        // Quake uses bottom-left UV origin, Babylon uses top-left, so flip V
        const texCoords: number[] = [];
        offset = surfaceStart + header.ofsST;
        for (let i = 0; i < header.numVerts; i++) {
            const u = view.getFloat32(offset, true);
            const v = view.getFloat32(offset + 4, true);
            texCoords.push(u);
            texCoords.push(1.0 - v);  // Flip V coordinate
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
     * Create a Babylon material from Q3 shader registry lookup
     * Returns the material and a promise that resolves when texture loading completes
     */
    private createMaterialFromShader(shaderName: string, materialName: string): { material: StandardMaterial; textureLoadPromise: Promise<void> } {
        if (!this.scene) {
            throw new Error('Scene not initialized');
        }

        const registry = Q3ShaderRegistry.getInstance();
        // Normalize shader name: MD3 files may use backslashes on Windows
        const normalizedName = shaderName.replace(/\\/g, '/');
        const props = registry.resolveMaterialProps(normalizedName);
        // Check for existing material to support caching and prevent texture loss
        const existing = this.scene.getMaterialByName(materialName);
        if (existing) {
            // console.log(`[MD3] Reusing existing material: ${materialName}`);
            return { material: existing as StandardMaterial, textureLoadPromise: Promise.resolve() };
        }

        const mat = new StandardMaterial(materialName, this.scene);

        console.log(`[MD3] Creating material for shader: "${normalizedName}"`, props);

        // Determine texture path - prefer shader-defined texture, fallback to shader name itself
        // MD3 shader names often ARE the texture paths (e.g. "models/items/ammo/ammobox/ammobox")
        const texturePath = props.diffuseTexture || normalizedName;

        // Create a promise that resolves when texture loading completes
        let textureLoadPromise: Promise<void> = Promise.resolve();

        // Try to load texture
        if (texturePath) {
            // Resolve texture path
            let resolvedPath = texturePath;
            if (!resolvedPath.startsWith('/')) {
                resolvedPath = '/' + resolvedPath;
            }
            // Try loading from PK3 or direct path
            const pk3 = PK3Loader.getInstance();
            const cleanPath = resolvedPath.replace(/^\//, '');

            // Try with original extension, then fallback to other formats
            const extensions = ['', '.tga', '.png', '.jpg'];
            const basePath = cleanPath.replace(/\.(tga|png|jpg|jpeg)$/i, '');

            let foundPath: string | null = null;
            for (const ext of extensions) {
                const tryPath = basePath + ext;
                if (pk3.hasFile(tryPath)) {
                    foundPath = tryPath;
                    break;
                }
            }

            if (foundPath) {
                console.log(`[MD3] Loading texture from PK3: ${foundPath}`);

                // If TGA, we must decode it. If PNG/JPG, we can use Blob URL directly.
                const isTga = foundPath.toLowerCase().endsWith('.tga');

                if (isTga) {
                    textureLoadPromise = pk3.getFile(foundPath).then(buffer => {
                        if (buffer) {
                            return decodeTGA(buffer);
                        }
                        return null;
                    }).then(dataUrl => {
                        if (dataUrl) {
                            console.log(`[MD3] TGA decoded from PK3: ${foundPath}`);
                            const tex = new Texture(dataUrl, this.scene!);
                            tex.hasAlpha = props.isTransparent ?? false;
                            mat.diffuseTexture = tex;
                            if (props.isTransparent) {
                                mat.useAlphaFromDiffuseTexture = true;
                            }
                            if (props.alphaMode === 'add') {
                                mat.emissiveTexture = tex;
                            }
                        }
                    }).catch(err => {
                        console.error(`[MD3] Error decoding TGA ${foundPath}:`, err);
                    });
                } else {
                    // PNG/JPG
                    textureLoadPromise = pk3.getFileAsURL(foundPath, 'image/png').then(url => {
                        if (url) {
                            console.log(`[MD3] Texture URL created: ${url.substring(0, 50)}...`);
                            const tex = new Texture(url, this.scene!);
                            tex.hasAlpha = props.isTransparent ?? false;
                            mat.diffuseTexture = tex;
                            if (props.isTransparent) {
                                mat.useAlphaFromDiffuseTexture = true;
                            }
                            // For additive blending, also use as emissive
                            if (props.alphaMode === 'add') {
                                mat.emissiveTexture = tex;
                            }
                            console.log(`[MD3] Assigned texture URL to material '${materialName}'`);
                        } else {
                            console.warn(`[MD3] Failed to create URL for texture: ${foundPath}`);
                        }
                    }).catch(err => {
                        console.error(`[MD3] Error loading texture ${foundPath}:`, err);
                    });
                }
            } else {
                // Fallback: try loading directly from public/games/default/
                // Try PNG first, then decode TGA on-the-fly
                const basePath = cleanPath.replace(/\.(tga|jpg|jpeg)$/i, '');
                const pngPath = `/games/default/${basePath}.png`;
                const tgaPath = `/games/default/${cleanPath}`;

                console.log(`[MD3] Trying direct texture path: ${pngPath}`);

                // Try PNG first (browsers can load this natively)
                textureLoadPromise = fetch(pngPath, { method: 'HEAD' })
                    .then(resp => {
                        if (resp.ok) {
                            // PNG exists, load it
                            console.log(`[MD3] Found PNG texture: ${pngPath}`);
                            mat.diffuseTexture = new Texture(pngPath, this.scene!);
                            mat.diffuseTexture.hasAlpha = props.isTransparent ?? false;
                        } else {
                            // Try TGA with on-the-fly decoding
                            console.log(`[MD3] PNG not found, trying TGA decode: ${tgaPath}`);
                            return this.loadTgaTextureAsync(tgaPath, mat, props.isTransparent ?? false);
                        }
                    })
                    .catch(() => {
                        // Network error, try TGA
                        return this.loadTgaTextureAsync(tgaPath, mat, props.isTransparent ?? false);
                    });
            }
        }

        // Apply material properties from shader
        if (props.isTransparent) {
            mat.alpha = 1.0;
            if (props.alphaMode === 'add') {
                // Additive blending - set emissive and disable lighting
                mat.alphaMode = Engine.ALPHA_ADD;
                mat.emissiveColor = new Color3(1, 1, 1);
                mat.disableLighting = true;
            }
        }

        if (props.isFullbright) {
            mat.emissiveColor = new Color3(1, 1, 1);
            mat.disableLighting = true;
        }

        mat.backFaceCulling = props.backFaceCulling ?? true;
        mat.specularColor.set(0.1, 0.1, 0.1);

        return { material: mat, textureLoadPromise };
    }

    /**
     * Load a TGA texture by decoding it on-the-fly to a data URL (async version)
     */
    private loadTgaTextureAsync(tgaPath: string, mat: StandardMaterial, hasAlpha: boolean): Promise<void> {
        return fetch(tgaPath)
            .then(resp => {
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                return resp.arrayBuffer();
            })
            .then(buffer => decodeTGA(buffer))
            .then(dataUrl => {
                console.log(`[MD3] TGA decoded successfully: ${tgaPath}`);
                const tex = new Texture(dataUrl, this.scene!);
                tex.hasAlpha = hasAlpha;
                mat.diffuseTexture = tex;
                // For additive, also set emissive
                if (mat.disableLighting) {
                    mat.emissiveTexture = tex;
                }
                if (hasAlpha) {
                    mat.useAlphaFromDiffuseTexture = true;
                }
            })
            .catch(err => {
                console.error(`[MD3] Failed to load TGA texture: ${tgaPath}`, err);
            });
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
        const textureLoadPromises: Promise<void>[] = [];

        // Create mesh for each surface
        for (const surface of model.surfaces) {
            // Skip effect surfaces (_fx) that don't render correctly without proper shader support
            // These are typically additive glow effects that need special handling
            const surfaceName = surface.header.name.toLowerCase();
            if (surfaceName.endsWith('_fx') || surfaceName.includes('_fx_')) {
                continue;
            }

            const mesh = this.createSurfaceMesh(surface, name, frame);
            if (mesh) {
                mesh.parent = root;
                meshes.push(mesh);

                // Try to create material from embedded shader name
                if (options?.textureUrl) {
                    // Use explicit texture URL if provided
                    const mat = new StandardMaterial(`${name}_mat`, this.scene);
                    mat.diffuseTexture = new Texture(options.textureUrl, this.scene);
                    mat.specularColor.set(0.1, 0.1, 0.1);
                    mesh.material = mat;
                } else if (surface.shaders.length > 0) {
                    // Use embedded shader name to look up material properties
                    const shaderName = surface.shaders[0].name;
                    const { material, textureLoadPromise } = this.createMaterialFromShader(shaderName, `${name}_${surface.header.name}`);
                    mesh.material = material;
                    textureLoadPromises.push(textureLoadPromise);

                    // Check for mesh-level properties (autosprite/billboard)
                    const registry = Q3ShaderRegistry.getInstance();
                    const normalizedName = shaderName.replace(/\\/g, '/');
                    const props = registry.resolveMaterialProps(normalizedName);

                    const isFlash = name.endsWith('_flash');

                    if (props.autosprite || props.autosprite2 || isFlash) {
                        // Autosprite meshes (and muzzle flashes in general) are usually built along X axis.
                        // Babylon billboards/Forward alignment expect Z.
                        // We must rotate the geometry so X aligns with Z (Forward).

                        // Only bake if we haven't already (check a flag or assume fresh load)
                        // Note: createMeshes is called once per load, so this is safe.

                        // User reported 180 degree flip with +PI/2.
                        // Switching to -PI/2 to flip it back.
                        mesh.rotation.y = -Math.PI / 2;
                        mesh.bakeCurrentTransformIntoVertices();

                        if (props.autosprite) {
                            // autosprite = Rotate around vertical axis (Quake Z, Babylon Y)
                            mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
                        } else if (props.autosprite2) {
                            // autosprite2 = Face camera fully
                            mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
                        }
                        // If just isFlash (no autosprite), we still aligned it Forward, which is good.
                    }

                    if (props.tcMod) {
                        this.applyTcMod(mesh, props.tcMod);
                    }
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
            textureLoadPromises,
        };
    }

    private createSurfaceMesh(surface: MD3Surface, name: string, frame: number): Mesh | null {
        if (!this.scene) return null;

        const mesh = new Mesh(`${name}_${surface.header.name}`, this.scene);

        const vertexData = new VertexData();

        // Convert to Babylon coordinate system (swap Y/Z, negate Z for right-hand)
        const positions = surface.vertices[frame];
        const normals = surface.normals[frame];

        // MD3 uses Quake coordinate system: X right, Y forward, Z up
        // Babylon uses: X right, Y up, Z forward
        // So we swap Y and Z
        const convertedPositions = new Float32Array(positions.length);
        const convertedNormals = new Float32Array(normals.length);

        for (let i = 0; i < positions.length; i += 3) {
            convertedPositions[i] = positions[i];       // X stays
            convertedPositions[i + 1] = positions[i + 2]; // Babylon Y = Quake Z  
            convertedPositions[i + 2] = positions[i + 1]; // Babylon Z = Quake Y

            convertedNormals[i] = normals[i];
            convertedNormals[i + 1] = normals[i + 2];
            convertedNormals[i + 2] = normals[i + 1];
        }

        vertexData.positions = Array.from(convertedPositions);
        vertexData.normals = Array.from(convertedNormals);
        vertexData.uvs = surface.texCoords;

        // Reverse winding order to fix inside-out after Y/Z swap
        vertexData.indices = surface.triangles.flatMap(t => [t[2], t[1], t[0]]);

        vertexData.applyToMesh(mesh, true);

        return mesh;
    }

    /**
     * Apply Quake 3 tcMod (texture coordinate modifications)
     */
    private applyTcMod(mesh: Mesh, tcMods: any[]) {
        if (!tcMods || tcMods.length === 0) return;

        const mat = mesh.material as StandardMaterial;
        if (!mat || !mat.diffuseTexture) return;

        const texture = mat.diffuseTexture as Texture;

        // Quake rotations are around center (0.5, 0.5)
        texture.uRotationCenter = 0.5;
        texture.vRotationCenter = 0.5;

        // Static mods
        for (const mod of tcMods) {
            if (mod.type === 'scale') {
                texture.uScale = mod.uScale;
                texture.vScale = mod.vScale;
            }
        }

        // Animated mods
        const animatedMods = tcMods.filter(m => ['rotate', 'scroll', 'stretch', 'turb'].includes(m.type));

        if (animatedMods.length > 0) {
            mesh.onBeforeRenderObservable.add(() => {
                const time = performance.now() / 1000;

                for (const mod of animatedMods) {
                    if (mod.type === 'rotate') {
                        // Quake rotate is deg/sec
                        // Negative because Quake is CCW? Or maybe Babylon texture rotation logic differs.
                        // StandardMaterial wAng is radians.
                        const rad = mod.degreesPerSecond * (Math.PI / 180) * time;
                        texture.wAng = rad;
                    } else if (mod.type === 'scroll') {
                        texture.uOffset = (time * mod.uSpeed) % 1;
                        texture.vOffset = (time * mod.vSpeed) % 1;
                    }
                }
            });
        }
    }
}

// Convenience function
export function getMD3Loader(): MD3Loader {
    return MD3Loader.getInstance();
}
