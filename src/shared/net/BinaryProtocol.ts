/**
 * BinaryProtocol.ts - Network State Serialization
 *
 * This handles encoding game state into compact binary format for network transmission.
 * Binary is used instead of JSON because:
 * 1. Much smaller packet sizes (important at 20-60 snapshots/second)
 * 2. Faster to encode/decode (no string parsing)
 * 3. Predictable memory layout
 *
 * DELTA COMPRESSION:
 * Instead of sending full state every time, we compare to a "baseline" (previous acked
 * snapshot) and only send what changed. This dramatically reduces bandwidth.
 *
 * Example: Player moves from (100, 50, 200) to (101, 50, 200)
 * - Without delta: Send all 3 floats = 12 bytes
 * - With delta: Send flag (0x01) + 3 floats = 13 bytes (worse for single change)
 * - BUT if position unchanged: Send flag (0x00) = 1 byte (much better!)
 *
 * COMPONENT FLAGS:
 * - 0x01 = position changed (12 bytes: 3 floats)
 * - 0x02 = velocity changed (12 bytes: 3 floats)
 * - 0x04 = grounded state changed (1 byte: boolean) - CRITICAL for jump logic!
 * - 0x08 = rotation changed (8 bytes: 2 floats — yaw + pitch)
 * - 0x10 = movement state changed (1 byte: bit 0=crouching, bit 1=sliding, bit 2=wallJumping)
 * - 0x20 = weaponMeta changed (string + 1 byte — for item_ entities)
 */

import { Entity } from "./Entity";
import { GameState } from "./GameState";

// ── Component shape types for binary serialization ──
// These describe the shapes that getComponent() returns.
// The component system is untyped (string keys → IComponent), so we define
// the structural shapes used during encode/decode.

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Shape interfaces below satisfy the IComponent contract (engine/network/core/Component.ts).
// serialize/deserialize/clone are required so the decoder can pass constructed
// components straight to entity.addComponent without `as IComponent` casts.
interface PositionShape extends Vec3 {
  serialize(encoder: BinaryEncoder): void;
  deserialize(decoder: BinaryDecoder): void;
  clone(): PositionShape;
}

interface TransformShape {
  position: Vec3;
  rotation: Vec4;
  serialize(encoder: BinaryEncoder): void;
  deserialize(decoder: BinaryDecoder): void;
  clone(): TransformShape;
}

interface VelocityShape {
  x: number;
  y: number;
  z: number;
  linear: Vec3;
  angular: Vec3;
  grounded: boolean;
  isCrouching?: boolean;
  isSliding?: boolean;
  serialize(encoder: BinaryEncoder): void;
  deserialize(decoder: BinaryDecoder): void;
  clone(): VelocityShape;
}

interface MovementStateShape {
  isCrouching: boolean;
  isSliding: boolean;
  wallJumpState: string;
}

interface WeaponMetaShape {
  weaponId: string;
  settled: boolean;
}

/**
 * Wire-format command shape for binary encode/decode.
 * Matches MoveCommand fields used over the network.
 */
export interface NetworkCommand {
  type?: string;
  playerId?: string;
  tick?: number;
  seq?: number;
  direction?: { x: number; y: number; z: number };
  pitch?: number;
  yaw?: number;
  buttons?: number;
  weaponSlot?: number;
}

// Module-level reusable encoder — avoids 16KB allocation per encode call.
// getData() copies to a fresh Uint8Array, so previously returned data is safe.
let _sharedEncoder: BinaryEncoder | null = null;
function getEncoder(): BinaryEncoder {
  if (!_sharedEncoder) _sharedEncoder = new BinaryEncoder();
  _sharedEncoder.reset();
  return _sharedEncoder;
}

// ── Shared component stubs (hoisted to avoid per-entity closure allocations) ──
// These are referenced by every decoded entity/player. Defining once at module
// scope eliminates ~600+ function object allocations per second during gameplay.
// Signatures match IComponent.serialize/deserialize; bodies are intentionally
// empty — these stubs are attached to decoded components and never invoked
// (the encoder/decoder reads fields directly, never calls these methods).
function _noopSerialize(_encoder: BinaryEncoder): void {}
function _noopDeserialize(_decoder: BinaryDecoder): void {}
// biome-ignore lint/suspicious/noExplicitAny: clone functions use `this` binding for shallow copy of arbitrary component shapes
function _shallowClone(this: any) {
  return { ...this };
}
// biome-ignore lint/suspicious/noExplicitAny: clone functions use `this` binding for deep copy of transform shape
function _transformClone(this: any) {
  return {
    position: { ...this.position },
    rotation: { ...this.rotation },
    serialize: _noopSerialize,
    deserialize: _noopDeserialize,
    clone: _transformClone,
  };
}
// biome-ignore lint/suspicious/noExplicitAny: clone functions use `this` binding for deep copy of velocity shape
function _velocityClone(this: any) {
  return { ...this, linear: { ...this.linear }, angular: { ...this.angular } };
}

/**
 * Binary protocol for network messages.
 * Handles encoding/decoding of game state with delta compression.
 */
export class BinaryProtocol {
  /**
   * Encode a snapshot with delta compression
   */
  static encodeSnapshot(state: GameState, baseline?: GameState): Uint8Array {
    const encoder = getEncoder();

    // Write header
    encoder.writeUint32(state.tick);
    // Use full 64-bit timestamp for ClockSync compatibility
    encoder.writeFloat64(Date.now());
    // CRITICAL: ackedInputSeq for client-side reconciliation (V2NetworkClient)
    encoder.writeUint32(state.ackedInputSeq);

    // Encode ALL entities with delta-compressed components
    // Note: This is "full state with delta content" model - every entity is included,
    // but unchanged component values are omitted. Removals are implicit (missing = removed).
    BinaryProtocol.encodeEntities(encoder, state, baseline);

    // Encode players with delta
    BinaryProtocol.encodePlayers(encoder, state, baseline);

    // Encode events (no delta)
    BinaryProtocol.encodeEvents(encoder, state);

    // Encode the pickup active-set (no delta — full mask every snapshot so the
    // client converges and self-heals against packet loss).
    BinaryProtocol.encodePickupState(encoder, state);

    return encoder.getData();
  }

  /**
   * Decode a snapshot with delta reconstruction
   */
  static decodeSnapshot(data: Uint8Array, baseline?: GameState): GameState {
    const decoder = new BinaryDecoder(data);

    const state = new GameState();

    // Read header
    state.tick = decoder.readUint32();
    state.serverTimestamp = decoder.readFloat64(); // Server Date.now() for ClockSync
    state.ackedInputSeq = decoder.readUint32(); // For V2NetworkClient reconciliation

    // Decode entities
    BinaryProtocol.decodeEntities(decoder, state, baseline);

    // Decode players
    BinaryProtocol.decodePlayers(decoder, state, baseline);

    // Decode events
    BinaryProtocol.decodeEvents(decoder, state);

    // Decode the pickup active-set, if present (older payloads/demos omit it).
    if (decoder.hasMore()) {
      BinaryProtocol.decodePickupState(decoder, state);
    }

    return state;
  }

  /**
   * Encode the pickup active-set: a uint16 count followed by a packed bitmask
   * (bit i = pickup id i is active). Full every snapshot — no delta.
   */
  private static encodePickupState(encoder: BinaryEncoder, state: GameState): void {
    const mask = state.pickupActiveMask;
    const count = mask.length;
    encoder.writeUint16(count);
    if (count === 0) return;

    const byteCount = Math.ceil(count / 8);
    for (let b = 0; b < byteCount; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const idx = b * 8 + bit;
        if (idx < count && mask[idx]) byte |= 1 << bit;
      }
      encoder.writeUint8(byte);
    }
  }

  private static decodePickupState(decoder: BinaryDecoder, state: GameState): void {
    const count = decoder.readUint16();
    const mask: boolean[] = new Array(count);
    if (count === 0) {
      state.pickupActiveMask = mask;
      return;
    }

    const byteCount = Math.ceil(count / 8);
    for (let b = 0; b < byteCount; b++) {
      const byte = decoder.readUint8();
      for (let bit = 0; bit < 8; bit++) {
        const idx = b * 8 + bit;
        if (idx < count) mask[idx] = (byte & (1 << bit)) !== 0;
      }
    }
    state.pickupActiveMask = mask;
  }

  /**
   * Encode a command
   */
  static encodeCommand(playerId: string, sequence: number, command: NetworkCommand): Uint8Array {
    const encoder = getEncoder();

    encoder.writeString(playerId);
    encoder.writeUint32(sequence);

    // Binary-encode the command fields instead of JSON.stringify.
    // MoveCommand shape: type, playerId, tick, seq, direction{x,y,z}, pitch, yaw, buttons, weaponSlot
    const dir = command.direction || { x: 0, y: 0, z: 0 };
    encoder.writeFloat32(dir.x);
    encoder.writeFloat32(dir.y);
    encoder.writeFloat32(dir.z);
    encoder.writeFloat32(command.pitch ?? 0);
    encoder.writeFloat32(command.yaw ?? 0);
    encoder.writeUint16(command.buttons ?? 0);
    encoder.writeUint32(command.tick ?? 0);
    encoder.writeUint8(command.weaponSlot ?? 0);

    return encoder.getData();
  }

  /**
   * Decode a command
   */
  static decodeCommand(data: Uint8Array): { playerId: string; sequence: number; command: NetworkCommand } {
    const decoder = new BinaryDecoder(data);

    const playerId = decoder.readString();
    const sequence = decoder.readUint32();

    // Binary-decode matching the encode layout above
    const command = {
      type: "move" as const,
      playerId,
      seq: sequence,
      direction: {
        x: decoder.readFloat32(),
        y: decoder.readFloat32(),
        z: decoder.readFloat32(),
      },
      pitch: decoder.readFloat32(),
      yaw: decoder.readFloat32(),
      buttons: decoder.readUint16(),
      tick: decoder.readUint32(),
      weaponSlot: decoder.readUint8(),
    };

    return { playerId, sequence, command };
  }

  /**
   * Encode all entities with delta compression on component values.
   * Uses flags to indicate which components changed vs baseline.
   */
  private static encodeEntities(encoder: BinaryEncoder, state: GameState, baseline?: GameState): void {
    const baselineEntities = baseline?.entities || new Map();

    encoder.writeUint16(state.entities.size);

    for (const [entityId, entity] of state.entities) {
      const baselineEntity = baselineEntities.get(entityId);

      encoder.writeString(entityId);

      // Component flags
      let flags = 0;

      // Check for transform component (FPS style) or position component (legacy)
      const transform = entity.getComponent("transform") as unknown as TransformShape | undefined;
      const pos = transform?.position || (entity.getComponent("position") as unknown as PositionShape | undefined);
      const baselineTransform = baselineEntity?.getComponent("transform") as unknown as TransformShape | undefined;
      const baselinePos =
        baselineTransform?.position ||
        (baselineEntity?.getComponent("position") as unknown as PositionShape | undefined);
      // Only set flag if pos EXISTS and differs from baseline (or no baseline)
      if (pos && (!baselinePos || pos.x !== baselinePos.x || pos.y !== baselinePos.y || pos.z !== baselinePos.z)) {
        flags |= 0x01;
      }

      const vel = entity.getComponent("velocity") as unknown as VelocityShape | undefined;
      const baselineVel = baselineEntity?.getComponent("velocity") as unknown as VelocityShape | undefined;
      // Check velocity.linear for VelocityComponent or direct x/y/z for basic
      const velData = vel?.linear || vel;
      const baselineVelData = baselineVel?.linear || baselineVel;
      // Only set flag if velData EXISTS and differs from baseline (or no baseline)
      if (
        velData &&
        (!baselineVelData ||
          velData.x !== baselineVelData.x ||
          velData.y !== baselineVelData.y ||
          velData.z !== baselineVelData.z)
      ) {
        flags |= 0x02;
      }

      // Check grounded state - CRITICAL for jump logic!
      // Without this, client doesn't know if player can jump
      const grounded = vel?.grounded ?? false;
      const baselineGrounded = baselineVel?.grounded ?? false;
      if (grounded !== baselineGrounded) {
        flags |= 0x04;
      }

      // Check rotation (yaw + pitch) for remote player aiming direction
      const rot = transform?.rotation;
      const baselineRot = baselineTransform?.rotation;
      if (rot && (!baselineRot || rot.y !== baselineRot.y || rot.x !== baselineRot.x)) {
        flags |= 0x08;
      }

      // Always send movement state (crouch/slide/walljump) — no delta compression.
      // Only 1 byte per entity. Delta compression here is fragile because
      // server/client baseline ACK mismatches can cause flags to get "stuck".
      const movState = entity.getComponent("movementState") as unknown as MovementStateShape | undefined;
      const isCrouching = movState?.isCrouching ?? false;
      const isSliding = movState?.isSliding ?? false;
      const wallJumpState = movState?.wallJumpState ?? "none";
      const isWallJumping = wallJumpState === "charging";
      if (movState) {
        flags |= 0x10;
      }

      // Check weaponMeta (item_ entities carry weaponId for model spawning)
      const weaponMeta = entity.getComponent("weaponMeta") as unknown as WeaponMetaShape | undefined;
      const baselineWeaponMeta = baselineEntity?.getComponent("weaponMeta") as unknown as WeaponMetaShape | undefined;
      if (
        weaponMeta?.weaponId &&
        (!baselineWeaponMeta ||
          weaponMeta.weaponId !== baselineWeaponMeta.weaponId ||
          weaponMeta.settled !== baselineWeaponMeta.settled)
      ) {
        flags |= 0x20;
      }

      encoder.writeUint8(flags);

      // Encode changed components
      // Flag 0x01: Position (12 bytes - 3 floats)
      if ((flags & 0x01) && pos) {
        encoder.writeFloat32(pos.x);
        encoder.writeFloat32(pos.y);
        encoder.writeFloat32(pos.z);
      }

      // Flag 0x02: Velocity (12 bytes - 3 floats)
      if ((flags & 0x02) && velData) {
        encoder.writeFloat32(velData.x);
        encoder.writeFloat32(velData.y);
        encoder.writeFloat32(velData.z);
      }

      // Flag 0x04: Grounded state (1 byte - boolean)
      if (flags & 0x04) {
        encoder.writeUint8(grounded ? 1 : 0);
      }

      // Flag 0x08: Rotation (8 bytes - 2 floats: yaw, pitch)
      if ((flags & 0x08) && rot) {
        encoder.writeFloat32(rot.y); // yaw
        encoder.writeFloat32(rot.x); // pitch
      }

      // Flag 0x10: Movement state (1 byte - bit 0=crouching, bit 1=sliding, bit 2=wallJumping)
      if (flags & 0x10) {
        let movFlags = 0;
        if (isCrouching) movFlags |= 1;
        if (isSliding) movFlags |= 2;
        if (isWallJumping) movFlags |= 4;
        encoder.writeUint8(movFlags);
      }

      // Flag 0x20: WeaponMeta (string weaponId + 1 byte settled)
      if ((flags & 0x20) && weaponMeta) {
        encoder.writeString(weaponMeta.weaponId);
        encoder.writeUint8(weaponMeta.settled ? 1 : 0);
      }
    }
  }

  private static decodeEntities(decoder: BinaryDecoder, state: GameState, baseline?: GameState): void {
    const baselineEntities = baseline?.entities || new Map();
    const entityCount = decoder.readUint16();

    for (let i = 0; i < entityCount; i++) {
      const entityId = decoder.readString();
      const flags = decoder.readUint8();

      let entity = state.entities.get(entityId);
      if (!entity) {
        entity = new Entity(entityId);
        state.entities.set(entityId, entity);
      }

      const baselineEntity = baselineEntities.get(entityId);

      // Decode components
      // Note: We add BOTH 'position' and 'transform' components for compatibility
      // Some code looks for 'position', other code (Game) looks for 'transform.position'
      if (flags & 0x01) {
        const x = decoder.readFloat32();
        const y = decoder.readFloat32();
        const z = decoder.readFloat32();

        // Legacy position component
        const pos = {
          x,
          y,
          z,
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _shallowClone,
        };
        entity.addComponent("position", pos);

        // Preserve existing rotation if transform already exists (rotation may arrive independently)
        // Fall back to baseline rotation if entity was just created fresh
        const existingTransform = entity.getComponent("transform") as unknown as TransformShape | undefined;
        const baselineTransformRot = baselineEntity?.getComponent("transform") as unknown as TransformShape | undefined;
        const existingRot = existingTransform?.rotation || baselineTransformRot?.rotation || { x: 0, y: 0, z: 0, w: 1 };

        // TransformComponent-style for Game compatibility
        const transform = {
          position: { x, y, z },
          rotation: { ...existingRot },
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _transformClone,
        };
        entity.addComponent("transform", transform);
      } else if (baselineEntity) {
        const baselinePos = baselineEntity.getComponent("position");
        if (baselinePos) {
          entity.addComponent("position", baselinePos);
        }
        const baselineTransform = baselineEntity.getComponent("transform");
        if (baselineTransform) {
          entity.addComponent("transform", baselineTransform);
        }
      }

      // Decode velocity (flag 0x02) and grounded (flag 0x04)
      // These are related - grounded affects whether player can jump
      let velX = 0,
        velY = 0,
        velZ = 0;
      let grounded = false;
      let hasVelocityData = false;

      // Always preserve baseline grounded (overridden below if flag 0x04 is set)
      if (baselineEntity) {
        const baselineVel = baselineEntity.getComponent("velocity") as unknown as VelocityShape | undefined;
        if (baselineVel) {
          grounded = baselineVel.grounded ?? false;
        }
      }

      if (flags & 0x02) {
        // Velocity changed - read new values
        velX = decoder.readFloat32();
        velY = decoder.readFloat32();
        velZ = decoder.readFloat32();
        hasVelocityData = true;
      } else if (baselineEntity) {
        // Velocity unchanged - use baseline
        const baselineVel = baselineEntity.getComponent("velocity") as unknown as VelocityShape | undefined;
        if (baselineVel?.linear) {
          velX = baselineVel.linear.x;
          velY = baselineVel.linear.y;
          velZ = baselineVel.linear.z;
          hasVelocityData = true;
        }
      }

      if (flags & 0x04) {
        // Grounded state changed - read new value
        // This is CRITICAL for jump logic - client needs to know if player is on ground!
        grounded = decoder.readUint8() !== 0;
      }

      // Flag 0x08: Rotation (yaw + pitch)
      if (flags & 0x08) {
        const rotY = decoder.readFloat32(); // yaw
        const rotX = decoder.readFloat32(); // pitch

        // Update transform rotation (create transform if it doesn't exist)
        let transform = entity.getComponent("transform") as unknown as
          | (TransformShape & Record<string, unknown>)
          | undefined;
        if (transform) {
          transform.rotation = { x: rotX, y: rotY, z: 0, w: 1 };
        } else {
          // No position yet, create transform with zero position + received rotation
          transform = {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: rotX, y: rotY, z: 0, w: 1 },
            serialize: _noopSerialize,
            deserialize: _noopDeserialize,
            clone: _transformClone,
          };
          entity.addComponent("transform", transform);
        }
      }

      // Flag 0x10: Movement state (crouch/slide/walljump)
      let isCrouching = false;
      let isSliding = false;
      let isWallJumping = false;
      if (flags & 0x10) {
        const movFlags = decoder.readUint8();
        isCrouching = (movFlags & 1) !== 0;
        isSliding = (movFlags & 2) !== 0;
        isWallJumping = (movFlags & 4) !== 0;
      } else if (baselineEntity) {
        // Carry forward from baseline
        const baselineMovState = baselineEntity.getComponent("movementState") as unknown as
          | MovementStateShape
          | undefined;
        isCrouching = baselineMovState?.isCrouching ?? false;
        isSliding = baselineMovState?.isSliding ?? false;
        isWallJumping = baselineMovState?.wallJumpState === "charging";
      }

      // Create velocity component if we have data
      if (hasVelocityData || flags & 0x04 || flags & 0x10) {
        const vel = {
          x: velX,
          y: velY,
          z: velZ, // Legacy direct access
          linear: { x: velX, y: velY, z: velZ }, // Game expects velocity.linear
          angular: { x: 0, y: 0, z: 0 },
          grounded, // Now properly transmitted!
          isCrouching,
          isSliding,
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _velocityClone,
        };
        entity.addComponent("velocity", vel);

        // Also create a movementState component so RemotePlayerRenderer.pushSnapshot()
        // can find isCrouching/isSliding via entity.getComponent('movementState').
        // The encoder reads from 'movementState' on the server, so we reconstruct it here.
        entity.addComponent("movementState", {
          isCrouching,
          isSliding,
          wallJumpState: isWallJumping ? "charging" : "none",
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _shallowClone,
        });
      }

      // Flag 0x20: WeaponMeta (weaponId + settled) for item_ entities
      if (flags & 0x20) {
        const weaponId = decoder.readString();
        const settled = decoder.readUint8() !== 0;
        entity.addComponent("weaponMeta", {
          weaponId,
          settled,
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _shallowClone,
        });
      } else if (baselineEntity) {
        // Carry forward from baseline
        const baselineMeta = baselineEntity.getComponent("weaponMeta");
        if (baselineMeta) {
          entity.addComponent("weaponMeta", baselineMeta);
        }
      }
    }
  }

  private static encodePlayers(encoder: BinaryEncoder, state: GameState, baseline?: GameState): void {
    const baselinePlayers = baseline?.players || new Map();

    encoder.writeUint16(state.players.size);

    for (const [playerId, player] of state.players) {
      const baselinePlayer = baselinePlayers.get(playerId);

      encoder.writeString(playerId);

      // Player flags
      let flags = 0;
      if (!baselinePlayer || player.entityId !== baselinePlayer.entityId) flags |= 0x01;
      if (!baselinePlayer || player.name !== baselinePlayer.name) flags |= 0x02;
      if (!baselinePlayer || player.score !== baselinePlayer.score) flags |= 0x04;
      if (!baselinePlayer || player.deaths !== baselinePlayer.deaths) flags |= 0x08;
      if (!baselinePlayer || player.ping !== baselinePlayer.ping) flags |= 0x10;
      if (!baselinePlayer || player.team !== baselinePlayer.team) flags |= 0x20;

      encoder.writeUint8(flags);

      // Encode changed fields
      if (flags & 0x01) encoder.writeString(player.entityId);
      if (flags & 0x02) encoder.writeString(player.name);
      if (flags & 0x04) encoder.writeInt32(player.score);
      if (flags & 0x08) encoder.writeUint32(player.deaths);
      if (flags & 0x10) encoder.writeUint16(player.ping);
      if (flags & 0x20) encoder.writeString(player.team);
    }
  }

  private static decodePlayers(decoder: BinaryDecoder, state: GameState, baseline?: GameState): void {
    const baselinePlayers = baseline?.players || new Map();
    const playerCount = decoder.readUint16();

    for (let i = 0; i < playerCount; i++) {
      const playerId = decoder.readString();
      const flags = decoder.readUint8();

      let player = state.players.get(playerId);
      if (!player) {
        const newPlayer = {
          entityId: "",
          name: "",
          team: "",
          score: 0,
          deaths: 0,
          ping: 0,
          serialize: _noopSerialize,
          deserialize: _noopDeserialize,
          clone: _shallowClone,
        };
        state.players.set(playerId, newPlayer);
        player = newPlayer;
      }

      const baselinePlayer = baselinePlayers.get(playerId);

      // Decode fields
      if (flags & 0x01) {
        player!.entityId = decoder.readString();
      } else if (baselinePlayer) {
        player!.entityId = baselinePlayer.entityId;
      }

      if (flags & 0x02) {
        player!.name = decoder.readString();
      } else if (baselinePlayer) {
        player!.name = baselinePlayer.name;
      }

      if (flags & 0x04) {
        player!.score = decoder.readInt32();
      } else if (baselinePlayer) {
        player!.score = baselinePlayer.score;
      }

      if (flags & 0x08) {
        player!.deaths = decoder.readUint32();
      } else if (baselinePlayer) {
        player!.deaths = baselinePlayer.deaths;
      }

      if (flags & 0x10) {
        player!.ping = decoder.readUint16();
      } else if (baselinePlayer) {
        player!.ping = baselinePlayer.ping;
      }

      if (flags & 0x20) {
        player!.team = decoder.readString();
      } else if (baselinePlayer) {
        player!.team = baselinePlayer.team;
      }
    }
  }

  // ── Event type codes for binary encoding ──
  // All event types are known — no JSON fallback needed.
  private static readonly EVT_TYPE_MAP: Record<string, number> = {
    combat_state: 1,
    match_state: 2,
    weapon_state: 3,
    weapon_fire: 4,
    weapon_charge: 5,
    projectile_spawn: 6,
    projectile_impact: 7,
    item_pickup: 8,
    weapon_drop: 9,
    damage: 10,
    death: 11,
    award: 12,
    weapon_chain: 13,
    chat: 14,
    pickup_notify: 15,
    voltaic_beam: 16,
    electro_rail: 17,
  };

  private static readonly EVT_NAME_MAP: string[] = [
    "",
    "combat_state",
    "match_state",
    "weapon_state",
    "weapon_fire",
    "weapon_charge",
    "projectile_spawn",
    "projectile_impact",
    "item_pickup",
    "weapon_drop",
    "damage",
    "death",
    "award",
    "weapon_chain",
    "chat",
    "pickup_notify",
    "voltaic_beam",
    "electro_rail",
  ];

  private static encodeEvents(encoder: BinaryEncoder, state: GameState): void {
    encoder.writeUint16(state.events.length);

    for (const event of state.events) {
      const typeCode = BinaryProtocol.EVT_TYPE_MAP[event.type];
      encoder.writeUint8(typeCode);

      switch (typeCode) {
        case 1: // combat_state: entityId, health, armor, dead
          encoder.writeString(event.entityId);
          encoder.writeUint16(event.health ?? 0);
          encoder.writeUint16(event.armor ?? 0);
          encoder.writeUint8(event.dead ? 1 : 0);
          break;

        case 2: // match_state — variable shape, use JSON (sent once per snapshot)
          encoder.writeString(JSON.stringify(event));
          break;

        case 3: // weapon_state: entityId, currentWeapon, weapons[], ammo{}, reloading, lastFireTick
          encoder.writeString(event.entityId);
          encoder.writeString(event.currentWeapon ?? "");
          // weapons array as JSON (variable-length array of strings)
          encoder.writeString(JSON.stringify(event.weapons ?? []));
          // ammo as JSON (variable-length object)
          encoder.writeString(JSON.stringify(event.ammo ?? {}));
          encoder.writeUint8(event.reloading ? 1 : 0);
          encoder.writeUint32(event.lastFireTick ?? 0);
          break;

        case 4: // weapon_fire: entityId, weaponId, origin xyz, dir xyz
          encoder.writeString(event.entityId);
          encoder.writeString(event.weaponId ?? "");
          encoder.writeFloat32(event.originX ?? 0);
          encoder.writeFloat32(event.originY ?? 0);
          encoder.writeFloat32(event.originZ ?? 0);
          encoder.writeFloat32(event.dirX ?? 0);
          encoder.writeFloat32(event.dirY ?? 0);
          encoder.writeFloat32(event.dirZ ?? 0);
          break;

        case 5: // weapon_charge: entityId, weaponId, charging
          encoder.writeString(event.entityId);
          encoder.writeString(event.weaponId ?? "");
          encoder.writeUint8(event.charging ? 1 : 0);
          break;

        case 13: {
          // weapon_chain: entityId, point count (u8), then count × (xyz float32)
          encoder.writeString(event.entityId);
          const pts = event.points ?? [];
          encoder.writeUint8(Math.min(255, pts.length));
          for (const p of pts) {
            encoder.writeFloat32(p.x);
            encoder.writeFloat32(p.y);
            encoder.writeFloat32(p.z);
          }
          break;
        }

        case 6: // projectile_spawn: entityId, defId
          encoder.writeString(event.entityId);
          encoder.writeString(event.defId ?? "");
          break;

        case 7: // projectile_impact: defId, xyz, normal xyz
          encoder.writeString(event.defId ?? "");
          encoder.writeFloat32(event.x ?? 0);
          encoder.writeFloat32(event.y ?? 0);
          encoder.writeFloat32(event.z ?? 0);
          encoder.writeFloat32(event.normalX ?? 0);
          encoder.writeFloat32(event.normalY ?? 0);
          encoder.writeFloat32(event.normalZ ?? 0);
          break;

        case 8: // item_pickup: pickupId, weaponId, entityId, droppedWeaponId, xyz
          encoder.writeInt16(typeof event.pickupId === "number" ? event.pickupId : -1);
          encoder.writeString(event.weaponId ?? "");
          encoder.writeString(event.entityId ?? "");
          encoder.writeString(event.droppedWeaponId ?? "");
          encoder.writeFloat32(event.x ?? 0);
          encoder.writeFloat32(event.y ?? 0);
          encoder.writeFloat32(event.z ?? 0);
          break;

        case 9: // weapon_drop: entityId, weaponId, xyz, vel xyz
          encoder.writeString(event.entityId);
          encoder.writeString(event.weaponId ?? "");
          encoder.writeFloat32(event.x ?? 0);
          encoder.writeFloat32(event.y ?? 0);
          encoder.writeFloat32(event.z ?? 0);
          encoder.writeFloat32(event.velX ?? 0);
          encoder.writeFloat32(event.velY ?? 0);
          encoder.writeFloat32(event.velZ ?? 0);
          break;

        case 10: // damage: entityId, attackerId, damage, weaponId, xyz
          encoder.writeString(event.entityId);
          encoder.writeString(event.attackerId ?? "");
          encoder.writeUint16(event.damage ?? 0);
          encoder.writeString(event.weaponId ?? "");
          encoder.writeFloat32(event.x ?? 0);
          encoder.writeFloat32(event.y ?? 0);
          encoder.writeFloat32(event.z ?? 0);
          break;

        case 11: // death: entityId, killerId, weaponId, damageType, finalDamage, xyz, vel xyz, kb dir xyz
          encoder.writeString(event.entityId);
          encoder.writeString(event.killerId ?? "");
          encoder.writeString(event.weaponId ?? "");
          encoder.writeString(event.damageType ?? "");
          encoder.writeUint16(event.finalDamage ?? 0);
          encoder.writeFloat32(event.x ?? 0);
          encoder.writeFloat32(event.y ?? 0);
          encoder.writeFloat32(event.z ?? 0);
          encoder.writeFloat32(event.velX ?? 0);
          encoder.writeFloat32(event.velY ?? 0);
          encoder.writeFloat32(event.velZ ?? 0);
          encoder.writeFloat32(event.kbDirX ?? 0);
          encoder.writeFloat32(event.kbDirY ?? 0);
          encoder.writeFloat32(event.kbDirZ ?? 0);
          break;

        case 12: // award: awardType, playerId, playerName, targetName, value
          encoder.writeString(event.awardType ?? "");
          encoder.writeString(event.playerId ?? "");
          encoder.writeString(event.playerName ?? "");
          encoder.writeString(event.targetName ?? "");
          encoder.writeUint16(event.value ?? 0);
          break;

        case 14: // chat: senderId, senderName, team, text (lands in demos via D16)
          encoder.writeString(event.senderId ?? "");
          encoder.writeString(event.senderName ?? "");
          encoder.writeString(event.team ?? "");
          encoder.writeString(event.text ?? "");
          break;

        case 15: // pickup_notify: entityId (grabber), label
          encoder.writeString(event.entityId ?? "");
          encoder.writeString(event.label ?? "");
          break;

        case 16: // voltaic_beam: entity, authoritative ray/contact, impact kind
        case 17: // electro_rail: identical authoritative ray/contact payload
          encoder.writeString(event.entityId);
          encoder.writeFloat32(event.originX ?? 0);
          encoder.writeFloat32(event.originY ?? 0);
          encoder.writeFloat32(event.originZ ?? 0);
          encoder.writeFloat32(event.dirX ?? 0);
          encoder.writeFloat32(event.dirY ?? 0);
          encoder.writeFloat32(event.dirZ ?? 0);
          encoder.writeFloat32(event.endX ?? 0);
          encoder.writeFloat32(event.endY ?? 0);
          encoder.writeFloat32(event.endZ ?? 0);
          encoder.writeFloat32(event.normalX ?? 0);
          encoder.writeFloat32(event.normalY ?? 0);
          encoder.writeFloat32(event.normalZ ?? 0);
          encoder.writeUint8(event.impactKind ?? 0);
          break;
      }
    }
  }

  private static decodeEvents(decoder: BinaryDecoder, state: GameState): void {
    const eventCount = decoder.readUint16();

    for (let i = 0; i < eventCount; i++) {
      const typeCode = decoder.readUint8();
      const type = BinaryProtocol.EVT_NAME_MAP[typeCode];

      switch (typeCode) {
        case 1: // combat_state
          state.events.push({
            type,
            entityId: decoder.readString(),
            health: decoder.readUint16(),
            armor: decoder.readUint16(),
            dead: decoder.readUint8() !== 0,
          });
          break;

        case 2: // match_state — JSON
          state.events.push({ type, ...JSON.parse(decoder.readString()) });
          break;

        case 3: // weapon_state
          state.events.push({
            type,
            entityId: decoder.readString(),
            currentWeapon: decoder.readString(),
            weapons: JSON.parse(decoder.readString()),
            ammo: JSON.parse(decoder.readString()),
            reloading: decoder.readUint8() !== 0,
            lastFireTick: decoder.readUint32(),
          });
          break;

        case 4: // weapon_fire
          state.events.push({
            type,
            entityId: decoder.readString(),
            weaponId: decoder.readString(),
            originX: decoder.readFloat32(),
            originY: decoder.readFloat32(),
            originZ: decoder.readFloat32(),
            dirX: decoder.readFloat32(),
            dirY: decoder.readFloat32(),
            dirZ: decoder.readFloat32(),
          });
          break;

        case 5: // weapon_charge
          state.events.push({
            type,
            entityId: decoder.readString(),
            weaponId: decoder.readString(),
            charging: decoder.readUint8() !== 0,
          });
          break;

        case 13: {
          // weapon_chain
          const entityId = decoder.readString();
          const count = decoder.readUint8();
          const points: { x: number; y: number; z: number }[] = [];
          for (let p = 0; p < count; p++) {
            points.push({ x: decoder.readFloat32(), y: decoder.readFloat32(), z: decoder.readFloat32() });
          }
          state.events.push({ type, entityId, points });
          break;
        }

        case 6: // projectile_spawn
          state.events.push({
            type,
            entityId: decoder.readString(),
            defId: decoder.readString(),
          });
          break;

        case 7: // projectile_impact
          state.events.push({
            type,
            defId: decoder.readString(),
            x: decoder.readFloat32(),
            y: decoder.readFloat32(),
            z: decoder.readFloat32(),
            normalX: decoder.readFloat32(),
            normalY: decoder.readFloat32(),
            normalZ: decoder.readFloat32(),
          });
          break;

        case 8: // item_pickup
          state.events.push({
            type,
            pickupId: decoder.readInt16(),
            weaponId: decoder.readString(),
            entityId: decoder.readString(),
            droppedWeaponId: decoder.readString(),
            x: decoder.readFloat32(),
            y: decoder.readFloat32(),
            z: decoder.readFloat32(),
          });
          break;

        case 9: // weapon_drop
          state.events.push({
            type,
            entityId: decoder.readString(),
            weaponId: decoder.readString(),
            x: decoder.readFloat32(),
            y: decoder.readFloat32(),
            z: decoder.readFloat32(),
            velX: decoder.readFloat32(),
            velY: decoder.readFloat32(),
            velZ: decoder.readFloat32(),
          });
          break;

        case 10: // damage
          state.events.push({
            type,
            entityId: decoder.readString(),
            attackerId: decoder.readString(),
            damage: decoder.readUint16(),
            weaponId: decoder.readString(),
            x: decoder.readFloat32(),
            y: decoder.readFloat32(),
            z: decoder.readFloat32(),
          });
          break;

        case 11: // death
          state.events.push({
            type,
            entityId: decoder.readString(),
            killerId: decoder.readString(),
            weaponId: decoder.readString(),
            damageType: decoder.readString(),
            finalDamage: decoder.readUint16(),
            x: decoder.readFloat32(),
            y: decoder.readFloat32(),
            z: decoder.readFloat32(),
            velX: decoder.readFloat32(),
            velY: decoder.readFloat32(),
            velZ: decoder.readFloat32(),
            kbDirX: decoder.readFloat32(),
            kbDirY: decoder.readFloat32(),
            kbDirZ: decoder.readFloat32(),
          });
          break;

        case 12: // award
          state.events.push({
            type,
            awardType: decoder.readString(),
            playerId: decoder.readString(),
            playerName: decoder.readString(),
            targetName: decoder.readString(),
            value: decoder.readUint16(),
          });
          break;

        case 14: // chat
          state.events.push({
            type,
            senderId: decoder.readString(),
            senderName: decoder.readString(),
            team: decoder.readString(),
            text: decoder.readString(),
          });
          break;

        case 15: // pickup_notify
          state.events.push({
            type,
            entityId: decoder.readString(),
            label: decoder.readString(),
          });
          break;

        case 16: // voltaic_beam
        case 17: // electro_rail (identical payload; `type` resolves to the right name)
          state.events.push({
            type,
            entityId: decoder.readString(),
            originX: decoder.readFloat32(),
            originY: decoder.readFloat32(),
            originZ: decoder.readFloat32(),
            dirX: decoder.readFloat32(),
            dirY: decoder.readFloat32(),
            dirZ: decoder.readFloat32(),
            endX: decoder.readFloat32(),
            endY: decoder.readFloat32(),
            endZ: decoder.readFloat32(),
            normalX: decoder.readFloat32(),
            normalY: decoder.readFloat32(),
            normalZ: decoder.readFloat32(),
            impactKind: decoder.readUint8(),
          });
          break;
      }
    }
  }
}

/**
 * Message types for network protocol
 * Server → Client: 0x01-0x0F
 * Client → Server: 0x81-0x8F
 */
export enum MessageType {
  // Server → Client
  Welcome = 0x01,
  JoinAccept = 0x02,
  JoinReject = 0x03,
  Snapshot = 0x04,
  PlayerJoined = 0x05,
  PlayerLeft = 0x06,
  GameStart = 0x07,
  Ack = 0x08,
  ServerMessage = 0x09, // Generic server→client text message (queue, rejection, info)
  Pong = 0x0a,

  // Client → Server
  Join = 0x81,
  Ready = 0x82,
  Input = 0x83,
  Disconnect = 0x84,
  Ping = 0x85,
  JoinGame = 0x86, // Spectator → Player: request to join the game
  Spectate = 0x87, // Player → Spectator: request to leave game and spectate
  RequestSpawn = 0x88, // Dead player requests respawn (after cooldown)
  Chat = 0x89, // In-game chat text (server sanitizes, rate-limits, rebroadcasts as snapshot event)
}

// Text encoder/decoder for UTF-8 strings (more efficient than UTF-16)
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Binary encoder for efficient data writing
 * Uses UTF-8 for strings (industry standard, efficient for ASCII)
 */
export class BinaryEncoder {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;

  constructor(initialSize: number = 16384) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
  }

  writeUint8(value: number): void {
    this.ensureSpace(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeInt8(value: number): void {
    this.ensureSpace(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  writeUint16(value: number): void {
    this.ensureSpace(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  writeInt16(value: number): void {
    this.ensureSpace(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  writeUint32(value: number): void {
    this.ensureSpace(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  /** Signed 32-bit — use for values that can go negative (e.g. score after a selfkill). */
  writeInt32(value: number): void {
    this.ensureSpace(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat32(value: number): void {
    this.ensureSpace(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat64(value: number): void {
    this.ensureSpace(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  /**
   * Write string using UTF-8 encoding (more efficient than UTF-16)
   */
  writeString(str: string): void {
    const encoded = textEncoder.encode(str);
    this.ensureSpace(2 + encoded.length);
    this.writeUint16(encoded.length);
    new Uint8Array(this.buffer, this.offset, encoded.length).set(encoded);
    this.offset += encoded.length;
  }

  writeBool(value: boolean): void {
    this.writeUint8(value ? 1 : 0);
  }

  /**
   * Write raw bytes
   */
  writeBytes(data: Uint8Array): void {
    this.ensureSpace(data.length);
    new Uint8Array(this.buffer, this.offset, data.length).set(data);
    this.offset += data.length;
  }

  getData(): Uint8Array {
    return new Uint8Array(this.buffer.slice(0, this.offset));
  }

  /** Alias for getData() for compatibility */
  toBytes(): Uint8Array {
    return this.getData();
  }

  getOffset(): number {
    return this.offset;
  }

  /**
   * Reset encoder for reuse — avoids re-allocating the buffer.
   * getData() copies to a new Uint8Array so previously returned data is safe.
   */
  reset(): void {
    this.offset = 0;
  }

  private ensureSpace(bytes: number): void {
    if (this.offset + bytes > this.buffer.byteLength) {
      const newSize = Math.max(this.buffer.byteLength * 2, this.offset + bytes);
      const newBuffer = new ArrayBuffer(newSize);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(newBuffer);
    }
  }
}

/**
 * Binary decoder for efficient data reading
 * Uses UTF-8 for strings (matches BinaryEncoder)
 */
export class BinaryDecoder {
  private data: Uint8Array;
  private view: DataView;
  private offset: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private checkBounds(bytes: number): void {
    if (this.offset + bytes > this.data.length) {
      throw new Error(
        `BinaryDecoder: Buffer underflow at offset ${this.offset}, need ${bytes} bytes, have ${this.data.length - this.offset}`,
      );
    }
  }

  readUint8(): number {
    this.checkBounds(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt8(): number {
    this.checkBounds(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    this.checkBounds(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt16(): number {
    this.checkBounds(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    this.checkBounds(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** Signed 32-bit — pairs with writeInt32 (e.g. score, which can be negative). */
  readInt32(): number {
    this.checkBounds(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    this.checkBounds(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat64(): number {
    this.checkBounds(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /**
   * Read string using UTF-8 encoding
   */
  readString(): string {
    const length = this.readUint16();
    this.checkBounds(length);
    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return textDecoder.decode(bytes);
  }

  readBool(): boolean {
    return this.readUint8() !== 0;
  }

  /**
   * Read raw bytes
   */
  readBytes(length: number): Uint8Array {
    this.checkBounds(length);
    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  getOffset(): number {
    return this.offset;
  }

  hasMore(): boolean {
    return this.offset < this.data.length;
  }

  remaining(): number {
    return this.data.length - this.offset;
  }
}
