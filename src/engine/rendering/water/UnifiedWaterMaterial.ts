/**
 * One water material for every liquid surface in every map.
 *
 * The compatibility position this whole feature rests on: rather than teaching
 * the Q3 shader translator one more vendor keyword at a time — QFusion cubemap
 * conditionals, `tesssize`, per-map blend stages — a surface identified as
 * liquid stops being translated at all and is drawn by this instead. Q3 and
 * Warsow water then look the same, deliberately, and both look modern.
 *
 * Tier 1 (Low) by the plan's ladder: animated normals, Fresnel reflection,
 * depth-tinted colour and an environment fallback, with **no extra scene
 * pass**. Refraction and planar reflection are Medium and Epic, and both need
 * a capture this deliberately does not take.
 *
 * BSP world meshes bake world-space vertices with an identity transform, so
 * `position` IS the world position — which is what lets adjacent meshes share
 * one continuous wave field with no seam at their boundary.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { generateWaterNormalMap, WATER_NOISE_SIZE } from "./WaterNoise";

export type WaterKind = "water" | "slime" | "lava";

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 viewProjection;

varying vec3 vWorld;
varying vec3 vNormal;

void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = viewProjection * worldPos;
}
`;

/**
 * Two scrolling samples at different scales and directions.
 *
 * One layer reads as a repeating pattern no matter how good the noise is; two
 * moving against each other never visibly repeat, which is the oldest trick
 * for water and still the cheapest.
 */
const FRAGMENT_SHADER = `
precision highp float;

varying vec3 vWorld;
varying vec3 vNormal;

uniform sampler2D uNoise;
uniform vec3 uCameraPosition;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform vec3 uSunDirection;
uniform float uTime;
uniform float uScale;
uniform float uScroll;
uniform float uWaveStrength;
uniform float uAlpha;
uniform float uEmissive;
uniform float uSpecular;

void main(void) {
  vec2 base = vWorld.xz * uScale;

  // Two layers moving against each other. Opposed directions and mismatched
  // rates make the beat between them long enough that the eye never finds the
  // loop; the second is finer and faster so there is chop riding on the swell.
  vec2 uv1 = base + vec2(uTime * uScroll, uTime * uScroll * 0.55);
  vec2 uv2 = base * 2.7 - vec2(uTime * uScroll * 0.8, -uTime * uScroll * 1.3);

  vec3 n1 = texture2D(uNoise, uv1).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNoise, uv2).rgb * 2.0 - 1.0;

  // Tangent space is world XZ for a surface that is essentially horizontal;
  // the geometric normal still decides which way is up so a sloped liquid
  // surface is shaded from its own plane rather than from world up.
  vec3 perturb = normalize(vec3((n1.x + n2.x * 0.6) * uWaveStrength, 1.0, (n1.y + n2.y * 0.6) * uWaveStrength));
  vec3 n = normalize(mix(vNormal, perturb, 0.85));

  vec3 viewDir = normalize(uCameraPosition - vWorld);
  float facing = clamp(dot(viewDir, n), 0.0, 1.0);

  // Schlick-ish Fresnel. Looking straight down you see into the water;
  // at a grazing angle it turns to a sheet of reflected light.
  float fresnel = pow(1.0 - facing, 3.0);

  vec3 body = mix(uDeepColor, uShallowColor, facing);

  // Fresnel drives COLOUR, not just opacity. This is what makes the waves
  // visible at all: each ripple tilts the normal, which changes how much sky
  // that pixel reflects, so the surface reads as moving rather than as a
  // tinted pane with a pattern printed on it.
  vec3 lit = mix(body, uSkyColor, fresnel);

  // Sun glint. A broad lobe rather than a tight one — a mirror-sharp highlight
  // is invisible from almost every angle, and this is the thing that sells
  // "wet" when the camera is standing still.
  vec3 halfway = normalize(uSunDirection + viewDir);
  float spec = pow(clamp(dot(n, halfway), 0.0, 1.0), 24.0) * uSpecular;

  vec3 color = lit + vec3(spec) + body * uEmissive;
  // Grazing angles go opaque, which is both physically right and the thing
  // that stops a pool looking like coloured glass.
  float alpha = clamp(uAlpha + fresnel * (1.0 - uAlpha), 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
`;

let shadersRegistered = false;

function registerShaders(): void {
  if (shadersRegistered) return;
  Effect.ShadersStore.unifiedWaterVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.unifiedWaterFragmentShader = FRAGMENT_SHADER;
  shadersRegistered = true;
}

export interface WaterProfile {
  shallow: Color3;
  deep: Color3;
  /**
   * What the surface reflects at grazing angles.
   *
   * Not a real reflection — Medium tier owns that. It is the single value that
   * makes ripples visible, because Fresnel varies per pixel with the wave
   * normal and this is what it varies toward.
   */
  sky: Color3;
  /** Base opacity looking straight down; grazing angles always reach opaque. */
  alpha: number;
  /** UV per world unit. One noise tile spans `1 / scale` units. */
  scale: number;
  /**
   * How fast the wave pattern travels, in WORLD UNITS PER SECOND.
   *
   * Deliberately not a UV rate. The first version scrolled 0.013 UV/sec at a
   * scale where one tile spanned 182 units — 2.4 units/sec, which crossed
   * acidwdm2's pool in about 160 seconds and read as a still image. Expressing
   * it in world units makes "is this visibly moving?" a question anyone can
   * answer without doing the division.
   */
  waveSpeed: number;
  waveStrength: number;
  /** Self-illumination — zero for water, high for lava, which is its own light. */
  emissive: number;
  specular: number;
}

/**
 * Per-liquid tuning, all of it colour and coefficients.
 *
 * This is the point of one material: slime and lava are not separate systems
 * or separate art, they are this table with different numbers.
 */
export const WATER_PROFILES: Record<WaterKind, WaterProfile> = {
  water: {
    shallow: new Color3(0.11, 0.42, 0.52),
    deep: new Color3(0.02, 0.13, 0.22),
    // Bright, slightly cool: a bounce off the room rather than a real sky, and
    // most Q3 pools are indoors.
    sky: new Color3(0.62, 0.78, 0.88),
    alpha: 0.72,
    // One tile per ~90 units, so a pool a few hundred units across shows
    // several waves rather than one broad smear.
    scale: 0.011,
    waveSpeed: 26,
    waveStrength: 0.7,
    emissive: 0.0,
    specular: 1.0,
  },
  slime: {
    // Bright toxic green from a shader rule, not from the map's own texture.
    shallow: new Color3(0.29, 0.72, 0.1),
    deep: new Color3(0.06, 0.22, 0.03),
    sky: new Color3(0.55, 0.85, 0.3),
    alpha: 0.93,
    scale: 0.008,
    // Thicker than water, so it rolls rather than ripples.
    waveSpeed: 14,
    waveStrength: 0.85,
    emissive: 0.22,
    specular: 0.5,
  },
  lava: {
    shallow: new Color3(1.0, 0.46, 0.06),
    deep: new Color3(0.5, 0.08, 0.0),
    sky: new Color3(1.0, 0.72, 0.25),
    alpha: 1.0,
    scale: 0.006,
    // Slow and heavy: lava is viscous, and fast ripples read as water tinted red.
    waveSpeed: 7,
    waveStrength: 0.45,
    emissive: 0.85,
    specular: 0.15,
  },
};

/**
 * UV scroll rate for a profile.
 *
 * The shader works in UV; the profile is authored in world units. This is the
 * conversion, exported so a test can assert the surface actually moves at a
 * speed a player would notice.
 */
export function scrollRateFor(profile: WaterProfile): number {
  return profile.waveSpeed * profile.scale;
}

/** Scene-scoped noise texture — one for every water surface in the map. */
const noiseByScene = new WeakMap<Scene, RawTexture>();

function noiseTexture(scene: Scene): RawTexture {
  const existing = noiseByScene.get(scene);
  if (existing) return existing;

  const texture = RawTexture.CreateRGBATexture(
    generateWaterNormalMap(),
    WATER_NOISE_SIZE,
    WATER_NOISE_SIZE,
    scene,
    true,
    false,
    Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
  texture.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
  texture.name = "unified-water-noise";
  noiseByScene.set(scene, texture);
  return texture;
}

/** Drop the shared noise for a scene. Called when the last surface goes. */
export function disposeWaterNoise(scene: Scene): void {
  const texture = noiseByScene.get(scene);
  if (texture) {
    texture.dispose();
    noiseByScene.delete(scene);
  }
}

export interface UnifiedWaterMaterialOptions {
  /** Direction the sun comes FROM, for the specular lobe. */
  sunDirection?: Vector3;
}

/**
 * Build the material for one liquid kind.
 *
 * Returns null when the shader will not compile, so the caller can leave the
 * legacy material in place. A map that renders its old water is a far better
 * failure than a map with a hole where the water was.
 */
export function createUnifiedWaterMaterial(
  scene: Scene,
  kind: WaterKind,
  options: UnifiedWaterMaterialOptions = {},
): ShaderMaterial | null {
  registerShaders();

  try {
    const material = new ShaderMaterial(
      `unified-water-${kind}`,
      scene,
      { vertex: "unifiedWater", fragment: "unifiedWater" },
      {
        attributes: ["position", "normal"],
        uniforms: [
          "world",
          "viewProjection",
          "uCameraPosition",
          "uShallowColor",
          "uDeepColor",
          "uSkyColor",
          "uSunDirection",
          "uTime",
          "uScale",
          "uScroll",
          "uWaveStrength",
          "uAlpha",
          "uEmissive",
          "uSpecular",
        ],
        samplers: ["uNoise"],
        needAlphaBlending: true,
      },
    );

    const profile = WATER_PROFILES[kind];
    const sun = (options.sunDirection ?? new Vector3(0.4, 0.8, 0.3)).normalize();

    material.setTexture("uNoise", noiseTexture(scene) as unknown as Texture);
    material.setColor3("uShallowColor", profile.shallow);
    material.setColor3("uDeepColor", profile.deep);
    material.setColor3("uSkyColor", profile.sky);
    material.setVector3("uSunDirection", sun);
    material.setFloat("uScale", profile.scale);
    material.setFloat("uScroll", scrollRateFor(profile));
    material.setFloat("uWaveStrength", profile.waveStrength);
    material.setFloat("uAlpha", profile.alpha);
    material.setFloat("uEmissive", profile.emissive);
    material.setFloat("uSpecular", profile.specular);
    material.setFloat("uTime", 0);

    // Liquid is transparent and must not write depth, or the geometry under it
    // vanishes; and it is drawn from below as often as from above.
    material.alpha = profile.alpha;
    material.backFaceCulling = false;
    material.needDepthPrePass = false;

    return material;
  } catch (error) {
    console.warn(`[Water] Unified material failed to build for ${kind}; keeping the legacy surface`, error);
    return null;
  }
}
