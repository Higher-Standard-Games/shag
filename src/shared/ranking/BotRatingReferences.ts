import { type BotReference, canonicalBotReference } from "./BotReference";
import { RATING_POLICY, type RatingMode, validateRatingState } from "./RatingPolicy";

/** Immutable operator-reviewed artifact; no preset strengths are shipped. */
export interface BotCalibration {
  version: 1;
  id: string;
  policyVersion: string;
  mode: RatingMode;
  reference: BotReference;
  mu: number;
  sigma: number;
  evidence: {
    kind: "human_pilot";
    matches: number;
    humans: number;
    maps: string[];
    report: string;
    createdAt: number;
    mapDigests?: Record<string, string>;
  };
}

export function canonicalCalibration(value: unknown): BotCalibration {
  if (!value || typeof value !== "object") throw new Error("Invalid bot calibration");
  const v = value as BotCalibration;
  if (
    v.version !== 1 ||
    typeof v.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(v.id) ||
    v.policyVersion !== RATING_POLICY.version ||
    !Object.keys(RATING_POLICY.drawProbability).includes(v.mode)
  )
    throw new Error("Unsupported bot calibration identity/policy");
  const reference = canonicalBotReference(v.reference);
  if (reference.preset === "custom" || !["none", "loaded"].includes(reference.model.status))
    throw new Error("Custom or unresolved bot configurations remain pending");
  validateRatingState({ policyVersion: v.policyVersion, mu: v.mu, sigma: v.sigma, ratedMatches: 0 });
  const e = v.evidence;
  if (
    !e ||
    e.kind !== "human_pilot" ||
    !Number.isSafeInteger(e.matches) ||
    e.matches < 1 ||
    !Number.isSafeInteger(e.humans) ||
    e.humans < 2 ||
    !Array.isArray(e.maps) ||
    e.maps.length === 0 ||
    e.maps.length > 64 ||
    e.maps.some((map) => typeof map !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(map)) ||
    new Set(e.maps).size !== e.maps.length ||
    typeof e.report !== "string" ||
    !e.report.trim() ||
    e.report.length > 2048 ||
    !Number.isSafeInteger(e.createdAt) ||
    e.createdAt < 0
  )
    throw new Error("Bot calibration requires human pilot evidence");
  const mapDigests = e.mapDigests;
  if (
    mapDigests !== undefined &&
    (!mapDigests ||
      typeof mapDigests !== "object" ||
      Array.isArray(mapDigests) ||
      Object.keys(mapDigests).length !== e.maps.length ||
      e.maps.some((map) => !/^[0-9a-f]{64}$/.test(mapDigests[map] ?? "")) ||
      Object.keys(mapDigests).some((map) => !e.maps.includes(map)))
  )
    throw new Error("Invalid calibrated map digests");
  return {
    version: 1,
    id: v.id,
    policyVersion: v.policyVersion,
    mode: v.mode,
    reference,
    mu: v.mu,
    sigma: v.sigma,
    evidence: {
      kind: "human_pilot",
      matches: e.matches,
      humans: e.humans,
      maps: [...e.maps].sort(),
      report: e.report.trim(),
      createdAt: e.createdAt,
      ...(mapDigests === undefined
        ? {}
        : { mapDigests: Object.fromEntries([...e.maps].sort().map((map) => [map, mapDigests[map]])) }),
    },
  };
}
