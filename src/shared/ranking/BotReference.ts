/** Calibration identity, supplied only by the authenticated bot service. */
export interface BotReference {
  version: 1;
  preset: "easy" | "medium" | "hard" | "insane" | "custom";
  difficulty: {
    aimAccuracy: number;
    reactionTimeMs: number;
    trackingSpeed: number;
    predictionSkill: number;
    itemTimingSkill: number;
    strafeJumpSkill: number;
    dodgeSkill: number;
    mistakeRate: number;
    lookAroundInterval: number;
  };
  goalArbiter: "legacy" | "on" | "verbose";
  /** Content digest of the bot behavior build, independent of process/name. */
  behavior: string;
  model: {
    status: "none" | "loading" | "loaded" | "fallback" | "unstable";
    digest: string | null;
    tactical: boolean;
    combat: boolean;
  };
}

export const BOT_DIFFICULTY_FIELDS = [
  "aimAccuracy",
  "reactionTimeMs",
  "trackingSpeed",
  "predictionSkill",
  "itemTimingSkill",
  "strafeJumpSkill",
  "dodgeSkill",
  "mistakeRate",
  "lookAroundInterval",
] as const;

/** Bounded whitelist at every trust boundary; never stores paths or arbitrary fields. */
export function canonicalBotReference(value: unknown): BotReference {
  if (!value || typeof value !== "object") throw new Error("Invalid bot reference");
  const v = value as BotReference;
  const digest = (x: unknown) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (
    v.version !== 1 ||
    !["easy", "medium", "hard", "insane", "custom"].includes(v.preset) ||
    !["legacy", "on", "verbose"].includes(v.goalArbiter) ||
    !digest(v.behavior) ||
    !v.difficulty ||
    !v.model ||
    !["none", "loading", "loaded", "fallback", "unstable"].includes(v.model.status) ||
    (v.model.digest !== null && !digest(v.model.digest)) ||
    typeof v.model.tactical !== "boolean" ||
    typeof v.model.combat !== "boolean"
  )
    throw new Error("Invalid bot reference");
  const difficulty = {} as BotReference["difficulty"];
  for (const field of BOT_DIFFICULTY_FIELDS) {
    const n = v.difficulty[field];
    const fraction = field.endsWith("Skill") || field === "aimAccuracy";
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > (fraction ? 1 : 1_000_000))
      throw new Error("Invalid bot difficulty");
    difficulty[field] = n;
  }
  const loaded = v.model.tactical || v.model.combat;
  if (v.model.status === "loaded" ? !loaded || v.model.digest === null : v.model.status !== "unstable" && loaded)
    throw new Error("Invalid bot model state");
  if (v.model.status === "none" && v.model.digest !== null) throw new Error("Invalid bot model state");
  return {
    version: 1,
    preset: v.preset,
    difficulty,
    goalArbiter: v.goalArbiter,
    behavior: v.behavior,
    model: { status: v.model.status, digest: v.model.digest, tactical: v.model.tactical, combat: v.model.combat },
  };
}

export function sameBotReference(a: BotReference | undefined, b: BotReference | undefined): boolean {
  return (
    JSON.stringify(a === undefined ? null : canonicalBotReference(a)) ===
    JSON.stringify(b === undefined ? null : canonicalBotReference(b))
  );
}
