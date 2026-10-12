/**
 * Warfork's atmospheric fog in GLSL (include/fog.glsl, Quake Z read as engine
 * Y), shared by AtmosphericFogPlugin and the effect ShaderMaterials. No
 * imports, so either side can load it first.
 */

/** Uniform names shared by the plugin (its UBO) and the shader materials. */
export const ATM_FOG_UNIFORMS = [
  "atmFogColor",
  "atmFogDist",
  "atmFogHeight",
  "atmFogSky",
  "atmFogSunColor",
  "atmFogSunParams",
];

/**
 * The evaluation: `vec4 atmFogEvaluate(vec3 worldPos, vec3 eye)` gives the fog
 * colour and its weight. Expects the `atmFog*` uniforms to be declared;
 * `ATMFOG_SKY` puts the point on Warfork's sky box at the sky height.
 */
export const ATM_FOG_EVALUATE_GLSL = `
vec4 atmFogEvaluate(vec3 worldPos, vec3 eye) {
  if (atmFogColor.a <= 0.0001) return vec4(0.0);
  vec3 dir = worldPos - eye;
  float dist = length(dir);
  if (dist <= 0.0001) return vec4(0.0);
  vec3 viewDir = dir / dist;
#ifdef ATMFOG_SKY
  dist = atmFogDist.y / max(max(abs(viewDir.x), abs(viewDir.y)), abs(viewDir.z));
  worldPos = eye + viewDir * dist;
#endif
  float factor = 1.0 - exp(-max(0.0, dist - atmFogDist.x) * atmFogDist.w);
  if (atmFogHeight.w > 0.5) factor *= clamp((worldPos.y - atmFogHeight.x) * atmFogHeight.z, 0.0, 1.0);
  factor = clamp(factor, 0.0, 1.0);
  vec3 fogColor = atmFogColor.rgb;
  if (atmFogSunParams.w > 0.0) {
    float sunDot = max(0.0, dot(viewDir, atmFogSunParams.xyz));
    fogColor += atmFogSunColor.rgb * pow(sunDot, atmFogSunColor.w) * atmFogSunParams.w * factor;
  }
  if (atmFogSky.w > 0.5) {
    float zenith = max(0.0, viewDir.y + atmFogSky.x);
    fogColor = mix(fogColor, atmFogColor.rgb, clamp(pow(zenith, atmFogSky.z) * atmFogSky.y, 0.0, 1.0));
  }
  return vec4(fogColor, factor * atmFogColor.a);
}
`;

/** Declarations and evaluation for a ShaderMaterial's fragment shader; the eye comes in `atmFogEye`. */
export const ATM_FOG_GLSL = `
${ATM_FOG_UNIFORMS.map((name) => `uniform vec4 ${name};`).join("\n")}
uniform vec3 atmFogEye;
${ATM_FOG_EVALUATE_GLSL}
`;
