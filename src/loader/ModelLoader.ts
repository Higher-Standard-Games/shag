import {
  Mesh,
  PBRMaterial,
  Scene,
  SceneLoader,
  type ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "babylonjs";
import "babylonjs-loaders";

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
