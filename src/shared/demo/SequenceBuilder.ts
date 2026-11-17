/**
 * SequenceBuilder — the highlight reel's shot list
 *
 * Takes a DemoAnalysis (scored highlights) and a target duration, then
 * selects highlights and films each one as a scene of shots:
 *
 *   1. intro   — a third-person fly-by up to the frag, slowing as it lands
 *   2. pov     — the same moment again from the killer's (or victim's) eyes
 *   3. ending  — a slow orbit round the frag, then the scene's end effect
 *
 * A frag sequence (one player's frags chained over several seconds) is
 * filmed as it happened instead: a camera chasing the killer between frags,
 * the killer's eyes for each frag with a counter stamped on it, then the
 * ending orbit round the last one.
 *
 * Between frag scenes go a few movement clips (wall jumps, slides, hop
 * chains): a camera following the run, then the same run from the player's
 * eyes.
 *
 * Each transition means one thing: a white flash rewinds to see the moment
 * again, speed lines jump ahead in time, a crossfade turns to another angle
 * on the same moment and a fade to black ends a scene.
 * Pure TypeScript, no external dependencies.
 */

import type { DemoAnalysis, HighlightCandidate } from "./DemoAnalyzer";
import type { DemoHeader } from "./DemoReader";

// ── Exported types ────────────────────────────────────────────────────────────

export type CameraPresetId =
  | "chase_hero" // spectator eye on the killer
  | "orbit_kill" // freefly orbit around action midpoint
  | "rocket_jump_hero" // freefly below jump arc, looking up
  | "victim_pov" // spectator eye on the victim before death
  | "dramatic_zoom" // freefly wide→tight dolly
  | "replay_orbit" // slow orbit for instant replay
  | "trick_follow"; // freefly trailing a player along their route

export type TransitionType = "cut" | "crossfade" | "white_flash" | "fade_to_black" | "speed_wipe";

/** Which of a scene's shots a segment is. */
export type SceneRole = "intro" | "pov" | "ending";

/**
 * A change of playback speed. The speed eases from the one before over the
 * `ramp` ticks up to `tick`, and holds from `tick` on; with no ramp it
 * changes at `tick`.
 */
export interface SpeedKeyframe {
  tick: number;
  speed: number;
  ramp?: number;
}

/** The picture held still as a comic panel, with a caption. */
export interface ReelFreeze {
  tick: number;
  ms: number;
  caption: string;
}

/** A counter stamped on the picture as a frag lands. */
export interface ReelStamp {
  tick: number;
  text: string;
}

export interface CinematicSegment {
  startTick: number;
  endTick: number;
  durationMs: number; // wall-clock ms at the segment's speeds, freeze included
  cameraPreset: CameraPresetId;
  cameraTarget?: string; // entity ID for chase-cam presets
  /** The victim a fly-by frames with the killer, when not the highlight's own. */
  victimTarget?: string;
  playbackSpeed: number;
  speedKeyframes?: SpeedKeyframe[];
  highlight: HighlightCandidate;
  isReplay: boolean;
  segmentIndex: number;
  /** The scene (one highlight) this shot belongs to, 0-based. */
  scene: number;
  role: SceneRole;
  transitionIn: TransitionType;
  transitionOut: TransitionType;
  transitionDurationMs: number;
  freeze?: ReelFreeze;
  stamps?: ReelStamp[];
  /**
   * Reel time (from the start of the title card) the shot ends at, set when
   * its cut is placed on a beat of the music. The shot runs on past its
   * planned end to reach it.
   */
  cutAtMs?: number;
}

export interface CinematicReel {
  segments: CinematicSegment[];
  totalDurationMs: number;
  totalSegments: number;
  /** Highlights in the reel; each is one scene of several shots. */
  totalScenes: number;
  tickRate: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** About how long one scene runs, all three shots, for the selection budget. */
const AVG_SCENE_MS = 11000;
/** A frag sequence's ending orbit and its way out, past its own window, for the selection budget. */
const SEQUENCE_ENDING_MS = 3500;
/** About how long a movement clip runs, both shots. */
const AVG_MOVE_MS = 8000;
/** At most this many movement clips in a row between two frag scenes. */
const MAX_MOVES_PER_GAP = 2;
/** The eyes shot of a movement clip: this long either side of its peak. */
const MOVE_POV_SECONDS = 1.5;
const OVERLAP_BUFFER_SECONDS = 3;
const DEFAULT_TRANSITION_MS = 500;
/** The rewind from the fly-by into the player's eyes: quick, so it reads as one beat. */
const REWIND_FLASH_MS = 300;
/** Speed lines either side of a cut that jumps ahead. */
const SPEED_WIPE_MS = 380;
/** How long a change into or out of slow motion takes, in game seconds. */
const SPEED_RAMP_SECONDS = 0.2;

/** The intro starts this long before the frag (a rocket jump from the start of its window). */
const INTRO_LEADIN_SECONDS = 2;
/** The intro slows to INTRO_SLOW_SPEED this long before the frag lands. */
const INTRO_SLOW_SECONDS = 0.6;
const INTRO_SLOW_SPEED = 0.35;
/** The eyes shot starts this long before the frag and runs to the highlight's end. */
const POV_LEADIN_SECONDS = 2;
/** The victim's eyes slow this long before the frag; the shot ends on it. */
const VICTIM_SLOW_SECONDS = 0.35;
const VICTIM_SLOW_SPEED = 0.45;
/** The ending orbit: from just before the frag to a moment after, slowly. */
const ENDING_BEFORE_SECONDS = 0.3;
const ENDING_AFTER_SECONDS = 1.2;
const ENDING_SPEED = 0.4;

/** A frag sequence: the killer's eyes from this long before each frag to this long after. */
const SEQ_EYES_BEFORE_SECONDS = 1.2;
const SEQ_EYES_AFTER_SECONDS = 0.5;
/** Frags closer than this between their eyes shots share one. */
const SEQ_MERGE_GAP_SECONDS = 0.8;
/** The chase between two frags runs at most this long; a longer gap jumps ahead. */
const SEQ_CHASE_MAX_SECONDS = 3;
/** A chase between frags plays this fast, back to full speed by the next frag. */
const SEQ_CHASE_SPEED = 1.35;
/** An opening chase shorter than this is left out. */
const SEQ_CHASE_MIN_SECONDS = 0.8;

/** How long a freeze frame holds, and how many a reel has: this many, while it has the frag scenes. */
const FREEZE_MS = 1400;
const FREEZE_COUNT = 3;
/** A freeze lands just after the frag, when the hit is on screen. */
const FREEZE_AFTER_SECONDS = 0.1;

/** How a scene can end; the reel's last scene always fades to black. */
const END_EFFECTS: readonly TransitionType[] = ["fade_to_black", "white_flash", "crossfade"];

// ── Planned speed ─────────────────────────────────────────────────────────────

/** The speed a segment plays at, at `tick`: its base speed and keyframes with their ramps. */
export function plannedSpeedAt(
  segment: Pick<CinematicSegment, "playbackSpeed" | "speedKeyframes">,
  tick: number,
): number {
  let speed = segment.playbackSpeed;
  let previousTick = Number.NEGATIVE_INFINITY;
  for (const kf of segment.speedKeyframes ?? []) {
    const ramp = Math.max(0, Math.min(kf.ramp ?? 0, kf.tick - previousTick));
    if (tick >= kf.tick) {
      speed = kf.speed;
    } else {
      if (ramp > 0 && tick > kf.tick - ramp) {
        const t = (tick - (kf.tick - ramp)) / ramp;
        speed += (kf.speed - speed) * t * t * (3 - 2 * t);
      }
      break;
    }
    previousTick = kf.tick;
  }
  return speed;
}

/** Wall-clock ms from `startTick` to `endTick` at the segment's planned speeds. */
export function plannedDurationMs(
  segment: Pick<CinematicSegment, "playbackSpeed" | "speedKeyframes">,
  startTick: number,
  endTick: number,
  tickRate: number,
): number {
  const ramps = (segment.speedKeyframes ?? []).some((kf) => (kf.ramp ?? 0) > 0);
  if (!ramps) {
    // Steps: exact
    let ms = 0;
    let from = startTick;
    let speed = segment.playbackSpeed;
    for (const kf of segment.speedKeyframes ?? []) {
      if (kf.tick <= startTick) {
        speed = kf.speed;
        continue;
      }
      if (kf.tick >= endTick) break;
      ms += ((kf.tick - from) / tickRate / speed) * 1000;
      from = kf.tick;
      speed = kf.speed;
    }
    return ms + ((endTick - from) / tickRate / speed) * 1000;
  }
  // Ramps: midpoint steps of a quarter tick
  const step = 0.25;
  let ms = 0;
  for (let tick = startTick; tick < endTick; tick += step) {
    const span = Math.min(step, endTick - tick);
    ms += (span / tickRate / Math.max(0.05, plannedSpeedAt(segment, tick + span / 2))) * 1000;
  }
  return ms;
}

// ── SequenceBuilder ───────────────────────────────────────────────────────────

export class SequenceBuilder {
  build(analysis: DemoAnalysis, targetDurationMinutes: number, tickRate: number, _header: DemoHeader): CinematicReel {
    const targetMs = targetDurationMinutes * 60 * 1000;
    const effectiveTickRate = tickRate > 0 ? tickRate : 20;

    if (analysis.highlights.length === 0) {
      return { segments: [], totalDurationMs: 0, totalSegments: 0, totalScenes: 0, tickRate: effectiveTickRate };
    }

    const frags = analysis.highlights.filter((h) => h.type !== "movement");
    const moves = analysis.highlights.filter((h) => h.type === "movement");
    const buffer = Math.round(OVERLAP_BUFFER_SECONDS * effectiveTickRate);
    const selected = this._selectHighlights(frags, moves, targetMs, buffer, effectiveTickRate);
    const frozen = this._freezeScenes(selected);

    const segments: CinematicSegment[] = [];
    let previousPov: CameraPresetId | undefined;
    selected.forEach((h, scene) => {
      if (h.type === "movement") {
        segments.push(...this._buildMoveScene(h, scene, effectiveTickRate));
        return;
      }
      const shots =
        h.type === "frag_sequence" && (h.kills?.length ?? 0) >= 2
          ? this._buildSequenceScene(h, scene, effectiveTickRate)
          : this._buildScene(h, scene, effectiveTickRate, previousPov);
      if (h.type !== "frag_sequence") previousPov = shots.find((s) => s.role === "pov")?.cameraPreset;
      if (frozen.has(h)) this._freezeEnding(shots, effectiveTickRate);
      segments.push(...shots);
    });

    this._assignSceneEnds(segments, selected);
    segments.forEach((segment, i) => {
      segment.segmentIndex = i;
    });

    const totalDurationMs = segments.reduce((sum, s) => sum + s.durationMs + s.transitionDurationMs, 0);

    return {
      segments,
      totalDurationMs,
      totalSegments: segments.length,
      totalScenes: selected.length,
      tickRate: effectiveTickRate,
    };
  }

  // ── Private: selection ────────────────────────────────────────────────────

  /**
   * The best frags that fit the length, in match order, with the best movement
   * clips cut in between them: about one for every two frag scenes, at most
   * MAX_MOVES_PER_GAP between any two, never opening or closing the reel.
   * A demo with no frags at all is all movement.
   */
  private _selectHighlights(
    frags: HighlightCandidate[],
    moves: HighlightCandidate[],
    targetMs: number,
    overlapBufferTicks: number,
    tickRate: number,
  ): HighlightCandidate[] {
    if (frags.length === 0) {
      return this._pickNonOverlapping(moves, Math.max(1, Math.floor(targetMs / AVG_MOVE_MS)), overlapBufferTicks);
    }
    // Each frag scene costs its own length, and a share of the movement clips between them
    const moveShare = moves.length > 0 ? AVG_MOVE_MS / 2 : 0;
    const cost = (h: HighlightCandidate) => sceneCostMs(h, tickRate) + moveShare;
    const kills = this._pickWithinBudget(frags, targetMs, cost, overlapBufferTicks);
    if (kills.length < 2 || moves.length === 0) return kills;

    const maxMoves = Math.floor(kills.length / 2) || 1;
    const perGap = new Map<number, number>();
    const chosen: HighlightCandidate[] = [];
    for (const move of [...moves].sort((a, b) => b.score - a.score)) {
      if (chosen.length >= maxMoves) break;
      // The gap is the frag scene the clip comes after; none before the first or after the last
      let gap = -1;
      while (gap + 1 < kills.length && kills[gap + 1].endTick + overlapBufferTicks < move.startTick) gap++;
      if (gap < 0 || gap >= kills.length - 1) continue;
      if (move.endTick + overlapBufferTicks >= kills[gap + 1].startTick) continue;
      if ((perGap.get(gap) ?? 0) >= MAX_MOVES_PER_GAP) continue;
      if (this._overlapsAny(move, chosen, overlapBufferTicks)) continue;
      chosen.push(move);
      perGap.set(gap, (perGap.get(gap) ?? 0) + 1);
    }
    return [...kills, ...chosen].sort((a, b) => a.peakTick - b.peakTick);
  }

  /** The best-scoring candidates that fit `budgetMs` (at least one), none within the buffer of another; in match order. */
  private _pickWithinBudget(
    candidates: HighlightCandidate[],
    budgetMs: number,
    cost: (h: HighlightCandidate) => number,
    overlapBufferTicks: number,
  ): HighlightCandidate[] {
    const selected: HighlightCandidate[] = [];
    let spent = 0;
    for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
      if (this._overlapsAny(candidate, selected, overlapBufferTicks)) continue;
      const price = cost(candidate);
      if (selected.length > 0 && spent + price > budgetMs) continue;
      selected.push(candidate);
      spent += price;
    }
    return selected.sort((a, b) => a.peakTick - b.peakTick);
  }

  /** The best-scoring candidates, up to `max`, none within the buffer of another; in match order. */
  private _pickNonOverlapping(
    candidates: HighlightCandidate[],
    max: number,
    overlapBufferTicks: number,
  ): HighlightCandidate[] {
    const selected: HighlightCandidate[] = [];
    // Already sorted by score desc from DemoAnalyzer, but sort defensively
    for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
      if (selected.length >= max) break;
      if (!this._overlapsAny(candidate, selected, overlapBufferTicks)) selected.push(candidate);
    }
    return selected.sort((a, b) => a.peakTick - b.peakTick);
  }

  private _overlapsAny(candidate: HighlightCandidate, others: HighlightCandidate[], buffer: number): boolean {
    return others.some((s) => candidate.startTick <= s.endTick + buffer && candidate.endTick >= s.startTick - buffer);
  }

  /**
   * The scenes that end on a freeze frame: the reel's FREEZE_COUNT coolest
   * frag scenes, three-frag plays, air rockets and blade frags before the
   * rest, the higher score first among equals.
   */
  private _freezeScenes(selected: HighlightCandidate[]): Set<HighlightCandidate> {
    const frags = selected
      .filter((h) => h.type !== "movement")
      .sort((a, b) => freezeRank(b) - freezeRank(a) || b.score - a.score);
    return new Set(frags.slice(0, FREEZE_COUNT));
  }

  // ── Private: a movement clip ──────────────────────────────────────────────

  /**
   * A movement clip: a camera trailing the whole run with a beat of slow
   * motion on its best moment, then a flash back into the player's eyes for
   * that moment. It ends the way a frag scene does.
   */
  private _buildMoveScene(h: HighlightCandidate, scene: number, tickRate: number): CinematicSegment[] {
    const ticks = (seconds: number): number => Math.round(seconds * tickRate);
    const ramp = ticks(SPEED_RAMP_SECONDS);
    const follow = this._segment(h, scene, "intro", "trick_follow", h.startTick, h.endTick, tickRate, 1, [
      { tick: h.peakTick - ticks(0.25), speed: 0.5, ramp },
      { tick: h.peakTick + ticks(0.4), speed: 1, ramp },
    ]);
    const eyes = this._segment(
      h,
      scene,
      "pov",
      "chase_hero",
      Math.max(h.startTick, h.peakTick - ticks(MOVE_POV_SECONDS)),
      Math.min(h.endTick, h.peakTick + ticks(MOVE_POV_SECONDS)),
      tickRate,
      1,
    );
    eyes.cameraTarget = h.primaryPlayer;
    follow.transitionOut = "white_flash";
    eyes.transitionIn = "white_flash";
    follow.transitionDurationMs = REWIND_FLASH_MS;
    eyes.transitionDurationMs = REWIND_FLASH_MS;
    return [follow, eyes];
  }

  // ── Private: one scene ────────────────────────────────────────────────────

  private _buildScene(
    h: HighlightCandidate,
    scene: number,
    tickRate: number,
    previousPov: CameraPresetId | undefined,
  ): CinematicSegment[] {
    const ticks = (seconds: number): number => Math.round(seconds * tickRate);
    const ramp = ticks(SPEED_RAMP_SECONDS);
    const clampStart = (tick: number) => Math.max(h.startTick, Math.min(tick, h.peakTick));
    const clampEnd = (tick: number) => Math.min(h.endTick, Math.max(tick, h.peakTick));

    // 1. Intro: third person up to the frag, slowing into it
    const introPreset = this._introPreset(h);
    const introStart =
      introPreset === "rocket_jump_hero" ? h.startTick : clampStart(h.peakTick - ticks(INTRO_LEADIN_SECONDS));
    const intro = this._segment(h, scene, "intro", introPreset, introStart, h.peakTick, tickRate, 1, [
      { tick: h.peakTick - ticks(INTRO_SLOW_SECONDS), speed: INTRO_SLOW_SPEED, ramp: ramp * 2 },
    ]);

    // 2. The same moment from a player's eyes. The killer's run through the
    // frag at full speed with a beat of slow motion on it; the victim's end on
    // the frag, as their eyes go when they die.
    const povPreset = this._povPreset(h, previousPov);
    const victim = povPreset === "victim_pov";
    const povStart = (h.killCount ?? 1) > 1 ? h.startTick : clampStart(h.peakTick - ticks(POV_LEADIN_SECONDS));
    const pov = victim
      ? this._segment(h, scene, "pov", povPreset, povStart, h.peakTick, tickRate, 1, [
          { tick: h.peakTick - ticks(VICTIM_SLOW_SECONDS), speed: VICTIM_SLOW_SPEED, ramp },
        ])
      : this._segment(h, scene, "pov", povPreset, povStart, h.endTick, tickRate, 1, [
          { tick: h.peakTick - ticks(0.15), speed: 0.5, ramp },
          { tick: h.peakTick + ticks(0.5), speed: 1, ramp },
        ]);
    pov.cameraTarget = victim ? (h.victimPlayer ?? h.primaryPlayer) : h.primaryPlayer;
    if ((h.kills?.length ?? 0) >= 2) pov.stamps = this._killStamps(h, pov.startTick, pov.endTick);

    // 3. Ending: a slow orbit round the frag. After the victim's eyes it
    // takes over at the frag itself, so the cut out of their eyes lands on it.
    const ending = this._segment(
      h,
      scene,
      "ending",
      "replay_orbit",
      victim ? h.peakTick : clampStart(h.peakTick - ticks(ENDING_BEFORE_SECONDS)),
      clampEnd(h.peakTick + ticks(ENDING_AFTER_SECONDS)),
      tickRate,
      ENDING_SPEED,
    );
    ending.isReplay = true;

    // Inside a scene: a quick flash rewinds into the eyes shot, a dip into the orbit
    intro.transitionOut = "white_flash";
    pov.transitionIn = "white_flash";
    intro.transitionDurationMs = REWIND_FLASH_MS;
    pov.transitionDurationMs = REWIND_FLASH_MS;
    ending.transitionIn = victim ? "cut" : "crossfade";

    return [intro, pov, ending];
  }

  /**
   * A frag sequence as it happened: the killer chased in third person
   * between frags, seen through their eyes for each frag, then the ending
   * orbit round the last. A long wait between two frags jumps ahead through
   * speed lines.
   */
  private _buildSequenceScene(h: HighlightCandidate, scene: number, tickRate: number): CinematicSegment[] {
    const ticks = (seconds: number): number => Math.round(seconds * tickRate);
    const ramp = ticks(SPEED_RAMP_SECONDS);
    const kills = h.kills ?? [];

    // The killer's eyes around each frag, frags close together sharing one shot
    const runs: Array<{ start: number; end: number; kills: number[] }> = [];
    for (let i = 0; i < kills.length; i++) {
      const start = Math.max(h.startTick, kills[i].tick - ticks(SEQ_EYES_BEFORE_SECONDS));
      const end = Math.min(h.endTick, kills[i].tick + ticks(SEQ_EYES_AFTER_SECONDS));
      const last = runs.at(-1);
      if (last && start <= last.end + ticks(SEQ_MERGE_GAP_SECONDS)) {
        last.end = end;
        last.kills.push(i);
      } else runs.push({ start, end, kills: [i] });
    }

    const shots: CinematicSegment[] = [];
    const chase = (from: number, to: number, killIndex: number, fast: boolean): CinematicSegment => {
      const shot = this._segment(
        h,
        scene,
        "intro",
        "trick_follow",
        from,
        to,
        tickRate,
        fast ? SEQ_CHASE_SPEED : 1,
        fast ? [{ tick: to, speed: 1, ramp: Math.min(to - from, ticks(0.6)) }] : undefined,
      );
      shot.victimTarget = kills[killIndex].victimPlayer;
      return shot;
    };

    // Opening: chasing the killer into the first frag
    if (runs[0].start - h.startTick >= ticks(SEQ_CHASE_MIN_SECONDS))
      shots.push(chase(h.startTick, runs[0].start, 0, false));

    runs.forEach((run, r) => {
      const keyframes: SpeedKeyframe[] = [];
      // A beat of slow motion round each frag; frags closer than that share one
      let slowUntil = Number.NEGATIVE_INFINITY;
      for (const i of run.kills) {
        const from = kills[i].tick - ticks(0.1);
        const until = kills[i].tick + ticks(0.35);
        if (from <= slowUntil) keyframes[keyframes.length - 1].tick = until;
        else keyframes.push({ tick: from, speed: 0.5, ramp }, { tick: until, speed: 1, ramp });
        slowUntil = until;
      }
      const eyes = this._segment(h, scene, "pov", "chase_hero", run.start, run.end, tickRate, 1, keyframes);
      eyes.cameraTarget = h.primaryPlayer;
      eyes.stamps = this._killStamps(h, run.start, run.end);
      shots.push(eyes);

      const next = runs[r + 1];
      if (!next) return;
      const gap = next.start - run.end;
      if (gap <= 0) return;
      const long = gap > ticks(SEQ_CHASE_MAX_SECONDS);
      const from = long ? next.start - ticks(SEQ_CHASE_MAX_SECONDS - 0.5) : run.end;
      const between = chase(from, next.start, next.kills[0], true);
      if (long) {
        eyes.transitionOut = "speed_wipe";
        between.transitionIn = "speed_wipe";
        eyes.transitionDurationMs = SPEED_WIPE_MS;
        between.transitionDurationMs = SPEED_WIPE_MS;
      }
      shots.push(between);
    });

    // Ending: the slow orbit round the last frag
    const lastKill = kills[kills.length - 1];
    const ending = this._segment(
      h,
      scene,
      "ending",
      "replay_orbit",
      Math.max(h.startTick, lastKill.tick - ticks(ENDING_BEFORE_SECONDS)),
      Math.min(h.endTick, Math.max(lastKill.tick, lastKill.tick + ticks(ENDING_AFTER_SECONDS))),
      tickRate,
      ENDING_SPEED,
    );
    ending.isReplay = true;
    ending.transitionIn = "crossfade";
    shots.push(ending);
    return shots;
  }

  /** The frag counter over a grouped highlight's frags inside a shot: "1", "2", ... */
  private _killStamps(h: HighlightCandidate, from: number, to: number): ReelStamp[] {
    return (h.kills ?? [])
      .map((kill, i) => ({ tick: kill.tick, text: String(i + 1) }))
      .filter((stamp) => stamp.tick >= from && stamp.tick < to);
  }

  /** Hold the scene's ending still just after its frag, as a comic panel. */
  private _freezeEnding(shots: CinematicSegment[], tickRate: number): void {
    const ending = shots.find((s) => s.role === "ending");
    if (!ending) return;
    const tick = Math.min(
      ending.endTick - 1,
      Math.max(ending.startTick, ending.highlight.peakTick + Math.round(FREEZE_AFTER_SECONDS * tickRate)),
    );
    if (tick < ending.startTick) return;
    ending.freeze = { tick, ms: FREEZE_MS, caption: freezeCaption(ending.highlight) };
    ending.durationMs += FREEZE_MS;
  }

  private _segment(
    h: HighlightCandidate,
    scene: number,
    role: SceneRole,
    cameraPreset: CameraPresetId,
    startTick: number,
    endTick: number,
    tickRate: number,
    playbackSpeed: number,
    speedKeyframes?: SpeedKeyframe[],
  ): CinematicSegment {
    const keyframes = speedKeyframes?.filter((kf) => kf.tick > startTick && kf.tick <= endTick);
    const plan = { playbackSpeed, ...(keyframes?.length ? { speedKeyframes: keyframes } : {}) };
    return {
      startTick,
      endTick,
      durationMs: plannedDurationMs(plan, startTick, endTick, tickRate),
      cameraPreset,
      ...plan,
      highlight: h,
      isReplay: false,
      segmentIndex: 0, // assigned later
      scene,
      role,
      transitionIn: "cut",
      transitionOut: "cut",
      transitionDurationMs: DEFAULT_TRANSITION_MS,
    };
  }

  // ── Private: camera choice ────────────────────────────────────────────────

  /** The third-person shot that suits the play. */
  private _introPreset(h: HighlightCandidate): CameraPresetId {
    if (h.tags.includes("rocket_jump") || h.tags.includes("height_gain")) return "rocket_jump_hero";
    if (h.tags.includes("long_range")) return "dramatic_zoom";
    return "orbit_kill";
  }

  /**
   * The eyes the frag is seen through. The victim's are worth watching when
   * they saw it coming. Never two in a row: in a duel nearly every victim faces
   * their killer, and a reel seen only from the losing side stops being about
   * the plays. A multi-kill is always the killer's: it is their run.
   */
  private _povPreset(h: HighlightCandidate, previous?: CameraPresetId): CameraPresetId {
    if ((h.killCount ?? 1) <= 1 && h.victimFacedKiller && h.victimPlayer !== undefined && previous !== "victim_pov")
      return "victim_pov";
    return "chase_hero";
  }

  // ── Private: how scenes begin and end ─────────────────────────────────────

  /**
   * The reel fades in from black and out to black. Between scenes, each scene
   * ends with an end effect the next scene comes in through. Some scenes come
   * in on speed lines: about one cut in three at most, never two running, the
   * reel's best frag scenes first, then movement clips. The rest take an
   * effect picked from the highlight itself, so the same demo always cuts the
   * same.
   */
  private _assignSceneEnds(segments: CinematicSegment[], selected: HighlightCandidate[]): void {
    if (segments.length === 0) return;
    const totalScenes = selected.length;
    const wiped = this._speedLineScenes(selected);
    segments[0].transitionIn = "fade_to_black";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const next = segments[i + 1];
      // A scene's last shot: a frag scene's ending orbit, a movement clip's eyes shot
      if (next && next.scene === segment.scene) continue;
      let effect: TransitionType;
      if (segment.scene === totalScenes - 1 || !next) effect = "fade_to_black";
      else if (wiped.has(next.scene)) effect = "speed_wipe";
      else effect = END_EFFECTS[sceneSeed(segment.highlight) % END_EFFECTS.length];
      segment.transitionOut = effect;
      if (next) next.transitionIn = effect;
      if (effect === "speed_wipe") {
        segment.transitionDurationMs = SPEED_WIPE_MS;
        if (next) next.transitionDurationMs = SPEED_WIPE_MS;
      }
    }
  }

  /** The scenes (by index) that come in on speed lines; never the first, never two running. */
  private _speedLineScenes(selected: HighlightCandidate[]): Set<number> {
    const cuts = selected.length - 1;
    const budget = cuts >= 2 ? Math.max(1, Math.floor(cuts / 3)) : cuts;
    const scenes = selected.map((h, scene) => ({ h, scene })).filter(({ scene }) => scene > 0);
    const byPriority = [
      ...scenes.filter(({ h }) => h.type !== "movement").sort((a, b) => b.h.score - a.h.score),
      ...scenes.filter(({ h }) => h.type === "movement"),
    ];
    const chosen = new Set<number>();
    for (const { scene } of byPriority) {
      if (chosen.size >= budget) break;
      if (chosen.has(scene - 1) || chosen.has(scene + 1)) continue;
      chosen.add(scene);
    }
    return chosen;
  }
}

/**
 * About how long a frag scene runs, for the selection budget: a frag
 * sequence plays its whole window and an ending, the rest about AVG_SCENE_MS.
 */
function sceneCostMs(h: HighlightCandidate, tickRate: number): number {
  if (h.type !== "frag_sequence") return AVG_SCENE_MS;
  return ((h.endTick - h.startTick) / tickRate) * 1000 + SEQUENCE_ENDING_MS;
}

/** How much a frag deserves a freeze frame: the rarer the play, the higher. */
function freezeRank(h: HighlightCandidate): number {
  if ((h.killCount ?? 1) >= 3) return 4;
  if (h.tags.includes("air_rocket") || h.tags.includes("blade")) return 3;
  if (h.tags.includes("rocket_jump")) return 2;
  if ((h.killCount ?? 1) === 2 || h.tags.includes("airborne") || h.tags.includes("long_range")) return 1;
  return 0;
}

/** The word on a freeze frame. */
export function freezeCaption(h: HighlightCandidate): string {
  const kills = h.killCount ?? 1;
  if (kills >= 5) return `${kills} FRAGS!`;
  if (kills === 4) return "QUAD!";
  if (kills === 3) return "TRIPLE!";
  if (kills === 2) return "DOUBLE!";
  if (h.tags.includes("air_rocket")) return "AIR ROCKET!";
  if (h.tags.includes("blade")) return "SLICED!";
  if (h.tags.includes("rocket_jump")) return "ROCKET JUMP!";
  if (h.tags.includes("airborne")) return "AIRSHOT!";
  if (h.tags.includes("long_range")) return "SNIPED!";
  if (h.tags.includes("low_hp")) return "CLUTCH!";
  if (h.tags.includes("revenge")) return "REVENGE!";
  return "FRAG!";
}

// ── Cuts on the beat ──────────────────────────────────────────────────────────

/** How far a scene's cut may move to land on a beat: earlier, and later. */
const BEAT_EARLIER_MS = 350;
const BEAT_LATER_MS = 650;
/** Extra game time past a later cut, so the shot never runs out before it. */
const BEAT_SLACK_MS = 250;

/**
 * Move each cut between two scenes onto a beat of the music: the reel's
 * scenes end at `beatsMs` (reel time, from the start of the title card) where
 * one is near enough. A shot that ends later on its beat runs on into more
 * of its slow orbit. Returns a new reel; the given one is left as it was.
 */
export function alignSceneCutsToBeats(
  reel: CinematicReel,
  beatsMs: readonly number[],
  titleHoldMs: number,
): CinematicReel {
  const aligned: CinematicReel = { ...reel, segments: reel.segments.map((s) => ({ ...s })) };
  if (beatsMs.length === 0) return aligned;
  let at = titleHoldMs;
  aligned.segments.forEach((segment, i) => {
    const plannedEnd = at + segment.durationMs;
    const next = aligned.segments[i + 1];
    const sceneCut = next !== undefined && next.scene !== segment.scene;
    const beat = sceneCut ? nearestBeat(beatsMs, plannedEnd, at + segment.durationMs / 2) : null;
    if (beat === null) {
      at = plannedEnd;
      return;
    }
    if (beat > plannedEnd) {
      const speed = plannedSpeedAt(segment, segment.endTick);
      const more = ((beat - plannedEnd + BEAT_SLACK_MS) / 1000) * speed * reel.tickRate;
      segment.endTick = Math.ceil(segment.endTick + more);
    }
    segment.cutAtMs = beat;
    segment.durationMs = beat - at;
    at = beat;
  });
  aligned.totalDurationMs = aligned.segments.reduce((sum, s) => sum + s.durationMs + s.transitionDurationMs, 0);
  return aligned;
}

/** The beat nearest `ms` within the window around it, and after `notBefore`. */
function nearestBeat(beatsMs: readonly number[], ms: number, notBefore: number): number | null {
  let best: number | null = null;
  for (const beat of beatsMs) {
    if (beat < ms - BEAT_EARLIER_MS || beat > ms + BEAT_LATER_MS || beat <= notBefore) continue;
    if (best === null || Math.abs(beat - ms) < Math.abs(best - ms)) best = beat;
  }
  return best;
}

/** A stable number from a highlight, for choices that should look random but repeat per demo. */
function sceneSeed(h: HighlightCandidate): number {
  let hash = h.peakTick | 0;
  for (const ch of h.primaryPlayer) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}
