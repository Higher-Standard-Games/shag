/**
 * SequenceBuilder — Phase 2 cinematic highlight reel builder
 *
 * Takes a DemoAnalysis (scored highlights) and a target duration, then
 * selects, orders, and annotates segments into a CinematicReel ready for
 * playback.  Pure TypeScript, no external dependencies.
 */

import type { DemoAnalysis, HighlightCandidate } from "./DemoAnalyzer";
import type { DemoHeader } from "./DemoReader";

// ── Exported types ────────────────────────────────────────────────────────────

export type CameraPresetId =
  | "chase_hero" // first-person chase-cam on killer
  | "orbit_kill" // freefly orbit around action midpoint
  | "rocket_jump_hero" // freefly below jump arc, looking up
  | "victim_pov" // chase-cam on victim before death
  | "dramatic_zoom" // freefly wide→tight dolly
  | "replay_orbit"; // slow 360° orbit for instant replay

export type TransitionType = "cut" | "crossfade" | "white_flash" | "fade_to_black";

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
  transitionIn: TransitionType;
  transitionOut: TransitionType;
  transitionDurationMs: number;
}

export interface CinematicReel {
  segments: CinematicSegment[];
  totalDurationMs: number;
  totalSegments: number;
  snapshotRate: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AVG_SEGMENT_MS = 8000;
const OVERLAP_BUFFER_TICKS = 60; // 3 s at 20 fps
const DEFAULT_TRANSITION_MS = 500;
const REPLAY_WINDOW_SECONDS = 2;
const REPLAY_THRESHOLD_PERCENTILE = 0.85; // top 15 %
const BUDGET_OVERRUN_FACTOR = 1.2;

// ── SequenceBuilder ───────────────────────────────────────────────────────────

export class SequenceBuilder {
  build(
    analysis: DemoAnalysis,
    targetDurationMinutes: number,
    snapshotRate: number,
    _header: DemoHeader,
  ): CinematicReel {
    const targetMs = targetDurationMinutes * 60 * 1000;

    if (analysis.highlights.length === 0) {
      return { segments: [], totalDurationMs: 0, totalSegments: 0, snapshotRate };
    }

    // ── 1. Select highlights ──────────────────────────────────────────
    const selected = this._selectHighlights(analysis.highlights, targetMs);

    // ── 2. Build base segments ────────────────────────────────────────
    const baseSegments = selected.map((h) => this._buildBaseSegment(h, snapshotRate, analysis.totalTicks));

    // ── 3. Insert instant replays ────────────────────────────────────
    const withReplays = this._insertReplays(baseSegments, targetMs, snapshotRate, analysis.totalTicks);

    // ── 4. Assign transitions ────────────────────────────────────────
    this._assignTransitions(withReplays);

    // ── 5. Assign sequential indexes ────────────────────────────────
    for (let i = 0; i < withReplays.length; i++) {
      withReplays[i].segmentIndex = i;
    }

    // ── 6. Compute totals ────────────────────────────────────────────
    const totalDurationMs =
      withReplays.reduce((sum, s) => sum + s.durationMs, 0) + withReplays.length * DEFAULT_TRANSITION_MS;

    return {
      segments: withReplays,
      totalDurationMs,
      totalSegments: withReplays.length,
      snapshotRate,
    };
  }

  // ── Private: selection ────────────────────────────────────────────────────

  private _selectHighlights(highlights: HighlightCandidate[], targetMs: number): HighlightCandidate[] {
    const maxSegments = Math.max(1, Math.floor(targetMs / AVG_SEGMENT_MS));

    // Already sorted by score desc from DemoAnalyzer, but sort defensively
    const byScore = [...highlights].sort((a, b) => b.score - a.score);

    const selected: HighlightCandidate[] = [];

    for (const candidate of byScore) {
      if (selected.length >= maxSegments) break;

      const overlaps = selected.some(
        (s) =>
          candidate.startTick <= s.endTick + OVERLAP_BUFFER_TICKS &&
          candidate.endTick >= s.startTick - OVERLAP_BUFFER_TICKS,
      );
      if (!overlaps) {
        selected.push(candidate);
      }
    }

    // Sort chronologically
    selected.sort((a, b) => a.peakTick - b.peakTick);
    return selected;
  }

  // ── Private: base segment construction ───────────────────────────────────

  private _buildBaseSegment(h: HighlightCandidate, snapshotRate: number, _totalTicks: number): CinematicSegment {
    const preset = this._assignPreset(h);
    const { playbackSpeed, speedKeyframes } = this._assignSpeed(preset, h);
    const durationMs = this._computeDurationMs(h.startTick, h.endTick, snapshotRate, playbackSpeed);

    const segment: CinematicSegment = {
      startTick: h.startTick,
      endTick: h.endTick,
      durationMs,
      cameraPreset: preset,
      playbackSpeed,
      highlight: h,
      isReplay: false,
      segmentIndex: 0, // assigned later
      transitionIn: "cut", // assigned later
      transitionOut: "cut", // assigned later
      transitionDurationMs: DEFAULT_TRANSITION_MS,
    };

    if (speedKeyframes) {
      segment.speedKeyframes = speedKeyframes;
    }

    // Chase-cam presets need an entity target
    if (preset === "chase_hero") {
      segment.cameraTarget = h.primaryPlayer;
    } else if (preset === "victim_pov") {
      segment.cameraTarget = h.victimPlayer ?? h.primaryPlayer;
    }

    return segment;
  }

  // ── Private: camera preset assignment ────────────────────────────────────

  private _assignPreset(h: HighlightCandidate): CameraPresetId {
    if (h.tags.includes("rocket_jump") || h.tags.includes("height_gain")) {
      return "rocket_jump_hero";
    }
    if (h.tags.includes("multi_kill") && (h.killCount ?? 0) >= 3) {
      return "orbit_kill";
    }
    if (h.tags.includes("long_range")) {
      return "dramatic_zoom";
    }
    if (h.peakTick % 5 === 0 && h.victimPlayer !== undefined) {
      return "victim_pov";
    }
    return "chase_hero";
  }

  // ── Private: speed assignment ────────────────────────────────────────────

  private _assignSpeed(
    preset: CameraPresetId,
    h: HighlightCandidate,
  ): { playbackSpeed: number; speedKeyframes?: Array<{ tick: number; speed: number }> } {
    switch (preset) {
      case "chase_hero":
        return { playbackSpeed: 1.0 };

      case "orbit_kill":
        return {
          playbackSpeed: 1.0,
          speedKeyframes: [
            { tick: h.peakTick - 10, speed: 0.5 },
            { tick: h.peakTick + 20, speed: 1.0 },
          ],
        };

      case "rocket_jump_hero":
        return {
          playbackSpeed: 0.75,
          speedKeyframes: [
            { tick: h.peakTick, speed: 0.25 },
            { tick: h.peakTick + 20, speed: 1.0 },
          ],
        };

      case "victim_pov":
        return {
          playbackSpeed: 1.0,
          speedKeyframes: [{ tick: h.peakTick - 5, speed: 0.5 }],
        };

      case "dramatic_zoom":
        return {
          playbackSpeed: 1.0,
          speedKeyframes: [
            { tick: h.peakTick - 5, speed: 0.25 },
            { tick: h.peakTick + 10, speed: 1.0 },
          ],
        };

      case "replay_orbit":
        return { playbackSpeed: 0.25 };
    }
  }

  // ── Private: durationMs ───────────────────────────────────────────────────

  private _computeDurationMs(startTick: number, endTick: number, snapshotRate: number, playbackSpeed: number): number {
    const rawTicks = endTick - startTick;
    return ((rawTicks / snapshotRate) * 1000) / playbackSpeed;
  }

  // ── Private: instant replay insertion ────────────────────────────────────

  private _insertReplays(
    segments: CinematicSegment[],
    targetMs: number,
    snapshotRate: number,
    totalTicks: number,
  ): CinematicSegment[] {
    if (segments.length === 0) return segments;

    const scores = segments.map((s) => s.highlight.score);
    const sortedScores = [...scores].sort((a, b) => a - b);
    const thresholdIdx = Math.floor(sortedScores.length * REPLAY_THRESHOLD_PERCENTILE);
    const scoreThreshold = sortedScores[Math.min(thresholdIdx, sortedScores.length - 1)];

    const currentTotal = segments.reduce((sum, s) => sum + s.durationMs, 0);
    const budget = targetMs * BUDGET_OVERRUN_FACTOR;

    const result: CinematicSegment[] = [];

    for (const segment of segments) {
      result.push(segment);

      if (segment.highlight.score < scoreThreshold) continue;

      const h = segment.highlight;
      const replayWindowTicks = REPLAY_WINDOW_SECONDS * snapshotRate;
      const replayStart = Math.max(0, h.peakTick - replayWindowTicks);
      const replayEnd = Math.min(totalTicks, h.peakTick + replayWindowTicks);

      const replayDuration = this._computeDurationMs(replayStart, replayEnd, snapshotRate, 0.25);

      // Skip if replay would push total over budget by more than 20%
      const projectedTotal = currentTotal + replayDuration;
      if (projectedTotal > budget) continue;

      const replaySegment: CinematicSegment = {
        startTick: replayStart,
        endTick: replayEnd,
        durationMs: replayDuration,
        cameraPreset: "replay_orbit",
        playbackSpeed: 0.25,
        highlight: h,
        isReplay: true,
        segmentIndex: 0, // assigned later
        transitionIn: "white_flash",
        transitionOut: "cut",
        transitionDurationMs: DEFAULT_TRANSITION_MS,
      };

      result.push(replaySegment);
    }

    return result;
  }

  // ── Private: transition assignment ───────────────────────────────────────

  private _assignTransitions(segments: CinematicSegment[]): void {
    if (segments.length === 0) return;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prev = i > 0 ? segments[i - 1] : null;
      const next = i < segments.length - 1 ? segments[i + 1] : null;

      // Defaults
      seg.transitionIn = "cut";
      seg.transitionOut = "cut";
      seg.transitionDurationMs = DEFAULT_TRANSITION_MS;

      // First segment
      if (i === 0) {
        seg.transitionIn = "fade_to_black";
      }

      // Last segment
      if (i === segments.length - 1) {
        seg.transitionOut = "fade_to_black";
      }

      // Before a replay: current segment transitions out with white_flash
      if (next?.isReplay === true) {
        seg.transitionOut = "white_flash";
      }

      // Replay segments: in is white_flash (already set in _insertReplays)
      if (seg.isReplay) {
        seg.transitionIn = "white_flash";
        // Don't override the fade_to_black on last segment
        continue;
      }

      // Non-first, non-replay: determine transitionIn from previous segment
      if (prev !== null && i !== 0) {
        const prevHighlight = prev.highlight;
        const curHighlight = seg.highlight;

        if (prevHighlight.primaryPlayer === curHighlight.primaryPlayer) {
          seg.transitionIn = "cut";
        } else {
          seg.transitionIn = "crossfade";
        }

        // First segment override already applied above — re-apply to be safe
        if (i === 0) {
          seg.transitionIn = "fade_to_black";
        }
      }
    }
  }
}
