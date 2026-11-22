/**
 * Real-time caster shadows on lightmapped BSP surfaces.
 *
 * The light on SHAG's BSP world is baked: Qfusion maps go through
 * `BspBakedLightingPlugin` (`base * (lightmap + gloss + diffuseBase)`), Q3
 * maps through a Babylon lightmap used as a shadow map. A Babylon shadow
 * generator only darkens the scene lights' share, not the lightmap, which
 * carries nearly all the light, so a sprite's shadow barely shows. This
 * plugin runs last (priority 300, at the end of the fragment shader) and
 * darkens the final colour where a `CasterShadowMap` says a caster stands
 * between the surface and the sun. It can also lay drifting cloud shadows
 * (value noise projected along the sun onto the ground plane), the dappled
 * light of a sunny day.
 *
 * Off unless attached, and attached only by a game that asks for it, so a map
 * without casters renders exactly as before. When this moves into SHAG it
 * belongs behind a renderer cvar that defaults to off.
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CasterShadowMap } from "../../lighting/CasterShadowMap";

export interface CasterShadowSettings {
  /** 0 = invisible, 1 = black. */
  strength: number;
  /** Depth bias in world units along the sun. */
  bias: number;
  /** Filter radius in shadow texels (0 = hard edges). */
  softness: number;
  /** Drifting cloud shadows: darkness 0..1 (0 = off). */
  clouds?: number;
  /** Cloud size, world units per noise cell. */
  cloudScale?: number;
  /** Cloud drift, in noise cells (advance it over time). */
  cloudOffset?: { x: number; y: number };
  /**
   * Normal-map relief strength (0 = off). Babylon's standard material clamps
   * the real-time light at 1, and on a lit BSP surface the lights already sum
   * past that, so a bump map never shows. This shades the final colour by how
   * much the bumped normal faces the sun and sky compared with the surface's
   * own normal, so relief shows without changing the surface's overall light.
   */
  relief?: number;
}

export class BspCasterShadowPlugin extends MaterialPluginBase {
  static readonly NAME = "BspCasterShadow";

  constructor(
    material: Material,
    private readonly map: CasterShadowMap,
    private readonly settings: CasterShadowSettings,
  ) {
    // After BspBakedLighting (200), which sets the final colour at the same point
    super(material, BspCasterShadowPlugin.NAME, 300, { BSP_CASTER_SHADOW: false }, true, false);
    // Needed for hardBindForSubMesh, and must be set before the plugin is activated
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  private on = true;

  /** Switch the shadow term in or out of the shader (recompiles the material). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.on) return;
    this.on = enabled;
    this._enable(enabled);
    const material = this._material;
    const frozen = material.isFrozen;
    if (frozen) material.unfreeze();
    this.markAllDefinesAsDirty();
    if (frozen) material.getScene().onAfterRenderObservable.addOnce(() => material.freeze());
  }

  override getClassName(): string {
    return "BspCasterShadowPlugin";
  }

  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.BSP_CASTER_SHADOW = this.on;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("casterShadowSampler");
  }

  override getActiveTextures(textures: BaseTexture[]): void {
    textures.push(this.map.texture);
  }

  override getUniforms(language?: ShaderLanguage) {
    return {
      ubo: [
        { name: "casterShadowMatrix", size: 16, type: "mat4" },
        { name: "casterShadowParams", size: 4, type: "vec4" },
        { name: "casterCloudParams", size: 4, type: "vec4" },
        { name: "casterSunDirection", size: 4, type: "vec4" },
      ],
      fragment:
        language === ShaderLanguage.WGSL
          ? ""
          : "uniform mat4 casterShadowMatrix;\nuniform vec4 casterShadowParams;\nuniform vec4 casterCloudParams;\nuniform vec4 casterSunDirection;\n",
    };
  }

  // Hard bind: runs every draw even on frozen materials; the matrix follows the view
  override hardBindForSubMesh(buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const s = this.settings;
    buffer.updateMatrix("casterShadowMatrix", this.map.matrix);
    buffer.updateFloat4(
      "casterShadowParams",
      Math.max(0, Math.min(1, s.strength)),
      s.bias * this.map.depthPerUnit,
      1 / this.map.size,
      Math.max(0, s.softness),
    );
    const sun = this.map.sunDirection;
    buffer.updateFloat4(
      "casterCloudParams",
      Math.max(0, Math.min(1, s.clouds ?? 0)),
      1 / Math.max(1, s.cloudScale ?? 600),
      s.cloudOffset?.x ?? 0,
      s.cloudOffset?.y ?? 0,
    );
    buffer.updateFloat4("casterSunDirection", sun.x, sun.y, sun.z, Math.max(0, s.relief ?? 0));
    buffer.setTexture("casterShadowSampler", this.map.texture);
  }

  override getCustomCode(shaderType: string, language?: ShaderLanguage): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    if (language === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `var casterShadowSampler: texture_2d<f32>;
var casterShadowSamplerSampler: sampler;
fn csHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn csNoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(csHash(i), csHash(i + vec2f(1.0, 0.0)), f.x), mix(csHash(i + vec2f(0.0, 1.0)), csHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}`,
        CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef BSP_CASTER_SHADOW
{
  let csClip = uniforms.casterShadowMatrix * vec4f(fragmentInputs.vPositionW, 1.0);
  let csNdc = csClip.xyz / csClip.w;
  let csUV = vec2f(csNdc.x * 0.5 + 0.5, csNdc.y * 0.5 + 0.5);
  let csDepth = csNdc.z * 0.5 + 0.5 - uniforms.casterShadowParams.y;
  let csStep = uniforms.casterShadowParams.z * uniforms.casterShadowParams.w;
  var csShadow = 0.0;
  for (var i = 0; i < 4; i++) {
    let csOffset = vec2f(select(-0.5, 0.5, (i & 1) == 1), select(-0.5, 0.5, (i & 2) == 2)) * csStep;
    let csCaster = textureSampleLevel(casterShadowSampler, casterShadowSamplerSampler, csUV + csOffset, 0.0).r;
    csShadow += select(0.0, 0.25, csDepth > csCaster);
  }
  let csInside = csUV.x > 0.0 && csUV.x < 1.0 && csUV.y > 0.0 && csUV.y < 1.0;
  color = vec4f(color.rgb * (1.0 - uniforms.casterShadowParams.x * select(0.0, csShadow, csInside)), color.a);
#ifdef NORMAL
  if (uniforms.casterSunDirection.w > 0.0) {
    let csL = -normalize(uniforms.casterSunDirection.xyz);
    let csGeom = normalize(fragmentInputs.vNormalW);
    let csBumped = (0.35 + 0.65 * max(dot(normalW, csL), 0.0) + 0.3 * normalW.y);
    let csFlat = (0.35 + 0.65 * max(dot(csGeom, csL), 0.0) + 0.3 * csGeom.y);
    let csRelief = clamp(csBumped / max(csFlat, 0.05), 0.4, 1.8);
    color = vec4f(color.rgb * mix(1.0, csRelief, uniforms.casterSunDirection.w), color.a);
  }
#endif
  if (uniforms.casterCloudParams.x > 0.0) {
    let csSun = uniforms.casterSunDirection.xyz;
    let csGround = fragmentInputs.vPositionW.xz - csSun.xz * (fragmentInputs.vPositionW.y / min(csSun.y, -0.05));
    let csQ = csGround * uniforms.casterCloudParams.y + uniforms.casterCloudParams.zw;
    let csN = csNoise(csQ) * 0.55 + csNoise(csQ * 2.03 + 17.0) * 0.3 + csNoise(csQ * 4.1 + 31.0) * 0.15;
    color = vec4f(color.rgb * (1.0 - uniforms.casterCloudParams.x * smoothstep(0.42, 0.68, csN)), color.a);
  }
}
#endif
`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `uniform sampler2D casterShadowSampler;
float csHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float csNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(csHash(i), csHash(i + vec2(1.0, 0.0)), f.x), mix(csHash(i + vec2(0.0, 1.0)), csHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef BSP_CASTER_SHADOW
{
  vec4 csClip = casterShadowMatrix * vec4(vPositionW, 1.0);
  vec3 csNdc = csClip.xyz / csClip.w;
  vec2 csUV = csNdc.xy * 0.5 + 0.5;
  float csDepth = csNdc.z * 0.5 + 0.5 - casterShadowParams.y;
  float csStep = casterShadowParams.z * casterShadowParams.w;
  float csShadow = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 csOffset = vec2(mod(float(i), 2.0) - 0.5, float(i / 2) - 0.5) * csStep;
    float csCaster = texture2D(casterShadowSampler, csUV + csOffset).r;
    csShadow += csDepth > csCaster ? 0.25 : 0.0;
  }
  if (csUV.x > 0.0 && csUV.x < 1.0 && csUV.y > 0.0 && csUV.y < 1.0)
    color.rgb *= 1.0 - casterShadowParams.x * csShadow;
#ifdef NORMAL
  if (casterSunDirection.w > 0.0) {
    vec3 csL = -normalize(casterSunDirection.xyz);
    vec3 csGeom = normalize(vNormalW);
    float csBumped = 0.35 + 0.65 * max(dot(normalW, csL), 0.0) + 0.3 * normalW.y;
    float csFlat = 0.35 + 0.65 * max(dot(csGeom, csL), 0.0) + 0.3 * csGeom.y;
    float csRelief = clamp(csBumped / max(csFlat, 0.05), 0.4, 1.8);
    color.rgb *= mix(1.0, csRelief, casterSunDirection.w);
  }
#endif
  if (casterCloudParams.x > 0.0) {
    vec3 csSun = casterSunDirection.xyz;
    vec2 csGround = vPositionW.xz - csSun.xz * (vPositionW.y / min(csSun.y, -0.05));
    vec2 csQ = csGround * casterCloudParams.y + casterCloudParams.zw;
    float csN = csNoise(csQ) * 0.55 + csNoise(csQ * 2.03 + 17.0) * 0.3 + csNoise(csQ * 4.1 + 31.0) * 0.15;
    color.rgb *= 1.0 - casterCloudParams.x * smoothstep(0.42, 0.68, csN);
  }
}
#endif
`,
    };
  }
}

/**
 * Attach caster shadows to every lightmapped BSP world material: SHAG's
 * Qfusion path (`BspBakedLightingPlugin`) and its Q3 path (a Babylon
 * `lightmapTexture` used as a shadow map, on meshes that carry a
 * `lightmapIndex`). Returns the plugins, so they can be switched off.
 */
export function attachCasterShadows(
  scene: Scene,
  map: CasterShadowMap,
  settings: CasterShadowSettings,
): BspCasterShadowPlugin[] {
  const targets = new Set<Material>();
  for (const material of scene.materials) {
    if (material.pluginManager?.getPlugin("BspBakedLighting")) targets.add(material);
  }
  for (const mesh of scene.meshes) {
    const material = mesh.material;
    if (!material || (mesh.metadata?.lightmapIndex ?? -1) < 0) continue;
    if ((material as Material & { lightmapTexture?: unknown }).lightmapTexture) targets.add(material);
  }
  const plugins: BspCasterShadowPlugin[] = [];
  for (const material of targets) {
    if (material.pluginManager?.getPlugin(BspCasterShadowPlugin.NAME)) continue;
    const frozen = material.isFrozen;
    if (frozen) material.unfreeze();
    plugins.push(new BspCasterShadowPlugin(material, map, settings));
    material.markDirty(true);
    // Re-freeze once the new effect has compiled
    if (frozen) scene.onAfterRenderObservable.addOnce(() => material.freeze());
  }
  return plugins;
}
