import type { MatchStateSnapshot } from "../../../shared/server/gametype";
import type { BinaryDecoder, BinaryEncoder } from "../protocol/BinaryProtocol";
import { Entity, type EntityId, type PlayerId } from "./Entity";

/**
 * Game event that can be synchronized
 */
export interface GameEvent {
  type: string;
  // biome-ignore lint/suspicious/noExplicitAny: events carry heterogeneous payloads (health, damage, position, weaponId, etc.)
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

  /** Server timestamp from snapshot header (Date.now() & 0xFFFFFFFF) for ClockSync */
  serverTimestamp: number = 0;

  /** All entities in the world */
  entities: Map<EntityId, Entity> = new Map();

  /** Player data */
  players: Map<PlayerId, PlayerState> = new Map();

  /** Pending events to be processed */
  events: GameEvent[] = [];

  /**
   * Authoritative active-state of every server-tracked map pickup, indexed by
   * pickup id (see src/shared/bsp/PickupTable.ts). Sent in full each snapshot
   * (not delta) so client pickup visibility converges and self-heals against
   * packet loss — replacing the old one-shot item_pickup events + client timer.
   * Empty when the server sends no pickup state (older payloads / no pickups).
   */
  pickupActiveMask: boolean[] = [];

  /** Add-on for high level game state logic */
  matchSnapshot?: MatchStateSnapshot;

  /**
   * Serialize state to binary
   */
  serialize(encoder: BinaryEncoder): void {
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

    // Serialize match snapshot (if present)
    if (this.matchSnapshot) {
      encoder.writeUint8(1);
      encoder.writeString(JSON.stringify(this.matchSnapshot));
    } else {
      encoder.writeUint8(0);
    }
  }

  /**
   * Deserialize state from binary
   */
  deserialize(decoder: BinaryDecoder): void {
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

    // Deserialize match snapshot
    const hasSnapshot = decoder.readUint8() === 1;
    if (hasSnapshot) {
      this.matchSnapshot = JSON.parse(decoder.readString());
    } else {
      this.matchSnapshot = undefined;
    }
  }

  /**
   * Shallow copy — shares entity/player/event references but copies scalar fields.
   * Used in broadcastSnapshot() so each client gets its own ackedInputSeq
   * without the cost of deep-cloning all entities and players.
   */
  shallowCopy(): GameState {
    const copy = new GameState();
    copy.tick = this.tick;
    copy.serverTimestamp = this.serverTimestamp;
    copy.ackedInputSeq = this.ackedInputSeq;
    copy.entities = this.entities; // Share reference (read-only during broadcast)
    copy.players = this.players; // Share reference
    copy.events = this.events; // Share reference
    copy.pickupActiveMask = this.pickupActiveMask; // Share reference (read-only during broadcast)
    copy.matchSnapshot = this.matchSnapshot;
    return copy;
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

    if (this.matchSnapshot) {
      cloned.matchSnapshot = JSON.parse(JSON.stringify(this.matchSnapshot));
    }

    return cloned;
  }

  private serializeEvent(encoder: BinaryEncoder, event: GameEvent): void {
    // Basic serialization - can be extended by games
    switch (event.type) {
      case "damage":
        encoder.writeString(event.entityId);
        encoder.writeString(event.attackerId ?? "");
        encoder.writeFloat32(event.damage);
        encoder.writeString(event.weaponId ?? "");
        // Victim position for floating damage numbers
        encoder.writeFloat32(event.x ?? 0);
        encoder.writeFloat32(event.y ?? 0);
        encoder.writeFloat32(event.z ?? 0);
        break;
      case "death":
        encoder.writeString(event.entityId);
        encoder.writeString(event.killerId);
        encoder.writeString(event.weaponId ?? "");
        // Victim position + velocity for gib spawning
        encoder.writeFloat32(event.x ?? 0);
        encoder.writeFloat32(event.y ?? 0);
        encoder.writeFloat32(event.z ?? 0);
        encoder.writeFloat32(event.velX ?? 0);
        encoder.writeFloat32(event.velY ?? 0);
        encoder.writeFloat32(event.velZ ?? 0);
        break;
      case "combat_state":
        encoder.writeString(event.entityId);
        encoder.writeUint16(event.health);
        encoder.writeUint16(event.armor);
        encoder.writeUint8(event.dead ? 1 : 0);
        break;
      case "chat":
        encoder.writeString(event.playerId);
        encoder.writeString(event.message);
        break;
      case "weapon_fire":
        encoder.writeString(event.entityId); // shooter entity
        encoder.writeString(event.weaponId); // weapon id
        encoder.writeFloat32(event.originX); // fire origin
        encoder.writeFloat32(event.originY);
        encoder.writeFloat32(event.originZ);
        encoder.writeFloat32(event.dirX); // fire direction
        encoder.writeFloat32(event.dirY);
        encoder.writeFloat32(event.dirZ);
        break;
      case "weapon_stop":
        encoder.writeString(event.entityId); // shooter entity
        encoder.writeString(event.weaponId); // weapon id
        break;
      case "weapon_charge":
        encoder.writeString(event.entityId);
        encoder.writeString(event.weaponId);
        encoder.writeUint8(event.charging ? 1 : 0);
        break;
      case "projectile_impact":
        encoder.writeString(event.defId); // weapon definition id
        encoder.writeFloat32(event.x); // impact position
        encoder.writeFloat32(event.y);
        encoder.writeFloat32(event.z);
        encoder.writeFloat32(event.normalX); // surface normal
        encoder.writeFloat32(event.normalY);
        encoder.writeFloat32(event.normalZ);
        break;
      case "projectile_spawn":
        encoder.writeString(event.entityId); // projectile entity id (proj_XXX)
        encoder.writeString(event.defId); // weapon def id (rlauncher, glauncher, etc.)
        break;
      default: {
        // Serialize as JSON for unknown events
        const json = JSON.stringify(event);
        encoder.writeString(json);
        break;
      }
    }
  }

  private deserializeEvent(decoder: BinaryDecoder, type: string): GameEvent {
    switch (type) {
      case "damage":
        return {
          type,
          entityId: decoder.readString(),
          attackerId: decoder.readString(),
          damage: decoder.readFloat32(),
          weaponId: decoder.readString(),
          // Victim position for floating damage numbers
          x: decoder.readFloat32(),
          y: decoder.readFloat32(),
          z: decoder.readFloat32(),
        };
      case "death":
        return {
          type,
          entityId: decoder.readString(),
          killerId: decoder.readString(),
          weaponId: decoder.readString(),
          // Victim position + velocity for gib spawning
          x: decoder.readFloat32(),
          y: decoder.readFloat32(),
          z: decoder.readFloat32(),
          velX: decoder.readFloat32(),
          velY: decoder.readFloat32(),
          velZ: decoder.readFloat32(),
        };
      case "combat_state":
        return {
          type,
          entityId: decoder.readString(),
          health: decoder.readUint16(),
          armor: decoder.readUint16(),
          dead: decoder.readUint8() === 1,
        };
      case "chat":
        return {
          type,
          playerId: decoder.readString(),
          message: decoder.readString(),
        };
      case "weapon_fire":
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
      case "weapon_stop":
        return {
          type,
          entityId: decoder.readString(),
          weaponId: decoder.readString(),
        };
      case "weapon_charge":
        return {
          type,
          entityId: decoder.readString(),
          weaponId: decoder.readString(),
          charging: decoder.readUint8() === 1,
        };
      case "projectile_impact":
        return {
          type,
          defId: decoder.readString(),
          x: decoder.readFloat32(),
          y: decoder.readFloat32(),
          z: decoder.readFloat32(),
          normalX: decoder.readFloat32(),
          normalY: decoder.readFloat32(),
          normalZ: decoder.readFloat32(),
        };
      case "projectile_spawn":
        return {
          type,
          entityId: decoder.readString(),
          defId: decoder.readString(),
        };
      default: {
        const json = decoder.readString();
        return JSON.parse(json);
      }
    }
  }
}

/**
 * Player state in the game
 */
export class PlayerState {
  /** Entity ID this player controls */
  entityId: EntityId = "";

  /** Player name */
  name: string = "";

  /** Team (if applicable) */
  team: string = "";

  /** Score */
  score: number = 0;

  /** Deaths */
  deaths: number = 0;

  /** Ping in milliseconds */
  ping: number = 0;

  /**
   * Serialize player state
   */
  serialize(encoder: BinaryEncoder): void {
    encoder.writeString(this.entityId);
    encoder.writeString(this.name);
    encoder.writeString(this.team);
    encoder.writeInt32(this.score);
    encoder.writeUint16(this.deaths);
    encoder.writeUint16(this.ping);
  }

  /**
   * Deserialize player state
   */
  deserialize(decoder: BinaryDecoder): void {
    this.entityId = decoder.readString();
    this.name = decoder.readString();
    this.team = decoder.readString();
    this.score = decoder.readInt32();
    this.deaths = decoder.readUint16();
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
    cloned.deaths = this.deaths;
    cloned.ping = this.ping;
    return cloned;
  }
}
