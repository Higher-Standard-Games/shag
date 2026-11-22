/**
 * Chimney smoke: soft puffs that rise from points, drift with the wind, grow
 * and fade. All puffs of all plumes are one mesh and one draw; the vertex
 * shader moves them (each puff loops through its life on its own phase), so
 * nothing runs per puff on the CPU.
 *
 * Puffs are camera-facing quads with a soft round falloff and a little noise
 * at the rim, alpha-blended, depth-tested, never written to depth (depth of
 * field and mist see through them). Their colour is a light grey lifted by
 * the sun on the side facing it, so a plume reads as volume against a dark
 * roof and as haze against the sky.
 *
 * Nothing is drawn until `add` is called; `dispose` removes everything.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
// x: life phase 0..1, y: random 0..1, z: plume seed
attribute vec3 puff;
uniform mat4 viewProjection;
uniform vec3 cameraRight;
uniform vec3 cameraUp;
uniform vec3 wind;
// x: rise height, y: start size, z: end size, w: seconds per life
uniform vec4 plume;
uniform float time;
varying vec2 vUV;
varying float vLife;
varying float vSeed;
void main(void) {
  float life = fract(time / plume.w + puff.x);
  float rise = plume.x * (life * (1.6 - 0.6 * life));
  float sway = sin(time * 0.9 + puff.y * 6.2831 + life * 4.0) * 6.0 * life;
  vec3 center = position + vec3(0.0, rise, 0.0) + wind * life * plume.w + cameraRight * sway;
  float size = mix(plume.y, plume.z, sqrt(life)) * (0.8 + 0.4 * puff.y);
  float angle = puff.y * 6.2831 + life * (puff.y - 0.5) * 2.0;
  vec2 corner = uv * 2.0 - 1.0;
  vec2 r = vec2(corner.x * cos(angle) - corner.y * sin(angle), corner.x * sin(angle) + corner.y * cos(angle));
  vec3 p = center + (cameraRight * r.x + cameraUp * r.y) * size * 0.5;
  gl_Position = viewProjection * vec4(p, 1.0);
  vUV = uv;
  vLife = life;
  vSeed = puff.y + puff.z;
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying float vLife;
varying float vSeed;
uniform vec3 color;
uniform vec3 litColor;
// Light direction on screen (towards the sun), for the lit side of a puff
uniform vec2 sunOnScreen;
uniform float opacity;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(void) {
  vec2 c = vUV * 2.0 - 1.0;
  float d = length(c) + (noise(vUV * 5.0 + vSeed * 13.0) - 0.5) * 0.35;
  float body = 1.0 - smoothstep(0.35, 1.0, d);
  float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
  float a = body * fade * opacity;
  if (a < 0.004) discard;
  float lit = clamp(0.5 + 0.5 * dot(c, sunOnScreen), 0.0, 1.0);
  gl_FragColor = vec4(mix(color, litColor, lit), a);
}
`;

export interface SmokePlumeSettings {
  /** How high a puff rises over its life, world units. */
  rise: number;
  /** Puff size at birth and at the end, world units. */
  startSize: number;
  endSize: number;
  /** Seconds a puff lives. */
  life: number;
  /** Puffs per plume. */
  puffs: number;
}

export class SmokePlumes {
  readonly material: ShaderMaterial;
  /** 0 hides the smoke. */
  opacity = 0.5;
  readonly color = new Color3(0.62, 0.64, 0.68);
  readonly litColor = new Color3(1.0, 0.94, 0.84);
  /** Drift in world units per second. */
  readonly wind = new Vector3(14, 0, 6);
  private readonly toSun = new Vector3(0, 1, 0);
  private readonly origins: Vector3[] = [];
  private mesh: Mesh | null = null;
  private time = 0;
  private readonly observer: Observer<Scene>;
  private readonly settings: SmokePlumeSettings;

  constructor(
    private readonly scene: Scene,
    settings: Partial<SmokePlumeSettings> = {},
  ) {
    this.settings = { rise: 170, startSize: 16, endSize: 90, life: 7, puffs: 12, ...settings };
    Effect.ShadersStore.smokePlumeVertexShader = VERTEX;
    Effect.ShadersStore.smokePlumeFragmentShader = FRAGMENT;
    const material = new ShaderMaterial(
      "smokePlumes",
      scene,
      { vertex: "smokePlume", fragment: "smokePlume" },
      {
        attributes: ["position", "uv", "puff"],
        uniforms: [
          "viewProjection",
          "cameraRight",
          "cameraUp",
          "wind",
          "plume",
          "time",
          "color",
          "litColor",
          "sunOnScreen",
          "opacity",
        ],
        needAlphaBlending: true,
      },
    );
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_COMBINE;
    this.material = material;

    const right = new Vector3();
    const up = new Vector3();
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const mesh = this.mesh;
      if (!mesh) return;
      this.time += scene.getEngine().getDeltaTime() / 1000;
      mesh.isVisible = this.opacity > 0;
      const camera = scene.activeCamera;
      if (camera) {
        const view = camera.getViewMatrix();
        // Rows of the view matrix are the camera's axes in world space
        right.set(view.m[0], view.m[4], view.m[8]);
        up.set(view.m[1], view.m[5], view.m[9]);
        material.setVector3("cameraRight", right);
        material.setVector3("cameraUp", up);
        material.setVector2("sunOnScreen", screenDirection(this.toSun, right, up));
      }
      const s = this.settings;
      material.setVector3("wind", this.wind);
      material.setVector4("plume", new Vector4(s.rise, s.startSize, s.endSize, Math.max(0.5, s.life)));
      material.setFloat("time", this.time);
      material.setColor3("color", this.color);
      material.setColor3("litColor", this.litColor);
      material.setFloat("opacity", this.opacity);
    });
  }

  /** Direction the sunlight travels (pointing down); puffs are lit on the side facing the sun. */
  setSun(direction: Vector3): void {
    this.toSun.copyFrom(direction).scaleInPlace(-1).normalize();
  }

  /** Add plumes rising from these points; the mesh is rebuilt once per call. */
  add(origins: readonly Vector3[]): void {
    this.origins.push(...origins.map((origin) => origin.clone()));
    this.rebuild();
  }

  get count(): number {
    return this.origins.length;
  }

  private rebuild(): void {
    this.mesh?.dispose();
    this.mesh = null;
    if (!this.origins.length) return;
    const puffs = Math.max(1, Math.round(this.settings.puffs));
    const positions: number[] = [];
    const uvs: number[] = [];
    const extra: number[] = [];
    const indices: number[] = [];
    let quad = 0;
    this.origins.forEach((origin, plume) => {
      const seed = fract(Math.sin(plume * 91.7 + origin.x * 0.013) * 43758.5453);
      for (let i = 0; i < puffs; i++) {
        const random = fract(Math.sin((plume * 37 + i) * 12.9898) * 43758.5453);
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]) {
          positions.push(origin.x, origin.y, origin.z);
          uvs.push(u, v);
          extra.push((i + seed) / puffs, random, seed);
        }
        const base = quad * 4;
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        quad++;
      }
    });
    const mesh = new Mesh("smokePlumes", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = indices;
    data.applyToMesh(mesh, false);
    mesh.setVerticesBuffer(new VertexBuffer(this.scene.getEngine(), extra, "puff", false, false, 3));
    mesh.material = this.material;
    // The shader moves puffs away from their origins, so bounds would lie
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    this.mesh = mesh;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.mesh?.dispose();
    this.mesh = null;
    this.material.dispose();
    this.origins.length = 0;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** A world direction as a 2D screen direction (x right, y up), normalised. */
function screenDirection(direction: Vector3, right: Vector3, up: Vector3): Vector2 {
  const x = Vector3.Dot(direction, right);
  const y = Vector3.Dot(direction, up);
  const l = Math.hypot(x, y) || 1;
  return new Vector2(x / l, y / l);
}
