import { GameState } from '../core/GameState';
import { Entity } from '../core/Entity';

/**
 * Binary state decoder for efficient network transmission
 * Handles delta compression reconstruction
 */
export class StateDecoder {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number = 0;
  
  constructor(data: Uint8Array) {
    this.buffer = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  
  /**
   * Decode a complete game state
   */
  decode(baseline?: GameState): GameState {
    this.offset = 0;
    
    const state = new GameState();
    
    // Read header
    state.tick = this.readUint32();
    const timestamp = this.readUint32();
    
    // Decode entities
    this.decodeEntities(state, baseline);
    
    // Decode players
    this.decodePlayers(state, baseline);
    
    // Decode events
    this.decodeEvents(state);
    
    return state;
  }
  
  /**
   * Decode entities with delta compression
   */
  private decodeEntities(state: GameState, baseline?: GameState): void {
    const baselineEntities = baseline?.entities || new Map();
    const entityCount = this.readUint16();
    
    for (let i = 0; i < entityCount; i++) {
      const entityId = this.readString();
      const componentFlags = this.readUint8();
      
      // Get or create entity
      let entity = state.entities.get(entityId);
      if (!entity) {
        entity = new Entity(entityId);
        state.entities.set(entityId, entity);
      }
      
      // Get baseline entity for delta
      const baselineEntity = baselineEntities.get(entityId);
      
      // Decode components based on flags
      if (componentFlags & 0x01) { // Position
        const pos = {
          x: this.readFloat32(),
          y: this.readFloat32(),
          z: this.readFloat32(),
          serialize() { return {}; },
          deserialize() {},
          clone() { return { ...this }; }
        };
        entity.addComponent('position', pos);
      } else if (baselineEntity) {
        // Copy from baseline
        const baselinePos = baselineEntity.getComponent('position');
        if (baselinePos) {
          entity.addComponent('position', baselinePos);
        }
      }
      
      if (componentFlags & 0x02) { // Velocity
        const vel = {
          x: this.readFloat32(),
          y: this.readFloat32(),
          z: this.readFloat32(),
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
      
      if (componentFlags & 0x04) { // Health
        const health = {
          current: this.readFloat32(),
          max: this.readFloat32(),
          serialize() { return {}; },
          deserialize() {},
          clone() { return { ...this }; }
        };
        entity.addComponent('health', health);
      } else if (baselineEntity) {
        const baselineHealth = baselineEntity.getComponent('health');
        if (baselineHealth) {
          entity.addComponent('health', baselineHealth);
        }
      }
      
      if (componentFlags & 0x08) { // Rotation
        const rot = {
          x: this.readFloat32(),
          y: this.readFloat32(),
          z: this.readFloat32(),
          w: this.readFloat32(),
          serialize() { return {}; },
          deserialize() {},
          clone() { return { ...this }; }
        };
        entity.addComponent('rotation', rot);
      } else if (baselineEntity) {
        const baselineRot = baselineEntity.getComponent('rotation');
        if (baselineRot) {
          entity.addComponent('rotation', baselineRot);
        }
      }
    }
  }
  
  /**
   * Decode players with delta compression
   */
  private decodePlayers(state: GameState, baseline?: GameState): void {
    const baselinePlayers = baseline?.players || new Map();
    const playerCount = this.readUint16();
    
    for (let i = 0; i < playerCount; i++) {
      const playerId = this.readString();
      const playerFlags = this.readUint8();
      
      // Get or create player
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
      
      // Get baseline player for delta
      const baselinePlayer = baselinePlayers.get(playerId);
      
      // Decode fields based on flags
      if (playerFlags & 0x01) { // Entity ID
        player.entityId = this.readString();
      } else if (baselinePlayer) {
        player!.entityId = baselinePlayer.entityId;
      }
      
      if (playerFlags & 0x02) { // Name
        player!.name = this.readString();
      } else if (baselinePlayer) {
        player!.name = baselinePlayer.name;
      }
      
      if (playerFlags & 0x04) { // Team
        player!.team = this.readString();
      } else if (baselinePlayer) {
        player!.team = baselinePlayer.team;
      }
      
      if (playerFlags & 0x08) { // Score
        player!.score = this.readUint32();
      } else if (baselinePlayer) {
        player!.score = baselinePlayer.score;
      }
      
      if (playerFlags & 0x10) { // Ping
        player!.ping = this.readUint16();
      } else if (baselinePlayer) {
        player!.ping = baselinePlayer.ping;
      }
    }
  }
  
  /**
   * Decode events (always full)
   */
  private decodeEvents(state: GameState): void {
    const eventCount = this.readUint16();
    
    for (let i = 0; i < eventCount; i++) {
      const eventType = this.readString();
      const eventData = JSON.parse(this.readString());
      
      state.events.push({
        type: eventType,
        ...eventData
      });
    }
  }
  
  // Primitive decoding methods
  private readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  
  private readUint16(): number {
    const value = this.view.getUint16(this.offset, true); // little endian
    this.offset += 2;
    return value;
  }
  
  private readUint32(): number {
    const value = this.view.getUint32(this.offset, true); // little endian
    this.offset += 4;
    return value;
  }
  
  private readFloat32(): number {
    const value = this.view.getFloat32(this.offset, true); // little endian
    this.offset += 4;
    return value;
  }
  
  private readString(): string {
    const length = this.readUint16();
    let str = '';
    
    for (let i = 0; i < length; i++) {
      const charCode = this.view.getUint16(this.offset, true);
      str += String.fromCharCode(charCode);
      this.offset += 2;
    }
    
    return str;
  }
}
