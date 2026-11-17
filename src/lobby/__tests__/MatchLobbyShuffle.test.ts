import { describe, expect, it } from "vitest";
import { shuffle } from "../MatchLobby";

describe("shuffle", () => {
  it("makes every order of three equally likely", () => {
    const counts = new Map<string, number>();
    let seed = 12345;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const runs = 60_000;
    for (let i = 0; i < runs; i++) {
      const order = shuffle(["a", "b", "c"], random).join("");
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) expect(Math.abs(count - runs / 6)).toBeLessThan(runs / 6 / 20);
  });

  it("keeps every item", () => {
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
