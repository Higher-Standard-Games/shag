/**
 * LobbyServer — WebSocket Lobby Server
 *
 * Handles player presence, chat, match lobbies, and game server spawning.
 * All communication is JSON over WebSocket.
 *
 * Usage: npm run lobby:server
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { DemoReader } from "../shared/demo/DemoReader";
import { GameServerSpawner } from "./GameServerSpawner";
import type {
  ChatMessage as ChatMsg,
  DemoInfo,
  GametypeInfo,
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
  { id: "duel", name: "DUEL", description: "1v1 Arena Duel",        maxPlayers: 2, hasTeams: true,  teamNames: ["UDON", "SOBA"] },
  { id: "tdm",  name: "TEAM", description: "2v2 Team Deathmatch",   maxPlayers: 4, hasTeams: true,  teamNames: ["UDON", "SOBA"] },
  { id: "ffa",  name: "FFA",  description: "Free For All",           maxPlayers: 8, hasTeams: false },
];

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
}

// ============================================================================
// Match Lobby
// ============================================================================

class MatchLobby {
  id: string;
  gametype: GametypeInfo;
  maps: MapOption[];
  players: Map<string, LobbyPlayerInfo> = new Map();
  votes: Map<string, string> = new Map(); // playerId → mapName
  shuffleVotes: Set<string> = new Set();
  createdAt: number = Date.now();
  isStarting: boolean = false;
  matchMap: string = ""; // Set when match starts
  serverUrl: string = ""; // Set when game server is spawned
  state: "waiting" | "playing" = "waiting";

  get playerCount(): number {
    return this.players.size;
  }

  constructor(gametype: GametypeInfo, mapNames: Record<string, string>) {
    this.id = randomUUID().slice(0, 8);
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

  voteShuffle(playerId: string): { votes: number; needed: number; passed: boolean } {
    this.shuffleVotes.add(playerId);
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
    if (this.players.size < this.gametype.maxPlayers) return false;
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
      maps: this.maps,
      players: [...this.players.values()],
      shareUrl: `washoi.gg/lobby/${this.id}`,
      config: {
        maxPlayers: this.gametype.maxPlayers,
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
  /** Map matchId → lobbyId for server exit cleanup */
  private matchToLobby: Map<string, string> = new Map();

  private readonly MAX_CHAT_HISTORY = 50;

  // Demo listing cache
  private _demoCache: DemoInfo[] = [];
  private _demoCacheTimer: ReturnType<typeof setInterval> | null = null;
  private readonly DEMO_DIR = path.join(process.cwd(), "public", "data", "demos");
  private readonly DEMO_CACHE_INTERVAL = 60_000; // 60s refresh

  // Dynamic map config (built at startup from config/maps.json + disk scan)
  private gametypes: GametypeInfo[] = [];
  private mapNames: Record<string, string> = {};

  private readonly MAP_CONFIG_PATH = path.join(process.cwd(), "config", "maps.json");
  private readonly PK3_DIR = path.join(process.cwd(), "public", "data");

  constructor(port: number = 9000) {
    this.port = port;
    this.spawner = new GameServerSpawner();

    // Handle game server exits
    this.spawner.onServerExit = (matchId, code) => {
      this.handleServerExit(matchId, code);
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    this._loadMapsConfig();
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: "0.0.0.0" });

      this.wss.on("connection", (ws) => this.handleConnection(ws));
      this.wss.on("error", (err) => {
        console.error("[LobbyServer] Error:", err);
        reject(err);
      });
      this.wss.on("listening", () => {
        console.log(`[LobbyServer] Ready on ws://localhost:${this.port}`);
        console.log(`[LobbyServer] ${this.gametypes.length} gametypes loaded: ${this.gametypes.map((g) => g.id).join(", ")}`);

        // Initial demo scan + periodic refresh
        this._scanDemos();
        this._demoCacheTimer = setInterval(() => this._scanDemos(), this.DEMO_CACHE_INTERVAL);

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;

    // Stop demo scan timer
    if (this._demoCacheTimer) {
      clearInterval(this._demoCacheTimer);
      this._demoCacheTimer = null;
    }

    // Shutdown all game servers
    await this.spawner.shutdownAll();

    // Close all connections
    for (const player of this.players.values()) {
      player.ws.close(1000, "Server shutting down");
    }
    this.players.clear();
    this.lobbies.clear();
    this.matchToLobby.clear();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        console.log("[LobbyServer] Stopped");
        resolve();
      });
    });
  }

  // ── Connection Handling ──────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const playerId = `p_${this.nextPlayerId++}`;
    console.log(`[LobbyServer] New connection → ${playerId}`);

    const player: ConnectedPlayer = {
      id: playerId,
      ws,
      name: "",
      status: "online",
      lobbyId: null,
      authenticated: false,
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

    // Leave lobby if in one
    if (player.lobbyId) {
      this.handleLobbyLeave(player, player.lobbyId);
    }

    this.players.delete(player.id);

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
        this.handleAuth(player, msg.name);
        break;
      case "chat:send":
        this.handleChatSend(player, msg.text);
        break;
      case "lobby:create":
        this.handleLobbyCreate(player, msg.gametype);
        break;
      case "lobby:join":
        this.handleLobbyJoin(player, msg.lobbyId);
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
      case "lobby:vote_shuffle":
        this.handleLobbyVoteShuffle(player, msg.lobbyId);
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
        this.handleDemosList(player, msg.limit ?? 64);
        break;
      default:
        console.log(`[LobbyServer] Unknown message type: ${msg.type}`);
    }
  }

  // ── Auth ─────────────────────────────────────────────────────

  private handleAuth(player: ConnectedPlayer, name: string): void {
    player.name = name || `Player${player.id.slice(2)}`;
    player.authenticated = true;
    console.log(`[LobbyServer] Authenticated: ${player.name} (${player.id})`);

    // Send welcome with all initial data
    const welcome = {
      type: "welcome",
      playerId: player.id,
      gametypes: this.gametypes,
      onlinePlayers: this.getOnlinePlayers(),
      chatHistory: this.chatHistory,
      liveMatches: this.getLiveMatches(),
      recentDemos: this._demoCache.slice(0, 10),
    };
    this.send(player, welcome);

    // Broadcast new player to others
    this.broadcast(
      {
        type: "player:join",
        player: { id: player.id, name: player.name, status: player.status },
      },
      player.id,
    );
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

  // ── Lobby: Create ────────────────────────────────────────────

  private handleLobbyCreate(player: ConnectedPlayer, gametypeId: string): void {
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

    const lobby = new MatchLobby(gametype, this.mapNames);
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

  private handleLobbyJoin(player: ConnectedPlayer, lobbyId: string): void {
    if (player.lobbyId) {
      this.send(player, { type: "lobby:error", error: "Already in a lobby." });
      return;
    }

    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      this.send(player, { type: "lobby:error", error: `Lobby not found: ${lobbyId}` });
      return;
    }

    if (lobby.players.size >= lobby.gametype.maxPlayers) {
      this.send(player, { type: "lobby:error", error: "Lobby is full." });
      return;
    }

    const lobbyPlayer = lobby.addPlayer(player);
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

  // ── Lobby: Leave ─────────────────────────────────────────────

  private handleLobbyLeave(player: ConnectedPlayer, lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;

    lobby.removePlayer(player.id);
    player.lobbyId = null;
    player.status = "online";

    console.log(`[LobbyServer] ${player.name} left lobby ${lobbyId}`);

    // Notify remaining lobby members
    this.broadcastToLobby(lobbyId, {
      type: "lobby:player_left",
      playerId: player.id,
    });

    // Destroy empty lobbies
    if (lobby.players.size === 0) {
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

  // ── Lobby: Vote Map ──────────────────────────────────────────

  private handleLobbyVoteMap(player: ConnectedPlayer, lobbyId: string, mapName: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id)) return;

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
    if (!lobby || !lobby.players.has(player.id)) return;

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

  // ── Lobby: Shuffle Vote ──────────────────────────────────────

  private handleLobbyVoteShuffle(player: ConnectedPlayer, lobbyId: string): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(player.id)) return;

    const result = lobby.voteShuffle(player.id);

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

  /** Find an existing lobby of this gametype that still has room */
  private findWaitingLobby(gametypeId: string): MatchLobby | undefined {
    for (const lobby of this.lobbies.values()) {
      if (lobby.gametype.id === gametypeId && lobby.playerCount < lobby.gametype.maxPlayers && !lobby.isStarting) {
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
    lobby.state = "playing";
    lobby.matchMap = map;
    this.broadcastMatchesUpdate();

    try {
      // Spawn game server as child process
      const server = await this.spawner.spawn({
        map,
        gametype: gametypeId,
        maxClients: lobby.gametype.maxPlayers,
      });

      // Track matchId → lobbyId mapping for cleanup
      this.matchToLobby.set(server.matchId, lobby.id);

      // Store server URL on lobby for spectator discovery
      lobby.serverUrl = server.url;

      // Send connect URL to all lobby players
      this.broadcastToLobby(lobby.id, {
        type: "lobby:connect",
        serverUrl: server.url,
        map,
        gametype: gametypeId,
      });

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

  private handleServerExit(matchId: string, code: number | null): void {
    const lobbyId = this.matchToLobby.get(matchId);
    this.matchToLobby.delete(matchId);

    console.log(`[LobbyServer] Game server exited: match=${matchId} lobby=${lobbyId} code=${code}`);

    if (!lobbyId) return;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;

    // Notify lobby players that match ended
    this.broadcastToLobby(lobbyId, {
      type: "match:ended",
      matchId,
      exitCode: code,
    });

    // Return lobby to waiting state
    lobby.state = "waiting";
    lobby.matchMap = "";

    // Return all players to online status
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
        const mapPk3Names = files
          .filter((f) => f.startsWith("map_") && f.endsWith(".pk3"))
          .map((f) => f.slice(4, -4)); // "map_wdm2.pk3" → "wdm2"
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
          const onDisk = availableOnDisk === null || availableOnDisk.has(name);
          return inManifest && onDisk;
        })
        .map(([name]) => name);

      if (mapPool.length === 0) {
        console.warn(`[LobbyServer] Gametype "${shell.id}" has no available maps`);
      } else {
        console.log(`[LobbyServer] ${shell.id}: ${mapPool.join(", ")}`);
      }

      return { ...shell, mapPool };
    });
  }

  // ── Demo Scanning ────────────────────────────────────────────

  private handleDemosList(player: ConnectedPlayer, limit: number): void {
    const demos = this._demoCache.slice(0, Math.min(limit, 64));
    this.send(player, { type: "demos:list_response", demos });
  }

  /**
   * Scan public/data/demos/ for .shagdemo files and parse their headers.
   * Results are cached and sorted newest-first.
   */
  private _scanDemos(): void {
    try {
      if (!fs.existsSync(this.DEMO_DIR)) {
        this._demoCache = [];
        return;
      }

      const files = fs
        .readdirSync(this.DEMO_DIR)
        .filter((f) => f.endsWith(".shagdemo"))
        .sort()
        .reverse(); // newest first by filename (contains date)

      const demos: DemoInfo[] = [];

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
            demos.push({
              filename,
              map: header.map,
              mapDisplayName: this.mapNames[header.map] || header.map,
              gametype: header.gametype,
              players: header.players.map((p) => p.name),
              durationMs,
              date: header.startTime,
              sizeMB: parseFloat((stat.size / (1024 * 1024)).toFixed(2)),
              levelshot: `/data/levelshots/${header.map}.png`,
            });
          }
        } catch (err) {
          console.warn(`[LobbyServer] Failed to parse demo: ${filename}`, (err as Error).message);
        }
      }

      this._demoCache = demos;
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
        lobbyId: p.lobbyId || undefined,
      }));
  }

  // ── Live Matches ────────────────────────────────────────────

  private getLiveMatches(): LiveMatchInfo[] {
    const matches: LiveMatchInfo[] = [];
    for (const lobby of this.lobbies.values()) {
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
    this.broadcast({
      type: "matches:update",
      matches: this.getLiveMatches(),
    });
  }
}
