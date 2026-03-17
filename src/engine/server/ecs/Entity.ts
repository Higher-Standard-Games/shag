/**
 * Entity - Container for components
 * 
 * Uses direct properties for performance (not Map).
 * Supports COW (Copy-on-Write) via clone() method.
 */

import type { EntityId, PlayerId } from './types';
import { EntityType } from './types';
import type {
    TransformComponent,
    PhysicsComponent,
    InputComponent,
    HealthComponent,
} from '@shared/server/simulation/components';
import {
    cloneTransform,
    clonePhysics,
    cloneInput,
    cloneHealth,
} from '@shared/server/simulation/components';

export class Entity {
    // ═══════════════════════════════════════════════════════════════════
    // IDENTITY
    // ═══════════════════════════════════════════════════════════════════

    /** Unique entity ID */
    readonly id: EntityId;

    /** Entity type */
    readonly type: EntityType;

    /** Owner player ID (for player entities and owned projectiles) */
    ownerId?: PlayerId;

    // ═══════════════════════════════════════════════════════════════════
    // COMPONENTS (direct properties for performance)
    // ═══════════════════════════════════════════════════════════════════

    /** Position and rotation */
    transform?: TransformComponent;

    /** Velocity and movement state */
    physics?: PhysicsComponent;

    /** Player input state */
    input?: InputComponent;

    /** Health and armor */
    health?: HealthComponent;

    /** Optional metadata for item entities (weaponId, ammo count) */
    metadata?: { weaponId: string; ammo?: number };

    /**
     * Tick when this entity was spawned/respawned.
     * Physics is frozen for SPAWN_FREEZE_TICKS after this tick to
     * ensure the first snapshots contain the correct spawn position.
     */
    spawnTick: number = 0;

    // Future components:
    // weapon?: WeaponComponent;
    // inventory?: InventoryComponent;
    // ai?: AIComponent;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor(id: EntityId, type: EntityType) {
        this.id = id;
        this.type = type;
    }

    // ═══════════════════════════════════════════════════════════════════
    // COW SUPPORT
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Clone this entity (deep copy of all components)
     * Used by COW when an entity is modified
     */
    clone(): Entity {
        const cloned = new Entity(this.id, this.type);
        cloned.ownerId = this.ownerId;
        cloned.spawnTick = this.spawnTick;
        if (this.metadata) cloned.metadata = { ...this.metadata };

        // Clone each component if present
        if (this.transform) cloned.transform = cloneTransform(this.transform);
        if (this.physics) cloned.physics = clonePhysics(this.physics);
        if (this.input) cloned.input = cloneInput(this.input);
        if (this.health) cloned.health = cloneHealth(this.health);

        return cloned;
    }

    // ═══════════════════════════════════════════════════════════════════
    // COMPONENT HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /** Check if entity has all required components for physics simulation */
    hasPhysicsComponents(): boolean {
        return this.transform !== undefined && this.physics !== undefined;
    }

    /** Check if entity is a player */
    isPlayer(): boolean {
        return this.type === EntityType.Player;
    }

    /** Check if entity is alive (has health and not dead) */
    isAlive(): boolean {
        return this.health !== undefined && !this.health.dead;
    }
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

import {
    createTransform,
    createPhysics,
    createInput,
    createHealth,
} from '@shared/server/simulation/components';

/**
 * Create a new player entity with all required components
 */
export function createPlayerEntity(
    id: EntityId,
    playerId: PlayerId,
    spawnPosition: { x: number; y: number; z: number }
): Entity {
    const entity = new Entity(id, EntityType.Player);
    entity.ownerId = playerId;
    entity.transform = createTransform(spawnPosition);
    entity.physics = createPhysics();
    entity.input = createInput();
    entity.health = createHealth();
    return entity;
}

/**
 * Create a projectile entity
 */
export function createProjectileEntity(
    id: EntityId,
    ownerId: PlayerId,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number }
): Entity {
    const entity = new Entity(id, EntityType.Projectile);
    entity.ownerId = ownerId;
    entity.transform = createTransform(position);
    entity.physics = {
        velocity,
        angularVelocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        jumping: false,
        isSliding: false,
        isCrouching: false,
        crouchViewOffset: 0,
        wallJumpState: 'none',
        ledgeGrabState: 'none',
        actualHorizSpeed: 0,
    };
    return entity;
}

/**
 * Create a dropped weapon entity (world item) with optional toss velocity
 */
export function createDroppedWeaponEntity(
    id: EntityId,
    position: { x: number; y: number; z: number },
    velocity?: { x: number; y: number; z: number },
    weaponId?: string,
): Entity {
    const entity = new Entity(id, EntityType.Item);
    entity.transform = createTransform(position);
    if (weaponId) entity.metadata = { weaponId };
    if (velocity) {
        entity.physics = {
            velocity,
            angularVelocity: { x: 0, y: 0, z: 0 },
            grounded: false,
            jumping: false,
            isSliding: false,
            isCrouching: false,
            crouchViewOffset: 0,
            wallJumpState: 'none',
            ledgeGrabState: 'none',
            actualHorizSpeed: 0,
        };
    }
    return entity;
}
