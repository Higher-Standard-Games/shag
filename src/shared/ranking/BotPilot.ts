/** Offline calibration drafts only. Nothing here installs or updates a live rating. */

import { type BotCalibration, canonicalCalibration } from "./BotRatingReferences";
import { type BotReference, canonicalBotReference } from "./BotReference";
import {
  initialRating,
  isProvisional,
  RATING_POLICY,
  type RatingMode,
  type RatingState,
  validateRatingState,
} from "./RatingPolicy";
import { rateMatch } from "./TrueSkillRating";

export interface PilotTrial {
  sequence: number;
  matchId: string;
  map: string;
  mapDigest: string;
  referenceId: string;
  groups: Array<{
    rank: number;
    players: Array<
      | { kind: "bot"; playerId: string }
      | { kind: "human"; playerId: string; anchorSequence: number; state: RatingState }
    >;
  }>;
}
export interface BotPilot {
  version: 1;
  kind: "bot_pilot";
  policyVersion: string;
  mode: RatingMode;
  anchorScope: "private" | "public";
  afterSequence: number;
  throughSequence: number;
  capturedAt: number;
  references: Array<{ id: string; reference: BotReference }>;
  trials: PilotTrial[];
  skipped: Array<{ sequence: number; matchId: string; reason: string }>;
}

export function validatePilot(input: BotPilot): void {
  if (
    !input ||
    input.version !== 1 ||
    input.kind !== "bot_pilot" ||
    input.policyVersion !== RATING_POLICY.version ||
    !Object.keys(RATING_POLICY.drawProbability).includes(input.mode) ||
    !["private", "public"].includes(input.anchorScope) ||
    !Number.isSafeInteger(input.afterSequence) ||
    input.afterSequence < 0 ||
    !Number.isSafeInteger(input.throughSequence) ||
    input.throughSequence < input.afterSequence ||
    !Number.isSafeInteger(input.capturedAt) ||
    input.capturedAt < 0 ||
    !Array.isArray(input.references) ||
    input.references.length > 10000 ||
    !Array.isArray(input.trials) ||
    input.trials.length > 10000 ||
    !Array.isArray(input.skipped) ||
    input.skipped.length > 10000
  )
    throw new Error("Invalid pilot dataset or policy");
  const references = new Set<string>();
  for (const ref of input.references) {
    const reference = canonicalBotReference(ref.reference);
    if (
      !/^[0-9a-f]{64}$/.test(ref.id) ||
      references.has(ref.id) ||
      reference.preset === "custom" ||
      !["none", "loaded"].includes(reference.model.status)
    )
      throw new Error("Invalid pilot reference");
    references.add(ref.id);
  }
  const sequences = new Set<number>();
  const matchIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      !Number.isSafeInteger(trial.sequence) ||
      trial.sequence <= input.afterSequence ||
      trial.sequence > input.throughSequence ||
      sequences.has(trial.sequence) ||
      typeof trial.matchId !== "string" ||
      !trial.matchId ||
      matchIds.has(trial.matchId) ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(trial.map) ||
      !/^[0-9a-f]{64}$/.test(trial.mapDigest) ||
      !references.has(trial.referenceId) ||
      !Array.isArray(trial.groups) ||
      trial.groups.length < 2 ||
      trial.groups.length > 10
    )
      throw new Error("Invalid or duplicate pilot trial");
    sequences.add(trial.sequence);
    matchIds.add(trial.matchId);
    const people = new Set<string>();
    let bots = 0,
      humans = 0;
    for (const group of trial.groups) {
      if (
        !Number.isSafeInteger(group.rank) ||
        group.rank < 0 ||
        !Array.isArray(group.players) ||
        group.players.length === 0 ||
        group.players.length > 10
      )
        throw new Error("Invalid pilot group");
      for (const player of group.players) {
        if (typeof player.playerId !== "string" || people.has(player.playerId))
          throw new Error("Duplicate pilot participant");
        people.add(player.playerId);
        if (player.kind === "bot") {
          if (player.playerId !== "bot") throw new Error("Invalid pilot bot");
          bots++;
        } else if (player.kind === "human") {
          if (
            !/^h:[1-9][0-9]{0,15}$/.test(player.playerId) ||
            !Number.isSafeInteger(player.anchorSequence) ||
            player.anchorSequence < 1 ||
            player.anchorSequence >= trial.sequence
          )
            throw new Error("Invalid/future pilot anchor");
          validateRatingState(player.state);
          if (isProvisional(player.state)) throw new Error("Pilot human anchor is provisional");
          humans++;
        } else throw new Error("Invalid pilot participant kind");
      }
    }
    if (
      bots !== 1 ||
      humans === 0 ||
      people.size > 10 ||
      ((input.mode === "duel" || input.mode === "amphi") && (trial.groups.length !== 2 || people.size !== 2)) ||
      (input.mode === "snd" && trial.groups.length !== 2) ||
      (input.mode === "ffa" && trial.groups.some((g) => g.players.length !== 1))
    )
      throw new Error("Pilot requires one bot and a supported complete contest");
  }
}

function fitReference(mode: RatingMode, trials: readonly PilotTrial[]) {
  let state = initialRating();
  for (const trial of trials) {
    const update = rateMatch(
      mode,
      trial.groups.map((group) => ({
        rank: group.rank,
        players: group.players.map((player) => ({
          playerId: player.playerId,
          state: player.kind === "bot" ? state : player.state,
        })),
      })),
    ).find((player) => player.playerId === "bot");
    if (!update) throw new Error("Pilot solver did not return the bot posterior");
    state = update.after;
  }
  return state;
}

export function analyzePilot(pilot: BotPilot) {
  validatePilot(pilot);
  const fits = pilot.references.map((ref) => {
    const trials = pilot.trials.filter((t) => t.referenceId === ref.id).sort((a, b) => a.sequence - b.sequence);
    const humans = new Set(
      trials.flatMap((t) =>
        t.groups.flatMap((g) => g.players.filter((p) => p.kind === "human").map((p) => p.playerId)),
      ),
    );
    const maps = [...new Set(trials.map((t) => t.map))].sort();
    const issues: string[] = [];
    const mapDigests: Record<string, string> = {};
    for (const trial of trials) {
      if (mapDigests[trial.map] && mapDigests[trial.map] !== trial.mapDigest) issues.push(`map_changed:${trial.map}`);
      mapDigests[trial.map] = trial.mapDigest;
    }
    if (trials.length < 30) issues.push("fewer_than_30_trials");
    if (humans.size < 3) issues.push("fewer_than_3_humans");
    let wins = 0,
      draws = 0,
      losses = 0;
    for (const trial of trials) {
      const botGroup = trial.groups.find((g) => g.players.some((p) => p.kind === "bot"))!;
      if (trial.groups.some((g) => g.rank < botGroup.rank)) losses++;
      else if (trial.groups.some((g) => g !== botGroup && g.rank === botGroup.rank)) draws++;
      else wins++;
    }
    if (trials.length && (!wins || !losses)) issues.push("one_sided_results");
    const state = trials.length ? fitReference(pilot.mode, trials) : null;
    return {
      referenceId: ref.id,
      reference: canonicalBotReference(ref.reference),
      matches: trials.length,
      humans: humans.size,
      maps,
      mapDigests,
      wins,
      draws,
      losses,
      state,
      reviewIssues: [...new Set(issues)],
    };
  });
  return {
    version: 1 as const,
    kind: "bot_pilot_analysis" as const,
    policyVersion: pilot.policyVersion,
    mode: pilot.mode,
    anchorScope: pilot.anchorScope,
    afterSequence: pilot.afterSequence,
    throughSequence: pilot.throughSequence,
    trials: pilot.trials.length,
    skipped: pilot.skipped.length,
    fits,
    method: "Sequential pinned TrueSkill bot posteriors with historical human anchors held fixed; offline draft only.",
    reviewed: false,
  };
}

export function pilotArtifact(pilot: BotPilot, referenceId: string, id: string, report: string): BotCalibration {
  const analysis = analyzePilot(pilot);
  const fitted = analysis.fits.find((f) => f.referenceId === referenceId);
  if (!fitted?.state || fitted.humans < 2 || fitted.reviewIssues.some((issue) => issue.startsWith("map_changed:")))
    throw new Error("A reviewed artifact requires two anchored humans and unchanged map coverage");
  return canonicalCalibration({
    version: 1,
    id,
    policyVersion: RATING_POLICY.version,
    mode: pilot.mode,
    reference: fitted.reference,
    mu: fitted.state.mu,
    sigma: fitted.state.sigma,
    evidence: {
      kind: "human_pilot",
      matches: fitted.matches,
      humans: fitted.humans,
      maps: fitted.maps,
      mapDigests: fitted.mapDigests,
      report,
      createdAt: pilot.capturedAt,
    },
  });
}
