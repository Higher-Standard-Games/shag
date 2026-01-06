import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/loaders/glTF";
import { InstancedMeshManager, type InstanceTransform } from "../../rendering/InstancedMeshManager";

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
}

/**
 * Result of loading a model
 */
export interface ModelLoadResult {
  /** Root transform node containing all model meshes */
  root: TransformNode;
  /** All meshes in this model */
  meshes: Mesh[];
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

  private constructor() { }

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
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Load a GLB/glTF model and place it in the scene
   * 
   * @param modelPath - Path to the model file (e.g., "models/barrel.glb")
   * @param options - Position, rotation, scale options
   */
  public async loadModel(
    modelPath: string,
    options: ModelLoadOptions
  ): Promise<ModelLoadResult | null> {
    if (!this.scene) {
      console.error("ModelLoader not initialized");
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
    } = options;

    try {
      // Ensure path starts with /
      const fullPath = modelPath.startsWith("/") ? modelPath : "/" + modelPath;

      // Extract directory and filename
      const lastSlash = fullPath.lastIndexOf("/");
      const rootUrl = fullPath.substring(0, lastSlash + 1);
      const fileName = fullPath.substring(lastSlash + 1);

      console.log(`ModelLoader: Loading ${fileName} from ${rootUrl}`);

      // Load the model
      const result = await SceneLoader.ImportMeshAsync(
        "", // Import all meshes
        rootUrl,
        fileName,
        this.scene
      );

      if (!result.meshes || result.meshes.length === 0) {
        console.error(`No meshes found in model: ${modelPath}`);
        return null;
      }

      // Create root transform node
      const root = new TransformNode(`model_${fileName}_${Date.now()}`, this.scene);

      // Set transform on root
      root.position = position;
      root.rotation.y = (angle * Math.PI) / 180;
      root.scaling = new Vector3(scale, scale, scale);

      // Parent all loaded meshes to root and configure
      const meshes: Mesh[] = [];
      for (const mesh of result.meshes) {
        if (mesh instanceof Mesh) {
          // The __root__ node from glTF should be parented to our root
          if (mesh.parent === null || mesh.name === "__root__") {
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
              // Freeze material for better performance (BabylonJS 8 optimization)
              mesh.material.freeze();
            } else if (mesh.material instanceof StandardMaterial) {
              // Standard materials work with clustered lights by default
              mesh.material.freeze();
            }
          }

          // Add to shadow generator if requested
          if (castShadows && shadowGenerator) {
            shadowGenerator.addShadowCaster(mesh, false);
          }

          meshes.push(mesh);
        }
      }

      // Debug: Log mesh bounds
      for (const mesh of meshes) {
        const bounds = mesh.getBoundingInfo();
        console.log(`  Mesh "${mesh.name}": min=${bounds.boundingBox.minimumWorld}, max=${bounds.boundingBox.maximumWorld}, visible=${mesh.isVisible}`);
      }
      console.log(`Loaded model: ${modelPath} at ${position.toString()} (${meshes.length} meshes)`);

      return { root, meshes };
    } catch (error) {
      console.error(`Failed to load model: ${modelPath}`, error);
      return null;
    }
  }

  /**
   * Check if a path is a supported 3D model format
   */
  public static isModelFile(path: string): boolean {
    const lower = path.toLowerCase();
    return (
      lower.endsWith(".glb") ||
      lower.endsWith(".gltf") ||
      lower.endsWith(".obj") ||
      lower.endsWith(".babylon")
    );
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
    maxInstances: number = 500
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
    const primaryMesh = result.meshes.find(m => m.getTotalVertices() > 0);
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
    transform: InstanceTransform
  ): ReturnType<InstancedMeshManager["createInstance"]> {
    const instanceManager = InstancedMeshManager.getInstance();
    return instanceManager.createInstance(templateName, transform);
  }

  /**
   * Create multiple instances at once (more efficient)
   */
  public createInstances(
    templateName: string,
    transforms: InstanceTransform[]
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
   * Dispose and cleanup
   */
  public dispose(): void {
    this.clearCache();
    this.scene = null;
  }
}
