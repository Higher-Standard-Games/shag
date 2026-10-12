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

// One procedural effect covering both impact tiers, selected per instance by a
// float: 0 = ember streak, 1 = hit star.
//
// An ember is its own instance rather than one billboard drawn per burst. A
// burst billboard is flat, and an impact is seen from every angle in an arena —
// looking along a wall would collapse the whole burst into a line. Per-ember
// instances integrate their own ballistic path in the vertex shader, so the
// scatter is genuinely three-dimensional and costs no CPU per frame.

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

attribute vec4 iOriginSeed;   // origin.xyz, seed
attribute vec4 iVelocityKind; // velocity.xyz, kind (0 ember, 1 star)
attribute vec4 iColorSpawn;   // color.rgb, spawn time
attribute vec4 iParams;       // size, duration, gravity, intensity

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

varying vec2 vUv;
varying float vLife;
varying float vKind;
varying float vSeed;
varying float vIntensity;
varying vec3 vColor;
varying vec3 vAtmWorld;

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float ls = dot(value, value);
  return ls > 0.0000001 ? value * inversesqrt(ls) : fallback;
}

/** World units covered by one pixel at this depth — keeps sparks legible far away. */
float worldPerPixel(vec3 worldPosition) {
  float viewDepth = max(abs((view * vec4(worldPosition, 1.0)).z), 0.05);
  return (2.0 * viewDepth) / max(abs(projection[1][1]) * uViewport.y, 1.0);
}

void main() {
  #include<instancesVertex>

  vec3 origin = iOriginSeed.xyz;
  vec3 velocity = iVelocityKind.xyz;
  float kind = iVelocityKind.w;
  float spawn = iColorSpawn.w;
  float size = iParams.x;
  float duration = iParams.y;
  float gravity = iParams.z;

  float age = max(0.0, uTime - spawn);
  float life = 1.0 - clamp(age / max(duration, 0.001), 0.0, 1.0);

  // Ballistic path, evaluated rather than stepped: no per-frame CPU work and
  // the position stays exact however uneven the frame rate is.
  vec3 pos = origin + velocity * age - vec3(0.0, 0.5 * gravity * age * age, 0.0);
  vec3 vel = velocity - vec3(0.0, gravity * age, 0.0);

  float pixelScale = worldPerPixel(pos);
  float alive = step(0.0001, life);

  vec3 offset;
  if (kind < 0.5) {
    // EMBER — a quad laid along its own velocity, so it reads as a streak of
    // travel rather than a dot. Faster sparks draw longer.
    float speed = length(vel);
    float streak = max(size * (0.55 + 0.85 * clamp(speed / 420.0, 0.0, 1.7)), 2.2 * pixelScale);
    float width = max(size * 0.16, 0.85 * pixelScale);
    vec3 dir = safeNormalize(vel, vec3(0.0, 1.0, 0.0));
    vec3 side = safeNormalize(cross(dir, cameraPosition - pos), vec3(1.0, 0.0, 0.0));
    offset = (dir * (position.x * streak) + side * (position.y * width)) * alive;
  } else {
    // STAR — camera-facing, so the flourish reads the same from any approach.
    float radius = max(size, 10.0 * pixelScale) * alive;
    vec3 camRight = safeNormalize(vec3(view[0][0], view[1][0], view[2][0]), vec3(1.0, 0.0, 0.0));
    vec3 camUp = safeNormalize(vec3(view[0][1], view[1][1], view[2][1]), vec3(0.0, 1.0, 0.0));
    offset = (camRight * position.x + camUp * position.y) * radius;
  }

  vec3 worldPosition = (finalWorld * vec4(pos + offset, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);
  vAtmWorld = worldPosition;

  vUv = uv;
  vLife = life;
  vKind = kind;
  vSeed = iOriginSeed.w;
  vIntensity = iParams.w;
  vColor = iColorSpawn.rgb;
}
`;

const FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vUv;
varying float vLife;
varying float vKind;
varying float vSeed;
varying float vIntensity;
varying vec3 vColor;
varying vec3 vAtmWorld;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

${ATM_FOG_GLSL}
void main() {
  vec3 white = vec3(1.0, 0.97, 0.89);
  vec3 color;
  float shape;
  float alpha;
  float hdr;

  // Derivatives are only well defined outside non-uniform control flow, so the
  // radius and its antialiasing width are resolved before the branch.
  float r = length(vUv);
  float aa = max(fwidth(r), 0.002);

  if (vKind < 0.5) {
    // EMBER — bright head trailing to nothing, cooling from white through the
    // weapon colour as it dies. uv.x runs tail(-1) to head(+1).
    float along = clamp(vUv.x * 0.5 + 0.5, 0.0, 1.0);
    float across = 1.0 - clamp(abs(vUv.y), 0.0, 1.0);
    shape = pow(across, 1.6) * pow(along, 1.4);
    float heat = pow(clamp(vLife, 0.0, 1.0), 0.55) * along;
    color = mix(vColor * 0.55, white, heat);
    alpha = clamp(shape * vLife, 0.0, 1.0);
    hdr = 2.4;
  } else {
    // STAR — posterized radial flourish. Alpha steps rather than a smooth fade,
    // matching the teleport ghost's print-styled frames.
    float a = atan(vUv.y, vUv.x) + hash11(vSeed) * 6.2831853;
    float spikes = pow(abs(cos(a * 2.5)), 18.0) + 0.55 * pow(abs(cos(a * 5.0 + 1.1)), 34.0);
    spikes *= smoothstep(0.04, 0.26, r) * (1.0 - smoothstep(0.34, 1.0 + aa, r));
    float nucleus = 1.0 - smoothstep(0.0, 0.22 + aa, r);
    shape = nucleus * 1.15 + spikes;
    color = mix(vColor, white, nucleus);
    float q = floor(clamp(vLife, 0.0, 0.999) * 4.0);
    float stepped = q > 2.5 ? 0.85 : (q > 1.5 ? 0.55 : (q > 0.5 ? 0.3 : 0.12));
    alpha = clamp(shape * stepped, 0.0, 0.95);
    hdr = 2.9;
  }

  float energy = max(0.7 + 0.45 * clamp(vIntensity / 25.0, 0.0, 2.0), 0.0);
  gl_FragColor = vec4(color * shape * energy * hdr * alpha, alpha);
  // World fog: a glow fades with the fog, as Warfork's additive passes
  ${atmFogFadeGlsl("gl_FragColor", "vAtmWorld")}
}
`;

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  Effect.ShadersStore.impactSparkVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.impactSparkFragmentShader = FRAGMENT_SHADER;
  registered = true;
}

export function createImpactSparkMaterial(name: string, scene: Scene): ShaderMaterial {
  ensureRegistered();
  const material = new ShaderMaterial(
    name,
    scene,
    { vertex: "impactSpark", fragment: "impactSpark" },
    {
      attributes: ["position", "uv", "iOriginSeed", "iVelocityKind", "iColorSpawn", "iParams"],
      uniforms: [
        "world",
        "view",
        "projection",
        "viewProjection",
        "cameraPosition",
        "uViewport",
        "uTime",
        ...ATM_FOG_SHADER_UNIFORMS,
      ],
      needAlphaBlending: true,
    },
  );
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  bindAtmosphericFog(material);
  return material;
}
