import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueMatchAdmission } from "../../engine/server/network/MatchAdmission";
import {
  type MatchResultReport,
  signMatchResult,
  verifyMatchResult,
} from "../../engine/server/network/MatchResultReport";
import { conservativeScore, displayRating, isProvisional, type RatingMode } from "../../shared/ranking/RatingPolicy";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import type { ResultContext } from "../ResultSnapshot";

describe("signed human results to transactional skill", () => {
  let dir: string;
  let players: PlayerStore;
  let results: MatchResultStore;
  let ids: number[];
  const now = Date.UTC(2026, 9, 11);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-human-ratings-"));
    players = PlayerStore.open(dir);
    ids = Array.from({ length: 10 }, () => players.create().account.id);
    results = MatchResultStore.open(dir);
  });
  afterEach(() => {
    results.close();
    players.close();
    const target = path.resolve(dir);
    if (
      !target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) ||
      !path.basename(target).startsWith("shag-human-ratings-")
    )
      throw new Error("Unexpected human rating test cleanup target");
    fs.rmSync(target, { recursive: true, force: true });
  });

  function contest(mode: RatingMode, scope: "public" | "private", count = 2) {
    const ffa = mode === "ffa";
    const matchId = `${mode}-${scope}`;
    const roster = ids.slice(0, count).map((accountId, i) => ({
      lobbyPlayerId: String(accountId),
      accountId,
      name: `Player ${i}`,
      isBot: false,
      team: ffa ? "ffa" : i < Math.floor(count / 2) ? "udon" : "soba",
    }));
    const { manifest } = issueMatchAdmission(matchId, roster, now - 1000);
    const report: MatchResultReport = {
      matchId,
      gametype: mode,
      map: "wdm2",
      endedAt: now,
      participants: manifest.grants.map((grant, i) => ({
        tokenHash: grant.tokenHash,
        accountId: grant.accountId,
        score: ffa ? count - i : grant.team === "udon" ? 3 : 0,
        outcome: ffa ? (i === 0 ? "win" : "loss") : grant.team === "udon" ? "win" : "loss",
      })),
      details: {
        version: 2,
        startedAt: now - 500,
        startedAtTick: 10,
        endedAtTick: 100,
        completion: "normal",
        teams: ffa
          ? []
          : [
              { id: "udon", score: 3, placement: 1 },
              { id: "soba", score: 0, placement: 2 },
            ],
        seats: manifest.grants.map((grant, i) => ({
          seatId: grant.seatId!,
          tokenHash: grant.tokenHash,
          team: grant.team as "ffa" | "udon" | "soba",
          teamsPlayed: [grant.team as "ffa" | "udon" | "soba"],
          joinedAtTick: 10,
          leftAtTick: null,
          disconnected: false,
          forfeited: false,
          lateJoin: false,
          participationInterrupted: false,
          placement: ffa ? i + 1 : grant.team === "udon" ? 1 : 2,
        })),
      },
    };
    const context: ResultContext = { private: scope === "private", ranked: true, bots: 0, startingRoster: roster };
    function submit() {
      const verified = verifyMatchResult(
        signMatchResult(report, "secret"),
        "secret",
        { matchId, gametype: mode, map: "wdm2", startedAt: now - 1000, admission: manifest },
        now,
      );
      expect(verified).not.toBeNull();
      return results.recordVerified(verified!, context);
    }
    return { report, context, submit };
  }

  it.each(["duel", "amphi", "snd", "ffa"] as const)(
    "applies %s human results once in independent public/private pools and survives reopen",
    (mode) => {
      for (const scope of ["public", "private"] as const) {
        const c = contest(mode, scope);
        expect(c.submit()).toMatchObject({
          status: "stored",
          recordStatus: "recorded",
          ratingStatus: "applied",
          ratingReason: "eligible",
        });
        expect(c.submit()).toMatchObject({ status: "duplicate", ratingStatus: "applied" });
        const first = results.ratings.getRating(ids[0], mode, scope)!;
        expect(first.state.ratedMatches).toBe(1);
        expect(isProvisional(first.state)).toBe(true);
        expect(first.state.mu).toBeGreaterThan(results.ratings.getRating(ids[1], mode, scope)!.state.mu);
        const page = results.skillLeaderboard({
          gametype: mode,
          scope,
          period: "all",
          offset: 0,
          limit: 1,
          accountId: ids[1],
          now,
        });
        expect(page).toMatchObject({
          system: "trueskill",
          policyVersion: "shag-trueskill-v1",
          total: 2,
          entries: [
            {
              accountId: ids[0],
              rank: 1,
              ratedMatches: 1,
              provisional: true,
              rating: displayRating(first.state),
              conservativeScore: conservativeScore(first.state),
            },
          ],
          localPlayerRank: 2,
          localPlayerEntry: { accountId: ids[1], rank: 2, ratedMatches: 1 },
          localProcessing: { excluded: 0 },
        });
      }
      results.close();
      results = MatchResultStore.open(dir);
      expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 2, updates: 4, ratings: 4 });
      expect(results.ratings.getRating(ids[0], mode === "ffa" ? "duel" : "ffa", "public")).toBeNull();
    },
  );

  it("rates all ten S&D players in their five-player team groups", () => {
    const c = contest("snd", "public", 10);
    c.submit();
    const states = ids.map((id) => results.ratings.getRating(id, "snd", "public")!.state);
    expect(states.every((s) => s.ratedMatches === 1)).toBe(true);
    expect(states[0].mu).toBeCloseTo(26.966, 2);
    expect(states[0].sigma).toBeCloseTo(8.115, 2);
    for (const s of states.slice(0, 5)) expect(s).toEqual(states[0]);
    for (const s of states.slice(5)) expect(s).toEqual(states[5]);
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 10, ratings: 10 });
  });

  it("retains each FFA placement and both tie groups for numerical updates", () => {
    const c = contest("ffa", "private", 5);
    c.report.participants.forEach((p, i) => {
      p.score = i < 2 ? 5 : i < 4 ? 1 : 0;
      p.outcome = i < 2 ? "draw" : "loss";
    });
    c.report.details.seats.forEach((p, i) => {
      p.placement = [1, 1, 3, 3, 5][i];
    });
    c.submit();
    const states = ids.slice(0, 5).map((id) => results.ratings.getRating(id, "ffa", "private")!.state);
    expect(states[0].mu).toBeGreaterThan(states[2].mu);
    expect(states[2].mu).toBeGreaterThan(states[4].mu);
    expect(states.every((s) => s.ratedMatches === 1)).toBe(true);
    expect(results.ratings.verifyReplay().updates).toBe(5);
    expect(
      results
        .leaderboard({ gametype: "ffa", scope: "private", period: "all", offset: 0, limit: 10, now })
        .entries.map((row) => [row.draws, row.losses]),
    ).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });

  it.each(["duel", "amphi"] as const)("rates the authoritative %s forfeit despite opposite raw scores", (mode) => {
    const c = contest(mode, "public");
    c.report.details.completion = "forfeit";
    c.report.details.teams = [
      { id: "udon", score: 9, placement: 2 },
      { id: "soba", score: 0, placement: 1 },
    ];
    c.report.participants[0].score = 9;
    c.report.participants[0].outcome = "loss";
    c.report.participants[1].outcome = "win";
    Object.assign(c.report.details.seats[0], { placement: 2, forfeited: true, disconnected: true, leftAtTick: 80 });
    c.report.details.seats[1].placement = 1;
    expect(c.submit().ratingStatus).toBe("applied");
    expect(results.ratings.getRating(ids[0], mode, "public")!.state.mu).toBeLessThan(
      results.ratings.getRating(ids[1], mode, "public")!.state.mu,
    );
  });

  it.each([
    "late_join",
    "participation_interrupted",
    "participation_unknown",
    "starting_roster_unavailable",
    "incomplete_roster",
  ])("retains records with a durable %s skill exclusion", (reason) => {
    const c = contest("ffa", "public", 3);
    if (reason === "late_join") {
      c.report.details.seats[0].joinedAtTick = 20;
      c.report.details.seats[0].lateJoin = true;
    }
    if (reason === "participation_interrupted") c.report.details.seats[0].participationInterrupted = true;
    if (reason === "participation_unknown") delete c.report.details.seats[0].participationInterrupted;
    if (reason === "starting_roster_unavailable") delete c.context.startingRoster;
    if (reason === "incomplete_roster")
      c.context.startingRoster!.push({ accountId: ids[3], isBot: false, team: "ffa" });
    expect(c.submit()).toMatchObject({ recordStatus: "recorded", ratingStatus: "excluded", ratingReason: reason });
    expect(results.leaderboard({ gametype: "ffa", period: "all", offset: 0, limit: 10, now }).total).toBe(3);
    expect(results.ratings.statistics()).toMatchObject({ ratings: 0, updates: 0 });
    expect(results.ratings.verifyReplay().matches).toBe(0);
  });

  it("excludes a played S&D side change while keeping team record outcomes", () => {
    const c = contest("snd", "public", 4);
    c.report.details.seats[0].teamsPlayed = ["udon", "soba"];
    expect(c.submit()).toMatchObject({
      recordStatus: "recorded",
      ratingStatus: "excluded",
      ratingReason: "team_changed",
    });
    expect(results.ratings.statistics().ratings).toBe(0);
  });
});
