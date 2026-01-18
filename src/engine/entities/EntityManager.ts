/**
 * EntityManager - Manages game entities and their spawning
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import { EntityDef } from '../../shared/entities/EntityDef';
import { EntityRegistry } from '../../shared/entities/EntityRegistry';
import { EntityType } from '../../shared/entities/EntityType';
import { WeaponDef } from '../../shared/entities/WeaponDef';
import { EntityHandlerRegistry, EntityData, EntityHandlerResult } from '../core/EntityHandlerRegistry';
import { getMD3Loader } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';
import { InventoryManager } from '../game/InventoryManager';

export class EntityManager {
    private static instance: EntityManager;
    private entities: any[] = []; // TODO: ActiveEntity interface

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

        // Create minimal entity data for spawning
        const data: EntityData = {
            classname: def.classname || id,
            properties: {
                origin: `${position.x} ${position.z} ${position.y}`, // Mock origin prop
                targetname: `${id}_manual_${Date.now()}`
            }
        };

        try {
            // We reuse the internal logic, but we need to pass the position directly
            // effectively bypassing the "origin parsing" if we want, or just let it parse the mock string.
            // Actually, let's just create the pickup directly to avoid string parsing overhead if possible,
            // but for consistency with spawnEntity logic (which handles types/values), lets reuse it 
            // OR factor out the core creation.

            // Refactoring to expose core creation is cleaner. Use private createPickup logic.
            // We need to pass the options down.
            // Hack: modify data.properties to include gravity?
            // Or update spawnEntity signature.
            // Let's update spawnEntity logic to check for options from caller if possible, 
            // OR just add it to the Pickup creation directly inside spawnEntity.

            // To avoid changing private spawnEntity too much, we will cast/hack the data for now
            // or better, just create the Pickup directly here since we have the def.
            // ... Actually, spawnEntity does coordinate conversion which we might not want for "position" passed in.
            // But "position" passed in is already Babylon coords? 
            // Yes, from SpawnPickupCommand it's Babylon vector.
            // spawnEntity expects EntityData (quake coords usually).

            // Re-using spawnEntity is tricky if it expects Quake strings.
            // Let's duplicate the relevant small part or modify spawnEntity.
            // spawnEntity does: parse origin -> create Pickup.

            // DIRECT PICKUP CREATION for manual spawn is safer/cleaner:
            new (await import("../game/Pickup")).Pickup(id + "_" + Date.now(), scene, position, {
                id: def.id,
                modelPath: def.modelPath || 'models/items/ammo/ammobox/ammobox.md3',
                type: def.type === EntityType.WEAPON ? 'weapon' : 'ammo',
                value: (def as any).weaponId || (def as any).amount || def.id,
                scale: def.scale,
                gravity: options.gravity
            });

            return true;
        } catch (e) {
            console.error(`[EntityManager] Failed to manual spawn ${id}:`, e);
            return false;
        }
    }

    private getSceneOrThrow(): Scene {
        // Helper to get scene from one of the active entities or global engine if possible.
        // For now, look at existing entities or import EngineScene? 
        // Best is to assume if there are entities, we have a scene.
        // If not, we might be in trouble. 
        // Let's try to get it from the first entity or use a stored reference.
        // EntityManager doesn't currently store 'scene' globally.
        // It receives it in 'spawnEntity'.
        // We should probably store the scene reference in registerHandlers or getInstance?
        // Or cleaner: pass scene into spawnEntityById.

        // Correction: pass scene in.
        throw new Error("Scene access not implemented in spawnEntityById - Update signature");
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
            scale: def.scale || 1.0
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
        if (inventory.giveWeapon(entity.def.id)) {
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
