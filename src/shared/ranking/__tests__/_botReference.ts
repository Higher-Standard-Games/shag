import type { BotReference } from "../BotReference";
export function botReference(): BotReference {
  return {
    version: 1,
    preset: "medium",
    difficulty: {
      aimAccuracy: 0.5,
      reactionTimeMs: 280,
      trackingSpeed: 3,
      predictionSkill: 0.5,
      itemTimingSkill: 0.4,
      strafeJumpSkill: 0.4,
      dodgeSkill: 0.4,
      mistakeRate: 3,
      lookAroundInterval: 3.5,
    },
    goalArbiter: "on",
    behavior: "a".repeat(64),
    model: { status: "none", digest: null, tactical: false, combat: false },
  };
}
