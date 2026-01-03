/**
 * Q3ShaderRegistry - Central registry for parsed Q3/Warsow shaders
 * 
 * Provides O(1) lookup of shaders by texture name and handles
 * loading shaders from PK3 archives.
 */

import { PK3Loader } from '../pk3/PK3Loader';
import { parseShaderFile } from './Q3ShaderParser';
import type { Q3Shader, ResolvedMaterialProps } from './Q3ShaderTypes';

export class Q3ShaderRegistry {
  private static instance: Q3ShaderRegistry;

  /** Map of shader name (lowercase) to shader definition */
  private shaders: Map<string, Q3Shader> = new Map();

  /** Whether shaders have been loaded */
  private loaded = false;

  private constructor() { }

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

  /**
   * Load all shaders from PK3Loader (uses singleton)
   * Can be called multiple times - will load from any new PK3s
   */
  async loadShaders(): Promise<number> {
    const pk3Loader = PK3Loader.getInstance();
    let newShaderCount = 0;

    // Find all .shader files in scripts/ folder from ALL loaded PK3s
    const shaderFiles = pk3Loader.listFiles('scripts/*.shader');

    // Filter to only new shader files
    const newShaderFiles = shaderFiles.filter(f => !this.processedShaderFiles.has(f));

    if (newShaderFiles.length === 0) {
      console.log(`[Q3ShaderRegistry] No new shader files (${this.shaders.size} total)`);
      return this.shaders.size;
    }

    console.log(`[Q3ShaderRegistry] Found ${newShaderFiles.length} new shader files`);

    for (const shaderFile of newShaderFiles) {
      this.processedShaderFiles.add(shaderFile);

      try {
        const data = await pk3Loader.getFile(shaderFile);
        if (!data) continue;

        const content = new TextDecoder('utf-8').decode(data);
        const parsedShaders = parseShaderFile(content);

        for (const shader of parsedShaders) {
          // Store by normalized name (lowercase, no extension)
          const name = shader.name.toLowerCase().replace(/\.(tga|jpg|png|ktx)$/i, '');
          this.shaders.set(name, shader);
          newShaderCount++;
        }
      } catch (err) {
        console.warn(`[Q3ShaderRegistry] Failed to parse ${shaderFile}:`, err);
      }
    }

    this.loaded = true;
    console.log(`[Q3ShaderRegistry] Loaded ${newShaderCount} new shaders (${this.shaders.size} total)`);

    return this.shaders.size;
  }

  /**
   * Get a shader by texture name
   * Returns undefined if no shader is defined (use default material)
   */
  getShader(textureName: string): Q3Shader | undefined {
    // Normalize: lowercase, no extension
    const name = textureName.toLowerCase().replace(/\.(tga|jpg|png|ktx)$/i, '');

    // Try exact match first
    let shader = this.shaders.get(name);
    if (shader) return shader;

    // If name has underscores but no slashes, try converting underscores to slashes
    // BSP texture names like "models_mapobjects_lamp_lamp_halo" -> "models/mapobjects/lamp/lamp_halo"
    if (name.includes('_') && !name.includes('/')) {
      const parts = name.split('_');

      // Try progressively more path segments
      // e.g., models/mapobjects/lamp/lamp_halo, models/mapobjects/lamp_lamp_halo, etc.
      for (let pathSegments = parts.length - 1; pathSegments >= 1; pathSegments--) {
        const pathPart = parts.slice(0, pathSegments).join('/');
        const namePart = parts.slice(pathSegments).join('_');
        const candidate = `${pathPart}/${namePart}`;
        shader = this.shaders.get(candidate);
        if (shader) return shader;
      }

      // Also try all underscores as slashes
      shader = this.shaders.get(parts.join('/'));
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
  resolveMaterialProps(textureName: string): ResolvedMaterialProps {
    const shader = this.getShader(textureName);

    // Default opaque material
    const defaults: ResolvedMaterialProps = {
      useLightmap: true,
      alphaMode: 'opaque',
      backFaceCulling: true,
      twoSidedLighting: false,
      depthWrite: true,
      isTransparent: false,
      needsAnimation: false,
      polygonOffset: false,
      isSky: false,
    };

    if (!shader) {
      return defaults;
    }

    const props: ResolvedMaterialProps = { ...defaults };

    // Sky detection - surfaceparm sky or has skyparms
    if (shader.surfaceParms.has('sky') || shader.skyParms) {
      props.isSky = true;
      props.useLightmap = false;
      if (shader.skyParms) {
        props.skyParms = shader.skyParms;
      }
    }

    // Cull mode
    if (shader.cull === 'none' || shader.cull === 'disable') {
      props.backFaceCulling = false;
      props.twoSidedLighting = true;
    } else if (shader.cull === 'front') {
      // Babylon doesn't have front-face culling directly, 
      // we'd need to flip normals or use a custom shader
      props.backFaceCulling = true;
    }

    // Polygon offset for decals
    if (shader.polygonOffset) {
      props.polygonOffset = true;
    }

    // Surface params
    if (shader.surfaceParms.has('trans') || shader.surfaceParms.has('alphashadow')) {
      props.isTransparent = true;
    }

    // Check stages for blend modes
    if (shader.stages.length > 0) {
      const firstStage = shader.stages[0];

      // Get diffuse texture from first stage
      if (firstStage.map && firstStage.map !== '$lightmap' && firstStage.map !== '$whiteimage') {
        props.diffuseTexture = firstStage.map;
      }

      // Check for lightmap stage
      props.useLightmap = shader.stages.some(s => s.map === '$lightmap');

      // Determine alpha mode from blend function
      if (firstStage.blendFunc) {
        const [src, dst] = firstStage.blendFunc;

        // Additive: GL_ONE, GL_ONE
        if (src === 'GL_ONE' && dst === 'GL_ONE') {
          props.alphaMode = 'add';
          props.isTransparent = true;
          props.depthWrite = false;
        }
        // Standard alpha blend: GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA
        else if (src === 'GL_SRC_ALPHA' && dst === 'GL_ONE_MINUS_SRC_ALPHA') {
          props.alphaMode = 'blend';
          props.isTransparent = true;
        }
        // Filter/multiply: GL_DST_COLOR, GL_ZERO
        else if (src === 'GL_DST_COLOR' && dst === 'GL_ZERO') {
          props.alphaMode = 'multiply';
          props.isTransparent = true;
        }
        // Additive with alpha: GL_SRC_ALPHA, GL_ONE
        else if (src === 'GL_SRC_ALPHA' && dst === 'GL_ONE') {
          props.alphaMode = 'add';
          props.isTransparent = true;
          props.depthWrite = false;
        }
      }

      // Alpha testing
      if (firstStage.alphaFunc) {
        props.isTransparent = true;
        switch (firstStage.alphaFunc) {
          case 'GT0':
            props.alphaCutoff = 0.01;
            break;
          case 'GE128':
            props.alphaCutoff = 0.5;
            break;
          case 'LT128':
            props.alphaCutoff = 0.5;
            // This is inverted - would need special handling
            break;
        }
      }

      // Check for animations
      if (firstStage.tcMod && firstStage.tcMod.length > 0) {
        props.needsAnimation = true;
        props.tcMod = firstStage.tcMod;
      }
      if (firstStage.animMap) {
        props.needsAnimation = true;
      }

      // Explicit depth write in stage
      if (firstStage.depthWrite !== undefined) {
        props.depthWrite = firstStage.depthWrite;
      }
    }

    return props;
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
    this.shaders.clear();
    this.processedShaderFiles.clear();
    this.loaded = false;
  }

  /**
   * Debug: print shader info
   */
  debugShader(textureName: string): void {
    const shader = this.getShader(textureName);
    if (!shader) {
      console.log(`[Q3ShaderRegistry] No shader found for: ${textureName}`);
      return;
    }

    console.log(`[Q3ShaderRegistry] Shader: ${shader.name}`);
    console.log(`  Cull: ${shader.cull}`);
    console.log(`  Surface parms: ${Array.from(shader.surfaceParms).join(', ')}`);
    console.log(`  Stages: ${shader.stages.length}`);

    shader.stages.forEach((stage, i) => {
      console.log(`  Stage ${i}:`);
      console.log(`    Map: ${stage.map}`);
      if (stage.blendFunc) {
        console.log(`    BlendFunc: ${stage.blendFunc.join(', ')}`);
      }
      if (stage.alphaFunc) {
        console.log(`    AlphaFunc: ${stage.alphaFunc}`);
      }
    });

    const resolved = this.resolveMaterialProps(textureName);
    console.log(`  Resolved props:`, resolved);
  }
}
