/**
 * Warfork's atmospheric fog on Standard and PBR materials, GLSL and WGSL.
 *
 * Babylon's own EXP fog draws world fog's distance curve everywhere else (see
 * WorldFogController); this plugin draws the whole of Warfork's fog where it
 * reaches, which Babylon's fog cannot:
 *
 *   - each pass blends the way Warfork's r_backend_program.c does: an
 *     additive surface fades to black (`colour *= 1 - fog`), a filter fades
 *     toward white, everything else mixes toward the fog colour;
 *   - the sky is fogged at its height along the view, as Warfork's sky box
 *     scaled to the sky height, not at the sky mesh's radius;
 *   - the height band, the sun glow and the sky's horizon tint.
 *
 * The evaluation follows Warfork's include/fog.glsl with Quake Z read as
 * engine Y. While this plugin draws fog, Babylon's fog is off on the material;
 * when world fog lends the scene fog out (fog volumes, under water) the plugin
 * steps aside and Babylon's fog draws theirs.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { RegisterMaterialPlugin } from "@babylonjs/core/Materials/materialPluginManager";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { ATM_FOG_EVALUATE_GLSL, ATM_FOG_UNIFORMS } from "./AtmosphericFogGlsl";
import type { WorldFogController } from "./WorldFogController";

const ADDITIVE_MODES = new Set<number>([Constants.ALPHA_ADD, Constants.ALPHA_ONEONE, Constants.ALPHA_SCREENMODE]);
const FILTER_MODES = new Set<number>([Constants.ALPHA_MULTIPLY]);

/** Sky meshes: the far box or sky sphere, and the cloud layers. */
export const isSkyMesh = (mesh: AbstractMesh) => mesh.name === "skybox" || mesh.name.startsWith("skybox_cloud_");

/** How a material's pass combines with what is behind it, for fog. */
export function fogPassKind(material: Material, mesh: AbstractMesh): "mix" | "additive" | "filter" {
  const blends = material.needAlphaBlendingForMesh(mesh);
  if (!blends) return "mix";
  if (ADDITIVE_MODES.has(material.alphaMode)) return "additive";
  if (FILTER_MODES.has(material.alphaMode)) return "filter";
  return "mix";
}

const UNIFORMS = ATM_FOG_UNIFORMS;

const GLSL_EVALUATE = `
#ifdef ATMFOG
${ATM_FOG_EVALUATE_GLSL}
#endif
`;

const WGSL_EVALUATE = `
#ifdef ATMFOG
fn atmFogEvaluate(worldPosIn: vec3f, eye: vec3f) -> vec4f {
  var worldPos = worldPosIn;
  let dir = worldPos - eye;
  var dist = length(dir);
  if (dist <= 0.0001) { return vec4f(0.0); }
  let viewDir = dir / dist;
#ifdef ATMFOG_SKY
  dist = uniforms.atmFogDist.y / max(max(abs(viewDir.x), abs(viewDir.y)), abs(viewDir.z));
  worldPos = eye + viewDir * dist;
#endif
  var factor = 1.0 - exp(-max(0.0, dist - uniforms.atmFogDist.x) * uniforms.atmFogDist.w);
  if (uniforms.atmFogHeight.w > 0.5) {
    factor *= clamp((worldPos.y - uniforms.atmFogHeight.x) * uniforms.atmFogHeight.z, 0.0, 1.0);
  }
  factor = clamp(factor, 0.0, 1.0);
  var fogColor = uniforms.atmFogColor.rgb;
  if (uniforms.atmFogSunParams.w > 0.0) {
    let sunDot = max(0.0, dot(viewDir, uniforms.atmFogSunParams.xyz));
    fogColor += uniforms.atmFogSunColor.rgb * pow(sunDot, uniforms.atmFogSunColor.w) * uniforms.atmFogSunParams.w * factor;
  }
  if (uniforms.atmFogSky.w > 0.5) {
    let zenith = max(0.0, viewDir.y + uniforms.atmFogSky.x);
    fogColor = mix(fogColor, uniforms.atmFogColor.rgb, clamp(pow(zenith, uniforms.atmFogSky.z) * uniforms.atmFogSky.y, 0.0, 1.0));
  }
  return vec4f(fogColor, factor * uniforms.atmFogColor.a);
}
#endif
`;

// Warfork blends in display (gamma) space. A material that leaves its colour
// linear for a later image-processing pass is moved to gamma, fogged, and back.
function glslApply(c: string): string {
  return `
#ifdef ATMFOG
vec4 atmFog = atmFogEvaluate(vPositionW, vEyePosition.xyz);
vec3 atmColor = ${c}.rgb;
#ifdef IMAGEPROCESSINGPOSTPROCESS
atmColor = pow(max(atmColor, vec3(0.0)), vec3(1.0 / 2.2));
#endif
#if defined(ATMFOG_FILTER)
atmColor = mix(atmColor, vec3(1.0), atmFog.a);
#elif defined(ATMFOG_ADDITIVE)
atmColor *= 1.0 - atmFog.a;
#else
atmColor = mix(atmColor, atmFog.rgb, atmFog.a);
#endif
#ifdef IMAGEPROCESSINGPOSTPROCESS
atmColor = pow(max(atmColor, vec3(0.0)), vec3(2.2));
#endif
${c}.rgb = atmColor;
#endif
`;
}

function wgslApply(c: string): string {
  return `
#ifdef ATMFOG
let atmFog = atmFogEvaluate(fragmentInputs.vPositionW, scene.vEyePosition.xyz);
var atmColor = ${c}.rgb;
#ifdef IMAGEPROCESSINGPOSTPROCESS
atmColor = pow(max(atmColor, vec3f(0.0)), vec3f(1.0 / 2.2));
#endif
#if defined(ATMFOG_FILTER)
atmColor = mix(atmColor, vec3f(1.0), atmFog.a);
#elif defined(ATMFOG_ADDITIVE)
atmColor = atmColor * (1.0 - atmFog.a);
#else
atmColor = mix(atmColor, atmFog.rgb, atmFog.a);
#endif
#ifdef IMAGEPROCESSINGPOSTPROCESS
atmColor = pow(max(atmColor, vec3f(0.0)), vec3f(2.2));
#endif
${c} = vec4f(atmColor, ${c}.a);
#endif
`;
}

export class AtmosphericFogPlugin extends MaterialPluginBase {
  private readonly finalColor: string;

  constructor(
    material: Material,
    private readonly controller: WorldFogController,
  ) {
    super(
      material,
      "AtmosphericFog",
      300,
      { ATMFOG: false, ATMFOG_SKY: false, ATMFOG_ADDITIVE: false, ATMFOG_FILTER: false },
      true,
      true,
    );
    this.finalColor = material instanceof PBRBaseMaterial ? "finalColor" : "color";
  }

  override getClassName(): string {
    return "AtmosphericFogPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL || shaderLanguage === ShaderLanguage.WGSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: unknown, mesh: AbstractMesh): void {
    const material = this._material as Material & { fogEnabled?: boolean };
    const on = this.controller.isDrawing() && mesh.applyFog && material.fogEnabled !== false;
    defines.ATMFOG = on;
    // Babylon's own fog would fog the result twice
    if (on) defines.FOG = false;
    const kind = on ? fogPassKind(material, mesh) : "mix";
    defines.ATMFOG_ADDITIVE = kind === "additive";
    defines.ATMFOG_FILTER = kind === "filter";
    defines.ATMFOG_SKY = on && isSkyMesh(mesh);
  }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    return {
      ubo: UNIFORMS.map((name) => ({ name, size: 4, type: "vec4" })),
      fragment:
        shaderLanguage === ShaderLanguage.WGSL
          ? ""
          : `#ifdef ATMFOG\n${UNIFORMS.map((name) => `uniform vec4 ${name};`).join("\n")}\n#endif\n`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const fog = this.controller.getActive();
    if (!fog) return;
    const height = fog.height;
    const sun = fog.sun;
    const sky = fog.sky;
    uniformBuffer.updateFloat4("atmFogColor", fog.color[0], fog.color[1], fog.color[2], 1);
    uniformBuffer.updateFloat4("atmFogDist", fog.minDist, this.controller.getSkyHeight(), 0, fog.density);
    uniformBuffer.updateFloat4(
      "atmFogHeight",
      height?.clear ?? 0,
      height?.full ?? 0,
      height ? 1 / (height.full - height.clear) : 0,
      height ? 1 : 0,
    );
    uniformBuffer.updateFloat4(
      "atmFogSky",
      sky?.horizonBias ?? 0,
      sky?.horizonScale ?? 0,
      sky?.zenithFalloff ?? 1,
      sky ? 1 : 0,
    );
    uniformBuffer.updateFloat4(
      "atmFogSunColor",
      sun?.color[0] ?? 0,
      sun?.color[1] ?? 0,
      sun?.color[2] ?? 0,
      sun?.exponent ?? 1,
    );
    uniformBuffer.updateFloat4(
      "atmFogSunParams",
      sun?.dir[0] ?? 0,
      sun?.dir[1] ?? 0,
      sun?.dir[2] ?? 0,
      sun?.intensity ?? 0,
    );
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== "fragment") return null;
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl ? WGSL_EVALUATE : GLSL_EVALUATE,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: wgsl ? wgslApply(this.finalColor) : glslApply(this.finalColor),
    };
  }
}

let registered = false;

/** Give every Standard and PBR material created from now on the world fog plugin. */
export function registerAtmosphericFogPlugin(controller: WorldFogController): void {
  if (registered) return;
  registered = true;
  RegisterMaterialPlugin("AtmosphericFog", (material) =>
    material instanceof StandardMaterial || material instanceof PBRBaseMaterial
      ? new AtmosphericFogPlugin(material, controller)
      : null,
  );
}
