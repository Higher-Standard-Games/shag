/**
 * EntityManager - Manages game entities and their spawning
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { EntityDef } from '../../shared/entities/EntityDef';
import { EntityRegistry } from '../../shared/entities/EntityRegistry';
import { EntityType } from '../../shared/entities/EntityType';
import { EntityHandlerRegistry, EntityData, EntityHandlerResult } from '../core/EntityHandlerRegistry';
import { InventoryManager } from '../game/InventoryManager';

export class EntityManager {
    private static instance: EntityManager;
    private entities: any[] = []; // TODO: ActiveEntity interface
    /** Sequential counter for BSP weapon pickup IDs — must match server's PickupSystem.setPickupItems() ordering */
    private nextPickupId: number = 0;

    private constructor() { }

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

        console.log(`[EntityManager] Registering handlers for ${weapons.length} weapons and ${ammo.length} ammo types...`);

        // Register All Items
        const allItems = [...weapons, ...ammo];

        for (const item of allItems) {
            if (item.classname) {
                EntityHandlerRegistry.register(item.classname, (data, scene) =>
                    this.spawnEntity(item, data, scene)
                );
            }
        }
    }

    /**
     * Spawn an entity by its registry ID (e.g. from console)
     */
    public async spawnEntityById(id: string, position: Vector3, scene: Scene, options: { gravity?: boolean } = {}): Promise<boolean> {
        const registry = EntityRegistry.getInstance();
        let def = registry.get(id);

        // Fallback: Try looking up by classname (e.g. 'weapon_plasmagun')
        if (!def) {
            def = registry.getByClassname(id);
        }

        if (!def) {
            console.error(`[EntityManager] Entity definition not found: ${id}`);
            // Log available IDs for help
            console.log(`[EntityManager] Available IDs: ${registry.getAllIds().join(', ')}`);
            return false;
        }

        console.log(`[EntityManager] Manually spawning ${id} at ${position}`);

        try {
            // DIRECT PICKUP CREATION for manual spawn is safer/cleaner:
            new (await import("../game/Pickup")).Pickup(id + "_" + Date.now(), scene, position, {
                id: def.id,
                modelPath: def.modelPath || 'models/items/ammo/ammobox/ammobox.md3',
                type: def.type === EntityType.WEAPON ? 'weapon' : 'ammo',
                value: (def as any).weaponId || (def as any).amount || def.id,
                scale: def.scale,
                gravity: options.gravity,
                glowColor: def.glowColor  // Pass glow color for pulsing light
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
            const parts = originStr.split(' ').map(parseFloat);
            if (parts.length === 3) {
                // Swap Y/Z for Babylon (Quake: X, Y, Z -> Babylon: X, Z, Y)
                // Add +24 to Y to prevent floor clipping
                position = new Vector3(parts[0], parts[2] + 24, parts[1]);
            }
        }

        console.log(`[EntityManager] Spawning ${def.name} at ${position}`);

        // Dynamically import Pickup to avoid circular deps
        const { Pickup } = await import('../game/Pickup');

        // Create Pickup instance
        // Naming: Use targetname if available, otherwise classname
        const name = data.properties.targetname || `${def.classname || 'item'}_${Date.now()}`;

        const type = def.type === EntityType.AMMO ? 'ammo' : 'weapon';
        let value: string | number = def.id;

        // For ammo, we might need specific property if it differs from ID
        // But commonly ID is used or a specific subtype. 
        // We'll rely on passing `def` properties if needed or stick to ID.
        if (type === 'ammo' && (def as any).ammoType) {
            value = (def as any).ammoType;
        }

        const pickup = new Pickup(name, scene, position, {
            id: def.id,
            modelPath: def.modelPath || 'models/items/ammo/ammobox/ammobox.md3', // Fallback
            type: type,
            value: value,
            respawnTime: 30, // Default 30s
            scale: def.scale || 1.0,
            glowColor: def.glowColor, // Pass glow color from definition
            // Assign sequential pickup ID for weapons (must match server PickupSystem ordering)
            pickupId: type === 'weapon' ? this.nextPickupId++ : undefined,
        });

        // Register this pickup in local tracking (optional, Pickup handles its own logic now)
        this.entities.push({
            def,
            node: pickup,
            active: true
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
            if (dist < 40) { // 32 + player radius approximation
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
