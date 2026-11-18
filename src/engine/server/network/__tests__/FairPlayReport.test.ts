import { describe, expect, it } from "vitest";
import { type FairPlayReport, signFairPlayReport, verifyFairPlayReport } from "../FairPlayReport";
import type { AdmissionManifest } from "../MatchAdmission";
import { signMatchResult } from "../MatchResultReport";

const admission = {
  matchId: "m1",
  expiresAt: 0,
  grants: [
    { tokenHash: "a", accountId: 1, name: "A", team: "ffa", isBot: false },
    { tokenHash: "b", accountId: 2, name: "B", team: "ffa", isBot: true },
  ],
} as unknown as AdmissionManifest;
const expected = { matchId: "m1", gametype: "ffa", admission };
const report = (accounts: FairPlayReport["accounts"]): FairPlayReport => ({
  matchId: "m1",
  gametype: "ffa",
  endedAt: 1,
  accounts,
});

describe("fair-play report", () => {
  it("round-trips a report on admitted human accounts", () => {
    const value = report([{ accountId: 1, signals: { shots: 10, flick0: 3 } }]);
    expect(verifyFairPlayReport(signFairPlayReport(value, "s"), "s", expected)).toEqual(value);
  });

  it("refuses accounts the match did not admit, bots and repeats", () => {
    for (const accounts of [
      [{ accountId: 9, signals: {} }],
      [{ accountId: 2, signals: {} }],
      [
        { accountId: 1, signals: {} },
        { accountId: 1, signals: {} },
      ],
    ]) {
      expect(verifyFairPlayReport(signFairPlayReport(report(accounts), "s"), "s", expected)).toBeNull();
    }
  });

  it("refuses odd counters", () => {
    for (const signals of [{ shots: -1 }, { shots: Number.NaN }, { "bad name": 1 }, { shots: "1" }]) {
      const value = report([{ accountId: 1, signals: signals as unknown as Record<string, number> }]);
      expect(verifyFairPlayReport(signFairPlayReport(value, "s"), "s", expected)).toBeNull();
    }
  });

  it("refuses a result line's signature for a fair-play payload", () => {
    const value = report([{ accountId: 1, signals: {} }]);
    const forged = signMatchResult(value as never, "s").replace(/^\S+ /, "SHAG_FAIR_PLAY_V1 ");
    expect(verifyFairPlayReport(forged, "s", expected)).toBeNull();
  });
});
