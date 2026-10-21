/**
 * SequenceBuilder — the highlight reel's shot list
 *
 * Takes a DemoAnalysis (scored highlights) and a target duration, then
 * selects highlights and films each one as a scene of three shots:
 *
 *   1. intro   — a third-person fly-by up to the frag, slowing as it lands
 *   2. pov     — the same moment again from the killer's (or victim's) eyes
 *   3. ending  — a slow orbit round the frag, then the scene's end effect
 *
 * Every scene has the same shape, so the reel reads like one edited video.
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
  | "replay_orbit"; // slow orbit for instant replay

export type TransitionType = "cut" | "crossfade" | "white_flash" | "fade_to_black";

/** Which of a scene's three shots a segment is. */
export type SceneRole = "intro" | "pov" | "ending";

export interface CinematicSegment {
  startTick: number;
  endTick: number;
  durationMs: number; // wall-clock ms at the segment's playbackSpeed
  cameraPreset: CameraPresetId;
  cameraTarget?: string; // entity ID for chase-cam presets
  playbackSpeed: number;
  speedKeyframes?: Array<{ tick: number; speed: number }>;
  highlight: HighlightCandidate;
  isReplay: boolean;
  segmentIndex: number;
  /** The scene (one highlight) this shot belongs to, 0-based. */
  scene: number;
  role: SceneRole;
  transitionIn: TransitionType;
  transitionOut: TransitionType;
  transitionDurationMs: number;
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
const OVERLAP_BUFFER_SECONDS = 3;
const DEFAULT_TRANSITION_MS = 500;
/** The rewind from the fly-by into the player's eyes: quick, so it reads as one beat. */
const REWIND_FLASH_MS = 300;

/** The intro starts this long before the frag (a rocket jump from the start of its window). */
const INTRO_LEADIN_SECONDS = 2;
/** The intro slows to INTRO_SLOW_SPEED this long before the frag lands. */
const INTRO_SLOW_SECONDS = 0.6;
const INTRO_SLOW_SPEED = 0.35;
/** The eyes shot starts this long before the frag and runs to the highlight's end. */
const POV_LEADIN_SECONDS = 2;
/** The ending orbit: from just before the frag to a moment after, slowly. */
const ENDING_BEFORE_SECONDS = 0.3;
const ENDING_AFTER_SECONDS = 1.2;
const ENDING_SPEED = 0.4;

/** How a scene can end; the reel's last scene always fades to black. */
const END_EFFECTS: readonly TransitionType[] = ["fade_to_black", "white_flash", "crossfade"];

// ── SequenceBuilder ───────────────────────────────────────────────────────────

export class SequenceBuilder {
  build(analysis: DemoAnalysis, targetDurationMinutes: number, tickRate: number, _header: DemoHeader): CinematicReel {
    const targetMs = targetDurationMinutes * 60 * 1000;
    const effectiveTickRate = tickRate > 0 ? tickRate : 20;

    if (analysis.highlights.length === 0) {
      return { segments: [], totalDurationMs: 0, totalSegments: 0, totalScenes: 0, tickRate: effectiveTickRate };
    }

    const selected = this._selectHighlights(
      analysis.highlights,
      targetMs,
      Math.round(OVERLAP_BUFFER_SECONDS * effectiveTickRate),
    );

    const segments: CinematicSegment[] = [];
    let previousPov: CameraPresetId | undefined;
    selected.forEach((h, scene) => {
      const shots = this._buildScene(h, scene, effectiveTickRate, previousPov);
      previousPov = shots.find((s) => s.role === "pov")?.cameraPreset;
      segments.push(...shots);
    });

    this._assignSceneEnds(segments, selected.length);
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

  private _selectHighlights(
    highlights: HighlightCandidate[],
    targetMs: number,
    overlapBufferTicks: number,
  ): HighlightCandidate[] {
    const maxScenes = Math.max(1, Math.floor(targetMs / AVG_SCENE_MS));

    // Already sorted by score desc from DemoAnalyzer, but sort defensively
    const byScore = [...highlights].sort((a, b) => b.score - a.score);

    const selected: HighlightCandidate[] = [];

    for (const candidate of byScore) {
      if (selected.length >= maxScenes) break;

      const overlaps = selected.some(
        (s) =>
          candidate.startTick <= s.endTick + overlapBufferTicks &&
          candidate.endTick >= s.startTick - overlapBufferTicks,
      );
      if (!overlaps) {
        selected.push(candidate);
      }
    }

    // Sort chronologically
    selected.sort((a, b) => a.peakTick - b.peakTick);
    return selected;
  }

  // ── Private: one scene ────────────────────────────────────────────────────

  private _buildScene(
    h: HighlightCandidate,
    scene: number,
    tickRate: number,
    previousPov: CameraPresetId | undefined,
  ): CinematicSegment[] {
    const ticks = (seconds: number): number => Math.round(seconds * tickRate);
    const clampStart = (tick: number) => Math.max(h.startTick, Math.min(tick, h.peakTick));
    const clampEnd = (tick: number) => Math.min(h.endTick, Math.max(tick, h.peakTick));

    // 1. Intro: third person up to the frag, slowing into it
    const introPreset = this._introPreset(h);
    const introStart =
      introPreset === "rocket_jump_hero" ? h.startTick : clampStart(h.peakTick - ticks(INTRO_LEADIN_SECONDS));
    const intro = this._segment(h, scene, "intro", introPreset, introStart, h.peakTick, tickRate, 1, [
      { tick: h.peakTick - ticks(INTRO_SLOW_SECONDS), speed: INTRO_SLOW_SPEED },
    ]);

    // 2. The same moment from a player's eyes, at full speed with a beat of slow motion on the frag
    const povPreset = this._povPreset(h, previousPov);
    const povStart = (h.killCount ?? 1) > 1 ? h.startTick : clampStart(h.peakTick - ticks(POV_LEADIN_SECONDS));
    const pov = this._segment(h, scene, "pov", povPreset, povStart, h.endTick, tickRate, 1, [
      { tick: h.peakTick - ticks(0.15), speed: 0.5 },
      { tick: h.peakTick + ticks(0.5), speed: 1 },
    ]);
    pov.cameraTarget = povPreset === "victim_pov" ? (h.victimPlayer ?? h.primaryPlayer) : h.primaryPlayer;

    // 3. Ending: a slow orbit round the frag
    const ending = this._segment(
      h,
      scene,
      "ending",
      "replay_orbit",
      clampStart(h.peakTick - ticks(ENDING_BEFORE_SECONDS)),
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
    ending.transitionIn = "crossfade";

    return [intro, pov, ending];
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
    speedKeyframes?: Array<{ tick: number; speed: number }>,
  ): CinematicSegment {
    const keyframes = speedKeyframes?.filter((kf) => kf.tick > startTick && kf.tick < endTick);
    return {
      startTick,
      endTick,
      durationMs: this._computeDurationMs(startTick, endTick, tickRate, playbackSpeed, keyframes),
      cameraPreset,
      playbackSpeed,
      ...(keyframes?.length ? { speedKeyframes: keyframes } : {}),
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
   * the plays.
   */
  private _povPreset(h: HighlightCandidate, previous?: CameraPresetId): CameraPresetId {
    if (h.victimFacedKiller && h.victimPlayer !== undefined && previous !== "victim_pov") return "victim_pov";
    return "chase_hero";
  }

  // ── Private: durationMs ───────────────────────────────────────────────────

  /** Wall-clock time from start to end, at the base speed and each keyframe's speed from its tick. */
  private _computeDurationMs(
    startTick: number,
    endTick: number,
    tickRate: number,
    playbackSpeed: number,
    speedKeyframes?: Array<{ tick: number; speed: number }>,
  ): number {
    let ms = 0;
    let from = startTick;
    let speed = playbackSpeed;
    for (const kf of speedKeyframes ?? []) {
      ms += ((kf.tick - from) / tickRate / speed) * 1000;
      from = kf.tick;
      speed = kf.speed;
    }
    ms += ((endTick - from) / tickRate / speed) * 1000;
    return ms;
  }

  // ── Private: how scenes begin and end ─────────────────────────────────────

  /**
   * The reel fades in from black and out to black. Between scenes, each scene
   * ends with an end effect the next scene comes in through. The effect is
   * picked from the highlight itself, so the same demo always cuts the same.
   */
  private _assignSceneEnds(segments: CinematicSegment[], totalScenes: number): void {
    if (segments.length === 0) return;
    segments[0].transitionIn = "fade_to_black";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.role !== "ending") continue;
      const next = segments[i + 1];
      const effect =
        segment.scene === totalScenes - 1 || !next
          ? "fade_to_black"
          : END_EFFECTS[sceneSeed(segment.highlight) % END_EFFECTS.length];
      segment.transitionOut = effect;
      if (next) next.transitionIn = effect;
    }
  }
}

/** A stable number from a highlight, for choices that should look random but repeat per demo. */
function sceneSeed(h: HighlightCandidate): number {
  let hash = h.peakTick | 0;
  for (const ch of h.primaryPlayer) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}
