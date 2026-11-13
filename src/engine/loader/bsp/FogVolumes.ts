/**
 * Q3 fog volumes (`surfaceparm fog` brushes with `fogparms`), drawn as qfusion
 * draws them.
 *
 * qfusion fogs every surface inside a fog brush by how far the view travels
 * through the fog to reach it. Its density (glsl/include/fog_overload.glsl) is
 * measured along the view axis, starts `clearDist` in and is full at `dist`:
 *
 *   s = depth - clearDist                     (camera inside the fog)
 *   s = (depth - clearDist) * below / (below + eyeHeight)
 *                                             (camera outside: only the part of
 *                                              the view under the fog surface)
 *   density = sqrt(clamp(s / (dist - clearDist), 0, 1))
 *
 * where "below" is how far the surface point is under the fog's visible plane
 * (the brush side its surface is drawn on) and eyeHeight is the camera's height
 * above it. The colour is the shader's colour normalized to a brightest
 * channel of 1.
 *
 * Here each brush is drawn once, back faces only and without a depth test, so
 * it covers its screen area from inside or out. Every pixel reads the opaque
 * scene's camera-space depth, rebuilds the world point behind it, and fogs it
 * when that point is inside the brush. Transparent surfaces are not in the
 * depth and take the fog of what is behind them; the viewmodel is not fogged.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";
import { WaterDepthProvider } from "../../rendering/water/WaterDepth";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import type { BspFile } from "./BspLoader";

/** Brush sides a fog volume may have; a fog brush is usually a box. */
export const MAX_FOG_PLANES = 16;

/** The viewmodel camera layer; it does not see the world's fog. */
const WEAPON_LAYER = 0x10000000;

/** A plane as normal and distance: points with dot(normal, p) > dist are outside. */
export type FogPlane = [number, number, number, number];

export interface FogVolume {
  shaderName: string;
  brushIndex: number;
  /** The brush's sides in world (Babylon) coordinates, normals outward. */
  planes: FogPlane[];
  /** The side the fog surface is drawn on. */
  surface: FogPlane;
  /** The shader colour with its brightest channel at 1. */
  color: [number, number, number];
  dist: number;
  clearDist: number;
}

/** Q3 (x, y, z) Z-up to Babylon (x, z, y) Y-up; a plane's distance is unchanged. */
function toBabylonPlane(normal: [number, number, number] | number[], dist: number): FogPlane {
  return [normal[0], normal[2], normal[1], dist];
}

/** qfusion ColorNormalize: scale so the brightest channel is 1. */
function normalizeColor(color: [number, number, number]): [number, number, number] {
  const max = Math.max(color[0], color[1], color[2]);
  return max > 0 ? [color[0] / max, color[1] / max, color[2] / max] : [0, 0, 0];
}

/**
 * The brush side a face of the fog's shader is drawn on, facing out of the
 * brush: the fog's surface when the compiler wrote no visible side.
 */
function drawnSide(
  bsp: BspFile,
  shader: string,
  sides: { normal: number[]; dist: number }[],
): { normal: number[]; dist: number } | undefined {
  const name = shader.toLowerCase();
  for (const face of bsp.faces) {
    if (bsp.textures[face.textureIndex]?.name.toLowerCase() !== name) continue;
    const at = bsp.vertices[face.firstVertex]?.position;
    if (!at) continue;
    const found = sides.find(
      (p) =>
        p.normal[0] * face.normal[0] + p.normal[1] * face.normal[1] + p.normal[2] * face.normal[2] > 0.99 &&
        Math.abs(p.normal[0] * at[0] + p.normal[1] * at[1] + p.normal[2] * at[2] - p.dist) < 1,
    );
    if (found) return found;
  }
  return undefined;
}

/**
 * Every fog brush in the BSP with its shader's fog parameters. The surface is
 * the fog's visible side; when the compiler wrote none (or garbage), the side
 * a face of the fog's shader is drawn on, and failing that the side facing
 * most nearly up, which is where a fog pit's surface is.
 */
export function fogVolumesFrom(bsp: BspFile): FogVolume[] {
  const registry = Q3ShaderRegistry.getInstance();
  const volumes: FogVolume[] = [];
  for (const effect of bsp.effects) {
    const parms = registry.getShader(effect.name)?.fogParms;
    const brush = bsp.brushes[effect.brushIndex];
    if (!parms || !brush) continue;
    const q3: { normal: number[]; dist: number }[] = [];
    for (let i = 0; i < brush.numSides; i++) {
      const plane = bsp.planes[bsp.brushSides[brush.firstSide + i]?.planeIndex ?? -1];
      if (plane) q3.push(plane);
    }
    if (q3.length < 4 || q3.length > MAX_FOG_PLANES) {
      console.warn(`[FogVolumes] ${effect.name}: brush ${effect.brushIndex} has ${q3.length} usable sides; skipped`);
      continue;
    }
    const side = effect.visibleSide;
    let surface = side >= 0 && side < q3.length ? q3[side] : undefined;
    surface ??= drawnSide(bsp, effect.name, q3);
    surface ??= q3.reduce((best, p) => (p.normal[2] > best.normal[2] ? p : best));
    volumes.push({
      shaderName: effect.name,
      brushIndex: effect.brushIndex,
      planes: q3.map((p) => toBabylonPlane(p.normal, p.dist)),
      surface: toBabylonPlane(surface.normal, surface.dist),
      color: normalizeColor(parms.color),
      dist: parms.depthForOpaque,
      clearDist: parms.clearDist,
    });
  }
  return volumes;
}

/**
 * The closed hull of a convex brush: every corner where three sides meet and no
 * side excludes, each side's corners in order around it. Triangles wind
 * counter-clockwise seen from outside.
 */
export function brushHull(planes: FogPlane[]): { positions: number[]; indices: number[] } | null {
  const corners: Vector3[] = [];
  const n = planes.map((p) => new Vector3(p[0], p[1], p[2]));
  for (let a = 0; a < planes.length; a++)
    for (let b = a + 1; b < planes.length; b++)
      for (let c = b + 1; c < planes.length; c++) {
        const bc = Vector3.Cross(n[b], n[c]);
        const det = Vector3.Dot(n[a], bc);
        if (Math.abs(det) < 1e-6) continue;
        const point = bc
          .scale(planes[a][3])
          .add(Vector3.Cross(n[c], n[a]).scale(planes[b][3]))
          .add(Vector3.Cross(n[a], n[b]).scale(planes[c][3]))
          .scale(1 / det);
        if (planes.every((p, i) => Vector3.Dot(n[i], point) - p[3] <= 0.01)) {
          if (!corners.some((q) => Vector3.DistanceSquared(q, point) < 0.01)) corners.push(point);
        }
      }
  if (corners.length < 4) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < planes.length; i++) {
    const on = corners.filter((p) => Math.abs(Vector3.Dot(n[i], p) - planes[i][3]) < 0.05);
    if (on.length < 3) continue;
    const centre = on.reduce((s, p) => s.add(p), Vector3.Zero()).scale(1 / on.length);
    // Order around the side's normal
    const u = on[0].subtract(centre).normalize();
    const v = Vector3.Cross(n[i], u);
    on.sort(
      (p, q) =>
        Math.atan2(Vector3.Dot(p.subtract(centre), v), Vector3.Dot(p.subtract(centre), u)) -
        Math.atan2(Vector3.Dot(q.subtract(centre), v), Vector3.Dot(q.subtract(centre), u)),
    );
    const base = positions.length / 3;
    for (const p of on) positions.push(p.x, p.y, p.z);
    for (let k = 1; k + 1 < on.length; k++) indices.push(base, base + k, base + k + 1);
  }
  return indices.length ? { positions, indices } : null;
}

const SHADER = "q3FogVolume";

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vWorld;
void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  gl_Position = viewProjection * worldPos;
}
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D sceneDepth;
uniform vec2 screenSize;
// Camera uniforms by the names WebGPU frame snapshots rewrite in replayed frames
uniform vec3 cameraPosition;
uniform mat4 view;
// Up to 16 brush sides, one per matrix column; uniform buffers carry matrices
// on every backend, where vec4 arrays did not reach WebGPU
uniform mat4 planes0;
uniform mat4 planes1;
uniform mat4 planes2;
uniform mat4 planes3;
uniform float planeCount;
uniform vec4 surface;
uniform vec3 fogColor;
uniform vec2 fogScaleClear;
varying vec3 vWorld;
void main() {
  float z = texture2D(sceneDepth, gl_FragCoord.xy / screenSize).r;
  // Nothing drawn here: the sky, or the cleared background
  if (z <= 0.0) discard;
  vec3 eye = cameraPosition;
  // The view matrix's third row: camera-space z per world unit
  vec3 forward = vec3(view[0][2], view[1][2], view[2][2]);
  vec3 dir = normalize(vWorld - eye);
  float along = dot(dir, forward);
  if (along <= 0.0001) discard;
  vec3 p = eye + dir * (z / along);
  for (int i = 0; i < 4; i++) {
    if (float(i) < planeCount && dot(p, planes0[i].xyz) - planes0[i].w > 1.0) discard;
    if (float(i + 4) < planeCount && dot(p, planes1[i].xyz) - planes1[i].w > 1.0) discard;
    if (float(i + 8) < planeCount && dot(p, planes2[i].xyz) - planes2[i].w > 1.0) discard;
    if (float(i + 12) < planeCount && dot(p, planes3[i].xyz) - planes3[i].w > 1.0) discard;
  }
  // qfusion FogGenCoord: depth past the clear distance, and only the part of
  // the view under the fog surface when the eye is above it
  float fogDist = z - fogScaleClear.y;
  float below = dot(p, surface.xyz) - surface.w;
  float eyeHeight = dot(eye, surface.xyz) - surface.w;
  float s = fogDist;
  if (eyeHeight > 0.0) {
    float toEye = below - eyeHeight;
    s = below <= 0.0 ? fogDist * below / min(toEye, -0.001) : 0.0;
  }
  float t = -below * fogScaleClear.x + 1.5 / 256.0;
  float density = sqrt(clamp(s * fogScaleClear.x, 0.0, 1.0)) * step(1.0 / 256.0, t);
  if (density <= 0.0) discard;
  gl_FragColor = vec4(fogColor, density);
}
`;

function ensureShader(): void {
  if (Effect.ShadersStore[`${SHADER}VertexShader`]) return;
  Effect.ShadersStore[`${SHADER}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER}FragmentShader`] = FRAGMENT;
}

/** The map's fog volumes in a scene; dispose removes them and their per-frame work. */
export class FogVolumeSet {
  readonly meshes: Mesh[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly depth: WaterDepthProvider;
  private readonly screenSize = new Vector2();
  private readonly observer;

  constructor(
    private readonly scene: Scene,
    readonly volumes: FogVolume[],
    parent: TransformNode | null,
  ) {
    ensureShader();
    this.depth = new WaterDepthProvider(scene);
    for (const volume of volumes) {
      const hull = brushHull(volume.planes);
      if (!hull) {
        console.warn(`[FogVolumes] ${volume.shaderName}: brush ${volume.brushIndex} has no closed hull; skipped`);
        continue;
      }
      const mesh = new Mesh(`fogVolume_${volume.brushIndex}`, scene);
      const data = new VertexData();
      data.positions = hull.positions;
      data.indices = hull.indices;
      data.applyToMesh(mesh);
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.metadata = { mapOwned: true, fogVolume: volume.shaderName, excludeFromWaterCapture: true };
      // After the map's blended surfaces (alphaIndex 0-999), so one inside the
      // fog is fogged by what lies behind it; before map particles and additive
      // surfaces
      mesh.alphaIndex = 999.25;
      const material = new ShaderMaterial(
        `fogVolume_${volume.brushIndex}`,
        scene,
        { vertex: SHADER, fragment: SHADER },
        {
          attributes: ["position"],
          uniforms: [
            "world",
            "viewProjection",
            "screenSize",
            "cameraPosition",
            "view",
            "planes0",
            "planes1",
            "planes2",
            "planes3",
            "planeCount",
            "surface",
            "fogColor",
            "fogScaleClear",
          ],
          samplers: ["sceneDepth"],
          needAlphaBlending: true,
        },
      );
      material.alphaMode = Constants.ALPHA_COMBINE;
      material.disableDepthWrite = true;
      material.depthFunction = Constants.ALWAYS;
      // The far side only: one fragment per pixel, inside the volume or out.
      // The hull winds counter-clockwise seen from outside, which in Babylon's
      // left-handed view is a back face, so the far side is the front.
      material.backFaceCulling = true;
      material.cullBackFaces = true;
      const planes: number[] = [];
      for (let i = 0; i < MAX_FOG_PLANES; i++) planes.push(...(volume.planes[i] ?? [0, 0, 0, 0]));
      for (let m = 0; m < 4; m++) material.setMatrix(`planes${m}`, Matrix.FromArray(planes, m * 16));
      material.setFloat("planeCount", volume.planes.length);
      material.setVector4("surface", new Vector4(...volume.surface));
      material.setColor3("fogColor", new Color3(...volume.color));
      material.setVector2("fogScaleClear", new Vector2(1 / (volume.dist - volume.clearDist), volume.clearDist));
      mesh.material = material;
      this.meshes.push(mesh);
      this.materials.push(material);
    }
    this.observer = scene.onBeforeCameraRenderObservable.add((camera) => this.prepare(camera));
    devLog(`[FogVolumes] ${this.meshes.length} of ${volumes.length} fog volumes drawn`);
  }

  /** Point every volume at this camera's depth, or hide them while there is none. */
  private prepare(camera: Camera): void {
    if ((camera.layerMask & WEAPON_LAYER) !== 0) return;
    const inView = this.meshes.some((mesh) => camera.isInFrustum(mesh));
    const depth = inView ? this.depth.mapFor(camera) : null;
    this.depth.setRendering(inView);
    const engine = this.scene.getEngine();
    this.screenSize.set(engine.getRenderWidth(), engine.getRenderHeight());
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].isVisible = depth !== null;
      if (!depth) continue;
      const material = this.materials[i];
      material.setTexture("sceneDepth", depth);
      material.setVector2("screenSize", this.screenSize);
      material.setVector3("cameraPosition", camera.globalPosition);
      material.setMatrix("view", camera.getViewMatrix());
    }
  }

  dispose(): void {
    this.scene.onBeforeCameraRenderObservable.remove(this.observer);
    this.depth.dispose();
    for (const mesh of this.meshes) mesh.dispose(false, true);
    this.meshes.length = 0;
    this.materials.length = 0;
  }
}

/** Build the map's fog volumes; null when it has none. */
export function createFogVolumes(bsp: BspFile, scene: Scene, parent: TransformNode | null): FogVolumeSet | null {
  const volumes = fogVolumesFrom(bsp);
  if (!volumes.length) return null;
  return new FogVolumeSet(scene, volumes, parent);
}
