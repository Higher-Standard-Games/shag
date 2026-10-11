import { Rating, rate, TrueSkill } from "ts-trueskill";
import {
  conservativeScore,
  displayRating,
  RATING_POLICY,
  RatingError,
  type RatingMode,
  type RatingState,
  validateRatingState,
} from "./RatingPolicy";

export interface RatingPlayer {
  /** Stable account identity supplied by the authoritative caller. */
  readonly playerId: string;
  readonly state: RatingState;
}

export interface RatingGroup {
  /** Lower is better; equal ranks represent a draw, including tied FFA places. */
  readonly rank: number;
  readonly players: readonly RatingPlayer[];
}

export interface RatingUpdate {
  readonly playerId: string;
  readonly before: RatingState;
  readonly after: RatingState;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Human-only numerical adapter. Eligibility, pool isolation, bot references and
 * transactions belong to its caller. Equal full participation is assumed here.
 * Returns every update or throws; no input state is modified.
 */
export function rateMatch(mode: RatingMode, groups: readonly RatingGroup[]): RatingUpdate[] {
  if (!Object.keys(RATING_POLICY.drawProbability).includes(mode)) {
    throw new RatingError("invalid_input", "Unsupported rating mode");
  }
  if (groups.length < 2) {
    throw new RatingError("invalid_input", "A rating contest requires at least two groups");
  }
  const ids = new Set<string>();
  const canonical = groups.map((group) => {
    if (!Number.isSafeInteger(group.rank) || group.rank < 0 || group.players.length === 0) {
      throw new RatingError("invalid_input", "Rating groups require a nonnegative integer rank and players");
    }
    const players = group.players.map((player) => {
      if (
        typeof player.playerId !== "string" ||
        player.playerId.length === 0 ||
        player.playerId.trim() !== player.playerId ||
        ids.has(player.playerId)
      ) {
        throw new RatingError("invalid_input", "Player identities must be nonempty, unique and stable");
      }
      ids.add(player.playerId);
      validateRatingState(player.state);
      if (player.state.ratedMatches === Number.MAX_SAFE_INTEGER) {
        throw new RatingError("invalid_input", "Rated match count cannot be incremented safely");
      }
      conservativeScore(player.state);
      displayRating(player.state);
      return { playerId: player.playerId, state: { ...player.state } };
    });
    players.sort((a, b) => compareId(a.playerId, b.playerId));
    return { rank: group.rank, players };
  });
  // EP's tied-group approximation depends slightly on graph order. Stable IDs
  // make retries/replay invariant to incoming roster and team member ordering.
  canonical.sort((a, b) => a.rank - b.rank || compareId(a.players[0].playerId, b.players[0].playerId));
  const rankValues = [...new Set(canonical.map((group) => group.rank))];
  const ranks = canonical.map((group) => rankValues.indexOf(group.rank));
  const env = new TrueSkill(
    RATING_POLICY.initialMu,
    RATING_POLICY.initialSigma,
    RATING_POLICY.beta,
    RATING_POLICY.tau,
    RATING_POLICY.drawProbability[mode],
  );
  let posteriors: Rating[][];
  try {
    posteriors = rate(
      canonical.map((group) => group.players.map((player) => new Rating(player.state.mu, player.state.sigma))),
      ranks,
      undefined,
      RATING_POLICY.minDelta,
      env,
    );
  } catch (error) {
    throw new RatingError(
      "numerical_failure",
      `TrueSkill calculation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (posteriors.length !== canonical.length) {
    throw new RatingError("numerical_failure", "TrueSkill returned an incomplete contest");
  }
  const updates: RatingUpdate[] = [];
  for (let g = 0; g < canonical.length; g++) {
    const group = canonical[g];
    if (posteriors[g]?.length !== group.players.length) {
      throw new RatingError("numerical_failure", "TrueSkill returned an incomplete group");
    }
    for (let p = 0; p < group.players.length; p++) {
      const player = group.players[p];
      const posterior = posteriors[g][p];
      if (!Number.isFinite(posterior.mu) || !Number.isFinite(posterior.sigma) || posterior.sigma <= 0) {
        throw new RatingError("numerical_failure", "TrueSkill returned an invalid posterior");
      }
      const after: RatingState = {
        policyVersion: RATING_POLICY.version,
        mu: posterior.mu,
        sigma: posterior.sigma,
        ratedMatches: player.state.ratedMatches + 1,
      };
      conservativeScore(after);
      displayRating(after);
      updates.push({ playerId: player.playerId, before: player.state, after });
    }
  }
  return updates.sort((a, b) => compareId(a.playerId, b.playerId));
}
