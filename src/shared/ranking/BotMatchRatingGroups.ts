import { type BotCalibration, canonicalCalibration } from "./BotRatingReferences";
import { type BotReference, sameBotReference } from "./BotReference";
import { type AccountRatingGroup, type MatchRatingInput, matchRatingGroups } from "./MatchRatingGroups";

export interface FixedBotBinding {
  seatId: string;
  calibrationId: string;
  mu: number;
  sigma: number;
}
export interface BotAccountRatingGroup extends AccountRatingGroup {
  bots?: FixedBotBinding[];
}
export type BotMatchInput = Omit<MatchRatingInput, "startingRoster" | "seats"> & {
  map: string;
  mapDigest?: string;
  startingRoster: Array<{
    accountId: number | null;
    isBot: boolean;
    team: "ffa" | "udon" | "soba";
    botReference?: BotReference;
  }> | null;
  seats: Array<MatchRatingInput["seats"][number] & { seatId: string; botReference?: BotReference }>;
};
export type BotGroupDecision =
  | { status: "applied"; groups: BotAccountRatingGroup[] }
  | { status: "excluded" | "pending"; reason: string };

/** Reuse human participation rules with temporary local IDs, never saved as accounts. */
export function botMatchRatingGroups(
  input: BotMatchInput,
  resolve: (reference: BotReference) => BotCalibration | null,
): BotGroupDecision {
  const pending = { status: "pending" as const, reason: "bot_reference_pending" };
  const initial = matchRatingGroups(input);
  if (initial.status !== "pending") return initial;
  if (input.botReferenceChanged !== false || !input.startingRoster) return pending;
  const originals = input.startingRoster.filter((p) => p.isBot);
  if (originals.some((p) => !p.botReference)) return pending;
  const used = new Set<number>();
  const accounts = new Set(input.seats.flatMap((p) => (p.accountId === null ? [] : [p.accountId])));
  for (const p of input.startingRoster) if (p.accountId !== null) accounts.add(p.accountId);
  let next = Number.MAX_SAFE_INTEGER;
  const temporary = originals.map(() => {
    while (accounts.has(next)) next--;
    const id = next--;
    accounts.add(id);
    return id;
  });
  const bindings = new Map<number, FixedBotBinding>();
  const seats = input.seats.map((p) => {
    if (p.accountId !== null) return p;
    if (!p.botReference) return p;
    const candidates = originals
      .map((o, i) => ({ o, i }))
      .filter(({ o, i }) => !used.has(i) && sameBotReference(o.botReference, p.botReference));
    const original = candidates.find(({ o }) => o.team === p.team) ?? candidates[0];
    const found = resolve(p.botReference);
    if (!original || !found) return p;
    const calibration = canonicalCalibration(found);
    if (
      calibration.mode !== input.gametype ||
      !calibration.evidence.maps.includes(input.map) ||
      (calibration.evidence.mapDigests !== undefined &&
        calibration.evidence.mapDigests[input.map] !== input.mapDigest) ||
      !sameBotReference(calibration.reference, p.botReference)
    )
      return p;
    used.add(original.i);
    const id = temporary[original.i];
    bindings.set(id, { seatId: p.seatId, calibrationId: calibration.id, mu: calibration.mu, sigma: calibration.sigma });
    return { ...p, accountId: id };
  });
  if (seats.some((p) => p.accountId === null)) return pending;
  let index = 0;
  const startingRoster = input.startingRoster.map((p) =>
    p.isBot ? { ...p, isBot: false, accountId: temporary[index++] } : p,
  );
  const decision = matchRatingGroups({ ...input, bots: 0, startingRoster, seats });
  if (decision.status !== "applied") return decision;
  return {
    status: "applied",
    groups: decision.groups.map((g) => {
      const bots = g.accountIds
        .flatMap((id) => (bindings.has(id) ? [bindings.get(id)!] : []))
        .sort((a, b) => (a.seatId < b.seatId ? -1 : a.seatId > b.seatId ? 1 : 0));
      return {
        rank: g.rank,
        accountIds: g.accountIds.filter((id) => !bindings.has(id)),
        ...(bots.length ? { bots } : {}),
      };
    }),
  };
}
