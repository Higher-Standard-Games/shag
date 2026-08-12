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
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { generateWaterNormalMap, WATER_NOISE_SIZE } from "./WaterNoise";

export type WaterKind = "water" | "slime" | "lava";

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;

void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  // Distance from the eye along the view axis, to compare against the scene
  // depth behind this fragment.
  //
  // NOT negated. Babylon is left-handed — +Z is forward — and its depth
  // renderer stores view-space Z raw, so this has to match it exactly.
  // Negating it, the OpenGL habit, made thickness come out as roughly twice
  // the view distance instead of the gap between two surfaces: absorption
  // saturated everywhere, the pool was uniformly at its deep colour and its
  // deep opacity, and the debug view was a flat white rectangle.
  vViewDepth = (view * worldPos).z;
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
varying float vViewDepth;

uniform sampler2D uNoise;
uniform sampler2D uSceneDepth;
uniform vec2 uScreenSize;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform vec3 uSunDirection;
uniform vec3 uAbsorbTint;
uniform float uTime;
uniform float uScale;
uniform float uScroll;
uniform float uWaveStrength;
uniform float uAlpha;
uniform float uMinAlpha;
uniform float uEmissive;
uniform float uSpecular;
uniform float uReflectivity;
uniform float uCameraFar;
uniform float uAbsorb;
uniform float uHasDepth;
uniform float uDebug;
uniform float uFoam;
uniform float uFoamWidth;
uniform float uCaustics;

void main(void) {
  vec2 base = vWorld.xz * uScale;

  // Two layers, the second ROTATED rather than merely offset and rescaled.
  // Two layers translating along nearby axes read as a conveyor, because the
  // eye locks onto the shared direction. Rotating one by an angle that is not
  // a fraction of a right angle removes the common axis, and what is left is
  // interference that churns without offering a direction to follow.
  const mat2 SWIRL = mat2(0.5403, -0.8415, 0.8415, 0.5403);
  vec2 uv1 = base + vec2(uTime * uScroll, uTime * uScroll * 0.55);
  vec2 uv2 = SWIRL * base * 2.3 - vec2(uTime * uScroll * 0.75, -uTime * uScroll * 1.15);

  vec3 n1 = texture2D(uNoise, uv1).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNoise, uv2).rgb * 2.0 - 1.0;

  // Tangent space is world XZ for a surface that is essentially horizontal;
  // the geometric normal still decides which way is up, so a sloped liquid
  // surface is shaded from its own plane rather than from world up.
  vec3 perturb = normalize(vec3((n1.x + n2.x * 0.6) * uWaveStrength, 1.0, (n1.y + n2.y * 0.6) * uWaveStrength));
  vec3 n = normalize(mix(vNormal, perturb, 0.85));

  vec3 viewDir = normalize(uCameraPosition - vWorld);
  float facing = clamp(dot(viewDir, n), 0.0, 1.0);

  // Capped Fresnel. What comes back is one flat colour standing in for a room,
  // and a strong reflection of a flat colour is glare rather than a reflection.
  float fresnel = pow(1.0 - facing, 4.0) * uReflectivity;

  // How much liquid the view ray crosses, and what survives the crossing.
  //
  // Per channel, because water eats red about three times faster than blue and
  // that ratio IS why water is blue-green. A scalar dims evenly, and a pale
  // floor dimmed evenly is still a pale floor.
  float thickness = 0.0;
  vec3 transmittance = vec3(0.0);
  if (uHasDepth > 0.5) {
    vec2 screenUv = gl_FragCoord.xy / uScreenSize;
    // View-space Z in world units, straight out of the depth map. No
    // reconstruction: the renderer is asked to store camera-space Z precisely
    // so this line cannot be subtly wrong in a way that still renders.
    float sceneDepth = texture2D(uSceneDepth, screenUv).r;
    thickness = max(0.0, sceneDepth - vViewDepth);
    transmittance = exp(-thickness * uAbsorb * uAbsorbTint);
  }
  // Green is the middle channel and the one the eye weights most, so it stands
  // in wherever a single number is needed.
  float absorbed = 1.0 - transmittance.g;

  // Shoreline foam, from the same thickness the absorption uses. Narrow
  // relative to the water it edges: a band wide enough to cover a shallow
  // pool stops marking the shoreline and simply paints the pool white.
  float foam = 0.0;
  if (uHasDepth > 0.5 && uFoam > 0.0) {
    float band = 1.0 - smoothstep(0.0, uFoamWidth, thickness);
    float churn = 0.65 + 0.35 * (n1.x + n2.y);
    foam = clamp(band * churn, 0.0, 1.0) * uFoam;
  }

  // Caustics on the floor, sampled at the FLOOR's world position so the web
  // stays put as the camera moves. Anchored to screen space or to the surface
  // it swims with the player and reads as a texture on the water instead.
  //
  // The depth term is a difference of VIEW-space Z, so it is divided back out
  // along the ray to become a distance; without that a glancing view finds the
  // floor short and the caustics slide as the player turns.
  float caustics = 0.0;
  if (uHasDepth > 0.5 && uCaustics > 0.0) {
    vec3 rayDir = normalize(vWorld - uCameraPosition);
    float axis = max(0.15, dot(rayDir, uCameraForward));
    vec3 floorPos = vWorld + rayDir * (thickness / axis);
    vec2 cuv = floorPos.xz * uScale * 0.55;
    float c1 = texture2D(uNoise, cuv + vec2(uTime * uScroll * 0.35, uTime * uScroll * 0.2)).b;
    float c2 = texture2D(uNoise, cuv * 1.45 - vec2(uTime * uScroll * 0.25, -uTime * uScroll * 0.4)).b;
    // The ridge between two offset samples: focused light arrives in thin
    // filaments, and a plain noise product looks like dappled shade instead.
    float ridge = max(0.0, 1.0 - abs(c1 - c2) * 5.0);
    float reach = transmittance.g * min(1.0, thickness / 12.0);
    caustics = pow(ridge, 7.0) * reach * uCaustics;
  }

  if (uDebug > 0.5) {
    // No depth bound at all is RED. Both failures used to draw the same flat
    // black, so the one view meant to say whether depth reaches the shader
    // could not tell "the map says zero" from "there is no map".
    if (uHasDepth <= 0.5) {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      return;
    }
    if (uDebug < 1.5) {
      gl_FragColor = vec4(vec3(absorbed), 1.0);
      return;
    }
    // Bands an order of magnitude apart, with an exact zero called out. Grey
    // over 512 units could not tell a 40-unit pool from an empty depth map —
    // both drew near-black — and rounds of tuning were lost guessing between.
    vec3 band;
    if (thickness <= 0.0)       band = vec3(1.0, 0.0, 1.0);
    else if (thickness < 8.0)   band = vec3(1.0, 0.0, 0.0);
    else if (thickness < 32.0)  band = vec3(1.0, 1.0, 0.0);
    else if (thickness < 128.0) band = vec3(0.0, 1.0, 0.0);
    else if (thickness < 512.0) band = vec3(0.0, 1.0, 1.0);
    else                        band = vec3(1.0, 1.0, 1.0);
    gl_FragColor = vec4(band, 1.0);
    return;
  }

  // The water's OWN colour. What is behind it comes from the hardware blend
  // rather than from a captured copy of the scene: dst * (1 - alpha) IS the
  // transmittance term of Beer-Lambert, so the blend the GPU already does for
  // free is the same compositing an extra full-scene pass was buying.
  vec3 body = mix(uShallowColor, uDeepColor, absorbed);
  vec3 lit = mix(body, uSkyColor, fresnel);

  // Sun glint. A broad lobe rather than a tight one: a mirror-sharp highlight
  // is invisible from almost every angle, and this is what sells "wet" when
  // the camera is standing still.
  vec3 halfway = normalize(uSunDirection + viewDir);
  float spec = pow(clamp(dot(n, halfway), 0.0, 1.0), 24.0) * uSpecular;

  vec3 color = lit + vec3(spec) + body * uEmissive + uShallowColor * caustics;
  // Foam is white and opaque, and goes on last so it survives the tinting.
  color = mix(color, vec3(1.0), foam);

  // Opacity IS the absorption, capped by the profile so even deep water keeps
  // a trace of what is under it. Fresnel and foam sit on top; minAlpha stops a
  // shoreline vanishing into nothing at all.
  float alpha = clamp(absorbed, uMinAlpha, uAlpha);
  alpha = clamp(alpha + fresnel * (1.0 - alpha) + foam, 0.0, 1.0);

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
  /** Colour where the liquid is vanishingly thin — a shoreline, a puddle edge. */
  shallow: Color3;
  /** Colour where it is thick enough to hide its own floor. */
  deep: Color3;
  /**
   * What the surface reflects at grazing angles.
   *
   * Not a real reflection — Medium tier owns that. It is the single value that
   * makes ripples visible, because Fresnel varies per pixel with the wave
   * normal and this is what it varies toward.
   */
  sky: Color3;
  /** Opacity where the liquid is thick. Fresnel adds on top at grazing angles. */
  alpha: number;
  /**
   * Opacity where it is vanishingly thin.
   *
   * The number that makes water read as water: a shoreline you can see the
   * gravel through, rather than a sheet of coloured film laid over the map at
   * one uniform opacity.
   */
  minAlpha: number;
  /**
   * How strongly a shoreline foams, 0-1.
   *
   * Where water meets geometry it is arbitrarily thin, and a surface that just
   * fades out there reads as a rendering fault — the pool looks edgeless. Foam
   * is what makes the edge deliberate.
   */
  foam: number;
  /** World units of thickness over which the foam band fades out. */
  foamWidth: number;
  /**
   * Absorption per world unit of thickness.
   *
   * Higher means the floor disappears sooner. This replaces the old
   * angle-based tint, which gave a pool one flat colour no matter how deep it
   * was — the actual reason it kept reading as a dye.
   */
  absorb: number;
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
  /**
   * Ceiling on the Fresnel reflection, 0-1.
   *
   * Physical water reaches a full mirror at grazing angles. We reflect a flat
   * colour rather than the scene, so honouring that turned the far half of a
   * pool into a sheet of white. This bounds it.
   */
  reflectivity: number;
  /** Self-illumination — zero for water, high for lava, which is its own light. */
  emissive: number;
  specular: number;
  /**
   * Brightness of the caustic web cast on the floor beneath the surface.
   *
   * Water only in practice: caustics are focused light that made it through
   * the liquid, so an opaque one has none by definition.
   */
  caustics: number;
  /**
   * Per-channel multiplier on {@link LiquidProfile.absorb}.
   *
   * Water absorbs red roughly three times faster than blue, and that ratio IS
   * why water is blue-green. A single scalar makes it grey-out instead, which
   * over a pale floor comes out as a white sheet.
   */
  absorbTint: Color3;
}

/**
 * Per-liquid tuning, all of it colour and coefficients.
 *
 * This is the point of one material: slime and lava are not separate systems
 * or separate art, they are this table with different numbers.
 */
export const WATER_PROFILES: Record<WaterKind, WaterProfile> = {
  water: {
    // Thin water is barely there; thick water is a dark blue-green.
    //
    // More chroma than lightness in the shallow tint. Water over a pale floor
    // is genuinely pale — that part is physics — but a desaturated tint reads
    // as dirty glass, where a saturated one at the same lightness still reads
    // as water.
    shallow: new Color3(0.13, 0.42, 0.47),
    deep: new Color3(0.02, 0.12, 0.19),
    // Bright, slightly cool: a bounce off the room rather than a real sky, and
    // most Q3 pools are indoors.
    sky: new Color3(0.3, 0.4, 0.48),
    alpha: 0.8,
    minAlpha: 0.06,
    foam: 0.45,
    // In RAY LENGTH, not depth — the same units absorption uses.
    //
    // This has now been wrong in both directions. Twenty was invisible, so it
    // went to ninety; but a shallow pool presents well under ninety units of
    // ray across its WHOLE surface, so the band stopped marking the shoreline
    // and washed the entire pool white. Foam has to be narrow relative to the
    // water it edges: at 28 a shallow pool still has a middle.
    foamWidth: 28,
    // A grazing ray travels far further through a pool than the pool is deep,
    // so this is tuned against that rather than against vertical depth: at
    // 0.006 the middle of a pool saturated from any angle worth standing at.
    // Nudged up from 0.003 so a SHALLOW pool still picks up colour — at the
    // old value a shin-deep pad of water was effectively untinted, which is
    // most of why it read as a white sheet.
    // Tuned against the ray lengths Q3 pools ACTUALLY present.
    //
    // This was 0.0045, chosen from reasoning about deep water, and at that
    // value a wading pool absorbed 16% of red and 5% of blue over its whole
    // depth — optically it was clear glass, and what the player saw was the
    // pale concrete floor at ninety-odd percent strength. Every complaint
    // about the water being a white sheet traces here.
    //
    // At 0.022 the same 40 units of ray absorb 59/31/22, which is a clear
    // blue-green cast with the floor still legible through it. A deep pool
    // saturates sooner than before, and that is correct: 400 units is ten
    // metres of water and you do not see the bottom of that.
    absorb: 0.022,
    // One tile per ~90 units, so a pool a few hundred units across shows
    // several waves rather than one broad smear.
    scale: 0.011,
    waveSpeed: 13,
    // Stronger normals and a brighter glint. With absorption doing less work
    // in shallow water, the moving highlight is what is left to say the
    // surface is liquid rather than a pane laid over the floor.
    waveStrength: 0.6,
    reflectivity: 0.22,
    emissive: 0.0,
    specular: 0.3,
    caustics: 0.5,
    absorbTint: new Color3(1.0, 0.42, 0.28),
  },
  slime: {
    // Bright toxic green from a shader rule, not from the map's own texture.
    shallow: new Color3(0.29, 0.72, 0.1),
    deep: new Color3(0.06, 0.22, 0.03),
    sky: new Color3(0.42, 0.68, 0.22),
    alpha: 0.97,
    // Thicker than water even at its edge: slime is opaque in every game that
    // has it, and a see-through shoreline would read as dyed water.
    minAlpha: 0.5,
    // Thicker and stickier: slime crusts at its edge rather than foaming.
    foam: 0.4,
    foamWidth: 14,
    absorb: 0.03,
    scale: 0.008,
    // Thicker than water, so it rolls rather than ripples.
    waveSpeed: 8,
    waveStrength: 0.6,
    reflectivity: 0.35,
    emissive: 0.22,
    specular: 0.5,
    // Slime is opaque enough that nothing reaches a floor to be focused.
    caustics: 0.0,
    // Slime swallows blue instead, which is what keeps it green rather than
    // letting it drift toward water.
    absorbTint: new Color3(1.0, 0.35, 1.4),
  },
  lava: {
    shallow: new Color3(1.0, 0.46, 0.06),
    deep: new Color3(0.5, 0.08, 0.0),
    sky: new Color3(1.0, 0.72, 0.25),
    alpha: 1.0,
    // Opaque everywhere. There is no depth of lava you can see through.
    minAlpha: 1.0,
    // No foam. Lava does not lap at a shore, it crusts, and a white band
    // would read as steam it is not producing.
    foam: 0.0,
    foamWidth: 0,
    absorb: 0.5,
    scale: 0.006,
    // Slow and heavy: lava is viscous, and fast ripples read as water tinted red.
    // Slowest of the three by a wide margin, but still above the speed at
    // which a surface stops reading as moving at all. Viscosity comes from the
    // low wave strength and the emissive body, not from being imperceptible.
    waveSpeed: 6,
    waveStrength: 0.3,
    reflectivity: 0.25,
    emissive: 0.85,
    specular: 0.15,
    caustics: 0.0,
    // Opaque within a hair of the surface, evenly across the spectrum.
    absorbTint: new Color3(1.0, 1.0, 1.0),
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
          "view",
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
          "uMinAlpha",
          "uEmissive",
          "uSpecular",
          "uReflectivity",
          "uScreenSize",
          "uCameraFar",
          "uAbsorb",
          "uHasDepth",
          "uDebug",
          "uFoam",
          "uFoamWidth",
          "uCameraForward",
          "uCaustics",
          "uAbsorbTint",
        ],
        samplers: ["uNoise", "uSceneDepth"],
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
    material.setFloat("uMinAlpha", profile.minAlpha);
    material.setFloat("uAbsorb", profile.absorb);
    material.setFloat("uEmissive", profile.emissive);
    material.setFloat("uSpecular", profile.specular);
    material.setFloat("uReflectivity", profile.reflectivity);
    material.setFloat("uTime", 0);
    // Until a depth map is supplied the surface renders at full thickness,
    // which is its old flat look rather than a black or invisible one — a
    // driver that refuses the depth renderer degrades instead of breaking.
    material.setFloat("uHasDepth", 0);
    material.setFloat("uDebug", 0);
    material.setFloat("uFoam", profile.foam);
    material.setFloat("uFoamWidth", profile.foamWidth);
    material.setFloat("uCaustics", profile.caustics);
    material.setColor3("uAbsorbTint", profile.absorbTint);
    material.setVector3("uCameraForward", new Vector3(0, 0, 1));
    material.setFloat("uCameraFar", 10000);
    material.setVector2("uScreenSize", new Vector2(1920, 1080));

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
