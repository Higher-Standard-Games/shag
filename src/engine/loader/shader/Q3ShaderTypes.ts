/**
 * Q3ShaderTypes - Type definitions for Quake3/Warsow shader system
 *
 * These shaders are defined in .shader files within PK3 archives
 * and control texture blending, transparency, animation, and other effects.
 */

/**
 * Blend function presets and their GL equivalents
 */
export type BlendFuncPreset = "add" | "blend" | "filter";

/**
 * GL blend factors
 */
export type BlendFactor =
  | "GL_ONE"
  | "GL_ZERO"
  | "GL_SRC_COLOR"
  | "GL_DST_COLOR"
  | "GL_ONE_MINUS_SRC_COLOR"
  | "GL_ONE_MINUS_DST_COLOR"
  | "GL_SRC_ALPHA"
  | "GL_DST_ALPHA"
  | "GL_ONE_MINUS_SRC_ALPHA"
  | "GL_ONE_MINUS_DST_ALPHA";

/**
 * Alpha test functions
 */
export type AlphaFunc = "GT0" | "GE128" | "LT128";

/**
 * Cull modes
 */
export type CullMode = "front" | "back" | "none" | "disable";

/**
 * TC (texture coordinate) modifier types
 */
export interface TcModScroll {
  type: "scroll";
  sSpeed: number;
  tSpeed: number;
}

export interface TcModScale {
  type: "scale";
  sScale: number;
  tScale: number;
}

export interface TcModRotate {
  type: "rotate";
  degreesPerSecond: number;
}

export interface TcModStretch {
  type: "stretch";
  func: WaveFunc;
}

export interface TcModTurb {
  type: "turb";
  base: number;
  amplitude: number;
  phase: number;
  frequency: number;
}

export interface TcModTransform {
  type: "transform";
  m00: number;
  m01: number;
  m10: number;
  m11: number;
  t0: number;
  t1: number;
}

export type TcMod = TcModScroll | TcModScale | TcModRotate | TcModStretch | TcModTurb | TcModTransform;

/**
 * Texture coordinate generation modes
 */
export type TcGenMode = "base" | "lightmap" | "environment" | "vector";

export interface TcGenVector {
  sVector: [number, number, number]; // S direction in world space
  tVector: [number, number, number]; // T direction in world space
}

export interface TcGen {
  mode: TcGenMode;
  vector?: TcGenVector; // Only for mode='vector'
}

/**
 * Wave function for deformations and animations
 */
export interface WaveFunc {
  func: "sin" | "triangle" | "square" | "sawtooth" | "inversesawtooth" | "noise";
  base: number;
  amplitude: number;
  phase: number;
  frequency: number;
}

/**
 * RGB generation modes
 */
export interface RgbGen {
  type:
    | "identity"
    | "identityLighting"
    | "wave"
    | "entity"
    | "oneMinusEntity"
    | "vertex"
    | "oneMinusVertex"
    | "lightingDiffuse"
    | "const";
  wave?: WaveFunc;
  color?: [number, number, number];
}

/**
 * Alpha generation modes
 */
export interface AlphaGen {
  type:
    | "identity"
    | "wave"
    | "entity"
    | "oneMinusEntity"
    | "vertex"
    | "oneMinusVertex"
    | "lightingSpecular"
    | "portal"
    | "const";
  wave?: WaveFunc;
  value?: number;
}

/**
 * Warsow/QFusion `material` directive payload.
 * We preserve raw tokens because real assets use variable arity,
 * placeholders like `-`, and engine tokens such as `$blankbumpimage`.
 */
export interface Q3MaterialDirective {
  /** Raw tokens after the `material` keyword, in source order */
  rawTokens: string[];

  /** First token, typically the diffuse/albedo texture */
  diffuse?: string;

  /** Second token, often a normal map or placeholder */
  normal?: string;

  /** Third token, often a gloss/specular map or placeholder */
  gloss?: string;

  /** Fourth token, often a glow/emissive map or placeholder */
  glow?: string;

  /** Any remaining tokens after the common 4-slot interpretation */
  extras?: string[];
}

/**
 * Warsow/QFusion conditional block preserved from shader source.
 * Phase 1 stores branch structure without changing downstream resolution yet.
 */
export interface Q3ShaderConditionalBlock {
  condition: "deluxe" | "!deluxe";
  stages: Q3ShaderStage[];
}

/**
 * A single stage (pass) in a Q3 shader
 */
export interface Q3ShaderStage {
  /** Texture map path, or special values like $lightmap, $whiteimage */
  map: string;

  /** QFusion/Warsow cubemap base path (six files with axis suffixes). */
  cubeMap?: string;

  /** Structured payload for Warsow/QFusion `material` directives */
  material?: Q3MaterialDirective;

  /** Clamp texture instead of repeat */
  clampMap?: boolean;

  /** Animation frames (for animMap) */
  animMap?: {
    frequency: number;
    frames: string[];
  };

  /** Blend function [src, dst] */
  blendFunc?: [BlendFactor, BlendFactor];

  /** Alpha test function */
  alphaFunc?: AlphaFunc;

  /** RGB color generation */
  rgbGen?: RgbGen;

  /** Alpha generation */
  alphaGen?: AlphaGen;

  /** Texture coordinate modifiers */
  tcMod?: TcMod[];

  /** Texture coordinate generation mode */
  tcGen?: TcGen;

  /** Depth write enabled */
  depthWrite?: boolean;

  /** Depth test function */
  depthFunc?: "lequal" | "equal";

  /** Detail texture (lower priority) */
  detail?: boolean;
}

/**
 * Deform vertex types
 */
export interface DeformVertexes {
  type: "wave" | "normal" | "bulge" | "move" | "autosprite" | "autosprite2" | "projectionshadow" | "text";
  wave?: WaveFunc;
  div?: number;
  bulgeWidth?: number;
  bulgeHeight?: number;
  bulgeSpeed?: number;
  moveDir?: [number, number, number];
}

/**
 * Sky parameters
 */
export interface SkyParms {
  farbox: string;
  /** The height the shader gives, 0 when it gives none. */
  cloudHeight: number;
  nearbox: string;
  /**
   * The sky's height as Warfork uses it: for the cloud dome and as the sky's
   * distance for world fog. The shader's height, else 2048.
   */
  skyHeight: number;
  /** `skyparmssides`: the image for each side, in Quake order rt bk lf ft up dn. */
  sides?: string[];
}

/** Warfork's sky height when a shader gives none (`-` or 0). */
export const DEFAULT_SKY_HEIGHT = 2048;

/**
 * A complete Q3 shader definition
 */
export interface Q3Shader {
  /** Shader name (texture path without extension) */
  name: string;

  /** Surface parameters (trans, nonsolid, nomarks, etc.) */
  surfaceParms: Set<string>;

  /** `q3map_surfacelight <value>` — radiosity surface-light emission strength. */
  surfaceLight?: number;

  /** Qfusion RGB specular scale and Blinn-Phong exponent. */
  glossIntensity?: number;
  glossExponent?: number;

  /** Face culling mode */
  cull: CullMode;

  /** Render sort order (opaque=3, banner=6, underwater=8, additive=9, etc.) */
  sort?: number | string;

  /** Shader stages/passes */
  stages: Q3ShaderStage[];

  /** Top-level stages outside conditional blocks */
  unconditionalStages?: Q3ShaderStage[];

  /** Preserved conditional branches such as `if deluxe` / `if ! deluxe` */
  conditionalBlocks?: Q3ShaderConditionalBlock[];

  /** Vertex deformations */
  deformVertexes?: DeformVertexes[];

  /** Sky parameters */
  skyParms?: SkyParms;

  /** Fog parameters */
  fogParms?: {
    color: [number, number, number];
    depthForOpaque: number;
  };

  /** Portal shader */
  portal?: boolean;

  /** No mipmaps */
  nomipmaps?: boolean;

  /** No picmip (texture quality reduction) */
  nopicmip?: boolean;

  /** `nofog`: world fog leaves this surface alone (Warfork). */
  noFog?: boolean;

  /** Polygon offset for decals */
  polygonOffset?: boolean;

  /** Entity mergable (optimization hint) */
  entityMergable?: boolean;

  /** Q3map compiler directives (we ignore these at runtime) */
  q3map?: Record<string, unknown>;

  /** Editor-only parameters (we ignore these) */
  qer?: Record<string, unknown>;

  /** Editor image (qer_editorimage) — used as fallback for sky textures */
  editorImage?: string;
}

export interface ResolveMaterialOptions {
  /** Select Warsow/QFusion deluxe branches when present */
  deluxe?: boolean;
}

/**
 * Resolved material properties for Babylon.js
 * This is what BspMeshBuilder uses to configure materials
 */
export interface ResolvedMaterialProps {
  glossIntensity?: number;
  glossExponent?: number;
  /** Authored rgbGen requires the mesh RGB channel, independently of alpha. */
  usesVertexRgb?: boolean;
  /** Primary diffuse texture path */
  diffuseTexture?: string;

  /** Structured normal map path resolved from `material`, when present */
  normalTexture?: string;

  /** Structured gloss/specular texture path resolved from `material`, when present */
  glossTexture?: string;

  /** Structured glow/emissive texture path resolved from `material`, when present */
  glowTexture?: string;

  /** Raw `material` payload tokens after normalization */
  materialTokens?: string[];

  /** Whether a `material` directive was explicitly present */
  hasMaterialMetadata: boolean;

  /** `material` explicitly blanked the normal channel (for example `-` or `$blankbumpimage`) */
  normalTextureExplicitlyBlank: boolean;

  /** `material` explicitly blanked the gloss channel */
  glossTextureExplicitlyBlank: boolean;

  /** `material` explicitly blanked the glow channel */
  glowTextureExplicitlyBlank: boolean;

  /** Which shader branch was selected during resolution */
  resolvedBranch: "default" | "deluxe" | "!deluxe";

  /** Use lightmap */
  useLightmap: boolean;

  /** Alpha mode: opaque, blend, add, multiply */
  alphaMode: "opaque" | "blend" | "add" | "multiply";

  /** Alpha cutoff for alpha testing */
  alphaCutoff?: number;

  /** Back face culling */
  backFaceCulling: boolean;

  /** Two-sided lighting */
  twoSidedLighting: boolean;

  /** Depth write */
  depthWrite: boolean;

  /** Is transparent (affects render order) */
  isTransparent: boolean;

  /** Needs animation updates */
  needsAnimation: boolean;

  /** TC modifiers for animation */
  tcMod?: TcMod[];

  /** Polygon offset for decals */
  polygonOffset: boolean;

  /** Is a sky surface - should not be rendered as geometry */
  isSky: boolean;

  /** Sky parameters if this is a sky shader */
  skyParms?: SkyParms;

  /** Fullbright surface - uses emissive, no lightmap (lamps, signs) */
  isFullbright: boolean;

  /** `q3map_surfacelight` emission strength (0/undefined if the shader doesn't emit light). */
  surfaceLight?: number;

  /** Autosprite - full billboard, always faces camera */
  autosprite: boolean;

  /** Autosprite2 - cylindrical billboard, rotates around vertical axis only */
  autosprite2: boolean;

  /** Texture coordinate generation mode (environment mapping, etc.) */
  tcGen?: TcGen;
}
