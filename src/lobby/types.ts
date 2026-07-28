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
  [key: string]: any;
}

// ============================================================================
// Gametype Definitions (sent in welcome)
// ============================================================================

export interface GametypeInfo {
  id: string; // 'duel', 'snd', 'ffa'
  name: string; // 'DUEL 1v1'
  description: string;
  maxPlayers: number;
  hasTeams: boolean;
  teamNames?: [string, string];
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

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  team: string; // 'alpha', 'bravo', or 'ffa'
  ready: boolean;
}

export interface MatchLobbyInfo {
  id: string;
  gametype: string;
  maps: MapOption[];
  players: LobbyPlayerInfo[];
  shareUrl: string;
  config: {
    maxPlayers: number;
    hasTeams: boolean;
    teamNames?: [string, string];
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

// ============================================================================
// Client → Server Messages
// ============================================================================

export interface AuthMessage extends LobbyMessage {
  type: "auth";
  name: string;
}

export interface ChatSendMessage extends LobbyMessage {
  type: "chat:send";
  text: string;
}

export interface LobbyCreateMessage extends LobbyMessage {
  type: "lobby:create";
  gametype: string;
}

export interface LobbyJoinMessage extends LobbyMessage {
  type: "lobby:join";
  lobbyId: string;
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

export interface LobbyInviteBotMessage extends LobbyMessage {
  type: "lobby:invite_bot";
  lobbyId: string;
  difficulty?: string; // easy | medium | hard | insane (default: medium)
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
}

// ============================================================================
// Server → Client Messages
// ============================================================================

export interface WelcomeMessage extends LobbyMessage {
  type: "welcome";
  playerId: string;
  gametypes: GametypeInfo[];
  onlinePlayers: PlayerInfo[];
  chatHistory: ChatMessage[];
  liveMatches: LiveMatchInfo[];
  recentDemos: DemoInfo[];
}

export interface ChatBroadcastMessage extends LobbyMessage {
  type: "chat:message";
  from: string;
  fromId: string;
  text: string;
  ts: number;
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
  serverUrl: string;
  map: string;
  gametype: string;
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
}

export interface LobbyBotInviteFailedMessage extends LobbyMessage {
  type: "lobby:bot_invite_failed";
  lobbyId: string;
  error: string;
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
  limit?: number; // max demos to return (default 64)
}

export interface DemosListResponse extends LobbyMessage {
  type: "demos:list_response";
  demos: DemoInfo[];
}
