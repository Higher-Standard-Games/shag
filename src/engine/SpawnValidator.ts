import { Scene, Vector3 } from "babylonjs";

/**
 * Context passed to spawn validators
 */
export interface SpawnValidationContext {
  /** Prefab name being spawned */
  prefabName: string;
  /** Target spawn position (Babylon coords) */
  position: Vector3;
  /** Scene reference */
  scene: Scene;
  /** Properties from the trigger entity */
  triggerProperties: Record<string, string>;
  /** Approximate size of the prefab (if known) */
  prefabSize?: Vector3;
}

/**
 * Result of a spawn validation
 */
export interface SpawnValidationResult {
  /** Whether spawning is allowed */
  allowed: boolean;
  /** Reason if not allowed (for UI feedback) */
  reason?: string;
}

/**
 * Base interface for custom spawn validators.
 * Implement this to add game-specific spawn rules.
 */
export interface ISpawnValidator {
  /** Unique identifier for this validator */
  id: string;
  /** Validate whether spawning is allowed */
  validate(context: SpawnValidationContext): SpawnValidationResult;
}

/**
 * Built-in validator: Checks for collision with existing meshes
 */
export class CollisionValidator implements ISpawnValidator {
  id = "collision";

  /** Minimum distance from existing objects (default 32 units) */
  private minDistance: number;

  constructor(minDistance = 32) {
    this.minDistance = minDistance;
  }

  validate(context: SpawnValidationContext): SpawnValidationResult {
    const { position, scene, prefabSize } = context;

    // Use prefab size or default check radius
    const checkRadius = prefabSize 
      ? Math.max(prefabSize.x, prefabSize.z) / 2 
      : this.minDistance;

    // Only check against OTHER prefab instances, not world geometry
    for (const mesh of scene.meshes) {
      // Only check prefab meshes (they have a parent starting with "prefab_")
      const isPrefab = mesh.parent?.name?.startsWith("prefab_");
      if (!isPrefab) continue;

      // Skip triggers
      if (mesh.name.includes("trigger")) continue;
      if (!mesh.getBoundingInfo()) continue;

      const boundingInfo = mesh.getBoundingInfo();
      const meshCenter = boundingInfo.boundingBox.centerWorld;

      // Simple distance check
      const distance = Vector3.Distance(position, meshCenter);
      const meshRadius = boundingInfo.boundingSphere.radiusWorld;

      if (distance < checkRadius + meshRadius) {
        return {
          allowed: false,
          reason: `Too close to existing prefab`,
        };
      }
    }

    return { allowed: true };
  }
}

/**
 * SpawnValidator manages validation rules for dynamic prefab spawning.
 */
export class SpawnValidator {
  private static instance: SpawnValidator;
  private validators: Map<string, ISpawnValidator> = new Map();
  private globalValidators: ISpawnValidator[] = [];

  private constructor() {
    // Register built-in collision validator by default
    this.registerGlobal(new CollisionValidator());
  }

  public static getInstance(): SpawnValidator {
    if (!SpawnValidator.instance) {
      SpawnValidator.instance = new SpawnValidator();
    }
    return SpawnValidator.instance;
  }

  /**
   * Register a named validator that can be referenced by triggers
   */
  public register(validator: ISpawnValidator): void {
    this.validators.set(validator.id, validator);
    console.log(`Registered spawn validator: ${validator.id}`);
  }

  /**
   * Register a global validator that runs for ALL spawn attempts
   */
  public registerGlobal(validator: ISpawnValidator): void {
    this.globalValidators.push(validator);
    console.log(`Registered global spawn validator: ${validator.id}`);
  }

  /**
   * Remove a validator
   */
  public unregister(id: string): void {
    this.validators.delete(id);
    this.globalValidators = this.globalValidators.filter((v) => v.id !== id);
  }

  /**
   * Disable collision checking (useful for some game modes)
   */
  public disableCollisionCheck(): void {
    this.globalValidators = this.globalValidators.filter((v) => v.id !== "collision");
  }

  /**
   * Enable collision checking
   */
  public enableCollisionCheck(minDistance = 32): void {
    if (!this.globalValidators.some((v) => v.id === "collision")) {
      this.globalValidators.push(new CollisionValidator(minDistance));
    }
  }

  /**
   * Validate a spawn attempt.
   * 
   * @param context - Spawn context
   * @param validatorIds - Optional specific validators to run (from trigger properties)
   * @returns Validation result
   */
  public validate(
    context: SpawnValidationContext,
    validatorIds?: string[]
  ): SpawnValidationResult {
    // Run global validators first
    for (const validator of this.globalValidators) {
      const result = validator.validate(context);
      if (!result.allowed) {
        console.log(`Spawn blocked by ${validator.id}: ${result.reason}`);
        return result;
      }
    }

    // Run specific validators if requested
    if (validatorIds) {
      for (const id of validatorIds) {
        const validator = this.validators.get(id);
        if (validator) {
          const result = validator.validate(context);
          if (!result.allowed) {
            console.log(`Spawn blocked by ${validator.id}: ${result.reason}`);
            return result;
          }
        } else {
          console.warn(`Spawn validator not found: ${id}`);
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Get a validator by ID
   */
  public getValidator(id: string): ISpawnValidator | undefined {
    return this.validators.get(id);
  }
}

// ============================================
// Example custom validators for game logic
// ============================================

/**
 * Example: Resource cost validator
 * Checks if player has enough resources to spawn
 */
export class ResourceCostValidator implements ISpawnValidator {
  id = "resource_cost";

  private getPlayerResources: () => Record<string, number>;

  constructor(getPlayerResources: () => Record<string, number>) {
    this.getPlayerResources = getPlayerResources;
  }

  validate(context: SpawnValidationContext): SpawnValidationResult {
    const { triggerProperties } = context;

    // Check for cost properties like "cost_gold", "cost_wood", etc.
    const resources = this.getPlayerResources();

    for (const [key, value] of Object.entries(triggerProperties)) {
      if (key.startsWith("cost_")) {
        const resourceName = key.replace("cost_", "");
        const cost = parseFloat(value);
        const available = resources[resourceName] || 0;

        if (available < cost) {
          return {
            allowed: false,
            reason: `Not enough ${resourceName} (need ${cost}, have ${available})`,
          };
        }
      }
    }

    return { allowed: true };
  }
}

/**
 * Example: Max count validator
 * Limits how many of a prefab type can exist
 */
export class MaxCountValidator implements ISpawnValidator {
  id = "max_count";

  validate(context: SpawnValidationContext): SpawnValidationResult {
    const { prefabName, scene, triggerProperties } = context;

    const maxCount = triggerProperties.maxCount 
      ? parseInt(triggerProperties.maxCount) 
      : Infinity;

    // Count existing prefabs of this type
    let count = 0;
    for (const node of scene.transformNodes) {
      if (node.name.startsWith(`prefab_${prefabName}`)) {
        count++;
      }
    }

    if (count >= maxCount) {
      return {
        allowed: false,
        reason: `Maximum ${prefabName} count reached (${maxCount})`,
      };
    }

    return { allowed: true };
  }
}
