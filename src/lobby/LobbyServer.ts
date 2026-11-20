/**
 * LobbyServer — WebSocket Lobby Server
 *
 * Handles player presence, chat, match lobbies, and game server spawning.
 * All communication is JSON over WebSocket.
 *
 * Usage: npm run lobby:server
 */

import * as fs from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import * as path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";
import { background, logRejection } from "../engine/core/AsyncErrors";
import { log } from "../engine/core/Log";
import { filterChatText, filterPlayerName } from "../engine/server/ChatFilter";
import type { MatchResultReport } from "../engine/server/network/MatchResultReport";
import { normalizeDemoMapName } from "../shared/demo/DemoMapName";
import { type DemoHeader, DemoReader } from "../shared/demo/DemoReader";
import { BOT_ACCOUNT_PRESETS as BOT_PRESETS, type BotPreset } from "../shared/ranking/BotMatchRatingGroups";
import { BOT_INVITE_PREPARATION_TIMEOUT_MS } from "../shared/ranking/BotPreparation";
import { type BotReference, canonicalBotReference, sameBotReference } from "../shared/ranking/BotReference";
import { isRatingMode } from "../shared/ranking/RatingPolicy";
import { AdminPanel } from "./AdminPanel";
import {
  type CampaignCatalog,
  campaignBotNames,
  campaignFinished,
  campaignMatchRules,
  campaignMission,
  EMPTY_CAMPAIGN,
  lobbyCampaignInfo,
  parseCampaign,
  roomUnlockedThrough,
  unlockedThrough,
} from "./Campaign";
import { CampaignStore } from "./CampaignStore";
import { FairPlayStore } from "./FairPlayStore";
import { MIN_LISTED_DEMO_MS, selectFeaturedDemos } from "./FeaturedDemos";
import { GameServerSpawner } from "./GameServerSpawner";
import {
  CAMPAIGN_GAMETYPE_SHELLS,
  clientAddress,
  GAMETYPE_SHELLS,
  isLoopbackAddress,
  isRankedRoster,
  normalizeGametype,
} from "./LobbyRules";
import { LocalSocket } from "./LocalSocket";
import {
  AI_INVITE_AFTER_MS,
  AI_INVITE_RETRY_MS,
  AI_INVITE_SPACING_MS,
  type ConnectedPlayer,
  MatchLobby,
} from "./MatchLobby";
import type { MatchResultStore } from "./MatchResultStore";
import { DELETED_ACCOUNT_NAME, type PlayerNameReservation } from "./PlayerIdentity";
import { RATING_POOLS } from "./PlayerStatsStore";
import { HOST_LABEL, PlayerStore } from "./PlayerStore";
import { RateLimiter } from "./RateLimiter";
import { type ResultDiagnostic, ResultDiagnostics } from "./ResultDiagnostics";
import type { ResultContext } from "./ResultSnapshot";
import { BOT_SECRET_HEADER, secretMatches } from "./ServerData";
import { SettingsStore } from "./SettingsStore";
import type {
  AuthMessage,
  CampaignBoardRequest,
  CampaignBoardRow,
  CampaignMissionInfo,
  CampaignStateMessage,
  ChatMessage as ChatMsg,
  ChatSendMessage,
  DemoInfo,
  DemosListRequest,
  DevSpawnServerMessage,
  FeaturedDemoInfo,
  FeaturedDemosRequest,
  GametypeInfo,
  LeaderboardRequest,
  LiveMatchInfo,
  LobbyCreateMessage,
  LobbyInviteBotMessage,
  LobbyJoinMessage,
  LobbyLeaveMessage,
  LobbyMessage,
  LobbyPlayerInfo,
  LobbyReadyMessage,
  LobbySwitchTeamMessage,
  LobbyVoteMapMessage,
  LobbyVoteShuffleMessage,
  PlayerInfo,
  PlayerReportRequest,
  PlayerStatsRequest,
  QueueJoinMessage,
  RoomChatSendMessage,
  SeatReissueRequest,
  SettingsErrorCode,
} from "./types";

export { clientAddress, isLoopbackAddress, isRankedRoster, normalizeGametype, type RankedSeat } from "./LobbyRules";
export { MIN_LISTED_DEMO_MS };

// ============================================================================
// Configuration
// ============================================================================

/** Demos read between updates of the list while the first scan runs. */
const DEMO_SCAN_BATCH = 25;

const gunzipAsync = promisify(gunzip) as (data: Uint8Array) => Promise<Uint8Array>;

/** Per player address: new accounts, wrong keys, renames. */
/** How often fair-play counters past their retention are deleted. */
const FAIR_PLAY_PRUNE_INTERVAL_MS = 24 * 60 * 60_000;
const ACCOUNT_CREATION_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const KEY_FAILURE_LIMIT = { limit: 20, windowMs: 60_000 };
const RENAME_LIMIT = { limit: 10, windowMs: 60_000 };
/** Per player address: practice servers started (`map <name>` from a remote player). */
const PRACTICE_SPAWN_LIMIT = { limit: 3, windowMs: 60_000 };
/** Per account: synced settings reads and writes (clients debounce, so this is generous). */
const SETTINGS_LIMIT = { limit: 30, windowMs: 60_000 };
/** Per connection: lobby and room chat lines, as the game server allows in a match. */
const CHAT_LIMIT = { limit: 5, windowMs: 5_000 };
/**
 * Per connection: every message. A client sends a few a second at most, so a
 * connection past this is flooding and is closed.
 */
const MESSAGE_LIMIT = { limit: 200, windowMs: 10_000 };
/** Open connections from one address (not loopback) at once; enough for a household or a LAN party. */
const MAX_CONNECTIONS_PER_ADDRESS = 32;
/** How long a connection has to log in. */
const LOGIN_DEADLINE_MS = 30_000;
/** Close code for "try again later" (RFC 6455). */
const TRY_AGAIN_LATER_CODE = 1013;
/** Bytes queued for a connection past which it is taken to have stopped reading. */
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
/** Close code for a connection closed for flooding (RFC 6455 policy violation). */
const FLOOD_CLOSE_CODE = 1008;
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
/** WebSocket close code after a `banned` answer, or when a ban reaches a connected account. */
export const BANNED_CLOSE_CODE = 4009;
/** Where a banned player is told to appeal, unless the operator sets `appealContact`: the private contact the privacy notice names. */
export const DEFAULT_APPEAL_CONTACT = "write to washoi@higherstandardgames.com";
/** How often bans are checked against connected accounts. */
const SANCTION_CHECK_INTERVAL_MS = 60_000;

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

/** A bot to seat in a room, and how it reaches the lobby. */
export interface BotSeatRequest {
  lobbyId: string;
  inviteToken?: string;
  gametype: string;
  difficulty: BotPreset;
  /** A campaign bot's name; others are named by the seat. */
  name?: string;
  /** A connection to this lobby in its own process (LocalSocket), for the seat's lobby client. */
  connect: () => LocalSocket;
  /** Aborted when the invite is cancelled or times out. */
  signal: AbortSignal;
}

/**
 * Bots seated by the lobby's own process instead of a bot server: each a
 * lobby client on an in-process connection, playing its match where the
 * provider puts it (a match runner). Resolves with the bot's name once seated.
 */
export interface LobbyBotSeats {
  seat(request: BotSeatRequest): Promise<string>;
}

export interface LobbyServerOptions {
  /** Application reservations for the lobby-owned in-memory account store. Supplied stores own their policy. */
  reservePlayerName?: PlayerNameReservation;
  /** Map media key for demo levelshots. Defaults to normalization without application aliases. */
  resolveDemoMap?: (map: string) => string;
  /** Shared with the bot server. Without it no connection counts as a bot and bot invites fail. */
  botSecret?: string;
  /** Override the local bot control endpoint, primarily for isolated server instances. */
  botServerUrl?: string;
  /** Seat bots in this process (LobbyBotSeats) instead of asking the bot server at botServerUrl. */
  botSeats?: LobbyBotSeats;
  /** Player accounts. Without one the lobby keeps accounts in memory until it stops. */
  players?: PlayerStore;
  /** Durable results; omitted in ephemeral test/dev lobbies. */
  results?: MatchResultStore;
  /** Players online at once; 0 for no cap. Default DEFAULT_MAX_PLAYERS. */
  maxPlayers?: number;
  /** Synced player settings. Without one the lobby keeps them in memory until it stops. */
  settings?: SettingsStore;
  /** Campaign progress. Without one the lobby keeps it in memory until it stops. */
  campaign?: CampaignStore;
  /** Fair-play counters and sanctions. Without one the lobby keeps them in memory until it stops. */
  fairPlay?: FairPlayStore;
  /** How a banned player can appeal, shown with the ban. Default DEFAULT_APPEAL_CONTACT. */
  appealContact?: string;
  /** `admin.json` (AdminCredentials.ts): serve the admin panel at `/admin` while it lists an admin. */
  adminFile?: string;
}

/** Shape of config/maps.json */
interface MapManifestEntry {
  displayName: string;
  gametypes: string[];
}
type MapManifest = Record<string, MapManifestEntry>;

// ============================================================================
// Lobby Server
// ============================================================================

export class LobbyServer {
  private wss: WebSocketServer | null = null;
  /** Carries the WebSocket upgrades and the admin panel's pages. */
  private http: HttpServer | null = null;
  private readonly admin: AdminPanel | null;
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
  /** Running practice servers by matchId, with whose they are: one each. */
  private practiceServers = new Map<string, { accountId: number | null; address: string }>();

  private readonly MAX_CHAT_HISTORY = 50;

  // Demo listing cache
  private _demoCache: DemoInfo[] = [];
  /** The demo scan running now, if one is. */
  private _demoScan: Promise<void> | null = null;
  private _demoCountLogged = 0;
  /** Set by stop(): a scan in progress ends at its next file. */
  private demoScanStopped = false;
  /** What each demo file holds, by name, read once per file version (see _scanDemos). */
  private readonly _demoFiles = new Map<
    string,
    { mtimeMs: number; size: number; header: DemoHeader | null; durationMs: number }
  >();
  /** Server-only verified ownership; account IDs never ride in public demo cards. */
  private _demoOwnership = new Map<string, Set<number>>();
  /** Filename → the account each listed name was recorded for, so a deleted account's name can be swapped out. */
  private _demoPlayerAccounts = new Map<string, readonly (number | undefined)[]>();
  private _demoCacheTimer: ReturnType<typeof setInterval> | null = null;
  private resultRetryTimer: ReturnType<typeof setInterval> | null = null;
  private pendingBotInvites = new Map<string, Set<() => void>>();
  private aiInviteTimer: ReturnType<typeof setInterval> | null = null;
  private readonly DEMO_DIR = path.join(process.cwd(), "public", "data", "demos");
  private readonly DEMO_CACHE_INTERVAL = 60_000; // 60s refresh

  // Dynamic map config (built at startup from config/maps.json + disk scan)
  private gametypes: GametypeInfo[] = [];
  /** The campaign-only gametypes, with every installed map in their pools. */
  private campaignGametypes: GametypeInfo[] = [];
  private mapNames: Record<string, string> = {};

  private readonly MAP_CONFIG_PATH = path.join(process.cwd(), "config", "maps.json");
  private readonly CAMPAIGN_CONFIG_PATH = path.join(process.cwd(), "config", "campaign.json");
  /** The campaign's missions, read from config/campaign.json at start. */
  private campaignCatalog: CampaignCatalog = EMPTY_CAMPAIGN;
  /** The campaign's bot names, lowercased: reserved from accounts. */
  private campaignBots = new Set<string>();
  /** Running campaign matches: the mission each plays. */
  private readonly campaignMatches = new Map<string, CampaignMissionInfo>();
  /** Campaign rooms whose bots are being invited, and whether another pass was asked for meanwhile. */
  private readonly campaignFills = new Map<string, boolean>();
  private readonly PK3_DIR = path.join(process.cwd(), "public", "data");

  private readonly botSecret: string | undefined;
  private readonly resolveDemoMap: (map: string) => string;
  private readonly botServerUrl: string;
  /** Bots seated in this process, when given; else the bot server is asked. */
  private readonly botSeats: LobbyBotSeats | null;
  private readonly accounts: PlayerStore;
  private readonly results: MatchResultStore | undefined;
  /** Close the store on stop only if this server opened it. */
  private readonly ownsAccounts: boolean;
  private readonly settings: SettingsStore;
  private readonly ownsSettings: boolean;
  private readonly campaign: CampaignStore;
  private readonly ownsCampaign: boolean;
  private readonly fairPlay: FairPlayStore;
  private readonly ownsFairPlay: boolean;
  private fairPlayPruneTimer: NodeJS.Timeout | null = null;
  private sanctionCheckTimer: NodeJS.Timeout | null = null;
  private readonly appealContact: string;
  private readonly accountCreations = new RateLimiter(ACCOUNT_CREATION_LIMIT.limit, ACCOUNT_CREATION_LIMIT.windowMs);
  private readonly keyFailures = new RateLimiter(KEY_FAILURE_LIMIT.limit, KEY_FAILURE_LIMIT.windowMs);
  private readonly renames = new RateLimiter(RENAME_LIMIT.limit, RENAME_LIMIT.windowMs);
  private readonly practiceSpawns = new RateLimiter(PRACTICE_SPAWN_LIMIT.limit, PRACTICE_SPAWN_LIMIT.windowMs);
  private readonly leaderboardReads = new RateLimiter(60, 60_000);
  private readonly featuredReads = new RateLimiter(60, 60_000);
  private readonly settingsRequests = new RateLimiter(SETTINGS_LIMIT.limit, SETTINGS_LIMIT.windowMs);
  private readonly chatLines = new RateLimiter(CHAT_LIMIT.limit, CHAT_LIMIT.windowMs);
  private readonly messageBudget = new RateLimiter(MESSAGE_LIMIT.limit, MESSAGE_LIMIT.windowMs);
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
    this.resolveDemoMap = options.resolveDemoMap ?? normalizeDemoMapName;
    this.botServerUrl = options.botServerUrl ?? BOT_SERVER_URL;
    this.botSeats = options.botSeats ?? null;
    this.ownsAccounts = !options.players;
    this.accounts = options.players ?? new PlayerStore(":memory:", options.reservePlayerName);
    this.ownsSettings = !options.settings;
    this.settings = options.settings ?? new SettingsStore(":memory:");
    this.ownsCampaign = !options.campaign;
    this.campaign = options.campaign ?? new CampaignStore(":memory:");
    this.ownsFairPlay = !options.fairPlay;
    this.fairPlay = options.fairPlay ?? new FairPlayStore(":memory:");
    this.appealContact = options.appealContact ?? DEFAULT_APPEAL_CONTACT;
    this.admin = options.adminFile
      ? new AdminPanel({
          file: options.adminFile,
          fairPlay: this.fairPlay,
          accounts: this.accounts,
          onSanction: () => this.enforceBans(),
        })
      : null;
    this.results = options.results;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    if (this.results) this.spawner.setResultDelivery(this.results.deliveries);

    // Handle game server exits
    this.spawner.onServerExit = (matchId, code) => {
      this.handleServerExit(matchId, code);
    };
    this.spawner.onServerResult = (result) => this.handleServerResult(result);
    this.spawner.onFairPlayReport = (report) => {
      try {
        this.fairPlay.recordMatch(report);
      } catch (error) {
        console.error(`[LobbyServer] Could not keep the fair-play report of ${report.matchId}:`, error);
      }
    };
    this.spawner.onServerResultRejected = (matchId) =>
      this.noteResult({ matchId, status: "rejected", reason: "verification_failed" });
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    this.demoScanStopped = false;
    this._loadMapsConfig();
    this.loadCampaign();
    this.results?.deliveries.loseBotControl();
    this.retryResults();
    return new Promise((resolve, reject) => {
      // Lobby commands are small JSON messages, including bot control. Bound
      // incoming frames before ws allocates its default 100 MiB payload.
      // Plain HTTP is the admin panel (when configured) and otherwise refused
      // as the bare WebSocket server refused it.
      this.http = createServer((req, res) => {
        if (this.admin?.handle(req, res)) return;
        res.writeHead(426, { "Content-Type": "text/plain" });
        res.end("Upgrade Required");
      });
      this.wss = new WebSocketServer({ server: this.http, maxPayload: 64 * 1024 });

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
        background(this._scanDemos(), "LobbyServer");
        this._demoCacheTimer = setInterval(
          () => background(this._scanDemos(), "LobbyServer"),
          this.DEMO_CACHE_INTERVAL,
        );
        if (this.admin?.enabled) console.log(`[LobbyServer] Admin panel: http://localhost:${this.port}/admin`);
        if (this.results) this.resultRetryTimer = setInterval(() => this.retryResults(), 5_000);
        this.fairPlayPruneTimer = setInterval(() => this.fairPlay.prune(), FAIR_PLAY_PRUNE_INTERVAL_MS);
        this.fairPlayPruneTimer.unref?.();
        this.sanctionCheckTimer = setInterval(() => this.enforceBans(), SANCTION_CHECK_INTERVAL_MS);
        this.sanctionCheckTimer.unref?.();
        this.aiInviteTimer = setInterval(() => this.tickAiInvites(), 1_000);
        this.aiInviteTimer.unref?.();

        resolve();
      });
      this.http.listen(this.port, "0.0.0.0");
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
    if (this.fairPlayPruneTimer) {
      clearInterval(this.fairPlayPruneTimer);
      this.fairPlayPruneTimer = null;
    }
    if (this.sanctionCheckTimer) {
      clearInterval(this.sanctionCheckTimer);
      this.sanctionCheckTimer = null;
    }
    if (this.aiInviteTimer) {
      clearInterval(this.aiInviteTimer);
      this.aiInviteTimer = null;
    }
    // A scan still reading uses the stores closed below: it ends at its next file
    this.demoScanStopped = true;
    await this._demoScan;

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
    this.practiceServers.clear();

    if (this.ownsAccounts) this.accounts.close();
    if (this.ownsSettings) this.settings.close();
    if (this.ownsCampaign) this.campaign.close();
    if (this.ownsFairPlay) this.fairPlay.close();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        const http = this.http;
        this.http = null;
        const stopped = () => {
          console.log("[LobbyServer] Stopped");
          resolve();
        };
        if (!http) return stopped();
        http.closeAllConnections();
        http.close(stopped);
      });
    });
  }

  // ── Connection Handling ──────────────────────────────────────

  private handleConnection(ws: WebSocket, address: string = "unknown"): void {
    // One address holding many sockets open is a flood, not a household
    if (!isLoopbackAddress(address)) {
      let open = 0;
      for (const other of this.players.values()) if (other.address === address) open++;
      if (open >= MAX_CONNECTIONS_PER_ADDRESS) {
        log.warnRateLimited("LobbyServer:connections", `Refused a connection: ${open} already open from one address`);
        ws.close(TRY_AGAIN_LATER_CODE, "Too many connections");
        return;
      }
    }
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
    // A connection that never logs in is closed rather than held
    const loginDeadline = setTimeout(() => {
      if (!player.authenticated) ws.close(FLOOD_CLOSE_CODE, "Not logged in");
    }, LOGIN_DEADLINE_MS);
    loginDeadline.unref?.();

    ws.on("message", (data) => {
      if (!player.isBot && !this.messageBudget.tryRecord(player.id)) {
        log.warnRateLimited(
          "LobbyServer:flood",
          `Closed ${playerId}: more than ${MESSAGE_LIMIT.limit} messages in ${MESSAGE_LIMIT.windowMs / 1000} s`,
        );
        ws.close(FLOOD_CLOSE_CODE, "Too many messages");
        return;
      }
      let msg: LobbyMessage;
      try {
        msg = JSON.parse(data.toString()) as LobbyMessage;
      } catch {
        log.warnRateLimited("LobbyServer:frames", `Unreadable message from ${playerId}`);
        return;
      }
      if (typeof msg !== "object" || msg === null) {
        log.warnRateLimited("LobbyServer:frames", `Message that is not an object from ${playerId}`);
        return;
      }
      try {
        this.handleMessage(player, msg);
      } catch (err) {
        log.errorRateLimited("LobbyServer", `Handling ${String(msg.type).slice(0, 64)} from ${playerId} failed:`, err);
      }
    });

    ws.on("close", () => {
      clearTimeout(loginDeadline);
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
    this.chatLines.forget(player.id);
    this.messageBudget.forget(player.id);

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
      case "identity:delete":
        this.handleIdentityDelete(player, msg.key, msg.confirmed);
        break;
      case "settings:get":
      case "settings:save":
        this.handleSettings(player, msg);
        break;
      case "campaign:get":
        this.sendCampaignState(player);
        break;
      case "chat:send":
        this.handleChatSend(player, (msg as ChatSendMessage).text);
        break;
      case "lobby:chat_send": {
        const chat = msg as RoomChatSendMessage;
        this.handleRoomChatSend(player, chat.lobbyId, chat.text);
        break;
      }
      case "lobby:create": {
        const create = msg as LobbyCreateMessage;
        if (create.campaign !== undefined) this.handleCampaignCreate(player, create.campaign);
        else this.handleLobbyCreate(player, create.gametype, create.visibility);
        break;
      }
      case "lobby:join": {
        const join = msg as LobbyJoinMessage;
        this.handleLobbyJoin(player, join.lobbyId, join.inviteToken);
        break;
      }
      case "lobby:leave":
        this.handleLobbyLeave(player, (msg as LobbyLeaveMessage).lobbyId);
        break;
      case "lobby:vote_map": {
        const vote = msg as LobbyVoteMapMessage;
        this.handleLobbyVoteMap(player, vote.lobbyId, vote.map);
        break;
      }
      case "lobby:ready": {
        const ready = msg as LobbyReadyMessage;
        this.handleLobbyReady(player, ready.lobbyId, ready.ready);
        break;
      }
      case "lobby:switch_team":
        this.handleLobbySwitchTeam(player, (msg as LobbySwitchTeamMessage).lobbyId);
        break;
      case "lobby:vote_shuffle":
        this.handleLobbyVoteShuffle(player, (msg as LobbyVoteShuffleMessage).lobbyId);
        break;
      case "lobby:invite_bot": {
        const invite = msg as LobbyInviteBotMessage;
        background(this.handleLobbyInviteBot(player, invite.lobbyId, invite.difficulty), "LobbyServer");
        break;
      }
      case "queue:join":
        this.handleQueueJoin(player, (msg as QueueJoinMessage).gametype);
        break;
      case "queue:leave":
        // queue:leave with immediate-lobby = leave current lobby
        if (player.lobbyId) {
          this.handleLobbyLeave(player, player.lobbyId);
        }
        this.send(player, { type: "queue:left" });
        break;
      case "demos:list": {
        const list = msg as DemosListRequest;
        this.handleDemosList(player, list.limit ?? 64, list.scope, list.requestId);
        break;
      }
      case "featured:get":
        this.handleFeaturedGet(player, msg as FeaturedDemosRequest);
        break;
      case "campaign:board:get":
        this.handleCampaignBoardGet(player, msg as CampaignBoardRequest);
        break;
      case "report:player":
        this.handlePlayerReport(player, msg as PlayerReportRequest);
        break;
      case "leaderboard:get":
        this.handleLeaderboardGet(player, msg as LeaderboardRequest);
        break;
      case "stats:get":
      case "stats:history":
        this.handlePlayerStats(player, msg as PlayerStatsRequest);
        break;
      case "match:seat_reissue": {
        const reissue = msg as SeatReissueRequest;
        this.handleSeatReissue(player, reissue.requestId, reissue.matchId);
        break;
      }
      case "dev:spawn_server": {
        const spawn = msg as DevSpawnServerMessage;
        this.handleDevSpawnServer(player, spawn.requestId, spawn.map, spawn.gametype, spawn.trainingDemo).catch(
          logRejection("LobbyServer"),
        );
        break;
      }
      default:
        // The type is whatever the client sent; a client sending junk gets one line per 5 s.
        log.warnRateLimited("LobbyServer:frames", `Unknown message type: ${String(msg.type).slice(0, 64)}`);
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
      player.name = filterPlayerName(msg.name || `Bot${player.id.slice(2)}`);
      this.completeAuth(player, {});
      return;
    }

    // A hosted build stores a token in place of the key; never log either
    const hosted = typeof msg.hosted === "string" && HOST_LABEL.test(msg.hosted) ? msg.hosted : null;
    if (typeof msg.token === "string") {
      this.authWithToken(player, msg.token, hosted);
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
      if (this.refuseWhenBanned(player, account.id)) return;
      if (this.refuseWhenFull(player, account.id)) return;
      player.accountId = account.id;
      player.name = account.name;
      this.completeAuth(player, hosted ? { token: this.accounts.startTokens(account.id, hosted) } : {});
      return;
    }

    if (this.refuseWhenBanned(player, null)) return;
    if (this.refuseWhenFull(player, null)) return;
    if (!this.accountCreations.tryRecord(player.address)) {
      this.send(player, { type: "auth:error", code: "rate_limited" });
      return;
    }
    const { account, key } = this.accounts.create();
    console.log(`[LobbyServer] New account ${account.id}: ${account.name}`);
    player.accountId = account.id;
    player.name = account.name;
    this.completeAuth(player, { key, ...(hosted ? { token: this.accounts.startTokens(account.id, hosted) } : {}) });
  }

  /**
   * Log in with a hosted build's token, and hand back the next one. A token
   * replaced longer ago than the grace period was copied: its chain ends, and
   * both copies need the key again.
   */
  private authWithToken(player: ConnectedPlayer, token: string, hosted: string | null): void {
    if (this.keyFailures.isBlocked(player.address)) {
      this.send(player, { type: "auth:error", code: "rate_limited" });
      return;
    }
    const found = hosted ? this.accounts.findToken(token, hosted) : null;
    if (!found) {
      this.keyFailures.record(player.address);
      this.send(player, { type: "auth:error", code: "unknown_token" });
      return;
    }
    if (found.state === "reused") {
      console.log(`[LobbyServer] A replaced login token came back for account ${found.account.id}: chain ended`);
      this.accounts.endTokenChain(token);
      this.send(player, { type: "auth:error", code: "token_reused" });
      return;
    }
    if (this.refuseWhenBanned(player, found.account.id)) return;
    if (this.refuseWhenFull(player, found.account.id)) return;
    player.accountId = found.account.id;
    player.name = found.account.name;
    this.completeAuth(player, { token: this.accounts.rotateToken(token) });
  }

  /** A bot service connection says which bot preset it plays; a change mid-match marks the result. */
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

  /**
   * A banned account, or any login from a banned address: answer `banned` with
   * the reason, the end and how to appeal, and close the connection.
   */
  private refuseWhenBanned(player: ConnectedPlayer, accountId: number | null): boolean {
    let ban: { reason: string; expiresAt: number | null } | null = null;
    try {
      ban =
        (accountId === null ? null : this.fairPlay.activeBan(accountId)) ?? this.fairPlay.addressBan(player.address);
    } catch (error) {
      // A fair-play store that cannot be read must not keep everyone out
      log.warnRateLimited("LobbyServer:fairplay", "Could not read bans:", error);
    }
    if (!ban) return false;
    console.log(`[LobbyServer] Refused a banned login${accountId === null ? "" : ` (account ${accountId})`}`);
    this.send(player, {
      type: "auth:error",
      code: "banned",
      reason: ban.reason,
      ...(ban.expiresAt === null ? {} : { until: ban.expiresAt }),
      appeal: this.appealContact,
    });
    player.ws.close(BANNED_CLOSE_CODE, "Banned");
    return true;
  }

  /** Close the connections of accounts banned since they logged in (the fair-play CLI writes bans). */
  private enforceBans(): void {
    let banned: Set<number>;
    try {
      banned = this.fairPlay.bannedAccountIds();
    } catch (error) {
      log.warnRateLimited("LobbyServer:fairplay", "Could not read bans:", error);
      return;
    }
    if (!banned.size) return;
    for (const player of [...this.players.values()]) {
      if (player.isBot || player.accountId === null || !banned.has(player.accountId)) continue;
      const ban = this.fairPlay.activeBan(player.accountId);
      console.log(`[LobbyServer] Closing banned account ${player.accountId}`);
      this.send(player, {
        type: "auth:error",
        code: "banned",
        reason: ban?.reason,
        ...(ban?.expiresAt ? { until: ban.expiresAt } : {}),
        appeal: this.appealContact,
      });
      player.ws.close(BANNED_CLOSE_CODE, "Banned");
    }
  }

  /**
   * Why this player may not play public (rated) rooms or the queue, or null.
   * Private rooms and practice stay open to a ranked restriction.
   */
  private publicPlayRefusal(player: ConnectedPlayer): string | null {
    if (player.isBot || player.accountId === null) return null;
    let sanction: { reason: string; expiresAt: number | null } | null = null;
    try {
      sanction = this.fairPlay.rankedRestriction(player.accountId);
    } catch (error) {
      log.warnRateLimited("LobbyServer:fairplay", "Could not read sanctions:", error);
    }
    if (!sanction) return null;
    const until =
      sanction.expiresAt === null
        ? "until it is lifted"
        : `until ${new Date(sanction.expiresAt).toISOString().slice(0, 10)}`;
    return `You can't play public rooms ${until}. Reason: ${sanction.reason}. Private rooms still work. To appeal, ${this.appealContact}.`;
  }

  /** Keep a player's report about another for review. */
  private handlePlayerReport(player: ConnectedPlayer, msg: PlayerReportRequest): void {
    const requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 64) : "";
    const answer = (ok: boolean, code?: "invalid" | "unknown_player" | "rate_limited" | "duplicate" | "unavailable") =>
      this.send(player, { type: "report:result", requestId, ok, ...(code ? { code } : {}) });
    if (player.isBot || player.accountId === null) {
      answer(false, "invalid");
      return;
    }
    let reported: number | null = null;
    if (typeof msg.playerId === "string") reported = this.players.get(msg.playerId)?.accountId ?? null;
    else if (typeof msg.accountId === "number" && this.accounts.exists(msg.accountId)) reported = msg.accountId;
    if (reported === null) {
      answer(false, "unknown_player");
      return;
    }
    const matchId = typeof msg.matchId === "string" && msg.matchId ? msg.matchId : null;
    try {
      const result = this.fairPlay.addReport(player.accountId, reported, matchId, msg.reason);
      if (!result.ok) {
        answer(false, result.code);
        return;
      }
      console.log(`[LobbyServer] Report ${result.id}: account ${player.accountId} reported account ${reported}`);
      answer(true);
    } catch (error) {
      log.warnRateLimited("LobbyServer:fairplay", "Could not keep a report:", error);
      answer(false, "unavailable");
    }
  }

  /** Logged in: send the welcome, and tell everyone else. */
  private completeAuth(player: ConnectedPlayer, extra: { key?: string; token?: string }): void {
    player.authenticated = true;
    const who = player.isBot ? "bot" : `account ${player.accountId}`;
    console.log(`[LobbyServer] Authenticated: ${player.name} (${player.id}, ${who})`);

    this.send(player, {
      type: "welcome",
      features: {
        privateLobbies: true,
        leaderboard: !!this.results,
        skillRatings: !!this.results,
        playerStats: !!this.results,
        featuredDemos: true,
        demoOwnership: !!this.results,
        syncedSettings: true,
        campaign: this.campaignCatalog.missions.length > 0,
      },
      playerId: player.id,
      identity: player.accountId === null ? undefined : { id: String(player.accountId), name: player.name },
      key: extra.key,
      token: extra.token,
      gametypes: this.gametypes,
      onlinePlayers: this.getOnlinePlayers(),
      maxPlayers: this.maxPlayers,
      chatHistory: this.chatHistory,
      liveMatches: this.getLiveMatches(),
      recentDemos: this.listedDemos().slice(0, 10),
    });
    this.sendCampaignState(player);

    this.broadcast(
      {
        type: "player:join",
        player: { id: player.id, name: player.name, status: player.status },
      },
      player.id,
    );
  }

  // ── Identity ─────────────────────────────────────────────────

  /** Read or replace the synced settings of the account this connection logged in to; bots have none. */
  private handleSettings(player: ConnectedPlayer, msg: LobbyMessage): void {
    const accountId = player.accountId;
    if (accountId === null || player.isBot) return;
    const requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 64) : "";
    const fail = (code: SettingsErrorCode) => this.send(player, { type: "settings:error", requestId, code });
    if (!this.settingsRequests.tryRecord(String(accountId))) {
      fail("rate_limited");
      return;
    }
    try {
      if (msg.type === "settings:get") {
        const stored = this.settings.get(accountId);
        this.send(player, {
          type: "settings:data",
          requestId,
          settings: stored?.settings ?? null,
          updatedAt: stored?.updatedAt ?? null,
        });
        return;
      }
      const result = this.settings.save(accountId, msg.settings);
      if (result.ok) this.send(player, { type: "settings:saved", requestId, updatedAt: result.updatedAt });
      else fail(result.code);
    } catch (e) {
      console.warn(`[LobbyServer] Settings ${msg.type} failed for account ${accountId}:`, e);
      fail("unavailable");
    }
  }

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

  /**
   * Delete the account, once the player has ticked that they understand and
   * pasted its whole key again. Its name becomes DELETED_ACCOUNT_NAME on the
   * leaderboards and in the demo list, its settings go, and every connection
   * logged in to it is told and closed.
   */
  private handleIdentityDelete(player: ConnectedPlayer, key: unknown, confirmed: unknown): void {
    const accountId = player.accountId;
    if (accountId === null) return;
    if (confirmed !== true) {
      this.send(player, { type: "identity:error", code: "not_confirmed" });
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
    if (typeof key !== "string" || !this.accounts.deleteAccount(accountId, key)) {
      this.send(player, { type: "identity:error", code: "wrong_key" });
      return;
    }
    console.log(`[LobbyServer] Account ${accountId} deleted`);
    this.settings.delete(accountId);
    this.campaign.delete(accountId);
    this.fairPlay.deleteAccount(accountId);
    this.renameDeletedInDemos(new Set([accountId]));

    for (const other of [...this.players.values()]) {
      if (other.accountId !== accountId) continue;
      this.send(other, { type: "identity:deleted" });
      other.ws.close(1000, "Account deleted");
    }
  }

  // ── Chat ─────────────────────────────────────────────────────

  private handleChatSend(player: ConnectedPlayer, text: unknown): void {
    if (typeof text !== "string" || text.trim().length === 0) return;
    if (!this.chatAllowed(player)) return;

    const chatMsg: ChatMsg = {
      from: player.name,
      fromId: player.id,
      text: filterChatText(text.trim(), 500),
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
  }

  /** Whether a chat line from this connection is within its budget; a line over it is dropped and the sender told. */
  private chatAllowed(player: ConnectedPlayer): boolean {
    if (player.isBot || this.chatLines.tryRecord(player.id)) return true;
    this.send(player, { type: "lobby:error", error: "You are sending messages too fast." });
    return false;
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
    if (!this.chatAllowed(player)) return;

    const message: ChatMsg = { from: player.name, fromId: player.id, text: filterChatText(clean, 500), ts: Date.now() };
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
      this.send(player, { type: "lobby:error", error: "You're already in a room. Leave it first." });
      return;
    }

    const gametype = this.gametypes.find((g) => g.id === gametypeId);
    if (!gametype) {
      this.send(player, { type: "lobby:error", error: `Unknown gametype: ${String(gametypeId).slice(0, 32)}` });
      return;
    }
    if (visibility !== "public" && visibility !== "private") {
      this.send(player, { type: "lobby:error", error: "Invalid room visibility." });
      return;
    }
    const restricted = visibility === "public" ? this.publicPlayRefusal(player) : null;
    if (restricted) {
      this.send(player, { type: "lobby:error", error: restricted });
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
      this.send(player, { type: "lobby:error", error: "You're already in a room. Leave it first." });
      return;
    }

    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || (lobby.visibility === "private" && inviteToken !== lobby.inviteToken)) {
      this.send(player, { type: "lobby:error", error: "That room is gone, or the invite link is wrong." });
      return;
    }
    const restricted = lobby.visibility === "public" ? this.publicPlayRefusal(player) : null;
    if (restricted) {
      this.send(player, { type: "lobby:error", error: restricted });
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
      this.send(player, { type: "lobby:error", error: "That room is full." });
      return;
    }
    const campaignRefusal = this.campaignJoinRefusal(lobby, player);
    if (campaignRefusal) {
      this.send(player, { type: "lobby:error", error: campaignRefusal });
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
    // A campaign match is played by the people it started with, never joined midway
    if (player.isBot || accountId === null || !player.authenticated || !matchId || !lobby.serverUrl || lobby.campaign) {
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

    // A campaign room starts only with all its mission's bots: one that left
    // while it waits is invited again, or the room would wait for ever
    if (player.isBot && lobby.campaign && lobby.state === "waiting" && !lobby.isStarting && lobby.players.size > 0) {
      background(this.fillCampaignBots(lobby), "LobbyServer");
    }

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
    if (!lobby?.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;
    if (lobby.campaign) return;

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

  private handleLobbyReady(player: ConnectedPlayer, lobbyId: string, value: unknown): void {
    // Only a real true readies: anything else a client sends is "not ready", never relayed as sent
    const ready = value === true;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby?.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;

    lobby.setReady(player.id, ready);

    // Broadcast player state
    this.broadcastToLobby(lobbyId, {
      type: "lobby:player_updated",
      playerId: player.id,
      ready,
    });

    // Check if all ready; a campaign room also waits for its mission's bots
    if (lobby.isAllReady() && lobby.missingCampaignBots((id) => this.players.get(id)?.isBot === true).length === 0) {
      background(this.handleAllReady(lobby), "LobbyServer");
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
    if (!lobby?.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;
    // A mission's sides are part of the mission
    if (lobby.campaign) return;
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
    if (!lobby?.players.has(player.id) || lobby.state !== "waiting" || lobby.isStarting) return;
    if (lobby.campaign) return;

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
    if (!lobby?.players.has(player.id)) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "You are not in this lobby." });
      return;
    }

    if (lobby.state !== "waiting" || lobby.isStarting) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "Match is already starting." });
      return;
    }

    if (lobby.campaign) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "The mission brings its own bots." });
      return;
    }

    if (lobby.playerCount >= lobby.gametype.maxPlayers) {
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error: "That room is full." });
      return;
    }

    const preset = BOT_PRESETS.includes(difficulty as BotPreset)
      ? (difficulty as BotPreset)
      : this.matchedBotPreset(player.accountId, lobby);
    try {
      const name = await this.requestBotForLobby(lobby, preset);
      console.log(`[LobbyServer] Bot "${name}" (${preset}) invited into lobby ${lobbyId} by ${player.name}`);
      // The bot will appear via lobby:player_joined; this is just requester feedback.
      this.send(player, { type: "lobby:bot_invited", lobbyId, name, difficulty: preset });
    } catch (err) {
      const error = (err as Error).message;
      console.warn(`[LobbyServer] Bot invite failed for lobby ${lobbyId}: ${error}`);
      this.send(player, { type: "lobby:bot_invite_failed", lobbyId, error });
    }
  }

  /** Automatic opponents have a Hard floor; the player's rating can promote them to Insane. */
  private matchedBotPreset(accountId: number | null, lobby: MatchLobby): BotPreset {
    return this.results?.botPresetFor(accountId, lobby.gametype.id) === "insane" ? "insane" : "hard";
  }

  // ── Lobby: AI players for a public room no one else joins ────

  /**
   * Runs every second. A public room with a person in it looks for people for
   * AI_INVITE_AFTER_MS, then invites an AI player, and another every
   * AI_INVITE_SPACING_MS while seats are open, so a person can still take one.
   * The room tells its members when the next invite is due.
   */
  private tickAiInvites(now = Date.now()): void {
    for (const lobby of this.lobbies.values()) {
      const looking =
        lobby.visibility === "public" &&
        !lobby.campaign &&
        lobby.state === "waiting" &&
        !lobby.isStarting &&
        [...lobby.players.keys()].some((id) => this.players.get(id)?.isBot === false);
      if (!looking) {
        if (lobby.aiInviteAt !== null) this.setAiInviteAt(lobby, null);
        continue;
      }
      if (lobby.aiInviteAt === null) {
        this.setAiInviteAt(lobby, now + AI_INVITE_AFTER_MS);
        continue;
      }
      if (now < lobby.aiInviteAt || lobby.playerCount >= lobby.gametype.maxPlayers) continue;
      // An invite on its way, by hand or by the room, may take the last seat
      if (this.pendingBotInvites.has(lobby.id)) continue;
      this.setAiInviteAt(lobby, now + AI_INVITE_SPACING_MS);
      background(this.inviteAiPlayer(lobby), "LobbyServer");
    }
  }

  private setAiInviteAt(lobby: MatchLobby, at: number | null): void {
    lobby.aiInviteAt = at;
    this.broadcastToLobby(lobby.id, {
      type: "lobby:ai_invite",
      lobbyId: lobby.id,
      inMs: at === null ? null : Math.max(0, at - Date.now()),
    });
  }

  /** One AI player for a room that waited, matched to the first person in it. */
  private async inviteAiPlayer(lobby: MatchLobby): Promise<void> {
    const person = [...lobby.players.keys()].map((id) => this.players.get(id)).find((p) => p && !p.isBot);
    const preset = this.matchedBotPreset(person?.accountId ?? null, lobby);
    try {
      const name = await this.requestBotForLobby(lobby, preset);
      console.log(`[LobbyServer] AI player "${name}" (${preset}) joined waiting lobby ${lobby.id}`);
    } catch (err) {
      console.warn(`[LobbyServer] AI invite failed for lobby ${lobby.id}: ${(err as Error).message}`);
      if (lobby.aiInviteAt !== null && this.lobbies.get(lobby.id) === lobby)
        this.setAiInviteAt(lobby, Date.now() + AI_INVITE_RETRY_MS);
    }
  }

  /**
   * Open a short-lived control connection to the Bot Intelligence Server and
   * ask it to spawn a lobby bot that joins `lobby` by id. Resolves with the
   * bot's name once the BIS acknowledges, or rejects on timeout/error.
   */
  private requestBotForLobby(lobby: MatchLobby, difficulty: BotPreset, name?: string): Promise<string> {
    if (this.botSeats) return this.seatBot(this.botSeats, lobby, difficulty, name);
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
            options: name ? { difficulty, name } : { difficulty },
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

  /**
   * Seat a bot through this process's seats: its lobby client connects over a
   * LocalSocket and joins the room as a bot from the bot server would. The
   * invite is cancelled like one to the bot server, and times out after
   * BOT_INVITE_PREPARATION_TIMEOUT_MS.
   */
  private async seatBot(
    seats: LobbyBotSeats,
    lobby: MatchLobby,
    difficulty: BotPreset,
    name?: string,
  ): Promise<string> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const pending = this.pendingBotInvites.get(lobby.id) ?? new Set<() => void>();
    pending.add(cancel);
    this.pendingBotInvites.set(lobby.id, pending);
    const timer = setTimeout(cancel, BOT_INVITE_PREPARATION_TIMEOUT_MS);
    try {
      return await seats.seat({
        lobbyId: lobby.id,
        ...(lobby.inviteToken ? { inviteToken: lobby.inviteToken } : {}),
        gametype: lobby.gametype.id,
        difficulty,
        ...(name ? { name } : {}),
        connect: () => {
          const { client, server } = LocalSocket.pair();
          this.handleConnection(server as unknown as WebSocket, "127.0.0.1");
          return client;
        },
        signal: abort.signal,
      });
    } catch (error) {
      throw abort.signal.aborted ? new Error("Bot invite cancelled: the lobby closed, started or timed out.") : error;
    } finally {
      clearTimeout(timer);
      const left = this.pendingBotInvites.get(lobby.id);
      left?.delete(cancel);
      if (left?.size === 0) this.pendingBotInvites.delete(lobby.id);
    }
  }

  private cancelBotInvites(lobbyId: string): void {
    for (const cancel of this.pendingBotInvites.get(lobbyId) ?? []) cancel();
    this.pendingBotInvites.delete(lobbyId);
  }

  // ── Campaign ────────────────────────────────────────────────

  /** Whether `name` is one of the campaign's bots, which no account may be named. */
  isCampaignBotName(name: string): boolean {
    return this.campaignBots.has(name.toLowerCase());
  }

  /** Read config/campaign.json; a lobby without one, or with a broken one, runs no campaign. */
  private loadCampaign(): void {
    this.campaignCatalog = EMPTY_CAMPAIGN;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.CAMPAIGN_CONFIG_PATH, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn(`[LobbyServer] Campaign not loaded: ${(err as Error).message}`);
      return;
    }
    this.campaignBots = campaignBotNames(raw);
    try {
      const shapes = new Map(
        [...this.gametypes, ...this.campaignGametypes].map((g) => [
          g.id,
          { maxPlayers: g.maxPlayers, hasTeams: g.hasTeams },
        ]),
      );
      const catalog = parseCampaign(raw, shapes, (map) => this.mapNames[map] ?? map);
      const missing = catalog.missions.filter((m) => !this.gametypes.some((g) => g.mapPool.includes(m.map)));
      if (missing.length)
        console.warn(`[LobbyServer] Campaign maps not installed: ${missing.map((m) => m.map).join(", ")}`);
      this.campaignCatalog = catalog;
      console.log(`[LobbyServer] Campaign: ${catalog.missions.length} of ${catalog.length} missions`);
    } catch (err) {
      console.warn(`[LobbyServer] Campaign not loaded: ${(err as Error).message}`);
    }
  }

  private campaignState(accountId: number): CampaignStateMessage {
    const clears = this.campaign.clears(accountId);
    const completedAt = this.campaign.completedAt(accountId);
    return {
      type: "campaign:state",
      length: this.campaignCatalog.length,
      missions: this.campaignCatalog.missions,
      clears,
      unlockedThrough: unlockedThrough(this.campaignCatalog, clears),
      ...(completedAt === null ? {} : { completedAt }),
    };
  }

  /** This account's campaign; nothing for bots, or a lobby without a campaign. */
  private sendCampaignState(player: ConnectedPlayer): void {
    if (player.accountId === null || player.isBot || this.campaignCatalog.missions.length === 0) return;
    this.send(player, this.campaignState(player.accountId));
  }

  /** Why `player` cannot take a seat in a campaign room, or null if they can. */
  private campaignJoinRefusal(lobby: MatchLobby, player: ConnectedPlayer): string | null {
    const mission = lobby.campaign;
    if (!mission) return null;
    if (player.isBot) return lobby.campaignBot(player.name) ? null : "That room is playing a campaign mission.";
    if (player.accountId === null) return "Log in to play the campaign.";
    // Every human in the room must have unlocked the mission: the room plays the lowest of theirs
    const members = [...lobby.players.values()]
      .map((lp) => this.players.get(lp.id))
      .filter((p): p is ConnectedPlayer => p !== undefined && !p.isBot && p.accountId !== null);
    const through = roomUnlockedThrough(
      [...members, player].map((p) => unlockedThrough(this.campaignCatalog, this.campaign.clears(p.accountId!))),
    );
    if (through < mission.number) return `Mission ${mission.number} is not unlocked for you yet.`;
    // The mission's bots keep their seats; a human needs one besides them
    const humans = members.length + 1;
    if (humans + mission.bots.length > lobby.gametype.maxPlayers) return "That mission has no seat for another player.";
    return null;
  }

  /** A private room for a campaign mission, which the lobby fills with the mission's bots. */
  private handleCampaignCreate(player: ConnectedPlayer, missionId: unknown): void {
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "You're already in a room. Leave it first." });
      return;
    }
    const mission = campaignMission(this.campaignCatalog, missionId);
    const gametype = mission && this.campaignGametype(mission.gametype);
    if (!mission || !gametype) {
      this.send(player, { type: "lobby:error", error: "That mission is not available." });
      return;
    }
    if (!gametype.mapPool.includes(mission.map)) {
      this.send(player, { type: "lobby:error", error: `This server does not have ${mission.mapTitle}.` });
      return;
    }
    const lobby = new MatchLobby(gametype, this.mapNames, "private", mission);
    const refusal = this.campaignJoinRefusal(lobby, player);
    if (refusal) {
      this.send(player, { type: "lobby:error", error: refusal });
      return;
    }
    this.lobbies.set(lobby.id, lobby);
    lobby.addPlayer(player);
    player.lobbyId = lobby.id;
    player.status = "in_lobby";
    console.log(`[LobbyServer] Campaign room ${lobby.id}: mission ${mission.number} (${mission.id}) by ${player.name}`);
    this.send(player, { type: "lobby:created", lobby: lobby.toInfo() });
    this.broadcast({ type: "player:status", playerId: player.id, status: "in_lobby" }, player.id);
    this.broadcastMatchesUpdate();
    background(this.fillCampaignBots(lobby), "LobbyServer");
  }

  /**
   * Invite the mission's bots one at a time, until each is seated or the room
   * closes or starts. One pass runs per room: asked again meanwhile, it makes
   * another when done, so no bot is invited twice at once.
   */
  private async fillCampaignBots(lobby: MatchLobby): Promise<void> {
    if (this.campaignFills.has(lobby.id)) {
      this.campaignFills.set(lobby.id, true);
      return;
    }
    const isBot = (id: string) => this.players.get(id)?.isBot === true;
    try {
      do {
        this.campaignFills.set(lobby.id, false);
        for (const bot of lobby.missingCampaignBots(isBot)) {
          if (this.lobbies.get(lobby.id) !== lobby || lobby.state !== "waiting" || lobby.isStarting) return;
          if (!lobby.missingCampaignBots(isBot).includes(bot)) continue;
          try {
            await this.requestBotForLobby(lobby, bot.difficulty as BotPreset, bot.name);
          } catch (err) {
            if (this.lobbies.get(lobby.id) !== lobby) return;
            console.warn(`[LobbyServer] Campaign bot ${bot.name} for ${lobby.id}: ${(err as Error).message}`);
            this.broadcastToLobby(lobby.id, {
              type: "lobby:error",
              error: "The mission's opponents could not be brought in. Leave and try again.",
            });
            return;
          }
        }
      } while (this.campaignFills.get(lobby.id));
    } finally {
      this.campaignFills.delete(lobby.id);
    }
  }

  /**
   * A verified result of a campaign match clears the mission for every human
   * in it when a human won: players of a mission win or lose together.
   */
  private recordCampaignResult(report: MatchResultReport): void {
    const mission = this.campaignMatches.get(report.matchId);
    if (!mission || report.details.completion === "aborted") return;
    const humans = report.participants.filter((p) => p.accountId !== null);
    if (!humans.some((p) => p.outcome === "win")) return;
    const timeMs = report.endedAt - report.details.startedAt;
    const seats = new Map(report.details.seats.map((seat) => [seat.tokenHash, seat]));
    for (const human of humans) {
      const accountId = human.accountId!;
      try {
        const frags = seats.get(human.tokenHash)?.stats?.frags ?? 0;
        this.campaign.recordClear(accountId, mission.id, timeMs, frags);
        console.log(`[LobbyServer] Campaign: account ${accountId} cleared mission ${mission.number} (${mission.id})`);
        if (campaignFinished(this.campaignCatalog, this.campaign.clears(accountId))) {
          this.campaign.markCompleted(accountId);
        }
      } catch (err) {
        console.warn(`[LobbyServer] Campaign clear for account ${accountId} not stored: ${(err as Error).message}`);
        continue;
      }
      for (const connection of this.players.values()) {
        if (connection.accountId === accountId) this.sendCampaignState(connection);
      }
    }
  }

  // ── Matchmaking Queue ───────────────────────────────────────

  private handleQueueJoin(player: ConnectedPlayer, gametypeId: string): void {
    // Already in queue or lobby?
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "You're already in a room. Leave it first." });
      return;
    }

    const gametype = this.gametypes.find((g) => g.id === gametypeId);
    if (!gametype) {
      this.send(player, { type: "lobby:error", error: `Unknown gametype: ${String(gametypeId).slice(0, 32)}` });
      return;
    }
    const restricted = this.publicPlayRefusal(player);
    if (restricted) {
      this.send(player, { type: "lobby:error", error: restricted });
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

  /**
   * `map <name>`: a game server of the requester's own. From this machine it is
   * a developer server: any map name, any gametype, a training demo. From
   * anywhere else it is a practice server: one of the lobby's maps, for that
   * player alone, one at a time, a few a minute. Neither has admission seats,
   * so neither stores results or touches ratings.
   */
  private async handleDevSpawnServer(
    player: ConnectedPlayer,
    requestId: string,
    mapName: string,
    requestedGametype: string,
    trainingDemo?: string,
  ): Promise<void> {
    // The request id is echoed back: anything but a short id is not
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return;
    const refuse = (error: string) => this.send(player, { type: "dev:server_spawn_failed", requestId, error });
    const practice = !isLoopbackAddress(player.address);

    const map = String(mapName || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(map)) {
      refuse(`Invalid map name: ${String(mapName).slice(0, 64)}`);
      return;
    }

    // The name becomes part of a file name and a command-line argument.
    if (trainingDemo !== undefined && (practice || !/^[a-z0-9_-]{1,40}$/i.test(trainingDemo))) {
      refuse(
        practice
          ? "Training demos are recorded from the lobby's own machine only."
          : `Invalid training demo name: ${String(trainingDemo).slice(0, 48)} (letters, digits, _ and -)`,
      );
      return;
    }

    let gametypeId = normalizeGametype(requestedGametype);
    if (!gametypeId) {
      refuse(`Unknown gametype: ${String(requestedGametype).slice(0, 32)}`);
      return;
    }

    if (practice) {
      // A map the lobby offers, in a gametype it is made for
      const offering =
        this.gametypes.find((g) => g.id === gametypeId && g.mapPool.includes(map)) ??
        this.gametypes.find((g) => g.mapPool.includes(map));
      if (!offering) {
        refuse(`No such map: ${map}. Maps: ${[...new Set(this.gametypes.flatMap((g) => g.mapPool))].join(", ")}`);
        return;
      }
      gametypeId = offering.id;
      const own = [...this.practiceServers.values()].some(
        (holder) =>
          holder.address === player.address || (player.accountId !== null && holder.accountId === player.accountId),
      );
      if (own) {
        refuse("You already have a practice server running. Leave it first.");
        return;
      }
      if (!this.practiceSpawns.tryRecord(player.address)) {
        refuse("Too many practice servers started. Try again in a minute.");
        return;
      }
    }

    const gametype =
      this.gametypes.find((g) => g.id === gametypeId) || GAMETYPE_SHELLS.find((g) => g.id === gametypeId);
    const maxClients = practice ? 1 : (gametype?.maxPlayers ?? 2);
    // Held from the request on, so a second request cannot start another
    // while this one is still starting
    const reservation = `pending:${requestId}:${player.id}`;
    if (practice) this.practiceServers.set(reservation, { accountId: player.accountId, address: player.address });

    try {
      console.log(
        `[LobbyServer] ${practice ? "Practice" : "Dev"} spawn requested by ${player.name}: map=${map} gametype=${gametypeId}`,
      );
      const server = await this.spawner.spawn({
        map,
        gametype: gametypeId,
        maxClients,
        shutdown: true,
        ...(trainingDemo ? { trainingDemo } : {}),
      });

      this.devMatchToPlayer.set(server.matchId, player.id);
      if (practice) {
        this.practiceServers.delete(reservation);
        this.practiceServers.set(server.matchId, { accountId: player.accountId, address: player.address });
      }

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
      this.practiceServers.delete(reservation);
      refuse((err as Error).message);
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
        if (!player?.authenticated) throw new Error("A lobby player is no longer connected");
        return {
          lobbyPlayerId: lp.id,
          accountId: player.accountId,
          name: player.name,
          team: lp.team,
          isBot: player.isBot,
          ...(player.botReference === undefined ? {} : { botReference: canonicalBotReference(player.botReference) }),
        };
      });
      // The campaign-only gametypes have no rating pool: their results clear
      // campaign progress and are otherwise not recorded
      const rated = !lobby.campaign || isRatingMode(lobby.campaign.gametype);
      const campaignRules = lobby.campaign ? campaignMatchRules(lobby.campaign) : null;
      const resultContext: ResultContext = {
        ranked: isRankedRoster(lobby.gametype, admissionSeats),
        // A match with AI players is rated as a private one, wherever it was
        // played: the public pool stays people against people
        private: lobby.visibility === "private" || admissionSeats.some((seat) => seat.isBot),
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
        ...(lobby.campaign ? { campaign: lobby.campaign.id } : {}),
        ...(campaignRules ? { campaignRules } : {}),
        ...(rated ? { resultContext } : {}),
      });

      // Track matchId → lobbyId mapping for cleanup
      this.matchToLobby.set(server.matchId, lobby.id);
      // Ranked or not is decided by the roster that starts the match, not by
      // whoever is still connected when it ends.
      resultContext.botReferenceChanged = lobby.botReferenceChanged;
      if (rated) this.matchRecords.set(server.matchId, resultContext);
      if (lobby.campaign) this.campaignMatches.set(server.matchId, lobby.campaign);
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
          ...(lobby.campaign ? { campaign: lobbyCampaignInfo(lobby.campaign) } : {}),
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
        error: "Couldn't start the match server. Try again in a moment.",
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
    this.recordCampaignResult(report);
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

  private handlePlayerStats(player: ConnectedPlayer, msg: PlayerStatsRequest): void {
    const requestId =
      typeof msg.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(msg.requestId) ? msg.requestId : "";
    if (
      !requestId ||
      !isRatingMode(msg.gametype) ||
      (msg.scope !== undefined && !RATING_POOLS.includes(msg.scope)) ||
      (msg.period !== undefined && !["month", "all"].includes(msg.period)) ||
      (msg.limit !== undefined && (!Number.isSafeInteger(msg.limit) || msg.limit < 1 || msg.limit > 50)) ||
      (msg.beforeSequence !== undefined && (!Number.isSafeInteger(msg.beforeSequence) || msg.beforeSequence < 1))
    ) {
      this.send(player, { type: "stats:error", requestId, reason: "invalid_query" });
      return;
    }
    if (!this.results || player.isBot || player.accountId === null) {
      this.send(player, { type: "stats:error", requestId, reason: "unavailable" });
      return;
    }
    if (!this.leaderboardReads.tryRecord(player.id)) {
      this.send(player, { type: "stats:error", requestId, reason: "rate_limited" });
      return;
    }
    try {
      const query = { gametype: msg.gametype, scope: msg.scope ?? ("overall" as const) };
      const data =
        msg.type === "stats:get"
          ? this.results.playerStats.summary(player.accountId, { ...query, period: msg.period ?? "all" })
          : this.results.playerStats.history(player.accountId, query, msg.limit ?? 20, msg.beforeSequence);
      this.send(player, {
        type: msg.type === "stats:get" ? "stats:summary" : "stats:history_page",
        requestId,
        ...query,
        data,
      });
    } catch {
      this.send(player, { type: "stats:error", requestId, reason: "unavailable" });
    }
  }

  private handleLeaderboardGet(player: ConnectedPlayer, msg: LeaderboardRequest): void {
    // Bound both the SQL page and the echo payload; no client chooses the account whose rank is returned.
    const requestId =
      typeof msg.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(msg.requestId) ? msg.requestId : "";
    if (
      !requestId ||
      // "all": each player's best mode, a skill board only
      !(isRatingMode(msg.gametype) || (msg.gametype === "all" && msg.system === "trueskill")) ||
      (msg.period !== "month" && msg.period !== "all") ||
      !Number.isSafeInteger(msg.offset) ||
      msg.offset < 0 ||
      msg.offset > 1000 ||
      !Number.isSafeInteger(msg.limit) ||
      msg.limit < 1 ||
      msg.limit > 100 ||
      (msg.scope !== undefined && !RATING_POOLS.includes(msg.scope)) ||
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
      scope: msg.scope ?? ("overall" as const),
      hidden: [...this.fairPlay.bannedAccountIds()],
    };
    const page = msg.system === "trueskill" ? this.results.skillLeaderboard(query) : this.results.leaderboard(query);
    this.send(player, {
      type: "leaderboard:page",
      requestId,
      gametype: msg.gametype,
      period: msg.period,
      scope: query.scope,
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
        ? this.spawner.reissueSeat(matchId, player.accountId)
        : null;
    if (ticket) this.send(player, { type: "match:seat_reissued", requestId, matchId, ...ticket });
    else this.send(player, { type: "match:seat_reissue_error", requestId, reason: "unavailable" });
  }

  private handleServerExit(matchId: string, code: number | null): void {
    const lobbyId = this.matchToLobby.get(matchId);
    this.matchToLobby.delete(matchId);
    this.matchRecords.delete(matchId);
    this.campaignMatches.delete(matchId);

    console.log(`[LobbyServer] Game server exited: match=${matchId} lobby=${lobbyId} code=${code}`);

    if (!lobbyId) {
      const playerId = this.devMatchToPlayer.get(matchId);
      this.devMatchToPlayer.delete(matchId);
      this.practiceServers.delete(matchId);
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
    if (player.ws.readyState === WebSocket.OPEN) this.deliver(player, JSON.stringify(msg));
  }

  /**
   * Queue a frame for a connection, unless it has stopped reading: a client
   * that never reads would otherwise hold every broadcast in the lobby's
   * memory. It is cut off, as the game server cuts off a stalled reader.
   */
  private deliver(player: ConnectedPlayer, data: string): void {
    const queued = (player.ws as { bufferedAmount?: number }).bufferedAmount ?? 0;
    if (queued + data.length > MAX_QUEUED_BYTES) {
      log.warnRateLimited("LobbyServer:backpressure", `Closed ${player.id}: not reading (${queued} bytes queued)`);
      player.ws.terminate?.();
      return;
    }
    player.ws.send(data);
  }

  private broadcast(msg: LobbyMessage, excludeId?: string): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.id === excludeId) continue;
      if (!player.authenticated) continue;
      if (player.ws.readyState === WebSocket.OPEN) this.deliver(player, data);
    }
  }

  private broadcastToLobby(lobbyId: string, msg: LobbyMessage, excludeId?: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;

    const data = JSON.stringify(msg);
    for (const lp of lobby.players.values()) {
      if (lp.id === excludeId) continue;
      const player = this.players.get(lp.id);
      if (player && player.ws.readyState === WebSocket.OPEN) this.deliver(player, data);
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
        const mapPk3Names = files
          .filter((f) => f.startsWith("map_") && f.endsWith(".pk3"))
          .flatMap((f) => {
            const name = f.slice(4, -4);
            // SHAGGED publishes map_<name>_<revision>.pk3 with the base BSP name.
            return [name, name.replace(/_\d{5,}$/, "")];
          });
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

    const installed = [...new Set(this.gametypes.flatMap((gametype) => gametype.mapPool))];
    this.campaignGametypes = CAMPAIGN_GAMETYPE_SHELLS.map((shell) => ({ ...shell, mapPool: installed }));
  }

  /** A gametype a campaign mission may use: the lobby's, or one only the campaign plays. */
  private campaignGametype(id: string): GametypeInfo | undefined {
    return this.gametypes.find((g) => g.id === id) ?? this.campaignGametypes.find((g) => g.id === id);
  }

  // ── Demo Scanning ────────────────────────────────────────────

  /**
   * The demos anyone may browse: long enough to be a match
   * (MIN_LISTED_DEMO_MS), and not a campaign mission, which only its own
   * players see (`ownDemos`).
   */
  private listedDemos(): DemoInfo[] {
    return this._demoCache.filter((demo) => demo.durationMs >= MIN_LISTED_DEMO_MS && !demo.campaign);
  }

  /** The demos an account played in, campaign missions included. */
  private ownDemos(accountId: number | null): DemoInfo[] {
    if (accountId === null) return [];
    return this._demoCache.filter(
      (demo) => demo.durationMs >= MIN_LISTED_DEMO_MS && this._demoOwnership.get(demo.filename)?.has(accountId),
    );
  }

  private handleDemosList(player: ConnectedPlayer, limit: number, requestedScope?: string, requestId?: string): void {
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId))) return;
    const scope = requestedScope === "yours" ? "yours" : "latest";
    const source = scope === "yours" ? this.ownDemos(player.accountId) : this.listedDemos();
    const size = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 64)) : 64;
    this.send(player, {
      type: "demos:list_response",
      demos: source.slice(0, size),
      scope,
      ...(requestId ? { requestId } : {}),
    });
  }

  /**
   * The campaign boards, ten places each. Names come from the accounts as they
   * are now; banned accounts and deleted ones are left out.
   */
  private handleCampaignBoardGet(player: ConnectedPlayer, msg: CampaignBoardRequest): void {
    const requestId =
      typeof msg.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(msg.requestId) ? msg.requestId : "";
    if (!requestId) {
      this.send(player, { type: "campaign:board:error", requestId, reason: "invalid_query" });
      return;
    }
    if (this.campaignCatalog.missions.length === 0) {
      this.send(player, { type: "campaign:board:error", requestId, reason: "unavailable" });
      return;
    }
    if (!this.leaderboardReads.tryRecord(player.id)) {
      this.send(player, { type: "campaign:board:error", requestId, reason: "rate_limited" });
      return;
    }
    const limit = 10;
    const hidden = [...this.fairPlay.bannedAccountIds(), ...this.accounts.deletedAccountIds()];
    const data = this.campaign.board(limit, hidden);
    const rows = <T extends { accountId: number }>(
      list: readonly T[],
      extra: (row: T) => Partial<CampaignBoardRow>,
    ): CampaignBoardRow[] => {
      const named: CampaignBoardRow[] = [];
      for (const row of list) {
        const name = this.accounts.nameOf(row.accountId);
        if (name === null) continue;
        named.push({ rank: named.length + 1, playerId: String(row.accountId), name, ...extra(row) });
      }
      return named;
    };
    this.send(player, {
      type: "campaign:board",
      requestId,
      missionCount: this.campaignCatalog.length,
      scorers: rows(data.scorers, (row) => ({ frags: row.frags, cleared: row.cleared })),
      finishers: rows(data.finishers, (row) => ({ at: row.at })),
      missions: this.campaignCatalog.missions.map((mission) => ({
        id: mission.id,
        number: mission.number,
        scorers: rows(
          data.missionScorers.filter((row) => row.missionId === mission.id),
          (row) => ({ frags: row.frags }),
        ),
        firstClears: rows(
          data.firstClears.filter((row) => row.missionId === mission.id),
          (row) => ({ at: row.at }),
        ),
      })),
    });
  }

  private handleFeaturedGet(player: ConnectedPlayer, query: FeaturedDemosRequest): void {
    const { requestId, gametype = "all", map = "all", limit } = query;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10 ||
      typeof gametype !== "string" ||
      (gametype !== "all" && !isRatingMode(gametype)) ||
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
    // Top-ten players this week, else this week's matches, else the newest matches of any age,
    // so the page is empty only when nothing has been recorded
    const picks = { gametype, map, limit };
    const ranked = this.selectRankedFeatured(gametype, map, limit);
    const week = ranked.length > 0 ? [] : selectFeaturedDemos(this._demoCache, picks);
    const latest =
      ranked.length > 0 || week.length > 0
        ? []
        : selectFeaturedDemos(this._demoCache, picks, Date.now(), Number.POSITIVE_INFINITY);
    this.send(player, {
      type: "featured:page",
      requestId,
      entries: ranked.length > 0 ? ranked : week.length > 0 ? week : latest,
      selection:
        ranked.length > 0 ? "ranked_month_week" : week.length > 0 ? "recent_multiplayer_week" : "latest_multiplayer",
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
            ?.skillLeaderboard({
              gametype: mode,
              period: "month",
              offset: 0,
              limit: 10,
              now,
              hidden: [...this.fairPlay.bannedAccountIds()],
            })
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
  /**
   * Rebuild the demo list from the demo folder. Reading and decompressing a new
   * file is asynchronous: the first scan reads every demo (hundreds of
   * megabytes), and done synchronously it held the lobby for seconds at start.
   * One scan runs at a time; a call while one runs waits for it.
   */
  private _scanDemos(): Promise<void> {
    this._demoScan ??= this.scanDemosNow().finally(() => {
      this._demoScan = null;
    });
    return this._demoScan;
  }

  private async scanDemosNow(): Promise<void> {
    try {
      if (!fs.existsSync(this.DEMO_DIR)) {
        this._demoCache = [];
        this._demoOwnership.clear();
        this._demoPlayerAccounts.clear();
        return;
      }

      const files = (await fs.promises.readdir(this.DEMO_DIR))
        .filter((f) => f.endsWith(".shagdemo"))
        .sort()
        .reverse(); // newest first by filename (contains date)

      const demos: DemoInfo[] = [];
      const ownership = new Map<string, Set<number>>();
      const playerAccounts = new Map<string, readonly (number | undefined)[]>();

      // A demo does not change once written: read and parse each file once, and
      // again only if its size or time changes. Everything else is rebuilt.
      const present = new Set(files);
      for (const filename of this._demoFiles.keys()) if (!present.has(filename)) this._demoFiles.delete(filename);

      // The first scan after a start reads every file and can take a while:
      // the newest demos are listed as they are read rather than at the end
      const firstScan = this._demoCache.length === 0;
      const publish = () => {
        this._demoCache = demos;
        this._demoOwnership = ownership;
        this._demoPlayerAccounts = playerAccounts;
        this.renameDeletedInDemos(this.accounts.deletedAccountIds());
      };
      let read = 0;
      for (const filename of files) {
        // A stopping lobby does not wait for the rest of a long scan
        if (this.demoScanStopped) return;
        if (firstScan && ++read % DEMO_SCAN_BATCH === 0) publish();
        try {
          const filepath = path.join(this.DEMO_DIR, filename);
          const stat = await fs.promises.stat(filepath);
          let parsed = this._demoFiles.get(filename);
          if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
            parsed = { mtimeMs: stat.mtimeMs, size: stat.size, header: null, durationMs: 0 };
            this._demoFiles.set(filename, parsed);
            const bytes = new Uint8Array(await fs.promises.readFile(filepath));
            // Decompressed on the thread pool, not the lobby's thread
            const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
            const reader = new DemoReader(gzipped ? await gunzipAsync(bytes) : bytes);
            parsed.header = reader.readHeader();
            const index = reader.readIndex();
            // Duration from the index: (last tick - first tick) / tick rate
            if (index && index.frameCount > 0 && parsed.header) {
              const tickSpan = index.entries[index.frameCount - 1].tick - index.entries[0].tick;
              parsed.durationMs = Math.round((tickSpan / parsed.header.tickRate) * 1000);
            }
          }
          const { header, durationMs } = parsed;

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
            const accounts = header.players.map((p) => p.accountId);
            if (accounts.some((id) => id !== undefined)) playerAccounts.set(filename, accounts);
            demos.push({
              filename,
              map: header.map,
              mapDisplayName: this.mapNames[header.map] || header.map,
              gametype: header.gametype,
              private: header.private === true,
              ...(header.campaign ? { campaign: header.campaign } : {}),
              players: header.players.map((p) => filterPlayerName(p.name)),
              durationMs,
              date: header.startTime,
              sizeMB: parseFloat((stat.size / (1024 * 1024)).toFixed(2)),
              levelshot: `/data/levelshots/${encodeURIComponent(this.resolveDemoMap(header.map))}.jpg`,
            });
          }
        } catch (err) {
          console.warn(`[LobbyServer] Failed to parse demo: ${filename}`, (err as Error).message);
        }
      }

      publish();
      // Once a minute: said only when the count moved
      if (demos.length > 0 && demos.length !== this._demoCountLogged) {
        console.log(`[LobbyServer] Demo scan: ${demos.length} demos found`);
      }
      this._demoCountLogged = demos.length;
    } catch (err) {
      console.error("[LobbyServer] Demo scan failed:", err);
    }
  }

  /** Show `deleted` accounts as DELETED_ACCOUNT_NAME in the demo list. The demo files keep what was recorded. */
  private renameDeletedInDemos(deleted: ReadonlySet<number>): void {
    if (deleted.size === 0) return;
    for (const demo of this._demoCache) {
      const accounts = this._demoPlayerAccounts.get(demo.filename);
      if (!accounts?.some((id) => id !== undefined && deleted.has(id))) continue;
      demo.players = demo.players.map((name, i) => {
        const id = accounts[i];
        return id !== undefined && deleted.has(id) ? DELETED_ACCOUNT_NAME : name;
      });
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
