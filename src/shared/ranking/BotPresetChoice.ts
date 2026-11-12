import { BOT_ACCOUNT_PRESETS, type BotPreset } from "./BotMatchRatingGroups";
import { RATING_POLICY } from "./RatingPolicy";

/**
 * The bot to field against a player: the preset whose fixed strength is
 * nearest their skill. A player with no rating yet meets Medium. Ties go to
 * the easier bot.
 */
export function chooseBotPreset(playerMu: number | null): BotPreset {
  if (playerMu === null) return "medium";
  let best: BotPreset = "medium";
  let gap = Number.POSITIVE_INFINITY;
  for (const preset of BOT_ACCOUNT_PRESETS) {
    const distance = Math.abs(RATING_POLICY.botReferences[preset].mu - playerMu);
    if (distance < gap) {
      best = preset;
      gap = distance;
    }
  }
  return best;
}
