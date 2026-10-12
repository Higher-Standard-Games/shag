/**
 * Warfork's atmospheric fog for the engine's own shaders: one GLSL evaluation
 * (include/fog.glsl, Quake Z read as engine Y) shared by AtmosphericFogPlugin
 * and the effect `ShaderMaterial`s, and the binding that feeds it.
 *
 * A ShaderMaterial adds `ATM_FOG_UNIFORMS` to its uniforms, `ATM_FOG_GLSL` to
 * its fragment shader, a world position varying, and one of the apply lines
 * for its blend; `bindAtmosphericFog` keeps the uniforms current. Without
 * world fog the colour's alpha is 0 and the evaluation adds nothing.
 */

import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ATM_FOG_GLSL, ATM_FOG_UNIFORMS } from "./AtmosphericFogGlsl";
import { WorldFogController } from "./WorldFogController";

export { ATM_FOG_GLSL };

/** All the uniforms a ShaderMaterial declares for world fog. */
export const ATM_FOG_SHADER_UNIFORMS = [...ATM_FOG_UNIFORMS, "atmFogEye"];

/**
 * Fog an additive or premultiplied glow, as Warfork's additive passes: the
 * whole output fades with the fog, so the glow sinks into the fogged world.
 */
export function atmFogFadeGlsl(color: string, worldPos: string): string {
  return `${color} *= 1.0 - atmFogEvaluate(${worldPos}, atmFogEye).a;`;
}

/** Fog an ordinary surface: mix toward the fog colour. */
export function atmFogMixGlsl(color: string, worldPos: string): string {
  return `{ vec4 atmFog = atmFogEvaluate(${worldPos}, atmFogEye); ${color}.rgb = mix(${color}.rgb, atmFog.rgb, atmFog.a); }`;
}

/** Fog a filter (multiply) pass: fade toward white, the identity. */
export function atmFogFilterGlsl(color: string, worldPos: string): string {
  return `${color}.rgb = mix(${color}.rgb, vec3(1.0), atmFogEvaluate(${worldPos}, atmFogEye).a);`;
}

/** The fog values, in the order of ATM_FOG_UNIFORMS, for a shader to set. */
export function atmFogUniformValues(controller: WorldFogController | null): number[][] {
  const fog = controller?.isDrawing() ? controller.getActive() : null;
  if (!fog)
    return [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 0],
    ];
  const { height, sun, sky } = fog;
  return [
    [fog.color[0], fog.color[1], fog.color[2], 1],
    [fog.minDist, controller?.getSkyHeight() ?? 0, 0, fog.density],
    [height?.clear ?? 0, height?.full ?? 0, height ? 1 / (height.full - height.clear) : 0, height ? 1 : 0],
    [sky?.horizonBias ?? 0, sky?.horizonScale ?? 0, sky?.zenithFalloff ?? 1, sky ? 1 : 0],
    [sun?.color[0] ?? 0, sun?.color[1] ?? 0, sun?.color[2] ?? 0, sun?.exponent ?? 1],
    [sun?.dir[0] ?? 0, sun?.dir[1] ?? 0, sun?.dir[2] ?? 0, sun?.intensity ?? 0],
  ];
}

/** Keep a ShaderMaterial's world fog uniforms current on every bind, for the camera drawing it. */
export function bindAtmosphericFog(material: ShaderMaterial): void {
  const controller = WorldFogController.getInstance();
  material.onBindObservable.add((mesh) => {
    const effect = material.getEffect();
    if (!effect) return;
    // A surface whose shader says `nofog` stays clear, as with Babylon's own fog
    const values = mesh.applyFog ? atmFogUniformValues(controller) : atmFogUniformValues(null);
    ATM_FOG_UNIFORMS.forEach((name, i) => {
      const [x, y, z, w] = values[i];
      effect.setFloat4(name, x, y, z, w);
    });
    const eye = material.getScene().activeCamera?.globalPosition;
    effect.setFloat3("atmFogEye", eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
  });
}

/**
 * How much world fog lies between `eye` and `position` (0 to 1), from distance
 * and the height band as the shaders compute it: for effects that fade on the
 * CPU, such as a burst of additive particles at its spawn point.
 */
export function atmFogFactorAt(
  position: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number } | null | undefined,
  controller: WorldFogController = WorldFogController.getInstance(),
): number {
  const fog = controller.isDrawing() ? controller.getActive() : null;
  if (!fog || !eye) return 0;
  const dist = Math.hypot(position.x - eye.x, position.y - eye.y, position.z - eye.z);
  let factor = 1 - Math.exp(-Math.max(0, dist - fog.minDist) * fog.density);
  if (fog.height) {
    const band = (position.y - fog.height.clear) / (fog.height.full - fog.height.clear);
    factor *= Math.min(1, Math.max(0, band));
  }
  return Math.min(1, Math.max(0, factor));
}
