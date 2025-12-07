import {
  Mesh,
  Ray,
  Scene,
  TransformNode,
  Vector3,
} from "babylonjs";
import { BrushGenerator } from "./BrushGenerator";
import { type PatchDefinition, PatchGenerator } from "./PatchGenerator";
import { PrefabLoader } from "./PrefabLoader";
import { TextureManager } from "./TextureManager";

export interface PrefabInstanceOptions {
  /** Position in world space (Babylon coords: X, Y, Z where Y is up) */
  position: Vector3;
  /** Y-axis rotation in degrees */
  angle?: number;
  /** Uniform scale */
  scale?: number;
  /** If true, raycast down to place on ground geometry */
  dropToGround?: boolean;
  /** Vertical offset after dropping (positive = higher) */
  dropOffset?: number;
  /** Custom collision setting (default: true) */
  hasCollision?: boolean;
}

export interface PrefabInstanceResult {
  /** Root transform node containing all prefab meshes */
  root: TransformNode;
  /** All meshes in this instance */
  meshes: Mesh[];
  /** Final position after drop-to-ground (if applied) */
  finalPosition: Vector3;
}

/**
 * Handles instantiating prefabs into the scene with transforms and drop-to-ground.
 */
export class PrefabInstance {
  /**
   * Instantiate a prefab into the scene.
   * 
   * @param prefabName - Name of the prefab (without .map extension)
   * @param scene - Babylon scene to add meshes to
   * @param options - Position, rotation, scale, and drop settings
   */
  public static async create(
    prefabName: string,
    scene: Scene,
    options: PrefabInstanceOptions
  ): Promise<PrefabInstanceResult | null> {
    const prefab = PrefabLoader.getInstance().getPrefab(prefabName);
    
    if (!prefab) {
      // Try loading it
      const loaded = await PrefabLoader.getInstance().loadPrefab(prefabName);
      if (!loaded) {
        console.error(`Prefab not found: ${prefabName}`);
        return null;
      }
      return this.create(prefabName, scene, options);
    }

    const {
      position,
      angle = 0,
      scale = 1,
      dropToGround = false,
      dropOffset = 0,
      hasCollision = true,
    } = options;

    // Create root transform node for this instance
    const root = new TransformNode(`prefab_${prefabName}_${Date.now()}`, scene);
    const meshes: Mesh[] = [];

    // Calculate final position
    let finalPosition = position.clone();

    // Drop to ground if requested
    if (dropToGround) {
      const groundY = this.findGroundLevel(position, scene);
      if (groundY !== null) {
        finalPosition.y = groundY + dropOffset;
      }
    }

    // Set root transform
    root.position = finalPosition;
    root.rotation.y = (angle * Math.PI) / 180; // Convert degrees to radians
    root.scaling = new Vector3(scale, scale, scale);

    // Build meshes from prefab entities
    const textureManager = TextureManager.getInstance();

    for (const entity of prefab.entities) {
      // Build brushes
      for (const brush of entity.brushes) {
        const mesh = BrushGenerator.buildMesh(brush, scene);
        if (mesh) {
          // Apply material
          if (!mesh.material) {
            const textureName = brush.planes[0]?.texture;
            const planeDef = brush.planes[0];

            if (textureName) {
              const material = await textureManager.getMaterial({
                path: textureName,
                u_offset: planeDef?.u_offset || 0,
                v_offset: planeDef?.v_offset || 0,
                rotation: planeDef?.rotation || 0,
                u_scale: planeDef?.u_scale || 1,
                v_scale: planeDef?.v_scale || 1,
              });
              mesh.material = material;
            }
          }

          mesh.parent = root;
          mesh.checkCollisions = hasCollision;
          meshes.push(mesh);
        }
      }

      // Build patches
      for (const patch of entity.patches) {
        const patchDef: PatchDefinition = {
          texture: patch.texture,
          width: patch.width,
          height: patch.height,
          controlPoints: patch.controlPoints.map((row) =>
            row.map((cp) => ({
              // Quake Z-up to Babylon Y-up conversion
              position: new Vector3(cp.x, cp.z, cp.y),
              u: cp.u,
              v: cp.v,
            }))
          ),
        };

        const mesh = PatchGenerator.buildMesh(patchDef, scene);
        if (mesh) {
          const material = await textureManager.getMaterial({
            path: patch.texture,
            u_offset: 0,
            v_offset: 0,
            rotation: 0,
            u_scale: 1,
            v_scale: 1,
          });
          material.twoSidedLighting = true;
          mesh.material = material;
          mesh.parent = root;
          mesh.checkCollisions = hasCollision;
          meshes.push(mesh);
        }
      }
    }

    console.log(`Instantiated prefab: ${prefabName} at ${finalPosition.toString()} (${meshes.length} meshes)`);

    return {
      root,
      meshes,
      finalPosition,
    };
  }

  /**
   * Raycast downward to find ground level at a position.
   * Returns Y coordinate of ground, or null if no ground found.
   */
  private static findGroundLevel(position: Vector3, scene: Scene): number | null {
    // Start ray slightly above the position to avoid self-intersection
    const rayStart = new Vector3(position.x, position.y + 100, position.z);
    const rayDirection = new Vector3(0, -1, 0);
    const rayLength = 1000; // Max distance to check

    const ray = new Ray(rayStart, rayDirection, rayLength);

    // Pick with all meshes that have collision enabled
    const hit = scene.pickWithRay(ray, (mesh) => {
      // Ignore prefab meshes (they start with "prefab_")
      // and other non-world geometry
      return (
        mesh.isPickable &&
        mesh.checkCollisions &&
        !mesh.name.startsWith("prefab_") &&
        mesh.name !== "ground" // Avoid picking ground plane if we have one
      );
    });

    if (hit?.hit && hit.pickedPoint) {
      return hit.pickedPoint.y;
    }

    return null;
  }

  /**
   * Create multiple instances of the same prefab efficiently.
   */
  public static async createMultiple(
    prefabName: string,
    scene: Scene,
    instances: PrefabInstanceOptions[]
  ): Promise<PrefabInstanceResult[]> {
    // Ensure prefab is loaded once
    await PrefabLoader.getInstance().loadPrefab(prefabName);

    const results: PrefabInstanceResult[] = [];
    for (const options of instances) {
      const result = await this.create(prefabName, scene, options);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }
}
