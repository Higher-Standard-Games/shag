/**
 * LobbyServer — WebSocket Lobby Server
 *
 * Handles player presence, chat, match lobbies, and game server spawning.
 * All communication is JSON over WebSocket.
 *
 * Usage: npm run lobby:server
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { IncomingMessage } from "node:http";
import * as path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "../engine/core/Log";
import type { MatchResultReport } from "../engine/server/network/MatchResultReport";
import { DemoReader } from "../shared/demo/DemoReader";
import { BOT_INVITE_PREPARATION_TIMEOUT_MS } from "../shared/ranking/BotPreparation";
import { type BotReference, canonicalBotReference, sameBotReference } from "../shared/ranking/BotReference";
import { selectFeaturedDemos } from "./FeaturedDemos";
import { GameServerSpawner } from "./GameServerSpawner";
import type { MatchResultStore } from "./MatchResultStore";
import { PlayerStore } from "./PlayerStore";
import { RateLimiter } from "./RateLimiter";
import { type ResultDiagnostic, ResultDiagnostics } from "./ResultDiagnostics";
import type { ResultContext } from "./ResultSnapshot";
import { BOT_SECRET_HEADER, secretMatches } from "./ServerData";
import type {
  AuthMessage,
  ChatMessage as ChatMsg,
  DemoInfo,
  FeaturedDemoInfo,
  FeaturedDemosRequest,
  GametypeInfo,
  LeaderboardRequest,
  LiveMatchInfo,
  LobbyMessage,
  LobbyPlayerInfo,
  MapOption,
  MatchLobbyInfo,
  PlayerInfo,
  PlayerStatus,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/** Gametype shells — map pools are populated dynamically at startup */
const GAMETYPE_SHELLS: Omit<GametypeInfo, "mapPool">[] = [
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
  { id: "ffa", name: "FFA", description: "Free For All", maxPlayers: 8, hasTeams: false },
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

/**
 * Where a connection really comes from. A proxy on this machine (Caddy
 * terminating TLS for wss://) connects from loopback and names the player in
 * X-Forwarded-For; its last entry is the one that proxy added. The header is
 * ignored from anyone else, who could write anything in it.
 */
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

export function clientAddress(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (!forwarded || !isLoopbackAddress(peer)) return peer;
  const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded).split(",").pop()?.trim();
  return last || peer;
}

/** Per player address: new accounts, wrong keys, renames. */
const ACCOUNT_CREATION_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const KEY_FAILURE_LIMIT = { limit: 20, windowMs: 60_000 };
const RENAME_LIMIT = { limit: 10, windowMs: 60_000 };
/** Players online at once when the operator sets no cap. Bots don't count. */
export const DEFAULT_MAX_PLAYERS = 64;
/** How long a player turned away at the cap waits before the client tries again. */
const LOBBY_FULL_RETRY_SEC = 60;
/**
 * An account that disconnected this recently gets back in over the cap:
 * "Return to lobby" reloads the page, and the slot it frees must not go to
 * someone else in between.
 */
const RETURN_GRACE_MS = 60_000;
/** WebSocket close code after a `lobby_full` answer. */
export const LOBBY_FULL_CLOSE_CODE = 4008;

/**
 * Bot Intelligence Server (BIS) control API URL. The lobby relays
 * "invite bot" requests here so a bot can be spawned into a lobby. The bot
 * server runs on the lobby's machine and listens on 127.0.0.1 only; override
 * with BOT_SERVER_URL to use another port.
 */
const BOT_SERVER_URL = process.env.BOT_SERVER_URL || "ws://127.0.0.1:9100";

/**
 * URL a spawned bot uses to connect back to THIS lobby server. Defaults to
 * loopback on the lobby's own port; override with LOBBY_BOT_CONNECT_URL.
 */
function botLobbyConnectUrl(port: number): string {
  return process.env.LOBBY_BOT_CONNECT_URL || `ws://127.0.0.1:${port}`;
}

/** How long to wait for the bot server to acknowledge an invite before failing. */
const BOT_INVITE_TIMEOUT_MS = 8000;

export interface LobbyServerOptions {
  /** Shared with the bot server. Without it no connection counts as a bot and bot invites fail. */
  botSecret?: string;
  /** Override the local bot control endpoint, primarily for isolated server instances. */
  botServerUrl?: string;
  /** Player accounts. Without one the lobby keeps accounts in memory until it stops. */
  players?: PlayerStore;
  /** Durable results; omitted in ephemeral test/dev lobbies. */
  results?: MatchResultStore;
  /** Players online at once; 0 for no cap. Default DEFAULT_MAX_PLAYERS. */
  maxPlayers?: number;
}

/** Shape of config/maps.json */
interface MapManifestEntry {
  displayName: string;
  gametypes: string[];
}
type MapManifest = Record<string, MapManifestEntry>;

// ============================================================================
// Connected Player
// ============================================================================

interface ConnectedPlayer {
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

class MatchLobby {
  botReferenceChanged = false;
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
  activeSeatTeams = new Map<number, string>();
  /** Empty-lobby destruction is deferred until this time — set when the match
   *  server exits, so players returning via the ?lobby= deep link (a page
   *  reload that drops every lobby socket at once) still find their lobby. */
  keepAliveUntil: number = 0;

  get playerCount(): number {
    return this.players.size;
  }

  constructor(gametype: GametypeInfo, mapNames: Record<string, string>, visibility: "public" | "private" = "public") {
    this.id = randomUUID().slice(0, 8);
    this.visibility = visibility;
    this.inviteToken = visibility === "private" ? randomBytes(24).toString("base64url") : null;
    this.gametype = gametype;

    // Pick 3 random maps from pool (or all if pool ≤ 3)
    const shuffled = [...gametype.mapPool].sort(() => Math.random() - 0.5);
    this.maps = shuffled.slice(0, 3).map((name) => ({
      name,
      displayName: mapNames[name] || name,
      votes: 0,
    }));
  }

  addPlayer(player: ConnectedPlayer): LobbyPlayerInfo {
    // Auto-assign team
    let team = "ffa";
    if (this.gametype.hasTeams) {
      const alphaCount = [...this.players.values()].filter((p) => p.team === "alpha").length;
      const bravoCount = [...this.players.values()].filter((p) => p.team === "bravo").length;
      team = alphaCount <= bravoCount ? "alpha" : "bravo";
    }

    const lobbyPlayer: LobbyPlayerInfo = {
      id: player.id,
      name: player.name,
      team,
      ready: false,
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

// ============================================================================
// Lobby Server
// ============================================================================

export class LobbyServer {
  private wss: WebSocketServer | null = null;
  private players: Map<string, ConnectedPlayer> = new Map();
  private lobbies: Map<string, MatchLobby> = new Map();
  private chatHistory: ChatMsg[] = [];
  private port: number;
  private nextPlayerId = 1;
  private spawner: GameServerSpawner;
  /**
   * How each running match will be recorded, decided from its roster at the
   * start: public matches only when ranked (enough humans), private ones always
   * (friends, bots), each with its bot count.
   */
  private matchRecords = new Map<string, ResultContext>();
  private matchToLobby: Map<string, string> = new Map();
  /** Map dev-spawned matchId to the requesting player. */
  private devMatchToPlayer: Map<string, string> = new Map();

  private readonly MAX_CHAT_HISTORY = 50;

  // Demo listing cache
  private _demoCache: DemoInfo[] = [];
  /** Server-only verified ownership; account IDs never ride in public demo cards. */
  private _demoOwnership = new Map<string, Set<number>>();
  private _demoCacheTimer: ReturnType<typeof setInterval> | null = null;
  private resultRetryTimer: ReturnType<typeof setInterval> | null = null;
  private pendingBotInvites = new Map<string, Set<() => void>>();
  private readonly DEMO_DIR = path.join(process.cwd(), "public", "data", "demos");
  private readonly DEMO_CACHE_INTERVAL = 60_000; // 60s refresh

  // Dynamic map config (built at startup from config/maps.json + disk scan)
  private gametypes: GametypeInfo[] = [];
  private mapNames: Record<string, string> = {};

  private readonly MAP_CONFIG_PATH = path.join(process.cwd(), "config", "maps.json");
  private readonly PK3_DIR = path.join(process.cwd(), "public", "data");

  private readonly botSecret: string | undefined;
  private readonly botServerUrl: string;
  private readonly accounts: PlayerStore;
  private readonly results: MatchResultStore | undefined;
  /** Close the store on stop only if this server opened it. */
  private readonly ownsAccounts: boolean;
  private readonly accountCreations = new RateLimiter(ACCOUNT_CREATION_LIMIT.limit, ACCOUNT_CREATION_LIMIT.windowMs);
  private readonly keyFailures = new RateLimiter(KEY_FAILURE_LIMIT.limit, KEY_FAILURE_LIMIT.windowMs);
  private readonly renames = new RateLimiter(RENAME_LIMIT.limit, RENAME_LIMIT.windowMs);
  private readonly leaderboardReads = new RateLimiter(60, 60_000);
  private readonly featuredReads = new RateLimiter(60, 60_000);
  private readonly resultDiagnostics = new ResultDiagnostics();
  private readonly maxPlayers: number;
  /** Account id → when it disconnected, for RETURN_GRACE_MS. */
  private readonly recentlyLeft = new Map<number, number>();

  constructor(
    port: number = 9000,
    spawner: GameServerSpawner = new GameServerSpawner(),
    options: LobbyServerOptions = {},
  ) {
    this.port = port;
    this.spawner = spawner;
    this.botSecret = options.botSecret;
    this.botServerUrl = options.botServerUrl ?? BOT_SERVER_URL;
    this.ownsAccounts = !options.players;
    this.accounts = options.players ?? new PlayerStore(":memory:");
    this.results = options.results;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    if (this.results) this.spawner.setResultDelivery(this.results.deliveries);

    // Handle game server exits
    this.spawner.onServerExit = (matchId, code) => {
      this.handleServerExit(matchId, code);
    };
    this.spawner.onServerResult = (result) => this.handleServerResult(result);
    this.spawner.onServerResultRejected = (matchId) =>
      this.noteResult({ matchId, status: "rejected", reason: "verification_failed" });
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    this._loadMapsConfig();
    this.results?.deliveries.loseBotControl();
    this.retryResults();
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: "0.0.0.0" });

      this.wss.on("connection", (ws, req) => this.handleConnection(ws, clientAddress(req)));
      this.wss.on("error", (err) => {
        console.error("[LobbyServer] Error:", err);
        reject(err);
      });
      this.wss.on("listening", () => {
        const address = this.wss!.address();
        if (typeof address === "object" && address) this.port = address.port;
        console.log(`[LobbyServer] Ready on ws://localhost:${this.port}`);
        console.log(`[LobbyServer] Players online at most: ${this.maxPlayers > 0 ? this.maxPlayers : "no cap"}`);
        console.log(
          `[LobbyServer] Result storage: ${JSON.stringify(this.results?.statistics() ?? { status: "unavailable" })}`,
        );
        console.log(
          `[LobbyServer] ${this.gametypes.length} gametypes loaded: ${this.gametypes.map((g) => g.id).join(", ")}`,
        );

        // Initial demo scan + periodic refresh
        this._scanDemos();
        this._demoCacheTimer = setInterval(() => this._scanDemos(), this.DEMO_CACHE_INTERVAL);
        if (this.results) this.resultRetryTimer = setInterval(() => this.retryResults(), 5_000);

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;
    for (const id of this.pendingBotInvites.keys()) this.cancelBotInvites(id);

    // Stop demo scan timer
    if (this._demoCacheTimer) {
      clearInterval(this._demoCacheTimer);
      this._demoCacheTimer = null;
    }
    if (this.resultRetryTimer) {
      clearInterval(this.resultRetryTimer);
      this.resultRetryTimer = null;
    }

    // Shutdown all game servers
    await this.spawner.shutdownAll();
    this.retryResults();

    // Close all connections
    for (const player of this.players.values()) {
      player.ws.close(1000, "Server shutting down");
    }
    this.players.clear();
    this.lobbies.clear();
    this.matchToLobby.clear();
    this.matchRecords.clear();
    this.devMatchToPlayer.clear();

    if (this.ownsAccounts) this.accounts.close();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        console.log("[LobbyServer] Stopped");
        resolve();
      });
    });
  }

  // ── Connection Handling ──────────────────────────────────────

  private handleConnection(ws: WebSocket, address: string = "unknown"): void {
    const playerId = `p_${this.nextPlayerId++}`;
    console.log(`[LobbyServer] New connection → ${playerId}`);

    const player: ConnectedPlayer = {
      id: playerId,
      ws,
      name: "",
      status: "online",
      lobbyId: null,
      authenticated: false,
      address,
      isBot: false,
      accountId: null,
    };
    this.players.set(playerId, player);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as LobbyMessage;
        this.handleMessage(player, msg);
      } catch (err) {
        console.error(`[LobbyServer] Parse error from ${playerId}:`, err);
      }
    });

    ws.on("close", () => {
      this.handleDisconnect(player);
    });

    ws.on("error", (err) => {
      console.error(`[LobbyServer] WS error ${playerId}:`, err.message);
    });
  }

  private handleDisconnect(player: ConnectedPlayer): void {
    console.log(`[LobbyServer] Disconnected: ${player.name || player.id}`);
    this.leaderboardReads.forget(player.id);
    this.featuredReads.forget(player.id);

    // Leave lobby if in one
    if (player.lobbyId) {
      this.handleLobbyLeave(player, player.lobbyId);
    }

    this.players.delete(player.id);
    if (player.authenticated && !player.isBot && player.accountId !== null) {
      this.recentlyLeft.set(player.accountId, Date.now());
    }

    // Broadcast to others
    if (player.authenticated) {
      this.broadcast({ type: "player:leave", playerId: player.id }, player.id);
    }
  }

  // ── Message Router ──────────────────────────────────────────

  private handleMessage(player: ConnectedPlayer, msg: LobbyMessage): void {
    // Auth must come first
    if (!player.authenticated && msg.type !== "auth") {
      this.send(player, { type: "lobby:error", error: "Not authenticated. Send auth message first." });
      return;
    }

    switch (msg.type) {
      case "auth":
        this.handleAuth(player, msg as AuthMessage);
        break;
      case "bot:reference":
        this.handleBotReference(player, msg.reference);
        break;
      case "identity:rename":
        this.handleIdentityRename(player, msg.name);
        break;
      case "chat:send":
        this.handleChatSend(player, msg.text);
        break;
      case "lobby:chat_send":
        this.handleRoomChatSend(player, msg.lobbyId, msg.text);
        break;
      case "lobby:create":
        this.handleLobbyCreate(player, msg.gametype, msg.visibility);
        break;
      case "lobby:join":
        this.handleLobbyJoin(player, msg.lobbyId, msg.inviteToken);
        break;
      case "lobby:leave":
        this.handleLobbyLeave(player, msg.lobbyId);
        break;
      case "lobby:vote_map":
        this.handleLobbyVoteMap(player, msg.lobbyId, msg.map);
        break;
      case "lobby:ready":
        this.handleLobbyReady(player, msg.lobbyId, msg.ready);
        break;
      case "lobby:switch_team":
        this.handleLobbySwitchTeam(player, msg.lobbyId);
        break;
      case "lobby:vote_shuffle":
        this.handleLobbyVoteShuffle(player, msg.lobbyId);
        break;
      case "lobby:invite_bot":
        this.handleLobbyInviteBot(player, msg.lobbyId, msg.difficulty);
        break;
      case "queue:join":
        this.handleQueueJoin(player, msg.gametype);
        break;
      case "queue:leave":
        // queue:leave with immediate-lobby = leave current lobby
        if (player.lobbyId) {
          this.handleLobbyLeave(player, player.lobbyId);
        }
        this.send(player, { type: "queue:left" });
        break;
      case "demos:list":
        this.handleDemosList(player, msg.limit ?? 64, msg.scope);
        break;
      case "featured:get":
        this.handleFeaturedGet(player, msg as FeaturedDemosRequest);
        break;
      case "leaderboard:get":
        this.handleLeaderboardGet(player, msg as LeaderboardRequest);
        break;
      case "match:seat_reissue":
        this.handleSeatReissue(player, msg.requestId, msg.matchId);
        break;
      case "dev:spawn_server":
        this.handleDevSpawnServer(player, msg.requestId, msg.map, msg.gametype, msg.trainingDemo);
        break;
      default:
        // The type is whatever the client sent; a client sending junk gets one line per 5 s.
        log.warnRateLimited("LobbyServer", `Unknown message type: ${String(msg.type).slice(0, 64)}`);
    }
  }

  // ── Auth ─────────────────────────────────────────────────────

  private handleAuth(player: ConnectedPlayer, msg: AuthMessage): void {
    if (player.authenticated) {
      this.send(player, { type: "auth:error", code: "already_authenticated" });
      return;
    }

    // A bot must come from this machine and know the secret shared with the bot
    // server. Anyone else claiming to be a bot is a player, so nobody can dodge
    // the human-presence accounting that drives lobby eviction, or log in as a bot.
    const isBot =
      msg.isBot === true && isLoopbackAddress(player.address) && secretMatches(this.botSecret, msg.botSecret);
    if (isBot) {
      if (msg.botReference !== undefined) {
        try {
          player.botReference = canonicalBotReference(msg.botReference);
        } catch {
          this.send(player, { type: "auth:error", code: "invalid_bot_reference" });
          return;
        }
      }
      player.isBot = true;
      player.name = msg.name || `Bot${player.id.slice(2)}`;
      this.completeAuth(player, {});
      return;
    }

    // Every player has an account: the one their key opens, or a new one.
    // Never log a key.
    if (typeof msg.key === "string") {
      if (this.keyFailures.isBlocked(player.address)) {
        this.send(player, { type: "auth:error", code: "rate_limited" });
        return;
      }
      const account = this.accounts.findByKey(msg.key);
      if (!account) {
        this.keyFailures.record(player.address);
        this.send(player, { type: "auth:error", code: "unknown_key" });
        return;
      }
      if (this.refuseWhenFull(player, account.id)) return;
      player.accountId = account.id;
      player.name = account.name;
      this.completeAuth(player, {});
      return;
    }

    if (this.refuseWhenFull(player, null)) return;
    if (!this.accountCreations.tryRecord(player.address)) {
      this.send(player, { type: "auth:error", code: "rate_limited" });
      return;
    }
    const { account, key } = this.accounts.create();
    console.log(`[LobbyServer] New account ${account.id}: ${account.name}`);
    player.accountId = account.id;
    player.name = account.name;
    this.completeAuth(player, { key });
  }

  /** Logged in: send the welcome, and tell everyone else. */
  private handleBotReference(player: ConnectedPlayer, value: unknown): void {
    if (!player.isBot) {
      this.send(player, { type: "lobby:error", error: "Bot service only." });
      return;
    }
    let reference: BotReference;
    try {
      reference = canonicalBotReference(value);
    } catch {
      this.markBotReferenceChanged(player);
      this.send(player, { type: "lobby:error", error: "Invalid bot reference." });
      return;
    }
    if (!sameBotReference(player.botReference, reference)) this.markBotReferenceChanged(player);
    player.botReference = reference;
  }

  private markBotReferenceChanged(player: ConnectedPlayer): void {
    if (!player.isBot || !player.lobbyId) return;
    const lobby = this.lobbies.get(player.lobbyId);
    if (!lobby || (!lobby.isStarting && lobby.state !== "playing")) return;
    if (lobby.activeMatchId && this.results?.ratings.getResult(lobby.activeMatchId)) return;
    lobby.botReferenceChanged = true;
    const record = lobby.activeMatchId ? this.matchRecords.get(lobby.activeMatchId) : undefined;
    if (record) record.botReferenceChanged = true;
    if (lobby.activeMatchId) this.results?.deliveries.markBotReferenceChanged(lobby.activeMatchId);
  }

  /** Players online now: logged-in connections that are not bots. */
  private onlinePlayerCount(): number {
    let count = 0;
    for (const p of this.players.values()) if (p.authenticated && !p.isBot) count++;
    return count;
  }

  /**
   * At the cap, answer `lobby_full` and close the connection. An account that
   * left within RETURN_GRACE_MS gets back in regardless.
   */
  private refuseWhenFull(player: ConnectedPlayer, accountId: number | null): boolean {
    if (this.maxPlayers <= 0) return false;
    const now = Date.now();
    for (const [id, leftAt] of this.recentlyLeft) {
      if (now - leftAt > RETURN_GRACE_MS) this.recentlyLeft.delete(id);
    }
    if (accountId !== null && this.recentlyLeft.delete(accountId)) return false;
    const online = this.onlinePlayerCount();
    if (online < this.maxPlayers) return false;
    console.log(`[LobbyServer] Lobby full (${online}/${this.maxPlayers}): turned away ${player.id}`);
    this.send(player, {
      type: "auth:error",
      code: "lobby_full",
      online,
      maxPlayers: this.maxPlayers,
      retryAfterSec: LOBBY_FULL_RETRY_SEC,
    });
    player.ws.close(LOBBY_FULL_CLOSE_CODE, "Lobby full");
    return true;
  }

  /** Logged in: send the welcome, and tell everyone else. */
  private completeAuth(player: ConnectedPlayer, extra: { key?: string }): void {
    player.authenticated = true;
    const who = player.isBot ? "bot" : `account ${player.accountId}`;
    console.log(`[LobbyServer] Authenticated: ${player.name} (${player.id}, ${who})`);

    this.send(player, {
      type: "welcome",
      features: {
        privateLobbies: true,
        leaderboard: !!this.results,
        skillRatings: !!this.results,
        featuredDemos: true,
        demoOwnership: !!this.results,
      },
      playerId: player.id,
      identity: player.accountId === null ? undefined : { id: String(player.accountId), name: player.name },
      key: extra.key,
      gametypes: this.gametypes,
      onlinePlayers: this.getOnlinePlayers(),
      chatHistory: this.chatHistory,
      liveMatches: this.getLiveMatches(),
      recentDemos: this._demoCache.slice(0, 10),
    });

    this.broadcast(
      {
        type: "player:join",
        player: { id: player.id, name: player.name, status: player.status },
      },
      player.id,
    );
  }

  // ── Identity ─────────────────────────────────────────────────

  private handleIdentityRename(player: ConnectedPlayer, name: unknown): void {
    const accountId = player.accountId;
    if (accountId === null) return;
    if (typeof name !== "string") {
      this.send(player, { type: "identity:error", code: "name_invalid" });
      return;
    }
    if (player.lobbyId) {
      this.send(player, { type: "identity:error", code: "in_lobby" });
      return;
    }
    if (!this.renames.tryRecord(player.address)) {
      this.send(player, { type: "identity:error", code: "rate_limited" });
      return;
    }

    const result = this.accounts.rename(accountId, name);
    if (!result.ok) {
      this.send(player, { type: "identity:error", code: result.code });
      return;
    }
    console.log(`[LobbyServer] Account ${accountId} renamed: ${player.name} → ${result.account.name}`);

    // Every connection logged in to this account takes the new name
    const identity = { id: String(accountId), name: result.account.name };
    for (const other of this.players.values()) {
      if (other.accountId !== accountId) continue;
      other.name = identity.name;
      this.send(other, { type: "identity:renamed", identity });
      this.broadcast({ type: "player:renamed", playerId: other.id, name: identity.name }, other.id);
    }
  }

  // ── Chat ─────────────────────────────────────────────────────

  private handleChatSend(player: ConnectedPlayer, text: string): void {
    if (!text || text.trim().length === 0) return;

    const chatMsg: ChatMsg = {
      from: player.name,
      fromId: player.id,
      text: text.trim().slice(0, 500), // Limit length
      ts: Date.now(),
    };

    // Store in history
    this.chatHistory.push(chatMsg);
    if (this.chatHistory.length > this.MAX_CHAT_HISTORY) {
      this.chatHistory.shift();
    }

    // Broadcast to everyone (including sender for confirmation)
    this.broadcast({
      type: "chat:message",
      ...chatMsg,
    });

    console.log(`[LobbyServer] Chat: <${player.name}> ${chatMsg.text}`);
  }

  private handleRoomChatSend(player: ConnectedPlayer, lobbyId: unknown, text: unknown): void {
    if (typeof lobbyId !== "string" || player.lobbyId !== lobbyId) {
      this.send(player, { type: "lobby:error", error: "You are not in that room." });
      return;
    }
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby?.players.has(player.id)) {
      this.send(player, { type: "lobby:error", error: "You are not in that room." });
      return;
    }
    if (typeof text !== "string") return;
    const clean = text.trim().slice(0, 500);
    if (!clean) return;

    const message: ChatMsg = { from: player.name, fromId: player.id, text: clean, ts: Date.now() };
    lobby.chatHistory.push(message);
    if (lobby.chatHistory.length > this.MAX_CHAT_HISTORY) lobby.chatHistory.shift();
    this.broadcastToLobby(lobbyId, { type: "lobby:chat_message", lobbyId, ...message });
  }

  // ── Lobby: Create ────────────────────────────────────────────

  private handleLobbyCreate(
    player: ConnectedPlayer,
    gametypeId: string,
    visibility: "public" | "private" = "public",
  ): void {
    // Already in a lobby?
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "Already in a lobby. Leave first." });
      return;
    }

    const gametype = this.gametypes.find((g) => g.id === gametypeId);
    if (!gametype) {
      this.send(player, { type: "lobby:error", error: `Unknown gametype: ${gametypeId}` });
      return;
    }
    if (visibility !== "public" && visibility !== "private") {
      this.send(player, { type: "lobby:error", error: "Invalid room visibility." });
      return;
    }

    const lobby = new MatchLobby(gametype, this.mapNames, visibility);
    this.lobbies.set(lobby.id, lobby);

    // Add creator to lobby
    lobby.addPlayer(player);
    player.lobbyId = lobby.id;
    player.status = "in_lobby";

    console.log(`[LobbyServer] Lobby created: ${lobby.id} (${gametype.id}) by ${player.name}`);

    // Send lobby info to creator
    this.send(player, {
      type: "lobby:created",
      lobby: lobby.toInfo(),
    });

    // Broadcast status change
    this.broadcast(
      {
        type: "player:status",
        playerId: player.id,
        status: "in_lobby",
      },
      player.id,
    );

    // Broadcast updated matches list
    this.broadcastMatchesUpdate();
  }

  // ── Lobby: Join ──────────────────────────────────────────────

  private handleLobbyJoin(player: ConnectedPlayer, lobbyId: string, inviteToken?: string): void {
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "Already in a lobby." });
      return;
    }

    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || (lobby.visibility === "private" && inviteToken !== lobby.inviteToken)) {
      this.send(player, { type: "lobby:error", error: "Lobby not found or invite invalid." });
      return;
    }

    if (lobby.state === "playing" && (player.accountId === null || !lobby.activeSeatTeams.has(player.accountId))) {
      void this.handleDropIn(player, lobby);
      return;
    }

    // An account arriving back from a match is a new socket, and the one that
    // carried it into the game may not be known to be gone yet. Give the seat
    // to the newest connection instead of letting a room read as full against
    // its own member.
    const stale = this.seatHeldByAccount(lobby, player);
    if (stale) this.releaseSeat(lobby, stale);

    if (lobby.players.size >= lobby.gametype.maxPlayers) {
      this.send(player, { type: "lobby:error", error: "Lobby is full." });
      return;
    }

    const lobbyPlayer = lobby.addPlayer(player);
    if (stale && lobby.gametype.hasTeams) lobbyPlayer.team = stale.team;
    if (lobby.state === "playing" && player.accountId !== null) {
      lobbyPlayer.team = lobby.activeSeatTeams.get(player.accountId)!;
    }
    player.lobbyId = lobbyId;
    player.status = "in_lobby";

    console.log(`[LobbyServer] ${player.name} joined lobby ${lobbyId}`);

    // Send full lobby state to joining player
    this.send(player, {
      type: "lobby:created", // Reuse same message — full state dump
      lobby: lobby.toInfo(),
    });

    // Broadcast to other lobby members
    this.broadcastToLobby(
      lobbyId,
      {
        type: "lobby:player_joined",
        player: lobbyPlayer,
      },
      player.id,
    );

    // Broadcast status
    this.broadcast(
      {
        type: "player:status",
        playerId: player.id,
        status: "in_lobby",
      },
      player.id,
    );

    // Broadcast updated matches list
    this.broadcastMatchesUpdate();
  }

  /**
   * Join a match already under way while it has room, as a Quake or Warsow
   * server lets a spectator in mid-match. The player takes a room seat like
   * any other member, and the running game server is given a seat for them
   * before they are told where to connect.
   */
  private async handleDropIn(player: ConnectedPlayer, lobby: MatchLobby): Promise<void> {
    const matchId = lobby.activeMatchId;
    const accountId = player.accountId;
    if (player.isBot || accountId === null || !player.authenticated || !matchId || !lobby.serverUrl) {
      this.send(player, { type: "lobby:error", error: "This match is already in progress." });
      return;
    }
    if (lobby.players.size >= lobby.gametype.maxPlayers) {
      this.send(player, { type: "lobby:error", error: "This match is full." });
      return;
    }

    // Held before the server is asked, so two players cannot both take the
    // last seat while it answers. The room balances the side as for anyone.
    const lobbyPlayer = lobby.addPlayer(player);
    player.lobbyId = lobby.id;
    const seat = await this.spawner.admitDropIn(matchId, {
      accountId,
      name: player.name,
      team: lobbyPlayer.team,
      isBot: false,
    });

    // The match may have ended, or the player left, while the server answered.
    if (!seat || lobby.activeMatchId !== matchId || this.players.get(player.id) !== player) {
      if (lobby.players.get(player.id) === lobbyPlayer) lobby.removePlayer(player.id);
      if (player.lobbyId === lobby.id) player.lobbyId = null;
      this.send(player, { type: "lobby:error", error: "Could not join the match." });
      this.broadcastMatchesUpdate();
      return;
    }

    lobby.activeSeatTeams.set(accountId, lobbyPlayer.team);
    player.status = "in_match";
    console.log(`[LobbyServer] ${player.name} dropped into match ${matchId} (${lobby.id})`);
    this.send(player, { type: "lobby:created", lobby: lobby.toInfo() });
    this.broadcastToLobby(lobby.id, { type: "lobby:player_joined", player: lobbyPlayer }, player.id);
    // Private, like every seat ticket.
    this.send(player, {
      type: "lobby:connect",
      matchId,
      serverUrl: seat.serverUrl,
      map: lobby.matchMap,
      gametype: lobby.gametype.id,
      admissionTicket: seat.admissionTicket,
    });
    this.broadcast({ type: "player:status", playerId: player.id, status: "in_match" });
    this.broadcastMatchesUpdate();
  }

  /**
   * The seat this account already holds in a room under some other connection.
   * Bots have no account and never share a seat, however many of them are in.
   */
  private seatHeldByAccount(lobby: MatchLobby, player: ConnectedPlayer): LobbyPlayerInfo | undefined {
    if (player.accountId === null) return undefined;
    for (const seat of lobby.players.values()) {
      if (seat.id === player.id) continue;
      if (this.players.get(seat.id)?.accountId === player.accountId) return seat;
    }
    return undefined;
  }

  /** Take a seat back out of a room, and tell its old connection it is out. */
  private releaseSeat(lobby: MatchLobby, seat: LobbyPlayerInfo): void {
    lobby.removePlayer(seat.id);
    const previous = this.players.get(seat.id);
    if (previous) {
      previous.lobbyId = null;
      previous.status = "online";
      this.send(previous, { type: "lobby:kicked", lobbyId: lobby.id, reason: "you joined from another window" });
    }
    this.broadcastToLobby(lobby.id, { type: "lobby:player_left", playerId: seat.id });
  }

  // ── Lobby: Leave ─────────────────────────────────────────────

  private handleLobbyLeave(player: ConnectedPlayer, lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || player.lobbyId !== lobbyId || !lobby.players.has(player.id)) return;

    this.markBotReferenceChanged(player);
    lobby.removePlayer(player.id);
    player.lobbyId = null;
    player.status = "online";

    console.log(`[LobbyServer] ${player.name} left lobby ${lobbyId}`);

    // Notify remaining lobby members
    this.broadcastToLobby(lobbyId, {
      type: "lobby:player_left",
      playerId: player.id,
    });

    // If only bots are left, evict them too — a bot-only lobby should never
    // persist or start a match once every human has left.
    if (lobby.state !== "playing") this.evictBotsIfNoHumans(lobby);

    // Destroy empty lobbies — EXCEPT mid-match or during the return window.
    // With per-match servers every player's lobby socket drops at once when
    // they reload back from the game; they rejoin via the ?lobby= deep link
    // moments later, so the lobby must survive being briefly empty.
    if (lobby.players.size === 0 && lobby.state !== "playing" && Date.now() >= lobby.keepAliveUntil) {
      this.cancelBotInvites(lobbyId);
      this.lobbies.delete(lobbyId);
      console.log(`[LobbyServer] Lobby ${lobbyId} destroyed (empty)`);
    }

    // Broadcast status
    this.broadcast(
      {
        type: "player:status",
        playerId: player.id,
        status: "online",
      },
      player.id,
    );

    // Broadcast updated matches list
    this.broadcastMatchesUpdate();
  }

  /**
   * If a lobby still has members but none of them are human, kick the remaining
   * bots so they disconnect (which also tears down their in-game bot clients).
   * Prevents bot-only lobbies from lingering or starting a match, and stops the
   * bot-only demo flood at its source.
   */
  private evictBotsIfNoHumans(lobby: MatchLobby): void {
    if (lobby.players.size === 0) return;

    const anyHuman = [...lobby.players.values()].some((lp) => {
      const p = this.players.get(lp.id);
      return p !== undefined && !p.isBot;
    });
    if (anyHuman) return;

    for (const lp of [...lobby.players.values()]) {
      lobby.removePlayer(lp.id);
      const botPlayer = this.players.get(lp.id);
      if (botPlayer) {
        botPlayer.lobbyId = null;
        botPlayer.status = "online";
        this.send(botPlayer, { type: "lobby:kicked", lobbyId: lobby.id, reason: "no humans remaining" });
      }
    }
    console.log(`[LobbyServer] Evicted bots from lobby ${lobby.id} (no humans remaining)`);
  }

  // ── Lobby: Vote Map ──────────────────────────────────────────

  private handleLobbyVoteMap(player: ConnectedPlayer, lobbyId: string, mapName: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;

    lobby.voteMap(player.id, mapName);

    // Broadcast updated votes
    const votes: Record<string, number> = {};
    for (const map of lobby.maps) {
      votes[map.name] = map.votes;
    }
    this.broadcastToLobby(lobbyId, {
      type: "lobby:votes_updated",
      votes,
    });
  }

  // ── Lobby: Ready ─────────────────────────────────────────────

  private handleLobbyReady(player: ConnectedPlayer, lobbyId: string, ready: boolean): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;

    lobby.setReady(player.id, ready);

    // Broadcast player state
    this.broadcastToLobby(lobbyId, {
      type: "lobby:player_updated",
      playerId: player.id,
      ready,
    });

    // Check if all ready
    if (lobby.isAllReady()) {
      this.handleAllReady(lobby);
    }
  }

  /**
   * Move one player to the other side without changing the team counts.
   *
   * No vote and no balance check. Shuffling is random and needs a majority, so
   * with a lobby of one human and any number of bots there was no way to choose
   * a side at all — which makes the attacking half of a round mode untestable.
   * If the destination is occupied, swap with one of its players (preferring a
   * bot). This lets a solo tester choose their side while keeping both teams
   * populated and the eventual S&D round valid.
   */
  private handleLobbySwitchTeam(player: ConnectedPlayer, lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;
    if (!lobby.gametype.hasTeams) return;

    const entry = lobby.players.get(player.id);
    if (!entry) return;
    const previousTeam = entry.team;
    const destination = previousTeam === "alpha" ? "bravo" : "alpha";
    const occupants = [...lobby.players.values()].filter((p) => p.id !== player.id && p.team === destination);
    const counterpart = occupants.find((p) => this.players.get(p.id)?.isBot) ?? occupants[0];
    if (counterpart) counterpart.team = previousTeam;
    entry.team = destination;
    console.log(`[LobbyServer] ${player.name} switched to ${entry.team}`);

    this.broadcastToLobby(lobbyId, {
      type: "lobby:teams_shuffled",
      players: [...lobby.players.values()],
    });
  }

  // ── Lobby: Shuffle Vote ──────────────────────────────────────

  private handleLobbyVoteShuffle(player: ConnectedPlayer, lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;

    // Bots back whatever a human asks for. Without this a solo tester can never
    // change sides, because their single vote cannot reach the threshold.
    const bots = [...lobby.players.keys()].filter((id) => this.players.get(id)?.isBot);
    const result = lobby.voteShuffle(player.id, bots);

    if (result.passed) {
      // Shuffle happened — send new player assignments
      this.broadcastToLobby(lobbyId, {
        type: "lobby:teams_shuffled",
        players: [...lobby.players.values()],
      });
    } else {
      this.broadcastToLobby(lobbyId, {
        type: "lobby:shuffle_progress",
        votes: result.votes,
        needed: result.needed,
      });
    }
  }

  // ── Lobby: Invite Bot ────────────────────────────────────────

  /**
   * Spawn an AI bot opponent into a specific lobby.
   *
   * The lobby has no direct handle on the Bot Intelligence Server, so it
   * relays the request over the BIS control API (BOT_SERVER_URL). The bot
   * connects back to this lobby and joins THIS lobby by id (not the queue),
   * so it always lands in the caller's room. The bot then shows up via the
   * normal lobby:player_joined broadcast.
   */
  private async handleLobbyInviteBot(player: ConnectedPlayer, lobbyId: string, difficulty?: string): Promise<void> {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id)) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "You are not in this lobby." });
      return;
    }

    // Bots are for private rooms: in a public one they would fill seats other
    // players are queueing for, and change who a ranked result is against.
    if (lobby.visibility !== "private") {
      this.send(player, {
        type: "lobby:bot_invite_failed",
        lobbyId,
        error: "Bots can be added in private lobbies only.",
      });
      return;
    }

    if (lobby.state !== "waiting" || lobby.isStarting) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "Match is already starting." });
      return;
    }

    if (lobby.playerCount >= lobby.gametype.maxPlayers) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "Lobby is full." });
      return;
    }

    try {
      const name = await this.requestBotForLobby(lobby, difficulty);
      console.log(`[LobbyServer] Bot "${name}" invited into lobby ${lobbyId} by ${player.name}`);
      // The bot will appear via lobby:player_joined; this is just requester feedback.
      this.send(player, { type: "lobby:bot_invited", lobbyId, name });
    } catch (err) {
      const error = (err as Error).message;
      console.warn(`[LobbyServer] Bot invite failed for lobby ${lobbyId}: ${error}`);
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error });
    }
  }

  /**
   * Open a short-lived control connection to the Bot Intelligence Server and
   * ask it to spawn a lobby bot that joins `lobby` by id. Resolves with the
   * bot's name once the BIS acknowledges, or rejects on timeout/error.
   */
  private requestBotForLobby(lobby: MatchLobby, difficulty?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.botSecret) {
        reject(new Error("Bot server secret not configured"));
        return;
      }
      let settled = false;
      let preparing = false;
      const ws = new WebSocket(this.botServerUrl, { headers: { [BOT_SECRET_HEADER]: this.botSecret } });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const pending = this.pendingBotInvites.get(lobby.id);
        pending?.delete(cancel);
        if (pending?.size === 0) this.pendingBotInvites.delete(lobby.id);
        try {
          ws.close();
        } catch {
          // ignore
        }
        fn();
      };

      const cancel = () => finish(() => reject(new Error("Bot invite cancelled: the lobby closed or started.")));
      const pending = this.pendingBotInvites.get(lobby.id) ?? new Set<() => void>();
      pending.add(cancel);
      this.pendingBotInvites.set(lobby.id, pending);
      let timer = setTimeout(() => {
        finish(() => reject(new Error("Bot server did not respond (is bot:server running?)")));
      }, BOT_INVITE_TIMEOUT_MS);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "add_lobby_bot",
            lobbyUrl: botLobbyConnectUrl(this.port),
            lobbyId: lobby.id,
            ...(lobby.inviteToken ? { inviteToken: lobby.inviteToken } : {}),
            gametype: lobby.gametype.id,
            options: { difficulty: difficulty || "medium" },
          }),
        );
      });

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "bot_preparing" && !preparing && !settled) {
            preparing = true;
            clearTimeout(timer);
            timer = setTimeout(
              () => finish(() => reject(new Error("Bot model preparation or lobby join timed out."))),
              BOT_INVITE_PREPARATION_TIMEOUT_MS,
            );
          } else if (msg.type === "bot_added") {
            finish(() => resolve(msg.name || "Bot"));
          } else if (msg.type === "error") {
            finish(() => reject(new Error(msg.error || "Bot server rejected the request")));
          }
        } catch (err) {
          log.warn("LobbyServer", "malformed frame from bot server:", err);
        }
      });

      ws.on("error", (err: Error) => {
        finish(() => reject(new Error(`Bot server unreachable: ${err.message}`)));
      });

      ws.on("close", () => {
        finish(() => reject(new Error("Bot server closed the connection")));
      });
    });
  }

  private cancelBotInvites(lobbyId: string): void {
    for (const cancel of this.pendingBotInvites.get(lobbyId) ?? []) cancel();
    this.pendingBotInvites.delete(lobbyId);
  }

  // ── Matchmaking Queue ───────────────────────────────────────

  private handleQueueJoin(player: ConnectedPlayer, gametypeId: string): void {
    // Already in queue or lobby?
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "Already in a lobby. Leave first." });
      return;
    }

    const gametype = this.gametypes.find((g) => g.id === gametypeId);
    if (!gametype) {
      this.send(player, { type: "lobby:error", error: `Unknown gametype: ${gametypeId}` });
      return;
    }

    // Leave existing lobby if in one (e.g., switching gametypes)
    if (player.lobbyId) {
      this.handleLobbyLeave(player, player.lobbyId);
    }

    // Try to find an existing waiting lobby for this gametype
    const waitingLobby = this.findWaitingLobby(gametypeId);

    if (waitingLobby) {
      // Join existing lobby — match found!
      const lobbyPlayer = waitingLobby.addPlayer(player);
      player.lobbyId = waitingLobby.id;
      player.status = "in_lobby";

      console.log(
        `[LobbyServer] ${player.name} matched into lobby ${waitingLobby.id} (${gametypeId}), team=${lobbyPlayer.team}`,
      );

      // Notify existing lobby members about new player FIRST
      // (before sending lobby:created to joining player)
      this.broadcastToLobby(
        waitingLobby.id,
        {
          type: "lobby:player_joined",
          player: {
            id: lobbyPlayer.id,
            name: lobbyPlayer.name,
            team: lobbyPlayer.team,
            ready: lobbyPlayer.ready,
          },
        },
        player.id,
      );

      // Send full lobby state to the joining player
      this.send(player, {
        type: "lobby:created",
        lobby: waitingLobby.toInfo(),
      });

      // Broadcast status change to ALL (including self)
      this.broadcast({
        type: "player:status",
        playerId: player.id,
        status: "in_lobby",
      });

      // Broadcast updated matches list
      this.broadcastMatchesUpdate();
    } else {
      // No waiting lobby — create one immediately
      const lobby = new MatchLobby(gametype, this.mapNames);
      this.lobbies.set(lobby.id, lobby);

      lobby.addPlayer(player);
      player.lobbyId = lobby.id;
      player.status = "in_lobby";

      console.log(`[LobbyServer] ${player.name} created waiting lobby ${lobby.id} (${gametypeId})`);

      // Send lobby state — player goes straight to lobby view
      this.send(player, {
        type: "lobby:created",
        lobby: lobby.toInfo(),
      });

      // Broadcast status change to ALL (including self)
      this.broadcast({
        type: "player:status",
        playerId: player.id,
        status: "in_lobby",
      });

      // Broadcast updated matches list
      this.broadcastMatchesUpdate();
    }
  }

  private async handleDevSpawnServer(
    player: ConnectedPlayer,
    requestId: string,
    mapName: string,
    requestedGametype: string,
    trainingDemo?: string,
  ): Promise<void> {
    if (!isLoopbackAddress(player.address)) {
      this.send(player, {
        type: "dev:server_spawn_failed",
        requestId,
        error: "Developer server spawn is only allowed from localhost.",
      });
      return;
    }

    const map = String(mapName || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(map)) {
      this.send(player, {
        type: "dev:server_spawn_failed",
        requestId,
        error: `Invalid map name: ${mapName}`,
      });
      return;
    }

    // The name becomes part of a file name and a command-line argument.
    if (trainingDemo !== undefined && !/^[a-z0-9_-]{1,40}$/i.test(trainingDemo)) {
      this.send(player, {
        type: "dev:server_spawn_failed",
        requestId,
        error: `Invalid training demo name: ${trainingDemo} (letters, digits, _ and -)`,
      });
      return;
    }

    const gametypeId = normalizeGametype(requestedGametype);
    if (!gametypeId) {
      this.send(player, {
        type: "dev:server_spawn_failed",
        requestId,
        error: `Unknown gametype: ${requestedGametype}`,
      });
      return;
    }

    const gametype =
      this.gametypes.find((g) => g.id === gametypeId) || GAMETYPE_SHELLS.find((g) => g.id === gametypeId);
    const maxClients = gametype?.maxPlayers ?? 2;

    try {
      console.log(`[LobbyServer] Dev spawn requested by ${player.name}: map=${map} gametype=${gametypeId}`);
      const server = await this.spawner.spawn({
        map,
        gametype: gametypeId,
        maxClients,
        shutdown: true,
        ...(trainingDemo ? { trainingDemo } : {}),
      });

      this.devMatchToPlayer.set(server.matchId, player.id);

      player.status = "in_match";
      this.broadcast({
        type: "player:status",
        playerId: player.id,
        status: "in_match",
      });

      this.send(player, {
        type: "dev:server_spawned",
        requestId,
        serverUrl: server.url,
        map,
        gametype: gametypeId,
        matchId: server.matchId,
      });
    } catch (err) {
      this.send(player, {
        type: "dev:server_spawn_failed",
        requestId,
        error: (err as Error).message,
      });
    }
  }

  /** Find an existing lobby of this gametype that still has room */
  private findWaitingLobby(gametypeId: string): MatchLobby | undefined {
    for (const lobby of this.lobbies.values()) {
      if (
        lobby.visibility === "public" &&
        lobby.gametype.id === gametypeId &&
        lobby.playerCount < lobby.gametype.maxPlayers &&
        !lobby.isStarting
      ) {
        return lobby;
      }
    }
    return undefined;
  }

  // ── All Ready → Game Start ───────────────────────────────────

  private async handleAllReady(lobby: MatchLobby): Promise<void> {
    const map = lobby.getWinningMap();
    const gametypeId = lobby.gametype.id;
    console.log(`[LobbyServer] All ready in ${lobby.id}! Map: ${map}, Gametype: ${gametypeId}`);

    // Notify lobby
    this.broadcastToLobby(lobby.id, { type: "lobby:all_ready" });
    this.broadcastToLobby(lobby.id, {
      type: "lobby:starting",
      map,
      status: "spawning_server",
    });

    // Mark lobby as starting/playing immediately so others can see it
    lobby.isStarting = true;
    this.cancelBotInvites(lobby.id);
    lobby.botReferenceChanged = false;
    lobby.state = "playing";
    lobby.matchMap = map;
    this.broadcastMatchesUpdate();

    try {
      const admissionSeats = [...lobby.players.values()].map((lp) => {
        const player = this.players.get(lp.id);
        if (!player || !player.authenticated) throw new Error("A lobby player is no longer connected");
        return {
          lobbyPlayerId: lp.id,
          accountId: player.accountId,
          name: player.name,
          team: lp.team,
          isBot: player.isBot,
          ...(player.botReference === undefined ? {} : { botReference: canonicalBotReference(player.botReference) }),
        };
      });
      const resultContext: ResultContext = {
        ranked: isRankedRoster(lobby.gametype, admissionSeats),
        private: lobby.visibility === "private",
        bots: admissionSeats.filter((seat) => seat.isBot).length,
        startingRoster: admissionSeats.map(({ accountId, isBot, team, botReference }) => ({
          accountId,
          isBot,
          team,
          ...(botReference === undefined ? {} : { botReference }),
        })),
        botReferenceChanged: false,
      };
      // Persist policy and verification context before launching the child.
      const server = await this.spawner.spawn({
        map,
        gametype: gametypeId,
        maxClients: lobby.gametype.maxPlayers,
        admissionSeats,
        private: lobby.visibility === "private",
        resultContext,
      });

      // Track matchId → lobbyId mapping for cleanup
      this.matchToLobby.set(server.matchId, lobby.id);
      // Ranked or not is decided by the roster that starts the match, not by
      // whoever is still connected when it ends.
      resultContext.botReferenceChanged = lobby.botReferenceChanged;
      this.matchRecords.set(server.matchId, resultContext);
      if (lobby.botReferenceChanged) this.results?.deliveries.markBotReferenceChanged(server.matchId);
      lobby.activeMatchId = server.matchId;
      lobby.activeSeatTeams = new Map(
        admissionSeats.flatMap((seat) => (seat.accountId === null ? [] : [[seat.accountId, seat.team] as const])),
      );

      // Store server URL on lobby for spectator discovery
      lobby.serverUrl = server.url;

      // Each ticket belongs to one verified seat; a room broadcast would expose them all.
      for (const lp of lobby.players.values()) {
        const player = this.players.get(lp.id);
        if (!player) continue;
        const admissionTicket = server.admissionTickets?.get(lp.id);
        this.send(player, {
          type: "lobby:connect",
          matchId: server.matchId,
          serverUrl: server.url,
          map,
          gametype: gametypeId,
          admissionTicket,
        });
      }
      // The child has hashes; after private delivery the lobby has no reason to retain raw tickets.
      server.admissionTickets?.clear();

      // Update player statuses
      for (const lp of lobby.players.values()) {
        const player = this.players.get(lp.id);
        if (player) {
          player.status = "in_match";
          this.broadcast({
            type: "player:status",
            playerId: player.id,
            status: "in_match",
          });
        }
      }

      console.log(`[LobbyServer] Players connecting to ${server.url}`);
    } catch (err) {
      console.error(`[LobbyServer] Failed to spawn server:`, err);

      // Revert lobby state on failure
      lobby.isStarting = false;
      lobby.state = "waiting";
      lobby.matchMap = "";
      lobby.activeMatchId = null;
      lobby.activeSeatTeams.clear();

      this.broadcastToLobby(lobby.id, {
        type: "lobby:error",
        error: `Failed to start game server: ${(err as Error).message}`,
      });

      // Reset all players to not-ready
      for (const lp of lobby.players.values()) {
        lp.ready = false;
        this.broadcastToLobby(lobby.id, {
          type: "lobby:player_updated",
          playerId: lp.id,
          ready: false,
        });
      }

      // Broadcast reverted state to all clients
      this.broadcastMatchesUpdate();
    }
  }

  // ── Game Server Exit Handling ────────────────────────────

  /** Server/admin diagnostics, never exposed through an unauthenticated browser endpoint. */
  getResultDiagnostics() {
    return { storage: this.results?.statistics() ?? null, runtime: this.resultDiagnostics.snapshot() };
  }

  private noteResult(event: Omit<ResultDiagnostic, "observedAt">): void {
    console.log(`[LobbyServer] Result: ${JSON.stringify(this.resultDiagnostics.record(event))}`);
  }

  private handleServerResult(report: MatchResultReport): void {
    const record = this.matchRecords.get(report.matchId);
    const note = (status: ResultDiagnostic["status"], reason: ResultDiagnostic["reason"]) =>
      this.noteResult({
        matchId: report.matchId,
        status,
        reason,
        gametype: report.gametype,
        ...(record ? { scope: record.private ? "private" : "public" } : {}),
      });
    if (!this.results) {
      note("skipped", "storage_unavailable");
      return;
    }
    if (!this.matchToLobby.has(report.matchId)) {
      note("skipped", "unknown_match");
      return;
    }
    if (!record) {
      note("skipped", "missing_match_context");
      return;
    }
    try {
      const receipt = this.results.recordVerified(report, record);
      this.results.deliveries.acknowledge(report.matchId);
      if (receipt.status === "duplicate") note("duplicate", "duplicate");
      else if (receipt.recordReason === "eligible") note("stored", "stored");
      else note("skipped", receipt.recordReason);
    } catch {
      note("failed", "store_error");
    }
  }

  private retryResults(): void {
    const summary = this.results?.deliveries.retryAll();
    if (summary && (summary.delivered || summary.failed))
      console.log(`[LobbyServer] Result delivery: ${JSON.stringify(summary)}`);
  }

  private handleLeaderboardGet(player: ConnectedPlayer, msg: LeaderboardRequest): void {
    // Bound both the SQL page and the echo payload; no client chooses the account whose rank is returned.
    const requestId =
      typeof msg.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(msg.requestId) ? msg.requestId : "";
    if (
      !requestId ||
      !["duel", "amphi", "ffa", "snd"].includes(msg.gametype) ||
      (msg.period !== "month" && msg.period !== "all") ||
      !Number.isSafeInteger(msg.offset) ||
      msg.offset < 0 ||
      msg.offset > 1000 ||
      !Number.isSafeInteger(msg.limit) ||
      msg.limit < 1 ||
      msg.limit > 100 ||
      (msg.scope !== undefined && msg.scope !== "public" && msg.scope !== "private") ||
      (msg.system !== undefined && msg.system !== "trueskill") ||
      msg.includePrivate !== undefined
    ) {
      this.send(player, { type: "leaderboard:error", requestId, reason: "invalid_query" });
      return;
    }
    if (!this.results) {
      this.send(player, { type: "leaderboard:error", requestId, reason: "unavailable" });
      return;
    }
    if (!this.leaderboardReads.tryRecord(player.id)) {
      this.send(player, { type: "leaderboard:error", requestId, reason: "rate_limited" });
      return;
    }
    const query = {
      gametype: msg.gametype,
      period: msg.period,
      offset: msg.offset,
      limit: msg.limit,
      accountId: player.accountId ?? undefined,
      scope: msg.scope ?? "public",
    };
    const page = msg.system === "trueskill" ? this.results.skillLeaderboard(query) : this.results.leaderboard(query);
    this.send(player, {
      type: "leaderboard:page",
      requestId,
      gametype: msg.gametype,
      period: msg.period,
      scope: msg.scope ?? "public",
      system: page.system,
      policyVersion: page.policyVersion,
      localProcessing: page.localProcessing,
      entries: page.entries.map(({ accountId, ...row }) => ({ ...row, playerId: String(accountId) })),
      total: page.total,
      localPlayerRank: page.localPlayerRank,
      localPlayerEntry: page.localPlayerEntry
        ? (({ accountId, ...row }) => ({ ...row, playerId: String(accountId) }))(page.localPlayerEntry)
        : undefined,
    });
  }

  private handleSeatReissue(player: ConnectedPlayer, requestId: unknown, matchId: unknown): void {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return;
    const ticket =
      !player.isBot &&
      player.accountId !== null &&
      typeof matchId === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(matchId) &&
      this.matchToLobby.has(matchId)
        ? this.spawner.reissueUnclaimedSeat(matchId, player.accountId)
        : null;
    if (ticket) this.send(player, { type: "match:seat_reissued", requestId, matchId, ...ticket });
    else this.send(player, { type: "match:seat_reissue_error", requestId, reason: "unavailable" });
  }

  private handleServerExit(matchId: string, code: number | null): void {
    const lobbyId = this.matchToLobby.get(matchId);
    this.matchToLobby.delete(matchId);
    this.matchRecords.delete(matchId);

    console.log(`[LobbyServer] Game server exited: match=${matchId} lobby=${lobbyId} code=${code}`);

    if (!lobbyId) {
      const playerId = this.devMatchToPlayer.get(matchId);
      this.devMatchToPlayer.delete(matchId);
      if (playerId) {
        const player = this.players.get(playerId);
        if (player) {
          player.status = "online";
          this.broadcast({
            type: "player:status",
            playerId: player.id,
            status: "online",
          });
        }
      }
      return;
    }
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;

    // Notify lobby players that match ended
    this.broadcastToLobby(lobbyId, {
      type: "match:ended",
      matchId,
      exitCode: code,
    });

    // Return lobby to waiting state — the lobby IS the rematch screen
    // (single-match flow: docs/research/single_game_server_lobby.md).
    lobby.state = "waiting";
    lobby.matchMap = "";
    lobby.activeMatchId = null;
    lobby.activeSeatTeams.clear();
    lobby.isStarting = false; // otherwise re-ready and findWaitingLobby stay blocked
    lobby.serverUrl = ""; // never offer a connect URL to a dead server
    lobby.votes.clear(); // fresh map vote for the next round
    // Hold the lobby open for the return trip (reload drops all its sockets).
    lobby.keepAliveUntil = Date.now() + 3 * 60_000;
    // During play, a browser reload must not kick the remaining match bots.
    // Once the child exits, a bot-only room has no human to ready a rematch.
    this.evictBotsIfNoHumans(lobby);

    // Return all players to the lobby (the rematch screen), not-ready.
    for (const lp of lobby.players.values()) {
      lp.ready = false;
      const player = this.players.get(lp.id);
      if (player) {
        player.status = "in_lobby";
        this.broadcast({
          type: "player:status",
          playerId: player.id,
          status: "in_lobby",
        });
      }
    }

    // Broadcast updated matches list
    this.broadcastMatchesUpdate();
  }

  // ── Helpers ──────────────────────────────────────────────────

  private send(player: ConnectedPlayer, msg: LobbyMessage): void {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: LobbyMessage, excludeId?: string): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.id === excludeId) continue;
      if (!player.authenticated) continue;
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    }
  }

  private broadcastToLobby(lobbyId: string, msg: LobbyMessage, excludeId?: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;

    const data = JSON.stringify(msg);
    for (const lp of lobby.players.values()) {
      if (lp.id === excludeId) continue;
      const player = this.players.get(lp.id);
      if (player && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    }
  }

  // ── Map Config ───────────────────────────────────────────────

  /**
   * Build gametypes and mapNames from config/maps.json + disk scan.
   *
   * A map is included in a gametype's pool only when:
   *   1. It is listed for that gametype in config/maps.json
   *   2. Its map_<name>.pk3 file exists in public/games/default/
   *
   * If the PK3 directory is missing (dev environment without assets),
   * all manifest maps are included without the disk filter.
   */
  private _loadMapsConfig(): void {
    // Read manifest
    let manifest: MapManifest = {};
    try {
      const raw = fs.readFileSync(this.MAP_CONFIG_PATH, "utf-8");
      manifest = JSON.parse(raw) as MapManifest;
    } catch (err) {
      console.warn("[LobbyServer] Could not read config/maps.json — using empty map pool:", (err as Error).message);
    }

    // Scan disk for available PK3s
    let availableOnDisk: Set<string> | null = null;
    try {
      if (fs.existsSync(this.PK3_DIR)) {
        const files = fs.readdirSync(this.PK3_DIR);
        const mapPk3Names = files.filter((f) => f.startsWith("map_") && f.endsWith(".pk3")).map((f) => f.slice(4, -4)); // "map_wdm2.pk3" → "wdm2"
        if (mapPk3Names.length > 0) {
          availableOnDisk = new Set(mapPk3Names);
          console.log(`[LobbyServer] Found ${availableOnDisk.size} map PK3s in ${this.PK3_DIR}`);
        } else {
          console.log("[LobbyServer] No map_*.pk3 files found in PK3 dir — skipping disk filter");
        }
      } else {
        console.log("[LobbyServer] PK3 directory not found — skipping disk filter, using all manifest maps");
      }
    } catch (err) {
      console.warn("[LobbyServer] PK3 scan failed — skipping disk filter:", (err as Error).message);
    }

    // Build mapNames lookup from manifest
    this.mapNames = {};
    for (const [name, entry] of Object.entries(manifest)) {
      this.mapNames[name] = entry.displayName;
    }

    // Build gametypes with resolved map pools
    this.gametypes = GAMETYPE_SHELLS.map((shell) => {
      const mapPool = Object.entries(manifest)
        .filter(([name, entry]) => {
          const inManifest = entry.gametypes.includes(shell.id);
          // Amphi is a new playable mode: do not advertise it from manifest
          // names alone in a checkout without its PK3 assets.
          const onDisk =
            shell.id === "amphi"
              ? availableOnDisk?.has(name) === true
              : availableOnDisk === null || availableOnDisk.has(name);
          return inManifest && onDisk;
        })
        .map(([name]) => name);

      if (mapPool.length === 0) {
        console.warn(`[LobbyServer] Gametype "${shell.id}" has no available maps`);
      } else {
        console.log(`[LobbyServer] ${shell.id}: ${mapPool.join(", ")}`);
      }

      return { ...shell, mapPool };
    }).filter((gametype) => gametype.id !== "amphi" || gametype.mapPool.length > 0);
  }

  // ── Demo Scanning ────────────────────────────────────────────

  private handleDemosList(player: ConnectedPlayer, limit: number, requestedScope?: string): void {
    const scope = requestedScope === "yours" ? "yours" : "latest";
    const source =
      scope === "yours"
        ? this._demoCache.filter(
            (demo) => player.accountId != null && this._demoOwnership.get(demo.filename)?.has(player.accountId),
          )
        : this._demoCache;
    const size = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 64)) : 64;
    this.send(player, { type: "demos:list_response", demos: source.slice(0, size), scope });
  }

  private handleFeaturedGet(player: ConnectedPlayer, query: FeaturedDemosRequest): void {
    const { requestId, gametype = "all", map = "all", limit } = query;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10 ||
      typeof gametype !== "string" ||
      !["all", "duel", "amphi", "ffa", "snd"].includes(gametype) ||
      typeof map !== "string" ||
      (map !== "all" && !/^[A-Za-z0-9_-]{1,64}$/.test(map))
    ) {
      this.send(player, { type: "featured:error", requestId, reason: "invalid_query" });
      return;
    }
    if (!this.featuredReads.tryRecord(player.id)) {
      this.send(player, { type: "featured:error", requestId, reason: "rate_limited" });
      return;
    }
    const ranked = this.selectRankedFeatured(gametype, map, limit);
    this.send(player, {
      type: "featured:page",
      requestId,
      entries: ranked.length > 0 ? ranked : selectFeaturedDemos(this._demoCache, { gametype, map, limit }),
      selection: ranked.length > 0 ? "ranked_month_week" : "recent_multiplayer_week",
    });
  }

  /** Prefer recent demos containing a verified top-ten account in that demo's mode. */
  private selectRankedFeatured(gametype: string, map: string, limit: number): FeaturedDemoInfo[] {
    if (!this.results) return [];
    const now = Date.now();
    const topByMode = new Map<string, Set<number>>();
    const eligible = this._demoCache.filter((demo) => {
      const mode = normalizeGametype(demo.gametype);
      if (!mode || (gametype !== "all" && mode !== gametype)) return false;
      let top = topByMode.get(mode);
      if (!top) {
        top = new Set(
          this.results
            ?.skillLeaderboard({ gametype: mode, period: "month", offset: 0, limit: 10, now })
            .entries.map((entry) => entry.accountId) ?? [],
        );
        topByMode.set(mode, top);
      }
      const owners = this._demoOwnership.get(demo.filename);
      return !!owners && [...owners].some((accountId) => top?.has(accountId));
    });
    return selectFeaturedDemos(eligible, { gametype, map, limit }, now).map((entry) => ({
      ...entry,
      reason: "Features a 30-day top 10 player",
    }));
  }

  /**
   * Scan public/data/demos/ for .shagdemo files and parse their headers.
   * Results are cached and sorted newest-first.
   */
  private _scanDemos(): void {
    try {
      if (!fs.existsSync(this.DEMO_DIR)) {
        this._demoCache = [];
        this._demoOwnership.clear();
        return;
      }

      const files = fs
        .readdirSync(this.DEMO_DIR)
        .filter((f) => f.endsWith(".shagdemo"))
        .sort()
        .reverse(); // newest first by filename (contains date)

      const demos: DemoInfo[] = [];
      const ownership = new Map<string, Set<number>>();

      for (const filename of files) {
        try {
          const filepath = path.join(this.DEMO_DIR, filename);
          const stat = fs.statSync(filepath);
          const data = fs.readFileSync(filepath);

          const reader = new DemoReader(new Uint8Array(data));
          const header = reader.readHeader();
          const index = reader.readIndex();

          // Calculate duration from index (last tick - first tick) / snapshot rate
          let durationMs = 0;
          if (index && index.frameCount > 0 && header) {
            const lastFrame = index.entries[index.frameCount - 1];
            const firstFrame = index.entries[0];
            const tickSpan = lastFrame.tick - firstFrame.tick;
            durationMs = Math.round((tickSpan / header.tickRate) * 1000);
          }

          if (header) {
            const mode = normalizeGametype(header.gametype);
            const recordedAccounts =
              this.results && header.matchId && mode
                ? new Set(this.results.verifiedDemoAccounts(header.matchId, mode, header.map, header.startTime))
                : null;
            const verifiedAccountIds = recordedAccounts
              ? new Set(
                  header.players
                    .map((player) => player.accountId)
                    .filter((id): id is number => !!id && recordedAccounts.has(id)),
                )
              : new Set<number>();
            if (verifiedAccountIds.size > 0) ownership.set(filename, verifiedAccountIds);
            demos.push({
              filename,
              map: header.map,
              mapDisplayName: this.mapNames[header.map] || header.map,
              gametype: header.gametype,
              private: header.private === true,
              players: header.players.map((p) => p.name),
              durationMs,
              date: header.startTime,
              sizeMB: parseFloat((stat.size / (1024 * 1024)).toFixed(2)),
              levelshot: `/data/levelshots/${header.map}.jpg`,
            });
          }
        } catch (err) {
          console.warn(`[LobbyServer] Failed to parse demo: ${filename}`, (err as Error).message);
        }
      }

      this._demoCache = demos;
      this._demoOwnership = ownership;
      if (demos.length > 0) {
        console.log(`[LobbyServer] Demo scan: ${demos.length} demos found`);
      }
    } catch (err) {
      console.error("[LobbyServer] Demo scan failed:", err);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private getOnlinePlayers(): PlayerInfo[] {
    return [...this.players.values()]
      .filter((p) => p.authenticated)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        lobbyId: p.lobbyId && this.lobbies.get(p.lobbyId)?.visibility !== "private" ? p.lobbyId : undefined,
      }));
  }

  // ── Live Matches ────────────────────────────────────────────

  private getLiveMatches(): LiveMatchInfo[] {
    const matches: LiveMatchInfo[] = [];
    for (const lobby of this.lobbies.values()) {
      if (lobby.visibility === "private") continue;
      matches.push({
        id: lobby.id,
        gametype: lobby.gametype.id,
        gametypeName: lobby.gametype.name,
        map: lobby.matchMap,
        mapDisplayName: lobby.matchMap ? this.mapNames[lobby.matchMap] || lobby.matchMap : "",
        players: [...lobby.players.values()].map((p) => p.name),
        playerCount: lobby.players.size,
        maxPlayers: lobby.gametype.maxPlayers,
        state: lobby.state,
        startedAt: lobby.createdAt,
        serverUrl: lobby.serverUrl || undefined,
      });
    }
    return matches;
  }

  private broadcastMatchesUpdate(): void {
    // Lazy sweep: drop empty lobbies whose post-match return window expired
    // (players never came back). Keeps keep-alive lobbies from lingering.
    const now = Date.now();
    for (const [lobbyId, lobby] of this.lobbies) {
      if (lobby.players.size === 0 && lobby.state !== "playing" && now >= lobby.keepAliveUntil) {
        this.cancelBotInvites(lobbyId);
        this.lobbies.delete(lobbyId);
        console.log(`[LobbyServer] Lobby ${lobbyId} destroyed (return window expired)`);
      }
    }

    this.broadcast({
      type: "matches:update",
      matches: this.getLiveMatches(),
    });
  }
}
