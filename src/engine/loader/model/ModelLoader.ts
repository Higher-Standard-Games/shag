import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { InstancedMeshManager, type InstanceTransform } from "../../rendering/InstancedMeshManager";
import { BspManager } from "../bsp/BspManager";
import { PK3Loader } from "../pk3/PK3Loader";
import { MD3Loader } from "./MD3Loader";

/**
 * Options for loading a 3D model
 */
export interface ModelLoadOptions {
  /** Position in world space (Babylon coords: X, Y, Z where Y is up) */
  position: Vector3;
  /** Y-axis rotation in degrees */
  angle?: number;
  /** Uniform scale */
  scale?: number;
  /** Enable collision on meshes (default: true) */
  hasCollision?: boolean;
  /** Receive shadows (default: true) */
  receiveShadows?: boolean;
  /** Cast shadows - requires shadow generator (default: false) */
  castShadows?: boolean;
  /** Shadow generator to use for casting shadows */
  shadowGenerator?: ShadowGenerator | null;
  /** Visible (default: true) - set false for invisible triggers/colliders */
  visible?: boolean;
  /** Rendering group ID for layer ordering (default: 0) */
  renderingGroupId?: number;
  /** Apply BSP lighting (creates DirectionalLight per model). Default: true.
   *  Set false for small items (pickups) to avoid exceeding GL_MAX_VERTEX_UNIFORM_BUFFERS */
  applyLighting?: boolean;
}

/**
 * Result of loading a model
 */
/**
 * Options for animation playback
 */
export interface AnimationPlayOptions {
  /** Loop the animation (default: true) */
  loop?: boolean;
  /** Playback speed multiplier (default: 1.0) */
  speed?: number;
  /** Start frame (default: animation start) */
  from?: number;
  /** End frame (default: animation end) */
  to?: number;
}

/**
 * Result of loading a model
 */
export interface ModelLoadResult {
  /** Root transform node containing all model meshes */
  root: TransformNode;
  /** All meshes in this model */
  meshes: Mesh[];
  /** Animation groups from the model (for animated models) */
  animationGroups: AnimationGroup[];
  /** Skeletons from the model (for skinned/rigged meshes) */
  skeletons: Skeleton[];
  /** Lights created for this model (for cleanup) */
  lights?: DirectionalLight[];
  /** Promises that resolve when textures finish loading (for async texture loading) */
  textureLoadPromises?: Promise<void>[];
}

/**
 * ModelLoader handles loading GLB/glTF 3D models.
 * Singleton pattern for caching loaded models.
 */
export class ModelLoader {
  private static instance: ModelLoader;
  private scene: Scene | null = null;

  // Cache for loaded model data (for cloning)
  private modelCache: Map<string, { meshes: Mesh[] }> = new Map();

  // Track all created lights for cleanup
  private createdLights: DirectionalLight[] = [];

  private constructor() {}

  public static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  /**
   * Initialize with scene
   */
  public init(scene: Scene): void {
    this.scene = scene;
    console.log("ModelLoader initialized");
  }

  /**
   * Check if initialized with a valid (non-disposed) scene
   */
  public isInitialized(): boolean {
    return this.scene !== null && !this.scene.isDisposed;
  }

  /**
   * Load a GLB/glTF model and place it in the scene
   *
   * @param modelPath - Path to the model file (e.g., "models/barrel.glb")
   * @param options - Position, rotation, scale options
   */
  public async loadModel(modelPath: string, options: ModelLoadOptions): Promise<ModelLoadResult | null> {
    if (!this.scene || this.scene.isDisposed) {
      console.error("ModelLoader not initialized or scene disposed");
      return null;
    }

    const {
      position,
      angle = 0,
      scale = 1,
      hasCollision = true,
      receiveShadows = true,
      castShadows = false,
      shadowGenerator = null,
      visible = true,
      renderingGroupId = 0,
      applyLighting = true,
    } = options;

    try {
      // Ensure path starts with /
      const fullPath = modelPath.startsWith("/") ? modelPath : `/${modelPath}`;

      // Extract directory and filename
      const lastSlash = fullPath.lastIndexOf("/");
      const rootUrl = fullPath.substring(0, lastSlash + 1);
      const fileName = fullPath.substring(lastSlash + 1);

      console.log(`ModelLoader: Loading ${fileName} from ${rootUrl}`);

      // Special handling for MD3 files (Quake 3 models)
      if (fileName.toLowerCase().endsWith(".md3")) {
        const pk3 = PK3Loader.getInstance();
        const md3 = MD3Loader.getInstance();

        // Ensure loaders are initialized
        if (!md3.scene) md3.init(this.scene); // Access private scene or just call init safe

        // Try to get file from PK3
        const buffer = await pk3.getFile(modelPath);
        if (buffer) {
          const model = md3.parseMD3(buffer);
          // Create meshes
          const md3Result = md3.createMeshes(model, fileName.replace(".md3", ""));

          if (md3Result?.root) {
            const root = md3Result.root;

            // Apply transforms
            root.position.copyFrom(position);
            root.rotation.y += (angle * Math.PI) / 180; // MD3s might have their own rotation, add to it
            root.scaling = new Vector3(scale, scale, scale);

            // Apply visibility/collision options to meshes
            const meshes = md3Result.meshes;
            for (const mesh of meshes) {
              mesh.checkCollisions = hasCollision;
              mesh.receiveShadows = receiveShadows;
              mesh.isVisible = visible;
              mesh.renderingGroupId = renderingGroupId;

              if (castShadows && shadowGenerator) {
                shadowGenerator.addShadowCaster(mesh, false);
              }
            }

            // Apply lighting (skip for small items to avoid exceeding light limits)
            const lights = applyLighting ? this.applyBspLighting(root.position, meshes) : [];

            console.log(`Loaded MD3 model: ${modelPath} (${meshes.length} meshes, lights=${lights.length})`);

            return {
              root,
              meshes,
              animationGroups: [], // MD3 anims are vertex-based, handled differently? or via setFrame
              skeletons: [],
              lights,
              textureLoadPromises: md3Result.textureLoadPromises,
            };
          }
        } else {
          console.warn(`MD3 file not found in PK3: ${modelPath}`);
          // Could fall back to SceneLoader if it was a real file... but mostly it's PK3.
        }
      }

      // Load the model (GLB/GLTF/OBJ)
      const result = await SceneLoader.ImportMeshAsync(
        "", // Import all meshes
        rootUrl,
        fileName,
        this.scene,
      );

      if (!result.meshes || result.meshes.length === 0) {
        console.error(`No meshes found in model: ${modelPath}`);
        return null;
      }

      // Create root transform node
      const root = new TransformNode(`model_${fileName}_${Date.now()}`, this.scene);

      // Set transform on root
      root.position.copyFrom(position);
      root.rotation.y = (angle * Math.PI) / 180;
      root.scaling = new Vector3(scale, scale, scale);

      // Parent the glTF root nodes to our root
      // glTF imports create __root__ TransformNode that contains the whole scene graph
      if (result.transformNodes) {
        for (const node of result.transformNodes) {
          if (node.parent === null || node.name === "__root__") {
            node.parent = root;
          }
        }
      }

      // Also parent any orphan meshes to root
      const meshes: Mesh[] = [];
      for (const mesh of result.meshes) {
        if (mesh instanceof Mesh) {
          // Parent orphan meshes (shouldn't happen if __root__ is handled above)
          if (mesh.parent === null) {
            mesh.parent = root;
          }

          mesh.checkCollisions = hasCollision;
          mesh.receiveShadows = receiveShadows;
          mesh.isVisible = visible;
          mesh.renderingGroupId = renderingGroupId;

          // Configure materials to work with clustered lighting
          // PBR materials from GLB need usePhysicalLightFalloff disabled for clustered lights
          if (mesh.material) {
            if (mesh.material instanceof PBRMaterial) {
              mesh.material.usePhysicalLightFalloff = false;
              mesh.material.maxSimultaneousLights = 4;
              // NOTE: Don't freeze here - will be frozen after applyBspLighting to avoid flicker
            }
            // StandardMaterial works with clustered lights by default
          }

          // Add to shadow generator if requested
          if (castShadows && shadowGenerator) {
            shadowGenerator.addShadowCaster(mesh, false);
          }

          meshes.push(mesh);
        }
      }

      const animationGroups: AnimationGroup[] = result.animationGroups || [];
      const skeletons: Skeleton[] = result.skeletons || [];

      // Apply BSP LightGrid lighting (skip for small items to avoid exceeding light limits)
      const lights = applyLighting ? this.applyBspLighting(root.position, meshes) : [];

      // Debug: Log mesh bounds
      for (const mesh of meshes) {
        const bounds = mesh.getBoundingInfo();
        console.log(
          `  Mesh "${mesh.name}": min=${bounds.boundingBox.minimumWorld}, max=${bounds.boundingBox.maximumWorld}, visible=${mesh.isVisible}`,
        );
      }

      // Log animation info if present
      if (animationGroups.length > 0) {
        console.log(`  Animations: ${animationGroups.map((a) => a.name).join(", ")}`);
      }
      if (skeletons.length > 0) {
        console.log(`  Skeletons: ${skeletons.length}`);
      }

      console.log(
        `Loaded model: ${modelPath} at ${position.toString()} (${meshes.length} meshes, ${animationGroups.length} animations)`,
      );

      return { root, meshes, animationGroups, skeletons, lights };
    } catch (error) {
      console.error(`Failed to load model: ${modelPath}`, error);
      return null;
    }
  }

  // ============================================================================
  // Animation Helpers
  // ============================================================================

  /**
   * Play an animation on a loaded model
   *
   * @param result - The ModelLoadResult from loadModel()
   * @param name - Animation name or index
   * @param options - Playback options (loop, speed, from, to)
   * @returns The AnimationGroup that was started, or null if not found
   */
  public playAnimation(
    result: ModelLoadResult,
    name: string | number,
    options?: AnimationPlayOptions,
  ): AnimationGroup | null {
    const anim = this.findAnimation(result, name);
    if (!anim) {
      console.warn(`Animation not found: ${name}`);
      return null;
    }

    const { loop = true, speed = 1.0, from, to } = options || {};

    // Stop if already playing
    anim.stop();

    // Set playback speed
    anim.speedRatio = speed;

    // Start the animation
    anim.start(loop, speed, from, to);

    return anim;
  }

  /**
   * Stop an animation on a loaded model
   *
   * @param result - The ModelLoadResult from loadModel()
   * @param name - Animation name or index. If omitted, stops all animations.
   */
  public stopAnimation(result: ModelLoadResult, name?: string | number): void {
    if (name === undefined) {
      // Stop all animations
      for (const anim of result.animationGroups) {
        anim.stop();
      }
    } else {
      const anim = this.findAnimation(result, name);
      if (anim) {
        anim.stop();
      }
    }
  }

  /**
   * Pause an animation on a loaded model
   *
   * @param result - The ModelLoadResult from loadModel()
   * @param name - Animation name or index. If omitted, pauses all animations.
   */
  public pauseAnimation(result: ModelLoadResult, name?: string | number): void {
    if (name === undefined) {
      for (const anim of result.animationGroups) {
        anim.pause();
      }
    } else {
      const anim = this.findAnimation(result, name);
      if (anim) {
        anim.pause();
      }
    }
  }

  /**
   * Get list of animation names for a loaded model
   *
   * @param result - The ModelLoadResult from loadModel()
   * @returns Array of animation names
   */
  public getAnimationNames(result: ModelLoadResult): string[] {
    return result.animationGroups.map((a) => a.name);
  }

  /**
   * Check if a model has animations
   *
   * @param result - The ModelLoadResult from loadModel()
   */
  public hasAnimations(result: ModelLoadResult): boolean {
    return result.animationGroups.length > 0;
  }

  /**
   * Get animation info (duration, frame count, etc.)
   *
   * @param result - The ModelLoadResult from loadModel()
   * @param name - Animation name or index
   */
  public getAnimationInfo(
    result: ModelLoadResult,
    name: string | number,
  ): {
    name: string;
    from: number;
    to: number;
    isPlaying: boolean;
    speedRatio: number;
  } | null {
    const anim = this.findAnimation(result, name);
    if (!anim) return null;

    return {
      name: anim.name,
      from: anim.from,
      to: anim.to,
      isPlaying: anim.isPlaying,
      speedRatio: anim.speedRatio,
    };
  }

  /**
   * Find an animation by name or index
   */
  private findAnimation(result: ModelLoadResult, name: string | number): AnimationGroup | null {
    if (typeof name === "number") {
      return result.animationGroups[name] || null;
    }
    return result.animationGroups.find((a) => a.name === name) || null;
  }

  /**
   * Check if a path is a supported 3D model format
   */
  public static isModelFile(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(".glb") || lower.endsWith(".gltf") || lower.endsWith(".obj") || lower.endsWith(".babylon");
  }

  /**
   * Register a loaded model as an instancing template
   * Use this for models that will be repeated many times (trees, props, etc.)
   *
   * @param templateName Unique name for this template
   * @param modelPath Path to the model file
   * @param maxInstances Maximum number of instances (for buffer sizing)
   */
  public async registerInstanceTemplate(
    templateName: string,
    modelPath: string,
    maxInstances: number = 500,
  ): Promise<boolean> {
    if (!this.scene) {
      console.error("ModelLoader not initialized");
      return false;
    }

    const instanceManager = InstancedMeshManager.getInstance();
    if (!instanceManager.isInitialized()) {
      instanceManager.init(this.scene);
    }

    // Check if already registered
    if (instanceManager.hasTemplate(templateName)) {
      return true;
    }

    // Load the model as template (invisible, for cloning)
    const result = await this.loadModel(modelPath, {
      position: Vector3.Zero(),
      visible: false,
    });

    if (!result || result.meshes.length === 0) {
      console.error(`Failed to load model as template: ${modelPath}`);
      return false;
    }

    // Register each mesh as a template
    // For multi-mesh models, we register the first visible mesh
    const primaryMesh = result.meshes.find((m) => m.getTotalVertices() > 0);
    if (primaryMesh) {
      instanceManager.registerTemplate(templateName, primaryMesh, maxInstances);
      console.log(`ModelLoader: Registered instance template '${templateName}'`);
      return true;
    }

    return false;
  }

  /**
   * Create an instance of a registered template
   * Much faster than loadModel for repeated geometry
   *
   * @param templateName Name of the registered template
   * @param transform Position, rotation, scale for the instance
   */
  public createInstance(
    templateName: string,
    transform: InstanceTransform,
  ): ReturnType<InstancedMeshManager["createInstance"]> {
    const instanceManager = InstancedMeshManager.getInstance();
    return instanceManager.createInstance(templateName, transform);
  }

  /**
   * Create multiple instances at once (more efficient)
   */
  public createInstances(
    templateName: string,
    transforms: InstanceTransform[],
  ): ReturnType<InstancedMeshManager["createInstances"]> {
    const instanceManager = InstancedMeshManager.getInstance();
    return instanceManager.createInstances(templateName, transforms);
  }

  /**
   * Check if a template is registered for instancing
   */
  public hasInstanceTemplate(templateName: string): boolean {
    return InstancedMeshManager.getInstance().hasTemplate(templateName);
  }

  /**
   * Clear the model cache
   */
  public clearCache(): void {
    this.modelCache.clear();
  }

  /**
   * Apply lighting from BSP LightGrid to meshes
   * Creates a DirectionalLight that only affects these meshes
   */
  private applyBspLighting(position: Vector3, meshes: Mesh[]): DirectionalLight[] {
    try {
      const bsp = BspManager.getInstance();
      if (!bsp || !bsp.isLoaded()) return [];

      const lighting = bsp.getLightingAt(position);
      if (!lighting) {
        // Fallback lighting for maps without LightGrid or unsupported formats (FBSP)
        console.log("[ModelLoader] No BSP lighting data. Using fallback.");

        // 1. Ambient Fallback
        const ambient = new Color3(0.3, 0.3, 0.3);

        for (const mesh of meshes) {
          if (mesh.material) {
            const mat = mesh.material;
            if (mat instanceof PBRMaterial) {
              mat.ambientColor = ambient;
              mat.ambientTextureStrength = 1.0;
            } else if (mat instanceof StandardMaterial) {
              mat.ambientColor = ambient;
            }
            mat.freeze();
          }
        }

        // 2. Directional Fallback (Generic Sun)
        // Downwards and slightly angled
        const lightDir = new Vector3(0.5, -1, 0.5).normalize();
        const lightName = `model_light_fallback_${Date.now()}_${Math.random()}`;
        const light = new DirectionalLight(lightName, lightDir, this.scene!);

        const dirColor = new Color3(0.8, 0.8, 0.75); // Warm sunlight
        light.diffuse = dirColor;
        light.specular = dirColor.scale(0.3);
        light.includedOnlyMeshes = meshes;

        this.createdLights.push(light);
        return [light];
      }

      // 1. Ambient Component
      // Convert 0-255 ambient to 0-1 Color3
      // We use a decent intensity for ambient to ensure visibility
      // Updated: Reduced to prevent overbright models
      const ambientIntensity = 0.15;

      // Gamma correction function (approximate sRGB/Monitor gamma)
      const toLinear = (v: number) => (v / 255) ** 2.2;

      const ambient = new Color3(
        toLinear(lighting.ambient[0]) * ambientIntensity,
        toLinear(lighting.ambient[1]) * ambientIntensity,
        toLinear(lighting.ambient[2]) * ambientIntensity,
      );

      // Apply ambient to materials and freeze them (deferred from loadModel to avoid flicker)
      for (const mesh of meshes) {
        if (mesh.material) {
          const mat = mesh.material;

          if (mat instanceof PBRMaterial) {
            mat.ambientColor = ambient;
            mat.ambientTextureStrength = 1.0;
          } else if (mat instanceof StandardMaterial) {
            mat.ambientColor = ambient;
          }

          // Freeze material now that all modifications are complete
          mat.freeze();
        }
      }

      // 2. Directional Component
      // Decode direction from Q3 format (byte, byte) -> (phi, theta) mapped to sphere
      // Lat/Long mapping:
      // theta (byte[0]) maps 0..255 to 0..360 degrees
      // phi (byte[1]) maps 0..255 to 0..180 degrees
      const theta = (lighting.direction[0] / 255) * 360 * (Math.PI / 180);
      const phi = (lighting.direction[1] / 255) * 180 * (Math.PI / 180);

      // Convert spherical to cartesian
      // Q3 Z-up to Babylon Y-up conversion happens here
      // Q3: x = cos(theta)sin(phi), y = sin(theta)sin(phi), z = cos(phi)
      // Babylon (Swap Y/Z): x=x, y=z, z=y
      const sinPhi = Math.sin(phi);
      const qx = Math.cos(theta) * sinPhi;
      const qy = Math.sin(theta) * sinPhi;
      const qz = Math.cos(phi);

      // Direction vector (Babylon coords: X, Z, Y)
      // Q3 Grid direction points TOWARDS the light source.
      // Babylon DirectionalLight expects direction the rays TRAVEL.
      // So we must negate the vector.
      const lightDir = new Vector3(qx, qz, qy).scale(-1);

      // Create DirectionalLight
      const lightName = `model_light_${Date.now()}_${Math.random()}`;
      const light = new DirectionalLight(lightName, lightDir, this.scene!);

      // Calculate directional color
      // Updated: Reduced to prevent overbright models
      const dirIntensity = 1.0;
      const dirColor = new Color3(
        toLinear(lighting.directional[0]) * dirIntensity,
        toLinear(lighting.directional[1]) * dirIntensity,
        toLinear(lighting.directional[2]) * dirIntensity,
      );

      light.diffuse = dirColor;
      light.specular = dirColor.scale(0.2); // Reduce specular to avoid blazingly bright spots

      // IMPORTANT: Scope this light to ONLY these model meshes
      light.includedOnlyMeshes = meshes;

      // Keep track for cleanup
      this.createdLights.push(light);

      console.log(
        `[ModelLoader] Applied BSP lighting: Amb=${ambient.toString()} Dir=${lightDir.toString()} Color=${dirColor.toString()}`,
      );

      return [light];
    } catch (e) {
      console.warn("[ModelLoader] Failed to apply BSP lighting:", e);
      return [];
    }
  }

  /**
   * Dispose and cleanup
   */
  public dispose(): void {
    // Clean up all created lights from loaded models
    for (const light of this.createdLights) {
      light.dispose();
    }
    this.createdLights = [];

    this.clearCache();
    this.scene = null;
  }
}
