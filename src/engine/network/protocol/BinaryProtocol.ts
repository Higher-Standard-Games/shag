import { GameState } from '../core/GameState';
import { Entity } from '../core/Entity';

/**
 * Simple binary protocol for network messages
 * Focused on performance and delta compression
 */
export class BinaryProtocol {
  /**
   * Encode a snapshot with delta compression
   */
  static encodeSnapshot(state: GameState, baseline?: GameState): Uint8Array {
    const encoder = new BinaryEncoder();

    // Write header
    encoder.writeUint32(state.tick);
    // Use relative timestamp (ms since start, wraps every ~49 days which is fine)
    encoder.writeUint32((Date.now() & 0xFFFFFFFF) >>> 0);

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
    decoder.readUint32(); // Skip timestamp for now

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
    encoder.writeUint16(sequence);
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
      sequence: decoder.readUint16(),
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
      if (!baselinePos || pos?.x !== baselinePos.x || pos?.y !== baselinePos.y || pos?.z !== baselinePos.z) {
        flags |= 0x01;
      }

      const vel = entity.getComponent('velocity') as any;
      const baselineVel = baselineEntity?.getComponent('velocity') as any;
      // Check velocity.velocity for VelocityComponent or direct x/y/z for basic
      const velData = vel?.velocity || vel;
      const baselineVelData = baselineVel?.velocity || baselineVel;
      if (!baselineVelData || velData?.x !== baselineVelData.x || velData?.y !== baselineVelData.y || velData?.z !== baselineVelData.z) {
        flags |= 0x02;
      }

      encoder.writeUint8(flags);

      // Encode changed components
      if (flags & 0x01 && pos) {
        encoder.writeFloat32(pos.x);
        encoder.writeFloat32(pos.y);
        encoder.writeFloat32(pos.z);
      }

      if (flags & 0x02 && velData) {
        encoder.writeFloat32(velData.x);
        encoder.writeFloat32(velData.y);
        encoder.writeFloat32(velData.z);
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
      if (flags & 0x01) {
        const pos = {
          x: decoder.readFloat32(),
          y: decoder.readFloat32(),
          z: decoder.readFloat32(),
          serialize() { return {}; },
          deserialize() { },
          clone() { return { ...this }; }
        };
        entity.addComponent('position', pos);
      } else if (baselineEntity) {
        const baselinePos = baselineEntity.getComponent('position');
        if (baselinePos) {
          entity.addComponent('position', baselinePos);
        }
      }

      if (flags & 0x02) {
        const vel = {
          x: decoder.readFloat32(),
          y: decoder.readFloat32(),
          z: decoder.readFloat32(),
          serialize() { return {}; },
          deserialize() { },
          clone() { return { ...this }; }
        };
        entity.addComponent('velocity', vel);
      } else if (baselineEntity) {
        const baselineVel = baselineEntity.getComponent('velocity');
        if (baselineVel) {
          entity.addComponent('velocity', baselineVel);
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

      encoder.writeUint8(flags);

      // Encode changed fields
      if (flags & 0x01) encoder.writeString(player.entityId);
      if (flags & 0x02) encoder.writeString(player.name);
      if (flags & 0x04) encoder.writeUint32(player.score);
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

  // Client → Server
  Join = 0x81,
  Ready = 0x82,
  Input = 0x83,
  Disconnect = 0x84,
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

  constructor(initialSize: number = 4096) {
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
