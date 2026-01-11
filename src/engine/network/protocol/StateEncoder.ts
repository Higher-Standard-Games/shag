import type { GameState } from '../core/GameState';
import type { Entity } from '../core/Entity';
import type { IComponent } from '../core/Component';

/**
 * Binary state encoder for efficient network transmission
 * Implements delta compression to minimize bandwidth
 */
export class StateEncoder {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;
  
  constructor(initialSize: number = 8192) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
  }
  
  /**
   * Encode a complete game state
   */
  encode(state: GameState, baseline?: GameState): Uint8Array {
    this.offset = 0;
    
    // Encode header
    this.writeUint32(state.tick);
    this.writeUint32(Date.now()); // timestamp
    
    // Encode entities (with delta compression)
    this.encodeEntities(state, baseline);
    
    // Encode players
    this.encodePlayers(state, baseline);
    
    // Encode events
    this.encodeEvents(state);
    
    // Return encoded data
    return new Uint8Array(this.buffer, 0, this.offset);
  }
  
  /**
   * Encode entities with delta compression
   */
  private encodeEntities(state: GameState, baseline?: GameState): void {
    const baselineEntities = baseline?.entities || new Map();
    
    // Write entity count
    this.writeUint16(state.entities.size);
    
    for (const [entityId, entity] of state.entities) {
      const baselineEntity = baselineEntities.get(entityId);
      
      // Write entity ID
      this.writeString(entityId);
      
      // Write component flags
      const componentFlags = this.getComponentFlags(entity, baselineEntity);
      this.writeUint8(componentFlags);
      
      // Encode changed components
      if (componentFlags & 0x01) { // Position
        const pos = entity.getComponent('position') as any;
        this.writeFloat32(pos.x);
        this.writeFloat32(pos.y);
        this.writeFloat32(pos.z);
      }
      
      if (componentFlags & 0x02) { // Velocity
        const vel = entity.getComponent('velocity') as any;
        this.writeFloat32(vel.x);
        this.writeFloat32(vel.y);
        this.writeFloat32(vel.z);
      }
      
      if (componentFlags & 0x04) { // Health
        const health = entity.getComponent('health') as any;
        this.writeFloat32(health.current);
        this.writeFloat32(health.max);
      }
      
      if (componentFlags & 0x08) { // Rotation
        const rot = entity.getComponent('rotation') as any;
        this.writeFloat32(rot.x);
        this.writeFloat32(rot.y);
        this.writeFloat32(rot.z);
        this.writeFloat32(rot.w);
      }
    }
  }
  
  /**
   * Encode players with delta compression
   */
  private encodePlayers(state: GameState, baseline?: GameState): void {
    const baselinePlayers = baseline?.players || new Map();
    
    // Write player count
    this.writeUint16(state.players.size);
    
    for (const [playerId, player] of state.players) {
      const baselinePlayer = baselinePlayers.get(playerId);
      
      // Write player ID
      this.writeString(playerId);
      
      // Write player flags
      const playerFlags = this.getPlayerFlags(player, baselinePlayer);
      this.writeUint8(playerFlags);
      
      // Encode changed fields
      if (playerFlags & 0x01) { // Entity ID
        this.writeString(player.entityId);
      }
      
      if (playerFlags & 0x02) { // Name
        this.writeString(player.name);
      }
      
      if (playerFlags & 0x04) { // Team
        this.writeString(player.team);
      }
      
      if (playerFlags & 0x08) { // Score
        this.writeUint32(player.score);
      }
      
      if (playerFlags & 0x10) { // Ping
        this.writeUint16(player.ping);
      }
    }
  }
  
  /**
   * Encode events (always full, no delta)
   */
  private encodeEvents(state: GameState): void {
    // Write event count
    this.writeUint16(state.events.length);
    
    for (const event of state.events) {
      this.writeString(event.type);
      this.writeString(JSON.stringify(event));
    }
  }
  
  /**
   * Get component change flags for delta compression
   */
  private getComponentFlags(entity: Entity, baseline?: Entity): number {
    let flags = 0;
    
    // Position
    const pos = entity.getComponent('position') as any;
    const baselinePos = baseline?.getComponent('position') as any;
    if (!baselinePos || pos.x !== baselinePos.x || pos.y !== baselinePos.y || pos.z !== baselinePos.z) {
      flags |= 0x01;
    }
    
    // Velocity
    const vel = entity.getComponent('velocity') as any;
    const baselineVel = baseline?.getComponent('velocity') as any;
    if (!baselineVel || vel.x !== baselineVel.x || vel.y !== baselineVel.y || vel.z !== baselineVel.z) {
      flags |= 0x02;
    }
    
    // Health
    const health = entity.getComponent('health') as any;
    const baselineHealth = baseline?.getComponent('health') as any;
    if (!baselineHealth || health.current !== baselineHealth.current || health.max !== baselineHealth.max) {
      flags |= 0x04;
    }
    
    // Rotation
    const rot = entity.getComponent('rotation') as any;
    const baselineRot = baseline?.getComponent('rotation') as any;
    if (!baselineRot || rot.x !== baselineRot.x || rot.y !== baselineRot.y || rot.z !== baselineRot.z || rot.w !== baselineRot.w) {
      flags |= 0x08;
    }
    
    return flags;
  }
  
  /**
   * Get player change flags for delta compression
   */
  private getPlayerFlags(player: any, baseline?: any): number {
    let flags = 0;
    
    if (!baseline || player.entityId !== baseline.entityId) flags |= 0x01;
    if (!baseline || player.name !== baseline.name) flags |= 0x02;
    if (!baseline || player.team !== baseline.team) flags |= 0x04;
    if (!baseline || player.score !== baseline.score) flags |= 0x08;
    if (!baseline || player.ping !== baseline.ping) flags |= 0x10;
    
    return flags;
  }
  
  // Primitive encoding methods
  private writeUint8(value: number): void {
    this.ensureSpace(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }
  
  private writeUint16(value: number): void {
    this.ensureSpace(2);
    this.view.setUint16(this.offset, value, true); // little endian
    this.offset += 2;
  }
  
  private writeUint32(value: number): void {
    this.ensureSpace(4);
    this.view.setUint32(this.offset, value, true); // little endian
    this.offset += 4;
  }
  
  private writeFloat32(value: number): void {
    this.ensureSpace(4);
    this.view.setFloat32(this.offset, value, true); // little endian
    this.offset += 4;
  }
  
  private writeString(str: string): void {
    this.ensureSpace(2 + str.length * 2);
    this.writeUint16(str.length);
    
    // Write UTF-16 characters
    for (let i = 0; i < str.length; i++) {
      this.view.setUint16(this.offset, str.charCodeAt(i), true);
      this.offset += 2;
    }
  }
  
  private ensureSpace(bytes: number): void {
    if (this.offset + bytes > this.buffer.byteLength) {
      // Resize buffer
      const newSize = Math.max(this.buffer.byteLength * 2, this.offset + bytes);
      const newBuffer = new ArrayBuffer(newSize);
      const newView = new DataView(newBuffer);
      
      // Copy old data
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      
      this.buffer = newBuffer;
      this.view = newView;
    }
  }
}
