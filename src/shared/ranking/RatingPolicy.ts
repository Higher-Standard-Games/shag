/** Changing any numerical rule requires a new policy version and a separate replay. */
export const RATING_POLICY = Object.freeze({
  version: "shag-trueskill-v2",
  implementation: "ts-trueskill@5.1.0",
  initialMu: 25,
  initialSigma: 25 / 3,
  beta: 25 / 6,
  tau: 25 / 300,
  minDelta: 0.0001,
  // Starting model assumptions, not measured SHAG draw frequencies.
  drawProbability: Object.freeze({ duel: 0.1, amphi: 0.1, ffa: 0.1, snd: 0.1 }),
  conservativeMultiplier: 3,
  displayOffset: 1000,
  displayScale: 40,
  provisionalMinMatches: 10,
  provisionalMaxSigma: 25 / 6,
  // Each bot preset plays at a fixed strength, a standard step apart around a
  // new player's start; bot results move only the human ratings. A starting
  // assumption, not a measured bot skill.
  botReferences: Object.freeze({
    easy: Object.freeze({ mu: 25 - 25 / 3, sigma: 25 / 9 }),
    medium: Object.freeze({ mu: 25, sigma: 25 / 9 }),
    hard: Object.freeze({ mu: 25 + 25 / 3, sigma: 25 / 9 }),
    insane: Object.freeze({ mu: 25 + 50 / 3, sigma: 25 / 9 }),
  }),
});

export type RatingMode = keyof typeof RATING_POLICY.drawProbability;
export type BotReferencePreset = keyof typeof RATING_POLICY.botReferences;

/** The fixed strength a bot preset is rated against. */
export function botReferenceRating(preset: BotReferencePreset): RatingState {
  const { mu, sigma } = RATING_POLICY.botReferences[preset];
  return { policyVersion: RATING_POLICY.version, mu, sigma, ratedMatches: 0 };
}

export interface RatingState {
  readonly policyVersion: string;
  readonly mu: number;
  readonly sigma: number;
  readonly ratedMatches: number;
}

export type RatingErrorCode = "invalid_input" | "policy_mismatch" | "numerical_failure";

export class RatingError extends Error {
  constructor(
    readonly code: RatingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RatingError";
  }
}

export function initialRating(): RatingState {
  return {
    policyVersion: RATING_POLICY.version,
    mu: RATING_POLICY.initialMu,
    sigma: RATING_POLICY.initialSigma,
    ratedMatches: 0,
  };
}

export function validateRatingState(state: RatingState): void {
  if (!state || state.policyVersion !== RATING_POLICY.version) {
    throw new RatingError("policy_mismatch", "Rating state requires the current policy version");
  }
  if (
    !Number.isFinite(state.mu) ||
    !Number.isFinite(state.sigma) ||
    state.sigma <= 0 ||
    !Number.isSafeInteger(state.ratedMatches) ||
    state.ratedMatches < 0
  ) {
    throw new RatingError(
      "invalid_input",
      "Rating state requires finite skill, positive uncertainty and a nonnegative match count",
    );
  }
}

/** Full precision is the ladder sort key. Round only the displayed number. */
export function conservativeScore(state: RatingState): number {
  validateRatingState(state);
  const score = state.mu - RATING_POLICY.conservativeMultiplier * state.sigma;
  if (!Number.isFinite(score)) {
    throw new RatingError("numerical_failure", "Conservative rating score overflowed");
  }
  return score;
}

export function displayRating(state: RatingState): number {
  const value = RATING_POLICY.displayOffset + RATING_POLICY.displayScale * conservativeScore(state);
  if (!Number.isSafeInteger(Math.round(value))) {
    throw new RatingError("numerical_failure", "Displayed rating exceeds safe integer precision");
  }
  return Math.round(value);
}

/** A provisional account still appears after its first eligible match. */
export function isProvisional(state: RatingState): boolean {
  validateRatingState(state);
  return state.ratedMatches < RATING_POLICY.provisionalMinMatches || state.sigma > RATING_POLICY.provisionalMaxSigma;
}
