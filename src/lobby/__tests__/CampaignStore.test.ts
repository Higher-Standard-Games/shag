import { afterEach, expect, it } from "vitest";
import { CampaignStore } from "../CampaignStore";

const stores: CampaignStore[] = [];
const open = () => {
  const store = new CampaignStore(":memory:");
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores) store.close();
  stores.length = 0;
});

it("keeps each account's clears apart, with the first clear's date and the best replay", () => {
  const store = open();
  store.recordClear(1, "one", 90_000, 4, 1000);
  store.recordClear(1, "one", 120_000, 9, 2000);
  store.recordClear(1, "one", 60_000, 2, 3000);
  store.recordClear(2, "one", 30_000, 1, 4000);
  expect(store.clears(1)).toEqual([{ missionId: "one", clearedAt: 1000, bestTimeMs: 60_000, bestFrags: 9 }]);
  expect(store.clears(2)).toEqual([{ missionId: "one", clearedAt: 4000, bestTimeMs: 30_000, bestFrags: 1 }]);
});

it("forgets a deleted account", () => {
  const store = open();
  store.recordClear(1, "one", 1, 1);
  store.recordClear(1, "two", 1, 1);
  store.delete(1);
  expect(store.clears(1)).toEqual([]);
});

it("keeps the first time the whole campaign was finished", () => {
  const store = open();
  expect(store.completedAt(1)).toBeNull();
  expect(store.markCompleted(1, 500)).toBe(500);
  expect(store.markCompleted(1, 900)).toBe(500);
  store.delete(1);
  expect(store.completedAt(1)).toBeNull();
});

it("ranks the campaign boards and leaves hidden accounts out", () => {
  const store = open();
  // Account 1: two missions, 30 frags; account 2: one mission, 30 frags; account 3: the most, but hidden
  store.recordClear(1, "one", 1, 10, 1000);
  store.recordClear(1, "two", 1, 20, 1100);
  store.recordClear(2, "one", 1, 30, 1050);
  store.recordClear(3, "one", 1, 99, 900);
  store.markCompleted(2, 5000);
  store.markCompleted(1, 4000);
  const board = store.board(10, [3]);
  // Equal frags: more missions cleared ranks first
  expect(board.scorers).toEqual([
    { accountId: 1, frags: 30, cleared: 2 },
    { accountId: 2, frags: 30, cleared: 1 },
  ]);
  expect(board.finishers).toEqual([
    { accountId: 1, at: 4000 },
    { accountId: 2, at: 5000 },
  ]);
  // A mission's top fraggers by their best run; its first clears by date
  expect(board.missionScorers.filter((row) => row.missionId === "one").map((row) => row.accountId)).toEqual([2, 1]);
  expect(board.firstClears.filter((row) => row.missionId === "one").map((row) => row.accountId)).toEqual([1, 2]);
  expect(store.board(1, []).missionScorers.filter((row) => row.missionId === "one")).toHaveLength(1);
});
