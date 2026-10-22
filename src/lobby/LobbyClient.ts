/**
 * LobbyClient — Browser-side WebSocket client for the lobby server
 *
 * Connects to the lobby server and provides an event-based API for
 * the UI to interact with (chat, lobbies, matchmaking).
 *
 * Usage:
 *   const client = new LobbyClient();
 *   await client.connect('ws://localhost:9000');
 *   await logIn(client);   // AccountSession: sends the stored key, keeps a new one
 *   client.on('chat:message', (data) => { ... });
 */

import { devLog } from "../engine/core/DevLog";
import type { HistoryPage, StatsQuery, StatsSummary } from "./PlayerStatsStore";
import type {
  FeaturedDemosResponse,
  LeaderboardResponse,
  LobbyMessage,
  LobbyServerMessages,
  SeatReissueResponse,
  SettingsDataMessage,
  SettingsErrorCode,
  SettingsSavedMessage,
} from "./types";

/** How long to wait for a connection before telling the caller it failed. */
const CONNECT_TIMEOUT_MS = 20_000;

/** What the client itself emits about its connection; no server message shares these names. */
export interface LobbyConnectionEvents {
  _connected: Record<string, never>;
  _disconnected: { reason: string; code: number };
  _error: { error: string };
}

/** Everything `on` can hear by name, and what each handler receives. */
export type LobbyEvents = LobbyServerMessages & LobbyConnectionEvents;

/** A stored handler. `on` types each one by its event; the store holds them all alike. */
type MessageHandler = (msg: unknown) => void;

/** `_disconnected` reason when this client closed the connection itself, as when switching accounts. */
export const CLIENT_DISCONNECT_REASON = "Client disconnect";

export class LobbyClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private cancelConnect: ((error: Error) => void) | null = null;
  private demoRequestSerial = 0;

  private _connected: boolean = false;

  /** Whether the client is connected to the lobby server */
  get connected(): boolean {
    return this._connected;
  }

  // ── Connection ───────────────────────────────────────────────

  /**
   * Open a connection, giving up after `timeoutMs`. Browsers delay repeated
   * connections to the same host, so a reconnect can sit unanswered for a
   * while; callers get an error rather than a promise that never settles.
   */
  async connect(url: string, timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<void> {
    this.disconnect();
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        let settled = false;
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (this.cancelConnect === cancel) this.cancelConnect = null;
          if (error) reject(error);
          else resolve();
        };
        const cancel = (error: Error) => settle(error);
        this.cancelConnect = cancel;
        const timer = setTimeout(() => {
          if (this.ws !== ws) return;
          this.ws = null;
          settle(new Error(`Lobby server did not answer in ${Math.round(timeoutMs / 1000)}s`));
          ws.close();
        }, timeoutMs);
        // A socket this client has since replaced or closed speaks no more:
        // its late close must not report the new connection as lost
        const current = () => this.ws === ws;

        ws.onopen = () => {
          if (!current()) return;
          this._connected = true;
          devLog("[LobbyClient] Connected to lobby server");
          this.emit("_connected", {});
          settle();
        };

        ws.onmessage = (event) => {
          if (!current()) return;
          try {
            const msg = JSON.parse(event.data) as LobbyMessage;
            this.emit(msg.type, msg);
          } catch (err) {
            console.error("[LobbyClient] Parse error:", err);
          }
        };

        ws.onclose = (event) => {
          if (!current()) return;
          this.ws = null;
          this._connected = false;
          settle(new Error(`Lobby connection closed before opening: ${event.reason || event.code}`));
          devLog(`[LobbyClient] Disconnected: ${event.reason || event.code}`);
          this.emit("_disconnected", { reason: event.reason, code: event.code });
        };

        ws.onerror = () => {
          if (!current()) return;
          const err = new Error("WebSocket connection error");
          this._connected = false;
          this.emit("_error", { error: err.message });
          settle(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Close the connection. Listeners hear `_disconnected` now, not when the socket finishes closing. */
  disconnect(): void {
    const cancel = this.cancelConnect;
    this.cancelConnect = null;
    const ws = this.ws;
    const wasConnected = this._connected;
    this.ws = null;
    this._connected = false;
    cancel?.(new Error("Lobby connection cancelled"));
    devLog("[LobbyClient] Closing the connection");
    ws?.close(1000, CLIENT_DISCONNECT_REASON);
    if (wasConnected) this.emit("_disconnected", { reason: CLIENT_DISCONNECT_REASON, code: 1000 });
  }

  // ── Auth ─────────────────────────────────────────────────────

  /**
   * Log in with the player's key, or without one to get a new account.
   * AccountSession.logIn wraps this and handles the answer.
   */
  auth(key?: string): void {
    this.send({ type: "auth", key });
  }

  /** Ask for a new name for this account; the answer is identity:renamed or identity:error. */
  rename(name: string): void {
    this.send({ type: "identity:rename", name });
  }

  /** Delete this account for good; the answer is identity:deleted or identity:error. */
  deleteAccount(key: string, confirmed: boolean): void {
    this.send({ type: "identity:delete", key, confirmed });
  }

  // ── Chat ─────────────────────────────────────────────────────

  chatSend(text: string): void {
    this.send({ type: "chat:send", text });
  }

  /** Send to members of one match room. The server verifies membership. */
  roomChatSend(lobbyId: string, text: string): void {
    this.send({ type: "lobby:chat_send", lobbyId, text });
  }

  // ── Lobby ────────────────────────────────────────────────────

  createLobby(gametype: string, visibility: "public" | "private" = "public"): void {
    this.send({ type: "lobby:create", gametype, visibility });
  }

  joinLobby(lobbyId: string, inviteToken?: string): void {
    this.send({ type: "lobby:join", lobbyId, inviteToken });
  }

  leaveLobby(lobbyId: string): void {
    this.send({ type: "lobby:leave", lobbyId });
  }

  voteMap(lobbyId: string, map: string): void {
    this.send({ type: "lobby:vote_map", lobbyId, map });
  }

  setReady(lobbyId: string, ready: boolean): void {
    this.send({ type: "lobby:ready", lobbyId, ready });
  }

  voteShuffle(lobbyId: string): void {
    this.send({ type: "lobby:vote_shuffle", lobbyId });
  }

  /** Move yourself to the other side. No vote — it affects only you. */
  switchTeam(lobbyId: string): void {
    this.send({ type: "lobby:switch_team", lobbyId });
  }

  /** Ask the server to spawn an AI bot opponent into this lobby. */
  inviteBot(lobbyId: string, difficulty?: string): void {
    this.send({ type: "lobby:invite_bot", lobbyId, difficulty });
  }

  async spawnDevServer(
    map: string,
    gametype: string,
    // Longer than the spawner gives a server to start (45 s by default): a
    // shorter wait gives up on servers the lobby then reports ready.
    timeoutMs: number = 60_000,
    /** Name of a training demo to record on the spawned server. */
    trainingDemo?: string,
  ): Promise<{
    serverUrl: string;
    map: string;
    gametype: string;
    matchId: string;
  }> {
    const requestId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup: (() => void)[] = [];

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new Error(`Timed out waiting for lobby server to spawn ${map}`)));
      }, timeoutMs);

      cleanup.push(
        this.on("dev:server_spawned", (msg) => {
          if (msg.requestId !== requestId) return;
          finish(() =>
            resolve({
              serverUrl: msg.serverUrl,
              map: msg.map,
              gametype: msg.gametype,
              matchId: msg.matchId,
            }),
          );
        }),
      );

      cleanup.push(
        this.on("dev:server_spawn_failed", (msg) => {
          if (msg.requestId !== requestId) return;
          finish(() => reject(new Error(msg.error || "Lobby server failed to spawn server")));
        }),
      );

      cleanup.push(
        this.on("_disconnected", () => {
          finish(() => reject(new Error("Lobby server disconnected while spawning server")));
        }),
      );

      this.send({ type: "dev:spawn_server", requestId, map, gametype, ...(trainingDemo ? { trainingDemo } : {}) });
    });
  }

  // ── Matchmaking Queue ───────────────────────────────────────

  joinQueue(gametype: string): void {
    this.send({ type: "queue:join", gametype });
  }

  leaveQueue(): void {
    this.send({ type: "queue:leave" });
  }

  // ── Demo Archive ────────────────────────────────────────────

  requestDemoList(limit: number = 64, scope: "latest" | "yours" = "latest"): string {
    const requestId = `demos_${++this.demoRequestSerial}`;
    this.send({ type: "demos:list", limit, scope, requestId });
    return requestId;
  }

  requestFeaturedDemos(
    query: { gametype?: string; map?: string; limit: number },
    timeoutMs = 10_000,
  ): Promise<FeaturedDemosResponse> {
    if (!this.connected) return Promise.reject(new Error("Lobby is offline"));
    const requestId = `feat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("Featured demos request timed out"))), timeoutMs);
      cleanup.push(
        this.on("featured:page", (msg: FeaturedDemosResponse) => {
          if (msg.requestId === requestId) finish(() => resolve(msg));
        }),
      );
      cleanup.push(
        this.on("featured:error", (msg) => {
          if (msg.requestId === requestId) finish(() => reject(new Error(`Featured demos: ${msg.reason}`)));
        }),
      );
      cleanup.push(this.on("_disconnected", () => finish(() => reject(new Error("Lobby disconnected")))));
      this.send({ type: "featured:get", requestId, ...query });
    });
  }

  /** A bounded, account-scoped ranking read; listeners are released on every outcome. */
  requestLeaderboard(
    query: {
      gametype: string;
      period: "month" | "all";
      offset: number;
      limit: number;
      scope?: "public" | "private";
      system?: "trueskill";
    },
    timeoutMs = 10_000,
  ): Promise<LeaderboardResponse> {
    if (!this.connected) return Promise.reject(new Error("Lobby is offline"));
    const requestId = `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("Leaderboard request timed out"))), timeoutMs);
      cleanup.push(
        this.on("leaderboard:page", (msg: LeaderboardResponse) => {
          if (msg.requestId !== requestId) return;
          finish(() => {
            if (msg.scope !== (query.scope ?? "public")) reject(new Error("Leaderboard: ranking_scope_mismatch"));
            else if (query.system && msg.system !== query.system)
              reject(new Error("Leaderboard: ranking_system_mismatch"));
            else resolve(msg);
          });
        }),
      );
      cleanup.push(
        this.on("leaderboard:error", (msg) => {
          if (msg.requestId === requestId) finish(() => reject(new Error(`Leaderboard: ${msg.reason}`)));
        }),
      );
      cleanup.push(this.on("_disconnected", () => finish(() => reject(new Error("Lobby disconnected")))));
      this.send({ type: "leaderboard:get", requestId, ...query });
    });
  }

  requestPlayerStats(query: StatsQuery, timeoutMs = 10_000): Promise<StatsSummary> {
    return this.requestStatsData("stats:get", query, timeoutMs);
  }
  requestMatchHistory(
    query: Pick<StatsQuery, "gametype" | "scope"> & { limit?: number; beforeSequence?: number },
    timeoutMs = 10_000,
  ): Promise<HistoryPage> {
    return this.requestStatsData("stats:history", query, timeoutMs);
  }
  private requestStatsData<T>(
    type: "stats:get" | "stats:history",
    query: { gametype: string; scope: string; period?: string; limit?: number; beforeSequence?: number },
    timeoutMs: number,
  ): Promise<T> {
    if (!this.connected) return Promise.reject(new Error("Lobby is offline"));
    const requestId = `stats_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("Player stats request timed out"))), timeoutMs);
      cleanup.push(
        this.on(type === "stats:get" ? "stats:summary" : "stats:history_page", (msg) => {
          if (msg.requestId !== requestId) return;
          finish(() => {
            if (
              msg.scope !== query.scope ||
              msg.gametype !== query.gametype ||
              msg.data?.scope !== query.scope ||
              msg.data?.gametype !== query.gametype ||
              (type === "stats:get" && (msg.data as Partial<StatsSummary> | undefined)?.period !== query.period)
            )
              reject(new Error("Player stats response mismatch"));
            else resolve(msg.data as T);
          });
        }),
      );
      cleanup.push(
        this.on("stats:error", (msg) => {
          if (msg.requestId === requestId) finish(() => reject(new Error(`Player stats: ${msg.reason}`)));
        }),
      );
      cleanup.push(this.on("_disconnected", () => finish(() => reject(new Error("Lobby disconnected")))));
      this.send({ type, requestId, ...query });
    });
  }

  /** This account's synced settings, as the lobby last saved them. */
  requestSettings(timeoutMs = 10_000): Promise<SettingsDataMessage> {
    return this.settingsRequest<SettingsDataMessage>("settings:data", { type: "settings:get" }, timeoutMs);
  }

  /** Replace this account's synced settings; resolves with the lobby's save time. */
  saveSettings(settings: string, timeoutMs = 10_000): Promise<SettingsSavedMessage> {
    return this.settingsRequest<SettingsSavedMessage>("settings:saved", { type: "settings:save", settings }, timeoutMs);
  }

  /** Rejects with `Settings: <code>` (a SettingsErrorCode) when the lobby refuses. */
  private settingsRequest<T extends LobbyMessage>(answer: string, msg: LobbyMessage, timeoutMs: number): Promise<T> {
    if (!this.connected) return Promise.reject(new Error("Lobby is offline"));
    const requestId = `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("Settings request timed out"))), timeoutMs);
      cleanup.push(
        this.on(answer, (reply: T) => {
          if (reply.requestId === requestId) finish(() => resolve(reply));
        }),
      );
      cleanup.push(
        this.on("settings:error", (reply: { requestId: string; code: SettingsErrorCode }) => {
          if (reply.requestId === requestId) finish(() => reject(new Error(`Settings: ${reply.code}`)));
        }),
      );
      cleanup.push(this.on("_disconnected", () => finish(() => reject(new Error("Lobby disconnected")))));
      this.send({ ...msg, requestId });
    });
  }

  /** Ask for the one reserved replacement for this authenticated account's unplayed seat. */
  requestSeatReissue(matchId: string, timeoutMs = 10_000): Promise<SeatReissueResponse> {
    if (!this.connected) return Promise.reject(new Error("Lobby is offline"));
    const requestId = `seat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const unsub of cleanup) unsub();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("Seat recovery timed out"))), timeoutMs);
      cleanup.push(
        this.on("match:seat_reissued", (msg: SeatReissueResponse) => {
          if (msg.requestId === requestId && msg.matchId === matchId) finish(() => resolve(msg));
        }),
      );
      cleanup.push(
        this.on("match:seat_reissue_error", (msg) => {
          if (msg.requestId === requestId) finish(() => reject(new Error("Seat recovery unavailable")));
        }),
      );
      cleanup.push(this.on("_disconnected", () => finish(() => reject(new Error("Lobby disconnected")))));
      this.send({ type: "match:seat_reissue", requestId, matchId });
    });
  }

  // ── Event Handling ──────────────────────────────────────────

  /**
   * Subscribe to a message type.
   * Returns an unsubscribe function.
   */
  on<K extends keyof LobbyEvents>(type: K, handler: (msg: LobbyEvents[K]) => void): () => void;
  on<T extends LobbyMessage = LobbyMessage>(type: string, handler: (msg: T) => void): () => void;
  on(type: string, typedHandler: (msg: never) => void): () => void {
    const handler = typedHandler as MessageHandler;
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);

    return () => {
      const arr = this.handlers.get(type);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /** Subscribe to a message type, but only fire once */
  once<K extends keyof LobbyEvents>(type: K, handler: (msg: LobbyEvents[K]) => void): () => void;
  once<T extends LobbyMessage = LobbyMessage>(type: string, handler: (msg: T) => void): () => void;
  once(type: string, typedHandler: (msg: never) => void): () => void {
    const handler = typedHandler as MessageHandler;
    const unsub = this.on(type, (msg: LobbyMessage) => {
      unsub();
      handler(msg);
    });
    return unsub;
  }

  // ── Internals ───────────────────────────────────────────────

  private send(msg: LobbyMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn("[LobbyClient] Not connected, dropping message:", msg.type);
    }
  }

  private emit(type: string, msg: unknown): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      // A copy: a handler that unsubscribes itself (every once()) removes its
      // entry mid-loop, and walking the live array would then skip the next.
      for (const handler of [...handlers]) {
        try {
          handler(msg);
        } catch (err) {
          console.error(`[LobbyClient] Handler error for '${type}':`, err);
        }
      }
    }

    // Also emit to wildcard '*' handlers for debugging
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(msg);
        } catch (_err) {
          // ignore
        }
      }
    }
  }
}
