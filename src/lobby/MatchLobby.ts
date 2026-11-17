/**
 * A room in the lobby (MatchLobby) and the connection it seats (ConnectedPlayer):
 * its players and teams, map and shuffle votes, readiness, and what clients
 * are told about it.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { BotReference } from "../shared/ranking/BotReference";
import { lobbyCampaignInfo } from "./Campaign";
import type {
  CampaignBotInfo,
  CampaignMissionInfo,
  ChatMessage as ChatMsg,
  GametypeInfo,
  LobbyPlayerInfo,
  LobbyTeam,
  MapOption,
  MatchLobbyInfo,
  PlayerStatus,
} from "./types";

/** The side players take in a campaign room with teams; enemy bots take the other. */
export const CAMPAIGN_PLAYER_TEAM: LobbyTeam = "alpha";
export const CAMPAIGN_ENEMY_TEAM: LobbyTeam = "bravo";

// ============================================================================
// Connected Player
// ============================================================================

export interface ConnectedPlayer {
  id: string;
  ws: WebSocket;
  name: string;
  status: PlayerStatus;
  lobbyId: string | null;
  authenticated: boolean;
  address: string;
  /** true = AI bot connection (flagged at auth). Bots are evicted from a lobby
   *  once its last human leaves so a bot-only lobby/match never lingers. */
  isBot: boolean;
  /** The player account this connection is logged in to; null for bots and before login. */
  accountId: number | null;
  botReference?: BotReference;
}

// ============================================================================
// Match Lobby
// ============================================================================

export class MatchLobby {
  botReferenceChanged = false;
  /** The mission a campaign room plays; null for every other room. */
  readonly campaign: CampaignMissionInfo | null;
  id: string;
  visibility: "public" | "private";
  inviteToken: string | null;
  gametype: GametypeInfo;
  maps: MapOption[];
  players: Map<string, LobbyPlayerInfo> = new Map();
  chatHistory: ChatMsg[] = [];
  votes: Map<string, string> = new Map(); // playerId → mapName
  shuffleVotes: Set<string> = new Set();
  createdAt: number = Date.now();
  isStarting: boolean = false;
  matchMap: string = ""; // Set when match starts
  serverUrl: string = ""; // Set when game server is spawned
  state: "waiting" | "playing" = "waiting";
  activeMatchId: string | null = null;
  /** Immutable account/team roster while a dedicated match is running. */
  activeSeatTeams = new Map<number, LobbyTeam>();
  /** Empty-lobby destruction is deferred until this time — set when the match
   *  server exits, so players returning via the ?lobby= deep link (a page
   *  reload that drops every lobby socket at once) still find their lobby. */
  keepAliveUntil: number = 0;

  get playerCount(): number {
    return this.players.size;
  }

  constructor(
    gametype: GametypeInfo,
    mapNames: Record<string, string>,
    visibility: "public" | "private" = "public",
    campaign: CampaignMissionInfo | null = null,
  ) {
    this.id = randomUUID().slice(0, 8);
    this.visibility = visibility;
    this.inviteToken = visibility === "private" ? randomBytes(24).toString("base64url") : null;
    this.gametype = gametype;
    this.campaign = campaign;
    if (campaign) {
      // A campaign room plays its mission's map and nothing else
      this.maps = [{ name: campaign.map, displayName: mapNames[campaign.map] || campaign.mapTitle, votes: 0 }];
      return;
    }

    // Pick 3 random maps from pool (or all if pool ≤ 3)
    const shuffled = [...gametype.mapPool].sort(() => Math.random() - 0.5);
    this.maps = shuffled.slice(0, 3).map((name) => ({
      name,
      displayName: mapNames[name] || name,
      votes: 0,
    }));
  }

  /** Close the room to the queue and the public lists; from now on its invite link is the way in. */
  makePrivate(): void {
    this.visibility = "private";
    this.inviteToken = randomBytes(24).toString("base64url");
  }

  addPlayer(player: ConnectedPlayer): LobbyPlayerInfo {
    // Auto-assign team
    let team: LobbyTeam = "ffa";
    if (this.campaign && this.gametype.hasTeams) {
      // Players on the campaign's side, each bot on the side its mission gives it
      const bot = player.isBot ? this.campaignBot(player.name) : undefined;
      team = player.isBot && bot?.side !== "ally" ? CAMPAIGN_ENEMY_TEAM : CAMPAIGN_PLAYER_TEAM;
    } else if (this.gametype.hasTeams) {
      const alphaCount = [...this.players.values()].filter((p) => p.team === "alpha").length;
      const bravoCount = [...this.players.values()].filter((p) => p.team === "bravo").length;
      team = alphaCount <= bravoCount ? "alpha" : "bravo";
    }

    const preset = player.isBot ? player.botReference?.preset : undefined;
    const lobbyPlayer: LobbyPlayerInfo = {
      id: player.id,
      name: player.name,
      team,
      ready: false,
      ...(preset && preset !== "custom" ? { botLevel: preset } : {}),
    };
    this.players.set(player.id, lobbyPlayer);
    return lobbyPlayer;
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.votes.delete(playerId);
    this.shuffleVotes.delete(playerId);
  }

  setReady(playerId: string, ready: boolean): void {
    const p = this.players.get(playerId);
    if (p) p.ready = ready;
  }

  voteMap(playerId: string, mapName: string): void {
    // Validate map is in this lobby's options
    if (!this.maps.find((m) => m.name === mapName)) return;
    this.votes.set(playerId, mapName);
    this.recalcVotes();
  }

  /**
   * Vote to shuffle. `alsoVoting` are ids counted as automatic yes votes.
   *
   * Bots go in there, and only when a human has actually voted — a bot has no
   * opinion about team balance, and without them a lobby of one human and any
   * number of bots can never reach `ceil(players / 2)` and so can never shuffle
   * at all. Passing them in rather than having them vote on their own keeps
   * bots from ever triggering a shuffle by themselves.
   */
  voteShuffle(
    playerId: string,
    alsoVoting: readonly string[] = [],
  ): { votes: number; needed: number; passed: boolean } {
    this.shuffleVotes.add(playerId);
    for (const id of alsoVoting) this.shuffleVotes.add(id);
    const needed = Math.ceil(this.players.size / 2);
    const passed = this.shuffleVotes.size >= needed;
    if (passed) {
      this.shuffleTeams();
      this.shuffleVotes.clear();
    }
    return { votes: this.shuffleVotes.size, needed, passed };
  }

  /** The mission's bot of that name, for a bot joining a campaign room. */
  campaignBot(name: string): CampaignBotInfo | undefined {
    return this.campaign?.bots.find((bot) => bot.name === name);
  }

  /** Mission bots not yet seated in this campaign room. */
  missingCampaignBots(isBot: (playerId: string) => boolean): CampaignBotInfo[] {
    if (!this.campaign) return [];
    const seated = new Set([...this.players.values()].filter((p) => isBot(p.id)).map((p) => p.name));
    return this.campaign.bots.filter((bot) => !seated.has(bot.name));
  }

  isAllReady(): boolean {
    if (this.players.size === 0) return false;
    // Enough to play, not necessarily full. Defaulting to `maxPlayers` keeps
    // every existing mode behaving exactly as before.
    const needed = this.gametype.minPlayers ?? this.gametype.maxPlayers;
    if (this.players.size < needed) return false;
    // A team match with an empty side is already decided when its first live
    // tick checks eliminations. Never launch such a lobby, even if malformed
    // state or a future team-selection path manages to create one.
    if (this.gametype.hasTeams) {
      const teams = new Set([...this.players.values()].map((p) => p.team));
      if (!teams.has("alpha") || !teams.has("bravo")) return false;
    }
    return [...this.players.values()].every((p) => p.ready);
  }

  getWinningMap(): string {
    // Most votes wins, random tiebreak
    let maxVotes = 0;
    const candidates: string[] = [];
    for (const map of this.maps) {
      if (map.votes > maxVotes) {
        maxVotes = map.votes;
        candidates.length = 0;
        candidates.push(map.name);
      } else if (map.votes === maxVotes) {
        candidates.push(map.name);
      }
    }
    return candidates[Math.floor(Math.random() * candidates.length)] || this.maps[0]?.name || "";
  }

  toInfo(): MatchLobbyInfo {
    return {
      id: this.id,
      gametype: this.gametype.id,
      ...(this.campaign ? { campaign: lobbyCampaignInfo(this.campaign) } : {}),
      activeMatchId: this.activeMatchId ?? undefined,
      visibility: this.visibility,
      maps: this.maps,
      players: [...this.players.values()],
      chatHistory: [...this.chatHistory],
      shareUrl: `/?lobby=${encodeURIComponent(this.id)}${this.inviteToken ? `&invite=${this.inviteToken}` : ""}`,
      config: {
        maxPlayers: this.gametype.maxPlayers,
        minPlayers: this.gametype.minPlayers ?? this.gametype.maxPlayers,
        hasTeams: this.gametype.hasTeams,
        teamNames: this.gametype.teamNames,
      },
    };
  }

  private recalcVotes(): void {
    for (const map of this.maps) {
      map.votes = [...this.votes.values()].filter((v) => v === map.name).length;
    }
  }

  private shuffleTeams(): void {
    if (!this.gametype.hasTeams) return;
    const players = [...this.players.values()];
    const shuffled = players.sort(() => Math.random() - 0.5);
    const half = Math.ceil(shuffled.length / 2);
    shuffled.forEach((p, i) => {
      p.team = i < half ? "alpha" : "bravo";
    });
  }
}
