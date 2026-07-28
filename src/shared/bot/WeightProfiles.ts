/**
 * Bot behavioural weight profiles — per-gametype POLICY as plain data
 * (docs/research/BOT_WEIGHTS_AND_GOALS.md §4).
 *
 * Lives in `shared/` rather than `src/bot/` deliberately. A gametype owns the
 * answer to "what does this mode value", and from Phase 4 it will publish
 * directives alongside these weights; putting the profiles here lets a server
 * gametype reference its own policy without importing bot implementation code
 * across the process boundary.
 *
 * The bot owns the SKILL (the consideration functions that produce scores);
 * this file owns the POLICY (how much each of those scores counts). Neither is
 * `BotDifficulty`, which is CAPABILITY — how well the bot executes. Collapsing
 * policy into capability is what makes "hard" bots merely reckless (§4.4).
 *
 * No protocol change is needed to use these: `MatchStateSnapshot.gametypeName`
 * is already on the wire, so a bot selects its profile from data it already
 * receives.
 */

export interface BotWeightProfile {
  /** How much the bot values an item for its own use. */
  itemGreed: number;
  /**
   * How much it values an item simply for the enemy not having it.
   *
   * Split from `itemGreed` because a single knob over both attractors cancels
   * out: scaling every item candidate by the same factor leaves the ranking
   * among them identical, so the weight could only ever act as an on/off switch.
   * Separating them is what lets duel (contest everything) differ from
   * deathmatch (take what you need) with no code difference.
   */
  itemDenial: number;
  /** Advance and complete the gametype objective. Phase 4. */
  objectivePush: number;
  /** Stay within supporting distance of allies. Phase 4. */
  teamCohesion: number;
  /** Guard whoever holds the flag/bomb. Phase 4. */
  carrierProtect: number;
  /** Hold strong ground rather than roam. Phase 3+. */
  mapControl: number;
  /** Seek out and finish enemies. Phase 3+. */
  aggression: number;
  /**
   * How far the above push through danger. Higher = less suppression.
   * A modifier on the danger discount, not a goal of its own.
   */
  riskTolerance: number;
}

/**
 * Fallback for any gametype without an entry. Deathmatch-shaped, because an
 * unknown mode behaving like deathmatch is always safe — a missing profile must
 * never throw or produce a bot that stands still.
 */
export const DEFAULT_WEIGHT_PROFILE: BotWeightProfile = {
  itemGreed: 1.0,
  itemDenial: 0.3,
  objectivePush: 0.0,
  teamCohesion: 0.0,
  carrierProtect: 0.0,
  mapControl: 0.3,
  aggression: 0.8,
  riskTolerance: 0.5,
};

/**
 * Profiles by normalized key. Adding a gametype is an entry here plus, from
 * Phase 4, a directive emitter — never a change to bot code.
 */
export const WEIGHT_PROFILES: Readonly<Record<string, BotWeightProfile>> = {
  // Selfish and item-hungry: take what you need, contest only the big prizes.
  deathmatch: {
    ...DEFAULT_WEIGHT_PROFILE,
    itemGreed: 1.0,
    itemDenial: 0.3,
    aggression: 0.8,
    riskTolerance: 0.5,
  },

  // Slightly more cautious than FFA — dying feeds the other team's score.
  team_deathmatch: {
    ...DEFAULT_WEIGHT_PROFILE,
    itemGreed: 0.9,
    itemDenial: 0.4,
    teamCohesion: 0.5,
    mapControl: 0.4,
    aggression: 0.7,
    riskTolerance: 0.4,
  },

  // Duel IS item control. Denying the opponent a Mega or Red Armor is worth as
  // much as taking it, so denial is nearly as strong as personal need — and the
  // bot plays tighter, because in a 1v1 a bad trade loses the round.
  duel: {
    ...DEFAULT_WEIGHT_PROFILE,
    itemGreed: 1.0,
    itemDenial: 0.9,
    mapControl: 0.9,
    aggression: 0.5,
    riskTolerance: 0.3,
  },
};

/**
 * Normalize a gametype display name into a profile key.
 * "Team Deathmatch" -> "team_deathmatch".
 */
export function weightProfileKey(gametypeName: string | undefined | null): string {
  if (!gametypeName) return "";
  return gametypeName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Select a profile for a gametype, optionally narrowed by role and round state
 * for modes where those change what the team wants (S&D defenders become
 * defusers after the plant).
 *
 * Resolution order, most specific first:
 *   gametype:role:roundState -> gametype:role -> gametype -> DEFAULT
 *
 * Never throws and never returns undefined; an unknown mode plays deathmatch.
 */
export function selectWeightProfile(
  gametypeName: string | undefined | null,
  role?: string | null,
  roundState?: string | null,
): BotWeightProfile {
  const base = weightProfileKey(gametypeName);
  if (!base) return DEFAULT_WEIGHT_PROFILE;

  const candidates: string[] = [];
  if (role && roundState) candidates.push(`${base}:${role}:${roundState}`);
  if (role) candidates.push(`${base}:${role}`);
  candidates.push(base);

  for (const key of candidates) {
    const profile = WEIGHT_PROFILES[key];
    if (profile) return profile;
  }
  return DEFAULT_WEIGHT_PROFILE;
}
