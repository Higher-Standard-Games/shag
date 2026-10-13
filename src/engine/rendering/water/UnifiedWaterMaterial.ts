/**
 * One water material for every liquid surface in every map.
 *
 * The compatibility position this whole feature rests on: rather than teaching
 * the Q3 shader translator one more vendor keyword at a time — QFusion cubemap
 * conditionals, `tesssize`, per-map blend stages — a surface identified as
 * liquid stops being translated at all and is drawn by this instead. Q3 and
 * Warsow water then look the same, deliberately, and both look modern.
 *
 * Every tier samples cached room reflections. Medium/Epic add camera-space
 * depth for transmission; Epic adds half-resolution scene-colour distortion.
 * No tier requires a live mirror.
 *
 * BSP world meshes bake world-space vertices with an identity transform, so
 * `position` IS the world position — which is what lets adjacent meshes share
 * one continuous wave field with no seam at their boundary.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { ATM_FOG_GLSL, ATM_FOG_SHADER_UNIFORMS, bindAtmosphericFog } from "../AtmosphericFogShader";
import { MAX_WATER_IMPULSES } from "./WaterDisturbances";
import { generateWaterNormalMap, WATER_NOISE_SIZE } from "./WaterNoise";
import { MAX_WATER_LIGHTS } from "./WaterSurfaceLighting";

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
uniform sampler2D uSceneColour;
uniform sampler2D uActorReflection;
uniform mat4 uActorReflectionMatrix;
uniform vec2 uActorReflectionTexel;
uniform float uHasActorReflection;
uniform float uActorReflectionLinear;
uniform float uHasRefraction;
uniform float uRefractionIsLinear;
uniform float uCalmWater;
uniform mat4 view;
uniform samplerCube uEnvironment;
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
// x near, y far (0 for an infinite far plane), z 1 when NDC depth runs 0..1;
// w 1 when uSceneDepth is the hardware depth of the colour capture.
uniform vec4 uDepthProjection;
uniform float uDebug;
uniform float uFoam;
uniform float uFoamWidth;
uniform float uCaustics;
uniform float uHasEnvironment;
uniform float uLocalProbe;
uniform float uEnvironmentYSign;
uniform float uEnvironmentIsLinear;
uniform float uOutputLinear;
uniform float uHighlightStrength;
uniform float uRoughness;
uniform float uReflectionStrength;
uniform float uReflectionBlur;
uniform float uDetailStrength;
uniform float uContactStrength;
uniform sampler2D uLightVisibility;
uniform vec3 uLightMaskMin;
uniform vec3 uLightMaskMax;
uniform vec4 uWaterLights[${MAX_WATER_LIGHTS}];
uniform vec4 uWaterLightColours[${MAX_WATER_LIGHTS}];
uniform vec3 uProbePosition;
uniform vec3 uProbeMin;
uniform vec3 uProbeMax;
uniform vec4 uImpulses[${MAX_WATER_IMPULSES * 2}];

// Screen captures and visibility masks have one mip. Explicit LOD keeps these
// samples valid inside per-pixel clipping/front-face branches on WebGPU.
// Keep the WebGL path, including WebGL1 without shader_texture_lod, unchanged.
#ifdef WEBGPU
#define WATER_CAPTURE(s, uv) texture2DLodEXT(s, uv, 0.0)
#define WATER_PANEL(s, ray) textureCubeLodEXT(s, ray, 0.0)
#else
#define WATER_CAPTURE(s, uv) texture2D(s, uv)
#define WATER_PANEL(s, ray) textureCube(s, ray)
#endif

// View-space Z in world units behind this pixel, 0 where nothing was drawn.
// The depth pass stores it directly; the colour capture's own depth buffer
// holds the projection's depth, turned back here with the same near and far.
float sceneViewDepth(vec2 uv) {
  float d = WATER_CAPTURE(uSceneDepth, uv).r;
  if (uDepthProjection.w < 0.5) return d;
  if (d >= 1.0) return 0.0;
  float n = uDepthProjection.x;
  float f = uDepthProjection.y;
  float z = uDepthProjection.z > 0.5 ? d : d * 2.0 - 1.0;
  if (f <= 0.0) return uDepthProjection.z > 0.5 ? n / (1.0 - z) : 2.0 * n / (1.0 - z);
  return uDepthProjection.z > 0.5 ? n * f / (f - z * (f - n)) : 2.0 * n * f / (f + n - z * (f - n));
}

// Like Babylon WaterMaterial, this inexpensive stylised surface composes
// display-space colours. The game image-processing pass expects LINEAR input;
// sending these colours unchanged applies gamma twice and washes out the pool.
${ATM_FOG_GLSL}
vec4 waterOutput(vec3 color, float alpha) {
  // World fog, mixed in display space like the rest of the surface
  vec4 atmFog = atmFogEvaluate(vWorld, atmFogEye);
  color = mix(color, atmFog.rgb, atmFog.a);
  return vec4(uOutputLinear > 0.5 ? pow(max(color, vec3(0.0)), vec3(2.2)) : color, alpha);
}

vec3 localReflection(vec3 direction) {
  // Ray/box intersection from this surface point, then look up from the probe.
  // Outside the proxy volume, use ordinary cubemap reflection rather than a
  // negative intersection that flips the lookup.
  if (uLocalProbe < 0.5 || any(lessThan(vWorld, uProbeMin)) || any(greaterThan(vWorld, uProbeMax))) return direction;
  vec3 safeDir = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), direction)) * max(abs(direction), vec3(0.0001));
  vec3 distanceToBox = max((uProbeMin - vWorld) / safeDir, (uProbeMax - vWorld) / safeDir);
  float distanceAlongRay = min(distanceToBox.x, min(distanceToBox.y, distanceToBox.z));
  return vWorld + direction * distanceAlongRay - uProbePosition;
}

vec3 environmentLinear(vec3 direction) {
  vec3 colour = textureCube(uEnvironment, direction).rgb;
  return uEnvironmentIsLinear > 0.5 ? colour : pow(max(colour, vec3(0.0)), vec3(2.2));
}

vec3 softEnvironment(vec3 direction) {
  vec3 ray = normalize(direction);
  vec3 colour = environmentLinear(ray);
  if (uCalmWater > 0.5 && uReflectionBlur > 0.0) {
    // A small, normalized angular filter. Works with authored cubes as well as
    // cached RTTs, without requiring prefiltered mipmaps or a new render pass.
    // Filter in linear space so a bright trim edge does not lose its energy.
    vec3 axis = abs(ray.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 across = normalize(cross(ray, axis));
    vec3 up = cross(across, ray);
    float spread = uReflectionBlur * uReflectionBlur * 0.12;
    colour = colour * 0.4 + 0.15 * (
      environmentLinear(ray + across * spread) + environmentLinear(ray - across * spread) +
      environmentLinear(ray + up * spread) + environmentLinear(ray - up * spread));
  }
  return pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
}

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
  // Rotate the sampled gradient back from layer two's UV basis.
  vec2 secondSlope = vec2(0.5403 * n2.x - 0.8415 * n2.y, 0.8415 * n2.x + 0.5403 * n2.y);
  vec2 slope = (n1.xy + secondSlope * 0.6) * uWaveStrength;
  if (uCalmWater > 0.5) {
    // Broad, low-amplitude wave gradients anchored in world space. Texture
    // scrolling supplies only fine detail, not the dominant conveyor motion.
    vec2 p = vWorld.xz;
    float distanceToEye = length(uCameraPosition - vWorld);
    float geometricFacing = abs(dot(normalize(uCameraPosition - vWorld), normalize(vNormal)));
    // Preserve the broad wave silhouette in reflections while fading small
    // slopes that become subpixel stripes at distance or grazing incidence.
    float detail = uDetailStrength * (1.0 - smoothstep(192.0, 768.0, distanceToEye)) *
      smoothstep(0.03, 0.3, geometricFacing);
    vec2 broad = vec2(0.94, 0.34) * (0.11 * cos(dot(p, vec2(0.94, 0.34)) * 0.039 - uTime * 0.28));
    broad += vec2(-0.38, 0.925) * (0.075 * cos(dot(p, vec2(-0.38, 0.925)) * 0.063 - uTime * 0.35));
    broad += vec2(0.6, -0.8) * (0.045 * cos(dot(p, vec2(0.6, -0.8)) * 0.09 - uTime * 0.41));
    // A shorter capillary component gives the quiet surface readable detail.
    // The previous near-zero gradients only showed motion during a splash.
    broad += vec2(-0.8, -0.6) * (0.1 * detail * cos(dot(p, vec2(-0.8, -0.6)) * 0.18 - uTime * 0.6));
    slope = broad + slope * detail;
  }
  vec2 reactiveSlope = vec2(0.0);
  for (int i = 0; i < ${MAX_WATER_IMPULSES}; i++) {
    vec4 origin = uImpulses[i * 2];
    vec4 wave = uImpulses[i * 2 + 1];
    // Packed impulses are contiguous. Dry/idle pools skip the expensive wave
    // math entirely; the budget is a maximum, not twelve mandatory waves.
    if (wave.x <= 0.0) break;
    vec2 delta = vWorld.xz - origin.xz;
    float distanceFromOrigin = length(delta);
    float phase = distanceFromOrigin - origin.w * (38.0 + wave.x * 25.0);
    float decay = (1.0 - smoothstep(0.25, 2.0, origin.w)) / (1.0 + origin.w * 0.8);
    float envelope = exp(-phase * phase / 140.0) * decay;
    float boundary = 1.0 - smoothstep(wave.y * 0.7, max(wave.y, 0.001), distanceFromOrigin);
    float samePlane = 1.0 - step(3.0, abs(vWorld.y - origin.y));
    if (dot(wave.zw, wave.zw) > 0.01) {
      // A trailing V-shaped wave packet, aligned with actual body movement.
      // Its origin stays in world space after emission; no camera-facing ring.
      vec2 direction = normalize(wave.zw);
      vec2 side = vec2(-direction.y, direction.x);
      float trail = -dot(delta, direction);
      float across = dot(delta, side);
      float wakePhase = abs(across) - max(0.0, trail) * 0.45 - origin.w * 18.0;
      float wakeEnvelope = exp(-wakePhase * wakePhase / 60.0) *
        smoothstep(-5.0, 8.0, trail) * max(0.0, 1.0 - origin.w / 2.0);
      vec2 gradient = side * sign(across) + direction * 0.45;
      reactiveSlope += gradient * cos(wakePhase * 0.55) * wakeEnvelope * boundary * wave.x * samePlane * 0.32;
    } else {
      // A softer trailing wave within the SAME impulse, not another timer or
      // slot. Strong impacts spread faster/further; their aftermath settles.
      float trailingPhase = phase + 16.0;
      float trailing = cos(trailingPhase * 0.38) * exp(-trailingPhase * trailingPhase / 220.0) *
        decay * smoothstep(0.12, 0.4, origin.w) * 0.3;
      reactiveSlope += delta / max(distanceFromOrigin, 1.0) *
        (cos(phase * 0.42) * envelope + trailing) * boundary * wave.x * samePlane * 0.28;
    }
  }
  // Smoothly bound crowded splash/wake overlaps without a hard clamp edge.
  reactiveSlope *= 0.65 / (0.65 + length(reactiveSlope));
  slope += reactiveSlope;
  vec3 geometricNormal = normalize(vNormal);
  vec3 tangent = normalize(abs(geometricNormal.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : cross(vec3(0.0, 1.0, 0.0), geometricNormal));
  vec3 bitangent = normalize(cross(tangent, geometricNormal));
  vec3 n = normalize(geometricNormal + tangent * slope.x + bitangent * slope.y);
  if (!gl_FrontFacing) n = -n;

  vec3 viewDir = normalize(uCameraPosition - vWorld);
  float facing = clamp(dot(viewDir, n), 0.0, 1.0);

  // Flat-colour fallback remains capped because a strong reflection of one
  // constant swatch is glare. A real cubemap or mirror gets the stylised
  // Schlick curve below instead.
  float flatFresnel = pow(1.0 - facing, 4.0) * uReflectivity;

  vec3 reflectionDirection = reflect(-viewDir, n);
  vec3 environmentSample = uSkyColor;
  if (uHasEnvironment > 0.5) {
    vec3 cubeDirection = localReflection(reflectionDirection);
    cubeDirection.y *= uEnvironmentYSign;
    environmentSample = softEnvironment(cubeDirection);
  }

  vec3 reflected = environmentSample;
  vec3 actorColour = vec3(0.0);
  float actorCoverage = 0.0;
  // Independent, short-range actor layer. Keep the unwarped centre coverage:
  // blur/distortion must not spread an actor across a reflected wall silhouette.
  if (uHasActorReflection > 0.5 && gl_FrontFacing) {
    vec4 projected = uActorReflectionMatrix * vec4(vWorld, 1.0);
    vec2 uv = projected.xy / max(projected.w, 0.0001) * 0.5 + 0.5;
    float distanceFade = 1.0 - smoothstep(140.0, 240.0, distance(uCameraPosition, vWorld));
    vec2 margin = uActorReflectionTexel * 6.0;
    if (projected.w > 0.0 && all(greaterThan(uv, margin)) && all(lessThan(uv, vec2(1.0) - margin))) {
      float coverage = WATER_CAPTURE(uActorReflection, uv).a;
      float softness = mix(0.65, 4.0, smoothstep(32.0, 200.0, distance(uCameraPosition, vWorld)));
      vec2 stepUv = uActorReflectionTexel * softness;
      vec2 warped = uv + clamp(slope, vec2(-0.6), vec2(0.6)) * uActorReflectionTexel * 2.0;
      vec4 actor = WATER_CAPTURE(uActorReflection, warped) * 0.3;
      actor += WATER_CAPTURE(uActorReflection, warped + vec2(stepUv.x, 0.0)) * 0.175;
      actor += WATER_CAPTURE(uActorReflection, warped - vec2(stepUv.x, 0.0)) * 0.175;
      actor += WATER_CAPTURE(uActorReflection, warped + vec2(0.0, stepUv.y)) * 0.175;
      actor += WATER_CAPTURE(uActorReflection, warped - vec2(0.0, stepUv.y)) * 0.175;
      actorColour = actor.rgb / max(actor.a, 0.0001);
      if (uActorReflectionLinear > 0.5) actorColour = pow(max(actorColour, vec3(0.0)), vec3(1.0 / 2.2));
      actorCoverage = min(coverage, actor.a) * distanceFade * 0.8;
    }
  }
  float environmentFresnel = min(0.95, 0.04 + 0.96 * pow(1.0 - facing, 5.0));
  float fresnel = mix(flatFresnel, environmentFresnel, uHasEnvironment);
  if (uCalmWater > 0.5) fresnel = min(0.95, fresnel * uReflectionStrength);
  // Stylised near-normal visibility for bodies: otherwise the 4% Schlick floor
  // makes a self reflection practically disappear when looking into the pool.
  // Only actor-covered pixels get this lift; retain the room's existing Fresnel,
  // distance fade, occlusion mask and an explicit reflection-strength-zero opt-out.
  if (actorCoverage > 0.0) {
    float actorFresnel = max(fresnel, min(0.95, 0.18 * uReflectionStrength));
    float roomWeight = fresnel * (1.0 - actorCoverage);
    float actorWeight = actorFresnel * actorCoverage;
    fresnel = roomWeight + actorWeight;
    reflected = (environmentSample * roomWeight + actorColour * actorWeight) / max(fresnel, 0.0001);
  }

  // How much liquid the view ray crosses, and what survives the crossing.
  //
  // Per channel, because water eats red about three times faster than blue and
  // that ratio IS why water is blue-green. A scalar dims evenly, and a pale
  // floor dimmed evenly is still a pale floor.
  float thickness = 0.0;
  float validContactDepth = 0.0;
  // Low-tier fallback: retain a mild spectral tint when there is no depth
  // capture. It must not default to zero transmittance, which made Low render
  // every pool as fully deep and almost opaque.
  vec3 absorbedRgb = clamp(uAbsorbTint * 0.35, vec3(0.0), vec3(1.0));
  vec3 transmittance = vec3(1.0) - absorbedRgb;
  if (uHasDepth > 0.5) {
    vec2 screenUv = gl_FragCoord.xy / uScreenSize;
    float sceneDepth = sceneViewDepth(screenUv);
    float rayAxis = max(0.05, dot(normalize(vWorld - uCameraPosition), normalize(uCameraForward)));
    thickness = sceneDepth > 0.0 ? max(0.0, sceneDepth - vViewDepth) / rayAxis : 0.0;
    validContactDepth = sceneDepth > vViewDepth + 0.05 ? 1.0 : 0.0;
    transmittance = exp(-thickness * uAbsorb * uAbsorbTint);
    absorbedRgb = vec3(1.0) - transmittance;
  }
  // Hardware alpha is scalar, so luminance is used only where one number is
  // unavoidable. Surface colour below still consumes all three channels.
  float absorbed = dot(absorbedRgb, vec3(0.2126, 0.7152, 0.0722));

  // A soft contact shade, not opaque/tinted foam spots.
  // This is a screen-depth intersection approximation, so disable it without
  // a valid surface behind us and below the water. Never whiten a zero-depth pool.
  float contact = 0.0;
  if (uCalmWater > 0.5 && gl_FrontFacing && uHasDepth > 0.5 && uContactStrength > 0.0) {
    float band = smoothstep(0.1, 0.6, thickness) * (1.0 - smoothstep(0.6, 4.0, thickness));
    contact = band * uContactStrength * validContactDepth;
  }

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
    vec3 floorPos = vWorld + rayDir * thickness;
    vec2 cuv = floorPos.xz * uScale * 0.55;
    float c1 = texture2D(uNoise, cuv + vec2(uTime * uScroll * 0.35, uTime * uScroll * 0.2)).b;
    float c2 = texture2D(uNoise, cuv * 1.45 - vec2(uTime * uScroll * 0.25, -uTime * uScroll * 0.4)).b;
    // The ridge between two offset samples: focused light arrives in thin
    // filaments, and a plain noise product looks like dappled shade instead.
    float ridge = max(0.0, 1.0 - abs(c1 - c2) * 5.0);
    float reach = transmittance.g * min(1.0, thickness / 12.0);
    caustics = pow(ridge, 7.0) * reach * uCaustics;
  }

  if (uDebug > 2.5) {
    if (uDebug > 5.5) {
      vec3 colour = WATER_CAPTURE(uSceneColour, gl_FragCoord.xy / uScreenSize).rgb;
      if (uRefractionIsLinear > 0.5) colour = pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
      gl_FragColor = waterOutput(uHasRefraction > 0.5 ? colour : vec3(1.0, 0.0, 0.0), 1.0);
      return;
    }
    if (uDebug > 4.5) {
      gl_FragColor = waterOutput(vec3(0.5) + vec3(reactiveSlope.x, 0.0, reactiveSlope.y) * 2.0, 1.0);
      return;
    }
    if (uDebug > 3.5) {
      gl_FragColor = waterOutput(uLocalProbe > 0.5 ? environmentSample : vec3(1.0, 0.0, 0.0), 1.0);
      return;
    }
    gl_FragColor = waterOutput(uHasEnvironment > 0.5 ? environmentSample : vec3(1.0, 0.0, 0.0), 1.0);
    return;
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
      gl_FragColor = waterOutput(absorbedRgb, 1.0);
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
    gl_FragColor = waterOutput(band, 1.0);
    return;
  }

  // The water's own colour follows spectral absorption: red can reach the deep
  // tint while blue still shows the shallow tint. The framebuffer blend has
  // only scalar alpha, so this is a deliberately inexpensive approximation;
  // exact per-channel transmission would require another full scene capture.
  vec3 body = mix(uShallowColor, uDeepColor, absorbedRgb);
  // Modulate the existing composition equally in every channel. Introducing
  // shallow-water colour here made isolated cyan dots in dark rooms. Keep the
  // original transmission/alpha and add no new hue or light: at the default
  // contact strength this is at most a 6.25% display-space shade.
  float contactShade = 1.0 - contact * 0.25;
  // Restrained, art-directed ambient sheen: this map can reflect almost black
  // in every direction. Pure refraction then only moves polygon edges and the
  // middle reads as blank glass. Distribute a bounded highlight over the wave
  // gradients, with no point-light hotspot or additional render pass.
  vec3 surfaceSheen = uCalmWater > 0.5
    ? uSkyColor * (0.07 * clamp(dot(slope, slope) * 8.0, 0.0, 1.0)) : vec3(0.0);

  vec3 lightHighlights = vec3(0.0);
  if (uCalmWater > 0.5 && gl_FrontFacing && uHighlightStrength > 0.0) {
    vec2 maskUv = (vWorld.xz - uLightMaskMin.xz) / max(uLightMaskMax.xz - uLightMaskMin.xz, vec2(1.0));
    vec4 visibility = WATER_CAPTURE(uLightVisibility, clamp(maskUv, vec2(0.0), vec2(1.0)));
    float exponent = max(2.0, 2.0 / (uRoughness * uRoughness) - 2.0);
    for (int i = 0; i < ${MAX_WATER_LIGHTS}; i++) {
      vec4 source = uWaterLights[i];
      if (source.w <= 0.0) break;
      vec3 deltaLight = source.xyz - vWorld;
      float distanceLight = length(deltaLight);
      vec3 toLight = deltaLight / max(distanceLight, 0.001);
      vec3 halfVector = normalize(toLight + viewDir);
      float attenuation = pow(max(0.0, 1.0 - distanceLight / source.w), 2.0);
      float lightFresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(viewDir, halfVector)), 5.0);
      float lobe = (exponent + 2.0) / 8.0 * pow(max(0.0, dot(n, halfVector)), exponent);
      vec3 lightColour = uWaterLightColours[i].rgb;
      if (uWaterLightColours[i].w > 0.5) {
        // Surface-light colour comes from the cached room, not a made-up white
        // sun. Without a local capture we cannot identify that panel's colour.
        vec3 panelRay = source.xyz - uProbePosition;
        panelRay.y *= uEnvironmentYSign;
        vec3 panelColour = WATER_PANEL(uEnvironment, panelRay).rgb;
        if (uEnvironmentIsLinear > 0.5) panelColour = pow(max(panelColour, vec3(0.0)), vec3(1.0 / 2.2));
        lightColour *= panelColour * uLocalProbe;
      }
      lightHighlights += lightColour * visibility[i] * attenuation *
        max(0.0, dot(n, toLight)) * lightFresnel * lobe * uHighlightStrength;
    }
  }

  if (uHasRefraction > 0.5 && uHasDepth > 0.5 && uCalmWater > 0.5 && gl_FrontFacing) {
    vec2 screenUv = gl_FragCoord.xy / uScreenSize;
    vec2 viewSlope = (view * vec4(n - geometricNormal, 0.0)).xy;
    vec2 offset = viewSlope * vec2(uScreenSize.y / uScreenSize.x, 1.0) * 0.035;
    offset *= smoothstep(0.0, 32.0, thickness);
    vec2 refractedUv = screenUv + offset;
    // Do not drag a foreground bank into the water, or sample outside the
    // current screen. A rejected displacement falls back to the exact pixel.
    vec2 margin = vec2(2.0) / uScreenSize;
    float displacedDepth = sceneViewDepth(clamp(refractedUv, margin, vec2(1.0) - margin));
    if (any(lessThan(refractedUv, margin)) || any(greaterThan(refractedUv, vec2(1.0) - margin)) ||
        displacedDepth <= vViewDepth + 0.5) refractedUv = screenUv;
    vec3 transmittedScene = WATER_CAPTURE(uSceneColour, refractedUv).rgb;
    if (uRefractionIsLinear > 0.5) transmittedScene = pow(max(transmittedScene, vec3(0.0)), vec3(1.0 / 2.2));
    vec3 throughWater = transmittedScene * transmittance + body * (vec3(1.0) - transmittance);
    vec3 surfaceColour = reflected * fresnel + throughWater * (1.0 - fresnel) + surfaceSheen + lightHighlights;
    gl_FragColor = waterOutput(surfaceColour * contactShade, 1.0);
    return;
  }

  // Sun glint. A broad lobe rather than a tight one: a mirror-sharp highlight
  // is invisible from almost every angle, and this is what sells "wet" when
  // the camera is standing still.
  vec3 halfway = normalize(uSunDirection + viewDir);
  float spec = pow(clamp(dot(n, halfway), 0.0, 1.0), 24.0) * uSpecular;

  // Scalar transmission is deliberately a low-cost approximation. Compose
  // reflection and scattering as premultiplied contributions, then convert
  // to straight alpha for Babylon's normal blend. Reflection is weighted ONCE.
  float bodyAlpha = clamp(absorbed, uMinAlpha, uAlpha);
  float alpha = fresnel + (1.0 - fresnel) * bodyAlpha;
  vec3 contribution = reflected * fresnel + body * bodyAlpha * (1.0 - fresnel);
  contribution += surfaceSheen + lightHighlights;
  contribution += (vec3(spec) + body * uEmissive + uShallowColor * caustics) * alpha;
  contribution = mix(contribution, vec3(1.0), foam);
  alpha = mix(alpha, 1.0, foam);
  contribution *= contactShade;
  gl_FragColor = waterOutput(contribution / max(alpha, 0.0001), alpha);
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
  /** Flat-colour environment fallback when no usable cubemap exists. */
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
   * Stylised reflection strength, 0-1.
   *
   * Physical water reaches a full mirror at grazing angles. We reflect a flat
   * colour rather than the scene, so honouring that turned the far half of a
   * pool into a sheet of white. This bounds the flat fallback and supplies the
   * visible normal-incidence floor for the paid Epic mirror.
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
    // Ray-distance absorption: at 40 units, green loses about 13%, red 27%.
    // Keep shallow water clear; distortion/reflection now carry surface detail.
    absorb: 0.008,
    // One tile per ~90 units, so a pool a few hundred units across shows
    // several waves rather than one broad smear.
    scale: 0.011,
    waveSpeed: 2,
    // Water scales this texture detail to 50% under broad/capillary waves.
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
const fallbackByScene = new WeakMap<Scene, BaseTexture>();

export function waterFallbackCube(scene: Scene): BaseTexture {
  let cube = fallbackByScene.get(scene);
  if (!cube) {
    const faces = Array.from({ length: 6 }, () => new Uint8Array([45, 60, 70, 255]));
    // NullEngine has no raw-cube upload implementation; retain the sampler
    // contract without attempting a GL call in headless tools.
    cube = !scene.getEngine().getRenderingCanvas()
      ? new CubeTexture("", scene)
      : new RawCubeTexture(scene, faces, 1, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, false);
    cube.name = "water-fallback-cube";
    fallbackByScene.set(scene, cube);
  }
  return cube;
}

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
  fallbackByScene.get(scene)?.dispose();
  fallbackByScene.delete(scene);
  const texture = noiseByScene.get(scene);
  if (texture) {
    texture.dispose();
    noiseByScene.delete(scene);
  }
}

export interface UnifiedWaterMaterialOptions {
  /** Direction the sun comes FROM, for the specular lobe. */
  sunDirection?: Vector3;
  /** Exact-name compatibility overrides select these engine appearances. */
  profile?: string;
}

/**
 * Build the material for one liquid kind.
 *
 * Returns null for a synchronous construction failure. GPU compilation is
 * lazy in Babylon; the owning LiquidSurfaceSystem also listens to `onError`
 * and restores the legacy material if a driver rejects the compiled shader.
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
          ...ATM_FOG_SHADER_UNIFORMS,
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
          "uDepthProjection",
          "uHasRefraction",
          "uHasActorReflection",
          "uActorReflectionMatrix",
          "uActorReflectionTexel",
          "uActorReflectionLinear",
          "uRefractionIsLinear",
          "uCalmWater",
          "uDebug",
          "uFoam",
          "uFoamWidth",
          "uCameraForward",
          "uCaustics",
          "uAbsorbTint",
          "uHasEnvironment",
          "uLocalProbe",
          "uEnvironmentYSign",
          "uEnvironmentIsLinear",
          "uOutputLinear",
          "uProbePosition",
          "uProbeMin",
          "uProbeMax",
          "uImpulses",
          "uHighlightStrength",
          "uRoughness",
          "uReflectionStrength",
          "uReflectionBlur",
          "uDetailStrength",
          "uContactStrength",
          "uLightMaskMin",
          "uLightMaskMax",
          "uWaterLights",
          "uWaterLightColours",
        ],
        samplers: ["uNoise", "uSceneDepth", "uEnvironment", "uSceneColour", "uLightVisibility", "uActorReflection"],
        needAlphaBlending: true,
      },
    );

    const profile = WATER_PROFILES[kind];
    const sun = (options.sunDirection ?? new Vector3(0.4, 0.8, 0.3)).normalize();

    material.setTexture("uNoise", noiseTexture(scene) as unknown as Texture);
    // Bind all sampler types even when a feature is disabled. An unbound cube
    // sampler aliasing a 2D sampler is invalid on real WebGL drivers.
    material.setTexture("uEnvironment", waterFallbackCube(scene));
    material.setTexture("uSceneDepth", noiseTexture(scene));
    material.setTexture("uSceneColour", noiseTexture(scene));
    material.setTexture("uActorReflection", noiseTexture(scene));
    material.setFloat("uHasActorReflection", 0);
    material.setTexture("uLightVisibility", noiseTexture(scene));
    material.setFloat("uHighlightStrength", 0.6);
    material.setFloat("uRoughness", 0.3);
    material.setFloat("uReflectionStrength", 1.3);
    material.setFloat("uReflectionBlur", 0.3);
    material.setFloat("uDetailStrength", 0.8);
    material.setFloat("uContactStrength", 0.25);
    material.setVector3("uLightMaskMin", Vector3.Zero());
    material.setVector3("uLightMaskMax", Vector3.One());
    material.setArray4("uWaterLights", Array(MAX_WATER_LIGHTS * 4).fill(0));
    material.setArray4("uWaterLightColours", Array(MAX_WATER_LIGHTS * 4).fill(0));
    material.setFloat("uHasRefraction", 0);
    material.setFloat("uRefractionIsLinear", 0);
    material.setFloat("uCalmWater", kind === "water" ? 1 : 0);
    material.setFloat("uLocalProbe", 0);
    material.setFloat("uEnvironmentYSign", 1);
    material.setFloat("uEnvironmentIsLinear", 0);
    material.setFloat("uOutputLinear", 0);
    // Set directly at bind time, including frozen materials and live pp toggles.
    material.onBindObservable.add(() => {
      const processing = scene.imageProcessingConfiguration;
      material.getEffect().setFloat("uOutputLinear", processing.applyByPostProcess && processing.isEnabled ? 1 : 0);
    });
    material.setVector3("uProbePosition", Vector3.Zero());
    material.setVector3("uProbeMin", Vector3.Zero());
    material.setVector3("uProbeMax", Vector3.Zero());
    material.setArray4("uImpulses", Array(MAX_WATER_IMPULSES * 8).fill(0));
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
    material.setFloat("uSpecular", kind === "water" ? 0 : profile.specular);
    material.setFloat("uReflectivity", profile.reflectivity);
    material.setFloat("uTime", 0);
    // Missing depth uses a mild, uniform transmission approximation.
    material.setFloat("uHasDepth", 0);
    material.setVector4("uDepthProjection", new Vector4(1, 0, 0, 0));
    material.setFloat("uDebug", 0);
    material.setFloat("uFoam", kind === "water" ? 0 : profile.foam);
    material.setFloat("uFoamWidth", profile.foamWidth);
    material.setFloat("uCaustics", 0);
    if (kind === "water" && options.profile === "clear") {
      material.setFloat("uAbsorb", 0.0045);
      material.setFloat("uAlpha", 0.65);
    } else if (kind === "water" && options.profile === "deep") {
      material.setFloat("uAbsorb", 0.035);
      material.setFloat("uAlpha", 0.95);
    }
    material.setColor3("uAbsorbTint", profile.absorbTint);
    material.setFloat("uHasEnvironment", 0);
    material.setVector3("uCameraForward", new Vector3(0, 0, 1));
    material.setFloat("uCameraFar", 10000);
    material.setVector2("uScreenSize", new Vector2(1920, 1080));

    // Liquid is transparent and must not write depth, or the geometry under it
    // vanishes; and it is drawn from below as often as from above.
    material.alpha = profile.alpha;
    material.backFaceCulling = false;
    material.needDepthPrePass = false;
    bindAtmosphericFog(material);

    return material;
  } catch (error) {
    console.warn(`[Water] Unified material failed to build for ${kind}; keeping the legacy surface`, error);
    return null;
  }
}

/** Bind or clear the map/sky cubemap used by the cheap reflection tier. */
export function setWaterEnvironment(material: ShaderMaterial, texture: BaseTexture | null): void {
  if (texture?.isCube) {
    material.setTexture("uEnvironment", texture);
    material.setFloat("uHasEnvironment", 1);
    material.setFloat("uEnvironmentYSign", texture.coordinatesMode === 6 ? -1 : 1);
    material.setFloat("uEnvironmentIsLinear", texture.gammaSpace ? 0 : 1);
  } else {
    material.setFloat("uHasEnvironment", 0);
  }
}
