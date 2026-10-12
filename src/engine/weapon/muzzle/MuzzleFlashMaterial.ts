import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";
import {
  ATM_FOG_GLSL,
  ATM_FOG_SHADER_UNIFORMS,
  atmFogFadeGlsl,
  bindAtmosphericFog,
} from "../../rendering/AtmosphericFogShader";

// One shared procedural muzzle-flash effect, styled per weapon by a float:
//   0 = burst (hot radial star), 1 = plume (fiery puff), 2 = arcs (electric).
// A single camera-facing billboard per shot; the fragment does all the shaping,
// so every weapon gets a flash with zero per-weapon assets.

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

attribute vec4 iCenterSeed;
attribute vec4 iColorSpawn;
attribute vec4 iParams; // scale, intensity, duration, style

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec2 uViewport;
uniform float uTime;

varying vec2 vUv;
varying float vLife;
varying float vIntensity;
varying float vStyle;
varying float vSeed;
varying float vState;
varying vec3 vColor;
varying vec3 vAtmWorld;

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float ls = dot(value, value);
  return ls > 0.0000001 ? value * inversesqrt(ls) : fallback;
}

float worldPerPixel(vec3 worldPosition) {
  float viewDepth = max(abs((view * vec4(worldPosition, 1.0)).z), 0.05);
  return (2.0 * viewDepth) / max(abs(projection[1][1]) * uViewport.y, 1.0);
}

void main() {
  #include<instancesVertex>

  vec3 center = iCenterSeed.xyz;
  float seed = iCenterSeed.w;
  float spawn = iColorSpawn.w;
  float scale = iParams.x;
  float duration = iParams.z;

  // Fast pop, then fall — a muzzle flash is brief but must still read.
  float age = max(0.0, uTime - spawn);
  float life = pow(1.0 - clamp(age / max(duration, 0.001), 0.0, 1.0), 1.35);

  // Big enough to read past the viewmodel silhouette, pixel-clamped so it does
  // not fill the screen up close.
  float pixelScale = worldPerPixel(center);
  float radius = clamp(scale, 30.0 * pixelScale, 170.0 * pixelScale) * step(0.0001, life);

  vec3 cameraRight = safeNormalize(vec3(view[0][0], view[1][0], view[2][0]), vec3(1.0, 0.0, 0.0));
  vec3 cameraUp = safeNormalize(vec3(view[0][1], view[1][1], view[2][1]), vec3(0.0, 1.0, 0.0));
  vec3 worldPosition = center + (cameraRight * position.x + cameraUp * position.y) * radius;
  worldPosition = (finalWorld * vec4(worldPosition, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);
  vAtmWorld = worldPosition;

  vUv = uv;
  vLife = life;
  vIntensity = iParams.y;
  vStyle = iParams.w;
  vSeed = seed;
  // Quantized time so the crackle holds for a frame or two rather than strobing.
  vState = floor(uTime * 34.0 + seed * 0.017);
  vColor = iColorSpawn.rgb;
}
`;

const FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vUv;
varying float vLife;
varying float vIntensity;
varying float vStyle;
varying float vSeed;
varying float vState;
varying vec3 vColor;
varying vec3 vAtmWorld;

const float PI = 3.141592653589793;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

${ATM_FOG_GLSL}
void main() {
  float r = length(vUv);
  float angle = atan(vUv.y, vUv.x);
  float aa = max(fwidth(r), 0.002);
  float seed = vSeed;
  float state = vState;

  // A spin offset per shot so repeated flashes don't look stamped.
  float spin = hash11(seed) * 6.2831853;
  float a = angle + spin;

  float nucleus = 1.0 - smoothstep(0.0, 0.46 + aa, r);
  vec3 white = vec3(1.0, 0.98, 0.92);

  vec3 color;
  float shape;
  float hdr;

  if (vStyle < 0.5) {
    // BURST — hot core + sharp radial star.
    float spikes = pow(abs(cos(a * 3.0)), 22.0) + 0.6 * pow(abs(cos(a * 6.0 + 1.7)), 40.0);
    spikes *= smoothstep(0.06, 0.30, r) * (1.0 - smoothstep(0.42, 1.0, r));
    shape = nucleus * 1.15 + spikes;
    color = mix(vColor, white, nucleus);
    hdr = 3.1;
  } else if (vStyle < 1.5) {
    // PLUME — fiery turbulent puff, hot white center → colored body → dark fringe.
    float lobes = 0.62 + 0.38 * pow(abs(cos(a * 2.5 + state * 0.3)), 2.0);
    float rr = r / max(lobes, 0.35);
    float body = 1.0 - smoothstep(0.10, 1.0 + aa, rr);
    float turb = 0.5 + 0.5 * sin(a * 9.0 + seed * 6.0) * (1.0 - smoothstep(0.2, 0.95, rr));
    shape = nucleus * 1.1 + body * 0.9 * turb;
    vec3 fire = mix(vColor, vec3(1.0, 0.55, 0.12), 0.5);
    color = mix(mix(vec3(0.35, 0.12, 0.02), fire, body), white, nucleus);
    hdr = 2.5;
  } else {
    // ARCS — electric core + thin radial lightning rods.
    float rods = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float base = hash11(fi * 12.7 + seed + floor(state)) * 6.2831853;
      float d = abs(mod(a - base + PI, 6.2831853) - PI);
      float bolt = smoothstep(0.16, 0.0, d) * (1.0 - smoothstep(0.12, 1.0, r));
      // jitter the length so rods flicker
      bolt *= step(r, mix(0.6, 1.0, hash11(fi * 3.1 + state)));
      rods = max(rods, bolt);
    }
    shape = nucleus * 1.2 + rods * 0.9;
    vec3 electric = mix(vColor, vec3(0.35, 0.75, 1.0), 0.4);
    color = mix(electric, white, max(nucleus, rods * 0.7));
    hdr = 3.0;
  }

  float energy = max(vLife * (0.85 + 0.4 * clamp(vIntensity / 25.0, 0.0, 2.0)), 0.0);
  float alpha = clamp(shape * energy, 0.0, 0.97);
  vec3 rgb = color * shape * energy * hdr * alpha;
  gl_FragColor = vec4(rgb, alpha);
  // World fog: a glow fades with the fog, as Warfork's additive passes
  ${atmFogFadeGlsl("gl_FragColor", "vAtmWorld")}
}
`;

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  Effect.ShadersStore.muzzleFlashVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.muzzleFlashFragmentShader = FRAGMENT_SHADER;
  registered = true;
}

export function createMuzzleFlashMaterial(name: string, scene: Scene): ShaderMaterial {
  ensureRegistered();
  const material = new ShaderMaterial(
    name,
    scene,
    { vertex: "muzzleFlash", fragment: "muzzleFlash" },
    {
      attributes: ["position", "uv", "iCenterSeed", "iColorSpawn", "iParams"],
      uniforms: ["world", "view", "projection", "viewProjection", "uViewport", "uTime", ...ATM_FOG_SHADER_UNIFORMS],
      defines: ["WORLD_BATCH"],
      needAlphaBlending: true,
    },
  );
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  bindAtmosphericFog(material);
  return material;
}
