import { type BotReference, sameBotReference } from "./BotReference";
import {
  type AccountRatingGroup,
  type MatchRatingInput,
  matchRatingGroups,
  UNMAPPED_BOT_SEATS,
} from "./MatchRatingGroups";

/** The presets that are accounts; a custom difficulty names none. */
export const BOT_ACCOUNT_PRESETS = ["easy", "medium", "hard", "insane"] as const;
export type BotPreset = (typeof BOT_ACCOUNT_PRESETS)[number];

/**
 * A second bot of a preset already seated: it plays at that preset account's
 * current rating and leaves it unchanged, since one account takes one seat.
 */
export interface FixedBotBinding {
  seatId: string;
  accountId: number;
}
export interface BotAccountRatingGroup extends AccountRatingGroup {
  bots?: FixedBotBinding[];
}
export type BotMatchInput = Omit<MatchRatingInput, "startingRoster" | "seats"> & {
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
  | { status: "excluded"; reason: string };

/** The account a bot's preset stands for, or null for a custom bot. */
export function botPreset(reference: BotReference | undefined): BotPreset | null {
  const preset = reference?.preset;
  return BOT_ACCOUNT_PRESETS.includes(preset as BotPreset) ? (preset as BotPreset) : null;
}

/**
 * Rate a match with its bots standing for their preset accounts, under the
 * human participation rules. The first bot of each preset is that account; a
 * further one plays fixed at its rating under a temporary ID never saved.
 */
export function botMatchRatingGroups(
  input: BotMatchInput,
  accountFor: (preset: BotPreset) => number,
): BotGroupDecision {
  const initial = matchRatingGroups(input);
  if (initial.status === "applied" || initial.reason !== UNMAPPED_BOT_SEATS) return initial;
  const exclude = (reason: string) => ({ status: "excluded" as const, reason });
  if (input.botReferenceChanged !== false || !input.startingRoster) return exclude("bot_reference_missing");
  const originals = input.startingRoster.filter((p) => p.isBot);
  if (originals.some((p) => !p.botReference)) return exclude("bot_reference_missing");
  if (originals.some((p) => !botPreset(p.botReference))) return exclude("bot_custom");

  const accounts = new Set(input.seats.flatMap((p) => (p.accountId === null ? [] : [p.accountId])));
  for (const p of input.startingRoster) if (p.accountId !== null) accounts.add(p.accountId);
  let next = Number.MAX_SAFE_INTEGER;
  const seatedPresets = new Set<BotPreset>();
  const fixedOf = new Map<number, number>();
  const ids = originals.map((o) => {
    const preset = botPreset(o.botReference)!;
    const account = accountFor(preset);
    if (!seatedPresets.has(preset) && !accounts.has(account)) {
      seatedPresets.add(preset);
      accounts.add(account);
      return account;
    }
    while (accounts.has(next)) next--;
    const temporary = next--;
    accounts.add(temporary);
    fixedOf.set(temporary, account);
    return temporary;
  });

  const used = new Set<number>();
  const bindings = new Map<number, FixedBotBinding>();
  const seats = input.seats.map((p) => {
    if (p.accountId !== null || !p.botReference) return p;
    const candidates = originals
      .map((o, i) => ({ o, i }))
      .filter(({ o, i }) => !used.has(i) && sameBotReference(o.botReference, p.botReference));
    const original = candidates.find(({ o }) => o.team === p.team) ?? candidates[0];
    if (!original) return p;
    used.add(original.i);
    const id = ids[original.i];
    const fixed = fixedOf.get(id);
    if (fixed !== undefined) bindings.set(id, { seatId: p.seatId, accountId: fixed });
    return { ...p, accountId: id };
  });
  if (seats.some((p) => p.accountId === null)) return exclude("bot_reference_missing");
  let index = 0;
  const startingRoster = input.startingRoster.map((p) =>
    p.isBot ? { ...p, isBot: false, accountId: ids[index++] } : p,
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

/**
 * The seat each bot account played, by seat ID: the first bot of each preset.
 * Its record (win, loss, draw) is that account's, as a human seat's is theirs.
 */
export function botAccountSeats(
  input: Pick<BotMatchInput, "seats">,
  accountFor: (preset: BotPreset) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<BotPreset>();
  for (const seat of input.seats) {
    const preset = seat.accountId === null ? botPreset(seat.botReference) : null;
    if (!preset || taken.has(preset)) continue;
    taken.add(preset);
    out.set(seat.seatId, accountFor(preset));
  }
  return out;
}
