import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";
import { RAIL_HELIX_TURNS } from "./RailProfiles";

// How fast the helix rotates about the axis while it fades (radians/second).
const RAIL_SPIN = 5.0;

const BEAM_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

attribute vec4 iStartSeed;
attribute vec4 iEndImpact;
attribute vec4 iColorLife;
attribute vec4 iParams;

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

varying float vSide;
varying float vPart;
varying float vEnergy;
varying float vLife;
varying vec3 vColor;

const float PI = 3.141592653589793;
const float TURNS = ${RAIL_HELIX_TURNS.toFixed(3)};
const float SPIN = ${RAIL_SPIN.toFixed(3)};

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 0.0000001 ? value * inversesqrt(lengthSquared) : fallback;
}

float worldPerPixel(vec3 worldPosition) {
  float viewDepth = max(abs((view * vec4(worldPosition, 1.0)).z), 0.05);
  return (2.0 * viewDepth) / max(abs(projection[1][1]) * uViewport.y, 1.0);
}

float hybridHalfWidth(vec3 worldPosition, float worldWidth, float minPixels, float maxPixels) {
  float pixelScale = worldPerPixel(worldPosition);
  return clamp(worldWidth, minPixels * pixelScale, maxPixels * pixelScale);
}

void main() {
  #include<instancesVertex>

  vec3 start = iStartSeed.xyz;
  vec3 end = iEndImpact.xyz;
  vec3 baseColor = iColorLife.rgb;
  float spawnTime = iColorLife.w;
  float intensity = iParams.x;
  float helixRadius = iParams.y;
  float duration = iParams.w;

  float age = max(0.0, uTime - spawnTime);
  float life = 1.0 - smoothstep(duration * 0.35, max(duration, 0.001), age);

  float t = position.x;
  float side = position.y;
  float part = position.z;

  vec3 axis = end - start;
  float beamLength = max(length(axis), 0.001);
  vec3 viewForward = safeNormalize(vec3(view[0][2], view[1][2], view[2][2]), vec3(0.0, 0.0, 1.0));
  vec3 direction = safeNormalize(axis, viewForward);

  // A stable frame perpendicular to the beam axis carries the analytic helix as
  // a true 3D spiral (independent of camera), so it wraps the core from every
  // viewing angle instead of shearing when seen edge-on.
  vec3 reference = abs(direction.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 perpA = safeNormalize(cross(direction, reference), vec3(1.0, 0.0, 0.0));
  vec3 perpB = safeNormalize(cross(direction, perpA), vec3(0.0, 1.0, 0.0));

  vec3 straightCenter = mix(start, end, t);
  vec3 center = straightCenter;

  if (part > 1.5) {
    // Fat in the middle, converging to the axis at muzzle and impact; the whole
    // spiral tightens toward the core as the shot fades out.
    float envelope = pow(sin(clamp(t, 0.0, 1.0) * PI), 0.55);
    float phaseOffset = part > 2.5 ? PI : 0.0; // HELIX_B rides the opposite side
    float phase = t * TURNS * 2.0 * PI + uTime * SPIN + phaseOffset;
    float radius = helixRadius * envelope * mix(0.35, 1.0, life);
    center = straightCenter + perpA * cos(phase) * radius + perpB * sin(phase) * radius;
  }

  // Billboard the ribbon width around the beam tangent, toward the camera.
  vec3 toCamera = safeNormalize(cameraPosition - center, -viewForward);
  vec3 ribbonSide = safeNormalize(cross(direction, toCamera), perpA);

  float halfWidth;
  if (part < 0.5) {
    halfWidth = hybridHalfWidth(center, 3.8, 13.0, 74.0); // GLOW sheath
  } else if (part < 1.5) {
    halfWidth = hybridHalfWidth(center, 0.80, 4.0, 17.0); // CORE
  } else {
    halfWidth = hybridHalfWidth(center, 0.55, 3.2, 12.0); // HELIX
  }

  vec3 worldPosition = center + ribbonSide * side * halfWidth;
  worldPosition = (finalWorld * vec4(worldPosition, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);

  vSide = side;
  vPart = part;
  vEnergy = intensity;
  vLife = life;
  vColor = baseColor;
}
`;

const BEAM_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying float vSide;
varying float vPart;
varying float vEnergy;
varying float vLife;
varying vec3 vColor;

void main() {
  float d = abs(vSide);
  float aa = max(fwidth(d), 0.001);
  float hot = 1.0 - smoothstep(0.10 - aa, 0.30 + aa, d);
  float body = 1.0 - smoothstep(0.45 - aa, 0.80 + aa, d);
  float fringe = 1.0 - smoothstep(0.80 - aa, 1.0 + aa, d);

  vec3 color;
  float alphaScale;
  float hdrScale;

  if (vPart < 0.5) {
    // Wide cold sheath — pure atmosphere around the shot line.
    color = mix(vec3(0.10, 0.34, 1.0), vColor, 0.30);
    hot = 0.0;
    body *= 0.72;
    alphaScale = 0.16;
    hdrScale = 0.85;
  } else if (vPart < 1.5) {
    // Bright white-blue core.
    color = mix(vec3(0.55, 0.80, 1.0), vec3(1.0, 1.0, 1.0), hot);
    alphaScale = 0.98;
    hdrScale = 3.0;
  } else {
    // Electric-blue helix, whitening at its own hot centerline.
    color = mix(mix(vec3(0.20, 0.52, 1.0), vColor, 0.25), vec3(0.85, 0.95, 1.0), hot);
    alphaScale = 0.72;
    hdrScale = 2.1;
  }

  float shape = hot + body * 0.60 + fringe * 0.20;
  float energy = max(vEnergy * vLife, 0.0);
  float alpha = clamp(shape * energy * alphaScale, 0.0, 0.96);
  vec3 rgb = color * shape * energy * hdrScale * alpha;
  gl_FragColor = vec4(rgb, alpha);
}
`;

const IMPACT_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

attribute vec4 iStartSeed;
attribute vec4 iEndImpact;
attribute vec4 iColorLife;
attribute vec4 iParams;
attribute vec4 iNormal;

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

varying vec2 vImpactUv;
varying float vOrientedPart;
varying float vKind;
varying float vEnergy;
varying float vMuzzle;
varying vec3 vColor;
varying vec2 vStateSeed;

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 0.0000001 ? value * inversesqrt(lengthSquared) : fallback;
}

float worldPerPixel(vec3 worldPosition) {
  float viewDepth = max(abs((view * vec4(worldPosition, 1.0)).z), 0.05);
  return (2.0 * viewDepth) / max(abs(projection[1][1]) * uViewport.y, 1.0);
}

void main() {
  #include<instancesVertex>

  vec3 start = iStartSeed.xyz;
  float seed = iStartSeed.w;
  vec3 end = iEndImpact.xyz;
  float impactKind = iEndImpact.w;
  vec3 baseColor = iColorLife.rgb;
  float spawnTime = iColorLife.w;
  float intensity = iParams.x;
  float duration = iParams.w;

  float age = max(0.0, uTime - spawnTime);
  float life = 1.0 - smoothstep(duration * 0.35, max(duration, 0.001), age);

  float part = position.z;
  float muzzle = step(1.5, part); // parts 2,3 -> muzzle crack at the start
  float orientedPart = mod(part, 2.0); // 0 = camera billboard, 1 = surface disc

  // The muzzle crack always fires; the terminal only exists on a real contact.
  float terminalLife = life * step(0.5, impactKind);
  float thisLife = mix(terminalLife, life, muzzle);

  vec3 center = mix(end, start, muzzle);
  float pixelScale = worldPerPixel(center);
  float radius = clamp(
    mix(3.2, 5.4, muzzle),
    mix(8.0, 12.0, muzzle) * pixelScale,
    mix(26.0, 40.0, muzzle) * pixelScale
  ) * step(0.0001, thisLife);

  vec3 cameraRight = safeNormalize(vec3(view[0][0], view[1][0], view[2][0]), vec3(1.0, 0.0, 0.0));
  vec3 cameraUp = safeNormalize(vec3(view[0][1], view[1][1], view[2][1]), vec3(0.0, 1.0, 0.0));
  vec3 normal = mix(iNormal.xyz, start - end, muzzle);
  if (length(normal) < 0.1) normal = safeNormalize(cameraPosition - center, vec3(0.0, 1.0, 0.0));
  else normal = safeNormalize(normal, vec3(0.0, 1.0, 0.0));
  vec3 reference = abs(normal.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 surfaceRight = safeNormalize(cross(reference, normal), cameraRight);
  vec3 surfaceUp = safeNormalize(cross(normal, surfaceRight), cameraUp);

  vec3 right = orientedPart < 0.5 ? cameraRight : surfaceRight;
  vec3 up = orientedPart < 0.5 ? cameraUp : surfaceUp;
  vec3 offsetCenter = center + normal * (orientedPart < 0.5 ? 0.08 : 0.12);
  vec3 worldPosition = offsetCenter + (right * position.x + up * position.y) * radius;

  worldPosition = (finalWorld * vec4(worldPosition, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);

  vImpactUv = uv;
  vOrientedPart = orientedPart;
  vKind = impactKind;
  vEnergy = intensity * thisLife;
  vMuzzle = muzzle;
  vColor = baseColor;
  vStateSeed = vec2(floor(uTime * 20.0 + seed * 0.013), seed);
}
`;

const IMPACT_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vImpactUv;
varying float vOrientedPart;
varying float vKind;
varying float vEnergy;
varying float vMuzzle;
varying vec3 vColor;
varying vec2 vStateSeed;

const float PI = 3.141592653589793;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float r = length(vImpactUv);
  float angle = atan(vImpactUv.y, vImpactUv.x);
  float aa = max(fwidth(r), 0.002);
  float state = vStateSeed.x;
  float seed = vStateSeed.y;
  float energy = max(vEnergy, 0.0);

  float nucleus = 1.0 - smoothstep(0.04, 0.30 + aa, r);
  float halo = (1.0 - smoothstep(0.16, 1.0, r)) * 0.25;
  float crown = 1.0 - smoothstep(0.03, 0.08 + aa, abs(r - 0.48));
  float segment = floor(((angle + PI) / (2.0 * PI)) * 13.0);
  float broken = step(0.27, hash11(segment + state * 7.0 + seed));
  float spikes = pow(abs(cos(angle * 7.0 + state * 0.7 + seed)), 40.0)
    * smoothstep(0.20, 0.36, r) * (1.0 - smoothstep(0.50, 1.0, r));

  float shape;
  vec3 color;
  float hdrScale;
  float alphaScale;

  // Cold white-blue everywhere; the terminal on a player contact biases hotter.
  vec3 coldEdge = mix(vec3(0.18, 0.45, 1.0), vColor, 0.30);
  vec3 white = vec3(0.90, 0.96, 1.0);

  if (vOrientedPart < 0.5) {
    // Camera-facing billboard: bright nucleus + soft halo (muzzle and terminal).
    shape = nucleus + halo;
    color = mix(coldEdge, white, nucleus);
    hdrScale = 3.0;
    alphaScale = 0.92;
  } else {
    // Surface-oriented disc: a broken shock ring with radial spikes.
    shape = crown * broken + spikes;
    color = mix(coldEdge, white, crown);
    hdrScale = 2.2;
    alphaScale = 0.80;
  }

  float alpha = clamp(shape * energy * alphaScale, 0.0, 0.97);
  vec3 rgb = color * shape * energy * hdrScale * alpha;
  gl_FragColor = vec4(rgb, alpha);
}
`;

let shadersRegistered = false;

function ensureShadersRegistered(): void {
  if (shadersRegistered) return;
  Effect.ShadersStore.railBeamVertexShader = BEAM_VERTEX_SHADER;
  Effect.ShadersStore.railBeamFragmentShader = BEAM_FRAGMENT_SHADER;
  Effect.ShadersStore.railImpactVertexShader = IMPACT_VERTEX_SHADER;
  Effect.ShadersStore.railImpactFragmentShader = IMPACT_FRAGMENT_SHADER;
  shadersRegistered = true;
}

const COMMON_UNIFORMS = ["world", "view", "projection", "viewProjection", "cameraPosition", "uViewport", "uTime"];
const BEAM_INSTANCE_ATTRIBUTES = ["iStartSeed", "iEndImpact", "iColorLife", "iParams"];
const IMPACT_INSTANCE_ATTRIBUTES = [...BEAM_INSTANCE_ATTRIBUTES, "iNormal"];

function createMaterial(name: string, scene: Scene, shaderName: "railBeam" | "railImpact"): ShaderMaterial {
  ensureShadersRegistered();
  const isImpact = shaderName === "railImpact";
  const material = new ShaderMaterial(
    name,
    scene,
    { vertex: shaderName, fragment: shaderName },
    {
      attributes: ["position", "uv", ...(isImpact ? IMPACT_INSTANCE_ATTRIBUTES : BEAM_INSTANCE_ATTRIBUTES)],
      uniforms: COMMON_UNIFORMS,
      defines: ["WORLD_BATCH"],
      needAlphaBlending: true,
    },
  );
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  return material;
}

export function createRailBeamMaterial(name: string, scene: Scene): ShaderMaterial {
  return createMaterial(name, scene, "railBeam");
}

export function createRailImpactMaterial(name: string, scene: Scene): ShaderMaterial {
  return createMaterial(name, scene, "railImpact");
}
