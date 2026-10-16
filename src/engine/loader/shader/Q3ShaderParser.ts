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
  AlphaFunc,
  AlphaGen,
  BlendFactor,
  Q3MaterialDirective,
  Q3Shader,
  Q3ShaderConditionalBlock,
  Q3ShaderStage,
  RgbGen,
  TcGen,
  // CullMode, // Currently unused
  TcMod,
  WaveFunc,
} from "./Q3ShaderTypes";
import { DEFAULT_SKY_HEIGHT } from "./Q3ShaderTypes";

/**
 * Template storage - maps template name to raw body tokens
 */
interface ShaderTemplate {
  name: string;
  bodyTokens: string[]; // Tokens between { and } of template
}

/** Global template storage (shared across all shader files) */
const templates: Map<string, ShaderTemplate> = new Map();

/**
 * Parse multiple shaders from a .shader file content
 * Supports Warsow/QFusion template system
 */
export function parseShaderFile(content: string): Q3Shader[] {
  const shaders: Q3Shader[] = [];
  const tokens = tokenize(content);
  let pos = 0;

  // First pass: collect templates
  while (pos < tokens.length) {
    if (tokens[pos] === "{" || tokens[pos] === "}") {
      pos++;
      continue;
    }

    const name = tokens[pos++];
    if (!name || pos >= tokens.length) break;

    if (tokens[pos] !== "{") continue;
    pos++; // consume '{'

    // Find matching closing brace and collect body tokens
    const bodyStart = pos;
    let braceDepth = 1;
    while (pos < tokens.length && braceDepth > 0) {
      if (tokens[pos] === "{") braceDepth++;
      else if (tokens[pos] === "}") braceDepth--;
      pos++;
    }
    const bodyEnd = pos - 1; // exclude closing '}'

    // Check if this is a template definition. Warsow uses BOTH "_Template" and
    // "_template" casings (e.g. weaponIcon_HUD_Template vs armor_template,
    // debris_template), so match case-insensitively and key the store lowercased.
    if (name.toLowerCase().endsWith("_template")) {
      const bodyTokens = tokens.slice(bodyStart, bodyEnd);
      templates.set(name.toLowerCase(), { name, bodyTokens });
    }
  }

  // Second pass: parse shaders and expand templates
  pos = 0;
  while (pos < tokens.length) {
    if (tokens[pos] === "{" || tokens[pos] === "}") {
      pos++;
      continue;
    }

    const name = tokens[pos++];
    if (!name || pos >= tokens.length) break;

    if (tokens[pos] !== "{") continue;
    pos++; // consume '{'

    // Skip templates (already processed)
    if (name.toLowerCase().endsWith("_template")) {
      let braceDepth = 1;
      while (pos < tokens.length && braceDepth > 0) {
        if (tokens[pos] === "{") braceDepth++;
        else if (tokens[pos] === "}") braceDepth--;
        pos++;
      }
      continue;
    }

    // Check if body starts with 'template' directive
    if (tokens[pos]?.toLowerCase() === "template") {
      pos++; // consume 'template'
      const templateName = tokens[pos++];

      // Collect template parameters until we hit '}'
      const params: string[] = [];
      while (pos < tokens.length && tokens[pos] !== "}") {
        params.push(tokens[pos++]);
      }
      pos++; // consume '}'

      // Expand template (lookup case-insensitive — see template-collection note)
      const template = templates.get(templateName.toLowerCase());
      if (template) {
        const expandedTokens = expandTemplate(template.bodyTokens, params);
        const { shader } = parseShaderBody(name, expandedTokens, 0);
        shaders.push(shader);
      } else {
        console.warn(`[Q3ShaderParser] Template not found: ${templateName}`);
      }
    } else {
      // Regular shader body
      const { shader, newPos } = parseShaderBody(name, tokens, pos);
      shaders.push(shader);
      pos = newPos;
    }
  }

  return shaders;
}

/**
 * Expand template by replacing $1, $2, etc. with parameters
 */
function expandTemplate(bodyTokens: string[], params: string[]): string[] {
  return bodyTokens.map((token) => {
    // Replace $1, $2, etc. with parameters
    let result = token;
    for (let i = 0; i < params.length; i++) {
      result = result.replace(new RegExp(`\\$${i + 1}`, "g"), params[i]);
    }
    return result;
  });
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
    if (c === "/" && content[i + 1] === "/") {
      while (i < len && content[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (c === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < len - 1 && !(content[i] === "*" && content[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Braces are individual tokens
    if (c === "{" || c === "}") {
      tokens.push(c);
      i++;
      continue;
    }

    // Quoted string
    if (c === '"') {
      i++;
      let str = "";
      while (i < len && content[i] !== '"') {
        str += content[i++];
      }
      i++; // skip closing quote
      tokens.push(str);
      continue;
    }

    // Regular token (until whitespace or brace)
    let token = "";
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
function parseShaderBody(name: string, tokens: string[], startPos: number): { shader: Q3Shader; newPos: number } {
  const shader: Q3Shader = {
    name: name.toLowerCase(),
    surfaceParms: new Set(),
    cull: "back", // default
    stages: [],
    unconditionalStages: [],
  };

  let pos = startPos;
  let braceDepth = 1;

  while (pos < tokens.length && braceDepth > 0) {
    const token = tokens[pos].toLowerCase();

    if (token === "{") {
      // Start of a stage
      pos++;
      const { stage, newPos } = parseStage(tokens, pos);
      shader.stages.push(stage);
      shader.unconditionalStages?.push(stage);
      pos = newPos;
      continue;
    }

    if (token === "}") {
      braceDepth--;
      pos++;
      continue;
    }

    // Parse shader directives
    switch (token) {
      case "surfaceparm":
        if (tokens[pos + 1]) {
          shader.surfaceParms.add(tokens[pos + 1].toLowerCase());
        }
        pos += 2;
        break;

      case "cull":
        if (tokens[pos + 1]) {
          const cullVal = tokens[pos + 1].toLowerCase();
          if (cullVal === "none" || cullVal === "disable" || cullVal === "twosided") {
            shader.cull = "none";
          } else if (cullVal === "front") {
            shader.cull = "front";
          } else {
            shader.cull = "back";
          }
        }
        pos += 2;
        break;

      case "sort":
        if (tokens[pos + 1]) {
          const sortVal = tokens[pos + 1].toLowerCase();
          // Can be a number or preset name
          const sortNum = parseFloat(sortVal);
          shader.sort = Number.isNaN(sortNum) ? sortVal : sortNum;
        }
        pos += 2;
        break;

      case "glossintensity":
      case "glossexponent": {
        const value = Number(tokens[pos + 1]);
        if (Number.isFinite(value) && value > 0) {
          if (token === "glossintensity") shader.glossIntensity = value;
          else shader.glossExponent = value;
        }
        pos += Number.isFinite(value) ? 2 : 1;
        break;
      }

      case "nomipmaps":
        shader.nomipmaps = true;
        pos++;
        break;

      case "nopicmip":
        shader.nopicmip = true;
        pos++;
        break;

      case "nofog":
        shader.noFog = true;
        pos++;
        break;

      case "softparticle":
        shader.softParticle = true;
        pos++;
        break;

      case "polygonoffset":
        shader.polygonOffset = true;
        pos++;
        break;

      case "portal":
        shader.portal = true;
        pos++;
        break;

      case "entitymergable":
        shader.entityMergable = true;
        pos++;
        break;

      case "deformvertexes": {
        // Parse deformVertexes directive
        pos++;
        if (pos >= tokens.length) break;

        const deformType = tokens[pos].toLowerCase();
        pos++;

        if (!shader.deformVertexes) {
          shader.deformVertexes = [];
        }

        if (deformType === "autosprite") {
          shader.deformVertexes.push({ type: "autosprite" });
        } else if (deformType === "autosprite2") {
          shader.deformVertexes.push({ type: "autosprite2" });
        } else {
          // Skip other deformVertexes types for now (wave, bulge, etc.)
          while (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
            pos++;
          }
        }
        break;
      }

      case "fogparms": {
        // Parse: fogParms ( R G B ) depthForOpaque
        // or: fogParms R G B depthForOpaque
        // Color values are 0-1 range, depthForOpaque is distance in units
        pos++;

        // Skip opening parenthesis if present
        if (pos < tokens.length && tokens[pos] === "(") {
          pos++;
        }

        let r = 0.5,
          g = 0.5,
          b = 0.5;
        let depthForOpaque = 512;

        // Read R G B values
        if (
          pos < tokens.length &&
          tokens[pos] !== ")" &&
          tokens[pos] !== "{" &&
          tokens[pos] !== "}" &&
          !isDirective(tokens[pos])
        ) {
          r = parseFloat(tokens[pos]) || 0;
          pos++;
        }
        if (
          pos < tokens.length &&
          tokens[pos] !== ")" &&
          tokens[pos] !== "{" &&
          tokens[pos] !== "}" &&
          !isDirective(tokens[pos])
        ) {
          g = parseFloat(tokens[pos]) || 0;
          pos++;
        }
        if (
          pos < tokens.length &&
          tokens[pos] !== ")" &&
          tokens[pos] !== "{" &&
          tokens[pos] !== "}" &&
          !isDirective(tokens[pos])
        ) {
          b = parseFloat(tokens[pos]) || 0;
          pos++;
        }

        // Skip closing parenthesis if present
        if (pos < tokens.length && tokens[pos] === ")") {
          pos++;
        }

        // Read depthForOpaque
        if (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
          depthForOpaque = parseFloat(tokens[pos]) || 512;
          pos++;
        }

        shader.fogParms = {
          color: [r, g, b],
          depthForOpaque,
        };
        break;
      }

      case "skyparms": {
        // Parse: skyparms <farbox> <cloudheight> <nearbox>
        // farbox: texture path prefix for 6 skybox faces, or '-' for none
        // cloudheight: height for cloud layer, or '-' for none
        // nearbox: near skybox path prefix, or '-' for none
        // Be careful not to consume tokens belonging to next directive
        pos++;

        let farbox = "-";
        let cloudHeightStr = "-";
        let nearbox = "-";

        // Read up to 3 parameters, stopping if we hit a directive or brace
        if (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
          farbox = tokens[pos];
          pos++;
        }
        if (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
          cloudHeightStr = tokens[pos];
          pos++;
        }
        if (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
          nearbox = tokens[pos];
          pos++;
        }

        const cloudHeight = cloudHeightStr !== "-" ? Number.parseFloat(cloudHeightStr) || 0 : 0;
        shader.skyParms = {
          farbox: farbox !== "-" ? farbox : "",
          cloudHeight,
          nearbox: nearbox !== "-" ? nearbox : "",
          skyHeight: cloudHeight > 0 ? cloudHeight : DEFAULT_SKY_HEIGHT,
        };
        break;
      }

      case "skyparmssides": {
        // Warsow/Warfork: skyparmssides <rt> <bk> <lf> <ft> <up> <dn> <height> [nearbox]
        // Each side is an image, or the name of an earlier side to reuse:
        //   skyparmssides env/36sky rt rt rt rt rt 1500 -
        // is env/36sky on every side, at height 1500.
        pos++;
        const words: string[] = [];
        while (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
          words.push(tokens[pos]);
          pos++;
        }
        const sides = resolveSkySides(words.slice(0, 6));
        const heightWord = words[6];
        const cloudHeight = heightWord && heightWord !== "-" ? Number.parseFloat(heightWord) || 0 : 0;
        shader.skyParms = {
          farbox: sides?.[0] ?? "",
          cloudHeight,
          nearbox: words[7] && words[7] !== "-" ? words[7] : "",
          skyHeight: cloudHeight > 0 ? cloudHeight : DEFAULT_SKY_HEIGHT,
          ...(sides ? { sides } : {}),
        };
        break;
      }

      case "qer_editorimage":
        // Capture editor image — used as fallback for sky textures when cubemap is missing
        if (tokens[pos + 1]) {
          shader.editorImage = tokens[pos + 1];
        }
        pos += 2;
        break;

      case "if": {
        const { block, newPos } = parseConditionalBlock(tokens, pos + 1);
        if (!shader.conditionalBlocks) {
          shader.conditionalBlocks = [];
        }
        shader.conditionalBlocks.push(block);
        // Preserve current downstream behavior until material resolution
        // becomes deluxe-aware in later phases.
        shader.stages.push(...block.stages);
        pos = newPos;
        break;
      }

      default:
        // Surface-light emission strength: q3map_surfacelight (Q3) /
        // lightingIntensity (Warsow/qfusion). Used to scale emissive area lights.
        if (token === "q3map_surfacelight" || token === "lightingintensity") {
          if (pos + 1 < tokens.length) {
            const v = Number(tokens[pos + 1]);
            if (Number.isFinite(v) && v > 0) shader.surfaceLight = v;
          }
          pos++;
          while (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
            pos++;
          }
        } else if (token.startsWith("q3map") || token.startsWith("qer_")) {
          // Skip other q3map_*, qer_* directives
          pos++;
          while (pos < tokens.length && tokens[pos] !== "{" && tokens[pos] !== "}" && !isDirective(tokens[pos])) {
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
    "surfaceparm",
    "glossintensity",
    "glossexponent",
    "cull",
    "sort",
    "nomipmaps",
    "nopicmip",
    "polygonoffset",
    "softparticle",
    "portal",
    "entitymergable",
    "deformvertexes",
    "fogparms",
    "skyparms",
    "skyparmssides",
    "qer_editorimage",
    "if",
    "endif",
  ];
  return directives.includes(token.toLowerCase());
}

function parseConditionalBlock(
  tokens: string[],
  startPos: number,
): { block: Q3ShaderConditionalBlock; newPos: number } {
  const { condition, newPos: conditionPos } = parseConditionalCondition(tokens, startPos);
  const block: Q3ShaderConditionalBlock = {
    condition,
    stages: [],
  };

  let pos = conditionPos;

  while (pos < tokens.length) {
    const token = tokens[pos].toLowerCase();

    if (token === "endif") {
      pos++;
      break;
    }

    if (token === "{") {
      pos++;
      const { stage, newPos } = parseStage(tokens, pos);
      block.stages.push(stage);
      pos = newPos;
      continue;
    }

    // Preserve nested stages without introducing a nested conditional AST yet.
    if (token === "if") {
      const { block: nestedBlock, newPos } = parseConditionalBlock(tokens, pos + 1);
      block.stages.push(...nestedBlock.stages);
      pos = newPos;
      continue;
    }

    pos++;
  }

  return { block, newPos: pos };
}

function parseConditionalCondition(
  tokens: string[],
  startPos: number,
): { condition: "deluxe" | "!deluxe"; newPos: number } {
  const first = tokens[startPos]?.toLowerCase();
  const second = tokens[startPos + 1]?.toLowerCase();

  if (first === "!" && second === "deluxe") {
    return { condition: "!deluxe", newPos: startPos + 2 };
  }

  if (first === "!deluxe") {
    return { condition: "!deluxe", newPos: startPos + 1 };
  }

  if (first === "deluxe") {
    return { condition: "deluxe", newPos: startPos + 1 };
  }

  return { condition: "deluxe", newPos: startPos };
}

/**
 * Parse a shader stage (between inner braces)
 */
function parseStage(tokens: string[], startPos: number): { stage: Q3ShaderStage; newPos: number } {
  const stage: Q3ShaderStage = {
    map: "",
  };

  let pos = startPos;

  while (pos < tokens.length && tokens[pos] !== "}") {
    const token = tokens[pos].toLowerCase();

    switch (token) {
      case "map":
        if (tokens[pos + 1]) {
          stage.map = tokens[pos + 1];
        }
        pos += 2;
        break;

      case "clampmap":
        if (tokens[pos + 1]) {
          stage.map = tokens[pos + 1];
          stage.clampMap = true;
        }
        pos += 2;
        break;

      case "cubemap":
        // QFusion/Warsow stage source. Preserve it as an appearance hint even
        // when its surrounding `if textureCubeMap` condition is not a branch
        // the legacy material resolver understands.
        if (tokens[pos + 1]) {
          stage.cubeMap = tokens[pos + 1];
        }
        pos += 2;
        break;

      case "material":
        pos++;
        {
          const { material, newPos } = parseMaterialDirective(tokens, pos);
          stage.material = material;
          if (material.diffuse) {
            stage.map = material.diffuse;
          }
          pos = newPos;
        }
        break;

      case "celshade": {
        // Warsow/QFusion cel-shading pass:
        //   celshade <diffuse> <cellRamp> [diffuse2] [decal] [entityDecal] [stripes] [light]
        // We don't do full cel-shading; we render the diffuse so the item is
        // textured. arg0 is the base diffuse (e.g. armor ga.tga); if it's a
        // builtin ($whiteImage) or "-", the real skin is the diffuse-overlay
        // at arg2 (e.g. player *_fb.tga). The cell ramp (arg1) is ignored.
        pos++;
        const args: string[] = [];
        while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
          args.push(tokens[pos]);
          pos++;
        }
        const isRealTexture = (t: string | undefined): boolean => !!t && t !== "-" && !t.startsWith("$");
        stage.map = isRealTexture(args[0]) ? args[0] : isRealTexture(args[2]) ? args[2] : args[0] || "";
        break;
      }

      case "animmap":
        // animMap <frequency> <frame1> <frame2> ...
        if (tokens[pos + 1]) {
          const freq = parseFloat(tokens[pos + 1]);
          const frames: string[] = [];
          pos += 2;
          while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
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

      case "animclampmap":
        // animClampMap <frequency> <frame1> <frame2> ... (same as animMap but with clamping)
        if (tokens[pos + 1]) {
          const freq = parseFloat(tokens[pos + 1]);
          const frames: string[] = [];
          pos += 2;
          while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
            frames.push(tokens[pos]);
            pos++;
          }
          stage.animMap = { frequency: freq, frames };
          stage.clampMap = true; // Enable clamping for animated textures
          if (frames.length > 0) {
            stage.map = frames[0]; // Use first frame as default
          }
        } else {
          pos++;
        }
        break;

      case "blendfunc":
        stage.blendFunc = parseBlendFunc(tokens, pos + 1);
        pos += 2;
        // Check if it's a two-parameter blend func
        if (tokens[pos] && !isStageDirective(tokens[pos]) && tokens[pos] !== "}") {
          pos++;
        }
        break;

      case "alphafunc":
        if (tokens[pos + 1]) {
          const af = tokens[pos + 1].toUpperCase();
          if (af === "GT0" || af === "GE128" || af === "LT128") {
            stage.alphaFunc = af as AlphaFunc;
          }
        }
        pos += 2;
        break;

      case "rgbgen":
        stage.rgbGen = parseRgbGen(tokens, pos + 1);
        pos += 2;
        // Skip additional wave parameters
        while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      case "alphagen":
        stage.alphaGen = parseAlphaGen(tokens, pos + 1);
        pos += 2;
        // Skip additional wave parameters
        while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      case "tcmod": {
        const tcMod = parseTcMod(tokens, pos + 1);
        if (tcMod) {
          if (!stage.tcMod) stage.tcMod = [];
          stage.tcMod.push(tcMod);
        }
        pos += 2;
        // Skip additional parameters
        while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;
      }

      case "depthwrite":
        stage.depthWrite = true;
        pos++;
        break;

      case "depthfunc":
        if (tokens[pos + 1]) {
          const df = tokens[pos + 1].toLowerCase();
          if (df === "equal") {
            stage.depthFunc = "equal";
          } else {
            stage.depthFunc = "lequal";
          }
        }
        pos += 2;
        break;

      case "detail":
        stage.detail = true;
        pos++;
        break;

      case "tcgen":
        stage.tcGen = parseTcGen(tokens, pos + 1);
        pos += 2;
        // Skip additional vector parameters if present
        while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
          pos++;
        }
        break;

      default:
        pos++;
        break;
    }
  }

  // Skip closing brace
  if (tokens[pos] === "}") {
    pos++;
  }

  return { stage, newPos: pos };
}

/**
 * Check if token is a stage directive
 */
function isStageDirective(token: string): boolean {
  const directives = [
    "map",
    "clampmap",
    "cubemap",
    "animmap",
    "animclampmap",
    "material",
    "celshade",
    "blendfunc",
    "alphafunc",
    "rgbgen",
    "alphagen",
    "tcmod",
    "tcgen",
    "depthwrite",
    "depthfunc",
    "detail",
  ];
  return directives.includes(token.toLowerCase());
}

function parseMaterialDirective(tokens: string[], startPos: number): { material: Q3MaterialDirective; newPos: number } {
  const rawTokens: string[] = [];
  let pos = startPos;

  while (pos < tokens.length && tokens[pos] !== "}" && !isStageDirective(tokens[pos])) {
    rawTokens.push(tokens[pos]);
    pos++;
  }

  const [diffuse, normal, gloss, glow, ...extras] = rawTokens;
  const material: Q3MaterialDirective = {
    rawTokens,
    diffuse,
    normal,
    gloss,
    glow,
  };

  if (extras.length > 0) {
    material.extras = extras;
  }

  return { material, newPos: pos };
}

/**
 * Parse blendFunc directive
 */
function parseBlendFunc(tokens: string[], pos: number): [BlendFactor, BlendFactor] {
  const token = tokens[pos]?.toLowerCase();

  // Preset shortcuts
  switch (token) {
    case "add":
      return ["GL_ONE", "GL_ONE"];
    case "blend":
      return ["GL_SRC_ALPHA", "GL_ONE_MINUS_SRC_ALPHA"];
    case "filter":
      return ["GL_DST_COLOR", "GL_ZERO"];
    default: {
      // Two-parameter form: blendFunc <src> <dst>
      const src = parseBlendFactor(token);
      const dst = parseBlendFactor(tokens[pos + 1]);
      return [src, dst];
    }
  }
}

/**
 * Parse a single blend factor
 */
function parseBlendFactor(token?: string): BlendFactor {
  if (!token) return "GL_ONE";

  const t = token.toUpperCase();
  const factors: BlendFactor[] = [
    "GL_ONE",
    "GL_ZERO",
    "GL_SRC_COLOR",
    "GL_DST_COLOR",
    "GL_ONE_MINUS_SRC_COLOR",
    "GL_ONE_MINUS_DST_COLOR",
    "GL_SRC_ALPHA",
    "GL_DST_ALPHA",
    "GL_ONE_MINUS_SRC_ALPHA",
    "GL_ONE_MINUS_DST_ALPHA",
  ];

  if (factors.includes(t as BlendFactor)) {
    return t as BlendFactor;
  }

  return "GL_ONE";
}

const SKY_SIDE_NAMES = ["rt", "bk", "lf", "ft", "up", "dn"];

/**
 * The six `skyparmssides` sides as images: a side named `rt`, `bk`, … takes
 * that side's image. Null unless all six resolve, as Warfork drops the box then.
 */
export function resolveSkySides(words: string[]): string[] | null {
  if (words.length < 6) return null;
  const refs = words.map((word) => SKY_SIDE_NAMES.indexOf(word.toLowerCase()));
  const images = words.map((word, i) => (refs[i] < 0 ? word : ""));
  const sides = images.map((image, i) => image || images[refs[i]] || "");
  return sides.every(Boolean) ? sides : null;
}

/**
 * Up to `count` numbers from `start`, with or without Quake's brackets:
 * `const ( 1 0 0 )` and `const 1 0 0` read the same. Zero stays zero.
 */
function constNumbers(tokens: string[], start: number, count: number): number[] {
  const values: number[] = [];
  for (let i = start; i < tokens.length && values.length < count; i++) {
    if (tokens[i] === "(") continue;
    if (tokens[i] === ")") break;
    const value = Number.parseFloat(tokens[i]);
    if (!Number.isFinite(value)) break;
    values.push(value);
  }
  return values;
}

/**
 * Parse rgbGen directive
 */
function parseRgbGen(tokens: string[], pos: number): RgbGen {
  const token = tokens[pos]?.toLowerCase();

  switch (token) {
    case "identity":
      return { type: "identity" };
    case "identitylighting":
      return { type: "identityLighting" };
    case "vertex":
      return { type: "vertex" };
    case "exactvertex":
      return { type: "vertex" };
    case "oneminusvertex":
      return { type: "oneMinusVertex" };
    case "entity":
      return { type: "entity" };
    case "oneminusentity":
      return { type: "oneMinusEntity" };
    case "lightingdiffuse":
      return { type: "lightingDiffuse" };
    case "wave":
      if (tokens[pos + 1]?.toLowerCase() === "distanceramp") {
        const [from = 0, to = 1, near = 0, far = 1] = constNumbers(tokens, pos + 2, 4);
        return { type: "distanceRamp", distanceRamp: { from, to, near, far } };
      }
      return { type: "wave", wave: parseWaveFunc(tokens, pos + 1) };
    case "const": {
      const color = constNumbers(tokens, pos + 1, 3);
      return { type: "const", color: color.length === 3 ? [color[0], color[1], color[2]] : [1, 1, 1] };
    }
    default:
      return { type: "identity" };
  }
}

/**
 * Parse alphaGen directive
 */
function parseAlphaGen(tokens: string[], pos: number): AlphaGen {
  const token = tokens[pos]?.toLowerCase();

  switch (token) {
    case "identity":
      return { type: "identity" };
    case "vertex":
      return { type: "vertex" };
    case "oneminusvertex":
      return { type: "oneMinusVertex" };
    case "entity":
      return { type: "entity" };
    case "oneminusentity":
      return { type: "oneMinusEntity" };
    case "lightingspecular":
      return { type: "lightingSpecular" };
    case "portal":
      return { type: "portal" };
    case "wave":
      if (tokens[pos + 1]?.toLowerCase() === "distanceramp") {
        const [from = 0, to = 1, near = 0, far = 1] = constNumbers(tokens, pos + 2, 4);
        return { type: "distanceRamp", distanceRamp: { from, to, near, far } };
      }
      return { type: "wave", wave: parseWaveFunc(tokens, pos + 1) };
    case "const": {
      const [value] = constNumbers(tokens, pos + 1, 1);
      return { type: "const", value: value ?? 1 };
    }
    default:
      return { type: "identity" };
  }
}

/**
 * Parse wave function
 */
function parseWaveFunc(tokens: string[], pos: number): WaveFunc {
  const funcName = tokens[pos]?.toLowerCase() || "sin";
  const validFuncs = ["sin", "triangle", "square", "sawtooth", "inversesawtooth", "noise"];

  return {
    func: validFuncs.includes(funcName) ? (funcName as WaveFunc["func"]) : "sin",
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
    case "scroll":
      return {
        type: "scroll",
        sSpeed: parseFloat(tokens[pos + 1]) || 0,
        tSpeed: parseFloat(tokens[pos + 2]) || 0,
      };
    case "scale":
      return {
        type: "scale",
        sScale: parseFloat(tokens[pos + 1]) || 1,
        tScale: parseFloat(tokens[pos + 2]) || 1,
      };
    case "rotate":
      return {
        type: "rotate",
        degreesPerSecond: parseFloat(tokens[pos + 1]) || 0,
      };
    case "stretch":
      return {
        type: "stretch",
        func: parseWaveFunc(tokens, pos + 1),
      };
    case "turb":
      return {
        type: "turb",
        base: parseFloat(tokens[pos + 1]) || 0,
        amplitude: parseFloat(tokens[pos + 2]) || 1,
        phase: parseFloat(tokens[pos + 3]) || 0,
        frequency: parseFloat(tokens[pos + 4]) || 1,
      };
    case "transform":
      return {
        type: "transform",
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

/**
 * Parse tcGen directive
 */
function parseTcGen(tokens: string[], pos: number): TcGen {
  const token = tokens[pos]?.toLowerCase();

  switch (token) {
    case "base":
      return { mode: "base" };
    case "lightmap":
      return { mode: "lightmap" };
    case "environment":
      return { mode: "environment" };
    case "vector": {
      // Parse two 3-component vectors: ( sx sy sz ) ( tx ty tz )
      // Skip opening parenthesis if present
      let i = pos + 1;

      // Parse S vector
      if (tokens[i] === "(") i++;
      const sx = parseFloat(tokens[i++]) || 0;
      const sy = parseFloat(tokens[i++]) || 0;
      const sz = parseFloat(tokens[i++]) || 0;
      if (tokens[i] === ")") i++;

      // Parse T vector
      if (tokens[i] === "(") i++;
      const tx = parseFloat(tokens[i++]) || 0;
      const ty = parseFloat(tokens[i++]) || 0;
      const tz = parseFloat(tokens[i++]) || 0;

      return {
        mode: "vector",
        vector: {
          sVector: [sx, sy, sz],
          tVector: [tx, ty, tz],
        },
      };
    }
    default:
      // Unknown tcGen mode, default to base
      return { mode: "base" };
  }
}
