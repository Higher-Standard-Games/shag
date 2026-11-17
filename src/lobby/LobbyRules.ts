/**
 * The lobby's fixed rules: the gametypes it offers, how a requested gametype
 * name is read, where a connection comes from, and which rosters are ranked.
 */

import type { IncomingMessage } from "node:http";
import type { GametypeInfo } from "./types";

/** Gametype shells — map pools are populated dynamically at startup */
export const GAMETYPE_SHELLS: Omit<GametypeInfo, "mapPool">[] = [
  {
    id: "duel",
    name: "DUEL",
    description: "1v1 Arena Duel",
    maxPlayers: 2,
    hasTeams: true,
    teamNames: { alpha: "Team Soba", bravo: "Team Udon" },
  },
  {
    id: "amphi",
    name: "AMPHI",
    description: "1v1 deathmatch, best of three 3-minute rounds",
    maxPlayers: 2,
    hasTeams: true,
    teamNames: { alpha: "Team Soba", bravo: "Team Udon" },
  },
  // Four to start: with two or three, a free-for-all is a duel without the duel's rules.
  { id: "ffa", name: "FFA", description: "Free For All", maxPlayers: 8, minPlayers: 4, hasTeams: false },
  {
    id: "snd",
    name: "S&D",
    description: "Search & Destroy",
    maxPlayers: 10,
    // Two is enough to start a round. A 5v5 mode that will not begin until ten
    // people are in the room cannot be tested, and an underfilled bomb match is
    // still a bomb match — unlike a duel, which is meaningless at one.
    minPlayers: 2,
    hasTeams: true,
    teamNames: { alpha: "Team Soba", bravo: "Team Udon" },
  },
];

/**
 * Gametypes only the campaign plays: never offered on the Play page, in the
 * queue or for a private room, and unrated, having no rating pool. Their maps
 * are any installed map a mission names.
 */
export const CAMPAIGN_GAMETYPE_SHELLS: Omit<GametypeInfo, "mapPool">[] = [
  {
    id: "tdm",
    name: "TDM",
    description: "Team Deathmatch",
    maxPlayers: 8,
    minPlayers: 2,
    hasTeams: true,
    teamNames: { alpha: "Team Soba", bravo: "Team Udon" },
  },
  {
    id: "survival",
    name: "SURVIVAL",
    description: "Waves of robots against players who cannot die",
    maxPlayers: 8,
    minPlayers: 2,
    hasTeams: true,
    teamNames: { alpha: "Team Soba", bravo: "Robots" },
  },
];

export function normalizeGametype(input: string | undefined): string | null {
  const value = (input || "duel").trim().toLowerCase();
  switch (value) {
    case "duel":
    case "1v1":
      return "duel";
    case "amphi":
      return "amphi";
    case "snd":
    case "bomb":
    case "search":
    case "searchanddestroy":
    case "search_and_destroy":
      return "snd";
    case "ffa":
    case "dm":
    case "deathmatch":
      return "ffa";
    default:
      return null;
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "localhost" ||
    address.startsWith("::ffff:127.") ||
    address.startsWith("127.")
  );
}

/** A seat as the lobby knows it when a match starts. */
export interface RankedSeat {
  accountId: number | null;
  team: string;
  isBot: boolean;
}

/**
 * Whether a match counts towards the leaderboard, decided from the roster the
 * moment it starts (docs/research/PLAYER_IDENTITY.md):
 *
 * - a one-on-one counts only if both players are human;
 * - a team mode needs more than half the players human AND a human on each
 *   side, because a majority alone would rank four humans against three bots;
 * - anything else needs more than half the players human.
 *
 * Bots never wipe out a human's result — they only decide whether the match is
 * ranked — and a seat without an account is a bot as far as this is concerned.
 */
export function isRankedRoster(gametype: GametypeInfo, seats: readonly RankedSeat[]): boolean {
  const isHuman = (seat: RankedSeat) => !seat.isBot && seat.accountId !== null;
  const humans = seats.filter(isHuman);
  if (humans.length < 2) return false;
  if (gametype.maxPlayers === 2) return humans.length === seats.length;
  if (humans.length * 2 <= seats.length) return false;
  if (!gametype.hasTeams) return true;
  const sides = new Set(seats.map((seat) => seat.team));
  return [...sides].every((side) => humans.some((seat) => seat.team === side));
}

/**
 * Where a connection really comes from. A proxy on this machine (Caddy
 * terminating TLS for wss://) connects from loopback and names the player in
 * X-Forwarded-For; its last entry is the one that proxy added. The header is
 * ignored from anyone else, who could write anything in it.
 */
export function clientAddress(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (!forwarded || !isLoopbackAddress(peer)) return peer;
  const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded).split(",").pop()?.trim();
  return last || peer;
}
