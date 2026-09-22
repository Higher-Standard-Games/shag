/**
 * Which matches earn a place on the leaderboard. The rule is decided from the
 * roster a match starts with; see docs/research/PLAYER_IDENTITY.md.
 */

import { describe, expect, it } from "vitest";
import { isRankedRoster, type RankedSeat } from "../LobbyServer";
import type { GametypeInfo } from "../types";

const mode = (over: Partial<GametypeInfo>): GametypeInfo => ({
  id: "snd",
  name: "S&D",
  description: "",
  maxPlayers: 10,
  hasTeams: true,
  mapPool: [],
  ...over,
});

const duel = mode({ id: "duel", name: "DUEL", maxPlayers: 2 });
const snd = mode({});
const ffa = mode({ id: "ffa", name: "FFA", maxPlayers: 8, hasTeams: false });

let nextAccount = 1;
const human = (team = "alpha"): RankedSeat => ({ accountId: nextAccount++, team, isBot: false });
const bot = (team = "alpha"): RankedSeat => ({ accountId: null, team, isBot: true });

describe("a one-on-one", () => {
  it("counts when both players are human", () => {
    expect(isRankedRoster(duel, [human("alpha"), human("bravo")])).toBe(true);
  });

  it("does not count against a bot", () => {
    expect(isRankedRoster(duel, [human("alpha"), bot("bravo")])).toBe(false);
  });
});

describe("a team mode", () => {
  it("counts when humans outnumber bots and both sides have one", () => {
    const seats = [human("alpha"), human("alpha"), human("bravo"), bot("bravo")];
    expect(isRankedRoster(snd, seats)).toBe(true);
  });

  it("does not count when humans are only half the room", () => {
    const seats = [human("alpha"), human("bravo"), bot("alpha"), bot("bravo")];
    expect(isRankedRoster(snd, seats)).toBe(false);
  });

  it("does not count humans farming a side made of bots", () => {
    // Four humans against three bots is a majority, and still not a match
    const seats = [
      human("alpha"),
      human("alpha"),
      human("alpha"),
      human("alpha"),
      bot("bravo"),
      bot("bravo"),
      bot("bravo"),
    ];
    expect(isRankedRoster(snd, seats)).toBe(false);
  });
});

describe("free for all", () => {
  it("counts when more than half the players are human", () => {
    expect(isRankedRoster(ffa, [human(), human(), human(), bot(), bot()])).toBe(true);
  });

  it("does not count when the bots are the majority", () => {
    expect(isRankedRoster(ffa, [human(), human(), bot(), bot(), bot()])).toBe(false);
  });
});

describe("any mode", () => {
  it("needs two humans before anything else", () => {
    expect(isRankedRoster(ffa, [human(), bot(), bot()])).toBe(false);
    expect(isRankedRoster(snd, [human("alpha")])).toBe(false);
  });

  it("treats a seat with no account as a bot, whatever it calls itself", () => {
    const impostor: RankedSeat = { accountId: null, team: "bravo", isBot: false };
    expect(isRankedRoster(duel, [human("alpha"), impostor])).toBe(false);
  });
});
