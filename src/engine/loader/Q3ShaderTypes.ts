/**
 * Q3ShaderTypes - Type definitions for Quake3/Warsow shader system
 * 
 * These shaders are defined in .shader files within PK3 archives
 * and control texture blending, transparency, animation, and other effects.
 */

/**
 * Blend function presets and their GL equivalents
 */
export type BlendFuncPreset = 'add' | 'blend' | 'filter';

/**
 * GL blend factors
 */
export type BlendFactor = 
  | 'GL_ONE'
  | 'GL_ZERO'
  | 'GL_SRC_COLOR'
  | 'GL_DST_COLOR'
  | 'GL_ONE_MINUS_SRC_COLOR'
  | 'GL_ONE_MINUS_DST_COLOR'
  | 'GL_SRC_ALPHA'
  | 'GL_DST_ALPHA'
  | 'GL_ONE_MINUS_SRC_ALPHA'
  | 'GL_ONE_MINUS_DST_ALPHA';

/**
 * Alpha test functions
 */
export type AlphaFunc = 'GT0' | 'GE128' | 'LT128';

/**
 * Cull modes
 */
export type CullMode = 'front' | 'back' | 'none' | 'disable';

/**
 * TC (texture coordinate) modifier types
 */
export interface TcModScroll {
  type: 'scroll';
  sSpeed: number;
  tSpeed: number;
}

export interface TcModScale {
  type: 'scale';
  sScale: number;
  tScale: number;
}

export interface TcModRotate {
  type: 'rotate';
  degreesPerSecond: number;
}

export interface TcModStretch {
  type: 'stretch';
  func: WaveFunc;
}

export interface TcModTurb {
  type: 'turb';
  base: number;
  amplitude: number;
  phase: number;
  frequency: number;
}

export interface TcModTransform {
  type: 'transform';
  m00: number;
  m01: number;
  m10: number;
  m11: number;
  t0: number;
  t1: number;
}

export type TcMod = TcModScroll | TcModScale | TcModRotate | TcModStretch | TcModTurb | TcModTransform;

/**
 * Wave function for deformations and animations
 */
export interface WaveFunc {
  func: 'sin' | 'triangle' | 'square' | 'sawtooth' | 'inversesawtooth' | 'noise';
  base: number;
  amplitude: number;
  phase: number;
  frequency: number;
}

/**
 * RGB generation modes
 */
export interface RgbGen {
  type: 'identity' | 'identityLighting' | 'wave' | 'entity' | 'oneMinusEntity' | 
        'vertex' | 'oneMinusVertex' | 'lightingDiffuse' | 'const';
  wave?: WaveFunc;
  color?: [number, number, number];
}

/**
 * Alpha generation modes
 */
export interface AlphaGen {
  type: 'identity' | 'wave' | 'entity' | 'oneMinusEntity' | 
        'vertex' | 'oneMinusVertex' | 'lightingSpecular' | 'portal' | 'const';
  wave?: WaveFunc;
  value?: number;
}

/**
 * A single stage (pass) in a Q3 shader
 */
export interface Q3ShaderStage {
  /** Texture map path, or special values like $lightmap, $whiteimage */
  map: string;
  
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
  
  /** Depth write enabled */
  depthWrite?: boolean;
  
  /** Depth test function */
  depthFunc?: 'lequal' | 'equal';
  
  /** Detail texture (lower priority) */
  detail?: boolean;
}

/**
 * Deform vertex types
 */
export interface DeformVertexes {
  type: 'wave' | 'normal' | 'bulge' | 'move' | 'autosprite' | 'autosprite2' | 'projectionshadow' | 'text';
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
  cloudHeight: number;
  nearbox: string;
}

/**
 * A complete Q3 shader definition
 */
export interface Q3Shader {
  /** Shader name (texture path without extension) */
  name: string;
  
  /** Surface parameters (trans, nonsolid, nomarks, etc.) */
  surfaceParms: Set<string>;
  
  /** Face culling mode */
  cull: CullMode;
  
  /** Render sort order (opaque=3, banner=6, underwater=8, additive=9, etc.) */
  sort?: number | string;
  
  /** Shader stages/passes */
  stages: Q3ShaderStage[];
  
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
  
  /** Polygon offset for decals */
  polygonOffset?: boolean;
  
  /** Entity mergable (optimization hint) */
  entityMergable?: boolean;
  
  /** Q3map compiler directives (we ignore these at runtime) */
  q3map?: Record<string, unknown>;
  
  /** Editor-only parameters (we ignore these) */
  qer?: Record<string, unknown>;
}

/**
 * Resolved material properties for Babylon.js
 * This is what BspMeshBuilder uses to configure materials
 */
export interface ResolvedMaterialProps {
  /** Primary diffuse texture path */
  diffuseTexture?: string;

  /** Use lightmap */
  useLightmap: boolean;

  /** Alpha mode: opaque, blend, add, multiply */
  alphaMode: 'opaque' | 'blend' | 'add' | 'multiply';

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
}
