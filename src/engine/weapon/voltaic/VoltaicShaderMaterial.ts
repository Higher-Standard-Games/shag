import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";
import { VOLTAIC_REMOTE_FADE_START, VOLTAIC_REMOTE_REMOVE_TIME } from "./VoltaicProfiles";

const BEAM_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

#include<instancesDeclaration>

#ifdef WORLD_BATCH
attribute vec4 iStartSeed;
attribute vec4 iEndImpact;
attribute vec4 iColorLife;
attribute vec4 iParams;
#endif

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

#ifndef WORLD_BATCH
uniform vec4 uStartSeed;
uniform vec4 uEndImpact;
uniform vec4 uColorLife;
uniform vec4 uParams;
#endif

varying float vSide;
varying float vPart;
varying float vEnergy;
varying float vLife;
varying float vVolumeWeight;
varying vec3 vColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float linearNoise(float x, float seed) {
  float cell = floor(x);
  float f = fract(x);
  float a = hash11(cell + seed);
  float b = hash11(cell + 1.0 + seed);
  return mix(a, b, f) * 2.0 - 1.0;
}

float boltField(float distanceAlong, float state, float seed) {
  float coarse = linearNoise(distanceAlong / 92.0, seed + state * 17.0);
  float fine = linearNoise(distanceAlong / 27.0, seed * 3.1 + state * 41.0);
  return coarse + fine * 0.34;
}

float endpointEnvelope(float t) {
  // Keep the exact origin welded to tag_flash, then let the decorative field
  // peel away almost immediately so the beam does not read as a long plain rod.
  float enter = smoothstep(0.008, 0.14, t);
  float exit = 1.0 - smoothstep(0.92, 1.0, t);
  float finalThird = mix(0.72, 1.0, smoothstep(0.14, 0.68, t));
  return enter * exit * finalThird;
}

float sampleLife(float mode, float colorLifeW, float duration) {
  if (mode > 1.5) return colorLifeW;
  float age = max(0.0, uTime - colorLifeW);
  if (mode > 0.5) {
    return 1.0 - smoothstep(duration * 0.35, max(duration, 0.001), age);
  }
  return 1.0 - smoothstep(${VOLTAIC_REMOTE_FADE_START.toFixed(3)}, ${VOLTAIC_REMOTE_REMOVE_TIME.toFixed(3)}, age);
}

vec3 safeNormalize(vec3 value, vec3 fallback) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 0.0000001 ? value * inversesqrt(lengthSquared) : fallback;
}

vec3 viewRight() {
  return safeNormalize(vec3(view[0][0], view[1][0], view[2][0]), vec3(1.0, 0.0, 0.0));
}

vec3 viewUp() {
  return safeNormalize(vec3(view[0][1], view[1][1], view[2][1]), vec3(0.0, 1.0, 0.0));
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

  vec4 startSeed;
  vec4 endImpact;
  vec4 colorLife;
  vec4 params;

  #ifdef WORLD_BATCH
    startSeed = iStartSeed;
    endImpact = iEndImpact;
    colorLife = iColorLife;
    params = iParams;
  #else
    startSeed = uStartSeed;
    endImpact = uEndImpact;
    colorLife = uColorLife;
    params = uParams;
  #endif

  vec3 start = startSeed.xyz;
  vec3 end = endImpact.xyz;
  float seed = startSeed.w;
  float intensity = params.x;
  float amplitude = params.y;
  float mode = params.z;
  float life = sampleLife(mode, colorLife.w, params.w);
  float hero = step(1.5, mode);

  vec3 axis = end - start;
  float beamLength = max(length(axis), 0.001);
  vec3 viewForward = safeNormalize(vec3(view[0][2], view[1][2], view[2][2]), vec3(0.0, 0.0, 1.0));
  vec3 direction = safeNormalize(axis, viewForward);
  // Hero geometry carries two copies of every strip. Values above 15 encode
  // the second sheet while preserving the original presentation-part ID.
  float volumeLayer = step(15.5, position.z);
  float part = position.z - volumeLayer * 16.0;
  float localT = position.x;
  float rate = mix(17.0, 22.0, hero);
  if (mode > 0.5 && mode < 1.5) rate = 20.0;
  float electricalTime = uTime * rate + seed * 0.013;
  float state = floor(electricalTime);
  float statePhase = fract(electricalTime);

  float t = localT;
  float streamOffset = 0.0;
  float depthOffset = 0.0;
  float energy = 1.0;
  float fieldState = state;
  float partSeed = seed + part * 71.17;

  if (part > 5.5) {
    float forkSelector = hash11(state + seed * 0.37 + part * 9.0);
    float forkStart = mix(0.42, 0.82, hash11(state * 2.3 + partSeed));
    float forkSpan = mix(0.12, 0.24, hash11(state * 5.1 + partSeed));
    t = min(0.96, forkStart + localT * forkSpan);
    float anchorDistance = forkStart * beamLength;
    // Forks branch from the dominant stream's exact field, so their roots never float.
    float anchor = boltField(anchorDistance, state, seed + 2.0 * 71.17);
    float forkSign = mod(floor(part), 2.0) < 0.5 ? 1.0 : -1.0;
    float forkNoise = boltField(localT * forkSpan * beamLength, state, partSeed);
    streamOffset =
      anchor * endpointEnvelope(forkStart) * amplitude +
      forkSign * pow(localT, 0.72) * amplitude * mix(0.58, 1.12, forkSelector) +
      forkNoise * amplitude * 0.18 * localT;
    depthOffset = forkNoise * amplitude * 0.12;
    float probability = mix(0.72, 0.95, hero);
    energy = step(1.0 - probability, forkSelector) * (1.0 - smoothstep(0.72, 1.0, localT));
  } else {
    if (part > 4.5 && part < 5.5) fieldState = state - 1.0;
    float distanceAlong = t * beamLength;
    float field = boltField(distanceAlong, fieldState, partSeed);
    float depthField = boltField(distanceAlong + 31.0, fieldState, partSeed + 211.0);
    float envelope = endpointEnvelope(t);

    if (part < 0.5) {
      streamOffset = field * amplitude * envelope * 0.18;
      depthOffset = depthField * amplitude * envelope * 0.08;
      energy = mix(0.30, 0.42, hero);
    } else if (part < 1.5) {
      streamOffset = 0.0;
      depthOffset = 0.0;
      energy = 1.0;
    } else {
      float amplitudeScale = 1.0;
      if (part > 2.5 && part < 3.5) amplitudeScale = 0.72;
      if (part > 3.5 && part < 4.5) amplitudeScale = 0.54;
      if (part > 4.5 && part < 5.5) amplitudeScale = 0.88;
      streamOffset = field * amplitude * envelope * amplitudeScale;
      depthOffset = depthField * amplitude * envelope * amplitudeScale * 0.22;

      if (part > 2.5 && part < 4.5) {
        float window = hash11(floor(t * 11.0) + state * 3.0 + partSeed);
        energy *= smoothstep(0.24, 0.48, window);
      }
      if (part > 4.5 && part < 5.5) {
        energy *= 1.0 - smoothstep(0.0, 0.82, statePhase);
      }
    }
  }

  vec3 straightCenter = mix(start, end, t);
  vec3 toCamera = safeNormalize(cameraPosition - straightCenter, -viewForward);
  vec3 screenSide = cross(direction, toCamera);
  float sideLength = length(screenSide);
  vec3 fallbackSide = cross(direction, vec3(0.0, 1.0, 0.0));
  if (dot(fallbackSide, fallbackSide) < 0.000001) fallbackSide = cross(direction, vec3(1.0, 0.0, 0.0));
  fallbackSide = safeNormalize(fallbackSide, viewRight());
  vec3 billboardSide = sideLength > 0.001 ? screenSide / sideLength : fallbackSide;

  // A first-person beam is almost collinear with the camera ray. In that case
  // cross(direction, toCamera) is mathematically underdetermined, so tiny hip
  // wander changes can rotate the whole electrical field around the core. Pin
  // the hero field to camera-right projected onto the beam plane. World beams
  // retain the true billboard basis because observers view them from the side.
  vec3 heroSide = viewRight() - direction * dot(viewRight(), direction);
  if (dot(heroSide, heroSide) < 0.000001) heroSide = viewUp() - direction * dot(viewUp(), direction);
  heroSide = safeNormalize(heroSide, fallbackSide);
  screenSide = hero > 0.5 ? heroSide : billboardSide;
  vec3 screenDepth = safeNormalize(cross(direction, screenSide), toCamera);

  float displacementPixelCap = mix(12.0, 52.0, hero) * worldPerPixel(straightCenter);
  streamOffset = clamp(streamOffset, -displacementPixelCap, displacementPixelCap);
  depthOffset = clamp(depthOffset, -displacementPixelCap * 0.35, displacementPixelCap * 0.35);
  vec3 center = straightCenter + screenSide * streamOffset + screenDepth * depthOffset;

  float halfWidth;
  if (part < 0.5) {
    halfWidth = hybridHalfWidth(center, mix(1.8, 8.0, hero), mix(4.0, 22.0, hero), mix(18.0, 78.0, hero));
  } else if (part < 1.5) {
    halfWidth = hybridHalfWidth(center, mix(0.48, 1.04, hero), mix(3.4, 7.2, hero), mix(7.2, 14.5, hero));
  } else {
    halfWidth = hybridHalfWidth(center, mix(0.24, 0.76, hero), mix(1.6, 4.7, hero), mix(4.0, 15.0, hero));
  }

  // The local beam uses two orthogonal sheets rotated +/-45 degrees around
  // its truth axis. This gives it an X-shaped volume instead of one flat
  // camera-facing ribbon, without adding a mesh or draw call. World/chain
  // profiles retain their single billboard sheet.
  float volumeSign = mix(-1.0, 1.0, volumeLayer);
  vec3 crossedSide = safeNormalize(
    screenSide * 0.70710678 + screenDepth * volumeSign * 0.70710678,
    screenSide
  );
  vec3 ribbonSide = safeNormalize(mix(screenSide, crossedSide, hero), screenSide);
  vec3 worldPosition = center + ribbonSide * position.y * halfWidth;
  worldPosition = (finalWorld * vec4(worldPosition, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);

  vSide = position.y;
  vPart = part;
  vEnergy = energy * intensity;
  vLife = life;
  // Two sheets overlap at the core. Keep the combined result hot without
  // simply doubling its HDR energy.
  vVolumeWeight = mix(1.0, 0.72, hero);
  vColor = colorLife.rgb;
}
`;

const BEAM_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying float vSide;
varying float vPart;
varying float vEnergy;
varying float vLife;
varying float vVolumeWeight;
varying vec3 vColor;

void main() {
  float d = abs(vSide);
  float aa = max(fwidth(d), 0.001);
  float hot = 1.0 - smoothstep(0.12 - aa, 0.22 + aa, d);
  float body = 1.0 - smoothstep(0.52 - aa, 0.78 + aa, d);
  float fringe = 1.0 - smoothstep(0.78 - aa, 1.0 + aa, d);

  vec3 color = vColor;
  float alphaScale = 0.72;
  float hdrScale = 1.0;

  if (vPart < 0.5) {
    color = mix(vec3(0.08, 0.18, 1.0), vec3(0.46, 0.10, 1.0), smoothstep(0.0, 1.0, d));
    hot = 0.0;
    body *= 0.32;
    fringe *= 0.56;
    alphaScale = 0.20;
    hdrScale = 0.70;
  } else if (vPart < 1.5) {
    color = mix(vColor, vec3(1.0, 0.98, 0.86), 0.88);
    alphaScale = 0.96;
    hdrScale = 2.8;
  } else if (vPart > 4.5 && vPart < 5.5) {
    color = vec3(1.0, 0.24, 0.025);
    alphaScale = 0.34;
    hdrScale = 1.15;
  } else {
    color = mix(vColor, vec3(1.0, 0.94, 0.55), hot * 0.42);
    alphaScale = vPart > 5.5 ? 0.48 : 0.72;
    hdrScale = vPart > 5.5 ? 1.35 : 1.7;
  }

  float shape = hot + body * 0.62 + fringe * 0.22;
  float energy = max(vEnergy * vLife * vVolumeWeight, 0.0);
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

#ifdef WORLD_BATCH
attribute vec4 iStartSeed;
attribute vec4 iEndImpact;
attribute vec4 iColorLife;
attribute vec4 iParams;
attribute vec4 iNormal;
#endif

uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform vec2 uViewport;
uniform float uTime;

#ifndef WORLD_BATCH
uniform vec4 uStartSeed;
uniform vec4 uEndImpact;
uniform vec4 uColorLife;
uniform vec4 uParams;
uniform vec4 uNormal;
#endif

varying vec2 vImpactUv;
varying float vImpactPart;
varying float vImpactKind;
varying float vImpactEnergy;
varying vec3 vImpactColor;
varying vec2 vStateSeed;
varying float vIsMuzzle;
varying float vIsSpark;
varying float vSparkLife;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float sampleLife(float mode, float colorLifeW, float duration) {
  if (mode > 1.5) return colorLifeW;
  float age = max(0.0, uTime - colorLifeW);
  if (mode > 0.5) {
    return 1.0 - smoothstep(duration * 0.35, max(duration, 0.001), age);
  }
  return 1.0 - smoothstep(${VOLTAIC_REMOTE_FADE_START.toFixed(3)}, ${VOLTAIC_REMOTE_REMOVE_TIME.toFixed(3)}, age);
}

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

  vec4 startSeed;
  vec4 endImpact;
  vec4 colorLife;
  vec4 params;
  vec4 normalData;

  #ifdef WORLD_BATCH
    startSeed = iStartSeed;
    endImpact = iEndImpact;
    colorLife = iColorLife;
    params = iParams;
    normalData = iNormal;
  #else
    startSeed = uStartSeed;
    endImpact = uEndImpact;
    colorLife = uColorLife;
    params = uParams;
    normalData = uNormal;
  #endif

  float mode = params.z;
  float hero = step(1.5, mode);
  float impactKind = endImpact.w;
  float part = position.z;
  float spark = step(3.5, part);
  float muzzle = step(1.5, part) * (1.0 - spark);
  float sampleEnergy = sampleLife(mode, colorLife.w, params.w);
  float impactLife = sampleEnergy * step(0.5, impactKind);
  float muzzleLife = sampleEnergy * hero;
  float life = mix(impactLife, muzzleLife, muzzle);
  vec3 center = mix(endImpact.xyz, startSeed.xyz, muzzle);
  float pixelScale = worldPerPixel(center);
  float endpointRadius = clamp(
    mix(2.6, 9.0, hero),
    mix(6.0, 22.0, hero) * pixelScale,
    mix(19.0, 72.0, hero) * pixelScale
  );
  // The weapon camera draws over the world effect, so the corona must extend
  // beyond the viewmodel silhouette to remain readable around the barrel.
  float muzzleRadius = clamp(8.4, 30.0 * pixelScale, 84.0 * pixelScale);
  float radius = mix(endpointRadius, muzzleRadius, muzzle) * step(0.0001, life);

  vec3 cameraRight = safeNormalize(vec3(view[0][0], view[1][0], view[2][0]), vec3(1.0, 0.0, 0.0));
  vec3 cameraUp = safeNormalize(vec3(view[0][1], view[1][1], view[2][1]), vec3(0.0, 1.0, 0.0));
  vec3 normal = mix(normalData.xyz, startSeed.xyz - endImpact.xyz, muzzle);
  if (length(normal) < 0.1) normal = safeNormalize(cameraPosition - center, vec3(0.0, 1.0, 0.0));
  else normal = safeNormalize(normal, vec3(0.0, 1.0, 0.0));
  vec3 reference = abs(normal.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 surfaceRight = safeNormalize(cross(reference, normal), cameraRight);
  vec3 surfaceUp = safeNormalize(cross(normal, surfaceRight), cameraUp);

  float orientedPart = mod(part, 2.0);
  vec3 worldPosition;
  float sparkLife = 1.0;

  if (spark > 0.5) {
    float sparkId = part - 4.0;
    float sparkSeed = hash11(startSeed.w * 0.017 + sparkId * 19.19);
    // Refresh more aggressively than the endpoint crown so contact reads as a
    // continuous high-energy spray instead of a cluster of stationary needles.
    float cycle = fract(uTime * mix(3.5, 4.6, hero) + sparkSeed * 7.31);
    float flightTime = cycle * mix(0.26, 0.34, hash11(sparkSeed * 31.7));
    float azimuth = hash11(sparkSeed * 73.1 + 4.2) * 6.28318530718;
    vec3 tangent = surfaceRight * cos(azimuth) + surfaceUp * sin(azimuth);
    float outwardSpeed = mix(32.0, 58.0, hash11(sparkSeed * 11.3));
    float tangentSpeed = mix(42.0, 78.0, hash11(sparkSeed * 43.7));
    vec3 velocity = normal * outwardSpeed + tangent * tangentSpeed;
    vec3 gravity = vec3(0.0, -64.0, 0.0);
    vec3 sparkOrigin = endImpact.xyz + normal * 0.18;
    vec3 head = sparkOrigin + velocity * flightTime + gravity * (0.5 * flightTime * flightTime);
    float tailTime = max(0.0, flightTime - mix(0.085, 0.145, hash11(sparkSeed * 97.3)));
    vec3 tail = sparkOrigin + velocity * tailTime + gravity * (0.5 * tailTime * tailTime);
    float along = uv.x * 0.5 + 0.5;
    vec3 streakCenter = mix(tail, head, along);
    vec3 streakDirection = safeNormalize(head - tail, tangent);
    vec3 toCamera = safeNormalize(cameraPosition - streakCenter, cameraUp);
    vec3 streakSide = safeNormalize(cross(streakDirection, toCamera), cameraRight);
    float sparkPixelScale = worldPerPixel(streakCenter);
    // These are stylized electrical chunks rather than physically tiny embers.
    // A six-pixel minimum half-width keeps their full cross-section readable at
    // combat FOV; the clamp still limits close-up fill cost.
    float sparkHalfWidth = clamp(1.12, 6.00 * sparkPixelScale, mix(10.4, 16.8, hero) * sparkPixelScale);
    worldPosition = streakCenter + streakSide * position.y * sparkHalfWidth;

    // Hero shows all eight ejecta streaks. The remote profile evaluates only
    // four, preserving the same contact identity at a lower fill-rate cost.
    float profileGate = mix(1.0 - step(3.5, sparkId), 1.0, hero);
    // Both world (1) and player (2) contacts eject sparks from the exact
    // resolved endpoint. Misses (0) remain clean.
    float contactGate = step(0.5, impactKind) * step(0.0001, sampleEnergy);
    float drawGate = profileGate * contactGate;
    // Collapse disabled quads before rasterization. Alpha-zero geometry would
    // still burn fragment fill, especially for remote misses.
    worldPosition = mix(endImpact.xyz, worldPosition, drawGate);
    float fade = 1.0 - smoothstep(0.76, 0.98, cycle);
    float flicker = mix(0.62, 1.0, hash11(floor(uTime * 24.0) + sparkId * 13.0 + startSeed.w));
    sparkLife = drawGate * fade * flicker;
  } else {
    vec3 right = orientedPart < 0.5 ? cameraRight : surfaceRight;
    vec3 up = orientedPart < 0.5 ? cameraUp : surfaceUp;
    vec3 offsetCenter = center + normal * (orientedPart < 0.5 ? 0.08 : 0.12);
    worldPosition = offsetCenter + (right * position.x + up * position.y) * radius;
  }

  worldPosition = (finalWorld * vec4(worldPosition, 1.0)).xyz;
  gl_Position = viewProjection * vec4(worldPosition, 1.0);

  vImpactUv = uv;
  vImpactPart = orientedPart;
  vImpactKind = impactKind;
  vImpactEnergy = params.x * life;
  vImpactColor = colorLife.rgb;
  vStateSeed = vec2(floor(uTime * mix(17.0, 22.0, hero) + startSeed.w * 0.013), startSeed.w);
  vIsMuzzle = muzzle;
  vIsSpark = spark;
  vSparkLife = sparkLife;
}
`;

const IMPACT_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vImpactUv;
varying float vImpactPart;
varying float vImpactKind;
varying float vImpactEnergy;
varying vec3 vImpactColor;
varying vec2 vStateSeed;
varying float vIsMuzzle;
varying float vIsSpark;
varying float vSparkLife;

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
  float energy = max(vImpactEnergy, 0.0);

  if (vIsSpark > 0.5) {
    float across = abs(vImpactUv.y);
    float along = vImpactUv.x * 0.5 + 0.5;
    float filament = 1.0 - smoothstep(0.08, 1.0, across);
    float hotHead = smoothstep(0.52, 1.0, along);
    float tailFade = smoothstep(0.0, 0.18, along);
    float shape = filament * tailFade * mix(0.48, 1.35, hotHead);
    vec3 ember = mix(vec3(1.0, 0.16, 0.015), vImpactColor, 0.28);
    vec3 sparkColor = mix(ember, vec3(1.0, 0.98, 0.76), hotHead);
    float alpha = clamp(shape * energy * vSparkLife * 0.96, 0.0, 0.98);
    gl_FragColor = vec4(sparkColor * shape * energy * vSparkLife * 4.1 * alpha, alpha);
    return;
  }

  if (vIsMuzzle > 0.5) {
    float muzzleSegment = floor(((angle + PI) / (2.0 * PI)) * 15.0);
    float muzzleBroken = step(0.28, hash11(muzzleSegment + state * 5.0 + seed * 0.31));
    float muzzleNucleus = 1.0 - smoothstep(0.03, 0.23 + aa, r);
    float muzzleHalo = (1.0 - smoothstep(0.12, 0.94, r)) * 0.35;
    float muzzleRing = 1.0 - smoothstep(0.025, 0.075 + aa, abs(r - 0.43));
    float muzzleOuterRing = 1.0 - smoothstep(0.025, 0.065 + aa, abs(r - 0.69));
    float muzzleNeedles = pow(abs(cos(angle * 7.0 + state * 0.81 + seed)), 44.0);
    float needleEnvelope = smoothstep(0.18, 0.34, r) * (1.0 - smoothstep(0.62, 1.02, r));
    float muzzleTicks = pow(abs(cos(angle * 13.0 - state * 0.37 + seed)), 70.0);
    float tickEnvelope = smoothstep(0.46, 0.58, r) * (1.0 - smoothstep(0.76, 0.98, r));
    float cameraLayer = 1.0 - step(0.5, vImpactPart);
    float muzzleShape = mix(
      (muzzleRing * 0.9 + muzzleOuterRing * 0.55) * muzzleBroken +
        muzzleNeedles * needleEnvelope * 1.35 + muzzleTicks * tickEnvelope,
      muzzleNucleus + muzzleHalo + muzzleRing * muzzleBroken * 0.58 +
        muzzleOuterRing * muzzleBroken * 0.25 + muzzleNeedles * needleEnvelope * 0.35,
      cameraLayer
    );
    vec3 muzzleEdge = mix(vec3(0.22, 0.07, 1.0), vImpactColor, 0.72);
    vec3 muzzleColor = mix(muzzleEdge, vec3(1.0, 0.985, 0.88), max(muzzleNucleus, muzzleNeedles * 0.58));
    float muzzleAlpha = clamp(muzzleShape * energy * 0.86, 0.0, 0.97);
    gl_FragColor = vec4(muzzleColor * muzzleShape * energy * 2.9 * muzzleAlpha, muzzleAlpha);
    return;
  }

  float nucleus = 1.0 - smoothstep(0.04, 0.32 + aa, r);
  float halo = (1.0 - smoothstep(0.18, 1.0, r)) * 0.25;
  float crown = 1.0 - smoothstep(0.035, 0.085 + aa, abs(r - 0.50));
  float outerCrown = 1.0 - smoothstep(0.028, 0.065 + aa, abs(r - 0.73));
  float segment = floor(((angle + PI) / (2.0 * PI)) * 13.0);
  float broken = step(0.27, hash11(segment + state * 7.0 + seed));
  float rays = pow(abs(cos(angle * 7.0 + state * 0.71 + seed)), 38.0);
  float spikeEnvelope = smoothstep(0.20, 0.36, r) * (1.0 - smoothstep(0.48, 1.0, r));
  float spikes = rays * spikeEnvelope;
  float sparkRays = pow(abs(cos(angle * 11.0 - state * 0.43 + seed)), 64.0);
  float sparkEnvelope = smoothstep(0.42, 0.58, r) * (1.0 - smoothstep(0.72, 1.02, r));
  float sparks = sparkRays * sparkEnvelope * step(0.22, hash11(segment + state * 11.0 + seed));

  vec3 color;
  float shape;
  float alphaScale;
  float hdrScale;

  if (vImpactPart < 0.5) {
    shape = nucleus + halo;
    color = mix(vec3(0.32, 0.10, 1.0), vec3(1.0, 0.99, 0.90), nucleus);
    alphaScale = 0.92;
    hdrScale = 3.2;
  } else {
    float player = step(1.5, vImpactKind);
    float contactPulse = mix(1.0, 0.84 + 0.16 * sin(state * 2.31 + seed), player);
    shape = (
      (crown + outerCrown * 0.58) * broken * mix(1.0, 1.30, player) +
      spikes * mix(1.0, 1.55, player) + sparks * mix(0.85, 1.35, player)
    ) * contactPulse;
    vec3 worldColor = mix(vImpactColor, vec3(1.0, 0.91, 0.42), crown);
    vec3 playerColor = mix(vec3(0.20, 0.08, 1.0), vec3(1.0, 0.98, 0.82), max(crown, spikes));
    color = mix(worldColor, playerColor, player);
    alphaScale = mix(0.72, 0.88, player);
    hdrScale = mix(1.9, 2.7, player);
  }

  float alpha = clamp(shape * energy * alphaScale, 0.0, 0.97);
  vec3 rgb = color * shape * energy * hdrScale * alpha;
  gl_FragColor = vec4(rgb, alpha);
}
`;

let shadersRegistered = false;

function ensureShadersRegistered(): void {
  if (shadersRegistered) return;
  Effect.ShadersStore.voltaicBeamVertexShader = BEAM_VERTEX_SHADER;
  Effect.ShadersStore.voltaicBeamFragmentShader = BEAM_FRAGMENT_SHADER;
  Effect.ShadersStore.voltaicImpactVertexShader = IMPACT_VERTEX_SHADER;
  Effect.ShadersStore.voltaicImpactFragmentShader = IMPACT_FRAGMENT_SHADER;
  shadersRegistered = true;
}

const COMMON_UNIFORMS = ["world", "view", "projection", "viewProjection", "cameraPosition", "uViewport", "uTime"];

const BEAM_SAMPLE_UNIFORMS = ["uStartSeed", "uEndImpact", "uColorLife", "uParams"];
const IMPACT_SAMPLE_UNIFORMS = [...BEAM_SAMPLE_UNIFORMS, "uNormal"];
const BEAM_INSTANCE_ATTRIBUTES = ["iStartSeed", "iEndImpact", "iColorLife", "iParams"];
const IMPACT_INSTANCE_ATTRIBUTES = [...BEAM_INSTANCE_ATTRIBUTES, "iNormal"];

function createMaterial(
  name: string,
  scene: Scene,
  shaderName: "voltaicBeam" | "voltaicImpact",
  worldBatch: boolean,
): ShaderMaterial {
  ensureShadersRegistered();
  const isImpact = shaderName === "voltaicImpact";
  const instanceAttributes = isImpact ? IMPACT_INSTANCE_ATTRIBUTES : BEAM_INSTANCE_ATTRIBUTES;
  const sampleUniforms = isImpact ? IMPACT_SAMPLE_UNIFORMS : BEAM_SAMPLE_UNIFORMS;
  const material = new ShaderMaterial(
    name,
    scene,
    { vertex: shaderName, fragment: shaderName },
    {
      attributes: ["position", "uv", ...(worldBatch ? instanceAttributes : [])],
      uniforms: [...COMMON_UNIFORMS, ...(worldBatch ? [] : sampleUniforms)],
      defines: worldBatch ? ["WORLD_BATCH"] : [],
      needAlphaBlending: true,
    },
  );
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  return material;
}

export function createVoltaicBeamMaterial(name: string, scene: Scene, worldBatch: boolean): ShaderMaterial {
  return createMaterial(name, scene, "voltaicBeam", worldBatch);
}

export function createVoltaicImpactMaterial(name: string, scene: Scene, worldBatch: boolean): ShaderMaterial {
  return createMaterial(name, scene, "voltaicImpact", worldBatch);
}
