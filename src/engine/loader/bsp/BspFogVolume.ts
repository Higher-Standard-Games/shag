/**
 * BspFogVolume - Extract and render fog volumes from BSP files
 *
 * Fog brushes are volumetric regions that apply distance-based fog.
 * The Effects lump links fog shaders to brush geometry.
 */

import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import type { BspFile, BspPlane } from "./BspLoader";

// ============================================================================
// Fog Volume Data Types
// ============================================================================

export interface FogVolumeData {
  shaderName: string;
  brushIndex: number;
  fogColor: [number, number, number];
  depthForOpaque: number;
  planes: BspPlane[];
}

export interface MapBounds {
  mins: [number, number, number];
  maxs: [number, number, number];
}

/**
 * Simple AABB for fog volume bounds
 */
export interface FogAABB {
  min: Vector3;
  max: Vector3;
  fogColor: [number, number, number];
  depthForOpaque: number;
  shaderName: string;
}

export interface FogVolumeBuildResult {
  volumes: FogVolumeData[];
  meshes: Mesh[];
}

// ============================================================================
// Fog Volume Shader
// ============================================================================

// Register custom fog volume shader
const FOG_SHADER_NAME = "fogVolumeShader";

// Vertex shader - pass world position to fragment
const fogVertexShader = `
precision highp float;

attribute vec3 position;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vWorldPosition;

void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Fragment shader - depth-based fog
const fogFragmentShader = `
precision highp float;

uniform vec3 fogColor;
uniform float depthForOpaque;
uniform vec3 cameraPosition;

varying vec3 vWorldPosition;

void main() {
  // Calculate distance from camera to this fragment
  float dist = distance(cameraPosition, vWorldPosition);

  // Calculate fog factor (0 = transparent, 1 = opaque)
  float fogFactor = clamp(dist / depthForOpaque, 0.0, 0.85);

  // Apply fog color with calculated alpha
  gl_FragColor = vec4(fogColor, fogFactor);
}
`;

let shaderRegistered = false;

function ensureFogShaderRegistered(): void {
  if (shaderRegistered) return;

  Effect.ShadersStore[FOG_SHADER_NAME + "VertexShader"] = fogVertexShader;
  Effect.ShadersStore[FOG_SHADER_NAME + "FragmentShader"] = fogFragmentShader;
  shaderRegistered = true;
}

// ============================================================================
// Fog Volume Extraction
// ============================================================================

/**
 * Extract fog volumes from BSP data
 */
export function extractFogVolumes(bspData: BspFile): FogVolumeData[] {
  const shaderRegistry = Q3ShaderRegistry.getInstance();
  const fogVolumes: FogVolumeData[] = [];

  console.log(`[FogVolume] Checking ${bspData.effects.length} effects for fog...`);

  for (const effect of bspData.effects) {
    // Look up shader for fog params
    const shader = shaderRegistry.getShader(effect.name);

    if (!shader?.fogParms) {
      // No fog params in shader, skip
      continue;
    }

    // Validate brush index
    if (effect.brushIndex < 0 || effect.brushIndex >= bspData.brushes.length) {
      console.warn(
        `[FogVolume] Effect "${effect.name}" references invalid brush index ${effect.brushIndex} (max: ${bspData.brushes.length})`,
      );
      continue;
    }

    // Get brush geometry
    const brush = bspData.brushes[effect.brushIndex];
    if (!brush) {
      console.warn(`[FogVolume] Effect "${effect.name}" references null brush ${effect.brushIndex}`);
      continue;
    }

    console.log(
      `[FogVolume] Processing brush ${effect.brushIndex}: firstSide=${brush.firstSide}, numSides=${brush.numSides}`,
    );

    // Collect planes that define the brush
    const planes: BspPlane[] = [];
    let hasInvalidPlane = false;

    for (let i = 0; i < brush.numSides; i++) {
      const sideIndex = brush.firstSide + i;
      if (sideIndex < 0 || sideIndex >= bspData.brushSides.length) {
        console.warn(`[FogVolume] Brush ${effect.brushIndex} has invalid side index ${sideIndex}`);
        hasInvalidPlane = true;
        continue;
      }
      const side = bspData.brushSides[sideIndex];

      // Check for invalid plane index (including potential unsigned overflow)
      if (side.planeIndex < 0 || side.planeIndex >= bspData.planes.length) {
        console.warn(
          `[FogVolume] BrushSide has invalid plane index ${side.planeIndex} (max: ${bspData.planes.length})`,
        );
        hasInvalidPlane = true;
        continue;
      }
      planes.push(bspData.planes[side.planeIndex]);
    }

    if (hasInvalidPlane) {
      console.warn(`[FogVolume] Skipping fog volume "${effect.name}" due to invalid brush data`);
      continue;
    }

    if (planes.length < 4) {
      console.warn(`[FogVolume] Brush ${effect.brushIndex} has too few planes (${planes.length})`);
      continue;
    }

    console.log(
      `[FogVolume] Found fog volume: "${effect.name}" with ${planes.length} planes, ` +
        `color=(${shader.fogParms.color.join(",")}), depth=${shader.fogParms.depthForOpaque}`,
    );

    fogVolumes.push({
      shaderName: effect.name,
      brushIndex: effect.brushIndex,
      fogColor: shader.fogParms.color,
      depthForOpaque: shader.fogParms.depthForOpaque,
      planes,
    });
  }

  return fogVolumes;
}

// ============================================================================
// Geometry Building (Plane Intersection)
// ============================================================================

/**
 * Convert BSP planes to Babylon.js planes
 * BSP uses Z-up, Babylon uses Y-up
 *
 * BSP plane convention: dot(normal, point) < dist means point is on back/inside side
 * Babylon Plane convention: dot(normal, point) + d < 0 means point is behind plane
 *
 * To make BSP planes work with Babylon's convention where we want
 * interior points to satisfy: dot(normal, point) + d < 0
 * We need: d = -dist (so dot(normal, point) - dist < 0, same as dot < dist)
 */
function convertBspPlane(bspPlane: BspPlane): Plane {
  // Q3: X right, Y forward, Z up
  // Babylon: X right, Y up, Z forward
  // So: Babylon.X = Q3.X, Babylon.Y = Q3.Z, Babylon.Z = Q3.Y
  const normal = new Vector3(
    bspPlane.normal[0],
    bspPlane.normal[2], // Z -> Y
    bspPlane.normal[1], // Y -> Z
  );

  // BSP: point inside if dot(normal, point) < dist
  // Babylon Plane: point behind if dot(normal, point) + d < 0
  // So d = -dist makes: dot(normal, point) - dist < 0, i.e., dot < dist ✓
  return new Plane(normal.x, normal.y, normal.z, -bspPlane.dist);
}

/**
 * Find intersection point of three planes
 */
function getPlaneIntersection(p1: Plane, p2: Plane, p3: Plane): Vector3 | null {
  const n1 = new Vector3(p1.normal.x, p1.normal.y, p1.normal.z);
  const n2 = new Vector3(p2.normal.x, p2.normal.y, p2.normal.z);
  const n3 = new Vector3(p3.normal.x, p3.normal.y, p3.normal.z);

  const det = Vector3.Dot(n1, Vector3.Cross(n2, n3));

  if (Math.abs(det) < 0.000001) {
    return null; // Planes are parallel or nearly so
  }

  const cross23 = Vector3.Cross(n2, n3).scale(-p1.d);
  const cross31 = Vector3.Cross(n3, n1).scale(-p2.d);
  const cross12 = Vector3.Cross(n1, n2).scale(-p3.d);

  return cross23
    .add(cross31)
    .add(cross12)
    .scale(1 / det);
}

/**
 * Check if a point is inside the convex brush
 *
 * BSP plane normals point INTO the brush (toward solid/interior).
 * So a point is INSIDE the brush if it's on the POSITIVE side of all planes
 * (in the direction the normals point).
 *
 * After conversion with d = -dist:
 * - Original BSP: inside if dot(normal, point) > dist for all planes
 * - Babylon: dot(normal, point) + d = dot(normal, point) - dist
 * - So inside if: dot(normal, point) - dist > 0, i.e., dist > -tolerance
 */
function isPointInsideBrush(point: Vector3, planes: Plane[]): boolean {
  for (const plane of planes) {
    const normal = new Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
    const dist = Vector3.Dot(normal, point) + plane.d;
    // BSP normals point INTO brush, so point is INSIDE if on positive side
    // Point is OUTSIDE if it's on the negative side of any plane
    if (dist < -0.1) {
      return false;
    }
  }
  return true;
}

/**
 * Build mesh geometry from fog volume planes
 */
function buildFogVolumeGeometry(fogVolume: FogVolumeData): { positions: number[]; indices: number[] } | null {
  // Convert BSP planes to Babylon planes
  const allPlanes = fogVolume.planes.map(convertBspPlane);

  // Deduplicate planes (BSP can have duplicate/bevel planes)
  const planes: Plane[] = [];
  for (const plane of allPlanes) {
    const isDuplicate = planes.some((p) => {
      const normalMatch =
        Math.abs(p.normal.x - plane.normal.x) < 0.01 &&
        Math.abs(p.normal.y - plane.normal.y) < 0.01 &&
        Math.abs(p.normal.z - plane.normal.z) < 0.01;
      const distMatch = Math.abs(p.d - plane.d) < 0.1;
      return normalMatch && distMatch;
    });
    if (!isDuplicate) {
      planes.push(plane);
    }
  }

  if (planes.length < 4) {
    console.warn(`[FogVolume] Brush ${fogVolume.brushIndex}: only ${planes.length} unique planes (need 4+)`);
    return null;
  }

  // Maximum valid coordinate (filter out vertices at infinity for huge brushes)
  const MAX_COORD = 65536;

  // Find all vertices by intersecting triples of planes
  const vertices: Vector3[] = [];
  let rejectedOutside = 0;
  let rejectedBounds = 0;
  let rejectedDuplicate = 0;

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const intersection = getPlaneIntersection(planes[i], planes[j], planes[k]);
        if (intersection) {
          // Filter out vertices at extreme distances (for map-spanning fog brushes)
          if (
            Math.abs(intersection.x) > MAX_COORD ||
            Math.abs(intersection.y) > MAX_COORD ||
            Math.abs(intersection.z) > MAX_COORD
          ) {
            rejectedBounds++;
            continue;
          }

          // Check if point is inside the brush (on correct side of all planes)
          if (isPointInsideBrush(intersection, planes)) {
            // Check for duplicate vertices
            if (!vertices.some((v) => Vector3.DistanceSquared(v, intersection) < 0.01)) {
              vertices.push(intersection);
            } else {
              rejectedDuplicate++;
            }
          } else {
            rejectedOutside++;
          }
        }
      }
    }
  }

  console.log(
    `[FogVolume] Brush ${fogVolume.brushIndex}: ${vertices.length} vertices ` +
      `(rejected: ${rejectedOutside} outside, ${rejectedBounds} bounds, ${rejectedDuplicate} duplicate)`,
  );

  // Debug: show plane info
  if (vertices.length < 4) {
    console.log(`[FogVolume] Planes:`);
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      const n = p.normal;
      console.log(`  [${i}] normal=(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) d=${p.d.toFixed(1)}`);
    }
    for (let i = 0; i < Math.min(vertices.length, 4); i++) {
      const v = vertices[i];
      console.log(`[FogVolume] Vertex ${i}: (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`);
    }
  }

  if (vertices.length < 4) {
    console.warn(`[FogVolume] Brush ${fogVolume.brushIndex} produced only ${vertices.length} vertices - skipping`);
    return null;
  }

  // Build faces for each plane
  const positions: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;

  for (const plane of planes) {
    const planeNormal = new Vector3(plane.normal.x, plane.normal.y, plane.normal.z);

    // Find vertices that lie on this plane
    const faceVertices: Vector3[] = [];
    for (const v of vertices) {
      const dist = Math.abs(Vector3.Dot(planeNormal, v) + plane.d);
      if (dist < 0.1) {
        // Tighter tolerance like BrushGenerator
        faceVertices.push(v);
      }
    }

    if (faceVertices.length < 3) {
      continue;
    }

    // Sort vertices around face center for proper winding
    const faceCenter = faceVertices.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / faceVertices.length);

    let tangent = Vector3.Cross(planeNormal, Vector3.Up());
    if (tangent.lengthSquared() < 0.001) {
      tangent = Vector3.Cross(planeNormal, Vector3.Right());
    }
    tangent.normalize();
    const bitangent = Vector3.Cross(planeNormal, tangent);

    faceVertices.sort((a, b) => {
      const va = a.subtract(faceCenter);
      const vb = b.subtract(faceCenter);
      const angleA = Math.atan2(Vector3.Dot(va, bitangent), Vector3.Dot(va, tangent));
      const angleB = Math.atan2(Vector3.Dot(vb, bitangent), Vector3.Dot(vb, tangent));
      return angleA - angleB;
    });

    // Triangulate the face (fan from first vertex)
    for (let j = 1; j < faceVertices.length - 1; j++) {
      positions.push(
        faceVertices[0].x,
        faceVertices[0].y,
        faceVertices[0].z,
        faceVertices[j].x,
        faceVertices[j].y,
        faceVertices[j].z,
        faceVertices[j + 1].x,
        faceVertices[j + 1].y,
        faceVertices[j + 1].z,
      );

      indices.push(indexOffset, indexOffset + 1, indexOffset + 2);
      indexOffset += 3;
    }
  }

  if (positions.length === 0) {
    return null;
  }

  return { positions, indices };
}

// ============================================================================
// Fog Volume Manager
// ============================================================================

export class FogVolumeManager {
  private fogMeshes: Mesh[] = [];

  /**
   * Build fog volume meshes from BSP data
   */
  async buildFogVolumes(bspData: BspFile, scene: Scene): Promise<FogVolumeBuildResult> {
    ensureFogShaderRegistered();

    const volumes = extractFogVolumes(bspData);

    if (volumes.length === 0) {
      console.log("[FogVolume] No fog volumes found in BSP");
      return { volumes: [], meshes: [] };
    }

    console.log(`[FogVolume] Building ${volumes.length} fog volume meshes...`);

    for (const vol of volumes) {
      const geometry = buildFogVolumeGeometry(vol);
      if (!geometry) {
        console.warn(`[FogVolume] Failed to build geometry for "${vol.shaderName}"`);
        continue;
      }

      const mesh = this.createFogMesh(vol, geometry, scene);
      if (mesh) {
        this.fogMeshes.push(mesh);
      }
    }

    console.log(`[FogVolume] Created ${this.fogMeshes.length} fog meshes`);

    return { volumes, meshes: this.fogMeshes };
  }

  /**
   * Create a fog volume mesh with custom shader
   */
  private createFogMesh(
    vol: FogVolumeData,
    geometry: { positions: number[]; indices: number[] },
    scene: Scene,
  ): Mesh | null {
    const mesh = new Mesh(`fogVolume_${vol.brushIndex}`, scene);

    // Apply geometry
    const vertexData = new VertexData();
    vertexData.positions = geometry.positions;
    vertexData.indices = geometry.indices;

    // Calculate normals (needed for some effects)
    const normals: number[] = [];
    VertexData.ComputeNormals(geometry.positions, geometry.indices, normals);
    vertexData.normals = normals;

    vertexData.applyToMesh(mesh);

    // Create fog shader material
    const fogMaterial = new ShaderMaterial(
      `fogMat_${vol.brushIndex}`,
      scene,
      {
        vertex: FOG_SHADER_NAME,
        fragment: FOG_SHADER_NAME,
      },
      {
        attributes: ["position"],
        uniforms: ["world", "worldViewProjection", "fogColor", "depthForOpaque", "cameraPosition"],
      },
    );

    // Set fog parameters
    fogMaterial.setColor3("fogColor", new Color3(vol.fogColor[0], vol.fogColor[1], vol.fogColor[2]));
    fogMaterial.setFloat("depthForOpaque", vol.depthForOpaque);

    // Enable alpha blending and two-sided rendering
    fogMaterial.alpha = 1.0;
    fogMaterial.backFaceCulling = false;
    fogMaterial.needAlphaBlending = () => true;
    fogMaterial.alphaMode = 2; // ALPHA_COMBINE

    mesh.material = fogMaterial;

    // Update camera position each frame
    scene.onBeforeRenderObservable.add(() => {
      if (scene.activeCamera) {
        fogMaterial.setVector3("cameraPosition", scene.activeCamera.position);
      }
    });

    // Mark as non-pickable (don't interfere with raycast)
    mesh.isPickable = false;

    // Render after opaque geometry
    mesh.renderingGroupId = 1;

    console.log(`[FogVolume] Created mesh for "${vol.shaderName}" with ${geometry.positions.length / 3} vertices`);

    return mesh;
  }

  /**
   * Get all fog meshes
   */
  getMeshes(): Mesh[] {
    return this.fogMeshes;
  }

  /**
   * Dispose all fog meshes
   */
  dispose(): void {
    for (const mesh of this.fogMeshes) {
      if (mesh.material) {
        mesh.material.dispose();
      }
      mesh.dispose();
    }
    this.fogMeshes = [];
  }
}

// ============================================================================
// CamFog - Camera-based fog for when player is inside fog volume
// ============================================================================

/**
 * CamFog Manager
 *
 * Simpler approach to fog: when camera is inside a fog volume's AABB,
 * enable Babylon's scene fog with the volume's parameters.
 *
 * Works well for "atmosphere fog" covering large areas (like wdm11).
 * Does NOT handle "looking into fog from outside" (fog pits).
 */
export class CamFog {
  private fogVolumes: FogAABB[] = [];
  private scene: Scene | null = null;
  private observer: any = null;
  private currentFogVolume: FogAABB | null = null;
  private enabled: boolean = false;

  /** Scale factor for fog distances (adjustable for tuning) */
  public fogScale: number = 1.0;

  /**
   * Initialize CamFog with fog volumes from BSP
   * Uses world bounds for large fog volumes (doesn't require valid brush geometry)
   */
  init(bspData: BspFile, scene: Scene): void {
    this.scene = scene;
    this.fogVolumes = [];

    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const worldModel = bspData.models[0];

    if (!worldModel) {
      console.warn("[CamFog] No world model found");
      return;
    }

    // Convert world bounds Q3 (Z-up) to Babylon (Y-up)
    const worldMin = new Vector3(worldModel.mins[0], worldModel.mins[2], worldModel.mins[1]);
    const worldMax = new Vector3(worldModel.maxs[0], worldModel.maxs[2], worldModel.maxs[1]);

    console.log(
      `[CamFog] World bounds: (${worldMin.x.toFixed(0)},${worldMin.y.toFixed(0)},${worldMin.z.toFixed(0)}) -> ` +
        `(${worldMax.x.toFixed(0)},${worldMax.y.toFixed(0)},${worldMax.z.toFixed(0)})`,
    );

    // Extract fog params directly from effects lump (bypass brush geometry issues)
    for (const effect of bspData.effects) {
      const shader = shaderRegistry.getShader(effect.name);
      if (!shader?.fogParms) continue;

      // For CamFog, we use world bounds - this works for large "atmosphere" fog
      const aabb: FogAABB = {
        min: worldMin.clone(),
        max: worldMax.clone(),
        fogColor: shader.fogParms.color,
        depthForOpaque: shader.fogParms.depthForOpaque,
        shaderName: effect.name,
      };

      this.fogVolumes.push(aabb);
      console.log(
        `[CamFog] Registered fog "${effect.name}" with world bounds, ` +
          `color=(${shader.fogParms.color.join(",")}), depth=${shader.fogParms.depthForOpaque}`,
      );
    }

    console.log(`[CamFog] Initialized with ${this.fogVolumes.length} fog volumes`);
  }

  /**
   * Enable CamFog updates
   */
  enable(): void {
    if (this.enabled || !this.scene) return;

    this.enabled = true;
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      this.update();
    });

    console.log("[CamFog] Enabled");
  }

  /**
   * Disable CamFog updates
   */
  disable(): void {
    if (!this.enabled || !this.scene) return;

    this.enabled = false;
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }

    // Clear fog
    this.scene.fogMode = 0;
    this.currentFogVolume = null;

    console.log("[CamFog] Disabled");
  }

  /**
   * Check if camera is inside any fog volume and apply fog
   */
  private update(): void {
    if (!this.scene?.activeCamera) return;

    const camPos = this.scene.activeCamera.position;

    // Check if camera is inside any fog volume
    let insideVolume: FogAABB | null = null;
    for (const vol of this.fogVolumes) {
      if (this.isPointInAABB(camPos, vol)) {
        insideVolume = vol;
        break;
      }
    }

    // Apply or clear fog based on camera position
    if (insideVolume && insideVolume !== this.currentFogVolume) {
      // Entered a fog volume - enable fog
      this.applyFog(insideVolume);
      this.currentFogVolume = insideVolume;
    } else if (!insideVolume && this.currentFogVolume) {
      // Left fog volume - disable fog
      this.scene.fogMode = 0;
      this.currentFogVolume = null;
      console.log("[CamFog] Left fog volume");
    }
  }

  /**
   * Check if point is inside AABB
   */
  private isPointInAABB(point: Vector3, aabb: FogAABB): boolean {
    return (
      point.x >= aabb.min.x &&
      point.x <= aabb.max.x &&
      point.y >= aabb.min.y &&
      point.y <= aabb.max.y &&
      point.z >= aabb.min.z &&
      point.z <= aabb.max.z
    );
  }

  /**
   * Apply fog from volume parameters
   *
   * Q3 fogParms: depthForOpaque = distance at which fog is ~95% opaque
   * Using EXP2 fog: fogFactor = exp(-density² * distance²)
   *
   * Calculate density so that at depthForOpaque, fog is 95% opaque:
   * 0.05 = exp(-d² * depth²) => d = sqrt(-ln(0.05)) / depth ≈ 1.73 / depth
   */
  private applyFog(vol: FogAABB): void {
    if (!this.scene) return;

    // Calculate EXP2 density from depthForOpaque
    // density = sqrt(-ln(0.05)) / depthForOpaque ≈ 1.73 / depth
    const scaledDepth = vol.depthForOpaque * this.fogScale;
    const density = 1.73 / scaledDepth;

    this.scene.fogMode = 3; // FOGMODE_EXP2
    this.scene.fogColor = new Color3(vol.fogColor[0], vol.fogColor[1], vol.fogColor[2]);
    this.scene.fogDensity = density;

    console.log(
      `[CamFog] Fog applied: scale=${this.fogScale}, depth=${scaledDepth.toFixed(0)}, density=${density.toFixed(6)}`,
    );
  }

  /**
   * Set fog scale factor (for tuning fog distances)
   */
  setScale(scale: number): void {
    this.fogScale = scale;
    // Re-apply fog if currently in a volume
    if (this.currentFogVolume && this.scene) {
      this.applyFog(this.currentFogVolume);
      // Debug: verify scene fog was updated
      console.log(`[CamFog] setScale: scene.fogDensity = ${this.scene.fogDensity}`);
    }
  }

  /**
   * Get status info
   */
  getStatus(): string {
    const lines = [
      `CamFog: ${this.enabled ? "ENABLED" : "DISABLED"}`,
      `Fog volumes: ${this.fogVolumes.length}`,
      `Current: ${this.currentFogVolume?.shaderName || "none"}`,
      `Scale: ${this.fogScale}`,
    ];
    if (this.currentFogVolume) {
      const scaledDepth = this.currentFogVolume.depthForOpaque * this.fogScale;
      lines.push(`Depth: ${this.currentFogVolume.depthForOpaque} (scaled: ${scaledDepth.toFixed(0)})`);
    }
    return lines.join("\n");
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.disable();
    this.fogVolumes = [];
    this.scene = null;
  }
}

// ============================================================================
// Worldspawn Fog Support
// ============================================================================

/**
 * Parsed fog settings from worldspawn
 */
export interface WorldspawnFog {
  color: [number, number, number];
  density: number;
  mode: "exp" | "exp2" | "linear";
  start?: number; // For linear fog
  end?: number; // For linear fog
}

/**
 * Parse fog settings from BSP worldspawn entity
 *
 * Supported formats:
 *   "fog" "r g b density"           - EXP2 fog with color and density
 *   "fog" "r g b density mode"      - Fog with explicit mode (exp/exp2/linear)
 *   "fog_color" "r g b"             - Separate color key
 *   "fog_density" "0.0001"          - Separate density key
 *   "fog_start" "100"               - For linear fog
 *   "fog_end" "5000"                - For linear fog
 */
export function parseWorldspawnFog(bspData: BspFile): WorldspawnFog | null {
  // Find worldspawn entity (first entity with classname "worldspawn")
  const worldspawn = bspData.entities.find((e) => e.classname === "worldspawn");
  if (!worldspawn) return null;

  const props = worldspawn.properties;

  // Check for combined "fog" key
  if (props.fog) {
    const parts = props.fog
      .trim()
      .split(/\s+/)
      .map((s) => s.toLowerCase());
    if (parts.length >= 4) {
      const r = parseFloat(parts[0]) || 0;
      const g = parseFloat(parts[1]) || 0;
      const b = parseFloat(parts[2]) || 0;
      const density = parseFloat(parts[3]) || 0.0001;
      const modeStr = parts[4] || "exp2";

      let mode: "exp" | "exp2" | "linear" = "exp2";
      if (modeStr === "exp") mode = "exp";
      else if (modeStr === "linear") mode = "linear";

      return { color: [r, g, b], density, mode };
    }
  }

  // Check for separate keys
  let color: [number, number, number] | null = null;
  let density: number | null = null;
  let mode: "exp" | "exp2" | "linear" = "exp2";
  let start: number | undefined;
  let end: number | undefined;

  if (props.fog_color) {
    const parts = props.fog_color.trim().split(/\s+/);
    if (parts.length >= 3) {
      color = [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0];
    }
  }

  if (props.fog_density) {
    density = parseFloat(props.fog_density) || 0.0001;
  }

  if (props.fog_mode) {
    const m = props.fog_mode.toLowerCase();
    if (m === "exp") mode = "exp";
    else if (m === "linear") mode = "linear";
  }

  if (props.fog_start) start = parseFloat(props.fog_start);
  if (props.fog_end) end = parseFloat(props.fog_end);

  // Return if we have at least color or density
  if (color || density !== null) {
    return {
      color: color || [0.5, 0.5, 0.6],
      density: density ?? 0.0001,
      mode,
      start,
      end,
    };
  }

  return null;
}

/**
 * Apply worldspawn fog settings to scene
 */
export function applyWorldspawnFog(bspData: BspFile, scene: Scene): boolean {
  const fog = parseWorldspawnFog(bspData);
  if (!fog) {
    console.log("[WorldspawnFog] No fog settings found in worldspawn");
    return false;
  }

  scene.fogColor = new Color3(fog.color[0], fog.color[1], fog.color[2]);

  if (fog.mode === "linear") {
    scene.fogMode = 1; // FOGMODE_LINEAR
    scene.fogStart = fog.start ?? 100;
    scene.fogEnd = fog.end ?? 1000;
    console.log(
      `[WorldspawnFog] Applied LINEAR fog: color=(${fog.color.join(",")}), ` +
        `start=${scene.fogStart}, end=${scene.fogEnd}`,
    );
  } else {
    scene.fogMode = fog.mode === "exp" ? 2 : 3; // FOGMODE_EXP or FOGMODE_EXP2
    scene.fogDensity = fog.density;
    console.log(
      `[WorldspawnFog] Applied ${fog.mode.toUpperCase()} fog: color=(${fog.color.join(",")}), ` +
        `density=${fog.density}`,
    );
  }

  return true;
}
