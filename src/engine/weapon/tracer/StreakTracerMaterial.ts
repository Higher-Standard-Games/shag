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

// A bullet streak: a white-hot core in a weapon-coloured glow, laid along the
// shot and turned to face the camera about its own axis, so it keeps its width
// from any angle except straight down the barrel. The vertex shader slides it
// from the muzzle to the hit, so a streak costs no CPU after it is spawned.

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

attribute vec4 iStartSpawn;  // start.xyz, spawn time
attribute vec4 iEndSpeed;    // end.xyz, speed (units per second)
attribute vec4 iColorLength; // color.rgb, streak length
attribute vec4 iParams;      // width, intensity

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

varying vec2 vUv;
varying vec3 vColor;
varying vec3 vAtmWorld;
varying float vIntensity;

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float ls = dot(value, value);
  return ls > 0.0000001 ? value * inversesqrt(ls) : fallback;
}

/** World units covered by one pixel at this depth — keeps far tracers legible. */
float worldPerPixel(vec3 worldPosition) {
  float viewDepth = max(abs((view * vec4(worldPosition, 1.0)).z), 0.05);
  return (2.0 * viewDepth) / max(abs(projection[1][1]) * uViewport.y, 1.0);
}

void main() {
  #include<instancesVertex>

  vec3 start = iStartSpawn.xyz;
  vec3 end = iEndSpeed.xyz;
  float spawn = iStartSpawn.w;
  float speed = iEndSpeed.w;
  float streakLength = iColorLength.w;
  float width = iParams.x;

  vec3 path = end - start;
  float total = length(path);
  vec3 dir = safeNormalize(path, vec3(0.0, 0.0, 1.0));

  // The head runs to the hit and stops there; the tail follows it in, so the
  // streak goes into the wall rather than vanishing in front of it.
  float travelled = max(0.0, uTime - spawn) * speed;
  float head = min(travelled, total);
  float tail = clamp(travelled - streakLength, 0.0, total);
  float alive = step(tail + 0.01, head);

  // uv.x runs tail (-1) to head (+1).
  float along = mix(tail, head, position.x * 0.5 + 0.5);
  vec3 center = start + dir * along;

  float pixelScale = worldPerPixel(center);
  float halfWidth = max(width, 1.4 * pixelScale) * alive;
  vec3 side = safeNormalize(cross(dir, cameraPosition - center), vec3(1.0, 0.0, 0.0));
  vec3 worldPosition = (finalWorld * vec4(center + side * (position.y * halfWidth), 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);
  vAtmWorld = worldPosition;

  vUv = uv;
  vColor = iColorLength.rgb;
  vIntensity = iParams.y;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
varying vec3 vColor;
varying vec3 vAtmWorld;
varying float vIntensity;

${ATM_FOG_GLSL}
void main() {
  vec3 white = vec3(1.0, 0.97, 0.9);
  float along = clamp(vUv.x * 0.5 + 0.5, 0.0, 1.0);
  float across = 1.0 - clamp(abs(vUv.y), 0.0, 1.0);

  // A hot thin core inside a wider coloured glow, brightest at the head and
  // thinning to nothing at the tail.
  float core = pow(across, 6.0);
  float glow = pow(across, 1.6);
  float lengthFade = pow(along, 1.3) * (1.0 - smoothstep(0.92, 1.0, along));
  float shape = (core * 1.2 + glow * 0.55) * lengthFade;
  vec3 color = mix(vColor, white, clamp(core * 1.4 + along * 0.25, 0.0, 1.0));

  float energy = 0.8 + 0.4 * clamp(vIntensity / 20.0, 0.0, 2.0);
  float alpha = clamp(shape, 0.0, 1.0);
  gl_FragColor = vec4(color * shape * energy * 2.2 * alpha, alpha);
  // World fog: a glow fades with the fog, as Warfork's additive passes
  ${atmFogFadeGlsl("gl_FragColor", "vAtmWorld")}
}
`;

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  Effect.ShadersStore.streakTracerVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.streakTracerFragmentShader = FRAGMENT_SHADER;
  registered = true;
}

export function createStreakTracerMaterial(name: string, scene: Scene): ShaderMaterial {
  ensureRegistered();
  const material = new ShaderMaterial(
    name,
    scene,
    { vertex: "streakTracer", fragment: "streakTracer" },
    {
      attributes: ["position", "uv", "iStartSpawn", "iEndSpeed", "iColorLength", "iParams"],
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
