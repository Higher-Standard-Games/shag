/**
 * BotClient - Headless network client for a single bot
 *
 * Connects to a game server via WebSocket, receives snapshots,
 * runs BotBrain AI decisions, and sends input commands.
 *
 * Based on src/cli/headless-netclient.ts but with:
 * - BotBrain integration for AI decisions
 * - BotGameState for world perception
 * - Proper protocol flow (Join → JoinGame → Game Loop)
 * - Death/respawn handling
 * - Human-like input timing with configurable delay
 * - Team auto-balance on join
 */

import { WebSocket } from 'ws';
import { MessageCodec, MessageType } from '../engine/network/protocol/MessageCodec';
import { GameState } from '../engine/network/core/GameState';
import { BotGameState } from './BotGameState';
import { BotBrain, type BotInput } from './BotBrain';
import { StateMachineBrain } from './StateMachineBrain';
import { type BotOptions, type BotDifficulty, resolveDifficulty } from './BotConfig';
import type { BotVision, VisionResult } from './BotVision';
import { EventEmitter } from 'events';

// ── Types ───────────────────────────────────────────────────────────────

interface ServerInfo {
    serverId: string;
    serverName: string;
    map: string;
    tickRate: number;
    maxPlayers: number;
    currentPlayers: number;
}

export type BotClientState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'spectating'
    | 'joining'
    | 'playing'
    | 'dead';

// ── BotClient ───────────────────────────────────────────────────────────

export class BotClient extends EventEmitter {
    /** Unique ID for this bot instance */
    readonly id: string;
    /** Display name */
    readonly name: string;

    // Connection state
    private _state: BotClientState = 'disconnected';
    private _ws: WebSocket | null = null;

    // Protocol state
    private _playerId: string = '';
    private _entityId: string = '';
    private _serverInfo: ServerInfo | null = null;
    private _sequence: number = 0;
    private _tickCount: number = 0;
    private _lastSnapshotTick: number = 0;

    // Snapshot baseline for delta decompression
    private _baseline: GameState | undefined;

    // AI
    private _brain: BotBrain;
    private _gameState: BotGameState;
    private _difficulty: BotDifficulty;

    // Human-feel timing
    private _lastInputTime: number = 0;
    private _minInputIntervalMs: number; // Per-bot randomized input rate

    // Death/respawn
    private _isDead: boolean = false;
    private _deathTime: number = 0;
    private _respawnDelayMs: number;

    // Options
    private _team: string | undefined;

    // Vision (shared across bots on same map)
    private _vision: BotVision | null = null;
    private _lastVisionResult: VisionResult | null = null;

    // Logging
    private _logPrefix: string;

    constructor(options: BotOptions) {
        super();

        this.id = `bot_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        this.name = options.name;
        this._team = options.team;

        // Resolve difficulty
        this._difficulty = resolveDifficulty(options.difficulty);

        // Create AI brain
        this._brain = new StateMachineBrain(this._difficulty);

        // Create game state tracker
        this._gameState = new BotGameState();

        // Human-feel: randomize input interval per bot (30-80ms = ~12-33Hz)
        this._minInputIntervalMs = 30 + Math.random() * 50;
        this._respawnDelayMs = 1500 + Math.random() * 2000; // 1.5-3.5 sec respawn delay

        this._logPrefix = `[Bot:${this.name}]`;
    }

    // ── Public API ────────────────────────────────────────────────────

    get state(): BotClientState { return this._state; }
    get serverInfo(): ServerInfo | null { return this._serverInfo; }
    get playerId(): string { return this._playerId; }
    get entityId(): string { return this._entityId; }
    get brainState(): string { return this._brain.getState(); }

    /**
     * Set the vision system (shared per map).
     * Call after construction, before connect.
     */
    setVision(vision: BotVision | null): void {
        this._vision = vision;
    }

    /**
     * Connect to a game server.
     * Returns a promise that resolves when connection is established
     * and the bot has joined the game.
     */
    async connect(serverUrl: string): Promise<void> {
        if (this._state !== 'disconnected') {
            throw new Error(`${this._logPrefix} Already connected (state: ${this._state})`);
        }

        this._state = 'connecting';
        console.log(`${this._logPrefix} Connecting to ${serverUrl}...`);

        return new Promise<void>((resolve, reject) => {
            try {
                this._ws = new WebSocket(serverUrl);
                this._ws.binaryType = 'arraybuffer';

                let settled = false;
                const connectTimeout = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error(`${this._logPrefix} Connection timeout`));
                        this.disconnect();
                    }
                }, 10000);

                this._ws.on('open', () => {
                    console.log(`${this._logPrefix} WebSocket connected, sending Join...`);
                    this._state = 'connected';
                    // Send Join immediately — server expects it before sending Welcome
                    this._sendJoin();
                });

                this._ws.on('message', (data: Buffer) => {
                    try {
                        const uint8 = new Uint8Array(data);
                        const resolved = this._handleMessage(uint8);
                        if (resolved && !settled) {
                            settled = true;
                            clearTimeout(connectTimeout);
                            resolve();
                        }
                    } catch (err) {
                        console.error(`${this._logPrefix} Message handling error:`, err);
                    }
                });

                this._ws.on('close', (code, _reason) => {
                    clearTimeout(connectTimeout);
                    console.log(`${this._logPrefix} Disconnected: ${code}`);
                    this._state = 'disconnected';
                    this.emit('disconnected', code);
                    if (!settled) {
                        settled = true;
                        reject(new Error(`${this._logPrefix} Connection closed before ready: ${code}`));
                    }
                });

                this._ws.on('error', (err) => {
                    clearTimeout(connectTimeout);
                    console.error(`${this._logPrefix} Connection error:`, err.message);
                    this._state = 'disconnected';
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                });

            } catch (err) {
                this._state = 'disconnected';
                reject(err);
            }
        });
    }

    /** Disconnect from the server */
    async disconnect(): Promise<void> {
        if (this._ws) {
            console.log(`${this._logPrefix} Disconnecting...`);
            this._ws.close();
            this._ws = null;
        }
        this._state = 'disconnected';
        this._baseline = undefined;

        // Reset all mutable state for potential reuse
        this._playerId = '';
        this._entityId = '';
        this._sequence = 0;
        this._tickCount = 0;
        this._lastSnapshotTick = 0;
        this._isDead = false;
        this._deathTime = 0;
        this._lastInputTime = 0;
        this._lastVisionResult = null;
    }

    /** Update difficulty settings */
    setDifficulty(difficulty: string | BotDifficulty): void {
        this._difficulty = resolveDifficulty(difficulty);
        this._brain.setDifficulty(this._difficulty);
    }

    // ── Message Handling ──────────────────────────────────────────────

    /**
     * Handle an incoming message. Returns true if the bot has fully joined
     * (used to resolve the connect() promise).
     */
    private _handleMessage(data: Uint8Array): boolean {
        const messageType = MessageCodec.peekMessageType(data);

        switch (messageType) {
            case MessageType.Welcome:
                return this._handleWelcome(data);

            case MessageType.JoinAccept:
                return this._handleJoinAccept(data);

            case MessageType.JoinReject:
                console.log(`${this._logPrefix} Join rejected!`);
                this.disconnect();
                return false;

            case MessageType.Snapshot:
                this._handleSnapshot(data);
                return false;

            case MessageType.PlayerJoined:
            case MessageType.PlayerLeft:
            case MessageType.GameStart:
                // Informational — ignore for now
                return false;

            default:
                // Unknown message type — ignore
                return false;
        }
    }

    private _handleWelcome(data: Uint8Array): boolean {
        const welcome = MessageCodec.decodeWelcome(data);
        this._serverInfo = {
            serverId: welcome.serverId,
            serverName: welcome.serverName,
            map: welcome.map,
            tickRate: welcome.tickRate,
            maxPlayers: welcome.maxPlayers,
            currentPlayers: welcome.currentPlayers,
        };

        console.log(`${this._logPrefix} Welcome from "${welcome.serverName}" (map: ${welcome.map}, ${welcome.currentPlayers}/${welcome.maxPlayers})`);

        // Join was already sent on connect — just store server info
        return false;
    }

    private _handleJoinAccept(data: Uint8Array): boolean {
        const accept = MessageCodec.decodeJoinAccept(data);
        this._playerId = accept.playerId;
        this._entityId = accept.entityId;

        // Update game state identity
        this._gameState.selfEntityId = this._entityId;
        this._gameState.selfPlayerId = this._playerId;

        console.log(`${this._logPrefix} Join accepted: playerId=${this._playerId}, entityId=${this._entityId}`);

        if (this._state === 'connected' || this._state === 'spectating') {
            // First JoinAccept — we're spectating, now send JoinGame
            this._state = 'spectating';
            this._sendJoinGame();
            return false;
        }

        if (this._state === 'joining') {
            // Second JoinAccept (after JoinGame) — we're in the game!
            this._state = 'playing';
            console.log(`${this._logPrefix} ✓ Joined game! Playing as entity ${this._entityId}`);
            this.emit('joined');
            return true;
        }

        return false;
    }

    private _handleSnapshot(data: Uint8Array): void {
        try {
            // Decode snapshot with baseline for delta decompression
            const snapshot = MessageCodec.decodeSnapshot(data, this._baseline);
            this._tickCount++;

            // Send acknowledgment
            this._sendAck(snapshot.tick);

            // Update game state from snapshot
            this._gameState.update(snapshot);

            // Store as baseline for next decode
            this._baseline = snapshot;
            this._lastSnapshotTick = snapshot.tick;

            // Only run game logic if we're actually in the game
            if (this._state !== 'playing' && this._state !== 'dead') {
                return;
            }

            // Handle death/respawn
            if (this._gameState.self.isDead && !this._isDead) {
                this._isDead = true;
                this._deathTime = Date.now();
                this._state = 'dead';
                console.log(`${this._logPrefix} Died! Waiting ${(this._respawnDelayMs / 1000).toFixed(1)}s to respawn...`);
            }

            // Server confirmed we're alive again after being dead
            if (this._isDead && !this._gameState.self.isDead) {
                this._isDead = false;
                this._state = 'playing';
                console.log(`${this._logPrefix} Respawned!`);
            }

            if (this._isDead) {
                // Check if respawn delay has passed
                if (Date.now() - this._deathTime > this._respawnDelayMs) {
                    this._sendRequestSpawn();
                    // Don't clear _isDead here — wait for server confirmation
                    // Reset deathTime to avoid spamming (retry every respawnDelay)
                    this._deathTime = Date.now();
                }
                return; // Don't send input while dead
            }

            // ── AI Decision ─────────────────────────────────────────────
            // Apply human-like input delay
            const now = Date.now();
            if (now - this._lastInputTime < this._minInputIntervalMs) {
                return; // Rate limit input
            }

            // Run vision query if available
            if (this._vision) {
                this._lastVisionResult = this._vision.getVisibleState(this._gameState);
            }

            const input = this._brain.decide(this._gameState, this._vision, this._lastVisionResult);
            this._sendInput(input);
            this._lastInputTime = now;

            // Periodic logging
            if (this._tickCount % 300 === 0) {
                const brain = this._brain.getState();
                const hp = this._gameState.self.health;
                const enemies = this._gameState.players.filter(p => !p.isDead).length;
                const visionInfo = this._lastVisionResult
                    ? ` Vis:${this._lastVisionResult.visibleEnemies.length}/${this._lastVisionResult.tracesPerformed}t`
                    : ' (no vision)';
                console.log(`${this._logPrefix} [${brain}] HP:${hp} Enemies:${enemies}${visionInfo} Tick:${snapshot.tick}`);
            }

        } catch (err) {
            console.error(`${this._logPrefix} Snapshot processing error:`, err);
        }
    }

    // ── Send Messages ─────────────────────────────────────────────────

    private _send(data: Uint8Array): void {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(data);
        }
    }

    private _sendJoin(): void {
        console.log(`${this._logPrefix} Sending Join...`);
        this._send(MessageCodec.encodeJoin(this.name));
    }

    private _sendJoinGame(): void {
        this._state = 'joining';

        // For team gametypes: pick the smaller team
        let teamId = this._team;
        if (!teamId) {
            teamId = this._gameState.getSmallerTeam();
        }

        console.log(`${this._logPrefix} Sending JoinGame (team: ${teamId || 'auto'})...`);
        this._send(MessageCodec.encodeJoinGame(teamId));
    }

    private _sendAck(tick: number): void {
        this._send(MessageCodec.encodeAck(tick));
    }

    private _sendRequestSpawn(): void {
        console.log(`${this._logPrefix} Requesting respawn...`);
        this._send(MessageCodec.encodeRequestSpawn());
    }

    private _sendInput(input: BotInput): void {
        if (!this._playerId) return;

        const command = {
            direction: input.direction,
            pitch: input.pitch,
            yaw: input.yaw,
            buttons: input.buttons,
            weaponSlot: input.weaponSlot,
            tick: this._lastSnapshotTick,
        };

        const encoded = MessageCodec.encodeCommand(
            this._playerId,
            this._sequence++,
            command,
        );
        this._send(encoded);
    }
}
