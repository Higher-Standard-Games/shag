/**
 * SnapshotEvent — the discriminated union of one-shot events carried in a
 * GameState snapshot, mirroring BinaryProtocol's per-type encode/decode schema
 * (the codec switch already IS the schema).
 *
 * The wire-level `GameState.events` stays the loose bag that encode/SnapshotBuilder
 * populate; the client dispatcher casts to this union at its boundary so every
 * `switch (event.type)` arm is field-checked by the compiler, and an unrouted
 * type is caught by {@link assertUnroutedEvent} instead of vanishing silently
 * (QA-6 — the client-side twin of the chat routing bug).
 */
import type { MatchStateSnapshot } from "../../../shared/server/gametype";

interface Vec3Lite {
  x: number;
  y: number;
  z: number;
}

export interface CombatStateEvent {
  type: "combat_state";
  entityId: string;
  health: number;
  armor: number;
  dead: boolean;
}

/** Variable-shape match state (JSON on the wire). */
export type MatchStateEvent = { type: "match_state" } & Partial<MatchStateSnapshot>;

export interface WeaponStateEvent {
  type: "weapon_state";
  entityId: string;
  currentWeapon: string;
  weapons: string[];
  ammo: Record<string, number>;
  reloading: boolean;
  lastFireTick: number;
}

export interface WeaponFireEvent {
  type: "weapon_fire";
  entityId: string;
  weaponId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface WeaponChargeEvent {
  type: "weapon_charge";
  entityId: string;
  weaponId: string;
  charging: boolean;
}

export interface WeaponChainEvent {
  type: "weapon_chain";
  entityId: string;
  points: Vec3Lite[];
}

export interface VoltaicBeamEvent {
  type: "voltaic_beam";
  entityId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  endX: number;
  endY: number;
  endZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  /** 0 = miss, 1 = world, 2 = player. */
  impactKind: 0 | 1 | 2;
}

export interface ElectroRailEvent {
  type: "electro_rail";
  entityId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  endX: number;
  endY: number;
  endZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  /** 0 = miss, 1 = world, 2 = player. */
  impactKind: 0 | 1 | 2;
}

export interface ProjectileSpawnEvent {
  type: "projectile_spawn";
  entityId: string;
  defId: string;
}

export interface ProjectileImpactEvent {
  type: "projectile_impact";
  defId: string;
  x: number;
  y: number;
  z: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface ItemPickupEvent {
  type: "item_pickup";
  pickupId: number;
  weaponId: string;
  entityId: string;
  droppedWeaponId: string;
  x: number;
  y: number;
  z: number;
}

export interface WeaponDropEvent {
  type: "weapon_drop";
  entityId: string;
  weaponId: string;
  x: number;
  y: number;
  z: number;
  velX: number;
  velY: number;
  velZ: number;
}

export interface DamageEvent {
  type: "damage";
  entityId: string;
  attackerId: string;
  damage: number;
  weaponId: string;
  /**
   * Where the hit landed. Present only for a head or leg hit: a body hit, an older server and a
   * demo recorded before this field existed all leave it out, and absent means body.
   */
  hitLocation?: "head" | "legs" | "body";
  x: number;
  y: number;
  z: number;
}

export interface DeathEvent {
  type: "death";
  entityId: string;
  killerId: string;
  weaponId: string;
  damageType: string;
  finalDamage: number;
  x: number;
  y: number;
  z: number;
  velX: number;
  velY: number;
  velZ: number;
  kbDirX: number;
  kbDirY: number;
  kbDirZ: number;
}

export interface AwardSnapshotEvent {
  type: "award";
  awardType: string;
  playerId: string;
  playerName: string;
  targetName: string;
  value: number;
}

export interface ChatSnapshotEvent {
  type: "chat";
  senderId: string;
  senderName: string;
  team: string;
  text: string;
}

export interface PickupNotifyEvent {
  type: "pickup_notify";
  entityId: string;
  label: string;
}

/**
 * Countdown for one powerup held by one player. Emitted every snapshot while the
 * timer runs; the client shows it only for the local player (like combat_state).
 * The public "who is glowing" signal is the entity powerup mask, not this.
 */
export interface PowerupStateEvent {
  type: "powerup_state";
  entityId: string;
  /** PowerupKind, e.g. "quad". */
  kind: string;
  /** Whole seconds remaining (rounded up). */
  seconds: number;
}

/**
 * Gametype orders for ONE player. Sent only to the addressed client, so a
 * human opponent never sees another team's tactics. Bots map these onto goals;
 * human clients ignore them.
 */
export interface AgentDirectivesEvent {
  type: "agent_directives";
  entityId: string;
  /** `AgentDirective[]` from shared/server/gametype; typed loosely here to keep
   *  the engine's event union free of gametype imports. */
  directives: unknown;
}

/** A powerup returned to the map. Broadcast to everyone, with its position. */
export interface PowerupSpawnEvent {
  type: "powerup_spawn";
  kind: string;
  x: number;
  y: number;
  z: number;
}

/** One-shot snapshot event — discriminated on `type`. Mirrors BinaryProtocol. */
export type SnapshotEvent =
  | { type: "knockback_state"; entityId: string; ageTicks: number | null }
  | CombatStateEvent
  | MatchStateEvent
  | WeaponStateEvent
  | WeaponFireEvent
  | WeaponChargeEvent
  | WeaponChainEvent
  | VoltaicBeamEvent
  | ElectroRailEvent
  | ProjectileSpawnEvent
  | ProjectileImpactEvent
  | ItemPickupEvent
  | WeaponDropEvent
  | DamageEvent
  | DeathEvent
  | AwardSnapshotEvent
  | ChatSnapshotEvent
  | PickupNotifyEvent
  | PowerupStateEvent
  | PowerupSpawnEvent
  | AgentDirectivesEvent;

const _warnedTypes = new Set<string>();

/**
 * Exhaustiveness guard for a `switch (event.type)`. Reachable only if the union
 * grew a member the switch forgot (a compile error at the call site) or a
 * runtime event carries a type outside the union (a newer server). Warns once
 * per type instead of letting the event vanish silently.
 */
export function assertUnroutedEvent(event: never): void {
  const t = (event as { type?: string })?.type ?? "<undefined>";
  if (!_warnedTypes.has(t)) {
    _warnedTypes.add(t);
    console.warn(`[SnapshotEvent] Unrouted event type: ${t} (further occurrences suppressed)`);
  }
}
