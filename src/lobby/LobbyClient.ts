/**
 * LobbyClient — Browser-side WebSocket client for the lobby server
 *
 * Connects to the lobby server and provides an event-based API for
 * the UI to interact with (chat, lobbies, matchmaking).
 *
 * Usage:
 *   const client = new LobbyClient();
 *   await client.connect('ws://localhost:9000');
 *   client.auth('PlayerName');
 *   client.on('welcome', (data) => { ... });
 *   client.on('chat:message', (data) => { ... });
 */

import type { LobbyMessage } from "./types";

type MessageHandler = (msg: any) => void;

export class LobbyClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private _connected: boolean = false;

  /** Whether the client is connected to the lobby server */
  get connected(): boolean {
    return this._connected;
  }

  // ── Connection ───────────────────────────────────────────────

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this._connected = true;
          console.log("[LobbyClient] Connected to lobby server");
          this.emit("_connected", {});
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as LobbyMessage;
            this.emit(msg.type, msg);
          } catch (err) {
            console.error("[LobbyClient] Parse error:", err);
          }
        };

        this.ws.onclose = (event) => {
          this._connected = false;
          console.log(`[LobbyClient] Disconnected: ${event.reason || event.code}`);
          this.emit("_disconnected", { reason: event.reason, code: event.code });
        };

        this.ws.onerror = () => {
          const err = new Error("WebSocket connection error");
          this._connected = false;
          this.emit("_error", { error: err.message });
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this._connected = false;
  }

  // ── Auth ─────────────────────────────────────────────────────

  auth(name: string): void {
    this.send({ type: "auth", name });
  }

  // ── Chat ─────────────────────────────────────────────────────

  chatSend(text: string): void {
    this.send({ type: "chat:send", text });
  }

  // ── Lobby ────────────────────────────────────────────────────

  createLobby(gametype: string): void {
    this.send({ type: "lobby:create", gametype });
  }

  joinLobby(lobbyId: string): void {
    this.send({ type: "lobby:join", lobbyId });
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

  async spawnDevServer(map: string, gametype: string, timeoutMs: number = 30000): Promise<{
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

      this.send({ type: "dev:spawn_server", requestId, map, gametype });
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

  requestDemoList(limit: number = 64): void {
    this.send({ type: "demos:list", limit });
  }

  // ── Event Handling ──────────────────────────────────────────

  /**
   * Subscribe to a message type.
   * Returns an unsubscribe function.
   */
  on(type: string, handler: MessageHandler): () => void {
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
  once(type: string, handler: MessageHandler): () => void {
    const unsub = this.on(type, (msg) => {
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

  private emit(type: string, msg: any): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
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
