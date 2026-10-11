import type { RatingMode } from "./RatingPolicy";
import { type RatingPlayer, type RatingUpdate, rateMatch } from "./TrueSkillRating";

export interface ReferenceRatingGroup {
  rank: number;
  players: Array<RatingPlayer & { fixed?: boolean }>;
}

/** Condition the contest on calibrated opponent priors; persist only human posteriors. */
export function rateWithFixedReferences(mode: RatingMode, groups: readonly ReferenceRatingGroup[]): RatingUpdate[] {
  if (!groups.some((g) => g.players.some((p) => !p.fixed)))
    throw new Error("Bot-only contests cannot update human skill");
  const fixed = new Set(groups.flatMap((g) => g.players.filter((p) => p.fixed).map((p) => p.playerId)));
  return rateMatch(mode, groups).filter((update) => !fixed.has(update.playerId));
}
