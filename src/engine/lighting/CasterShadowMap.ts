/**
 * A sun shadow map that holds only moving casters (sprites, props), for maps
 * whose static shadows are already baked into lightmaps.
 *
 * Each frame it renders the casters' depth along the sun into a float target,
 * from an orthographic camera fitted around a point (the view's target). A
 * receiver (see `BspCasterShadowPlugin`) projects its world position with
 * `matrix` and compares depths. Alpha-tested casters cut their silhouette out
 * of their texture's alpha, so a sprite casts its own shape.
 *
 * Casters keep their own materials for the main view; this target draws them
 * with a small depth material. Billboarded meshes must not use Babylon's
 * billboard modes, which face whatever camera renders them (here the sun):
 * turn them towards the view camera yourself (`LitSprite` does).
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec3 sunDirection;
uniform float faceSun;
varying vec2 vUV;
varying float vDepth;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  if (faceSun > 0.5) {
    // Stand the quad across the sun about its own vertical axis, so a figure
    // casts its full silhouette whichever way it faces the view
    vec3 h = vec3(sunDirection.x, 0.0, sunDirection.z);
    h = dot(h, h) > 1e-6 ? normalize(h) : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(-h.z, 0.0, h.x);
    w = vec4(world[3].xyz + right * position.x * length(world[0].xyz) + vec3(0.0, position.y * length(world[1].xyz), 0.0), 1.0);
  }
  vec4 p = viewProjection * w;
  gl_Position = p;
  vUV = uv;
  vDepth = p.z / p.w * 0.5 + 0.5;
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying float vDepth;
uniform sampler2D alphaSampler;
uniform float useAlpha;
void main(void) {
  if (useAlpha > 0.5 && texture2D(alphaSampler, vUV).a < 0.5) discard;
  gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0);
}
`;

export class CasterShadowMap {
  readonly texture: RenderTargetTexture;
  readonly camera: FreeCamera;
  /** Light-space view-projection; receivers use the same `p.z / p.w * 0.5 + 0.5` depth. */
  readonly matrix = new Matrix();
  private readonly sun = new Vector3(0, -1, 0);
  private readonly materials = new Map<string, ShaderMaterial>();
  private readonly textureIds = new Map<BaseTexture, number>();
  private readonly casters: AbstractMesh[] = [];
  private halfExtent = 1000;

  constructor(
    private readonly scene: Scene,
    readonly size = 2048,
  ) {
    Effect.ShadersStore.casterShadowDepthVertexShader = VERTEX;
    Effect.ShadersStore.casterShadowDepthFragmentShader = FRAGMENT;

    const camera = new FreeCamera("casterShadowCamera", new Vector3(0, 1000, 0), scene, false);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.minZ = 1;
    camera.maxZ = 8000;
    this.camera = camera;

    const caps = scene.getEngine().getCaps();
    const type = caps.textureFloatRender
      ? Constants.TEXTURETYPE_FLOAT
      : caps.textureHalfFloatRender
        ? Constants.TEXTURETYPE_HALF_FLOAT
        : Constants.TEXTURETYPE_UNSIGNED_BYTE;
    const texture = new RenderTargetTexture(
      "casterShadowMap",
      size,
      scene,
      false,
      true,
      type,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
    );
    texture.activeCamera = camera;
    texture.clearColor = new Color4(1, 1, 1, 1);
    texture.renderList = this.casters;
    texture.refreshRate = 1;
    texture.wrapU = RenderTargetTexture.CLAMP_ADDRESSMODE;
    texture.wrapV = RenderTargetTexture.CLAMP_ADDRESSMODE;
    scene.customRenderTargets.push(texture);
    this.texture = texture;
  }

  /** Direction the sunlight travels (pointing down). */
  setSun(direction: Vector3): void {
    this.sun.copyFrom(direction).normalize();
    for (const material of this.materials.values()) material.setVector3("sunDirection", this.sun);
  }

  /** Direction the sunlight travels (normalised). */
  get sunDirection(): Vector3 {
    return this.sun;
  }

  /** Cover a square of `halfExtent` units around `center` (call each frame with the view's target). */
  fit(center: Vector3, halfExtent: number): void {
    this.halfExtent = halfExtent;
    const camera = this.camera;
    camera.orthoLeft = -halfExtent;
    camera.orthoRight = halfExtent;
    camera.orthoTop = halfExtent;
    camera.orthoBottom = -halfExtent;
    camera.position.copyFrom(center).subtractInPlace(this.sun.scale(camera.maxZ / 2));
    camera.setTarget(center);
    camera.getViewMatrix(true).multiplyToRef(camera.getProjectionMatrix(true), this.matrix);
  }

  /** World units per shadow texel at the current fit. */
  get texelSize(): number {
    return (this.halfExtent * 2) / this.size;
  }

  /** Depth units per world unit along the sun, for biasing. */
  get depthPerUnit(): number {
    return 1 / (this.camera.maxZ - this.camera.minZ);
  }

  /**
   * Draw `mesh` into the shadow map. `alpha` cuts its silhouette out of a
   * texture's alpha. `faceSun` is for upright quads (sprites): the shadow pass
   * turns the quad across the sun about its vertical axis, so a sprite facing
   * the view still casts its full shape instead of a sliver.
   */
  addCaster(mesh: AbstractMesh, alpha: BaseTexture | null = null, faceSun = false): void {
    if (this.casters.includes(mesh)) return;
    this.casters.push(mesh);
    this.texture.setMaterialForRendering(mesh, this.materialFor(alpha, faceSun));
  }

  removeCaster(mesh: AbstractMesh): void {
    const index = this.casters.indexOf(mesh);
    if (index >= 0) this.casters.splice(index, 1);
  }

  private materialFor(alpha: BaseTexture | null, faceSun: boolean): ShaderMaterial {
    let id = 0;
    if (alpha) {
      id = this.textureIds.get(alpha) ?? this.textureIds.size + 1;
      this.textureIds.set(alpha, id);
    }
    const key = `${id}:${faceSun ? 1 : 0}`;
    let material = this.materials.get(key);
    if (material) return material;
    material = new ShaderMaterial(
      "casterShadowDepth",
      this.scene,
      { vertex: "casterShadowDepth", fragment: "casterShadowDepth" },
      {
        attributes: ["position", "uv"],
        uniforms: ["world", "viewProjection", "useAlpha", "sunDirection", "faceSun"],
        samplers: ["alphaSampler"],
        needAlphaTesting: !!alpha,
      },
    );
    material.backFaceCulling = false;
    material.setFloat("useAlpha", alpha ? 1 : 0);
    material.setFloat("faceSun", faceSun ? 1 : 0);
    material.setVector3("sunDirection", this.sun);
    if (alpha) material.setTexture("alphaSampler", alpha);
    this.materials.set(key, material);
    return material;
  }

  dispose(): void {
    const index = this.scene.customRenderTargets.indexOf(this.texture);
    if (index >= 0) this.scene.customRenderTargets.splice(index, 1);
    this.texture.dispose();
    this.camera.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.textureIds.clear();
  }
}
