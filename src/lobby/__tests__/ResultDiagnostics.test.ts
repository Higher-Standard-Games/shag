import { describe, expect, it } from "vitest";
import { ResultDiagnostics } from "../ResultDiagnostics";

describe("result diagnostics", () => {
  it("bounds history and identifiers while retaining independent counters", () => {
    const diagnostics = new ResultDiagnostics();
    diagnostics.record({ matchId: "first", status: "rejected", reason: "verification_failed" });
    for (let i = 0; i < 40; i++)
      diagnostics.record({ matchId: String(i), status: "stored", reason: "stored", scope: "private" });
    diagnostics.record({
      matchId: "m".repeat(100),
      gametype: "g".repeat(100),
      status: "failed",
      reason: "store_error",
    });
    const snapshot = diagnostics.snapshot();
    expect(snapshot.totals).toEqual({ stored: 40, duplicate: 0, skipped: 0, rejected: 1, failed: 1 });
    expect(snapshot.recent).toHaveLength(32);
    expect(snapshot.recent[0].matchId).toBe("9");
    expect(snapshot.recent.at(-1)).toMatchObject({
      matchId: "m".repeat(64),
      gametype: "g".repeat(32),
      observedAt: expect.any(Number),
    });
    snapshot.totals.stored = 0;
    snapshot.recent[0].matchId = "changed";
    expect(diagnostics.snapshot().totals.stored).toBe(40);
    expect(diagnostics.snapshot().recent[0].matchId).toBe("9");
  });
});
