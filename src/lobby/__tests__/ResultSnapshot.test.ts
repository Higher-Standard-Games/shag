import { describe, expect, it } from "vitest";
import { resultReport } from "../../engine/server/network/__tests__/_resultReport";
import { issueMatchAdmission } from "../../engine/server/network/MatchAdmission";
import { signMatchResult, verifyMatchResult } from "../../engine/server/network/MatchResultReport";
import { matchStats } from "../../shared/ranking/__tests__/_matchStats";
import { matchRatingGroups } from "../../shared/ranking/MatchRatingGroups";
import { canonicalSnapshot, normalizeResult } from "../ResultSnapshot";

function fixture() {
  const roster = [
    { lobbyPlayerId: "first", accountId: 1, name: "First", team: "alpha", isBot: false },
    { lobbyPlayerId: "second", accountId: 2, name: "Second", team: "bravo", isBot: false },
  ];
  const admission = issueMatchAdmission("snapshot", roster, 1000, 10000, 20000);
  const report = resultReport(
    {
      matchId: "snapshot",
      gametype: "duel",
      map: "wdm2",
      endedAt: 2000,
      participants: [
        { tokenHash: admission.manifest.grants[0].tokenHash, accountId: 1, outcome: "win", score: 3 },
        { tokenHash: admission.manifest.grants[2].tokenHash, accountId: 2, outcome: "loss", score: 0 },
      ],
    },
    admission.manifest,
  );
  return { roster, admission, report, context: { private: false, ranked: true, bots: 0, startingRoster: roster } };
}

describe("verified V2 result normalization", () => {
  it.each(["duel", "amphi", "snd"] as const)("keeps lobby display sides eligible in %s", (gametype) => {
    const { report, context } = fixture();
    report.gametype = gametype;
    const snapshot = normalizeResult(report, context);
    expect(snapshot.seats.find((seat) => seat.accountId === 1)?.team).toBe("soba");
    expect(snapshot.seats.find((seat) => seat.accountId === 2)?.team).toBe("udon");
    expect(matchRatingGroups(snapshot).status).toBe("applied");
  });
  it("preserves canonical gameplay totals and rejects invalid persisted counters", () => {
    const { report, context } = fixture();
    report.details.seats[0].stats = matchStats();
    const snapshot = normalizeResult(report, context);
    expect(snapshot.seats.find((s) => s.accountId === 1)?.stats).toEqual(matchStats());
    snapshot.seats.find((s) => s.accountId === 1)!.stats!.damageGiven = -1;
    expect(() => canonicalSnapshot(snapshot)).toThrow("match stats");
  });
  it("preserves the authenticated snapshot and initial roster without authentication material", () => {
    const { report, context, admission } = fixture();
    const verified = verifyMatchResult(
      signMatchResult(report, "test-secret"),
      "test-secret",
      {
        matchId: report.matchId,
        gametype: report.gametype,
        map: report.map,
        startedAt: 1000,
        admission: admission.manifest,
      },
      2000,
    )!;
    expect(verified).not.toBeNull();
    const snapshot = normalizeResult(verified, context);
    expect(snapshot).toMatchObject({
      version: 2,
      scope: "public",
      record: { status: "recorded", reason: "eligible" },
      startingRoster: [
        { accountId: 1, isBot: false, team: "soba" },
        { accountId: 2, isBot: false, team: "udon" },
      ],
    });
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain("test-secret");
    expect(text).not.toContain("name");
    expect(text).not.toContain("lobbyPlayerId");
    for (const grant of admission.manifest.grants) expect(text).not.toContain(grant.tokenHash);
    for (const ticket of admission.tickets.values()) expect(text).not.toContain(ticket);
    expect(snapshot.seats.find((s) => s.accountId === 1)?.seatId).toBe(admission.manifest.grants[0].seatId);
    report.details.teams.find((t) => t.id === "soba")!.score = 42;
    expect(snapshot.teams.find((t) => t.id === "soba")?.score).toBe(3);
  });

  it("canonicalizes roster/member order and discards extra properties", () => {
    const { report, context } = fixture();
    const original = normalizeResult(report, context);
    report.details.seats.reverse();
    report.details.teams.reverse();
    report.participants.reverse();
    context.startingRoster.reverse();
    expect(normalizeResult(report, context)).toEqual(original);
    const extra = {
      ...original,
      ticket: "unwanted",
      record: { ...original.record, tokenHash: "unwanted" },
      seats: original.seats.map((s) => ({ ...s, tokenHash: "unwanted" })),
    };
    expect(JSON.stringify(canonicalSnapshot(extra))).not.toContain("unwanted");
  });

  it("keeps omitted legacy participation metadata omitted during canonical replay", () => {
    const { report, context } = fixture();
    for (const seat of report.details.seats) delete seat.participationInterrupted;
    const snapshot = normalizeResult(report, context);
    expect(snapshot.seats.every((seat) => !("participationInterrupted" in seat))).toBe(true);
    expect(JSON.stringify(canonicalSnapshot(JSON.parse(JSON.stringify(snapshot))))).toBe(JSON.stringify(snapshot));
    expect(JSON.stringify(snapshot)).not.toContain("participationInterrupted");
  });

  it("preserves all FFA ties, including lower tied placements", () => {
    const { report, context } = fixture();
    report.gametype = "ffa";
    report.details.teams = [];
    report.participants = [1, 2, 3, 4].map((accountId, i) => ({
      tokenHash: `token-${i}`,
      accountId,
      score: i < 2 ? 5 : 1,
      outcome: i < 2 ? "draw" : "loss",
    }));
    report.details.seats = report.participants.map((p, i) => ({
      seatId: `seat-${i}`,
      tokenHash: p.tokenHash,
      team: "ffa",
      teamsPlayed: ["ffa"],
      joinedAtTick: 0,
      leftAtTick: null,
      disconnected: false,
      forfeited: false,
      lateJoin: false,
      placement: i < 2 ? 1 : 3,
    }));
    context.startingRoster = report.participants.map((p, i) => ({
      lobbyPlayerId: String(i),
      accountId: p.accountId!,
      name: "Player",
      team: "ffa",
      isBot: false,
    }));
    expect(normalizeResult(report, context).seats.map((s) => [s.placement, s.outcome])).toEqual([
      [1, "draw"],
      [1, "draw"],
      [3, "loss"],
      [3, "loss"],
    ]);
  });

  it("uses a valid forfeit outcome even if the departed player led on score", () => {
    const { report, context } = fixture();
    report.details.completion = "forfeit";
    report.details.teams[0] = { id: "udon", score: 0, placement: 1 };
    report.details.teams[1] = { id: "soba", score: 9, placement: 2 };
    report.participants[0].score = 9;
    report.participants[0].outcome = "loss";
    report.participants[1].outcome = "win";
    Object.assign(report.details.seats[0], { placement: 2, leftAtTick: 1, disconnected: true, forfeited: true });
    report.details.seats[1].placement = 1;
    const snapshot = normalizeResult(report, context);
    expect(snapshot.seats.find((s) => s.accountId === 1)).toMatchObject({
      score: 9,
      outcome: "loss",
      forfeited: true,
      disconnected: true,
    });
  });

  it("keeps late participation, permanent departures and switched team membership for later eligibility decisions", () => {
    const { report, context } = fixture();
    report.details.endedAtTick = 100;
    Object.assign(report.details.seats[0], {
      joinedAtTick: 10,
      lateJoin: true,
      leftAtTick: 50,
      disconnected: true,
      teamsPlayed: ["soba", "udon"],
    });
    const snapshot = normalizeResult(report, context);
    expect(snapshot.seats.find((s) => s.accountId === 1)).toMatchObject({
      joinedAtTick: 10,
      lateJoin: true,
      leftAtTick: 50,
      disconnected: true,
      teamsPlayed: ["soba", "udon"],
    });
  });

  it("retains bot-only receipts as excluded with no human board entries", () => {
    const { report, context } = fixture();
    for (const p of report.participants) p.accountId = null;
    const snapshot = normalizeResult(report, {
      ...context,
      private: true,
      bots: 2,
      startingRoster: context.startingRoster.map((p) => ({ ...p, accountId: null, isBot: true })),
    });
    expect(snapshot.record).toEqual({ status: "excluded", reason: "too_few_accounts" });
    expect(snapshot.seats.every((p) => p.accountId === null)).toBe(true);
  });

  it("refuses public bot records even with a ranked context flag", () => {
    const { report, context } = fixture();
    report.participants[1].accountId = null;
    const snapshot = normalizeResult(report, { ...context, bots: 1, startingRoster: undefined });
    expect(snapshot.record).toEqual({ status: "excluded", reason: "public_roster_ineligible" });
  });

  it.each([
    "duplicate_account",
    "duplicate_seat",
    "bad_tick",
    "bad_outcome",
    "bad_score",
    "bad_placement",
    "bad_roster",
  ])("rejects inconsistent %s snapshots", (kind) => {
    const { report, context } = fixture();
    const snapshot = normalizeResult(report, context);
    if (kind === "duplicate_account") snapshot.seats[1].accountId = snapshot.seats[0].accountId;
    if (kind === "duplicate_seat") snapshot.seats[1].seatId = snapshot.seats[0].seatId;
    if (kind === "bad_tick") snapshot.seats[0].joinedAtTick = snapshot.endedAtTick + 1;
    if (kind === "bad_outcome") snapshot.seats[0].outcome = snapshot.seats[0].outcome === "loss" ? "win" : "loss";
    if (kind === "bad_score") snapshot.seats[0].score = 4;
    if (kind === "bad_placement") snapshot.seats[0].placement = 99;
    if (kind === "bad_roster") snapshot.startingRoster![0].isBot = true;
    expect(() => canonicalSnapshot(snapshot)).toThrow();
  });
});
