import { describe, expect, it } from "vitest";
import type { FairPlayReport } from "../../engine/server/network/FairPlayReport";
import { FairPlayStore, RETENTION_MS } from "../FairPlayStore";

const report = (matchId: string, endedAt: number): FairPlayReport => ({
  matchId,
  gametype: "duel",
  endedAt,
  accounts: [
    { accountId: 1, signals: { shots: 40, hits: 12 } },
    { accountId: 2, signals: { clampedCmds: 3 } },
  ],
});

describe("FairPlayStore", () => {
  it("keeps each match's counters per account, once", () => {
    let now = 1_000_000;
    const store = new FairPlayStore(":memory:", () => now);
    store.recordMatch(report("m1", now));
    store.recordMatch(report("m1", now));
    now += 1000;
    store.recordMatch(report("m2", now));
    expect(store.signalsFor(1).map((row) => row.matchId)).toEqual(["m2", "m1"]);
    expect(store.signalsFor(2)[0].signals).toEqual({ clampedCmds: 3 });
    store.close();
  });

  it("deletes counters past the retention period", () => {
    let now = 10 * RETENTION_MS;
    const store = new FairPlayStore(":memory:", () => now);
    store.recordMatch(report("old", now));
    now += RETENTION_MS / 2;
    store.recordMatch(report("new", now));
    now += RETENTION_MS / 2 + 1;
    expect(store.prune()).toBe(2);
    expect(store.signalsFor(1).map((row) => row.matchId)).toEqual(["new"]);
    store.close();
  });

  it("forgets a deleted account and keeps the others", () => {
    const store = new FairPlayStore(":memory:");
    store.recordMatch(report("m1", Date.now()));
    store.deleteAccount(1);
    expect(store.signalsFor(1)).toEqual([]);
    expect(store.signalsFor(2)).toHaveLength(1);
    store.close();
  });

  it("dates a report no later than its arrival", () => {
    const store = new FairPlayStore(":memory:", () => 5000);
    store.recordMatch(report("future", 9_999_999));
    expect(store.signalsFor(1)[0].endedAt).toBe(5000);
    store.close();
  });
});
