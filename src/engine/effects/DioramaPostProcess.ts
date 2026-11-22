/**
 * The diorama pass: one full-screen post-process for the HD-2D look, run on
 * the HDR scene colour before SHAG's DefaultRenderingPipeline (bloom, image
 * processing, vignette) takes over.
 *
 *  1. Tilt-shift depth of field. Each pixel's blur radius grows with its
 *     camera-space distance from a focus plane, so the diorama reads as a
 *     miniature: a sharp band around what the camera looks at, soft near and
 *     far. A gather blur over a golden-angle disc; a sample nearer the camera
 *     than the pixel only counts if its own blur reaches it, so sharp edges do
 *     not halo into a blurred background.
 *  2. Mist: distance fog towards a haze colour, starting behind the focus band.
 *  3. Height haze: a low-lying haze, thickest near the ground and behind
 *     the focus, glowing towards the sun (world height rebuilt from depth).
 *  4. Grade: saturation, a split tone (cool shadows, warm highlights) and
 *     contrast; then the mood grade (blended profiles: matrix, lift / gamma /
 *     gain, tint, lookup tables), a shaped vignette, and film grain.
 *
 * Depth comes from the pass's own `DepthRenderer` (camera-space Z), as SHAG's
 * CelOutline does, because the scene's shared depth renderer may belong to
 * another effect. Attaching a post-process to the camera directly breaks
 * DefaultRenderingPipeline's ordering, so this calls
 * `PostProcessingManager.rebuild()` after attaching (the engine's rule; see
 * PostProcessingManager.rebuild). The pass is then first and the pipeline runs
 * after it.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type GradeState, neutralGrade } from "./GradeProfiles";

const NEUTRAL = neutralGrade();

import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import type { Scene } from "@babylonjs/core/scene";
import { PostProcessingManager } from "./PostProcessingManager";

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec2 texelSize;
// x: focus distance, y: half width of the sharp band, z: falloff to full blur, w: far clamp
uniform vec4 focus;
uniform float maxBlur;
uniform vec3 mistColor;
// x: density per focus distance, y: start (distance), z: maximum amount
uniform vec3 mist;
// x: saturation, y: split-tone strength
uniform vec2 grade;
// x: contrast around mid grey (1 = none), y: near blur scale
uniform vec2 shape;
uniform vec3 shadowTint;
// Share of the mist the sky (no depth) gets
uniform float skyMist;
uniform vec3 highlightTint;
// Height haze. x: amount, y: base height, z: height falloff, w: distance per focus distance
uniform vec4 haze;
uniform vec3 hazeColor;
// xyz: direction towards the sun (world), w: glow strength
uniform vec4 sunGlow;
uniform mat4 invView;
// tan of half the field of view, x and y
uniform vec2 viewScale;
// x: grain amount, y: frame seed
uniform vec2 grain;
// Mood grade (GradeProfiles): matrix rows, lift, 1/gamma, gain, tint
uniform vec3 gradeR;
uniform vec3 gradeG;
uniform vec3 gradeB;
uniform vec3 gradeLift;
uniform vec3 gradeGammaInv;
uniform vec3 gradeGain;
uniform vec3 gradeTint;
// x: saturation, y: contrast, z: exposure multiplier
uniform vec3 gradeShape;
// Vignette. x: amount, y: inner radius, z: outer radius, w: roundness (1 = circle)
uniform vec4 vignette;
uniform vec3 vignetteColor;
uniform float aspect;
uniform sampler2D lutA;
uniform sampler2D lutB;
uniform vec2 lutAmounts;

// A 16x16x16 lookup table laid out as a 256x16 strip (blue slices left to right)
vec3 lookup(sampler2D lut, vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * 15.0;
  float s0 = floor(b);
  float s1 = min(s0 + 1.0, 15.0);
  float y = (c.g * 15.0 + 0.5) / 16.0;
  vec3 a0 = texture2D(lut, vec2((s0 * 16.0 + c.r * 15.0 + 0.5) / 256.0, y)).rgb;
  vec3 a1 = texture2D(lut, vec2((s1 * 16.0 + c.r * 15.0 + 0.5) / 256.0, y)).rgb;
  return mix(a0, a1, b - s0);
}

float sceneDepth(vec2 uv) {
  float z = texture2D(depthSampler, uv).r;
  // 0 is the clear value: nothing drawn (sky)
  return z <= 0.0 ? focus.w : min(z, focus.w);
}

float blurOf(float z) {
  // Nearer than focus blurs faster: the soft foreground of a miniature photo
  float d = (z < focus.x ? (focus.x - z) * shape.y : z - focus.x) - focus.y;
  return clamp(d / focus.z, 0.0, 1.0) * maxBlur;
}

void main(void) {
  float z = sceneDepth(vUV);
  float radius = blurOf(z);
  vec3 color = texture2D(textureSampler, vUV).rgb;

  if (radius > 0.5) {
    vec3 sum = color;
    float weight = 1.0;
    const int TAPS = 32;
    for (int i = 0; i < TAPS; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / float(TAPS)) * radius;
      float a = fi * 2.39996323;
      vec2 uv = vUV + vec2(cos(a), sin(a)) * r * texelSize;
      float zs = sceneDepth(uv);
      // Behind us: always part of our blur. In front: only if its own blur reaches us.
      float w = zs >= z - 1.0 ? 1.0 : smoothstep(r - 1.0, r + 1.0, blurOf(zs));
      sum += texture2D(textureSampler, uv).rgb * w;
      weight += w;
    }
    color = sum / weight;
  }

  float behind = max(0.0, z - mist.y);
  float fog = (1.0 - exp(-behind * mist.x / focus.x)) * mist.z;
  if (z >= focus.w) fog = mist.z * skyMist;
  color = mix(color, mistColor, fog);

  if (haze.x > 0.0) {
    vec3 ray = vec3((vUV.x * 2.0 - 1.0) * viewScale.x, (vUV.y * 2.0 - 1.0) * viewScale.y, 1.0);
    vec3 world = (invView * vec4(ray * z, 1.0)).xyz;
    vec3 dir = normalize((invView * vec4(ray, 0.0)).xyz);
    float low = z >= focus.w ? 0.0 : exp(-max(0.0, world.y - haze.y) / max(1.0, haze.z));
    // Builds behind the focus, so what the camera looks at stays clear
    float far = 1.0 - exp(-max(0.0, z - focus.x * 0.8) * haze.w / focus.x);
    float glow = pow(max(0.0, dot(dir, sunGlow.xyz)), 5.0) * sunGlow.w;
    float h = clamp(haze.x * low * far * (1.0 + glow), 0.0, 1.0);
    color = mix(color, hazeColor * (1.0 + glow), h);
  }

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(vec3(0.0), mix(vec3(luma), color, grade.x));
  vec3 tone = mix(shadowTint, highlightTint, smoothstep(0.05, 0.6, luma));
  color *= mix(vec3(1.0), tone, grade.y);
  // Photographic contrast in linear light: a power curve pivoting on mid grey
  color = 0.18 * pow(max(color, vec3(0.0)) / 0.18, vec3(shape.x));

  // Mood grade
  color = vec3(dot(gradeR, color), dot(gradeG, color), dot(gradeB, color)) * gradeShape.z;
  color = max(color * gradeGain + gradeLift * (1.0 - clamp(color, 0.0, 1.0)), vec3(0.0));
  color = pow(color, gradeGammaInv);
  float gl = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(vec3(0.0), mix(vec3(gl), color, gradeShape.x)) * gradeTint;
  color = 0.18 * pow(max(color, vec3(0.0)) / 0.18, vec3(gradeShape.y));
  if (lutAmounts.x > 0.0) color = mix(color, lookup(lutA, color), lutAmounts.x);
  if (lutAmounts.y > 0.0) color = mix(color, lookup(lutB, color), lutAmounts.y);

  if (vignette.x > 0.0) {
    vec2 q = (vUV - 0.5) * 2.0;
    q.x *= mix(1.0, aspect, vignette.w);
    float v = smoothstep(vignette.y, vignette.z, length(q));
    color = mix(color, vignetteColor, clamp(v * vignette.x, 0.0, 1.0));
  }

  if (grain.x > 0.0) {
    // Per-pixel, per-frame noise, strongest in the midtones and gone in the highlights
    float n = fract(sin(dot(floor(gl_FragCoord.xy) + grain.y * vec2(17.31, 41.13), vec2(12.9898, 78.233))) * 43758.5453);
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color *= 1.0 + (n - 0.5) * grain.x * (1.0 - smoothstep(0.35, 1.4, l));
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

export interface DioramaPostProcessSettings {
  /** Maximum blur radius in pixels at 720 lines (scaled with the screen). 0 turns depth of field off. */
  blur: number;
  /** Half width of the sharp band, as a share of the focus distance. */
  focusBand: number;
  /** Distance from the band's edge to full blur, as a share of the focus distance. */
  falloff: number;
  /** Mist density per focus distance behind the start; 0 turns it off. */
  mistDensity: number;
  /** Where mist starts, as a share of the focus distance. */
  mistStart: number;
  /** Most mist a pixel can get (0..1). */
  mistMax: number;
  mistColor: Color3;
  /** How much of the most mist the sky gets (0 keeps the sky clear). */
  skyMist: number;
  saturation: number;
  /** Split tone strength: cool shadows, warm highlights (0 = none). */
  splitTone: number;
  /** Contrast around mid grey: 1 = none, above 1 deepens shadows and lifts highlights. */
  contrast: number;
  /** Blur in front of the focus grows this much faster than behind it. */
  nearBlur: number;
  /** Split tone colours for dark and bright pixels. */
  shadowTint: Color3;
  highlightTint: Color3;
  /** Height haze amount (0 = off). */
  hazeAmount: number;
  /** World height where the haze is thickest. */
  hazeBase: number;
  /** Height over which the haze thins to a third, world units. */
  hazeHeight: number;
  /** How fast the haze builds with distance, per focus distance. */
  hazeDistance: number;
  hazeColor: Color3;
  /** Direction the sunlight travels (pointing down), for the haze's glow towards the sun. */
  sunDirection: Vector3;
  /** How much brighter and thicker the haze gets looking towards the sun. */
  sunGlow: number;
  /** Film grain strength (0 = off). */
  grain: number;
  /** The blended mood grade (see GradeProfiles); neutral when left out. */
  grade?: GradeState;
  /** Lookup tables for `grade.luts`, in the same order. */
  lutTextures?: (BaseTexture | null)[];
  /** Vignette: darkness at the corners, inner and outer radius (1 = edge middle), roundness (1 = circle). */
  vignette: number;
  vignetteInner: number;
  vignetteOuter: number;
  vignetteRoundness: number;
  vignetteColor: Color3;
}

export const DEFAULT_PASS_SETTINGS: DioramaPostProcessSettings = {
  blur: 7,
  focusBand: 0.06,
  falloff: 0.3,
  mistDensity: 0.6,
  mistStart: 1.0,
  mistMax: 0.45,
  mistColor: new Color3(0.78, 0.84, 0.92),
  skyMist: 1,
  saturation: 1.15,
  splitTone: 0.6,
  contrast: 1,
  nearBlur: 1,
  shadowTint: new Color3(0.92, 0.97, 1.08),
  highlightTint: new Color3(1.07, 1.0, 0.9),
  hazeAmount: 0,
  hazeBase: 0,
  hazeHeight: 60,
  hazeDistance: 1,
  hazeColor: new Color3(0.9, 0.86, 0.78),
  sunDirection: new Vector3(0, -1, 0),
  sunGlow: 1,
  grain: 0,
  vignette: 0,
  vignetteInner: 0.6,
  vignetteOuter: 1.5,
  vignetteRoundness: 0.3,
  vignetteColor: new Color3(0, 0, 0),
};

export class DioramaPostProcess {
  private postProcess: PostProcess | null = null;
  private depth: DepthRenderer | null = null;
  private readonly settings: DioramaPostProcessSettings;
  private readonly invView = new Matrix();
  private frame = 0;
  private blankTexture: RawTexture | null = null;

  /** A 1x1 texture for unused LUT slots, so the samplers are always bound. */
  private blank(): RawTexture {
    this.blankTexture ??= RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, this.scene, false);
    return this.blankTexture;
  }

  /**
   * @param focusDistance Camera-space distance to keep sharp, read every frame
   *        (the orbit camera's radius: the distance to what it looks at).
   */
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly focusDistance: () => number,
    settings: Partial<DioramaPostProcessSettings> = {},
  ) {
    this.settings = { ...DEFAULT_PASS_SETTINGS, ...settings };
    Effect.ShadersStore.dioramaPostProcessFragmentShader = FRAGMENT;
  }

  get enabled(): boolean {
    return this.postProcess !== null;
  }

  get current(): Readonly<DioramaPostProcessSettings> {
    return this.settings;
  }

  set(partial: Partial<DioramaPostProcessSettings>): void {
    Object.assign(this.settings, partial);
  }

  enable(): void {
    if (this.postProcess) return;
    const engine = this.scene.getEngine();
    const caps = engine.getCaps();
    const type = caps.textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : caps.textureFloatRender
        ? Constants.TEXTURETYPE_FLOAT
        : Constants.TEXTURETYPE_UNSIGNED_BYTE;

    // Camera-space Z, cleared to 0 where nothing is drawn. Point sampling: a
    // filtered depth would blend a near edge into the far plane.
    const depth = new DepthRenderer(
      this.scene,
      type,
      this.camera,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      true,
      "diorama-depth",
    );
    const map = depth.getDepthMap();
    map.renderListPredicate = (mesh) =>
      mesh.isVisible && mesh.isEnabled() && !mesh.material?.needAlphaBlendingForMesh(mesh);
    this.camera.customRenderTargets.push(map);
    this.depth = depth;

    const pass = new PostProcess(
      "dioramaPostProcess",
      "dioramaPostProcess",
      [
        "texelSize",
        "focus",
        "maxBlur",
        "mistColor",
        "mist",
        "grade",
        "shape",
        "shadowTint",
        "highlightTint",
        "skyMist",
        "haze",
        "hazeColor",
        "sunGlow",
        "invView",
        "viewScale",
        "grain",
        "gradeR",
        "gradeG",
        "gradeB",
        "gradeLift",
        "gradeGammaInv",
        "gradeGain",
        "gradeTint",
        "gradeShape",
        "vignette",
        "vignetteColor",
        "aspect",
        "lutAmounts",
      ],
      ["depthSampler", "lutA", "lutB"],
      1.0,
      this.camera,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      engine,
      false,
      undefined,
      // Keep the HDR frame's precision, as SHAG's own passes do
      Constants.TEXTURETYPE_HALF_FLOAT,
    );
    pass.onApply = (effect) => {
      const s = this.settings;
      const f = Math.max(1, this.focusDistance());
      const height = pass.height || engine.getRenderHeight();
      effect.setFloat2("texelSize", 1 / (pass.width || engine.getRenderWidth()), 1 / height);
      effect.setFloat4("focus", f, s.focusBand * f, Math.max(1, s.falloff * f), this.camera.maxZ || 1e6);
      effect.setFloat("maxBlur", Math.max(0, s.blur) * (height / 720));
      effect.setColor3("mistColor", s.mistColor);
      effect.setFloat3("mist", Math.max(0, s.mistDensity), s.mistStart * f, Math.min(1, Math.max(0, s.mistMax)));
      effect.setFloat2("grade", s.saturation, s.splitTone);
      effect.setFloat2("shape", Math.max(0.1, s.contrast), Math.max(0, s.nearBlur));
      effect.setColor3("shadowTint", s.shadowTint);
      effect.setFloat("skyMist", Math.max(0, s.skyMist));
      effect.setColor3("highlightTint", s.highlightTint);
      effect.setTexture("depthSampler", map);
      effect.setFloat4("haze", Math.max(0, s.hazeAmount), s.hazeBase, s.hazeHeight, Math.max(0, s.hazeDistance));
      effect.setColor3("hazeColor", s.hazeColor);
      const toSun = s.sunDirection.normalizeToNew().scaleInPlace(-1);
      effect.setFloat4("sunGlow", toSun.x, toSun.y, toSun.z, Math.max(0, s.sunGlow));
      this.camera.getViewMatrix().invertToRef(this.invView);
      effect.setMatrix("invView", this.invView);
      const tanY = Math.tan((this.camera.fov || 0.8) / 2);
      effect.setFloat2("viewScale", tanY * ((pass.width || engine.getRenderWidth()) / height), tanY);
      const g = s.grade ?? NEUTRAL;
      const m = g.matrix;
      effect.setFloat3("gradeR", m[0], m[1], m[2]);
      effect.setFloat3("gradeG", m[3], m[4], m[5]);
      effect.setFloat3("gradeB", m[6], m[7], m[8]);
      effect.setFloat3("gradeLift", g.lift[0], g.lift[1], g.lift[2]);
      const inv = (x: number) => 1 / Math.max(0.05, x);
      effect.setFloat3("gradeGammaInv", inv(g.gamma[0]), inv(g.gamma[1]), inv(g.gamma[2]));
      effect.setFloat3("gradeGain", g.gain[0], g.gain[1], g.gain[2]);
      effect.setFloat3("gradeTint", g.tint[0], g.tint[1], g.tint[2]);
      effect.setFloat3("gradeShape", Math.max(0, g.saturation), Math.max(0.1, g.contrast), 2 ** g.exposure);
      // The profile's vignette adds to the base one and pulls its colour
      const extra = Math.max(0, g.vignette);
      const total = Math.max(0, s.vignette) + extra;
      const share = total > 0 ? extra / total : 0;
      const vc = s.vignetteColor;
      effect.setFloat4("vignette", total, s.vignetteInner, s.vignetteOuter, s.vignetteRoundness);
      effect.setFloat3(
        "vignetteColor",
        vc.r + (g.vignetteColor[0] - vc.r) * share,
        vc.g + (g.vignetteColor[1] - vc.g) * share,
        vc.b + (g.vignetteColor[2] - vc.b) * share,
      );
      effect.setFloat("aspect", (pass.width || engine.getRenderWidth()) / height);
      const luts = s.lutTextures ?? [];
      const lutA = luts[0] ?? null;
      const lutB = luts[1] ?? null;
      effect.setTexture("lutA", lutA ?? this.blank());
      effect.setTexture("lutB", lutB ?? this.blank());
      effect.setFloat2(
        "lutAmounts",
        lutA?.isReady() ? (g.luts[0]?.amount ?? 0) : 0,
        lutB?.isReady() ? (g.luts[1]?.amount ?? 0) : 0,
      );
      this.frame = (this.frame + 1) % 997;
      effect.setFloat2("grain", Math.max(0, s.grain), this.frame);
    };
    this.postProcess = pass;
    // The pipeline must be rebuilt on top of a pass attached behind its back
    PostProcessingManager.getInstance().rebuild();
  }

  disable(): void {
    if (!this.postProcess) return;
    this.postProcess.dispose(this.camera);
    this.postProcess = null;
    if (this.depth) {
      const map = this.depth.getDepthMap();
      const index = this.camera.customRenderTargets.indexOf(map);
      if (index >= 0) this.camera.customRenderTargets.splice(index, 1);
      this.depth.dispose();
      this.depth = null;
    }
    PostProcessingManager.getInstance().rebuild();
  }
}
