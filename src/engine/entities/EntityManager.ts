/**
 * EntityManager - Manages game entities and their spawning
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { type PickupEntry, extractPickups } from "../../shared/bsp/PickupTable";
import type { EntityDef } from "../../shared/entities/EntityDef";
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import { EntityType } from "../../shared/entities/EntityType";
import { type EntityData, EntityHandlerRegistry, type EntityHandlerResult } from "../core/EntityHandlerRegistry";
// Type-only import reaches into the fps game module — EntityManager itself
// builds FPS-flavoured entity types (weapon/ammo) and is FPS-coupled (matrix #6).
// Type-only imports are erased at compile time.
import type { InventoryManager } from "../../games/fps/world/InventoryManager";

export class EntityManager {
  private static instance: EntityManager;
  private entities: any[] = []; // TODO: ActiveEntity interface
  /**
   * Authoritative weapon-pickup table for the current map, derived from the SAME
   * shared extractor the server uses (src/shared/bsp/PickupTable.ts). Pickup ids
   * come from here so they match the server exactly — no parallel counter.
   * Rebuilt each map load via the pre-render hook registered in registerHandlers().
   */
  private pickupTable: PickupEntry[] = [];

  private constructor() {}

  public static getInstance(): EntityManager {
    if (!EntityManager.instance) {
      EntityManager.instance = new EntityManager();
    }
    return EntityManager.instance;
  }

  /**
   * Register handlers for all entities in the EntityRegistry
   * Call this before loading a map
   */
  public registerHandlers(): void {
    const registry = EntityRegistry.getInstance();
    const weapons = registry.getByType<EntityDef>(EntityType.WEAPON);
    const ammo = registry.getByType<EntityDef>(EntityType.AMMO);
    const armor = registry.getByType<EntityDef>(EntityType.ARMOR);
    const health = registry.getByType<EntityDef>(EntityType.HEALTH);

    console.log(
      `[EntityManager] Registering handlers for ${weapons.length} weapons, ${ammo.length} ammo, ${armor.length} armor, ${health.length} health...`,
    );

    // Register All Items
    const allItems = [...weapons, ...ammo, ...armor, ...health];

    for (const item of allItems) {
      if (item.classname) {
        EntityHandlerRegistry.register(item.classname, (data, scene) => this.spawnEntity(item, data, scene));
      }
    }

    // Build the authoritative weapon-pickup table before spawn handlers run, so
    // each weapon pickup gets the same id the server assigns. Pre-render hooks
    // run before the per-entity handlers in MapLoader.processBspEntities.
    EntityHandlerRegistry.addPreRenderHook((entities) => {
      this.pickupTable = extractPickups(entities);
    });
  }

  /**
   * Spawn an entity by its registry ID (e.g. from console)
   */
  public async spawnEntityById(
    id: string,
    position: Vector3,
    scene: Scene,
    options: { gravity?: boolean } = {},
  ): Promise<boolean> {
    const registry = EntityRegistry.getInstance();
    let def = registry.get(id);

    // Fallback: Try looking up by classname (e.g. 'weapon_plasmagun')
    if (!def) {
      def = registry.getByClassname(id);
    }

    if (!def) {
      console.error(`[EntityManager] Entity definition not found: ${id}`);
      // Log available IDs for help
      console.log(`[EntityManager] Available IDs: ${registry.getAllIds().join(", ")}`);
      return false;
    }

    console.log(`[EntityManager] Manually spawning ${id} at ${position}`);

    try {
      // DIRECT PICKUP CREATION for manual spawn is safer/cleaner.
      // FPSPickup lives in the fps game module — imported dynamically here to
      // keep EntityManager runtime-independent of the fps module loading order.
      new (await import("../../games/fps/world/FPSPickup")).FPSPickup(`${id}_${Date.now()}`, scene, position, {
        id: def.id,
        modelPath: def.modelPath || "models/items/ammo/ammobox/ammobox.md3",
        type: def.type === EntityType.WEAPON ? "weapon" : "ammo",
        value: (def as any).weaponId || (def as any).amount || def.id,
        scale: def.scale,
        gravity: options.gravity,
        glowColor: def.glowColor, // Pass glow color for pulsing light
      });

      return true;
    } catch (e) {
      console.error(`[EntityManager] Failed to manual spawn ${id}:`, e);
      return false;
    }
  }

  /**
   * Get list of all registered entity IDs for autocomplete
   */
  public getRegisteredIds(): string[] {
    return EntityRegistry.getInstance().getAllIds();
  }

  /**
   * Spawn a generic entity (weapon/ammo)
   */
  private async spawnEntity(def: EntityDef, data: EntityData, scene: Scene): Promise<EntityHandlerResult> {
    // Parse origin
    const originStr = data.properties.origin;
    let position = Vector3.Zero();
    if (originStr) {
      const parts = originStr.split(" ").map(parseFloat);
      if (parts.length === 3) {
        // Swap Y/Z for Babylon (Quake: X, Y, Z -> Babylon: X, Z, Y)
        // Add +24 to Y to prevent floor clipping
        position = new Vector3(parts[0], parts[2] + 24, parts[1]);
      }
    }

    console.log(`[EntityManager] Spawning ${def.name} at ${position}`);

    // Dynamically import FPSPickup to avoid loading the fps game module eagerly
    // from engine code (EntityManager is engine-positioned but its entity types
    // are FPS-flavoured — weapon/ammo. Plan to relocate EntityManager to fps is
    // tracked separately).
    const { FPSPickup } = await import("../../games/fps/world/FPSPickup");

    // Naming: Use targetname if available, otherwise classname
    const name = data.properties.targetname || `${def.classname || "item"}_${Date.now()}`;

    const type: "weapon" | "ammo" | "armor" | "health" =
      def.type === EntityType.AMMO
        ? "ammo"
        : def.type === EntityType.ARMOR
          ? "armor"
          : def.type === EntityType.HEALTH
            ? "health"
            : "weapon";
    let value: string | number = def.id;

    if (type === "ammo" && (def as any).ammoType) {
      value = (def as any).ammoType;
    }

    // Authoritative pickup id from the shared table (matches the server). All
    // server-tracked types (weapon/ammo/armor/health) share one id space. Match by
    // classname + XZ — both sides parse the same BSP origin, so XZ is exact
    // (only Y differs: client adds +24, table keeps raw). Disambiguates multiple
    // pickups of the same kind by position. All server-tracked pickups,
    // including ammo, must have an id.
    const pickupEntry = this.pickupTable.find(
      (e) =>
        e.classname === def.classname &&
        Math.abs(e.position.x - position.x) < 0.5 &&
        Math.abs(e.position.z - position.z) < 0.5,
    );
    const pickupId = pickupEntry?.id;

    if (pickupId === undefined) {
      console.warn(
        `[EntityManager] Skipping server-managed pickup without shared id: ${def.classname ?? def.id} at ${position.toString()}`,
      );
      return { handled: true };
    }

    const pickup = new FPSPickup(name, scene, position, {
      id: def.id,
      modelPath: def.modelPath || "models/items/ammo/ammobox/ammobox.md3",
      type: type,
      value: value,
      // Server-authoritative: visibility/respawn is driven by the snapshot
      // active-set, not a client-local timer (matches the server exactly).
      serverManagedRespawn: true,
      scale: def.scale || 1.0,
      glowColor: def.glowColor,
      pickupId,
    });

    // Register this pickup in local tracking (optional, Pickup handles its own logic now)
    this.entities.push({
      def,
      node: pickup,
      active: true,
    });

    return { handled: true, node: pickup };
  }
  /**
   * Check if player is picking up any entities
   * Call this from player controller update loop
   */
  public checkPickups(playerPos: Vector3, inventory: InventoryManager): void {
    // Simple distance check for now
    // AABB check would be better
    for (const entity of this.entities) {
      if (!entity.active || !entity.trigger) continue;

      const dist = Vector3.Distance(playerPos, entity.trigger.position);
      // Rough radius check (32 units = ~0.8m?)
      if (dist < 40) {
        // 32 + player radius approximation
        this.pickupEntity(entity, inventory);
      }
    }
  }

  private pickupEntity(entity: any, inventory: InventoryManager): void {
    const result = inventory.giveWeapon(entity.def.id);
    if (result.acquired) {
      console.log(`[EntityManager] Picked up ${entity.def.name}`);
      entity.active = false;

      if (entity.mesh) {
        entity.mesh.setEnabled(false);
      }
      if (entity.trigger) {
        entity.trigger.setEnabled(false); // Hide debug box
      }

      // TODO: Play pickup sound
      // TODO: Dispatch UI event
    }
  }
}
