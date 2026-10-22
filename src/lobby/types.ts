/**
 * Lobby Server — Shared Types
 *
 * Message types for the WebSocket lobby protocol.
 * All messages are JSON: { type: string, ...payload }
 */

// ============================================================================
// Core Message Types
// ============================================================================

/** Base lobby message — all messages have a type */
export interface LobbyMessage {
  type: string;
  [key: string]: unknown;
}

// ============================================================================
// Gametype Definitions (sent in welcome)
// ============================================================================

/** Display names for the lobby's two sides. */
export interface TeamNames {
  alpha: string;
  bravo: string;
}

export interface GametypeInfo {
  id: string; // 'duel', 'snd', 'ffa'
  name: string; // 'DUEL 1v1'
  description: string;
  maxPlayers: number;
  /**
   * Players needed before a lobby can launch. Defaults to `maxPlayers`.
   *
   * Split from `maxPlayers` because they answer different questions: how many
   * FIT, and how few can start. They were the same number, which meant a mode
   * sized for 5v5 could not begin until ten people were in the room — fine for
   * a duel, impossible for anything larger.
   */
  minPlayers?: number;
  hasTeams: boolean;
  /**
   * What to call each side. Keyed by the lobby's team ids rather than ordered,
   * because a pair read by position is a coin flip: the game maps alpha to Soba
   * and bravo to Udon (see normalizeTeamId in shared/server/gametype).
   */
  teamNames?: TeamNames;
  mapPool: string[]; // Available maps for this gametype
  backgroundImage?: string;
}

// ============================================================================
// Player State
// ============================================================================

export type PlayerStatus = "online" | "in_queue" | "in_lobby" | "in_match";

export interface PlayerInfo {
  id: string;
  name: string;
  status: PlayerStatus;
  lobbyId?: string; // Set when in_lobby
  matchId?: string; // Set when in_match
}

// ============================================================================
// Chat
// ============================================================================

export interface ChatMessage {
  from: string; // Player name
  fromId: string; // Player ID
  text: string;
  ts: number; // Unix timestamp ms
}

// ============================================================================
// Match Lobby
// ============================================================================

export interface MapOption {
  name: string; // Map file name (e.g., 'wdm1')
  displayName: string; // Human-readable (e.g., 'The Edge')
  votes: number;
}

/** A room seat's side; `ffa` in a mode without teams. */
export type LobbyTeam = "alpha" | "bravo" | "ffa";

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  team: LobbyTeam;
  ready: boolean;
  /** A bot's preset (easy, medium, hard, insane), as its service reported it. */
  botLevel?: string;
}

export interface MatchLobbyInfo {
  id: string;
  gametype: string;
  /** Present only for the currently running match, to reopen an unplayed seat. */
  activeMatchId?: string;
  /** Absent on older servers, which only create public rooms. */
  visibility?: "public" | "private";
  maps: MapOption[];
  players: LobbyPlayerInfo[];
  /** Recent messages in this room, sent only to a member receiving room state. */
  chatHistory?: ChatMessage[];
  shareUrl: string;
  config: {
    maxPlayers: number;
    /** Players needed to start. Absent on older servers, where it is `maxPlayers`. */
    minPlayers?: number;
    hasTeams: boolean;
    teamNames?: TeamNames;
  };
}

// ============================================================================
// Live Match Info (visible to all clients)
// ============================================================================

export interface LiveMatchInfo {
  id: string; // lobby ID
  gametype: string; // 'duel', 'snd', 'ffa'
  gametypeName: string; // 'DUEL', 'TEAM', 'FFA'
  map: string; // map name (set when match starts, else '')
  mapDisplayName: string;
  players: string[]; // player names
  playerCount: number;
  maxPlayers: number;
  state: "waiting" | "playing";
  startedAt: number; // lobby creation timestamp
  serverUrl?: string; // game server URL (set when match is playing, for spectator connect)
}

// ============================================================================
// Demo Info (recorded match playback)
// ============================================================================

export interface DemoInfo {
  /** Absent on older recordings, treated as public. */
  private?: boolean;
  filename: string; // "wdm14_duel_20260319_092800.shagdemo"
  map: string; // "wdm14"
  mapDisplayName: string; // "Aerowalk"
  gametype: string; // "duel"
  players: string[]; // ["player1", "player2"]
  durationMs: number; // match duration
  date: number; // unix timestamp ms
  sizeMB: number; // file size in MB
  levelshot?: string; // "/data/levelshots/wdm14.png"
}

export interface FeaturedDemoInfo {
  demo: DemoInfo;
  /** Position in the recency selection, not a skill or player ranking. */
  rank: number;
  reason: string;
}

// ============================================================================
// Client → Server Messages
// ============================================================================

/**
 * Log in. With `key`, into that player's account. Without one, into a new
 * account named Player_<number>, whose key comes back once in `welcome`.
 * Players can't choose a name here; that's what `identity:rename` is for.
 */
export interface AuthMessage extends LobbyMessage {
  type: "auth";
  /** The player's key, in any form they might paste it (see PlayerIdentity.normalizeKey). */
  key?: string;
  /** A bot's name. Ignored for players. */
  name?: string;
  /** Set by the bot server's lobby bots. Believed only with `botSecret`, from the lobby's own machine. */
  isBot?: boolean;
  /** The secret the lobby shares with its bot server. */
  botSecret?: string;
  /** Service-owned configuration. Ignored for human connections. */
  botReference?: import("../shared/ranking/BotReference").BotReference;
}

/** Change your account's name. Not while in a room: the room and its match keep the name they were given. */
export interface IdentityRenameMessage extends LobbyMessage {
  type: "identity:rename";
  name: string;
}

/**
 * Delete your account for good. The player ticks that they understand and pastes
 * the whole key again, so a stray click or an open tab can't do it. Not while in
 * a room. The answer is identity:deleted, then the lobby closes the connection.
 */
export interface IdentityDeleteMessage extends LobbyMessage {
  type: "identity:delete";
  key: string;
  confirmed: boolean;
}

export interface ChatSendMessage extends LobbyMessage {
  type: "chat:send";
  text: string;
}

export interface RoomChatSendMessage extends LobbyMessage {
  type: "lobby:chat_send";
  lobbyId: string;
  text: string;
}

export interface LobbyCreateMessage extends LobbyMessage {
  type: "lobby:create";
  gametype: string;
  visibility?: "public" | "private";
}

export interface LobbyJoinMessage extends LobbyMessage {
  type: "lobby:join";
  lobbyId: string;
  /** Bearer secret from a private room's share URL. */
  inviteToken?: string;
}

export interface LobbyLeaveMessage extends LobbyMessage {
  type: "lobby:leave";
  lobbyId: string;
}

export interface LobbyVoteMapMessage extends LobbyMessage {
  type: "lobby:vote_map";
  lobbyId: string;
  map: string;
}

export interface LobbyReadyMessage extends LobbyMessage {
  type: "lobby:ready";
  lobbyId: string;
  ready: boolean;
}

export interface LobbyVoteShuffleMessage extends LobbyMessage {
  type: "lobby:vote_shuffle";
  lobbyId: string;
}

/**
 * Move yourself to the other side.
 *
 * Distinct from `vote_shuffle`, which is random and needs a majority. Swapping
 * yourself needs neither: it affects one player, it is reversible, and without
 * it there is no way at all to choose a side — which makes testing the
 * attacking half of a round mode impossible.
 */
export interface LobbySwitchTeamMessage extends LobbyMessage {
  type: "lobby:switch_team";
  lobbyId: string;
}

export interface LobbyInviteBotMessage extends LobbyMessage {
  type: "lobby:invite_bot";
  lobbyId: string;
  /** easy | medium | hard | insane; absent, the preset nearest the inviter's Private rating. */
  difficulty?: string;
}

export interface QueueJoinMessage extends LobbyMessage {
  type: "queue:join";
  gametype: string;
}

export interface QueueLeaveMessage extends LobbyMessage {
  type: "queue:leave";
}

export interface DevSpawnServerMessage extends LobbyMessage {
  type: "dev:spawn_server";
  requestId: string;
  map: string;
  gametype: string;
  /** Record a training demo under this name (letters, digits, `_` and `-`). */
  trainingDemo?: string;
}

export type RankingScope = "public" | "private";

/** Own-account only: the lobby supplies the authenticated account, never the request. */
export interface PlayerStatsRequest extends LobbyMessage {
  type: "stats:get" | "stats:history";
  requestId: string;
  gametype: import("../shared/ranking/RatingPolicy").RatingMode;
  scope: RankingScope;
  period?: "month" | "all";
  limit?: number;
  beforeSequence?: number;
}
export interface PlayerStatsResponse extends LobbyMessage {
  type: "stats:summary" | "stats:history_page";
  requestId: string;
  gametype: import("../shared/ranking/RatingPolicy").RatingMode;
  scope: RankingScope;
  data: import("./PlayerStatsStore").StatsSummary | import("./PlayerStatsStore").HistoryPage;
}

/** Read-only rankings; request IDs correlate concurrent scope/mode/period changes. */
export interface LeaderboardRequest extends LobbyMessage {
  type: "leaderboard:get";
  requestId: string;
  gametype: string;
  period: "month" | "all";
  offset: number;
  limit: number;
  /** Omitted means public. Each board contains only its own lobby visibility. */
  scope?: RankingScope;
  /** Older clients omit this and receive records. New clients explicitly request skill. */
  system?: "trueskill";
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  rating?: number;
  conservativeScore?: number;
  provisional?: boolean;
  ratedMatches?: number;
  /** A bot preset's account, rated in the Private pools. */
  bot?: boolean;
}

export interface LeaderboardResponse extends LobbyMessage {
  type: "leaderboard:page";
  requestId: string;
  gametype: string;
  period: "month" | "all";
  scope: RankingScope;
  entries: LeaderboardEntry[];
  system?: "trueskill";
  policyVersion?: string;
  localProcessing?: { excluded: number };
  total: number;
  localPlayerRank?: number;
  /** The authenticated account's actual row, even when it is outside this page. */
  localPlayerEntry?: LeaderboardResponse["entries"][number];
}

export interface LeaderboardError extends LobbyMessage {
  type: "leaderboard:error";
  requestId: string;
  reason: "unavailable" | "invalid_query" | "rate_limited";
}

/** Recover the original unplayed human seat after its short initial ticket expires. */
export interface SeatReissueRequest extends LobbyMessage {
  type: "match:seat_reissue";
  requestId: string;
  matchId: string;
}

export interface SeatReissueResponse extends LobbyMessage {
  type: "match:seat_reissued";
  requestId: string;
  matchId: string;
  serverUrl: string;
  admissionTicket: string;
}

export interface SeatReissueError extends LobbyMessage {
  type: "match:seat_reissue_error";
  requestId: string;
  reason: "unavailable";
}

// ============================================================================
// Server → Client Messages
// ============================================================================

/** A player's account, as the player sees it. Bots have none. */
export interface PlayerIdentityInfo {
  id: string;
  name: string;
}

export interface WelcomeMessage extends LobbyMessage {
  type: "welcome";
  /** Older servers omit this; clients must keep Private disabled then. */
  features?: {
    privateLobbies: boolean;
    leaderboard?: boolean;
    skillRatings?: boolean;
    playerStats?: boolean;
    featuredDemos?: boolean;
    demoOwnership?: boolean;
    /** The lobby keeps each account's synced settings (settings:get / settings:save). */
    syncedSettings?: boolean;
  };
  /** This connection's id, used by rooms and chat. Not the account id. */
  playerId: string;
  /** The account this connection is logged in to; absent for bots. */
  identity?: PlayerIdentityInfo;
  /** Only when this login created the account: its key, sent this once. Store it. */
  key?: string;
  gametypes: GametypeInfo[];
  onlinePlayers: PlayerInfo[];
  chatHistory: ChatMessage[];
  liveMatches: LiveMatchInfo[];
  recentDemos: DemoInfo[];
}

export type AuthErrorCode = "unknown_key" | "rate_limited" | "already_authenticated" | "lobby_full";

/**
 * Login failed; the connection stays open and may send `auth` again, except
 * after `lobby_full`, when the lobby closes it.
 */
export interface AuthErrorMessage extends LobbyMessage {
  type: "auth:error";
  code: AuthErrorCode;
  /** `lobby_full`: players online, and the most the lobby takes. */
  online?: number;
  maxPlayers?: number;
  /** `lobby_full`: seconds to wait before trying again. */
  retryAfterSec?: number;
}

export interface IdentityRenamedMessage extends LobbyMessage {
  type: "identity:renamed";
  identity: PlayerIdentityInfo;
}

export type IdentityErrorCode =
  | "name_invalid"
  | "name_reserved"
  | "name_offensive"
  | "name_taken"
  | "in_lobby"
  | "rate_limited"
  | "not_confirmed"
  | "wrong_key";

/** The account is gone; the lobby closes every connection logged in to it next. */
export interface IdentityDeletedMessage extends LobbyMessage {
  type: "identity:deleted";
}

export interface IdentityErrorMessage extends LobbyMessage {
  type: "identity:error";
  code: IdentityErrorCode;
}

// ── Synced settings (own account only; see shared/settings/SyncedSettings.ts) ──

/** Ask for the logged-in account's synced settings. */
export interface SettingsGetMessage extends LobbyMessage {
  type: "settings:get";
  requestId: string;
}

/** Replace the logged-in account's synced settings with this JSON object. */
export interface SettingsSaveMessage extends LobbyMessage {
  type: "settings:save";
  requestId: string;
  settings: string;
}

/** The account's synced settings; both null when it has never saved any. */
export interface SettingsDataMessage extends LobbyMessage {
  type: "settings:data";
  requestId: string;
  settings: string | null;
  updatedAt: number | null;
}

export interface SettingsSavedMessage extends LobbyMessage {
  type: "settings:saved";
  requestId: string;
  updatedAt: number;
}

export type SettingsErrorCode = "invalid" | "too_large" | "rate_limited" | "unavailable";

export interface SettingsErrorMessage extends LobbyMessage {
  type: "settings:error";
  requestId: string;
  code: SettingsErrorCode;
}

/** Someone online changed their name. */
export interface PlayerRenamedMessage extends LobbyMessage {
  type: "player:renamed";
  playerId: string;
  name: string;
}

export interface ChatBroadcastMessage extends LobbyMessage {
  type: "chat:message";
  from: string;
  fromId: string;
  text: string;
  ts: number;
}

export interface RoomChatBroadcastMessage extends ChatMessage, LobbyMessage {
  type: "lobby:chat_message";
  lobbyId: string;
}

export interface PlayerJoinMessage extends LobbyMessage {
  type: "player:join";
  player: PlayerInfo;
}

export interface PlayerLeaveMessage extends LobbyMessage {
  type: "player:leave";
  playerId: string;
}

export interface PlayerStatusMessage extends LobbyMessage {
  type: "player:status";
  playerId: string;
  status: PlayerStatus;
}

export interface LobbyCreatedMessage extends LobbyMessage {
  type: "lobby:created";
  lobby: MatchLobbyInfo;
}

export interface LobbyPlayerJoinedMessage extends LobbyMessage {
  type: "lobby:player_joined";
  player: LobbyPlayerInfo;
}

export interface LobbyPlayerLeftMessage extends LobbyMessage {
  type: "lobby:player_left";
  playerId: string;
}

export interface LobbyPlayerUpdatedMessage extends LobbyMessage {
  type: "lobby:player_updated";
  playerId: string;
  ready: boolean;
}

export interface LobbyVotesUpdatedMessage extends LobbyMessage {
  type: "lobby:votes_updated";
  votes: Record<string, number>;
}

export interface LobbyAllReadyMessage extends LobbyMessage {
  type: "lobby:all_ready";
}

export interface LobbyStartingMessage extends LobbyMessage {
  type: "lobby:starting";
  map: string;
  status: string;
}

export interface LobbyConnectMessage extends LobbyMessage {
  type: "lobby:connect";
  matchId?: string;
  serverUrl: string;
  map: string;
  gametype: string;
  /** Private one-use game-server seat credential. Never send via room broadcast. */
  admissionTicket?: string;
}

export interface LobbyErrorMessage extends LobbyMessage {
  type: "lobby:error";
  error: string;
}

export interface MatchesUpdateMessage extends LobbyMessage {
  type: "matches:update";
  matches: LiveMatchInfo[];
}

export interface LobbyBotInvitedMessage extends LobbyMessage {
  type: "lobby:bot_invited";
  lobbyId: string;
  name: string; // bot name that is joining
  /** The preset fielded: the one asked for, or the one matched to the inviter's rating. */
  difficulty?: string;
}

export interface LobbyBotInviteFailedMessage extends LobbyMessage {
  type: "lobby:bot_invite_failed";
  lobbyId: string;
  error: string;
}

/** This connection was taken out of a room it was in. */
export interface LobbyKickedMessage extends LobbyMessage {
  type: "lobby:kicked";
  lobbyId: string;
  reason: string;
}

export interface LobbyTeamsShuffledMessage extends LobbyMessage {
  type: "lobby:teams_shuffled";
  players: LobbyPlayerInfo[];
}

/** The room's match is over and the room is waiting again. */
export interface MatchEndedMessage extends LobbyMessage {
  type: "match:ended";
  matchId: string;
  /** The game server's exit code; null when it was stopped by a signal. */
  exitCode: number | null;
}

export interface DevServerSpawnedMessage extends LobbyMessage {
  type: "dev:server_spawned";
  requestId: string;
  serverUrl: string;
  map: string;
  gametype: string;
  matchId: string;
}

export interface DevServerSpawnFailedMessage extends LobbyMessage {
  type: "dev:server_spawn_failed";
  requestId: string;
  error: string;
}

// ============================================================================
// Demo List Messages
// ============================================================================

export interface DemosListRequest extends LobbyMessage {
  type: "demos:list";
  requestId?: string;
  limit?: number; // max demos to return (default 64)
  scope?: "latest" | "yours";
}

export interface DemosListResponse extends LobbyMessage {
  type: "demos:list_response";
  requestId?: string;
  demos: DemoInfo[];
  scope?: "latest" | "yours";
}

export interface FeaturedDemosRequest extends LobbyMessage {
  type: "featured:get";
  requestId: string;
  gametype?: string;
  map?: string;
  limit: number;
}

export interface FeaturedDemosResponse extends LobbyMessage {
  type: "featured:page";
  requestId: string;
  entries: FeaturedDemoInfo[];
  selection: "ranked_month_week" | "recent_multiplayer_week";
}

export interface FeaturedDemosError extends LobbyMessage {
  type: "featured:error";
  requestId: string;
  reason: "invalid_query" | "rate_limited";
}

// ============================================================================
// Server → Client Messages, by type
// ============================================================================

/** Each server message a client can subscribe to, keyed by its `type`. */
export interface LobbyServerMessages {
  welcome: WelcomeMessage;
  "auth:error": AuthErrorMessage;
  "identity:renamed": IdentityRenamedMessage;
  "identity:error": IdentityErrorMessage;
  "identity:deleted": IdentityDeletedMessage;
  "settings:data": SettingsDataMessage;
  "settings:saved": SettingsSavedMessage;
  "settings:error": SettingsErrorMessage;
  "player:renamed": PlayerRenamedMessage;
  "player:join": PlayerJoinMessage;
  "player:leave": PlayerLeaveMessage;
  "player:status": PlayerStatusMessage;
  "chat:message": ChatBroadcastMessage;
  "lobby:chat_message": RoomChatBroadcastMessage;
  "lobby:created": LobbyCreatedMessage;
  "lobby:player_joined": LobbyPlayerJoinedMessage;
  "lobby:player_left": LobbyPlayerLeftMessage;
  "lobby:player_updated": LobbyPlayerUpdatedMessage;
  "lobby:votes_updated": LobbyVotesUpdatedMessage;
  "lobby:all_ready": LobbyAllReadyMessage;
  "lobby:starting": LobbyStartingMessage;
  "lobby:connect": LobbyConnectMessage;
  "lobby:error": LobbyErrorMessage;
  "lobby:kicked": LobbyKickedMessage;
  "lobby:teams_shuffled": LobbyTeamsShuffledMessage;
  "lobby:bot_invited": LobbyBotInvitedMessage;
  "lobby:bot_invite_failed": LobbyBotInviteFailedMessage;
  "matches:update": MatchesUpdateMessage;
  "match:ended": MatchEndedMessage;
  "match:seat_reissued": SeatReissueResponse;
  "match:seat_reissue_error": SeatReissueError;
  "dev:server_spawned": DevServerSpawnedMessage;
  "dev:server_spawn_failed": DevServerSpawnFailedMessage;
  "demos:list_response": DemosListResponse;
  "featured:page": FeaturedDemosResponse;
  "featured:error": FeaturedDemosError;
  "leaderboard:page": LeaderboardResponse;
  "leaderboard:error": LeaderboardError;
  "stats:summary": PlayerStatsResponse;
  "stats:history_page": PlayerStatsResponse;
}
