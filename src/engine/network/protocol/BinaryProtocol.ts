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
 * - 0x10 = movement state changed (1 byte: bit 0=crouching, bit 1=sliding)
 */

import { GameState } from '../core/GameState';
import { Entity } from '../core/Entity';

/**
 * Binary protocol for network messages.
 * Handles encoding/decoding of game state with delta compression.
 */
export class BinaryProtocol {
  /**
   * Encode a snapshot with delta compression
   */
  static encodeSnapshot(state: GameState, baseline?: GameState): Uint8Array {
    const encoder = new BinaryEncoder();

    // Write header
    encoder.writeUint32(state.tick);
    // Use full 64-bit timestamp for ClockSync compatibility
    encoder.writeFloat64(Date.now());
    // CRITICAL: ackedInputSeq for client-side reconciliation (V2NetworkClient)
    encoder.writeUint32(state.ackedInputSeq);

    // Encode ALL entities with delta-compressed components
    // Note: This is "full state with delta content" model - every entity is included,
    // but unchanged component values are omitted. Removals are implicit (missing = removed).
    this.encodeEntities(encoder, state, baseline);

    // Encode players with delta
    this.encodePlayers(encoder, state, baseline);

    // Encode events (no delta)
    this.encodeEvents(encoder, state);

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
    this.decodeEntities(decoder, state, baseline);

    // Decode players
    this.decodePlayers(decoder, state, baseline);

    // Decode events
    this.decodeEvents(decoder, state);

    return state;
  }

  /**
   * Encode a command
   */
  static encodeCommand(playerId: string, sequence: number, command: any): Uint8Array {
    const encoder = new BinaryEncoder();

    encoder.writeString(playerId);
    encoder.writeUint32(sequence);
    encoder.writeString(JSON.stringify(command));

    return encoder.getData();
  }

  /**
   * Decode a command
   */
  static decodeCommand(data: Uint8Array): { playerId: string; sequence: number; command: any } {
    const decoder = new BinaryDecoder(data);

    return {
      playerId: decoder.readString(),
      sequence: decoder.readUint32(),
      command: JSON.parse(decoder.readString())
    };
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
      const transform = entity.getComponent('transform') as any;
      const pos = transform?.position || entity.getComponent('position') as any;
      const baselineTransform = baselineEntity?.getComponent('transform') as any;
      const baselinePos = baselineTransform?.position || baselineEntity?.getComponent('position') as any;
      // Only set flag if pos EXISTS and differs from baseline (or no baseline)
      if (pos && (!baselinePos || pos.x !== baselinePos.x || pos.y !== baselinePos.y || pos.z !== baselinePos.z)) {
        flags |= 0x01;
      }

      const vel = entity.getComponent('velocity') as any;
      const baselineVel = baselineEntity?.getComponent('velocity') as any;
      // Check velocity.linear for VelocityComponent or direct x/y/z for basic
      const velData = vel?.linear || vel;
      const baselineVelData = baselineVel?.linear || baselineVel;
      // Only set flag if velData EXISTS and differs from baseline (or no baseline)
      if (velData && (!baselineVelData || velData.x !== baselineVelData.x || velData.y !== baselineVelData.y || velData.z !== baselineVelData.z)) {
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

      // Check movement state (crouch/slide) for hitbox sync
      const movState = entity.getComponent('movementState') as any;
      const baselineMovState = baselineEntity?.getComponent('movementState') as any;
      const isCrouching = movState?.isCrouching ?? false;
      const isSliding = movState?.isSliding ?? false;
      const baselineCrouching = baselineMovState?.isCrouching ?? false;
      const baselineSliding = baselineMovState?.isSliding ?? false;
      if (isCrouching !== baselineCrouching || isSliding !== baselineSliding) {
        flags |= 0x10;
      }

      encoder.writeUint8(flags);

      // Encode changed components
      // Flag 0x01: Position (12 bytes - 3 floats)
      if (flags & 0x01) {
        encoder.writeFloat32(pos.x);
        encoder.writeFloat32(pos.y);
        encoder.writeFloat32(pos.z);
      }

      // Flag 0x02: Velocity (12 bytes - 3 floats)
      if (flags & 0x02) {
        encoder.writeFloat32(velData.x);
        encoder.writeFloat32(velData.y);
        encoder.writeFloat32(velData.z);
      }

      // Flag 0x04: Grounded state (1 byte - boolean)
      if (flags & 0x04) {
        encoder.writeUint8(grounded ? 1 : 0);
      }

      // Flag 0x08: Rotation (8 bytes - 2 floats: yaw, pitch)
      if (flags & 0x08) {
        encoder.writeFloat32(rot.y); // yaw
        encoder.writeFloat32(rot.x); // pitch
      }

      // Flag 0x10: Movement state (1 byte - bit 0=crouching, bit 1=sliding)
      if (flags & 0x10) {
        let movFlags = 0;
        if (isCrouching) movFlags |= 1;
        if (isSliding) movFlags |= 2;
        encoder.writeUint8(movFlags);
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
      // Some code looks for 'position', other code (FPSGameManager) looks for 'transform.position'
      if (flags & 0x01) {
        const x = decoder.readFloat32();
        const y = decoder.readFloat32();
        const z = decoder.readFloat32();

        // Legacy position component
        const pos = {
          x, y, z,
          serialize() { return {}; },
          deserialize() { },
          clone() { return { ...this }; }
        };
        entity.addComponent('position', pos);

        // Preserve existing rotation if transform already exists (rotation may arrive independently)
        // Fall back to baseline rotation if entity was just created fresh
        const existingTransform = entity.getComponent('transform') as any;
        const baselineTransform = baselineEntity?.getComponent('transform') as any;
        const existingRot = existingTransform?.rotation || baselineTransform?.rotation || { x: 0, y: 0, z: 0, w: 1 };

        // TransformComponent-style for FPSGameManager compatibility
        const transform = {
          position: { x, y, z },
          rotation: { ...existingRot },
          serialize() { return {}; },
          deserialize() { },
          clone() { return { position: { ...this.position }, rotation: { ...this.rotation }, serialize: this.serialize, deserialize: this.deserialize, clone: this.clone }; }
        };
        entity.addComponent('transform', transform);
      } else if (baselineEntity) {
        const baselinePos = baselineEntity.getComponent('position');
        if (baselinePos) {
          entity.addComponent('position', baselinePos);
        }
        const baselineTransform = baselineEntity.getComponent('transform');
        if (baselineTransform) {
          entity.addComponent('transform', baselineTransform);
        }
      }

      // Decode velocity (flag 0x02) and grounded (flag 0x04)
      // These are related - grounded affects whether player can jump
      let velX = 0, velY = 0, velZ = 0;
      let grounded = false;
      let hasVelocityData = false;

      // Always preserve baseline grounded (overridden below if flag 0x04 is set)
      if (baselineEntity) {
        const baselineVel = baselineEntity.getComponent('velocity') as any;
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
        const baselineVel = baselineEntity.getComponent('velocity') as any;
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
        let transform = entity.getComponent('transform') as any;
        if (transform) {
          transform.rotation = { x: rotX, y: rotY, z: 0, w: 1 };
        } else {
          // No position yet, create transform with zero position + received rotation
          transform = {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: rotX, y: rotY, z: 0, w: 1 },
            serialize() { return {}; },
            deserialize() { },
            clone() { return { position: { ...this.position }, rotation: { ...this.rotation }, serialize: this.serialize, deserialize: this.deserialize, clone: this.clone }; }
          };
          entity.addComponent('transform', transform);
        }
      }

      // Flag 0x10: Movement state (crouch/slide)
      let isCrouching = false;
      let isSliding = false;
      if (flags & 0x10) {
        const movFlags = decoder.readUint8();
        isCrouching = (movFlags & 1) !== 0;
        isSliding = (movFlags & 2) !== 0;
      } else if (baselineEntity) {
        // Carry forward from baseline
        const baselineVel = baselineEntity.getComponent('velocity') as any;
        isCrouching = baselineVel?.isCrouching ?? false;
        isSliding = baselineVel?.isSliding ?? false;
      }

      // Create velocity component if we have data
      if (hasVelocityData || (flags & 0x04) || (flags & 0x10)) {
        const vel = {
          x: velX, y: velY, z: velZ, // Legacy direct access
          linear: { x: velX, y: velY, z: velZ }, // FPSGameManager expects velocity.linear
          angular: { x: 0, y: 0, z: 0 },
          grounded, // Now properly transmitted!
          isCrouching,
          isSliding,
          serialize() { return {}; },
          deserialize() { },
          clone() { return { ...this, linear: { ...this.linear }, angular: { ...this.angular } }; }
        };
        entity.addComponent('velocity', vel);
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

      encoder.writeUint8(flags);

      // Encode changed fields
      if (flags & 0x01) encoder.writeString(player.entityId);
      if (flags & 0x02) encoder.writeString(player.name);
      if (flags & 0x04) encoder.writeUint32(player.score);
      if (flags & 0x08) encoder.writeUint32(player.deaths);
      if (flags & 0x10) encoder.writeUint16(player.ping);
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
          entityId: '',
          name: '',
          team: '',
          score: 0,
          deaths: 0,
          ping: 0,
          serialize() { return {}; },
          deserialize() { },
          clone() { return { ...this }; }
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
        player!.score = decoder.readUint32();
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
    }
  }

  private static encodeEvents(encoder: BinaryEncoder, state: GameState): void {
    encoder.writeUint16(state.events.length);

    for (const event of state.events) {
      encoder.writeString(event.type);
      encoder.writeString(JSON.stringify(event));
    }
  }

  private static decodeEvents(decoder: BinaryDecoder, state: GameState): void {
    const eventCount = decoder.readUint16();

    for (let i = 0; i < eventCount; i++) {
      const eventType = decoder.readString();
      const eventData = JSON.parse(decoder.readString());

      state.events.push({
        type: eventType,
        ...eventData
      });
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
  Pong = 0x0A,

  // Client → Server
  Join = 0x81,
  Ready = 0x82,
  Input = 0x83,
  Disconnect = 0x84,
  Ping = 0x85,
  JoinGame = 0x86,    // Spectator → Player: request to join the game
  Spectate = 0x87,    // Player → Spectator: request to leave game and spectate
  RequestSpawn = 0x88, // Dead player requests respawn (after cooldown)
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
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  /** Alias for getData() for compatibility */
  toBytes(): Uint8Array {
    return this.getData();
  }

  getOffset(): number {
    return this.offset;
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
      throw new Error(`BinaryDecoder: Buffer underflow at offset ${this.offset}, need ${bytes} bytes, have ${this.data.length - this.offset}`);
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
