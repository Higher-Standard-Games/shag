import { Entity, type EntityId, type PlayerId } from './Entity';

/**
 * Game event that can be synchronized
 */
export interface GameEvent {
  type: string;
  [key: string]: any;
}

/**
 * Base game state that can be extended by games
 */
export class GameState {
  /** Current server tick */
  tick: number = 0;

  /** Last acknowledged input sequence (for reconciliation) */
  ackedInputSeq: number = 0;

  /** All entities in the world */
  entities: Map<EntityId, Entity> = new Map();

  /** Player data */
  players: Map<PlayerId, PlayerState> = new Map();

  /** Pending events to be processed */
  events: GameEvent[] = [];

  /**
   * Serialize state to binary
   */
  serialize(encoder: any): void {
    encoder.writeUint32(this.tick);
    encoder.writeUint32(this.ackedInputSeq);

    // Serialize entities
    encoder.writeUint16(this.entities.size);
    for (const [id, entity] of this.entities) {
      encoder.writeString(id);
      entity.serialize(encoder);
    }

    // Serialize players
    encoder.writeUint8(this.players.size);
    for (const [id, player] of this.players) {
      encoder.writeString(id);
      player.serialize(encoder);
    }

    // Serialize events
    encoder.writeUint8(this.events.length);
    for (const event of this.events) {
      encoder.writeString(event.type);
      // Serialize event data based on type
      this.serializeEvent(encoder, event);
    }
  }

  /**
   * Deserialize state from binary
   */
  deserialize(decoder: any): void {
    this.tick = decoder.readUint32();
    this.ackedInputSeq = decoder.readUint32();

    // Deserialize entities
    const entityCount = decoder.readUint16();
    this.entities.clear();
    for (let i = 0; i < entityCount; i++) {
      const id = decoder.readString();
      const entity = new Entity(id);
      // TODO: Deserialize entity components
      this.entities.set(id, entity);
    }

    // Deserialize players
    const playerCount = decoder.readUint8();
    this.players.clear();
    for (let i = 0; i < playerCount; i++) {
      const id = decoder.readString();
      const player = new PlayerState();
      player.deserialize(decoder);
      this.players.set(id, player);
    }

    // Deserialize events
    const eventCount = decoder.readUint8();
    this.events = [];
    for (let i = 0; i < eventCount; i++) {
      const type = decoder.readString();
      const event = this.deserializeEvent(decoder, type);
      this.events.push(event);
    }
  }

  /**
   * Clone state for snapshot
   */
  clone(): GameState {
    const cloned = new GameState();
    cloned.tick = this.tick;
    cloned.ackedInputSeq = this.ackedInputSeq;

    // Clone entities
    for (const [id, entity] of this.entities) {
      cloned.entities.set(id, entity.clone());
    }

    // Clone players
    for (const [id, player] of this.players) {
      cloned.players.set(id, player.clone());
    }

    // Clone events
    cloned.events = [...this.events];

    return cloned;
  }

  private serializeEvent(encoder: any, event: GameEvent): void {
    // Basic serialization - can be extended by games
    switch (event.type) {
      case 'damage':
        encoder.writeString(event.entityId);
        encoder.writeFloat32(event.damage);
        break;
      case 'death':
        encoder.writeString(event.entityId);
        encoder.writeString(event.killerId);
        break;
      case 'chat':
        encoder.writeString(event.playerId);
        encoder.writeString(event.message);
        break;
      case 'weapon_fire':
        encoder.writeString(event.entityId);    // shooter entity
        encoder.writeString(event.weaponId);     // weapon id
        encoder.writeFloat32(event.originX);     // fire origin
        encoder.writeFloat32(event.originY);
        encoder.writeFloat32(event.originZ);
        encoder.writeFloat32(event.dirX);        // fire direction
        encoder.writeFloat32(event.dirY);
        encoder.writeFloat32(event.dirZ);
        break;
      case 'weapon_stop':
        encoder.writeString(event.entityId);     // shooter entity
        encoder.writeString(event.weaponId);     // weapon id
        break;
      default:
        // Serialize as JSON for unknown events
        const json = JSON.stringify(event);
        encoder.writeString(json);
        break;
    }
  }

  private deserializeEvent(decoder: any, type: string): GameEvent {
    switch (type) {
      case 'damage':
        return {
          type,
          entityId: decoder.readString(),
          damage: decoder.readFloat32(),
        };
      case 'death':
        return {
          type,
          entityId: decoder.readString(),
          killerId: decoder.readString(),
        };
      case 'chat':
        return {
          type,
          playerId: decoder.readString(),
          message: decoder.readString(),
        };
      case 'weapon_fire':
        return {
          type,
          entityId: decoder.readString(),
          weaponId: decoder.readString(),
          originX: decoder.readFloat32(),
          originY: decoder.readFloat32(),
          originZ: decoder.readFloat32(),
          dirX: decoder.readFloat32(),
          dirY: decoder.readFloat32(),
          dirZ: decoder.readFloat32(),
        };
      case 'weapon_stop':
        return {
          type,
          entityId: decoder.readString(),
          weaponId: decoder.readString(),
        };
      default:
        const json = decoder.readString();
        return JSON.parse(json);
    }
  }
}

/**
 * Player state in the game
 */
export class PlayerState {
  /** Entity ID this player controls */
  entityId: EntityId = '';

  /** Player name */
  name: string = '';

  /** Team (if applicable) */
  team: string = '';

  /** Score */
  score: number = 0;

  /** Ping in milliseconds */
  ping: number = 0;

  /**
   * Serialize player state
   */
  serialize(encoder: any): void {
    encoder.writeString(this.entityId);
    encoder.writeString(this.name);
    encoder.writeString(this.team);
    encoder.writeUint32(this.score);
    encoder.writeUint16(this.ping);
  }

  /**
   * Deserialize player state
   */
  deserialize(decoder: any): void {
    this.entityId = decoder.readString();
    this.name = decoder.readString();
    this.team = decoder.readString();
    this.score = decoder.readUint32();
    this.ping = decoder.readUint16();
  }

  /**
   * Clone player state
   */
  clone(): PlayerState {
    const cloned = new PlayerState();
    cloned.entityId = this.entityId;
    cloned.name = this.name;
    cloned.team = this.team;
    cloned.score = this.score;
    cloned.ping = this.ping;
    return cloned;
  }
}
