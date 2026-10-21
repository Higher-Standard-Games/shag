/**
 * DemoAnalyzer — Phase 1 cinematic highlight detection for .shagdemo files
 *
 * Scans a sequence of DemoFrames and produces scored HighlightCandidate objects
 * suitable for automated highlight reel generation.  The analyzer is pure
 * TypeScript with no external dependencies; it never touches Babylon.js or any
 * network I/O.
 *
 * Usage:
 *   const frames  = reader.readAllFrames();
 *   const header  = reader.readHeader();
 *   const index   = reader.readIndex();
 *   const result  = new DemoAnalyzer().analyze(frames, header, index.durationMs);
 */

import type { DemoFrame, DemoHeader } from "./DemoReader";

// ── Public types ─────────────────────────────────────────────────────────────

export type HighlightType = "frag" | "multi_kill" | "airborne_frag" | "streak_kill" | "first_blood" | "movement";

export type HighlightTag =
  | "airborne"
  | "rocket_jump"
  | "low_hp"
  | "close_range"
  | "long_range"
  | "multi_kill"
  | "revenge"
  | "first_blood"
  | "on_fire"
  | "raging"
  | "unstoppable"
  | "high_speed"
  | "trick_jump"
  | "height_gain"
  | "wall_jump"
  | "slide"
  | "bunny_hop";

export interface HighlightCandidate {
  startTick: number;
  peakTick: number;
  endTick: number;
  score: number;
  type: HighlightType;
  /** Entity ID of the primary actor (killer) */
  primaryPlayer: string;
  primaryPlayerName: string;
  victimPlayer?: string;
  victimPlayerName?: string;
  weaponId?: string;
  killCount?: number;
  tags: HighlightTag[];
  killerPos?: { x: number; y: number; z: number };
  victimPos?: { x: number; y: number; z: number };
  killerVelocity?: { x: number; y: number; z: number };
  /** Where the killer was looking at the frag: yaw in radians, forward = (sin, cos) on x/z. */
  killerYaw?: number;
  /** The victim was looking at the killer when the frag landed: they saw it coming. */
  victimFacedKiller?: boolean;
  /** A movement highlight's route, sampled about every 0.1 s, for a camera that follows it. */
  path?: Array<{ tick: number; x: number; y: number; z: number }>;
}

export interface DemoAnalysis {
  highlights: HighlightCandidate[];
  totalTicks: number;
  totalDurationMs: number;
  /** entityId → displayName */
  playerNames: Map<string, string>;
  /** entityId → frags over the whole demo (suicides and world deaths left out). */
  frags: Map<string, number>;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface TransformComponent {
  position: Vec3;
  /** View angles in radians: x pitch, y yaw. */
  rotation: { x: number; y: number; z: number };
}

/** How far off the line to the killer the victim may look and still have seen them. */
const FACING_CONE = Math.cos(Math.PI / 4);

interface VelocityComponent {
  x: number;
  y: number;
  z: number;
  linear: Vec3;
  grounded: boolean;
}

/** The movement fields a snapshot carries (BinaryProtocol's movementState). */
interface MovementStateComponent {
  isSliding?: boolean;
  wallJumpState?: string;
}

/** A stretch of fast movement in the air or on a slide, while it lasts. */
interface MovementRun {
  startTick: number;
  lastActiveTick: number;
  startY: number;
  maxY: number;
  maxYTick: number;
  maxSpeed: number;
  maxSpeedTick: number;
  wallJumpTicks: number[];
  slides: number;
  hops: number;
  wasSliding: boolean;
  wasGrounded: boolean;
  wasCharging: boolean;
  path: Array<{ tick: number; x: number; y: number; z: number }>;
  /** Position, velocity and view at each sampled tick, for the peak's camera. */
  frames: Map<number, { pos: Vec3; vel: Vec3; yaw?: number }>;
}

interface PlayerTracker {
  killStreak: number;
  lastKillTick: number;
  recentKills: Array<{ tick: number; victimId: string }>;
  lastDeathTick: number;
  lastKilledBy: string;
  consecutiveAirFrames: number;
  currentHealth: number;
  frags: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MULTI_KILL_WINDOW = 200; // ticks
const LEADIN_SECONDS = 3;
const FOLLOWTHROUGH_SECONDS = 2;
const LONG_RANGE_THRESHOLD = 1500;
const CLOSE_RANGE_THRESHOLD = 150;
/** Rising faster than a plain jump (270) or a wall jump (420) can: a rocket or a pad did that. */
const ROCKET_JUMP_VEL_Y = 450;
const HIGH_SPEED_THRESHOLD = 600;
const LOW_HP_THRESHOLD = 30;

// Movement highlights: trick jumps, slides and hop chains that don't end in a kill
/** Faster than sprinting (400): a run only counts while the player keeps above it. */
const MOVE_MIN_SPEED = 450;
/** How long a run may touch the ground between hops before it is over. */
const MOVE_GRACE_SECONDS = 0.35;
const MOVE_MIN_SECONDS = 1.2;
const MOVE_MAX_SECONDS = 8;
const MOVE_PAD_SECONDS = 0.5;
const MOVE_SAMPLE_SECONDS = 0.1;
/** Hops in one run that make a bunny-hop chain. */
const BUNNY_HOP_MIN = 3;
/** Height a wall-jump run climbs above where it started to count as a climb. */
const MOVE_HEIGHT_GAIN = 96;
const MOVE_HIGH_SPEED = 700;

// ── Score constants ──────────────────────────────────────────────────────────

const BASE_SCORE_FRAG = 10;
const BASE_SCORE_MOVEMENT = 5;

const TAG_MULTIPLIERS: Record<HighlightTag, number> = {
  airborne: 1.5,
  rocket_jump: 1.8,
  low_hp: 1.3,
  close_range: 1.1,
  long_range: 1.2,
  multi_kill: 1.0, // handled separately via killCount
  revenge: 1.1,
  first_blood: 1.5,
  on_fire: 1.2,
  raging: 1.4,
  unstoppable: 1.6,
  high_speed: 1.2,
  trick_jump: 1.3,
  height_gain: 1.2,
  wall_jump: 1.3,
  slide: 1.1,
  bunny_hop: 1.2,
};

// ── DemoAnalyzer ─────────────────────────────────────────────────────────────

export class DemoAnalyzer {
  /**
   * Analyze a sequence of frames and return scored highlight candidates.
   *
   * @param frames      - All frames from DemoReader.readAllFrames()
   * @param header      - Demo header (player roster, server tick rate)
   * @param durationMs  - Total demo duration from DemoIndex.durationMs
   */
  analyze(frames: DemoFrame[], header: DemoHeader, durationMs: number): DemoAnalysis {
    if (frames.length === 0) {
      return {
        highlights: [],
        totalTicks: 0,
        totalDurationMs: durationMs,
        playerNames: new Map(),
        frags: new Map(),
      };
    }

    const tickRate = header.tickRate > 0 ? header.tickRate : 20;
    const leadin = Math.round(LEADIN_SECONDS * tickRate);
    const followthrough = Math.round(FOLLOWTHROUGH_SECONDS * tickRate);

    const lastTick = frames[frames.length - 1].tick;
    const firstTick = frames[0].tick;
    const totalTicks = lastTick - firstTick + 1;

    // ── 1. Build player name map ──────────────────────────────────────
    const playerNames = this._buildPlayerNames(frames, header);

    // ── 2. Initialise per-player trackers ─────────────────────────────
    const trackers = new Map<string, PlayerTracker>();
    const getTracker = (entityId: string): PlayerTracker => {
      let t = trackers.get(entityId);
      if (!t) {
        t = {
          killStreak: 0,
          lastKillTick: -1,
          recentKills: [],
          lastDeathTick: -1,
          lastKilledBy: "",
          consecutiveAirFrames: 0,
          currentHealth: 100,
          frags: 0,
        };
        trackers.set(entityId, t);
      }
      return t;
    };

    // ── 3. Main pass — collect raw frag candidates ────────────────────
    const rawFrags: HighlightCandidate[] = [];
    /** Each player's view yaw as last drawn: a victim has left the frame that carries their death. */
    const lastYaw = new Map<string, number>();
    const runs = new Map<string, MovementRun>();
    const moves: HighlightCandidate[] = [];

    for (const frame of frames) {
      const { tick, state } = frame;

      // -- 3a. Update health from combat_state events --
      for (const ev of state.events) {
        if (ev.type === "combat_state") {
          const entityId = ev.entityId as string;
          if (entityId) {
            const t = getTracker(entityId);
            t.currentHealth = ev.health as number;
          }
        }
      }

      // -- 3b. Collect award types fired this frame --
      const frameAwardsByPlayer = new Map<string, Set<string>>();
      for (const ev of state.events) {
        if (ev.type === "award") {
          const playerId = ev.playerId as string;
          const entityId = `player_${playerId}`;
          if (!frameAwardsByPlayer.has(entityId)) {
            frameAwardsByPlayer.set(entityId, new Set());
          }
          frameAwardsByPlayer.get(entityId)!.add(ev.awardType as string);
        }
      }

      // -- 3c. Process death events --
      for (const ev of state.events) {
        if (ev.type !== "death") continue;

        const victimId = ev.entityId as string;
        const killerId = ev.killerId as string;
        const weaponId = (ev.weaponId as string) || undefined;

        if (!killerId || killerId === victimId) continue; // self-kill / suicide

        const killerTracker = getTracker(killerId);
        const victimTracker = getTracker(victimId);

        // Victim position from event payload
        const victimPos: Vec3 = {
          x: (ev.x as number) ?? 0,
          y: (ev.y as number) ?? 0,
          z: (ev.z as number) ?? 0,
        };

        // Killer position + velocity from entity components
        let killerPos: Vec3 | undefined;
        let killerVelocity: Vec3 | undefined;
        let killerGrounded = true;
        let killerYaw: number | undefined;
        let killerLinearY = 0;

        const killerEntity = state.entities.get(killerId);
        if (killerEntity) {
          const transform = killerEntity.getComponent("transform") as TransformComponent | undefined;
          const velocity = killerEntity.getComponent("velocity") as VelocityComponent | undefined;

          if (transform) {
            killerPos = { ...transform.position };
          }
          killerYaw = transform?.rotation?.y ?? lastYaw.get(killerId);
          if (velocity) {
            killerGrounded = velocity.grounded;
            killerLinearY = velocity.linear?.y ?? velocity.y ?? 0;
            killerVelocity = {
              x: velocity.linear?.x ?? velocity.x ?? 0,
              y: velocity.linear?.y ?? velocity.y ?? 0,
              z: velocity.linear?.z ?? velocity.z ?? 0,
            };
          }
        }

        // Did the victim see it coming: looking at the killer, within the cone
        let victimFacedKiller: boolean | undefined;
        const victimTransform = state.entities.get(victimId)?.getComponent("transform") as
          | TransformComponent
          | undefined;
        const victimYaw = victimTransform?.rotation?.y ?? lastYaw.get(victimId);
        if (killerPos && typeof victimYaw === "number") {
          const toX = killerPos.x - victimPos.x;
          const toZ = killerPos.z - victimPos.z;
          const length = Math.hypot(toX, toZ);
          if (length > 0) {
            const yaw = victimYaw;
            victimFacedKiller = (Math.sin(yaw) * toX + Math.cos(yaw) * toZ) / length >= FACING_CONE;
          }
        }

        // ── Tag detection ─────────────────────────────────────────────
        const tags: HighlightTag[] = [];

        // Airborne / rocket_jump
        if (!killerGrounded) {
          if (killerLinearY > ROCKET_JUMP_VEL_Y) {
            tags.push("rocket_jump");
          } else {
            tags.push("airborne");
          }
        }

        // Distance-based tags
        if (killerPos) {
          const dx = killerPos.x - victimPos.x;
          const dy = killerPos.y - victimPos.y;
          const dz = killerPos.z - victimPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > LONG_RANGE_THRESHOLD) {
            tags.push("long_range");
          } else if (dist < CLOSE_RANGE_THRESHOLD) {
            tags.push("close_range");
          }
        }

        // Low HP (killer)
        if (killerTracker.currentHealth > 0 && killerTracker.currentHealth <= LOW_HP_THRESHOLD) {
          tags.push("low_hp");
        }

        // Revenge: victim killed the killer last time
        if (
          killerTracker.lastDeathTick >= 0 &&
          victimTracker.lastKillTick >= 0 &&
          killerTracker.lastKilledBy === victimId
        ) {
          tags.push("revenge");
        }

        // High speed
        if (killerVelocity) {
          const horizSpeed = Math.sqrt(killerVelocity.x * killerVelocity.x + killerVelocity.z * killerVelocity.z);
          if (horizSpeed > HIGH_SPEED_THRESHOLD) {
            tags.push("high_speed");
          }
        }

        // Award-based tags
        const awards = frameAwardsByPlayer.get(killerId);
        if (awards) {
          if (awards.has("first_blood")) tags.push("first_blood");
          if (awards.has("on_fire")) tags.push("on_fire");
          if (awards.has("raging")) tags.push("raging");
          if (awards.has("unstoppable")) tags.push("unstoppable");
        }

        // ── Build candidate ───────────────────────────────────────────
        const primaryPlayerName = playerNames.get(killerId) ?? killerId;
        const victimPlayerName = playerNames.get(victimId) ?? victimId;

        const highlightType: HighlightType =
          tags.includes("rocket_jump") || tags.includes("airborne")
            ? "airborne_frag"
            : tags.includes("first_blood")
              ? "first_blood"
              : "frag";

        const candidate: HighlightCandidate = {
          startTick: tick, // will be expanded after grouping
          peakTick: tick,
          endTick: tick, // will be expanded after grouping
          score: 0, // computed later
          type: highlightType,
          primaryPlayer: killerId,
          primaryPlayerName,
          victimPlayer: victimId,
          victimPlayerName,
          weaponId,
          tags,
          killerPos,
          victimPos,
          killerVelocity,
          ...(killerYaw === undefined ? {} : { killerYaw }),
          ...(victimFacedKiller === undefined ? {} : { victimFacedKiller }),
        };

        rawFrags.push(candidate);

        // Update trackers
        killerTracker.killStreak += 1;
        killerTracker.frags += 1;
        killerTracker.lastKillTick = tick;
        killerTracker.recentKills.push({ tick, victimId });

        victimTracker.lastDeathTick = tick;
        victimTracker.lastKilledBy = killerId;
        victimTracker.killStreak = 0;
      }

      // -- 3d. Per-entity movement tracking --
      for (const [entityId, entity] of state.entities) {
        if (!entityId.startsWith("player_")) continue;
        const yaw = (entity.getComponent("transform") as TransformComponent | undefined)?.rotation?.y;
        if (typeof yaw === "number") lastYaw.set(entityId, yaw);
        const velocity = entity.getComponent("velocity") as VelocityComponent | undefined;
        if (!velocity) continue;

        const t = getTracker(entityId);
        if (!velocity.grounded) {
          t.consecutiveAirFrames += 1;
        } else {
          t.consecutiveAirFrames = 0;
        }

        const position = (entity.getComponent("transform") as TransformComponent | undefined)?.position;
        if (position) {
          const finished = this._trackMovement(runs, entityId, entity, velocity, position, yaw, tick, tickRate);
          if (finished) moves.push(finished);
        }
      }

      // A player who left the frame (died, disconnected) ends their run there
      for (const [entityId, run] of runs) {
        if (state.entities.has(entityId)) continue;
        runs.delete(entityId);
        const finished = this._finishRun(run, entityId, tickRate);
        if (finished) moves.push(finished);
      }
    }

    for (const [entityId, run] of runs) {
      const finished = this._finishRun(run, entityId, tickRate);
      if (finished) moves.push(finished);
    }

    // ── 4. Multi-kill grouping ────────────────────────────────────────
    const grouped = this._groupMultiKills(rawFrags);

    // ── 5. Expand context windows ─────────────────────────────────────
    for (const c of grouped) {
      c.startTick = Math.max(firstTick, c.peakTick - leadin);
      c.endTick = Math.min(lastTick, c.peakTick + followthrough);
    }

    // ── 6. Compute scores ─────────────────────────────────────────────
    for (const c of grouped) {
      c.score = this._computeScore(c);
    }
    for (const m of moves) {
      m.startTick = Math.max(firstTick, m.startTick);
      m.endTick = Math.min(lastTick, m.endTick);
      m.score = this._computeScore(m);
    }

    // ── 7. Deduplicate overlapping candidates ─────────────────────────
    // Frags and movement are separate pools: the reel cuts movement clips in
    // between frag scenes, so a run never has to outscore a frag to be kept
    const deduped = [
      ...this._deduplicateOverlapping(grouped),
      ...this._deduplicateOverlapping(moves.map((m) => this._withNamesOf(m, playerNames))),
    ];

    // ── 8. Sort by score descending ───────────────────────────────────
    deduped.sort((a, b) => b.score - a.score);

    return {
      highlights: deduped,
      totalTicks,
      totalDurationMs: durationMs,
      playerNames,
      frags: new Map([...trackers].filter(([, t]) => t.frags > 0).map(([id, t]) => [id, t.frags])),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _buildPlayerNames(frames: DemoFrame[], header: DemoHeader): Map<string, string> {
    const names = new Map<string, string>();

    // Primary: use header roster
    for (const p of header.players) {
      names.set(`player_${p.playerId}`, p.name);
    }

    // Fallback: scan frames for player entities not in header
    for (const frame of frames) {
      for (const [entityId] of frame.state.entities) {
        if (entityId.startsWith("player_") && !names.has(entityId)) {
          // Derive the playerId portion and look up in players map
          const rawId = entityId.slice("player_".length);
          const playerState = frame.state.players.get(rawId);
          if (playerState?.name) {
            names.set(entityId, playerState.name);
          } else {
            names.set(entityId, entityId);
          }
        }
      }
    }

    return names;
  }

  private _groupMultiKills(frags: HighlightCandidate[]): HighlightCandidate[] {
    if (frags.length === 0) return [];

    // Group frags by primaryPlayer
    const byPlayer = new Map<string, HighlightCandidate[]>();
    for (const f of frags) {
      let arr = byPlayer.get(f.primaryPlayer);
      if (!arr) {
        arr = [];
        byPlayer.set(f.primaryPlayer, arr);
      }
      arr.push(f);
    }

    const result: HighlightCandidate[] = [];

    for (const [, playerFrags] of byPlayer) {
      // Sort by peakTick
      playerFrags.sort((a, b) => a.peakTick - b.peakTick);

      let i = 0;
      while (i < playerFrags.length) {
        // Collect a run of frags within the window
        const group: HighlightCandidate[] = [playerFrags[i]];
        let j = i + 1;
        while (j < playerFrags.length && playerFrags[j].peakTick - playerFrags[i].peakTick <= MULTI_KILL_WINDOW) {
          group.push(playerFrags[j]);
          j++;
        }

        if (group.length >= 2) {
          // Merge into a multi-kill
          const first = group[0];
          const last = group[group.length - 1];

          // Collect all unique tags across the group
          const tagSet = new Set<HighlightTag>();
          for (const g of group) {
            for (const t of g.tags) tagSet.add(t);
          }
          tagSet.add("multi_kill");

          const merged: HighlightCandidate = {
            startTick: first.startTick,
            peakTick: last.peakTick,
            endTick: last.endTick,
            score: 0,
            type: "multi_kill",
            primaryPlayer: first.primaryPlayer,
            primaryPlayerName: first.primaryPlayerName,
            // Keep last victim as the representative victim
            victimPlayer: last.victimPlayer,
            victimPlayerName: last.victimPlayerName,
            weaponId: last.weaponId,
            killCount: group.length,
            tags: Array.from(tagSet),
            killerPos: last.killerPos,
            victimPos: last.victimPos,
            killerVelocity: last.killerVelocity,
            ...(last.killerYaw === undefined ? {} : { killerYaw: last.killerYaw }),
          };
          result.push(merged);
        } else {
          result.push(group[0]);
        }

        i = j;
      }
    }

    return result;
  }

  /**
   * Follow one player's movement for a frame. A run starts when they go
   * faster than sprinting in the air or on a slide, and carries on through
   * brief touches of the ground between hops. Returns the highlight when a
   * run ends worth keeping.
   */
  private _trackMovement(
    runs: Map<string, MovementRun>,
    entityId: string,
    entity: { getComponent(name: string): unknown },
    velocity: VelocityComponent,
    position: Vec3,
    yaw: number | undefined,
    tick: number,
    tickRate: number,
  ): HighlightCandidate | null {
    const movement = entity.getComponent("movementState") as MovementStateComponent | undefined;
    const sliding = movement?.isSliding ?? false;
    const charging = movement?.wallJumpState === "charging";
    const vel: Vec3 = {
      x: velocity.linear?.x ?? velocity.x ?? 0,
      y: velocity.linear?.y ?? velocity.y ?? 0,
      z: velocity.linear?.z ?? velocity.z ?? 0,
    };
    const speed = Math.hypot(vel.x, vel.z);
    // A wall jump's charge holds the player still on the wall: it keeps the run alive
    const active = (speed >= MOVE_MIN_SPEED && (!velocity.grounded || sliding)) || charging;

    let run = runs.get(entityId);
    let finished: HighlightCandidate | null = null;
    if (run && tick - run.lastActiveTick > MOVE_GRACE_SECONDS * tickRate) {
      runs.delete(entityId);
      finished = this._finishRun(run, entityId, tickRate);
      run = undefined;
    }
    if (!run && active) run = this._startRun(runs, entityId, position, velocity.grounded, tick);
    if (run) {
      if (active) run.lastActiveTick = tick;
      this._stepRun(run, position, vel, speed, yaw, sliding, charging, velocity.grounded, tick, tickRate);
    }
    return finished;
  }

  private _startRun(
    runs: Map<string, MovementRun>,
    entityId: string,
    position: Vec3,
    grounded: boolean,
    tick: number,
  ): MovementRun {
    const run: MovementRun = {
      startTick: tick,
      lastActiveTick: tick,
      startY: position.y,
      maxY: position.y,
      maxYTick: tick,
      maxSpeed: 0,
      maxSpeedTick: tick,
      wallJumpTicks: [],
      slides: 0,
      hops: 0,
      wasSliding: false,
      wasGrounded: grounded,
      wasCharging: false,
      path: [],
      frames: new Map(),
    };
    runs.set(entityId, run);
    return run;
  }

  private _stepRun(
    run: MovementRun,
    position: Vec3,
    vel: Vec3,
    speed: number,
    yaw: number | undefined,
    sliding: boolean,
    charging: boolean,
    grounded: boolean,
    tick: number,
    tickRate: number,
  ): void {
    if (sliding && !run.wasSliding) run.slides += 1;
    if (charging && !run.wasCharging) run.wallJumpTicks.push(tick);
    if (!grounded && run.wasGrounded) run.hops += 1;
    run.wasSliding = sliding;
    run.wasCharging = charging;
    run.wasGrounded = grounded;
    if (position.y > run.maxY) {
      run.maxY = position.y;
      run.maxYTick = tick;
    }
    if (speed > run.maxSpeed) {
      run.maxSpeed = speed;
      run.maxSpeedTick = tick;
    }
    const last = run.path.at(-1);
    if (!last || tick - last.tick >= MOVE_SAMPLE_SECONDS * tickRate) {
      run.path.push({ tick, x: position.x, y: position.y, z: position.z });
      run.frames.set(tick, { pos: { ...position }, vel, ...(yaw === undefined ? {} : { yaw }) });
    }
  }

  /** A finished run, as a highlight if it was more than just running fast. */
  private _finishRun(run: MovementRun, entityId: string, tickRate: number): HighlightCandidate | null {
    const seconds = (run.lastActiveTick - run.startTick) / tickRate;
    if (seconds < MOVE_MIN_SECONDS || run.path.length < 2) return null;

    const tags: HighlightTag[] = [];
    const wallJumps = run.wallJumpTicks.length;
    if (wallJumps > 0) tags.push("wall_jump");
    if (run.slides > 0) tags.push("slide");
    if (run.hops >= BUNNY_HOP_MIN) tags.push("bunny_hop");
    // A climb only counts off the walls: a jump pad gains height for anyone
    const climbed = wallJumps > 0 && run.maxY - run.startY >= MOVE_HEIGHT_GAIN;
    if (climbed) tags.push("height_gain");
    if (run.maxSpeed >= MOVE_HIGH_SPEED) tags.push("high_speed");
    const techniques = tags.filter((tag) => tag === "wall_jump" || tag === "slide" || tag === "bunny_hop").length;
    if (techniques >= 2) tags.push("trick_jump");
    // Sliding into one hop is everyday movement; keep runs with a trick in them
    if (
      wallJumps === 0 &&
      run.hops < BUNNY_HOP_MIN &&
      !(run.slides > 0 && run.hops > 0) &&
      !tags.includes("high_speed")
    ) {
      return null;
    }

    const peakTick = climbed ? run.maxYTick : wallJumps > 0 ? run.wallJumpTicks[0] : run.maxSpeedTick;
    const end = Math.min(run.lastActiveTick, run.startTick + Math.round(MOVE_MAX_SECONDS * tickRate));
    const path = run.path.filter((p) => p.tick <= end);
    // The camera frames the peak from the nearest sample
    const nearest = path.reduce((best, p) => (Math.abs(p.tick - peakTick) < Math.abs(best.tick - peakTick) ? p : best));
    const at = run.frames.get(nearest.tick);
    const pad = Math.round(MOVE_PAD_SECONDS * tickRate);

    return {
      startTick: run.startTick - pad,
      peakTick: Math.min(peakTick, end),
      endTick: end + pad,
      score: 0,
      type: "movement",
      primaryPlayer: entityId,
      primaryPlayerName: entityId,
      tags,
      killerPos: at?.pos ?? { x: nearest.x, y: nearest.y, z: nearest.z },
      ...(at ? { killerVelocity: at.vel } : {}),
      ...(at?.yaw === undefined ? {} : { killerYaw: at.yaw }),
      path,
    };
  }

  private _withNamesOf(candidate: HighlightCandidate, names: Map<string, string>): HighlightCandidate {
    candidate.primaryPlayerName = names.get(candidate.primaryPlayer) ?? candidate.primaryPlayer;
    return candidate;
  }

  private _computeScore(candidate: HighlightCandidate): number {
    const isMovement = candidate.type === "movement";
    let score = isMovement ? BASE_SCORE_MOVEMENT : BASE_SCORE_FRAG;

    // Apply tag multipliers — rocket_jump overrides airborne
    const tags = candidate.tags;
    const hasRocketJump = tags.includes("rocket_jump");

    for (const tag of tags) {
      if (tag === "airborne" && hasRocketJump) continue; // rocket_jump supersedes airborne
      if (tag === "multi_kill") continue; // handled via killCount below
      score *= TAG_MULTIPLIERS[tag];
    }

    // Multi-kill bonus: ×(1 + 0.5 * (killCount - 1))
    if (candidate.killCount !== undefined && candidate.killCount > 1) {
      score *= 1 + 0.5 * (candidate.killCount - 1);
    }

    return Math.round(score * 100) / 100; // round to 2dp
  }

  private _deduplicateOverlapping(candidates: HighlightCandidate[]): HighlightCandidate[] {
    // Sort by score descending so we always keep the better candidate
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const kept: HighlightCandidate[] = [];

    for (const candidate of sorted) {
      const overlaps = kept.some((k) => candidate.startTick <= k.endTick && candidate.endTick >= k.startTick);
      if (!overlaps) {
        kept.push(candidate);
      }
    }

    return kept;
  }
}
