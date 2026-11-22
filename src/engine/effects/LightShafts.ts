/**
 * Soft beams of sunlight: additive quads that rise from a point on the ground
 * towards the sun, turned about their own axis to face the camera.
 *
 * The cheap, art-directed kind of light shaft (placed, not simulated): the
 * caller says where beams land; each is a single quad in one merged mesh with
 * one draw call. They fade in from the ground, fade out towards the sky, have
 * a few soft streaks and breathe slowly, so a row of them does not look
 * stamped. Depth-tested against the world (a house in front hides a beam) and
 * never written to depth, so depth-of-field and mist passes see through them.
 *
 * Nothing is drawn until `add` is called; `dispose` removes everything.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 shaft;
uniform mat4 viewProjection;
uniform vec3 eye;
uniform vec3 toSun;
varying vec2 vUV;
varying float vPhase;
void main(void) {
  vec3 mid = position + toSun * shaft.y * 0.5;
  vec3 side = cross(toSun, normalize(eye - mid));
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(1.0, 0.0, 0.0);
  vec3 p = position + toSun * (uv.y * shaft.y) + side * (uv.x * shaft.x * 0.5);
  gl_Position = viewProjection * vec4(p, 1.0);
  vUV = uv;
  vPhase = shaft.z;
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying float vPhase;
uniform vec3 color;
uniform float intensity;
uniform float time;
void main(void) {
  float across = 1.0 - abs(vUV.x);
  across = across * across * (3.0 - 2.0 * across);
  float streak = 0.6 + 0.4 * sin(vUV.x * 7.0 + vPhase * 19.0 + sin(time * 0.31 + vPhase * 5.0) * 1.5);
  float along = smoothstep(0.0, 0.18, vUV.y) * (1.0 - smoothstep(0.35, 1.0, vUV.y));
  float breathe = 0.7 + 0.3 * sin(time * 0.55 + vPhase * 6.2831);
  float a = across * streak * along * breathe * intensity;
  gl_FragColor = vec4(color * a, 1.0);
}
`;

export interface LightShaft {
  /** Where the beam meets the ground. */
  base: Vector3;
  /** Width across the beam, world units. */
  width: number;
  /** Length towards the sun, world units. */
  length: number;
}

export class LightShafts {
  readonly material: ShaderMaterial;
  /** Overall brightness; 0 hides the beams. */
  intensity = 0.3;
  readonly color = new Color3(1, 0.86, 0.62);
  private readonly toSun = new Vector3(0, 1, 0);
  private readonly shafts: LightShaft[] = [];
  private mesh: Mesh | null = null;
  private time = 0;
  private readonly observer: Observer<Scene>;

  constructor(private readonly scene: Scene) {
    Effect.ShadersStore.lightShaftVertexShader = VERTEX;
    Effect.ShadersStore.lightShaftFragmentShader = FRAGMENT;
    const material = new ShaderMaterial(
      "lightShafts",
      scene,
      { vertex: "lightShaft", fragment: "lightShaft" },
      {
        attributes: ["position", "uv", "shaft"],
        uniforms: ["viewProjection", "eye", "toSun", "color", "intensity", "time"],
        needAlphaBlending: true,
      },
    );
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_ONEONE;
    this.material = material;

    this.observer = scene.onBeforeRenderObservable.add(() => {
      const mesh = this.mesh;
      if (!mesh) return;
      this.time += scene.getEngine().getDeltaTime() / 1000;
      mesh.isVisible = this.intensity > 0;
      const camera = scene.activeCamera;
      if (camera) material.setVector3("eye", camera.globalPosition);
      material.setVector3("toSun", this.toSun);
      material.setColor3("color", this.color);
      material.setFloat("intensity", this.intensity);
      material.setFloat("time", this.time);
    });
  }

  /** Direction the sunlight travels (pointing down); beams rise against it. */
  setSun(direction: Vector3): void {
    this.toSun.copyFrom(direction).scaleInPlace(-1).normalize();
  }

  /** Add beams; the mesh is rebuilt once per call. */
  add(shafts: readonly LightShaft[]): void {
    this.shafts.push(...shafts);
    this.rebuild();
  }

  get count(): number {
    return this.shafts.length;
  }

  private rebuild(): void {
    this.mesh?.dispose();
    this.mesh = null;
    if (!this.shafts.length) return;
    const positions: number[] = [];
    const uvs: number[] = [];
    const extra: number[] = [];
    const indices: number[] = [];
    this.shafts.forEach((shaft, i) => {
      const phase = fract(Math.sin(i * 12.9898 + shaft.base.x * 0.017 + shaft.base.z * 0.031) * 43758.5453);
      for (const [x, y] of [
        [-1, 0],
        [1, 0],
        [1, 1],
        [-1, 1],
      ]) {
        positions.push(shaft.base.x, shaft.base.y, shaft.base.z);
        uvs.push(x, y);
        extra.push(shaft.width, shaft.length, phase);
      }
      const v = i * 4;
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    });
    const mesh = new Mesh("lightShafts", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = indices;
    data.applyToMesh(mesh, false);
    mesh.setVerticesBuffer(new VertexBuffer(this.scene.getEngine(), extra, "shaft", false, false, 3));
    mesh.material = this.material;
    // Vertices sit at the beams' feet until the shader stretches them, so bounds lie
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    this.mesh = mesh;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.mesh?.dispose();
    this.mesh = null;
    this.material.dispose();
    this.shafts.length = 0;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
