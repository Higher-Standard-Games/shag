import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Per-vertex billboard data for Q3 autosprite faces, turned toward the eye in
 * the vertex shader.
 *
 * `q3SpriteCenter` is the face centre and the mode in w: 0 keeps the vertex as
 * authored, 1 is a full billboard (autosprite), 2 turns about a long axis
 * (autosprite2). For a full billboard `q3SpriteFrame.xy` is the vertex's right
 * and up offset from the centre. For an axis sprite `q3SpriteFrame` is the axis
 * and the offset along it, and `q3SpriteRight` the authored right direction and
 * the offset across it. No mode reads the position buffer, so a CPU billboard
 * written into it for another pass cannot move the vertex twice.
 */
export const AUTOSPRITE_CENTER_KIND = "q3SpriteCenter";
export const AUTOSPRITE_FRAME_KIND = "q3SpriteFrame";
export const AUTOSPRITE_RIGHT_KIND = "q3SpriteRight";
const PLUGIN_NAME = "Q3Autosprite";

/** Billboard sprite meshes on the GPU when drawn with a Standard or PBR material. */
export function configureQ3Autosprite(material: Material | null): void {
  if (!(material instanceof StandardMaterial || material instanceof PBRMaterial)) return;
  if (!material.pluginManager?.getPlugin(PLUGIN_NAME)) new Q3AutospritePlugin(material);
}

/**
 * Whether the vertex shader turns this mesh. Babylon's effect layers (glow,
 * highlight) draw with shaders of their own, so a scene that has one keeps the
 * CPU billboard as well.
 */
export function isGpuAutosprite(mesh: AbstractMesh): boolean {
  return (
    mesh.getScene().effectLayers.length === 0 &&
    mesh.isVerticesDataPresent(AUTOSPRITE_CENTER_KIND) &&
    (mesh.material?.pluginManager?.getPlugin<Q3AutospritePlugin>(PLUGIN_NAME)?.enabled ?? false)
  );
}

export class Q3AutospritePlugin extends MaterialPluginBase {
  private on = false;

  constructor(material: StandardMaterial | PBRMaterial) {
    // Before every other plugin, which see the turned position
    super(material, PLUGIN_NAME, 100, { Q3_AUTOSPRITE: false }, true, true);
    this.on = true;
  }
  /**
   * Off hands the mesh back to the CPU billboard, for comparison. Babylon has no
   * way to deactivate a plugin, so the define switches it.
   */
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    if (this.on === value) return;
    this.on = value;
    this.markAllDefinesAsDirty();
  }
  override getClassName(): string {
    return "Q3AutospritePlugin";
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override prepareDefinesBeforeAttributes(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.Q3_AUTOSPRITE = this.on && mesh.isVerticesDataPresent(AUTOSPRITE_CENTER_KIND);
  }
  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (!this.on || !mesh.isVerticesDataPresent(AUTOSPRITE_CENTER_KIND)) return;
    attributes.push(AUTOSPRITE_CENTER_KIND, AUTOSPRITE_FRAME_KIND, AUTOSPRITE_RIGHT_KIND);
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> | null {
    if (type !== "vertex") return null;
    return language === ShaderLanguage.WGSL ? WGSL : GLSL;
  }
}

// The same arithmetic as the CPU billboard: right is horizontal, up = forward x right,
// and an axis sprite takes a negative cross product for the Q3-to-Babylon handedness.
const GLSL = {
  CUSTOM_VERTEX_DEFINITIONS: `
#ifdef Q3_AUTOSPRITE
attribute vec4 q3SpriteCenter;
attribute vec4 q3SpriteFrame;
attribute vec4 q3SpriteRight;
#endif
`,
  CUSTOM_VERTEX_UPDATE_POSITION: `
#ifdef Q3_AUTOSPRITE
vec3 q3SpriteFacing = vec3(0.0);
if (q3SpriteCenter.w > 0.5) {
  vec3 q3Center = q3SpriteCenter.xyz;
  vec3 q3ToEye = vEyePosition.xyz - q3Center;
  if (q3SpriteCenter.w < 1.5) {
    float q3Distance = length(q3ToEye);
    if (q3Distance >= 0.001) {
      vec3 q3Forward = q3ToEye / q3Distance;
      vec3 q3Right = vec3(q3Forward.z, 0.0, -q3Forward.x);
      float q3RightLength = length(q3Right);
      vec3 q3Up;
      if (q3RightLength < 0.001) {
        q3Right = vec3(1.0, 0.0, 0.0);
        q3Up = vec3(0.0, 0.0, -1.0);
      } else {
        q3Right /= q3RightLength;
        q3Up = vec3(q3Forward.y * q3Right.z, q3Forward.z * q3Right.x - q3Forward.x * q3Right.z, -q3Forward.y * q3Right.x);
      }
      positionUpdated = q3Center + q3Right * q3SpriteFrame.x + q3Up * q3SpriteFrame.y;
      q3SpriteFacing = q3Forward;
    }
  } else {
    vec3 q3Axis = q3SpriteFrame.xyz;
    vec3 q3Across = q3ToEye - q3Axis * dot(q3ToEye, q3Axis);
    float q3AcrossLength = length(q3Across);
    if (q3AcrossLength >= 0.0001) {
      q3Across /= q3AcrossLength;
      vec3 q3Right = vec3(
        q3Axis.z * q3Across.y - q3Axis.y * q3Across.z,
        q3Axis.x * q3Across.z - q3Axis.z * q3Across.x,
        q3Axis.y * q3Across.x - q3Axis.x * q3Across.y);
      positionUpdated = q3Center + q3Axis * q3SpriteFrame.w + q3Right * q3SpriteRight.w;
      q3SpriteFacing = q3Across;
    }
  }
}
#endif
`,
  CUSTOM_VERTEX_UPDATE_NORMAL: `
#if defined(Q3_AUTOSPRITE) && defined(NORMAL)
if (dot(q3SpriteFacing, q3SpriteFacing) > 0.0) normalUpdated = q3SpriteFacing;
#endif
`,
};

const WGSL = {
  CUSTOM_VERTEX_DEFINITIONS: `
#ifdef Q3_AUTOSPRITE
attribute q3SpriteCenter: vec4f;
attribute q3SpriteFrame: vec4f;
attribute q3SpriteRight: vec4f;
#endif
`,
  CUSTOM_VERTEX_UPDATE_POSITION: `
#ifdef Q3_AUTOSPRITE
var q3SpriteFacing: vec3f = vec3f(0.0);
let q3SpriteData: vec4f = vertexInputs.q3SpriteCenter;
let q3Frame: vec4f = vertexInputs.q3SpriteFrame;
if (q3SpriteData.w > 0.5) {
  let q3Center: vec3f = q3SpriteData.xyz;
  let q3ToEye: vec3f = scene.vEyePosition.xyz - q3Center;
  if (q3SpriteData.w < 1.5) {
    let q3Distance: f32 = length(q3ToEye);
    if (q3Distance >= 0.001) {
      let q3Forward: vec3f = q3ToEye / q3Distance;
      var q3Right: vec3f = vec3f(q3Forward.z, 0.0, -q3Forward.x);
      let q3RightLength: f32 = length(q3Right);
      var q3Up: vec3f;
      if (q3RightLength < 0.001) {
        q3Right = vec3f(1.0, 0.0, 0.0);
        q3Up = vec3f(0.0, 0.0, -1.0);
      } else {
        q3Right = q3Right / q3RightLength;
        q3Up = vec3f(q3Forward.y * q3Right.z, q3Forward.z * q3Right.x - q3Forward.x * q3Right.z, -q3Forward.y * q3Right.x);
      }
      positionUpdated = q3Center + q3Right * q3Frame.x + q3Up * q3Frame.y;
      q3SpriteFacing = q3Forward;
    }
  } else {
    let q3Axis: vec3f = q3Frame.xyz;
    var q3Across: vec3f = q3ToEye - q3Axis * dot(q3ToEye, q3Axis);
    let q3AcrossLength: f32 = length(q3Across);
    if (q3AcrossLength >= 0.0001) {
      q3Across = q3Across / q3AcrossLength;
      let q3Right: vec3f = vec3f(
        q3Axis.z * q3Across.y - q3Axis.y * q3Across.z,
        q3Axis.x * q3Across.z - q3Axis.z * q3Across.x,
        q3Axis.y * q3Across.x - q3Axis.x * q3Across.y);
      positionUpdated = q3Center + q3Axis * q3Frame.w + q3Right * vertexInputs.q3SpriteRight.w;
      q3SpriteFacing = q3Across;
    }
  }
}
#endif
`,
  CUSTOM_VERTEX_UPDATE_NORMAL: `
#if defined(Q3_AUTOSPRITE) && defined(NORMAL)
if (dot(q3SpriteFacing, q3SpriteFacing) > 0.0) { normalUpdated = q3SpriteFacing; }
#endif
`,
};
