/**
 * BotLobbyClient — Connects a bot to the lobby server
 *
 * Speaks the same JSON WebSocket protocol as browser clients:
 *   1. Connects to lobby WS
 *   2. Authenticates with bot name
 *   3. Joins queue for specified gametype
 *   4. Auto-readies when placed in a lobby room
 *   5. When match starts (lobby:connect), creates BotClient to join game server
 *
 * Usage:
 *   const lobbyBot = new BotLobbyClient({ name: 'Tanuki', difficulty: 'medium' });
 *   await lobbyBot.connect('ws://localhost:9000', 'duel');
 *   // Bot handles everything from here — lobby → game transition is automatic
 */

import WebSocket from "ws";
import { BotClient } from "./BotClient";
import { type BotOptions, getNextBotName } from "./BotConfig";

export type LobbyBotState = "disconnected" | "connecting" | "authenticated" | "in_lobby" | "in_match";

export class BotLobbyClient {
  readonly id: string;
  readonly name: string;

  private _ws: WebSocket | null = null;
  private _state: LobbyBotState = "disconnected";
  private _lobbyId: string = "";
  private _joinLobbyId: string = ""; // when set, join this exact lobby instead of queueing
  private _gametype: string = "";
  private _botOptions: BotOptions;
  private _difficulty: BotOptions["difficulty"];

  // The game bot client created when match starts
  private _botClient: BotClient | null = null;

  // Callback for BotServer to track the spawned BotClient
  onGameBotCreated: ((bot: BotClient) => void) | null = null;
  onDisconnected: (() => void) | null = null;

  constructor(options?: Partial<BotOptions>) {
    this.name = options?.name || getNextBotName();
    this.id = `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._difficulty = options?.difficulty || "medium";
    this._botOptions = {
      name: this.name,
      difficulty: this._difficulty,
      team: options?.team,
      modelDir: options?.modelDir,
    };
  }

  get state(): LobbyBotState {
    return this._state;
  }
  get lobbyId(): string {
    return this._lobbyId;
  }
  get botClient(): BotClient | null {
    return this._botClient;
  }

  /**
   * Connect to lobby server. If `joinLobbyId` is given, join that exact lobby
   * (used by the in-lobby "Invite AI Bot" button); otherwise join the queue
   * for `gametype`.
   */
  async connect(lobbyUrl: string, gametype: string, joinLobbyId?: string): Promise<void> {
    this._gametype = gametype;
    this._joinLobbyId = joinLobbyId || "";
    this._state = "connecting";

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(lobbyUrl);
      this._ws = ws;

      const connectTimeout = setTimeout(() => {
        ws.close();
        this._state = "disconnected";
        reject(new Error(`Lobby connection timeout: ${lobbyUrl}`));
      }, 10000);

      ws.on("open", () => {
        clearTimeout(connectTimeout);
        console.log(`[LobbyBot:${this.name}] Connected to lobby ${lobbyUrl}`);

        // Step 1: Authenticate (flagged as a bot so the lobby can evict bots
        // once the last human leaves a lobby).
        this._send({ type: "auth", name: this.name, isBot: true });
      });

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg, resolve);
        } catch (err) {
          console.error(`[LobbyBot:${this.name}] Failed to parse message:`, err);
        }
      });

      ws.on("close", () => {
        clearTimeout(connectTimeout);
        console.log(`[LobbyBot:${this.name}] Lobby connection closed`);
        this._state = "disconnected";
        this._ws = null;
        this.onDisconnected?.();
      });

      ws.on("error", (err: Error) => {
        clearTimeout(connectTimeout);
        console.error(`[LobbyBot:${this.name}] Lobby WS error:`, err.message);
        if (this._state === "connecting") {
          this._state = "disconnected";
          reject(err);
        }
      });
    });
  }

  /**
   * Handle incoming lobby messages.
   */
  private _handleMessage(msg: any, onReady?: () => void): void {
    switch (msg.type) {
      case "welcome": {
        // Successfully authenticated — join a specific lobby or the queue
        this._state = "authenticated";
        if (this._joinLobbyId) {
          console.log(
            `[LobbyBot:${this.name}] Authenticated (id: ${msg.playerId}). Joining lobby: ${this._joinLobbyId}`,
          );
          this._send({ type: "lobby:join", lobbyId: this._joinLobbyId });
        } else {
          console.log(`[LobbyBot:${this.name}] Authenticated (id: ${msg.playerId}). Joining queue: ${this._gametype}`);
          this._send({ type: "queue:join", gametype: this._gametype });
        }
        onReady?.();
        break;
      }

      case "lobby:created": {
        // Placed in a lobby room (created or joined existing)
        this._state = "in_lobby";
        this._lobbyId = msg.lobby?.id || "";
        console.log(`[LobbyBot:${this.name}] In lobby ${this._lobbyId} (${this._gametype}). Auto-readying...`);

        // Small delay before readying up (human-feel)
        setTimeout(
          () => {
            if (this._state === "in_lobby" && this._lobbyId) {
              this._send({ type: "lobby:ready", lobbyId: this._lobbyId, ready: true });
              console.log(`[LobbyBot:${this.name}] Ready!`);
            }
          },
          500 + Math.random() * 1000,
        );
        break;
      }

      case "lobby:connect": {
        // Match is starting! Connect to game server
        const serverUrl = msg.serverUrl;
        console.log(`[LobbyBot:${this.name}] Match starting! Connecting to game server: ${serverUrl}`);
        this._state = "in_match";
        this._connectToGameServer(serverUrl);
        break;
      }

      case "lobby:kicked": {
        // The lobby evicted us (last human left). Tear down — this also
        // disconnects the in-game bot so a bot-only match doesn't linger.
        console.log(`[LobbyBot:${this.name}] Kicked from lobby: ${msg.reason || "no humans left"}. Disconnecting.`);
        this.disconnect().catch(() => {});
        break;
      }

      case "lobby:error": {
        console.error(`[LobbyBot:${this.name}] Lobby error: ${msg.error}`);
        break;
      }

      case "lobby:all_ready":
      case "lobby:starting":
      case "lobby:player_joined":
      case "lobby:player_updated":
      case "lobby:teams_shuffled":
      case "lobby:shuffle_progress":
      case "lobby:vote_update":
      case "player:join":
      case "player:leave":
      case "player:status":
      case "chat:message":
      case "chat:history":
      case "matches:update":
        // Silently ignore lobby UI messages
        break;

      default:
        // Ignore unknown messages
        break;
    }
  }

  /**
   * Create a BotClient and connect to the game server.
   * Includes retry logic because the game server process needs time to start listening.
   */
  private async _connectToGameServer(serverUrl: string): Promise<void> {
    const MAX_RETRIES = 5;
    const INITIAL_DELAY_MS = 2000; // Wait for game server to start
    const RETRY_DELAY_MS = 1500;

    // Wait for game server to finish starting up
    console.log(`[LobbyBot:${this.name}] Waiting ${INITIAL_DELAY_MS}ms for game server to start...`);
    await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const bot = new BotClient(this._botOptions);

        bot.on("disconnected", () => {
          console.log(`[LobbyBot:${this.name}] Game bot disconnected`);
          this._botClient = null;
        });

        await bot.connect(serverUrl);
        this._botClient = bot;
        console.log(`[LobbyBot:${this.name}] Game bot connected as ${bot.playerId}`);

        // Notify BotServer so it can track and load vision
        this.onGameBotCreated?.(bot);
        return;
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          console.log(
            `[LobbyBot:${this.name}] Connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.error(`[LobbyBot:${this.name}] Failed to connect after ${MAX_RETRIES} attempts:`, err.message);
        }
      }
    }
  }

  /**
   * Disconnect from lobby and game.
   */
  async disconnect(): Promise<void> {
    // Disconnect game bot first
    if (this._botClient) {
      await this._botClient.disconnect();
      this._botClient = null;
    }

    // Leave lobby
    if (this._ws && this._lobbyId) {
      this._send({ type: "lobby:leave", lobbyId: this._lobbyId });
    }

    // Close lobby connection
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._state = "disconnected";
    this._lobbyId = "";
  }

  private _send(msg: any): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }
}
