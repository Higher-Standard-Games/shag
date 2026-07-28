/**
 * BotWeightProfile — the per-gametype behavioural policy that scales
 * considerations (docs/research/BOT_WEIGHTS_AND_GOALS.md §4).
 *
 * PHASE 1 SCOPE: the seam only. Every field exists so considerations can name
 * their weight key and the arbiter can apply it, but there is exactly one
 * profile and gametype selection is not wired. Phase 2 adds real profiles and
 * picks one from `MatchStateSnapshot.gametypeName` — a data change, not a
 * refactor, which is the entire reason the seam is here this early.
 *
 * These are POLICY (what to value), deliberately separate from `BotDifficulty`,
 * which is CAPABILITY (how well the bot executes). Collapsing the two is what
 * makes "hard" bots merely reckless — see §4.4.
 */

export interface BotWeightProfile {
  /** Do map items matter here at all? (0 in Clan Arena / Instagib.) */
  itemGreed: number;
  /** Advance and complete the gametype objective. Phase 4. */
  objectivePush: number;
  /** Stay within supporting distance of allies. Phase 4. */
  teamCohesion: number;
  /** Guard whoever holds the flag/bomb. Phase 4. */
  carrierProtect: number;
  /** Hold strong ground rather than roam. Phase 2+. */
  mapControl: number;
  /** Seek out and finish enemies. Phase 2+. */
  aggression: number;
  /**
   * How far the above push through danger. Higher = less suppression.
   * A modifier on the danger discount, not a goal of its own.
   */
  riskTolerance: number;
}

/**
 * Deathmatch-shaped default, used for every gametype until Phase 2.
 * Chosen so Phase 1 behaviour is "value items properly" and nothing else.
 */
export const DEFAULT_WEIGHT_PROFILE: BotWeightProfile = {
  itemGreed: 1.0,
  objectivePush: 0.0,
  teamCohesion: 0.0,
  carrierProtect: 0.0,
  mapControl: 0.3,
  aggression: 0.8,
  riskTolerance: 0.5,
};
