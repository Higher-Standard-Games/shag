/**
 * PhysicsSystem - Havok Physics integration for Babylon.js
 *
 * Manages physics simulation including:
 * - Havok engine initialization
 * - Scene physics enablement
 * - Collision mesh generation from BSP
 * - Character controller management
 * - Projectile physics
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import { MovementVars } from "../movement/MovementVars";

// ==================== Types ====================

export interface PhysicsSystemConfig {
  gravity?: Vector3;
  enableDebug?: boolean;
}

export interface PhysicsBodyHandle {
  mesh: Mesh;
  aggregate: PhysicsAggregate;
  type: "static" | "dynamic" | "kinematic";
}

// ==================== PhysicsSystem Class ====================

export class PhysicsSystem {
  private static instance: PhysicsSystem;

  private scene: Scene | null = null;
  private havokPlugin: HavokPlugin | null = null;
  private havokInstance: any = null;
  private initialized: boolean = false;
  private initializing: boolean = false;

  // Track physics bodies (for projectiles, debris, etc.)
  private bodies: Map<string, PhysicsBodyHandle> = new Map();

  // Note: World collision is handled by BSP collision system, not Havok
  // Havok is used for gravity, velocity, and impulse simulation only

  private constructor() {}

  static getInstance(): PhysicsSystem {
    if (!PhysicsSystem.instance) {
      PhysicsSystem.instance = new PhysicsSystem();
    }
    return PhysicsSystem.instance;
  }

  // ==================== Initialization ====================

  /**
   * Initialize Havok physics engine
   * Call this once at startup, before any scene is created
   */
  async initHavok(): Promise<boolean> {
    if (this.havokInstance) {
      return true; // Already initialized
    }

    if (this.initializing) {
      // Wait for existing initialization
      while (this.initializing) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return this.havokInstance !== null;
    }

    this.initializing = true;
    this.initializing = true;

    try {
      // Dynamic import to allow tree-shaking if not used
      const HavokPhysics = (await import("@babylonjs/havok")).default;

      // Explicitly locate the WASM file properly served from public/wasm
      // Note: We use manual path instead of Vite specific imports to ensure compatibility
      // with both browser (Vite dev server) and headless (vite-node) environments.
      this.havokInstance = await HavokPhysics({
        locateFile: (_path) => {
          return "/wasm/HavokPhysics.wasm";
        },
      });

      this.havokPlugin = new HavokPlugin(true, this.havokInstance);

      this.initializing = false;
      return true;
    } catch (error) {
      console.error("[PhysicsSystem] Failed to initialize Havok:", error);
      console.error("[PhysicsSystem] STACK:", (error as Error).stack);
      console.error("[PhysicsSystem] Ensure /wasm/HavokPhysics.wasm exists and is accessible.");
      this.initializing = false;
      return false;
    }
  }

  /**
   * Enable physics on a scene
   */
  async enablePhysics(scene: Scene, config?: PhysicsSystemConfig): Promise<boolean> {
    if (!this.havokInstance) {
      const success = await this.initHavok();
      if (!success) {
        console.error("[PhysicsSystem] Cannot enable physics - Havok not initialized");
        return false;
      }
    }

    // Get gravity from config or MovementVars
    const mv = MovementVars.getInstance();
    const gravityStrength = config?.gravity?.y ?? -mv.get("sv_gravity");
    const gravity = config?.gravity ?? new Vector3(0, gravityStrength, 0);

    try {
      // Create Havok plugin
      this.havokPlugin = new HavokPlugin(true, this.havokInstance);

      // Enable physics on scene
      scene.enablePhysics(gravity, this.havokPlugin);

      this.scene = scene;
      this.initialized = true;

      return true;
    } catch (error) {
      console.error("[PhysicsSystem] Failed to enable physics:", error);
      return false;
    }
  }

  /**
   * Check if physics is initialized and enabled
   */
  isInitialized(): boolean {
    return this.initialized && this.scene !== null;
  }

  /**
   * Check if Havok engine is loaded
   */
  isHavokLoaded(): boolean {
    return this.havokInstance !== null;
  }

  // ==================== Body Management ====================
  // Note: World collision is handled by BSP collision system (CollisionManager)
  // PhysicsSystem handles gravity, velocity, and impulse for dynamic entities

  /**
   * Create a dynamic physics body
   */
  createDynamicBody(
    mesh: Mesh,
    shapeType: PhysicsShapeType,
    mass: number = 1,
    restitution: number = 0.5,
  ): PhysicsBodyHandle | null {
    if (!this.isInitialized() || !this.scene) {
      return null;
    }

    try {
      const aggregate = new PhysicsAggregate(mesh, shapeType, { mass, restitution }, this.scene);

      const handle: PhysicsBodyHandle = {
        mesh,
        aggregate,
        type: "dynamic",
      };

      this.bodies.set(mesh.name, handle);
      return handle;
    } catch (error) {
      console.error("[PhysicsSystem] Failed to create dynamic body:", error);
      return null;
    }
  }

  /**
   * Create a static physics body
   */
  createStaticBody(mesh: Mesh, shapeType: PhysicsShapeType): PhysicsBodyHandle | null {
    if (!this.isInitialized() || !this.scene) {
      return null;
    }

    try {
      const aggregate = new PhysicsAggregate(mesh, shapeType, { mass: 0 }, this.scene);

      const handle: PhysicsBodyHandle = {
        mesh,
        aggregate,
        type: "static",
      };

      this.bodies.set(mesh.name, handle);
      return handle;
    } catch (error) {
      console.error("[PhysicsSystem] Failed to create static body:", error);
      return null;
    }
  }

  // ==================== BSP Collision ====================

  private bspCollisionBodies: PhysicsAggregate[] = [];

  /**
   * Create static Havok collision from BSP worldMesh.
   * Call once after the BSP map is rendered.
   * Creates a static trimesh for each child mesh of the worldMesh,
   * giving decoration physics (ragdolls, weapon drops) proper
   * collision with the entire map geometry.
   */
  createBspCollision(worldMesh: Mesh): number {
    if (!this.isInitialized() || !this.scene) {
      console.warn("[PhysicsSystem] Cannot create BSP collision — not initialized");
      return 0;
    }

    // Dispose any previous BSP collision
    this.disposeBspCollision();

    let count = 0;
    const childMeshes = worldMesh.getChildMeshes(false);

    for (const child of childMeshes) {
      if (!(child instanceof Mesh)) continue;
      // Skip invisible/empty meshes
      if (!child.isVisible || !child.getTotalVertices || child.getTotalVertices() === 0) continue;

      try {
        // Make mesh non-pickable so it doesn't interfere with game raycasts
        // (BSP collision for gameplay uses CollisionManager, not Havok)
        const wasPickable = child.isPickable;

        const aggregate = new PhysicsAggregate(
          child,
          PhysicsShapeType.MESH, // trimesh — exact surface collision
          { mass: 0 }, // static (immovable)
          this.scene!,
        );
        this.bspCollisionBodies.push(aggregate);
        count++;

        // Restore pickable state (game raycasts need pickable BSP)
        child.isPickable = wasPickable;
      } catch (e) {
        // Some meshes may fail (degenerate geometry, etc.) — skip silently
      }
    }

    console.log(
      `[PhysicsSystem] BSP collision created: ${count} trimesh bodies from ${childMeshes.length} child meshes`,
    );
    return count;
  }

  /**
   * Check if BSP collision is loaded
   */
  hasBspCollision(): boolean {
    return this.bspCollisionBodies.length > 0;
  }

  /**
   * Dispose BSP collision bodies
   */
  disposeBspCollision(): void {
    for (const agg of this.bspCollisionBodies) {
      try {
        agg.dispose();
      } catch (_) {
        /* noop */
      }
    }
    this.bspCollisionBodies = [];
  }

  /**
   * Remove a physics body
   */
  removeBody(name: string): boolean {
    const handle = this.bodies.get(name);
    if (!handle) return false;

    handle.aggregate.dispose();
    this.bodies.delete(name);
    return true;
  }

  /**
   * Get a physics body by name
   */
  getBody(name: string): PhysicsBodyHandle | undefined {
    return this.bodies.get(name);
  }

  // ==================== Gravity Control ====================

  /**
   * Set gravity strength
   */
  setGravity(gravity: Vector3): void {
    if (!this.scene?.physicsEnabled) return;

    const plugin = this.scene.getPhysicsEngine()?.getPhysicsPlugin();
    if (plugin) {
      plugin.setGravity(gravity);
    }
  }

  /**
   * Get current gravity
   */
  getGravity(): Vector3 {
    if (!this.scene?.physicsEnabled) {
      return new Vector3(0, -800, 0);
    }

    // Havok plugin stores gravity internally
    if (this.havokPlugin) {
      const g = new Vector3();
      (this.havokPlugin as any).getGravity?.(g);
      if (g.length() > 0) return g;
    }

    // Fallback to MovementVars
    const mv = MovementVars.getInstance();
    return new Vector3(0, -mv.get("sv_gravity"), 0);
  }

  // ==================== Cleanup ====================

  /**
   * Dispose all physics bodies
   */
  clear(): void {
    this.disposeBspCollision();
    for (const handle of this.bodies.values()) {
      handle.aggregate.dispose();
    }
    this.bodies.clear();
  }

  /**
   * Dispose physics system
   */
  dispose(): void {
    this.clear();

    if (this.scene?.physicsEnabled) {
      this.scene.disablePhysicsEngine();
    }

    this.scene = null;
    this.havokPlugin = null;
    this.initialized = false;
  }

  // ==================== Debug ====================

  getInfo(): string {
    const lines = ["=== Physics System ==="];
    lines.push(`Havok loaded: ${this.isHavokLoaded()}`);
    lines.push(`Initialized: ${this.isInitialized()}`);

    if (this.isInitialized()) {
      const gravity = this.getGravity();
      lines.push(`Gravity: (${gravity.x}, ${gravity.y}, ${gravity.z})`);
      lines.push(`Dynamic bodies: ${this.bodies.size}`);
      lines.push(`World collision: BSP (CollisionManager)`);
    }

    return lines.join("\n");
  }
}
