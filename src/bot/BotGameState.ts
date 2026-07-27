/**
 * BotGameState - World state as perceived by a bot
 *
 * Parses server snapshots into a clean, queryable game state.
 * This is what the BotBrain "sees" and makes decisions from.
 *
 * The bot identifies itself via `selfEntityId` (from JoinAccept) and
 * extracts self state, visible enemies, pickups, and projectiles
 * from snapshot entities, players, and events.
 */

import type { GameState } from "../engine/network/core/GameState";

// ── Vec3 helper (lightweight, no Babylon.js dependency) ─────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function vec3Subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ── Perceived entities ──────────────────────────────────────────────────

export interface BotSelf {
  position: Vec3;
  velocity: Vec3;
  pitch: number;
  yaw: number;
  health: number;
  armor: number;
  isDead: boolean;
  isGrounded: boolean;
  isSliding: boolean;
  isCrouching: boolean;
  currentWeapon: string;
  weapons: string[];
  ammo: Record<string, number>;
  isReloading: boolean;
  /** Empty in FFA; stable team id in team modes. */
  team: string;
}

export type PlayerRelation = "ally" | "enemy";

export interface VisiblePlayer {
  entityId: string;
  playerId: string;
  position: Vec3;
  velocity: Vec3;
  isDead: boolean;
  /** Empty in FFA. */
  team: string;
  /** Relationship to this bot, derived from replicated player teams. */
  relation: PlayerRelation;
  /** Distance from bot. */
  distance: number;
}

export interface VisiblePickup {
  entityId: string;
  type: string;
  position: Vec3;
  distance: number;
}

export interface VisibleProjectile {
  entityId: string;
  position: Vec3;
  velocity: Vec3;
  ownerId: string;
  /** Is this coming toward us? */
  isThreat: boolean;
  distance: number;
}

// ── Game events the bot cares about ─────────────────────────────────────

export interface BotDamageEvent {
  attackerId: string;
  damage: number;
  weaponId: string;
  position: Vec3;
  tick: number;
}

export interface BotKillEvent {
  killerId: string;
  victimId: string;
  weaponId: string;
  tick: number;
}

// ── Map knowledge (learned over time) ───────────────────────────────────

export interface MapKnowledge {
  /** Known spawn positions (accumulated from deaths/respawns) */
  spawnPoints: Vec3[];
  /** Known pickup locations (from snapshot entities) */
  pickupLocations: Map<string, Vec3>;
  /** Last time an item was seen picked up (entityId → tick) */
  itemPickupTimes: Map<string, number>;
  /** Danger zones (positions where bot has died multiple times) */
  deathPositions: Vec3[];
}

// ── Ammo normalization ──────────────────────────────────────────────────

/**
 * Flatten the server's per-weapon ammo (`{ clip, reserve }` objects) into a
 * single numeric total per weapon, which is what the bot's decision code
 * (selectBestWeapon, _hasAmmoForWeapon, BotInputNormalizer) all assume. A
 * missing entry means "unlimited" (blade) and is preserved as absent.
 *
 * Without this the bot compared `{ clip, reserve }` objects as numbers —
 * `{ clip: 0, reserve: 0 } <= 0` is false — so it never recognized an empty
 * weapon and kept "firing" it instead of switching.
 */
export function normalizeBotAmmo(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [weaponId, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      out[weaponId] = value;
    } else if (value && typeof value === "object") {
      const clip = Number((value as { clip?: unknown }).clip) || 0;
      const reserve = Number((value as { reserve?: unknown }).reserve) || 0;
      out[weaponId] = clip + reserve;
    }
  }
  return out;
}

// ── Main BotGameState ───────────────────────────────────────────────────

export class BotGameState {
  // Identity
  selfEntityId: string = "";
  selfPlayerId: string = "";

  // Current tick
  tick: number = 0;

  // Self state
  self: BotSelf = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    pitch: 0,
    yaw: 0,
    health: 100,
    armor: 0,
    isDead: false,
    isGrounded: false,
    isSliding: false,
    isCrouching: false,
    currentWeapon: "",
    weapons: [],
    ammo: {},
    isReloading: false,
    team: "",
  };

  // Visible entities
  players: VisiblePlayer[] = [];
  pickups: VisiblePickup[] = [];
  projectiles: VisibleProjectile[] = [];

  // Authoritative static-pickup availability, indexed by PickupEntry.id.
  pickupActiveMask: readonly boolean[] = [];

  // Recent events (cleared each tick)
  recentDamage: BotDamageEvent[] = [];
  recentKills: BotKillEvent[] = [];

  // Persistent map knowledge
  mapKnowledge: MapKnowledge = {
    spawnPoints: [],
    pickupLocations: new Map(),
    itemPickupTimes: new Map(),
    deathPositions: [],
  };

  // Player scores
  scores: Map<string, { score: number; deaths: number; team: string }> = new Map();

  // Last known enemy positions (persists across ticks for hunting)
  lastKnownEnemyPositions: Map<string, { position: Vec3; tick: number }> = new Map();

  /**
   * Update game state from a new server snapshot.
   * Extracts all relevant data for the BotBrain.
   */
  update(snapshot: GameState): void {
    this.tick = snapshot.tick;

    // Clear per-tick data
    this.pickupActiveMask = [...snapshot.pickupActiveMask];
    const selfPlayer = snapshot.players.get(this.selfPlayerId);
    this.self.team = selfPlayer?.team || "";
    this.players = [];
    this.pickups = [];
    this.projectiles = [];
    this.recentKills = [];

    // Prune old damage events (keep last 300 ticks for wasRecentlyDamaged)
    this.recentDamage = this.recentDamage.filter((d) => snapshot.tick - d.tick <= 300);
    if (this.recentDamage.length > 50) {
      this.recentDamage = this.recentDamage.slice(-50);
    }

    // ── Process entities ─────────────────────────────────────────────
    for (const [entityId, entity] of snapshot.entities) {
      const transform = entity.getComponent("transform") as any;
      const position = transform?.position
        ? { x: transform.position.x, y: transform.position.y, z: transform.position.z }
        : null;

      const velocity = entity.getComponent("velocity") as any;
      const vel = velocity?.linear
        ? { x: velocity.linear.x, y: velocity.linear.y, z: velocity.linear.z }
        : { x: 0, y: 0, z: 0 };

      const grounded = velocity?.grounded ?? false;

      if (!position) continue;

      // Is this our own entity?
      if (entityId === this.selfEntityId) {
        const movementState = entity.getComponent("movementState") as
          | { isSliding?: boolean; isCrouching?: boolean }
          | undefined;
        this.self.position = position;
        this.self.velocity = vel;
        this.self.isGrounded = grounded;
        this.self.isSliding = movementState?.isSliding ?? false;
        this.self.isCrouching = movementState?.isCrouching ?? false;

        // Extract rotation (yaw/pitch)
        if (transform?.rotation) {
          this.self.yaw = transform.rotation.y ?? this.self.yaw;
          this.self.pitch = transform.rotation.x ?? this.self.pitch;
        }
        continue;
      }

      // Is this another player? Check if any player maps to this entityId
      const playerEntry = this._findPlayerByEntityId(snapshot, entityId);
      if (playerEntry) {
        const distance = vec3Distance(this.self.position, position);
        const team = playerEntry.player.team || "";
        const relation: PlayerRelation = this.self.team && team === this.self.team ? "ally" : "enemy";
        this.players.push({
          entityId,
          playerId: playerEntry.playerId,
          position,
          velocity: vel,
          isDead: false, // Will be updated from combat_state events
          team,
          relation,
          distance,
        });

        // Allies must never enter combat memory or become fallback targets.
        if (relation === "enemy") {
          this.lastKnownEnemyPositions.set(playerEntry.playerId, {
            position,
            tick: this.tick,
          });
        } else {
          this.lastKnownEnemyPositions.delete(playerEntry.playerId);
        }
        continue;
      }

      // Is this a pickup entity? (weaponMeta or item_ prefix)
      // Check for pickup items (weaponMeta component from flag 0x20)
      const weaponMeta = entity.getComponent("weaponMeta") as any;
      if (weaponMeta) {
        const distance = vec3Distance(this.self.position, position);
        this.pickups.push({
          entityId,
          type: weaponMeta.weaponId || "unknown",
          position,
          distance,
        });

        // Learn pickup location
        this.mapKnowledge.pickupLocations.set(entityId, position);
      }
    }

    // ── Process player scores ────────────────────────────────────────
    for (const [playerId, player] of snapshot.players) {
      this.scores.set(playerId, {
        score: player.score,
        deaths: player.deaths,
        team: player.team || "",
      });
    }

    // ── Process events ───────────────────────────────────────────────
    for (const event of snapshot.events) {
      switch (event.type) {
        case "combat_state": {
          const evt = event as any;
          if (evt.entityId === this.selfEntityId) {
            this.self.health = evt.health;
            this.self.armor = evt.armor;
            const wasDead = this.self.isDead;
            this.self.isDead = evt.dead;

            // If we just died, record death position
            if (!wasDead && evt.dead) {
              this.mapKnowledge.deathPositions.push({ ...this.self.position });
            }
          }
          // Mark dead players
          const deadPlayer = this.players.find((p) => p.entityId === evt.entityId);
          if (deadPlayer) {
            deadPlayer.isDead = evt.dead;
          }
          break;
        }

        case "weapon_state": {
          const evt = event as any;
          if (evt.entityId === this.selfEntityId) {
            this.self.currentWeapon = evt.currentWeapon || "";
            this.self.weapons = evt.weapons || [];
            this.self.isReloading = evt.reloading || false;
            // Parse + normalize ammo. The server sends per-weapon ammo as
            // { clip, reserve } objects; the bot reasons about a numeric total
            // per weapon (undefined = unlimited). Flatten here so out-of-ammo is
            // detected correctly by every downstream consumer.
            if (evt.ammo) {
              try {
                const raw = typeof evt.ammo === "string" ? JSON.parse(evt.ammo) : evt.ammo;
                this.self.ammo = normalizeBotAmmo(raw);
              } catch {
                // leave previous ammo state intact on malformed payloads
              }
            }
          }
          break;
        }

        case "damage": {
          const evt = event as any;
          if (evt.entityId === this.selfEntityId) {
            this.recentDamage.push({
              attackerId: evt.attackerId,
              damage: evt.damage,
              weaponId: evt.weaponId,
              position: { x: evt.x, y: evt.y, z: evt.z },
              tick: this.tick,
            });
          }
          break;
        }

        case "death": {
          const evt = event as any;
          this.recentKills.push({
            killerId: evt.killerId,
            victimId: evt.entityId,
            weaponId: evt.weaponId,
            tick: this.tick,
          });
          break;
        }

        case "item_pickup": {
          const evt = event as any;
          // Track when items were picked up for respawn timing
          if (evt.pickupId !== undefined) {
            this.mapKnowledge.itemPickupTimes.set(String(evt.pickupId), this.tick);
          }
          break;
        }

        case "weapon_fire": {
          const evt = event as any;
          // If someone fires near us, we "hear" it — track as last known position
          if (evt.entityId !== this.selfEntityId) {
            const firePos = { x: evt.originX, y: evt.originY, z: evt.originZ };
            // Find which player fired
            const firingPlayer = this.players.find((p) => p.entityId === evt.entityId);
            if (firingPlayer?.relation === "enemy") {
              this.lastKnownEnemyPositions.set(firingPlayer.playerId, {
                position: firePos,
                tick: this.tick,
              });
            }
          }
          break;
        }
      }
    }

    // ── Sort by distance ─────────────────────────────────────────────
    this.players.sort((a, b) => a.distance - b.distance);
    this.pickups.sort((a, b) => a.distance - b.distance);

    // Prune stale enemy positions (older than 600 ticks)
    for (const [key, data] of this.lastKnownEnemyPositions) {
      if (this.tick - data.tick > 600) {
        this.lastKnownEnemyPositions.delete(key);
      }
    }

    // Cap death positions to last 100
    if (this.mapKnowledge.deathPositions.length > 100) {
      this.mapKnowledge.deathPositions = this.mapKnowledge.deathPositions.slice(-100);
    }
  }

  /** Get the nearest alive enemy */
  getNearestEnemy(): VisiblePlayer | null {
    return this.players.find((p) => p.relation === "enemy" && !p.isDead) || null;
  }

  /** Get the nearest pickup within a max distance */
  getNearestPickup(maxDistance: number = Infinity): VisiblePickup | null {
    return this.pickups.find((p) => p.distance <= maxDistance) || null;
  }

  /** Get all living teammates, nearest first. */
  getAllies(): VisiblePlayer[] {
    return this.players.filter((p) => p.relation === "ally" && !p.isDead);
  }

  /** Check if the bot was recently damaged (within the last N ticks) */
  wasRecentlyDamaged(withinTicks: number = 60): boolean {
    return this.recentDamage.some((d) => this.tick - d.tick <= withinTicks);
  }

  /** Get the most recent attacker's player ID */
  getLastAttacker(): string | null {
    if (this.recentDamage.length === 0) return null;
    return this.recentDamage[this.recentDamage.length - 1].attackerId;
  }

  /** Get own score from player list */
  getOwnScore(): { score: number; deaths: number } {
    const own = this.scores.get(this.selfPlayerId);
    return own ? { score: own.score, deaths: own.deaths } : { score: 0, deaths: 0 };
  }

  /** Count players per team for auto-balance */
  getTeamCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [, data] of this.scores) {
      if (data.team) {
        counts.set(data.team, (counts.get(data.team) || 0) + 1);
      }
    }
    return counts;
  }

  /** Find the team with fewer players */
  getSmallerTeam(): string | undefined {
    const counts = this.getTeamCounts();
    if (counts.size === 0) return undefined;

    let minTeam = "";
    let minCount = Infinity;
    for (const [team, count] of counts) {
      if (count < minCount) {
        minCount = count;
        minTeam = team;
      }
    }
    return minTeam || undefined;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private _findPlayerByEntityId(snapshot: GameState, entityId: string): { playerId: string; player: any } | null {
    for (const [playerId, player] of snapshot.players) {
      if (player.entityId === entityId && playerId !== this.selfPlayerId) {
        return { playerId, player };
      }
    }
    return null;
  }
}
