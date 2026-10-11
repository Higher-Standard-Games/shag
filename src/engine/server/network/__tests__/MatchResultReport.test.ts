import { describe, expect, it } from "vitest";
import { botReference } from "../../../../shared/ranking/__tests__/_botReference";
import { issueMatchAdmission } from "../MatchAdmission";
import { type MatchResultReport, signMatchResult, verifyMatchResult } from "../MatchResultReport";
import { resultReport } from "./_resultReport";

describe("authenticated match result", () => {
  it("binds bot configuration to admission and refuses removal, replacement or human claims", () => {
    const now = 2000;
    const { manifest } = issueMatchAdmission(
      "bot-result",
      [
        { lobbyPlayerId: "human", accountId: 1, isBot: false, name: "Human", team: "udon" },
        { lobbyPlayerId: "bot", accountId: null, isBot: true, name: "Bot", team: "soba", botReference: botReference() },
      ],
      now,
    );
    const report = resultReport(
      {
        matchId: "bot-result",
        map: "wdm2",
        gametype: "duel",
        endedAt: now,
        participants: manifest.grants.map((grant, i) => ({
          tokenHash: grant.tokenHash,
          accountId: grant.accountId,
          score: i ? 0 : 3,
          outcome: i ? "loss" : "win",
        })),
      },
      manifest,
    );
    const expected = {
      matchId: report.matchId,
      map: report.map,
      gametype: report.gametype,
      startedAt: now,
      admission: manifest,
    };
    const verify = () => verifyMatchResult(signMatchResult(report, "secret"), "secret", expected, now);
    expect(verify()).toEqual(report);
    report.details.mapDigest = "b".repeat(64);
    expect(verify()?.details.mapDigest).toBe(report.details.mapDigest);
    report.details.mapDigest = "invalid-map-hash";
    expect(verify()).toBeNull();
    delete report.details.mapDigest;
    report.details.seats[1].botReference!.goalArbiter = "legacy";
    // Fixture and admission must not share the reference we mutate.
    manifest.grants[1].botReference = botReference();
    expect(verify()).toBeNull();
    delete report.details.seats[1].botReference;
    expect(verify()).toBeNull();
    report.details.seats[1].botReference = botReference();
    report.details.seats[0].botReference = botReference();
    expect(verify()).toBeNull();
  });

  it("fits a ten-seat bot configuration report within the bounded signed result line", () => {
    const { manifest } = issueMatchAdmission(
      "ten-bots",
      Array.from({ length: 10 }, (_, i) => ({
        lobbyPlayerId: String(i),
        accountId: null,
        isBot: true,
        name: "Bot",
        team: i < 5 ? "udon" : "soba",
        botReference: botReference(),
      })),
      2000,
    );
    const report = resultReport(
      {
        matchId: "ten-bots",
        map: "wdm2",
        gametype: "snd",
        endedAt: 2000,
        participants: manifest.grants.map((grant, i) => ({
          tokenHash: grant.tokenHash,
          accountId: null,
          score: i < 5 ? 3 : 0,
          outcome: i < 5 ? "win" : "loss",
        })),
      },
      manifest,
    );
    const line = signMatchResult(report, "secret");
    expect(line.length).toBeLessThanOrEqual(16_384);
    expect(
      verifyMatchResult(
        line,
        "secret",
        { matchId: report.matchId, map: report.map, gametype: report.gametype, startedAt: 2000, admission: manifest },
        2000,
      ),
    ).toEqual(report);
  });
  const now = 1_800_000_000_000;
  const { manifest } = issueMatchAdmission(
    "match-a",
    [
      { lobbyPlayerId: "one", accountId: 11, name: "One", team: "udon", isBot: false },
      { lobbyPlayerId: "two", accountId: 12, name: "Two", team: "soba", isBot: false },
    ],
    now,
  );
  const expected = { matchId: "match-a", map: "wamphi1", gametype: "amphi", startedAt: now, admission: manifest };
  const report: MatchResultReport = resultReport(
    {
      matchId: "match-a",
      map: "wamphi1",
      gametype: "amphi",
      endedAt: now + 100,
      participants: [
        { tokenHash: manifest.grants[0].tokenHash, accountId: 11, outcome: "win", score: 3 },
        { tokenHash: manifest.grants[1].tokenHash, accountId: 12, outcome: "loss", score: 0 },
      ],
    },
    manifest,
  );

  it("accepts the child signature only for its match and verified roster", () => {
    const line = signMatchResult(report, "private-secret");
    expect(verifyMatchResult(line, "private-secret", expected, now + 101)).toEqual(report);
    expect(verifyMatchResult(line, "wrong-secret", expected, now + 101)).toBeNull();
    expect(verifyMatchResult(line, "private-secret", { ...expected, map: "other" }, now + 101)).toBeNull();
    expect(verifyMatchResult(line, "private-secret", expected, now - 10_000)).toBeNull();
    expect(verifyMatchResult(`${line}garbage`, "private-secret", expected, now + 101)).toBeNull();
  });

  it("rejects forged accounts, replayed seats, and oversized output even when signed", () => {
    const forged = { ...report, participants: [{ ...report.participants[0], accountId: 99 }, report.participants[1]] };
    expect(
      verifyMatchResult(signMatchResult(forged, "private-secret"), "private-secret", expected, now + 101),
    ).toBeNull();
    const replayed = { ...report, participants: [report.participants[0], report.participants[0]] };
    expect(
      verifyMatchResult(signMatchResult(replayed, "private-secret"), "private-secret", expected, now + 101),
    ).toBeNull();
    expect(verifyMatchResult(`SHAG_MATCH_RESULT_V2 ${"x".repeat(16_384)}`, "private-secret", expected)).toBeNull();
  });

  it.each([
    (r: MatchResultReport) => {
      delete (r as Partial<MatchResultReport>).details;
    },
    (r: MatchResultReport) => {
      r.details!.seats[0].seatId = "forged";
    },
    (r: MatchResultReport) => {
      r.details!.seats[1] = { ...r.details!.seats[0] };
    },
    (r: MatchResultReport) => {
      r.details!.seats[0].placement = 2;
    },
    (r: MatchResultReport) => {
      r.details!.seats[0].lateJoin = true;
    },
    (r: MatchResultReport) => {
      r.details.seats[0].participationInterrupted = "yes" as unknown as boolean;
    },
    (r: MatchResultReport) => {
      r.details!.seats[0].leftAtTick = 99;
    },
    (r: MatchResultReport) => {
      r.details!.teams[0].score = 99;
    },
    (r: MatchResultReport) => {
      r.details!.completion = "aborted";
    },
  ])("rejects an inconsistent signed snapshot %#", (tamper) => {
    const changed = structuredClone(report);
    tamper(changed);
    expect(
      verifyMatchResult(signMatchResult(changed, "private-secret"), "private-secret", expected, now + 101),
    ).toBeNull();
  });

  it("rejects two credentials for the same bot seat as two opponents", () => {
    const repeated = structuredClone(report);
    const admission = structuredClone(manifest);
    admission.grants[0].accountId = null;
    admission.grants[0].isBot = true;
    admission.grants[1] = { ...admission.grants[0], tokenHash: "second-hash" };
    repeated.participants = admission.grants.map((grant) => ({
      tokenHash: grant.tokenHash,
      accountId: null,
      score: 0,
      outcome: "draw",
    }));
    expect(
      verifyMatchResult(
        signMatchResult(repeated, "private-secret"),
        "private-secret",
        { ...expected, admission },
        now + 101,
      ),
    ).toBeNull();
  });

  it("accepts an older V2 report without asserting its participation continuity", () => {
    const legacy = structuredClone(report);
    for (const seat of legacy.details.seats) delete seat.participationInterrupted;
    expect(verifyMatchResult(signMatchResult(legacy, "private-secret"), "private-secret", expected, now + 101)).toEqual(
      legacy,
    );
  });
});
