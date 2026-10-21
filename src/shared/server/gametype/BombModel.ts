/**
 * BombModel — the Search & Destroy bomb, as rules rather than as an entity.
 *
 * Ported from Warsow's own bomb gametype (`progs/gametypes/bomb/*.as`, shipped
 * inside `data0_21pure.pk3`), which is the authoritative source for every
 * constant and edge case here. Nothing in this file touches `WorldState`,
 * spawns entities or plays a sound — the caller feeds it a view of the world
 * each tick and applies the events it returns.
 *
 * The distinctive rule, and the reason this is not a Counter-Strike clone:
 * **there is no plant button.** A carrier who slows below `maxPlantSpeed`
 * inside a site's plant zone, on level ground, plants the bomb where they
 * stand. Outside a zone the rule does not apply, so crossing the map is never a
 * movement skill check and a bad landing cannot cost you the bomb.
 *
 * Planting is not arming. Once planted, attackers must stand near the bomb
 * while a SHARED progress meter fills; defenders later do the same to defuse.
 * Interrupting does not reset that meter — it decays (see `ProgressMeter`), so
 * a contested site is a fight over ground rather than an all-or-nothing channel.
 */

import type { BombSite, Vec3Like } from "../../bsp/BombSiteTable";
import { isInsideBombSite } from "../../bsp/BombSiteTable";
import { ProgressMeter } from "../simulation/ChannelledAction";

export type BombPhase =
  /** Held by an attacker. */
  | "carried"
  /** Loose in the world. Pickable; not arming. */
  | "dropped"
  /** Planted at a site, arm meter filling. Not yet counting down. */
  | "planted"
  /** Armed and counting down to detonation. */
  | "armed"
  /** Defused. Round over. */
  | "defused"
  /** Detonated. Round over. */
  | "detonated";

/** One player, as the bomb rules need to see them. */
export interface BombPlayerView {
  entityId: number;
  team: string;
  position: Vec3Like;
  /** Speed in units/sec. Warsow compares full velocity, not just horizontal. */
  speed: number;
  alive: boolean;
  /**
   * Standing on ground level enough to plant on.
   *
   * Warsow traces one unit down and requires the surface normal's z >= 0.90.
   * That is a real gameplay rule rather than a technicality — it removes ramp
   * plant spots such as wbomb1's B ramp. Evaluating it needs the collision
   * world, so it is the caller's job, not this model's.
   */
  onPlantableGround: boolean;
  /**
   * Where the bomb comes to rest if this player drops or plants it.
   *
   * NOT the same as `position`. A player's position is their ORIGIN, which in
   * the Quake box is hip height — twenty-four units off the floor. Storing the
   * bomb there left it hanging at waist height, half-buried in whatever the
   * carrier happened to die against, and put the arm/defuse ring in the air
   * rather than on the ground it is telling you to stand on.
   *
   * The bomb's own position is the floor point everywhere else — the round
   * spawn is traced down before it is handed over — so this keeps one meaning
   * for one field instead of two conventions sharing it.
   *
   * Resolving it needs a trace against the collision world, so like
   * `onPlantableGround` it is the caller's job. That also makes a carrier who
   * dies mid-air do the right thing: the bomb lands on the floor beneath them
   * rather than hovering where they were hit.
   */
  groundPosition: Vec3Like;
}

export interface BombRules {
  /** Touch radius for picking up a loose bomb. */
  pickupRadius: number;
  /**
   * Radius around the PLANTED bomb within which attackers arm and defenders
   * defuse. Warsow's `BOMB_ARM_DEFUSE_RADIUS`, whose own comment reads "it
   * makes no sense for the two to be different".
   *
   * Distinct from the plant ZONE, which is the much larger site area deciding
   * where you may plant at all. Conflating the two would make a bomb defusable
   * from anywhere in the room.
   */
  armDefuseRadius: number;
  /** Above this speed a carrier cannot plant (`BOMB_MAX_PLANT_SPEED`). */
  maxPlantSpeed: number;
  /** Ticks of attackers-present to arm a planted bomb. */
  armTicks: number;
  /** Ticks of defenders-present to defuse an armed bomb. */
  defuseTicks: number;
  /** Ticks from arming to detonation. */
  detonateTicks: number;
}

/**
 * Warsow's shipped defaults, converted to 125 Hz ticks.
 * `g_bomb_armtime 4`, `g_bomb_defusetime 7`, `g_bomb_bombtimer 30`.
 */
export const DEFAULT_BOMB_RULES: BombRules = {
  pickupRadius: 64,
  armDefuseRadius: 100,
  maxPlantSpeed: 400,
  armTicks: 4 * 125,
  defuseTicks: 7 * 125,
  detonateTicks: 30 * 125,
};

/** Beep pacing, from `BOMB_BEEP_*`. Interval is a twelfth of the time left. */
const BEEP_FRACTION = 12;
const BEEP_MAX_TICKS = 5 * 125;
const BEEP_MIN_TICKS = 25; // 200 ms

export type BombEventKind = "picked_up" | "dropped" | "planted" | "armed" | "defused" | "detonated";

export interface BombEvent {
  kind: BombEventKind;
  /** Player responsible, where there is one. */
  entityId?: number;
  /** Site involved, for plant/arm/defuse/detonate. */
  siteId?: number;
  position?: Vec3Like;
}

/**
 * The bomb's authoritative state.
 *
 * `update()` is the only mutator, so a round's bomb behaviour is a pure
 * function of the tick sequence fed to it — which is what makes it testable and
 * keeps demo re-simulation honest.
 */
export class BombModel {
  private _phase: BombPhase = "dropped";
  private _position: Vec3Like = { x: 0, y: 0, z: 0 };
  private _carrierId: number | null = null;
  private _siteId: number | null = null;
  private _armedAtTick = 0;
  private _workerId: number | null = null;
  private readonly rules: BombRules;
  private meter: ProgressMeter;

  constructor(rules: Partial<BombRules> = {}) {
    this.rules = { ...DEFAULT_BOMB_RULES, ...rules };
    this.meter = new ProgressMeter(this.rules.armTicks);
  }

  get phase(): BombPhase {
    return this._phase;
  }
  /** Where the bomb is. While carried this tracks the carrier. */
  get position(): Vec3Like {
    return this._position;
  }
  get carrierId(): number | null {
    return this._carrierId;
  }
  /** Site the bomb is planted or armed at, or null. */
  get siteId(): number | null {
    return this._siteId;
  }
  /** True once the round can no longer be won by killing the attackers. */
  get isArmed(): boolean {
    return this._phase === "armed";
  }
  /** True when the bomb has resolved the round one way or the other. */
  get isResolved(): boolean {
    return this._phase === "defused" || this._phase === "detonated";
  }
  /**
   * Arm or defuse progress, 0..1. Shared by the whole team rather than owned by
   * one player, and it decays when the area empties.
   */
  get progress(): number {
    return this.meter.progress;
  }
  /** True if progress rose last tick — lets the HUD show the bar falling. */
  get progressAdvancing(): boolean {
    return this.meter.advancing;
  }

  /**
   * Who advanced the meter last tick, or null if nobody did.
   *
   * The progress is shared, but the PROGRESS BAR is not: it belongs to the
   * player whose hands are on the bomb. Everyone else on the team learning how
   * far along an arm is would be the same free intelligence the HUD wording was
   * just stripped of.
   */
  get workerId(): number | null {
    return this._workerId;
  }

  /** Ticks until detonation, or null when not armed. */
  ticksUntilDetonation(tick: number): number | null {
    if (this._phase !== "armed") return null;
    return Math.max(0, this._armedAtTick + this.rules.detonateTicks - tick);
  }

  /**
   * Ticks until the next beep: a twelfth of the time remaining, clamped. The
   * bomb therefore accelerates smoothly from a slow pulse to a frantic one with
   * no staged thresholds to tune.
   */
  beepIntervalTicks(tick: number): number | null {
    const remaining = this.ticksUntilDetonation(tick);
    if (remaining === null) return null;
    const raw = Math.floor(remaining / BEEP_FRACTION);
    return Math.min(BEEP_MAX_TICKS, Math.max(BEEP_MIN_TICKS, raw));
  }

  /** Place the bomb on the ground to start a round. */
  reset(position: Vec3Like): void {
    this._phase = "dropped";
    this._position = { ...position };
    this._carrierId = null;
    this._siteId = null;
    this._armedAtTick = 0;
    this._workerId = null;
    this.meter = new ProgressMeter(this.rules.armTicks);
  }

  /**
   * Advance the bomb by one tick.
   *
   * Detonation is checked LAST so a defuse completing on the same tick the
   * timer expires wins. Defenders arriving at the last possible instant is the
   * most memorable thing that happens in this mode; it should not lose to an
   * ordering accident.
   */
  update(
    tick: number,
    players: readonly BombPlayerView[],
    sites: readonly BombSite[],
    attackingTeam: string,
  ): BombEvent[] {
    const events: BombEvent[] = [];
    if (this.isResolved) return events;

    switch (this._phase) {
      case "carried":
        this.updateCarried(players, sites, events);
        break;
      case "dropped":
        this.updatePickup(players, attackingTeam, events);
        break;
      case "planted":
        this.updateArming(tick, players, attackingTeam, events);
        break;
      case "armed":
        this.updateDefusing(players, attackingTeam, events);
        break;
    }

    if (this._phase === "armed" && (this.ticksUntilDetonation(tick) ?? 0) <= 0) {
      this._phase = "detonated";
      events.push({ kind: "detonated", siteId: this._siteId ?? undefined, position: this._position });
    }
    return events;
  }

  /** Carried: follow the carrier, drop on death, plant on slowing in a zone. */
  private updateCarried(players: readonly BombPlayerView[], sites: readonly BombSite[], events: BombEvent[]): void {
    const carrier = players.find((p) => p.entityId === this._carrierId);

    if (!carrier?.alive) {
      this._phase = "dropped";
      // On the floor, not at hip height where the carrier's origin was.
      this._position = { ...(carrier?.groundPosition ?? this._position) };
      this._carrierId = null;
      events.push({ kind: "dropped", entityId: carrier?.entityId, position: this._position });
      return;
    }

    // While carried the bomb IS the carrier, and every range check the model
    // makes is against other players' origins — so it tracks the origin here
    // and only drops to the floor at the moment it becomes an object again.
    this._position = { ...carrier.position };

    // The plant. Every condition must hold: slow enough, on ground level enough
    // to place it on, and inside a site's plant zone.
    if (carrier.speed > this.rules.maxPlantSpeed || !carrier.onPlantableGround) return;
    const site = sites.find((s) => isInsideBombSite(s, carrier.position));
    if (!site) return;

    this._phase = "planted";
    this._siteId = site.id;
    this._carrierId = null;
    // Set down on the ground, which is where a planted bomb is.
    this._position = { ...carrier.groundPosition };
    this.meter = new ProgressMeter(this.rules.armTicks);
    events.push({ kind: "planted", entityId: carrier.entityId, siteId: site.id, position: this._position });
  }

  /** Loose: any living attacker who touches it picks it up. */
  private updatePickup(players: readonly BombPlayerView[], attackingTeam: string, events: BombEvent[]): void {
    const radiusSq = this.rules.pickupRadius * this.rules.pickupRadius;
    for (const player of players) {
      if (!player.alive || player.team !== attackingTeam) continue;
      if (this.distanceSqTo(player.position) > radiusSq) continue;

      this._phase = "carried";
      this._carrierId = player.entityId;
      events.push({ kind: "picked_up", entityId: player.entityId, position: this._position });
      return;
    }
  }

  /** Planted: attackers near the bomb fill the arm meter; it decays otherwise. */
  private updateArming(
    tick: number,
    players: readonly BombPlayerView[],
    attackingTeam: string,
    events: BombEvent[],
  ): void {
    const worker = this.someoneNear(players, (p) => p.team === attackingTeam);
    this._workerId = worker;
    if (this.meter.advance(worker !== null) !== "completed") return;

    this._phase = "armed";
    this._armedAtTick = tick;
    this.meter = new ProgressMeter(this.rules.defuseTicks);
    events.push({
      kind: "armed",
      entityId: worker ?? undefined,
      siteId: this._siteId ?? undefined,
      position: this._position,
    });
  }

  /** Armed: defenders near the bomb fill the defuse meter; it decays otherwise. */
  private updateDefusing(players: readonly BombPlayerView[], attackingTeam: string, events: BombEvent[]): void {
    const worker = this.someoneNear(players, (p) => p.team !== attackingTeam);
    this._workerId = worker;
    if (this.meter.advance(worker !== null) !== "completed") return;

    this._phase = "defused";
    events.push({
      kind: "defused",
      entityId: worker ?? undefined,
      siteId: this._siteId ?? undefined,
      position: this._position,
    });
  }

  /**
   * The first living player matching `predicate` within the arm/defuse radius,
   * or null. Numbers deliberately do not stack — five attackers arm no faster
   * than one, so a site cannot be taken by weight of bodies alone.
   *
   * Returning WHO rather than merely whether is what lets the arm and the
   * defuse be credited. Progress is shared, so there is no single owner of the
   * work; the person standing on it when it completes is the fair answer and
   * the only one a player would recognise.
   */
  private someoneNear(players: readonly BombPlayerView[], predicate: (p: BombPlayerView) => boolean): number | null {
    const radiusSq = this.rules.armDefuseRadius * this.rules.armDefuseRadius;
    for (const player of players) {
      if (!player.alive || !predicate(player)) continue;
      if (this.distanceSqTo(player.position) <= radiusSq) return player.entityId;
    }
    return null;
  }

  private distanceSqTo(point: Vec3Like): number {
    const dx = point.x - this._position.x;
    const dy = point.y - this._position.y;
    const dz = point.z - this._position.z;
    return dx * dx + dy * dy + dz * dz;
  }
}
