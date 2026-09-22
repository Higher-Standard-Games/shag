import { describe, expect, it } from "vitest";
import { issueMatchAdmission } from "../MatchAdmission";
import { type MatchResultReport, signMatchResult, verifyMatchResult } from "../MatchResultReport";

describe("authenticated match result", () => {
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
  const report: MatchResultReport = {
    matchId: "match-a",
    map: "wamphi1",
    gametype: "amphi",
    endedAt: now + 100,
    participants: [
      { tokenHash: manifest.grants[0].tokenHash, accountId: 11, outcome: "win", score: 3 },
      { tokenHash: manifest.grants[1].tokenHash, accountId: 12, outcome: "loss", score: 0 },
    ],
  };

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
    expect(verifyMatchResult(`SHAG_MATCH_RESULT_V1 ${"x".repeat(16_384)}`, "private-secret", expected)).toBeNull();
  });
});
