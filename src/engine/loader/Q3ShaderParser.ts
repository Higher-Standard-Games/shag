/**
 * Q3ShaderParser - Parse Quake3/Warsow .shader files
 * 
 * .shader files use a C-like syntax:
 * 
 * textures/mymap/myshader
 * {
 *   surfaceparm trans
 *   cull none
 *   {
 *     map textures/mymap/mytexture.tga
 *     blendFunc add
 *   }
 * }
 */

import type {
  Q3Shader,
  Q3ShaderStage,
  BlendFactor,
  AlphaFunc,
  CullMode,
  TcMod,
  WaveFunc,
  RgbGen,
  AlphaGen,
} from './Q3ShaderTypes';

/**
 * Parse multiple shaders from a .shader file content
 */
export function parseShaderFile(content: string): Q3Shader[] {
  const shaders: Q3Shader[] = [];
  const tokens = tokenize(content);
  let pos = 0;

  while (pos < tokens.length) {
    // Skip until we find a shader name (not a brace)
    if (tokens[pos] === '{' || tokens[pos] === '}') {
      pos++;
      continue;
    }

    // Shader name
    const name = tokens[pos++];
    if (!name || pos >= tokens.length) break;

    // Expect opening brace
    if (tokens[pos] !== '{') {
      // Skip malformed shader
      continue;
    }
    pos++; // consume '{'

    // Parse shader body
    const { shader, newPos } = parseShaderBody(name, tokens, pos);
    shaders.push(shader);
    pos = newPos;
  }

  return shaders;
}

/**
 * Tokenize shader file content
 * Handles comments (// and block comments), quotes, and braces
 */
function tokenize(content: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    const c = content[i];

    // Skip whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Line comment
    if (c === '/' && content[i + 1] === '/') {
      while (i < len && content[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (c === '/' && content[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Braces are individual tokens
    if (c === '{' || c === '}') {
      tokens.push(c);
      i++;
      continue;
    }

    // Quoted string
    if (c === '"') {
      i++;
      let str = '';
      while (i < len && content[i] !== '"') {
        str += content[i++];
      }
      i++; // skip closing quote
      tokens.push(str);
      continue;
    }

    // Regular token (until whitespace or brace)
    let token = '';
    while (i < len && !/[\s{}]/.test(content[i])) {
      token += content[i++];
    }
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Parse shader body (between outer braces)
 */
function parseShaderBody(
  name: string,
  tokens: string[],
  startPos: number
): { shader: Q3Shader; newPos: number } {
  const shader: Q3Shader = {
    name: name.toLowerCase(),
    surfaceParms: new Set(),
    cull: 'back', // default
    stages: [],
  };

  let pos = startPos;
  let braceDepth = 1;

  while (pos < tokens.length && braceDepth > 0) {
    const token = tokens[pos].toLowerCase();

    if (token === '{') {
      // Start of a stage
      pos++;
      const { stage, newPos } = parseStage(tokens, pos);
      shader.stages.push(stage);
      pos = newPos;
      continue;
    }

    if (token === '}') {
      braceDepth--;
      pos++;
      continue;
    }

    // Parse shader directives
    switch (token) {
      case 'surfaceparm':
        if (tokens[pos + 1]) {
          shader.surfaceParms.add(tokens[pos + 1].toLowerCase());
        }
        pos += 2;
        break;

      case 'cull':
        if (tokens[pos + 1]) {
          const cullVal = tokens[pos + 1].toLowerCase();
          if (cullVal === 'none' || cullVal === 'disable' || cullVal === 'twosided') {
            shader.cull = 'none';
          } else if (cullVal === 'front') {
            shader.cull = 'front';
          } else {
            shader.cull = 'back';
          }
        }
        pos += 2;
        break;

      case 'sort':
        if (tokens[pos + 1]) {
          const sortVal = tokens[pos + 1].toLowerCase();
          // Can be a number or preset name
          const sortNum = parseFloat(sortVal);
          shader.sort = isNaN(sortNum) ? sortVal : sortNum;
        }
        pos += 2;
        break;

      case 'nomipmaps':
        shader.nomipmaps = true;
        pos++;
        break;

      case 'nopicmip':
        shader.nopicmip = true;
        pos++;
        break;

      case 'polygonoffset':
        shader.polygonOffset = true;
        pos++;
        break;

      case 'portal':
        shader.portal = true;
        pos++;
        break;

      case 'entitymergable':
        shader.entityMergable = true;
        pos++;
        break;

      case 'deformvertexes':
        // Skip deformVertexes for now (complex)
        pos++;
        while (pos < tokens.length && tokens[pos] !== '{' && tokens[pos] !== '}' && 
               !isDirective(tokens[pos])) {
          pos++;
        }
        break;

      case 'fogparms':
        // Skip fog params for now
        pos++;
        while (pos < tokens.length && tokens[pos] !== '{' && tokens[pos] !== '}' && 
               !isDirective(tokens[pos])) {
          pos++;
        }
        break;

      case 'skyparms':
        // Skip sky params for now
        pos++;
        while (pos < tokens.length && tokens[pos] !== '{' && tokens[pos] !== '}' && 
               !isDirective(tokens[pos])) {
          pos++;
        }
        break;

      default:
        // Skip q3map_*, qer_*, and other unknown directives
        if (token.startsWith('q3map') || token.startsWith('qer_')) {
          pos++;
          // Skip parameters until next directive or brace
          while (pos < tokens.length && tokens[pos] !== '{' && tokens[pos] !== '}' && 
                 !isDirective(tokens[pos])) {
            pos++;
          }
        } else {
          pos++;
        }
        break;
    }
  }

  return { shader, newPos: pos };
}

/**
 * Check if token is a known directive
 */
function isDirective(token: string): boolean {
  const directives = [
    'surfaceparm', 'cull', 'sort', 'nomipmaps', 'nopicmip', 'polygonoffset',
    'portal', 'entitymergable', 'deformvertexes', 'fogparms', 'skyparms',
  ];
  return directives.includes(token.toLowerCase());
}

/**
 * Parse a shader stage (between inner braces)
 */
function parseStage(tokens: string[], startPos: number): { stage: Q3ShaderStage; newPos: number } {
  const stage: Q3ShaderStage = {
    map: '',
  };

  let pos = startPos;

  while (pos < tokens.length && tokens[pos] !== '}') {
    const token = tokens[pos].toLowerCase();

    switch (token) {
      case 'map':
        if (tokens[pos + 1]) {
          stage.map = tokens[pos + 1];
        }
        pos += 2;
        break;

      case 'clampmap':
        if (tokens[pos + 1]) {
          stage.map = tokens[pos + 1];
          stage.clampMap = true;
        }
        pos += 2;
        break;

      case 'material':
        // Warsow/QFusion extension: material <diffuse> [<normalmap>]
        // Sets the diffuse texture (and optionally normal map)
        if (tokens[pos + 1]) {
          stage.map = tokens[pos + 1];
          pos += 2;
          // Check for optional normal map (we store but don't use yet)
          if (tokens[pos] && !isStageDirective(tokens[pos]) && tokens[pos] !== '}') {
            // Skip the normal map parameter for now
            pos++;
          }
        } else {
          pos++;
        }
        break;

      case 'animmap':
        // animMap <frequency> <frame1> <frame2> ...
        if (tokens[pos + 1]) {
          const freq = parseFloat(tokens[pos + 1]);
          const frames: string[] = [];
          pos += 2;
          while (pos < tokens.length && tokens[pos] !== '}' && !isStageDirective(tokens[pos])) {
            frames.push(tokens[pos]);
            pos++;
          }
          stage.animMap = { frequency: freq, frames };
          if (frames.length > 0) {
            stage.map = frames[0]; // Use first frame as default
          }
        } else {
          pos++;
        }
        break;

      case 'blendfunc':
        stage.blendFunc = parseBlendFunc(tokens, pos + 1);
        pos += 2;
        // Check if it's a two-parameter blend func
        if (tokens[pos] && !isStageDirective(tokens[pos]) && tokens[pos] !== '}') {
          pos++;
        }
        break;

      case 'alphafunc':
        if (tokens[pos + 1]) {
          const af = tokens[pos + 1].toUpperCase();
          if (af === 'GT0' || af === 'GE128' || af === 'LT128') {
            stage.alphaFunc = af as AlphaFunc;
          }
        }
        pos += 2;
        break;

      case 'rgbgen':
        stage.rgbGen = parseRgbGen(tokens, pos + 1);
        pos += 2;
        // Skip additional wave parameters
        while (pos < tokens.length && tokens[pos] !== '}' && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      case 'alphagen':
        stage.alphaGen = parseAlphaGen(tokens, pos + 1);
        pos += 2;
        // Skip additional wave parameters
        while (pos < tokens.length && tokens[pos] !== '}' && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      case 'tcmod':
        const tcMod = parseTcMod(tokens, pos + 1);
        if (tcMod) {
          if (!stage.tcMod) stage.tcMod = [];
          stage.tcMod.push(tcMod);
        }
        pos += 2;
        // Skip additional parameters
        while (pos < tokens.length && tokens[pos] !== '}' && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      case 'depthwrite':
        stage.depthWrite = true;
        pos++;
        break;

      case 'depthfunc':
        if (tokens[pos + 1]) {
          const df = tokens[pos + 1].toLowerCase();
          if (df === 'equal') {
            stage.depthFunc = 'equal';
          } else {
            stage.depthFunc = 'lequal';
          }
        }
        pos += 2;
        break;

      case 'detail':
        stage.detail = true;
        pos++;
        break;

      case 'tcgen':
        // Skip tcGen for now
        pos += 2;
        break;

      default:
        pos++;
        break;
    }
  }

  // Skip closing brace
  if (tokens[pos] === '}') {
    pos++;
  }

  return { stage, newPos: pos };
}

/**
 * Check if token is a stage directive
 */
function isStageDirective(token: string): boolean {
  const directives = [
    'map', 'clampmap', 'animmap', 'material', 'blendfunc', 'alphafunc', 'rgbgen',
    'alphagen', 'tcmod', 'tcgen', 'depthwrite', 'depthfunc', 'detail',
  ];
  return directives.includes(token.toLowerCase());
}

/**
 * Parse blendFunc directive
 */
function parseBlendFunc(tokens: string[], pos: number): [BlendFactor, BlendFactor] {
  const token = tokens[pos]?.toLowerCase();

  // Preset shortcuts
  switch (token) {
    case 'add':
      return ['GL_ONE', 'GL_ONE'];
    case 'blend':
      return ['GL_SRC_ALPHA', 'GL_ONE_MINUS_SRC_ALPHA'];
    case 'filter':
      return ['GL_DST_COLOR', 'GL_ZERO'];
    default:
      // Two-parameter form: blendFunc <src> <dst>
      const src = parseBlendFactor(token);
      const dst = parseBlendFactor(tokens[pos + 1]);
      return [src, dst];
  }
}

/**
 * Parse a single blend factor
 */
function parseBlendFactor(token?: string): BlendFactor {
  if (!token) return 'GL_ONE';
  
  const t = token.toUpperCase();
  const factors: BlendFactor[] = [
    'GL_ONE', 'GL_ZERO', 'GL_SRC_COLOR', 'GL_DST_COLOR',
    'GL_ONE_MINUS_SRC_COLOR', 'GL_ONE_MINUS_DST_COLOR',
    'GL_SRC_ALPHA', 'GL_DST_ALPHA',
    'GL_ONE_MINUS_SRC_ALPHA', 'GL_ONE_MINUS_DST_ALPHA',
  ];
  
  if (factors.includes(t as BlendFactor)) {
    return t as BlendFactor;
  }
  
  return 'GL_ONE';
}

/**
 * Parse rgbGen directive
 */
function parseRgbGen(tokens: string[], pos: number): RgbGen {
  const token = tokens[pos]?.toLowerCase();
  
  switch (token) {
    case 'identity':
      return { type: 'identity' };
    case 'identitylighting':
      return { type: 'identityLighting' };
    case 'vertex':
      return { type: 'vertex' };
    case 'oneminusvertex':
      return { type: 'oneMinusVertex' };
    case 'entity':
      return { type: 'entity' };
    case 'oneminusentity':
      return { type: 'oneMinusEntity' };
    case 'lightingdiffuse':
      return { type: 'lightingDiffuse' };
    case 'wave':
      return { type: 'wave', wave: parseWaveFunc(tokens, pos + 1) };
    case 'const':
      return { 
        type: 'const',
        color: [
          parseFloat(tokens[pos + 2]) || 1,
          parseFloat(tokens[pos + 3]) || 1,
          parseFloat(tokens[pos + 4]) || 1,
        ],
      };
    default:
      return { type: 'identity' };
  }
}

/**
 * Parse alphaGen directive
 */
function parseAlphaGen(tokens: string[], pos: number): AlphaGen {
  const token = tokens[pos]?.toLowerCase();
  
  switch (token) {
    case 'identity':
      return { type: 'identity' };
    case 'vertex':
      return { type: 'vertex' };
    case 'oneminusvertex':
      return { type: 'oneMinusVertex' };
    case 'entity':
      return { type: 'entity' };
    case 'oneminusentity':
      return { type: 'oneMinusEntity' };
    case 'lightingspecular':
      return { type: 'lightingSpecular' };
    case 'portal':
      return { type: 'portal' };
    case 'wave':
      return { type: 'wave', wave: parseWaveFunc(tokens, pos + 1) };
    case 'const':
      return { 
        type: 'const',
        value: parseFloat(tokens[pos + 1]) || 1,
      };
    default:
      return { type: 'identity' };
  }
}

/**
 * Parse wave function
 */
function parseWaveFunc(tokens: string[], pos: number): WaveFunc {
  const funcName = tokens[pos]?.toLowerCase() || 'sin';
  const validFuncs = ['sin', 'triangle', 'square', 'sawtooth', 'inversesawtooth', 'noise'];
  
  return {
    func: validFuncs.includes(funcName) ? funcName as WaveFunc['func'] : 'sin',
    base: parseFloat(tokens[pos + 1]) || 0,
    amplitude: parseFloat(tokens[pos + 2]) || 1,
    phase: parseFloat(tokens[pos + 3]) || 0,
    frequency: parseFloat(tokens[pos + 4]) || 1,
  };
}

/**
 * Parse tcMod directive
 */
function parseTcMod(tokens: string[], pos: number): TcMod | null {
  const token = tokens[pos]?.toLowerCase();
  
  switch (token) {
    case 'scroll':
      return {
        type: 'scroll',
        sSpeed: parseFloat(tokens[pos + 1]) || 0,
        tSpeed: parseFloat(tokens[pos + 2]) || 0,
      };
    case 'scale':
      return {
        type: 'scale',
        sScale: parseFloat(tokens[pos + 1]) || 1,
        tScale: parseFloat(tokens[pos + 2]) || 1,
      };
    case 'rotate':
      return {
        type: 'rotate',
        degreesPerSecond: parseFloat(tokens[pos + 1]) || 0,
      };
    case 'stretch':
      return {
        type: 'stretch',
        func: parseWaveFunc(tokens, pos + 1),
      };
    case 'turb':
      return {
        type: 'turb',
        base: parseFloat(tokens[pos + 1]) || 0,
        amplitude: parseFloat(tokens[pos + 2]) || 1,
        phase: parseFloat(tokens[pos + 3]) || 0,
        frequency: parseFloat(tokens[pos + 4]) || 1,
      };
    case 'transform':
      return {
        type: 'transform',
        m00: parseFloat(tokens[pos + 1]) || 1,
        m01: parseFloat(tokens[pos + 2]) || 0,
        m10: parseFloat(tokens[pos + 3]) || 0,
        m11: parseFloat(tokens[pos + 4]) || 1,
        t0: parseFloat(tokens[pos + 5]) || 0,
        t1: parseFloat(tokens[pos + 6]) || 0,
      };
    default:
      return null;
  }
}
