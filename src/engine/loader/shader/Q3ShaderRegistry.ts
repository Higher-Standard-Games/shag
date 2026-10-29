/**
 * Q3ShaderRegistry - Central registry for parsed Q3/Warsow shaders
 *
 * Provides O(1) lookup of shaders by texture name and handles
 * loading shaders from PK3 archives.
 */

import { devLog } from "../../core/DevLog";
import { PK3Loader } from "../pk3/PK3Loader";
import { PACKAGED_TEXTURE_EXTENSION, stripTextureExtension } from "../texture/TextureExtensions";
import { parseShaderFile } from "./Q3ShaderParser";
import type {
  Q3MaterialDirective,
  Q3Shader,
  Q3ShaderStage,
  ResolvedMaterialProps,
  ResolveMaterialOptions,
} from "./Q3ShaderTypes";

type ResolvedBranch = ResolvedMaterialProps["resolvedBranch"];

type MaterialChannelResolution = {
  value?: string;
  explicitlyBlank: boolean;
};

type NormalizedMaterialDirective = {
  tokens: string[];
  diffuse: MaterialChannelResolution;
  normal: MaterialChannelResolution;
  gloss: MaterialChannelResolution;
  glow: MaterialChannelResolution;
};

const IMPLICIT_TEXTURE_EXTENSIONS = [PACKAGED_TEXTURE_EXTENSION, ".ktx", ".tga", ".png", ".jpg", ".jpeg"];
const IMPLICIT_NORMAL_SUFFIXES = ["_norm", "_normal", "_bump"];
const IMPLICIT_GLOSS_SUFFIXES = ["_gloss", "_spec"];
const IMPLICIT_GLOW_SUFFIXES = ["_glow", "_add"];

function normalizeShaderName(textureName: string): string {
  return stripTextureExtension(textureName.toLowerCase());
}

function normalizeTextureReference(texturePath: string): string {
  return texturePath.replace(/\\/g, "/");
}

function addTexturePrefixes(path: string): string[] {
  const normalized = normalizeTextureReference(path);
  const candidates = [normalized];
  const lower = normalized.toLowerCase();
  if (!lower.startsWith("textures/") && !lower.startsWith("models/")) {
    candidates.push(`textures/${normalized}`);
  }
  return candidates;
}

function buildTextureNameFallbacks(textureName: string): string[] {
  const paths: string[] = [textureName];
  if (textureName.includes("_") && !textureName.includes("/")) {
    const parts = textureName.split("_");
    if (parts.length >= 2) {
      paths.push(parts.join("/"));
      if (parts.length >= 3) {
        paths.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join("_")}`);
      }
      if (parts.length >= 4) {
        paths.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("_")}`);
      }
    }
  }
  return paths;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const path of paths) {
    const normalized = normalizeTextureReference(path);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function isExplicitBlankToken(token?: string): boolean {
  if (!token) return false;
  const normalized = token.toLowerCase();
  return normalized === "-" || normalized === "$blankbumpimage";
}

function isLightmapStage(stage: Q3ShaderStage): boolean {
  return stage.map.toLowerCase() === "$lightmap";
}

/** `map $cubemap`: a reflection of the map captured where the surface stands. */
export function isGeneratedCubemapStage(stage: Q3ShaderStage): boolean {
  return stage.map.toLowerCase() === "$cubemap";
}

function isRenderableStage(stage: Q3ShaderStage): boolean {
  return Boolean(
    stage.cubeMap || stage.material?.diffuse || stage.animMap?.frames.length || (stage.map && !isLightmapStage(stage)),
  );
}

/** An additive image stage after a `material` stage, which a collapsed material draws as its glow. */
function isAdditiveGlowStage(stage: Q3ShaderStage): boolean {
  return Boolean(
    (stage.map || stage.animMap?.frames.length) &&
      !isLightmapStage(stage) &&
      stage.blendFunc?.[0] === "GL_ONE" &&
      stage.blendFunc?.[1] === "GL_ONE",
  );
}

function hasFilterBlend(stage: Q3ShaderStage): boolean {
  return stage.blendFunc?.[0] === "GL_DST_COLOR" && stage.blendFunc?.[1] === "GL_ZERO";
}

export class Q3ShaderRegistry {
  private static instance: Q3ShaderRegistry;

  /** Map of shader name (lowercase) to shader definition */
  private shaders: Map<string, Q3Shader> = new Map();

  /** Whether shaders have been loaded */
  private loaded = false;

  private constructor() {}

  static getInstance(): Q3ShaderRegistry {
    if (!Q3ShaderRegistry.instance) {
      Q3ShaderRegistry.instance = new Q3ShaderRegistry();
    }
    return Q3ShaderRegistry.instance;
  }

  /** Check if shaders have been loaded */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Track which shader files have been processed */
  private processedShaderFiles: Set<string> = new Set();
  private filesystemRevision = -1;

  /** Cache resolved material props to avoid redundant resolution (perf: called per-face during BSP build) */
  private resolvedCache: Map<string, ResolvedMaterialProps> = new Map();

  /**
   * Load all shaders from PK3Loader (uses singleton)
   * Can be called multiple times - will load from any new PK3s
   *
   * When the mounted packages changed, every script is read again into fresh
   * tables that replace the old ones only once complete: the map build and a
   * projectile model can load at once, and a registry emptied for the duration
   * of a reload handed one of them no scripts at all.
   */
  async loadShaders(): Promise<number> {
    const pk3Loader = PK3Loader.getInstance();
    const revision = pk3Loader.getFilesystemRevision();
    const restart = revision !== this.filesystemRevision;
    const processed = restart ? new Set<string>() : this.processedShaderFiles;
    const shaders = restart ? new Map<string, Q3Shader>() : this.shaders;
    let newShaderCount = 0;

    // Find all .shader files in scripts/ folder from ALL loaded PK3s
    const shaderFiles = pk3Loader
      .listFiles("scripts/*.shader")
      .sort((a, b) => (pk3Loader.getFileOwner(a) ?? "").localeCompare(pk3Loader.getFileOwner(b) ?? ""));

    // Filter to only new shader files
    const newShaderFiles = shaderFiles.filter((f) => !processed.has(f));
    if (newShaderFiles.length > 0) devLog(`[Q3ShaderRegistry] Found ${newShaderFiles.length} new shader files`);

    for (const shaderFile of newShaderFiles) {
      processed.add(shaderFile);

      try {
        const data = await pk3Loader.getFile(shaderFile);
        if (!data) continue;

        const content = new TextDecoder("utf-8").decode(data);
        const parsedShaders = parseShaderFile(content);

        for (const shader of parsedShaders) {
          // Store by normalized name (lowercase, no extension)
          const name = normalizeShaderName(shader.name);
          shaders.set(name, shader);
          newShaderCount++;
        }
      } catch (err) {
        console.warn(`[Q3ShaderRegistry] Failed to parse ${shaderFile}:`, err);
      }
    }

    if (restart) {
      this.shaders = shaders;
      this.processedShaderFiles = processed;
      this.filesystemRevision = revision;
    }
    // Props resolved before a script arrived describe the no-script fallback
    if (restart || newShaderCount > 0) this.resolvedCache.clear();
    this.loaded = true;
    devLog(`[Q3ShaderRegistry] Loaded ${newShaderCount} new shaders (${this.shaders.size} total)`);

    return this.shaders.size;
  }

  /**
   * Get a shader by texture name
   * Returns undefined if no shader is defined (use default material)
   */
  getShader(textureName: string): Q3Shader | undefined {
    // Normalize: lowercase, no extension
    const name = normalizeShaderName(textureName);

    // Try exact match first
    let shader = this.shaders.get(name);
    if (shader) return shader;

    // If name has underscores but no slashes, try converting underscores to slashes
    // BSP texture names like "models_mapobjects_lamp_lamp_halo" -> "models/mapobjects/lamp/lamp_halo"
    if (name.includes("_") && !name.includes("/")) {
      const parts = name.split("_");

      // Try progressively more path segments
      // e.g., models/mapobjects/lamp/lamp_halo, models/mapobjects/lamp_lamp_halo, etc.
      for (let pathSegments = parts.length - 1; pathSegments >= 1; pathSegments--) {
        const pathPart = parts.slice(0, pathSegments).join("/");
        const namePart = parts.slice(pathSegments).join("_");
        const candidate = `${pathPart}/${namePart}`;
        shader = this.shaders.get(candidate);
        if (shader) return shader;
      }

      // Also try all underscores as slashes
      shader = this.shaders.get(parts.join("/"));
      if (shader) return shader;
    }

    return undefined;
  }

  /**
   * Check if a shader exists for a texture
   */
  hasShader(textureName: string): boolean {
    return this.getShader(textureName) !== undefined;
  }

  /**
   * Resolve shader to Babylon.js material properties
   * This is the main interface for BspMeshBuilder
   */
  resolveMaterialProps(textureName: string, options: ResolveMaterialOptions = {}): ResolvedMaterialProps {
    const deluxe = options.deluxe ?? false;
    const normalizedTextureName = normalizeShaderName(textureName);
    const cacheKey = `${normalizedTextureName}|deluxe=${deluxe ? 1 : 0}|cube=${options.textureCubeMap !== false ? 1 : 0}|world=${options.worldSurface ? 1 : 0}|pass=${options.passIndex ?? "all"}|nocube=${options.withoutGeneratedCubemap ? 1 : 0}`;

    // Check cache first (same texture + deluxe mode resolves to the same props)
    const cached = this.resolvedCache.get(cacheKey);
    if (cached) return cached;

    const shader = this.getShader(textureName);

    // Default opaque material
    const defaults: ResolvedMaterialProps = {
      hasMaterialMetadata: false,
      normalTextureExplicitlyBlank: false,
      glossTextureExplicitlyBlank: false,
      glowTextureExplicitlyBlank: false,
      resolvedBranch: "default",
      useLightmap: true,
      alphaMode: "opaque",
      backFaceCulling: true,
      twoSidedLighting: false,
      depthWrite: true,
      isTransparent: false,
      needsAnimation: false,
      polygonOffset: false,
      isSky: false,
      isFullbright: false,
      surfaceLight: 0,
      autosprite: false,
      autosprite2: false,
    };

    if (!shader) {
      const syntheticMaterial = this.createImplicitMaterialDirective(textureName);
      if (!syntheticMaterial) {
        this.resolvedCache.set(cacheKey, defaults);
        return defaults;
      }

      const props: ResolvedMaterialProps = { ...defaults };
      this.applyNormalizedMaterialToProps(props, this.normalizeMaterialDirective(syntheticMaterial));
      this.resolvedCache.set(cacheKey, props);
      return props;
    }

    const props: ResolvedMaterialProps = { ...defaults };
    const resolved = this.getResolvedStages(shader, deluxe, options.textureCubeMap !== false);
    const branch = resolved.branch;
    const selectedStages =
      options.passIndex === undefined
        ? resolved.stages
        : resolved.stages.slice(options.passIndex, options.passIndex + 1);
    const activeStages = options.withoutGeneratedCubemap
      ? selectedStages.filter((stage) => !isGeneratedCubemapStage(stage))
      : selectedStages;
    const materialStage = activeStages.find((stage) => stage.material !== undefined);
    // A collapsed material uses its own UV/blend state. An earlier environment
    // background pass must not turn the material's diffuse map into a reflection.
    const primaryStage = materialStage ?? this.getPrimaryStage(activeStages);
    const isClassicLightmapComposition = this.isClassicLightmapComposition(activeStages);

    props.resolvedBranch = branch;
    props.softParticle = shader.softParticle;
    props.glossIntensity = shader.glossIntensity;
    props.glossExponent = shader.glossExponent;
    props.primaryStage = primaryStage;
    props.blendFunc = primaryStage?.blendFunc;
    props.usesVertexRgb =
      ["vertex", "oneMinusVertex"].includes(primaryStage?.rgbGen?.type ?? "") ||
      (options.worldSurface === true && primaryStage?.rgbGen?.type === "lightingDiffuse");
    props.usesVertexAlpha = primaryStage?.alphaGen?.type === "vertex";
    props.rgbGen = primaryStage?.rgbGen;
    props.environmentMap = primaryStage?.cubeMap;
    if (primaryStage && isGeneratedCubemapStage(primaryStage)) props.generatedCubemap = true;

    // Sky detection - surfaceparm sky or has skyparms
    if (shader.surfaceParms.has("sky") || shader.skyParms) {
      props.isSky = true;
      props.useLightmap = false;
      if (shader.skyParms) {
        props.skyParms = shader.skyParms;
      }
    }

    // Cull mode
    if (shader.cull === "none" || shader.cull === "disable") {
      props.backFaceCulling = false;
      props.twoSidedLighting = true;
    } else if (shader.cull === "front") {
      // Babylon doesn't have front-face culling directly,
      // we'd need to flip normals or use a custom shader
      props.backFaceCulling = true;
    }

    // Polygon offset for decals
    if (shader.polygonOffset) {
      props.polygonOffset = true;
    }

    // Surface params
    if (shader.surfaceParms.has("trans") || shader.surfaceParms.has("alphashadow")) {
      props.isTransparent = true;
    }

    // Fullbright detection - lamp/light surfaces that don't use lightmap
    // These surfaces should appear at full brightness regardless of surrounding darkness
    if (shader.surfaceParms.has("nolightmap")) {
      props.isFullbright = true;
      props.useLightmap = false;
    }

    // Surface-light emission strength (q3map_surfacelight / lightingIntensity).
    if (shader.surfaceLight && shader.surfaceLight > 0) {
      props.surfaceLight = shader.surfaceLight;
    }

    // Normalize structured material metadata before any stage-map fallback.
    if (materialStage?.material) {
      this.applyNormalizedMaterialToProps(props, this.normalizeMaterialDirective(materialStage.material));
      const glow = activeStages.slice(activeStages.indexOf(materialStage) + 1).find(isAdditiveGlowStage);
      if (glow && !props.glowTexture) {
        props.glowTexture = normalizeTextureReference(glow.map || glow.animMap!.frames[0]);
        props.glowTextureExplicitlyBlank = false;
        props.glowStage = glow;
      }
    }

    if (activeStages.length > 0) {
      if (!props.diffuseTexture && primaryStage?.map && !isLightmapStage(primaryStage) && !props.generatedCubemap) {
        props.diffuseTexture = normalizeTextureReference(primaryStage.map);
      }
      if (!props.diffuseTexture && primaryStage?.animMap?.frames[0])
        props.diffuseTexture = normalizeTextureReference(primaryStage.animMap.frames[0]);

      // Check for lightmap stage in the selected stage stack
      props.useLightmap =
        !shader.surfaceParms.has("nolightmap") &&
        (materialStage !== undefined || activeStages.some((stage) => isLightmapStage(stage)));

      // Determine alpha mode from the representative stage, unless this is just
      // the classic Q3 base * lightmap composition we already map to lightmapTexture.
      if (primaryStage?.blendFunc && !isClassicLightmapComposition) {
        const [src, dst] = primaryStage.blendFunc;

        // Additive: GL_ONE, GL_ONE
        if (src === "GL_ONE" && dst === "GL_ONE") {
          props.alphaMode = "add";
          props.isTransparent = true;
          props.depthWrite = false;
        }
        // Standard alpha blend: GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA
        else if (src === "GL_SRC_ALPHA" && dst === "GL_ONE_MINUS_SRC_ALPHA") {
          props.alphaMode = "blend";
          props.isTransparent = true;
        }
        // Filter/multiply: GL_DST_COLOR, GL_ZERO (used for decals)
        else if (src === "GL_DST_COLOR" && dst === "GL_ZERO") {
          props.alphaMode = "multiply";
          props.isTransparent = true;
          props.depthWrite = false;
        }
        // Additive with alpha: GL_SRC_ALPHA, GL_ONE
        else if (src === "GL_SRC_ALPHA" && dst === "GL_ONE") {
          props.alphaMode = "add";
          props.isTransparent = true;
          props.depthWrite = false;
        }
        // Soft additive / screen: GL_ONE, GL_ONE_MINUS_SRC_COLOR
        else if (src === "GL_ONE" && dst === "GL_ONE_MINUS_SRC_COLOR") {
          props.alphaMode = "add";
          props.isTransparent = true;
          props.depthWrite = false;
        }
        // Inverse multiply: GL_ZERO, GL_ONE_MINUS_SRC_COLOR
        else if (src === "GL_ZERO" && dst === "GL_ONE_MINUS_SRC_COLOR") {
          props.alphaMode = "multiply";
          props.isTransparent = true;
        }
        // Any other blend with GL_ONE as source is likely additive-ish
        else if (src === "GL_ONE" && dst !== "GL_ZERO") {
          props.alphaMode = "add";
          props.isTransparent = true;
          props.depthWrite = false;
        }
      }

      // Alpha testing
      if (primaryStage?.alphaFunc) {
        props.isTransparent = true;
        switch (primaryStage.alphaFunc) {
          case "GT0":
            props.alphaCutoff = 0.01;
            break;
          case "GE128":
            props.alphaCutoff = 0.5;
            break;
          case "LT128":
            props.alphaCutoff = 0.5;
            break;
        }
      }

      // Check for animations
      if (primaryStage?.tcMod && primaryStage.tcMod.length > 0) {
        props.needsAnimation = true;
        props.tcMod = primaryStage.tcMod;
      }
      if (primaryStage?.animMap) {
        props.needsAnimation = true;
      }
      if (primaryStage?.rgbGen?.type === "wave" || primaryStage?.alphaGen?.type === "wave") props.needsAnimation = true;

      // Texture coordinate generation mode (environment mapping, etc.)
      if (primaryStage?.tcGen) {
        props.tcGen = primaryStage.tcGen;
      }

      // Explicit depth write in stage
      if (primaryStage?.depthWrite !== undefined) {
        props.depthWrite = primaryStage.depthWrite;
      }
    }

    // Autosprite detection from deformVertexes
    if (shader.deformVertexes) {
      for (const deform of shader.deformVertexes) {
        if (deform.type === "autosprite") {
          props.autosprite = true;
        } else if (deform.type === "autosprite2") {
          props.autosprite2 = true;
        }
      }
    }

    if (options.passIndex !== undefined) {
      if (options.passIndex > 0) props.depthWrite = primaryStage?.depthWrite ?? false;
      if (!props.useLightmap) props.isFullbright = true;
    }
    this.resolvedCache.set(cacheKey, props);
    return props;
  }

  /** Whether the shader's selected stages include a `map $cubemap` stage. */
  hasGeneratedCubemap(textureName: string, options: ResolveMaterialOptions = {}): boolean {
    const shader = this.getShader(textureName);
    if (!shader) return false;
    return this.getResolvedStages(shader, options.deluxe ?? false, options.textureCubeMap !== false).stages.some(
      (stage) => isGeneratedCubemapStage(stage),
    );
  }

  /** Keep repeated material layers in script order instead of dropping later layers. */
  resolveMaterialPasses(textureName: string, options: ResolveMaterialOptions = {}): ResolvedMaterialProps[] {
    const shader = this.getShader(textureName);
    const stages = shader
      ? this.getResolvedStages(shader, options.deluxe ?? false, options.textureCubeMap !== false).stages
      : [];
    // A `map $cubemap` stage beside other stages draws as its own pass,
    // blended by its blendFunc, where it stands in the script; the other
    // stages keep their usual single-material composition.
    if (
      stages.some((stage) => isGeneratedCubemapStage(stage)) &&
      stages.some((stage) => isRenderableStage(stage) && !isGeneratedCubemapStage(stage))
    ) {
      const passes = [
        {
          at: stages.findIndex((stage) => !isGeneratedCubemapStage(stage)),
          props: this.resolveMaterialProps(textureName, { ...options, withoutGeneratedCubemap: true }),
        },
      ];
      stages.forEach((stage, passIndex) => {
        if (isGeneratedCubemapStage(stage))
          passes.push({ at: passIndex, props: this.resolveMaterialProps(textureName, { ...options, passIndex }) });
      });
      return passes.sort((a, b) => a.at - b.at).map((pass) => pass.props);
    }
    const environmentBackground = stages[0]?.cubeMap || stages[0]?.tcGen?.mode === "environment";
    // A collapsed material has one glow slot: additive stages beyond it, or any
    // additive stage when the material names its own glow, draw as passes.
    const materialIndex = stages.findIndex((stage) => stage.material);
    const material = stages[materialIndex]?.material;
    const additiveAfterMaterial = stages.slice(materialIndex + 1).filter(isAdditiveGlowStage).length;
    const glowSlots = material && this.normalizeMaterialDirective(material).glow.value ? 0 : 1;
    if (
      (!environmentBackground &&
        stages.filter((stage) => stage.material).length < 2 &&
        additiveAfterMaterial <= glowSlots) ||
      (!environmentBackground && !stages[0]?.material) ||
      !stages.every(
        (stage, index) =>
          (stage.cubeMap || stage.material || stage.map || stage.animMap) &&
          !isLightmapStage(stage) &&
          (index === 0
            ? !stage.blendFunc || (stage.blendFunc[0] === "GL_ONE" && stage.blendFunc[1] === "GL_ZERO")
            : stage.material
              ? stage.blendFunc?.[0] === "GL_SRC_ALPHA" && stage.blendFunc[1] === "GL_ONE_MINUS_SRC_ALPHA"
              : (stage.blendFunc?.[0] === "GL_ONE" || stage.blendFunc?.[0] === "GL_SRC_ALPHA") &&
                stage.blendFunc[1] === "GL_ONE") &&
          (!stage.tcGen || stage.tcGen.mode === "base" || (index === 0 && !!environmentBackground)),
      )
    ) {
      return [this.resolveMaterialProps(textureName, options)];
    }
    return stages.map((_, passIndex) => this.resolveMaterialProps(textureName, { ...options, passIndex }));
  }

  private getResolvedStages(
    shader: Q3Shader,
    deluxe: boolean,
    textureCubeMap = true,
  ): { stages: Q3ShaderStage[]; branch: ResolvedBranch } {
    const unconditionalStages = shader.unconditionalStages ?? shader.stages;

    if (!shader.conditionalBlocks || shader.conditionalBlocks.length === 0) {
      return { stages: unconditionalStages, branch: "default" };
    }

    const requestedBranch: Exclude<ResolvedBranch, "default"> = deluxe ? "deluxe" : "!deluxe";
    const selected = new Set(unconditionalStages);
    let selectedDeluxe = false;
    for (const block of shader.conditionalBlocks) {
      if (
        block.condition === requestedBranch ||
        block.condition === (textureCubeMap ? "textureCubeMap" : "!textureCubeMap")
      ) {
        for (const stage of block.stages) selected.add(stage);
        if (block.condition === requestedBranch) selectedDeluxe = true;
      }
    }
    return {
      stages: [
        ...shader.stages.filter((stage) => selected.has(stage)),
        ...[...selected].filter((stage) => !shader.stages.includes(stage)),
      ],
      branch: selectedDeluxe ? requestedBranch : "default",
    };
  }

  private getPrimaryStage(stages: Q3ShaderStage[]): Q3ShaderStage | undefined {
    const renderableStage =
      stages.find((stage) => isRenderableStage(stage) && !isGeneratedCubemapStage(stage)) ??
      stages.find((stage) => isRenderableStage(stage));
    return renderableStage ?? stages[0];
  }

  private normalizeMaterialDirective(material: Q3MaterialDirective): NormalizedMaterialDirective {
    const tokens = material.rawTokens.map((token) => normalizeTextureReference(token));
    const [diffuseToken, normalToken, glossToken, glowToken] = tokens;
    const resolveChannel = (token?: string): MaterialChannelResolution => {
      if (!token) {
        return { value: undefined, explicitlyBlank: false };
      }
      if (isExplicitBlankToken(token)) {
        return { value: undefined, explicitlyBlank: true };
      }
      return { value: token, explicitlyBlank: false };
    };

    return {
      tokens,
      diffuse: resolveChannel(diffuseToken),
      normal: resolveChannel(normalToken),
      gloss: resolveChannel(glossToken),
      glow: resolveChannel(glowToken),
    };
  }

  private applyNormalizedMaterialToProps(props: ResolvedMaterialProps, material: NormalizedMaterialDirective): void {
    props.hasMaterialMetadata = true;
    props.materialTokens = material.tokens;
    props.normalTextureExplicitlyBlank = material.normal.explicitlyBlank;
    props.glossTextureExplicitlyBlank = material.gloss.explicitlyBlank;
    props.glowTextureExplicitlyBlank = material.glow.explicitlyBlank;

    if (material.diffuse.value) {
      props.diffuseTexture = material.diffuse.value;
    }
    if (material.normal.value) {
      props.normalTexture = material.normal.value;
    }
    if (material.gloss.value) {
      props.glossTexture = material.gloss.value;
    }
    if (material.glow.value) {
      props.glowTexture = material.glow.value;
    }
  }

  private createImplicitMaterialDirective(textureName: string): Q3MaterialDirective | null {
    const pk3Loader = PK3Loader.getInstance();
    const candidateBases = dedupePaths(
      buildTextureNameFallbacks(normalizeShaderName(textureName)).flatMap((candidate) => addTexturePrefixes(candidate)),
    );

    const diffuse = this.findFirstExistingTexturePath(candidateBases);
    if (!diffuse) {
      return null;
    }

    const diffuseBase = normalizeShaderName(diffuse);
    const normal = this.findFirstExistingTexturePath(
      IMPLICIT_NORMAL_SUFFIXES.map((suffix) => `${diffuseBase}${suffix}`),
    );
    const gloss = this.findFirstExistingTexturePath(IMPLICIT_GLOSS_SUFFIXES.map((suffix) => `${diffuseBase}${suffix}`));
    const glow = this.findFirstExistingTexturePath(IMPLICIT_GLOW_SUFFIXES.map((suffix) => `${diffuseBase}${suffix}`));

    const rawTokens = [diffuse];
    if (normal || gloss || glow) {
      rawTokens.push(normal ?? "-");
    }
    if (gloss || glow) {
      rawTokens.push(gloss ?? "-");
    }
    if (glow) {
      rawTokens.push(glow);
    }

    // Avoid synthetic metadata when the diffuse itself doesn't exist in loaded PK3s.
    if (!pk3Loader.hasFile(diffuse)) {
      return null;
    }

    return {
      rawTokens,
      diffuse,
      normal,
      gloss,
      glow,
    };
  }

  private findFirstExistingTexturePath(baseCandidates: string[]): string | undefined {
    const pk3Loader = PK3Loader.getInstance();
    for (const baseCandidate of baseCandidates) {
      const normalizedBase = normalizeShaderName(baseCandidate);
      for (const ext of IMPLICIT_TEXTURE_EXTENSIONS) {
        const candidate = `${normalizedBase}${ext}`;
        if (pk3Loader.hasFile(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private isClassicLightmapComposition(stages: Q3ShaderStage[]): boolean {
    if (stages.length === 0) return false;

    const hasExplicitMaterial = stages.some((stage) => stage.material !== undefined);
    if (hasExplicitMaterial) return false;

    const hasLightmapStage = stages.some((stage) => isLightmapStage(stage));
    const hasRenderableStage = stages.some((stage) => isRenderableStage(stage));
    const hasFilterStage = stages.some((stage) => hasFilterBlend(stage));

    return hasLightmapStage && hasRenderableStage && hasFilterStage;
  }

  /**
   * Get all loaded shader names (for debugging)
   */
  getShaderNames(): string[] {
    return Array.from(this.shaders.keys());
  }

  /**
   * Get count of loaded shaders
   */
  getShaderCount(): number {
    return this.shaders.size;
  }

  /**
   * Clear all loaded shaders
   */
  clear(): void {
    this.filesystemRevision = -1;
    this.shaders.clear();
    this.processedShaderFiles.clear();
    this.resolvedCache.clear();
    this.loaded = false;
  }

  /**
   * Debug: print shader info
   */
  debugShader(textureName: string): void {
    const shader = this.getShader(textureName);
    if (!shader) {
      devLog(`[Q3ShaderRegistry] No shader found for: ${textureName}`);
      return;
    }

    devLog(`[Q3ShaderRegistry] Shader: ${shader.name}`);
    devLog(`  Cull: ${shader.cull}`);
    devLog(`  Surface parms: ${Array.from(shader.surfaceParms).join(", ")}`);
    devLog(`  Stages: ${shader.stages.length}`);

    shader.stages.forEach((stage, i) => {
      devLog(`  Stage ${i}:`);
      devLog(`    Map: ${stage.map}`);
      if (stage.cubeMap) {
        devLog(`    Cubemap: ${stage.cubeMap}`);
      }
      if (stage.blendFunc) {
        devLog(`    BlendFunc: ${stage.blendFunc.join(", ")}`);
      }
      if (stage.alphaFunc) {
        devLog(`    AlphaFunc: ${stage.alphaFunc}`);
      }
    });

    const resolved = this.resolveMaterialProps(textureName);
    devLog(`  Resolved props:`, resolved);
  }
}
