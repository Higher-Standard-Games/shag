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
    encoder.writeUint32(Date.now());
    
    // Encode entities with delta
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
    const timestamp = decoder.readUint32(); // Not used for now
    
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
  
  private static encodeEntities(encoder: BinaryEncoder, state: GameState, baseline?: GameState): void {
    const baselineEntities = baseline?.entities || new Map();
    
    encoder.writeUint16(state.entities.size);
    
    for (const [entityId, entity] of state.entities) {
      const baselineEntity = baselineEntities.get(entityId);
      
      encoder.writeString(entityId);
      
      // Component flags
      let flags = 0;
      const pos = entity.getComponent('position') as any;
      const baselinePos = baselineEntity?.getComponent('position') as any;
      if (!baselinePos || pos?.x !== baselinePos.x || pos?.y !== baselinePos.y || pos?.z !== baselinePos.z) {
        flags |= 0x01;
      }
      
      const vel = entity.getComponent('velocity') as any;
      const baselineVel = baselineEntity?.getComponent('velocity') as any;
      if (!baselineVel || vel?.x !== baselineVel.x || vel?.y !== baselineVel.y || vel?.z !== baselineVel.z) {
        flags |= 0x02;
      }
      
      encoder.writeUint8(flags);
      
      // Encode changed components
      if (flags & 0x01 && pos) {
        encoder.writeFloat32(pos.x);
        encoder.writeFloat32(pos.y);
        encoder.writeFloat32(pos.z);
      }
      
      if (flags & 0x02 && vel) {
        encoder.writeFloat32(vel.x);
        encoder.writeFloat32(vel.y);
        encoder.writeFloat32(vel.z);
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
          deserialize() {},
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
          deserialize() {},
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
          deserialize() {},
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
 * Binary encoder for efficient data writing
 */
class BinaryEncoder {
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
  
  writeUint16(value: number): void {
    this.ensureSpace(2);
    this.view.setUint16(this.offset, value, true);
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
  
  writeString(str: string): void {
    this.ensureSpace(2 + str.length * 2);
    this.writeUint16(str.length);
    
    for (let i = 0; i < str.length; i++) {
      this.view.setUint16(this.offset, str.charCodeAt(i), true);
      this.offset += 2;
    }
  }
  
  getData(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
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
 */
class BinaryDecoder {
  private view: DataView;
  private offset: number = 0;
  
  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  
  readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  
  readUint16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  
  readUint32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  
  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  
  readString(): string {
    const length = this.readUint16();
    let str = '';
    
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(this.view.getUint16(this.offset, true));
      this.offset += 2;
    }
    
    return str;
  }
}
