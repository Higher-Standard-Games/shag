/**
 * EntityManager - Manages game entities and their spawning
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
// Type-only import reaches into the fps game module — EntityManager itself
// builds FPS-flavoured entity types (weapon/ammo) and is FPS-coupled (matrix #6).
// Type-only imports are erased at compile time.
import type { InventoryManager } from "../../games/fps/world/InventoryManager";
import { extractPickups, type PickupEntry } from "../../shared/bsp/PickupTable";
import { SharedCollisionWorld } from "../../shared/collision/SharedCollisionWorld";
import type { EntityDef } from "../../shared/entities/EntityDef";
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import { EntityType } from "../../shared/entities/EntityType";
import { landMapPickups } from "../../shared/items/ItemThrow";
import { type EntityData, EntityHandlerRegistry, type EntityHandlerResult } from "../core/EntityHandlerRegistry";
import { getCollisionManager } from "../physics/CollisionManager";
import { SweepBackendAdapter } from "../physics/SweepBackendAdapter";
import { RenderVars } from "../rendering/RenderVars";
import type { PickupVisualFactory } from "../world/PickupVisual";

/** Health/armor render as procedural sculptures unless r_pickupProcedural is 0. */
function proceduralPickupsEnabled(): boolean {
  try {
    return (RenderVars.getInstance().get("r_pickupProcedural") ?? 1) >= 0.5;
  } catch {
    return true;
  }
}

/** A map weapon's resting yaw, from its pickup id, so a rack of them does not read as identical props. */
function mapWeaponYaw(pickupId: number): number {
  return (pickupId * 2.399963) % (Math.PI * 2);
}

/** Pickup categories the client spawns visuals for (mirrors shared PickupType). */
type ClientPickupType = "weapon" | "ammo" | "armor" | "health" | "powerup";

/**
 * EntityType → pickup category. One mapping instead of the ternary chains that
 * used to sit at each spawn site and had to be edited in lockstep; `fallback`
 * differs because the map-spawn path treats unknown defs as weapons while the
 * console-spawn path treats them as ammo.
 */
function pickupTypeOf(def: EntityDef, fallback: ClientPickupType): ClientPickupType {
  switch (def.type) {
    case EntityType.WEAPON:
      return "weapon";
    case EntityType.AMMO:
      return "ammo";
    case EntityType.ARMOR:
      return "armor";
    case EntityType.HEALTH:
      return "health";
    case EntityType.POWERUP:
      return "powerup";
    default:
      return fallback;
  }
}

/**
 * Resolve the procedural visual factory for a health/armor/ammo definition, or
 * undefined to keep the MD3 model path (weapons, unknown ids, or toggle off).
 * Weapons stay on models deliberately — the pickup IS the gun you collect.
 */
async function resolvePickupVisualFactory(
  def: EntityDef,
  type: ClientPickupType,
): Promise<PickupVisualFactory | undefined> {
  if (type === "weapon") return undefined;
  if (!proceduralPickupsEnabled()) return undefined;
  const { createProceduralPickupFactory } = await import(
    "../../games/fps/world/pickups/procedural/ProceduralPickupFactory"
  );
  return createProceduralPickupFactory(def.id) ?? undefined;
}

export class EntityManager {
  private static instance: EntityManager;
  private entities: any[] = []; // TODO: ActiveEntity interface
  /**
   * Authoritative pickup table for the current map, derived from the SAME shared
   * extractor the server uses (src/shared/bsp/PickupTable.ts). Pickup ids come
   * from here so they match the server exactly — no parallel counter — and map
   * entities are matched to it by their authored origin.
   * Rebuilt each map load via the pre-render hook registered in registerHandlers().
   */
  private pickupTable: PickupEntry[] = [];

  /** The same table with each weapon where its spawn toss comes to rest, which is where the server's trigger is. */
  private landedPickups: PickupEntry[] = [];

  /** Stable identity lets EntityHandlerRegistry de-duplicate this hook across reloads. */
  private readonly rebuildPickupTable = (entities: EntityData[]) => {
    this.pickupTable = extractPickups(entities);
    const sweep = getCollisionManager().getSweepBackend();
    if (!sweep) {
      console.warn("[EntityManager] Collision is not ready: weapons stay at authored spots the server does not use");
    }
    // Without collision there is no landing to speak of: the authored spots stand,
    // and each pickup finds the floor beneath it the way it always did.
    this.landedPickups = sweep
      ? landMapPickups(this.pickupTable, new SharedCollisionWorld(new SweepBackendAdapter(sweep)))
      : [];
  };

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
    const powerups = registry.getByType<EntityDef>(EntityType.POWERUP);

    console.log(
      `[EntityManager] Registering handlers for ${weapons.length} weapons, ${ammo.length} ammo, ${armor.length} armor, ${health.length} health, ${powerups.length} powerups...`,
    );

    // Register All Items
    const allItems = [...weapons, ...ammo, ...armor, ...health, ...powerups];

    for (const item of allItems) {
      const handler = (data: EntityData, scene: Scene) => this.spawnEntity(item, data, scene);
      // Register the primary classname AND every alias — MapLoader dispatches by
      // exact classname (getHandler), so aliased map classnames (e.g. bare
      // "item_health", legacy "ammo_shells") only spawn if their own handler exists.
      if (item.classname) {
        EntityHandlerRegistry.register(item.classname, handler);
      }
      for (const alias of item.classnameAliases ?? []) {
        EntityHandlerRegistry.register(alias, handler);
      }
    }

    // Build the authoritative weapon-pickup table before spawn handlers run, so
    // each weapon pickup gets the same id the server assigns. Pre-render hooks
    // run before the per-entity handlers in MapLoader.processBspEntities.
    EntityHandlerRegistry.addPreRenderHook(this.rebuildPickupTable);
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
      // Preserve the definition's actual type so armor/health aren't misfiled as
      // ammo (which also blocks their procedural visual).
      const type = pickupTypeOf(def, "ammo");
      const visualFactory = await resolvePickupVisualFactory(def, type);

      // DIRECT PICKUP CREATION for manual spawn is safer/cleaner.
      // FPSPickup lives in the fps game module — imported dynamically here to
      // keep EntityManager runtime-independent of the fps module loading order.
      new (await import("../../games/fps/world/FPSPickup")).FPSPickup(`${id}_${Date.now()}`, scene, position, {
        id: def.id,
        modelPath: def.modelPath || "models/items/ammo/ammobox/ammobox.md3",
        type,
        value: (def as any).weaponId || (def as any).amount || def.id,
        scale: def.scale,
        gravity: options.gravity,
        glowColor: def.glowColor, // Pass glow color for pulsing light
        visualFactory,
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

    const type = pickupTypeOf(def, "weapon");
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
    // Match by the entity's RAW classname (extractPickups records the BSP
    // classname), not def.classname — a def can be reached via a classnameAlias
    // (e.g. "item_health" → HEALTH_MEDIUM), whose primary classname differs.
    const pickupEntry = this.pickupTable.find(
      (e) =>
        e.classname === data.classname &&
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

    // Health/armor render as procedural sculptures (falls back to modelPath if
    // the recipe/toggle declines). Weapons/ammo keep the MD3 model path.
    const visualFactory = await resolvePickupVisualFactory(def, type);

    // A weapon is drawn where its spawn toss comes to rest — the exact spot the
    // server's trigger and bot goals use. It is placed there and left there: a
    // floor raycast on top of that is a client-only guess which can disagree with
    // the server, and did, seating models below the floor where the trigger stayed.
    const landed = type === "weapon" ? this.landedPickups.find((e) => e.id === pickupId)?.position : undefined;
    const spawnAt = landed ? new Vector3(landed.x, landed.y, landed.z) : position;

    const pickup = new FPSPickup(name, scene, spawnAt, {
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
      visualFactory,
      yaw: type === "weapon" ? mapWeaponYaw(pickupId) : undefined,
      landedOnFloor: landed !== undefined,
    });

    // A map entity is not spawned until its visual construction has settled.
    // This makes entity processing an actual loader phase instead of detached
    // constructor work racing scene readiness/material finalization.
    await pickup.whenReady();

    // Register this pickup in local tracking (optional, Pickup handles its own logic now)
    this.entities.push({
      def,
      node: pickup,
      active: true,
    });

    return { handled: true, node: pickup };
  }

  /** Dispose every gameplay entity owned by the current map generation. */
  public disposeMapEntities(): void {
    for (const entity of this.entities) {
      try {
        entity.node?.dispose();
      } catch (e) {
        console.warn("[EntityManager] Failed to dispose map entity:", e);
      }
    }
    this.entities = [];
    this.pickupTable = [];
    this.landedPickups = [];
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
