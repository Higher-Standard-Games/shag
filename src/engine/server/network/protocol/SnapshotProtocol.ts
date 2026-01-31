/**
 * Snapshot Protocol
 * 
 * Encodes/decodes world state snapshots for network transmission.
 * Supports both full and delta snapshots.
 */

import { BinaryEncoder, BinaryDecoder } from './BinaryEncoder';
import { MessageType } from './MessageTypes';
import type { WorldState } from '../../core/WorldState';
import type { Entity } from '../../ecs/Entity';
import { EntityType, type EntityId, type TickNumber, entityId, tickNumber } from '../../ecs/types';

// ═══════════════════════════════════════════════════════════════════
// COMPONENT FLAGS (bitmask for which components are present)
// ═══════════════════════════════════════════════════════════════════

const COMP_TRANSFORM = 0x01;
const COMP_PHYSICS = 0x02;
const COMP_INPUT = 0x04;
const COMP_HEALTH = 0x08;

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT ENCODER
// ═══════════════════════════════════════════════════════════════════

export class SnapshotEncoder {
    private encoder: BinaryEncoder;

    constructor() {
        this.encoder = new BinaryEncoder(4096);
    }

    /**
     * Encode full snapshot (all entities)
     */
    encodeFullSnapshot(state: Readonly<WorldState>): Uint8Array {
        this.encoder.reset();

        // Header
        this.encoder.writeUint8(MessageType.S_FullSnapshot);
        this.encoder.writeUint32(state.tick as number);
        this.encoder.writeUint32(state.checksum());

        // Entity count
        this.encoder.writeVarUint(state.entityCount);

        // All entities
        for (const entity of state.allEntities()) {
            this.writeEntity(entity);
        }

        return this.encoder.toBytes();
    }

    /**
     * Encode delta snapshot (only changed entities)
     * 
     * @param current Current world state
     * @param baseline Previous state client has acknowledged
     */
    encodeDeltaSnapshot(
        current: WorldState,
        baseline: WorldState
    ): Uint8Array {
        this.encoder.reset();

        // Header
        this.encoder.writeUint8(MessageType.S_DeltaSnapshot);
        this.encoder.writeUint32(current.tick as number);
        this.encoder.writeUint32(baseline.tick as number);
        this.encoder.writeUint32(current.checksum());

        // Find changed, added, and removed entities
        const added: Entity[] = [];
        const changed: Entity[] = [];
        const removed: EntityId[] = [];

        // Check current entities
        for (const entity of current.allEntities()) {
            const oldEntity = baseline.getEntity(entity.id);
            if (!oldEntity) {
                added.push(entity as Entity);
            } else if (this.entityChanged(entity, oldEntity)) {
                changed.push(entity as Entity);
            }
        }

        // Check for removed entities
        for (const entity of baseline.allEntities()) {
            if (!current.hasEntity(entity.id)) {
                removed.push(entity.id);
            }
        }

        // Write counts
        this.encoder.writeVarUint(added.length);
        this.encoder.writeVarUint(changed.length);
        this.encoder.writeVarUint(removed.length);

        // Write entities
        for (const entity of added) {
            this.writeEntity(entity);
        }

        for (const entity of changed) {
            this.writeEntity(entity);
        }

        for (const id of removed) {
            this.encoder.writeVarUint(id as number);
        }

        return this.encoder.toBytes();
    }

    private writeEntity(entity: Readonly<Entity>): void {
        // Entity header
        this.encoder.writeVarUint(entity.id as number);
        this.encoder.writeUint8(this.entityTypeToId(entity.type));

        if (entity.ownerId !== undefined) {
            this.encoder.writeVarUint(entity.ownerId as number);
        } else {
            this.encoder.writeVarUint(0);
        }

        // Component flags
        let flags = 0;
        if (entity.transform) flags |= COMP_TRANSFORM;
        if (entity.physics) flags |= COMP_PHYSICS;
        if (entity.input) flags |= COMP_INPUT;
        if (entity.health) flags |= COMP_HEALTH;
        this.encoder.writeUint8(flags);

        // Components
        if (entity.transform) {
            this.encoder.writeQuantizedPos(
                entity.transform.position.x,
                entity.transform.position.y,
                entity.transform.position.z
            );
            this.encoder.writeQuantizedAngle(entity.transform.rotation.x);
            this.encoder.writeQuantizedAngle(entity.transform.rotation.y);
            this.encoder.writeQuantizedAngle(entity.transform.rotation.z);
        }

        if (entity.physics) {
            this.encoder.writeFloat32(entity.physics.velocity.x);
            this.encoder.writeFloat32(entity.physics.velocity.y);
            this.encoder.writeFloat32(entity.physics.velocity.z);
            this.encoder.writeUint8(
                (entity.physics.grounded ? 0x01 : 0) |
                (entity.physics.jumping ? 0x02 : 0)
            );
        }

        if (entity.input) {
            this.encoder.writeInt8(Math.round(entity.input.forward * 127));
            this.encoder.writeInt8(Math.round(entity.input.right * 127));
            this.encoder.writeFloat32(entity.input.pitch);
            this.encoder.writeFloat32(entity.input.yaw);
            this.encoder.writeUint8(
                (entity.input.jump ? 0x01 : 0) |
                (entity.input.crouch ? 0x02 : 0) |
                (entity.input.attack ? 0x04 : 0) |
                (entity.input.altAttack ? 0x08 : 0) |
                (entity.input.use ? 0x10 : 0)
            );
            this.encoder.writeUint8(entity.input.weaponSlot);
            this.encoder.writeUint32(entity.input.sequence);
        }

        if (entity.health) {
            this.encoder.writeUint8(entity.health.health);
            this.encoder.writeUint8(entity.health.armor);
            this.encoder.writeUint8(entity.health.dead ? 1 : 0);
        }
    }

    private entityTypeToId(type: EntityType): number {
        switch (type) {
            case EntityType.Player: return 1;
            case EntityType.Projectile: return 2;
            case EntityType.Item: return 3;
            case EntityType.Trigger: return 4;
            case EntityType.World: return 5;
            default: return 0;
        }
    }

    private entityChanged(a: Readonly<Entity>, b: Readonly<Entity>): boolean {
        // Quick position check
        if (a.transform && b.transform) {
            const dx = Math.abs(a.transform.position.x - b.transform.position.x);
            const dy = Math.abs(a.transform.position.y - b.transform.position.y);
            const dz = Math.abs(a.transform.position.z - b.transform.position.z);
            if (dx > 0.25 || dy > 0.25 || dz > 0.25) return true;
        }

        // Health check
        if (a.health && b.health) {
            if (a.health.health !== b.health.health) return true;
            if (a.health.armor !== b.health.armor) return true;
            if (a.health.dead !== b.health.dead) return true;
        }

        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT DECODER
// ═══════════════════════════════════════════════════════════════════

export interface DecodedSnapshot {
    tick: TickNumber;
    baselineTick?: TickNumber;
    checksum: number;
    entities: DecodedEntity[];
    removedIds: EntityId[];
}

export interface DecodedEntity {
    id: EntityId;
    type: EntityType;
    ownerId: number;
    transform?: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
    };
    physics?: {
        velocity: { x: number; y: number; z: number };
        grounded: boolean;
        jumping: boolean;
    };
    input?: {
        forward: number;
        right: number;
        pitch: number;
        yaw: number;
        jump: boolean;
        crouch: boolean;
        attack: boolean;
        altAttack: boolean;
        use: boolean;
        weaponSlot: number;
        sequence: number;
    };
    health?: {
        health: number;
        armor: number;
        dead: boolean;
    };
}

export class SnapshotDecoder {
    decode(bytes: Uint8Array): DecodedSnapshot {
        const decoder = new BinaryDecoder(bytes);

        const msgType = decoder.readUint8();

        if (msgType === MessageType.S_FullSnapshot) {
            return this.decodeFullSnapshot(decoder);
        } else if (msgType === MessageType.S_DeltaSnapshot) {
            return this.decodeDeltaSnapshot(decoder);
        }

        throw new Error(`Unknown message type: ${msgType}`);
    }

    private decodeFullSnapshot(decoder: BinaryDecoder): DecodedSnapshot {
        const tick = tickNumber(decoder.readUint32());
        const checksum = decoder.readUint32();
        const entityCount = decoder.readVarUint();

        const entities: DecodedEntity[] = [];
        for (let i = 0; i < entityCount; i++) {
            entities.push(this.readEntity(decoder));
        }

        return { tick, checksum, entities, removedIds: [] };
    }

    private decodeDeltaSnapshot(decoder: BinaryDecoder): DecodedSnapshot {
        const tick = tickNumber(decoder.readUint32());
        const baselineTick = tickNumber(decoder.readUint32());
        const checksum = decoder.readUint32();

        const addedCount = decoder.readVarUint();
        const changedCount = decoder.readVarUint();
        const removedCount = decoder.readVarUint();

        const entities: DecodedEntity[] = [];
        for (let i = 0; i < addedCount + changedCount; i++) {
            entities.push(this.readEntity(decoder));
        }

        const removedIds: EntityId[] = [];
        for (let i = 0; i < removedCount; i++) {
            removedIds.push(entityId(decoder.readVarUint()));
        }

        return { tick, baselineTick, checksum, entities, removedIds };
    }

    private readEntity(decoder: BinaryDecoder): DecodedEntity {
        const id = entityId(decoder.readVarUint());
        const typeId = decoder.readUint8();
        const ownerId = decoder.readVarUint();
        const flags = decoder.readUint8();

        const entity: DecodedEntity = {
            id,
            type: this.idToEntityType(typeId),
            ownerId,
        };

        if (flags & COMP_TRANSFORM) {
            const pos = decoder.readQuantizedPos();
            entity.transform = {
                position: pos,
                rotation: {
                    x: decoder.readQuantizedAngle(),
                    y: decoder.readQuantizedAngle(),
                    z: decoder.readQuantizedAngle(),
                },
            };
        }

        if (flags & COMP_PHYSICS) {
            const vx = decoder.readFloat32();
            const vy = decoder.readFloat32();
            const vz = decoder.readFloat32();
            const physFlags = decoder.readUint8();
            entity.physics = {
                velocity: { x: vx, y: vy, z: vz },
                grounded: (physFlags & 0x01) !== 0,
                jumping: (physFlags & 0x02) !== 0,
            };
        }

        if (flags & COMP_INPUT) {
            entity.input = {
                forward: decoder.readInt8() / 127,
                right: decoder.readInt8() / 127,
                pitch: decoder.readFloat32(),
                yaw: decoder.readFloat32(),
                jump: false, crouch: false, attack: false, altAttack: false, use: false,
                weaponSlot: 1,
                sequence: 0,
            };
            const inputFlags = decoder.readUint8();
            entity.input.jump = (inputFlags & 0x01) !== 0;
            entity.input.crouch = (inputFlags & 0x02) !== 0;
            entity.input.attack = (inputFlags & 0x04) !== 0;
            entity.input.altAttack = (inputFlags & 0x08) !== 0;
            entity.input.use = (inputFlags & 0x10) !== 0;
            entity.input.weaponSlot = decoder.readUint8();
            entity.input.sequence = decoder.readUint32();
        }

        if (flags & COMP_HEALTH) {
            entity.health = {
                health: decoder.readUint8(),
                armor: decoder.readUint8(),
                dead: decoder.readUint8() === 1,
            };
        }

        return entity;
    }

    private idToEntityType(id: number): EntityType {
        switch (id) {
            case 1: return EntityType.Player;
            case 2: return EntityType.Projectile;
            case 3: return EntityType.Item;
            case 4: return EntityType.Trigger;
            case 5: return EntityType.World;
            default: return EntityType.World;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════

export const snapshotEncoder = new SnapshotEncoder();
export const snapshotDecoder = new SnapshotDecoder();
