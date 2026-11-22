/**
 * A stylised outdoor water surface for a diorama: a bright, mostly opaque
 * river with soft shallows, foam at the banks, ripple lines that run along
 * the shore, and sparse sun glints, all snapped to a pixel grid so it sits
 * with pixel-art textures.
 *
 * It replaces the material of the meshes it is given and gives the old one
 * back on `restore`. The shore comes from the meshes themselves: their
 * triangles are rasterised from above into a grid, and a distance transform
 * gives every water cell its distance to the nearest bank, stored in a small
 * texture. Nothing else about the map needs to know about it.
 *
 * It does not reflect or refract; a renderer's full water (SHAG's
 * `LiquidSurfaceSystem`) does that, and this is the cheap, art-directed
 * alternative for top-down views where the bank and the colour matter more.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import type { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vWorld;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = viewProjection * w;
}
`;

const FRAGMENT = `
precision highp float;
varying vec3 vWorld;
uniform sampler2D shoreSampler;
// xy: grid origin (world x, z), zw: 1 / grid size
uniform vec4 shoreRect;
uniform float maxDistance;
uniform float time;
uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform vec3 foamColor;
uniform vec3 eye;
uniform vec3 toSun;
// x: brightness, y: foam, z: glints, w: pixel size (world units)
uniform vec4 look;
// Flow direction and speed, world units per second (x, z)
uniform vec2 flow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(void) {
  float px = max(0.5, look.w);
  vec2 cell = floor(vWorld.xz / px);
  vec2 p = cell * px;
  float d = texture2D(shoreSampler, (p - shoreRect.xy) * shoreRect.zw).r * maxDistance;
  vec2 drift = p - flow * time;
  float n = noise(drift * 0.03) * 0.6 + noise(drift * 0.09) * 0.4;

  vec3 color = mix(shallowColor, deepColor, smoothstep(2.0, 36.0, d + (n - 0.5) * 10.0));
  // Lighter streaks drifting with the current
  color += (smoothstep(0.62, 0.78, n) * 0.08) * vec3(0.8, 0.95, 1.0);

  // Ripple lines that run along the bank and roll in towards it
  float band = sin(d * 0.42 + time * 1.5 + n * 2.5);
  float ripple = step(0.9, band) * (1.0 - smoothstep(8.0, 26.0, d));
  // Foam at the edge, ragged and moving
  float edge = d + (noise(p * 0.12 + vec2(time * 0.35, -time * 0.2)) - 0.5) * 5.0;
  float foam = 1.0 - smoothstep(1.5, 4.5, edge);
  color = mix(color, foamColor, clamp(max(foam * 0.9, ripple * 0.4) * look.y, 0.0, 1.0));

  // Sun glints: sparse pixels that flash, brighter looking towards the sun
  vec3 view = normalize(vWorld - eye);
  vec3 mirrored = reflect(view, vec3(0.0, 1.0, 0.0));
  float towards = pow(max(0.0, dot(mirrored, toSun)), 3.0);
  float flash = step(0.994 - towards * 0.02, hash(cell + floor(time * 4.0 + hash(cell) * 4.0)));
  color += flash * look.z * (0.4 + towards) * vec3(1.0, 0.95, 0.85) * (1.0 - foam);

  gl_FragColor = vec4(color * look.x, 1.0);
}
`;

export interface StylizedWaterSettings {
  shallowColor: Color3;
  deepColor: Color3;
  foamColor: Color3;
  /** Overall brightness (the surface is not lightmapped). */
  brightness: number;
  /** Foam and ripple strength, 0..1. */
  foam: number;
  /** Glint strength. */
  glints: number;
  /** Pixel size of the pattern, world units (match the textures' art pixels). */
  pixel: number;
  /** Current, world units per second along x and z. */
  flowX: number;
  flowZ: number;
}

/** Grid cell for the shore distance field, world units. */
const CELL = 4;
/** Distances are stored up to this many units. */
const MAX_DISTANCE = 64;

export class StylizedWater {
  readonly material: ShaderMaterial;
  readonly settings: StylizedWaterSettings = {
    shallowColor: new Color3(0.3, 0.62, 0.66),
    deepColor: new Color3(0.07, 0.26, 0.46),
    foamColor: new Color3(0.92, 0.97, 1.0),
    brightness: 0.8,
    foam: 0.85,
    glints: 1,
    pixel: 4,
    flowX: 0,
    flowZ: 10,
  };
  private readonly toSun = new Vector3(0, 1, 0);
  private readonly originals = new Map<AbstractMesh, Material | null>();
  private shore: RawTexture | null = null;
  private time = 0;
  private readonly observer: Observer<Scene>;

  constructor(private readonly scene: Scene) {
    Effect.ShadersStore.stylizedWaterVertexShader = VERTEX;
    Effect.ShadersStore.stylizedWaterFragmentShader = FRAGMENT;
    this.material = new ShaderMaterial(
      "stylizedWater",
      scene,
      { vertex: "stylizedWater", fragment: "stylizedWater" },
      {
        attributes: ["position"],
        uniforms: [
          "world",
          "viewProjection",
          "shoreRect",
          "maxDistance",
          "time",
          "shallowColor",
          "deepColor",
          "foamColor",
          "eye",
          "toSun",
          "look",
          "flow",
        ],
        samplers: ["shoreSampler"],
      },
    );
    this.material.backFaceCulling = false;
    this.material.setFloat("maxDistance", MAX_DISTANCE);
    const look = new Vector4();
    const flow = new Vector2();
    this.observer = scene.onBeforeRenderObservable.add(() => {
      if (!this.originals.size) return;
      this.time += scene.getEngine().getDeltaTime() / 1000;
      const s = this.settings;
      const m = this.material;
      m.setFloat("time", this.time);
      m.setColor3("shallowColor", s.shallowColor);
      m.setColor3("deepColor", s.deepColor);
      m.setColor3("foamColor", s.foamColor);
      m.setVector3("toSun", this.toSun);
      m.setVector4("look", look.set(s.brightness, s.foam, s.glints, s.pixel));
      m.setVector2("flow", flow.set(s.flowX, s.flowZ));
      const camera = scene.activeCamera;
      if (camera) m.setVector3("eye", camera.globalPosition);
    });
  }

  /** Direction the sunlight travels (pointing down), for the glints. */
  setSun(direction: Vector3): void {
    this.toSun.copyFrom(direction).scaleInPlace(-1).normalize();
  }

  /** Take over these meshes' surfaces. Returns how many. */
  apply(meshes: readonly AbstractMesh[]): number {
    const fresh = meshes.filter((mesh) => !this.originals.has(mesh));
    for (const mesh of fresh) {
      this.originals.set(mesh, mesh.material);
      mesh.material = this.material;
    }
    if (fresh.length) this.buildShore();
    return fresh.length;
  }

  /** Give the meshes their own materials back. */
  restore(): void {
    for (const [mesh, original] of this.originals) {
      if (!mesh.isDisposed()) mesh.material = original;
    }
    this.originals.clear();
  }

  get count(): number {
    return this.originals.size;
  }

  /** Rasterise the water from above and store each cell's distance to the bank. */
  private buildShore(): void {
    const triangles: number[] = [];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const p = new Vector3();
    for (const mesh of this.originals.keys()) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      const indices = mesh.getIndices();
      if (!positions || !indices) continue;
      const world = mesh.computeWorldMatrix(true);
      for (const index of indices) {
        Vector3.TransformCoordinatesFromFloatsToRef(
          positions[index * 3],
          positions[index * 3 + 1],
          positions[index * 3 + 2],
          world,
          p,
        );
        triangles.push(p.x, p.z);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    if (!triangles.length) return;
    // A margin of land around the water, so the edge cells see a bank
    minX -= CELL * 2;
    minZ -= CELL * 2;
    const width = Math.ceil((maxX - minX) / CELL) + 3;
    const height = Math.ceil((maxZ - minZ) / CELL) + 3;
    const water = new Uint8Array(width * height);
    for (let t = 0; t + 5 < triangles.length; t += 6) {
      const [ax, az, bx, bz, cx, cz] = triangles.slice(t, t + 6);
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / CELL));
      const x1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / CELL));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / CELL));
      const z1 = Math.min(height - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / CELL));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (insideTriangle(minX + (x + 0.5) * CELL, minZ + (z + 0.5) * CELL, ax, az, bx, bz, cx, cz)) {
            water[z * width + x] = 1;
          }
        }
      }
    }
    const distance = chamferDistance(water, width, height);
    const bytes = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const value = Math.round(Math.min(1, (distance[i] * CELL) / MAX_DISTANCE) * 255);
      bytes[i * 4] = value;
      bytes[i * 4 + 1] = value;
      bytes[i * 4 + 2] = value;
      bytes[i * 4 + 3] = 255;
    }
    this.shore?.dispose();
    this.shore = RawTexture.CreateRGBATexture(
      bytes,
      width,
      height,
      this.scene,
      false,
      false,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    );
    this.shore.wrapU = RawTexture.CLAMP_ADDRESSMODE;
    this.shore.wrapV = RawTexture.CLAMP_ADDRESSMODE;
    this.material.setTexture("shoreSampler", this.shore);
    this.material.setVector4("shoreRect", new Vector4(minX, minZ, 1 / (width * CELL), 1 / (height * CELL)));
  }

  dispose(): void {
    this.restore();
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.shore?.dispose();
    this.shore = null;
    this.material.dispose();
  }
}

function insideTriangle(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** Distance in cells from each water cell to the nearest dry one (two-pass chamfer, 1 and 1.4). */
function chamferDistance(water: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = water[i] ? far : 0;
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= width || z >= height ? 0 : d[z * width + x]);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, z) + 1, at(x, z - 1) + 1, at(x - 1, z - 1) + 1.4, at(x + 1, z - 1) + 1.4);
    }
  }
  for (let z = height - 1; z >= 0; z--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = z * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, z) + 1, at(x, z + 1) + 1, at(x + 1, z + 1) + 1.4, at(x - 1, z + 1) + 1.4);
    }
  }
  return d;
}
