import { BOT_ACCOUNT_PRESETS, type BotPreset } from "./BotMatchRatingGroups";
import { RATING_POLICY } from "./RatingPolicy";

/**
 * Where each preset is placed before it has a rating of its own: its order,
 * spread a standard step apart around a new player's starting skill. Used
 * only to choose a bot, never as a rating, so a preset nobody has played yet
 * still has its place and gets picked as a player climbs to it.
 */
const PRESET_PLACE: Record<BotPreset, number> = {
  easy: RATING_POLICY.initialMu - RATING_POLICY.initialSigma,
  medium: RATING_POLICY.initialMu,
  hard: RATING_POLICY.initialMu + RATING_POLICY.initialSigma,
  insane: RATING_POLICY.initialMu + 2 * RATING_POLICY.initialSigma,
};

/**
 * The bot to field against a player: the preset whose skill in this pool is
 * nearest theirs. A preset's own rating counts once it has one; a player with
 * no rating yet meets Medium. Ties go to the easier bot.
 */
export function chooseBotPreset(playerMu: number | null, presetMu: (preset: BotPreset) => number | null): BotPreset {
  if (playerMu === null) return "medium";
  let best: BotPreset = "medium";
  let gap = Number.POSITIVE_INFINITY;
  for (const preset of BOT_ACCOUNT_PRESETS) {
    const distance = Math.abs((presetMu(preset) ?? PRESET_PLACE[preset]) - playerMu);
    if (distance < gap) {
      best = preset;
      gap = distance;
    }
  }
  return best;
}
