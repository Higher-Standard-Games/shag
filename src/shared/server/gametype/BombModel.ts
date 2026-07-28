/**
 * BombModel — the Search & Destroy bomb, as rules rather than as an entity.
 *
 * Everything the bomb does is here: who may carry it, when it drops, when it
 * arms, when it defuses, when it detonates. Nothing here touches `WorldState`,
 * spawns entities, or plays a sound — the caller feeds it a view of the world
 * each tick and applies the events it returns.
 *
 * That split exists because these rules are fiddly and interact (a carrier who
 * dies mid-plant, a bomb dropped outside a site, two defenders defusing at
 * once), and rules of that shape are far cheaper to get right against a table of
 * cases than against a running server.
 *
 * The distinctive rule, and the reason this is not a Counter-Strike clone:
 * **there is no plant button.** A carrier inside a bombsite whose horizontal
 * speed falls below `dropSpeedThreshold` drops the bomb at their feet, and that
 * is the plant initiation (docs/research/Search_And_Destroy.md §5.3). Outside a
 * site the rule does not apply, so crossing the map is never a movement skill
 * check and a bad landing cannot cost you the bomb.
 */

import type { BombSite, Vec3Like } from "../../bsp/BombSiteTable";
import { isInsideBombSite } from "../../bsp/BombSiteTable";
import { type ChannelRequest, ChannelTracker } from "../simulation/ChannelledAction";

export type BombPhase =
  /** Held by an attacker. */
  | "carried"
  /** Lying in the world — droppable anywhere, armable only inside a site. */
  | "dropped"
  /** Planted and counting down. */
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
  /** Horizontal speed in units/sec. Vertical motion is not a plant signal. */
  horizontalSpeed: number;
  alive: boolean;
}

export interface BombRules {
  /** Touch radius for picking the bomb up. */
  pickupRadius: number;
  /** Below this horizontal speed, a carrier inside a site drops the bomb. */
  dropSpeedThreshold: number;
  /** Ticks of holding to arm. */
  armTicks: number;
  /** Ticks of holding to defuse. */
  defuseTicks: number;
  /** Ticks from arming to detonation. */
  detonateTicks: number;
}

/** Warsow-shaped defaults at 125 Hz (§4.2). */
export const DEFAULT_BOMB_RULES: BombRules = {
  pickupRadius: 64,
  dropSpeedThreshold: 100,
  armTicks: 4 * 125,
  defuseTicks: 5 * 125,
  detonateTicks: 35 * 125,
};

export type BombEventKind =
  | "picked_up"
  | "dropped"
  | "armed"
  | "defused"
  | "detonated"
  | "arm_started"
  | "arm_cancelled"
  | "defuse_started"
  | "defuse_cancelled";

export interface BombEvent {
  kind: BombEventKind;
  /** Player responsible, where there is one. */
  entityId?: number;
  /** Site involved, for arm/defuse/detonate. */
  siteId?: number;
  position?: Vec3Like;
}

/**
 * The bomb's authoritative state.
 *
 * `update()` is the only mutator, so a round's bomb behaviour is a pure
 * function of the tick sequence fed to it — which is what makes it testable and
 * what keeps demo re-simulation honest.
 */
export class BombModel {
  private _phase: BombPhase = "dropped";
  private _position: Vec3Like = { x: 0, y: 0, z: 0 };
  private _carrierId: number | null = null;
  private _siteId: number | null = null;
  private _armedAtTick = 0;
  private readonly channels = new ChannelTracker();
  private readonly rules: BombRules;

  constructor(rules: Partial<BombRules> = {}) {
    this.rules = { ...DEFAULT_BOMB_RULES, ...rules };
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
  /** Site the bomb is armed at, or null. */
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

  /** Ticks until detonation, or null when not armed. */
  ticksUntilDetonation(tick: number): number | null {
    if (this._phase !== "armed") return null;
    return Math.max(0, this._armedAtTick + this.rules.detonateTicks - tick);
  }

  /** Arm/defuse progress 0..1 for a player, for the HUD. */
  progressFor(entityId: number): number {
    return this.channels.progress(entityId);
  }

  /** Place the bomb on the ground to start a round. */
  reset(position: Vec3Like): void {
    this._phase = "dropped";
    this._position = { ...position };
    this._carrierId = null;
    this._siteId = null;
    this._armedAtTick = 0;
    this.channels.clearAll();
  }

  /**
   * Advance the bomb by one tick.
   *
   * Order matters and is deliberate: resolve carry state first (a dead carrier
   * drops before anything else can happen), then arming/defusing, then the
   * detonation deadline last — so a defuse completing on the same tick the
   * timer expires wins. Defenders getting there at the last possible instant is
   * the most memorable thing that happens in this mode; it should not lose to
   * an ordering accident.
   */
  update(
    tick: number,
    players: readonly BombPlayerView[],
    sites: readonly BombSite[],
    attackingTeam: string,
  ): BombEvent[] {
    const events: BombEvent[] = [];
    if (this.isResolved) return events;

    if (this._phase === "carried") {
      this.updateCarried(players, sites, events);
    } else if (this._phase === "dropped") {
      this.updateDropped(players, sites, attackingTeam, events);
    }

    if (this._phase === "dropped" || this._phase === "armed") {
      this.updateChannels(tick, players, sites, attackingTeam, events);
    }

    if (this._phase === "armed" && (this.ticksUntilDetonation(tick) ?? 0) <= 0) {
      this._phase = "detonated";
      events.push({ kind: "detonated", siteId: this._siteId ?? undefined, position: this._position });
    }
    return events;
  }

  /** Carried: follow the carrier, drop on death or on slowing inside a site. */
  private updateCarried(players: readonly BombPlayerView[], sites: readonly BombSite[], events: BombEvent[]): void {
    const carrier = players.find((p) => p.entityId === this._carrierId);

    // Carrier gone or dead — the bomb falls where they did.
    if (!carrier || !carrier.alive) {
      this.drop(carrier?.position ?? this._position, events, carrier?.entityId);
      return;
    }

    this._position = { ...carrier.position };

    // THE plant initiation: slow down inside a site and the bomb goes down.
    // Only inside a site, so carrying it across the map is safe.
    const site = sites.find((s) => isInsideBombSite(s, carrier.position));
    if (site && carrier.horizontalSpeed < this.rules.dropSpeedThreshold) {
      this.drop(carrier.position, events, carrier.entityId);
    }
  }

  /**
   * Dropped OUTSIDE a site: any living attacker who touches it picks it up.
   *
   * Inside a site it is not retrievable — it is a bomb being planted, and
   * standing on it arms it instead. Without that rule planting is impossible:
   * the carrier drops the bomb by slowing down and would instantly pick it back
   * up on the same spot. It also means a bomb cannot be relocated from site A
   * to site B once committed, which is the right trade.
   */
  private updateDropped(
    players: readonly BombPlayerView[],
    sites: readonly BombSite[],
    attackingTeam: string,
    events: BombEvent[],
  ): void {
    if (sites.some((site) => isInsideBombSite(site, this._position))) return;

    const radiusSq = this.rules.pickupRadius * this.rules.pickupRadius;
    for (const player of players) {
      if (!player.alive || player.team !== attackingTeam) continue;
      const dx = player.position.x - this._position.x;
      const dy = player.position.y - this._position.y;
      const dz = player.position.z - this._position.z;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;

      this._phase = "carried";
      this._carrierId = player.entityId;
      this.channels.clearAll();
      events.push({ kind: "picked_up", entityId: player.entityId, position: this._position });
      return;
    }
  }

  /**
   * Arming (dropped, in a site, attacker) and defusing (armed, defender).
   *
   * Every player is evaluated every tick and handed either a request or null,
   * which is what makes interruption automatic — see ChannelledAction.
   */
  private updateChannels(
    tick: number,
    players: readonly BombPlayerView[],
    sites: readonly BombSite[],
    attackingTeam: string,
    events: BombEvent[],
  ): void {
    const arming = this._phase === "dropped";
    const site = arming
      ? sites.find((s) => isInsideBombSite(s, this._position))
      : sites.find((s) => s.id === this._siteId);

    for (const player of players) {
      const request = this.channelRequestFor(player, site, arming, attackingTeam);
      const outcome = this.channels.update(player.entityId, request, tick);

      if (outcome.kind === "started") {
        events.push({
          kind: arming ? "arm_started" : "defuse_started",
          entityId: player.entityId,
          siteId: site?.id,
        });
      } else if (outcome.kind === "cancelled") {
        events.push({
          kind: outcome.channel?.kind === "arm" ? "arm_cancelled" : "defuse_cancelled",
          entityId: player.entityId,
        });
      } else if (outcome.kind === "completed") {
        if (arming && site) {
          this._phase = "armed";
          this._siteId = site.id;
          this._armedAtTick = tick;
          this._carrierId = null;
          this.channels.clearAll();
          events.push({ kind: "armed", entityId: player.entityId, siteId: site.id, position: this._position });
          return;
        }
        this._phase = "defused";
        this.channels.clearAll();
        events.push({ kind: "defused", entityId: player.entityId, siteId: this._siteId ?? undefined });
        return;
      }
    }
  }

  /** What this player could be channelling right now, or null. */
  private channelRequestFor(
    player: BombPlayerView,
    site: BombSite | undefined,
    arming: boolean,
    attackingTeam: string,
  ): ChannelRequest | null {
    if (!player.alive || !site) return null;

    // Arming is the attackers' job; defusing the defenders'.
    const onDuty = arming ? player.team === attackingTeam : player.team !== attackingTeam;
    if (!onDuty) return null;

    // Same radius for both, so a defuse is contested exactly where a plant was.
    if (!isInsideBombSite(site, player.position)) return null;

    return arming
      ? { kind: "arm", targetId: site.id, durationTicks: this.rules.armTicks }
      : { kind: "defuse", targetId: site.id, durationTicks: this.rules.defuseTicks };
  }

  private drop(position: Vec3Like, events: BombEvent[], entityId?: number): void {
    this._phase = "dropped";
    this._position = { ...position };
    this._carrierId = null;
    this.channels.clearAll();
    events.push({ kind: "dropped", entityId, position: this._position });
  }
}
