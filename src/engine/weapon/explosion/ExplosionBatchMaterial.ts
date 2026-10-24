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
  atmFogMixGlsl,
  bindAtmosphericFog,
} from "../../rendering/AtmosphericFogShader";

/**
 * The four explosion layers, each one thin-instanced mesh whose vertex shader
 * animates every live explosion from its spawn time. An explosion therefore
 * costs no meshes, materials or per-frame CPU work of its own, and all live
 * explosions draw in four calls.
 *
 * Every instance carries five vec4 attributes, read per layer:
 *
 *   layer      iA               iB                 iC               iD                  iE
 *   fireball   origin, spawn    hit normal, speed  core, scale      outer, -            smoke, -
 *   ray        origin, spawn    direction, speed   core, scale      outer, width        length, -
 *   shockwave  origin, spawn    rotation quat      outer, scale     speed, splash, -    -
 *   spark      origin, spawn    velocity, life     color, size      dead color, -       -
 *
 * Ages are in the explosion's own time (seconds × speed). Sparks keep Babylon
 * particle time, 0.6 units a second, with velocity and gravity in its units.
 */
export type ExplosionLayer = "fireball" | "ray" | "shockwave" | "spark";

export const EXPLOSION_INSTANCE_ATTRIBUTES = ["iA", "iB", "iC", "iD", "iE"] as const;

/** Explosion time over which the fireball, rays and shockwave play out. */
export const EXPLOSION_FIRE_TIME = 0.6;
/** Babylon particle age units per second (0.01 per frame at 60 fps). */
export const SPARK_AGE_PER_SECOND = 0.6;
export const SPARK_GRAVITY = -30;

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
#ifdef SPARK
attribute vec2 uv;
#endif

#include<instancesDeclaration>

attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
attribute vec4 iE;

uniform mat4 view;
uniform mat4 viewProjection;
uniform float uTime;

varying vec3 vColor;
varying float vAlpha;
varying vec3 vAtmWorld;
#ifdef SPARK
varying vec2 vUv;
#endif

float easeOut(float t) { return t * (2.0 - t); }

vec3 rotateByQuat(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  #include<instancesVertex>

  vec3 origin = iA.xyz;
  float seconds = max(0.0, uTime - iA.w);
  vec3 world;

#ifdef FIREBALL
  float speed = iB.w;
  float scale = iC.w;
  float t = clamp(seconds * speed / ${EXPLOSION_FIRE_TIME.toFixed(1)}, 0.0, 1.0);
  float grow = easeOut(min(t / 0.7, 1.0));

  // The spiky shell: a fixed noise pushes the sphere out (its second angle
  // reads the height over the scaled radius, so each size has its own
  // pattern), spikes lengthen as it grows, then the fire flattens against the
  // hit surface and spreads across it while it fades.
  float baseR = 2.5 * scale;
  vec3 unit = normalize(position);
  float angle1 = atan(unit.y, unit.x);
  float angle2 = acos(clamp(unit.z / baseR, -1.0, 1.0));
  float noise = 0.5 + 0.5 * sin(angle1 * 7.3 + angle2 * 5.1) * cos(angle1 * 3.7 - angle2 * 8.9);
  vec3 o = unit * baseR * (1.0 + noise * 0.8);
  float dist = length(o);
  vec3 v = o;
  if (dist > 0.0) {
    float newDist = baseR + (dist - baseR) * (1.0 + grow * 1.5);
    v = o * (newDist / dist);
    float spread = easeOut(t > 0.4 ? (t - 0.4) / 0.6 : 0.0) * 1.2;
    if (spread > 0.0) {
      vec3 n = iB.xyz;
      vec3 along = dot(v, n) * n;
      vec3 across = v - along;
      v = along * max(0.3, 1.0 - spread * 0.4) + across * (1.0 + spread * 0.5);
    }
  }
  world = origin + v * grow;

  // White-hot to the outer colour, to a dim outer colour, to smoke.
  vec3 core = iC.rgb;
  vec3 outer = iD.rgb;
  vec3 fade = outer * 0.4;
  vColor = t < 0.3 ? mix(core, outer, t / 0.3)
         : t < 0.6 ? mix(outer, fade, (t - 0.3) / 0.3)
         : mix(fade, iE.rgb, (t - 0.6) / 0.4);
  vAlpha = t < 0.4 ? 0.9 : 0.9 * (1.0 - (t - 0.4) / 0.6);
#endif

#ifdef RAY
  float speed = iB.w;
  float scale = iC.w;
  float t = clamp(seconds * speed / ${EXPLOSION_FIRE_TIME.toFixed(1)}, 0.0, 1.0);
  float grow = easeOut(min(t / 0.15, 1.0));
  vec3 dir = iB.xyz;
  vec3 center = origin + dir * (easeOut(min(t / 0.3, 1.0)) * 4.0 * scale);
  // The cone's +Y runs along the ray; its base lies across it.
  vec3 helper = abs(dir.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 side = normalize(cross(helper, dir));
  vec3 up = cross(side, dir); // right-handed, so the culled faces stay the back ones
  vec3 local = side * (position.x * iD.w) + dir * (position.y * iE.x) + up * (position.z * iD.w);
  world = center + local * grow;
  vColor = mix(iC.rgb, iD.rgb, min(t * 3.0, 1.0));
  vAlpha = t < 0.25 ? 0.8 : 0.8 * max(0.0, 1.0 - (t - 0.25) / 0.35);
#endif

#ifdef SHOCKWAVE
  float speed = iD.x;
  float scale = iC.w;
  float t = clamp(seconds * speed / ${EXPLOSION_FIRE_TIME.toFixed(1)}, 0.0, 1.0);
  float ringT = min(t / 0.7, 1.0);
  float expand = easeOut(ringT) * (iD.y * 2.0) / scale;
  vec3 local = position * scale * vec3(expand, max(0.1, 1.0 - ringT * 0.8), expand);
  world = origin + rotateByQuat(local, iB);
  vColor = iC.rgb;
  vAlpha = 0.5 * (1.0 - ringT);
#endif

#ifdef SPARK
  float age = seconds * ${SPARK_AGE_PER_SECOND.toFixed(1)};
  float life = max(iB.w, 0.0001);
  float frac = clamp(age / life, 0.0, 1.0);
  vec3 center = origin + iB.xyz * age + vec3(0.0, 0.5 * ${SPARK_GRAVITY.toFixed(1)} * age * age, 0.0);
  vec3 camRight = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 camUp = vec3(view[0][1], view[1][1], view[2][1]);
  world = center + (camRight * position.x + camUp * position.y) * iC.w;
  vColor = mix(iC.rgb, iD.rgb, frac);
  vAlpha = 1.0 - frac;
  vUv = uv;
#endif

  // A finished layer collapses rather than drawing invisible triangles.
  world = vAlpha > 0.0 ? world : origin;
  world = (finalWorld * vec4(world, 1.0)).xyz;
  gl_Position = viewProjection * vec4(world, 1.0);
  vAtmWorld = world;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying vec3 vAtmWorld;
#ifdef SPARK
varying vec2 vUv;
#endif

// 1 while image processing runs as a post-process, which expects linear
// colour back, as Babylon's own materials and particles convert theirs
uniform float uLinearOutput;

${ATM_FOG_GLSL}
void main() {
  if (vAlpha <= 0.0) discard;
#ifdef SPARK
  // The soft spark sprite: white centre through amber to a clear rim.
  float r = length(vUv - 0.5) * 2.0;
  vec4 sprite = r < 0.3 ? mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(1.0, 0.902, 0.706, 0.8), r / 0.3)
              : r < 0.7 ? mix(vec4(1.0, 0.902, 0.706, 0.8), vec4(1.0, 0.588, 0.196, 0.3), (r - 0.3) / 0.4)
              : mix(vec4(1.0, 0.588, 0.196, 0.3), vec4(1.0, 0.392, 0.078, 0.0), clamp((r - 0.7) / 0.3, 0.0, 1.0));
  gl_FragColor = vec4(sprite.rgb * vColor, sprite.a * vAlpha);
  ${atmFogFadeGlsl("gl_FragColor.rgb", "vAtmWorld")}
#else
  gl_FragColor = vec4(clamp(vColor, 0.0, 1.0), vAlpha);
  ${atmFogMixGlsl("gl_FragColor", "vAtmWorld")}
#endif
  if (uLinearOutput > 0.5) gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(2.2));
}
`;

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  Effect.ShadersStore.explosionBatchVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.explosionBatchFragmentShader = FRAGMENT_SHADER;
  registered = true;
}

const DEFINES: Record<ExplosionLayer, string> = {
  fireball: "#define FIREBALL",
  ray: "#define RAY",
  shockwave: "#define SHOCKWAVE",
  spark: "#define SPARK",
};

export function createExplosionLayerMaterial(layer: ExplosionLayer, scene: Scene): ShaderMaterial {
  ensureRegistered();
  const material = new ShaderMaterial(
    `explosion_${layer}_material`,
    scene,
    { vertex: "explosionBatch", fragment: "explosionBatch" },
    {
      attributes:
        layer === "spark"
          ? ["position", "uv", ...EXPLOSION_INSTANCE_ATTRIBUTES]
          : ["position", ...EXPLOSION_INSTANCE_ATTRIBUTES],
      uniforms: ["world", "view", "viewProjection", "uTime", "uLinearOutput", ...ATM_FOG_SHADER_UNIFORMS],
      defines: [DEFINES[layer]],
      needAlphaBlending: true,
    },
  );
  if (layer === "spark") {
    // Additive, and like particles it never writes depth.
    material.alphaMode = Constants.ALPHA_ADD;
    material.disableDepthWrite = true;
  } else {
    material.alphaMode = Constants.ALPHA_COMBINE;
  }
  // Rays keep their cone's back faces culled; the fireball and disc draw both sides.
  material.backFaceCulling = layer === "ray";
  bindAtmosphericFog(material);
  return material;
}
