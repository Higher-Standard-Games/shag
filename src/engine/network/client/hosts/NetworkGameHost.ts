/**
 * NetworkGameHost.ts - Client-Side Network Game Host
 *
 * This is the client's connection to a multiplayer server. It handles three main jobs:
 *
 * 1. CLIENT-SIDE PREDICTION: When you press a key, you don't want to wait 50-100ms for
 *    the server to respond. So we run the same simulation locally to show immediate results.
 *
 * 2. RECONCILIATION: Our prediction will sometimes be wrong (collision we didn't know about,
 *    another player's action, etc.). When server snapshots arrive, we compare our prediction
 *    to the server's truth and correct any errors smoothly.
 *
 * 3. INTERPOLATION: Other players' positions come in discrete snapshots (e.g., 20 times/sec).
 *    We interpolate between snapshots for smooth movement instead of jerky updates.
 *
 * THE PREDICTION-RECONCILIATION DANCE:
 *
 *   Frame 1: Player presses W
 *            → Send command to server
 *            → Run prediction locally (instant feedback!)
 *            → Player sees: moved forward
 *
 *   Frame 2-5: More input, more prediction...
 *
 *   Frame 6: Server snapshot arrives (from Frame 1's input)
 *            → Compare: where server says we are vs where we predicted
 *            → If small error: smooth correction over time
 *            → If large error: snap to server position (teleport/death)
 *
 * WHY SMOOTH CORRECTION?
 *   Snapping to server position every frame looks terrible - the player jitters.
 *   Instead, we note the error and gradually nudge toward the correct position.
 *   Small errors (< 0.5 units) are ignored. Medium errors are smoothed. Large errors snap.
 */

import { MatchPhase } from "../../../../shared/server/gametype/GametypeTypes";
import { AudioManager } from "../../../AudioManager";
import type { Command } from "../../core/Command";
import type { PlayerId } from "../../core/Entity";
import type { GameEvent, GameState } from "../../core/GameState";
import type { IGameHost } from "../../core/IGameHost";
import type { Simulation, SimulationConfig } from "../../core/Simulation";
import { MessageCodec, MessageType } from "../../protocol/MessageCodec";
import { ClockSync } from "../ClockSync";
import { ConnectionWatchdog } from "../ConnectionWatchdog";
import { InterpolationBuffer } from "../InterpolationBuffer";
import { NetGraph } from "../NetGraph";
import { SmoothCorrection } from "../SmoothCorrection";
import { SnapshotReceiver } from "../SnapshotReceiver";
import type { Transport } from "../transport/Transport";

// Component shapes for typed access
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface TransformShape {
  position: Vec3;
  rotation?: { x: number; y: number; z: number; w: number };
}
interface MovementStateShape {
  ledgeGrabState?: string;
  isCrouching?: boolean;
  isSliding?: boolean;
}

/** How long to wait for a resume to be accepted before trying again. */
const RESUME_RETRY_MS = 2000;

/** Duck-type for simulations that support player spawning */
interface SpawnableSimulation {
  spawnPlayer(playerId: string): void;
}

/** Duck-type for simulations that support collision worlds */
interface CollisionCapableSimulation {
  setCollisionWorld(collision: unknown): void;
}

// SmoothCorrection and InterpolationBuffer are extracted into their own modules
// for testability. See ../SmoothCorrection.ts and ../InterpolationBuffer.ts

/**
 * Server info received on connection
 */
export interface ServerInfo {
  serverId: string;
  serverName: string;
  map: string;
  tickRate: number;
  maxPlayers: number;
  currentPlayers: number;
}

/**
 * Network game host - connects to remote server
 * Handles client prediction, snapshot interpolation, and smooth correction
 */
export class NetworkGameHost implements IGameHost {
  localPlayerId: PlayerId; // Updated from server JoinAccept
  localEntityId: string = ""; // Entity ID for local player
  currentTick: number = 0;

  private transport: Transport;
  private simulation: Simulation;
  private stateUpdateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: GameEvent) => void)[] = [];
  private serverInfoCallbacks: ((info: ServerInfo) => void)[] = [];
  private serverMessageCallbacks: ((msg: { type: string; message: string }) => void)[] = [];

  private interpolationBuffer = new InterpolationBuffer();
  private smoothCorrection = new SmoothCorrection();
  private pendingCommands: Command[] = [];
  private commandSequence = 1;
  private readonly snapshotReceiver = new SnapshotReceiver();

  /** Notices snapshots that stop arriving while the connection stays open. */
  private readonly watchdog = new ConnectionWatchdog();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** When the watchdog last ran; a longer gap means the client itself was not running. */
  private watchdogCheckedAt = 0;

  /** Where and as whom to reconnect, kept from the first connect. */
  private serverUrl: string | null = null;
  private playerName: string | null = null;
  /** The seat the server holds for this client after a drop, and for how long. */
  private resumeToken: string | null = null;
  private resumeGraceMs = 20000;
  /** Ticketed joins are not complete until the server sends the recovery token. */
  private waitForInitialResumeToken = false;
  /** True while reconnecting, so a stall and a close do not both start one. */
  private resuming = false;

  /** Redundant command buffer: store last N encoded payloads for packet loss resilience */
  private recentCommandPayloads: Uint8Array[] = [];
  private readonly COMMAND_REDUNDANCY = 3; // Send last 3 commands per packet

  /** When true, V2NetworkClient handles prediction - we only do network transport */
  private useExternalPrediction = false;

  /** ClockSync for NTP-like server time synchronization */
  readonly clockSync = new ClockSync();

  private lastMatchPhase: MatchPhase | null = null;

  private localState: GameState;
  private _isConnected: boolean = false;
  private _serverInfo: ServerInfo | null = null;
  private _onJoinAccept: (() => void) | null = null; // Called when JoinAccept received
  private _onJoinReject: ((error: Error) => void) | null = null;
  private readonly tickRate: number;
  private acceptingMessages = false;
  private connectionRejected = false;

  // Correction threshold - beyond this distance, we snap instead of smooth
  private readonly SNAP_THRESHOLD = 100;
  private readonly SMOOTH_THRESHOLD = 0.5;

  constructor(
    transport: Transport,
    config: SimulationConfig,
    SimulationClass: new (config: SimulationConfig) => Simulation,
  ) {
    if (
      !Number.isInteger(config.tickRate) ||
      config.tickRate <= 0 ||
      config.tickRate > 255 ||
      !Number.isFinite(config.tickDuration) ||
      Math.abs(config.tickDuration - 1000 / config.tickRate) > 1e-9
    ) {
      throw new Error("Network simulation requires an integer tick rate from 1 to 255Hz and a matching tick duration");
    }
    this.transport = transport;
    this.tickRate = config.tickRate;
    console.log(
      `[NetworkGameHost] Creating simulation with config: tickRate=${config.tickRate}, tickDuration=${config.tickDuration}ms`,
    );
    this.simulation = new SimulationClass(config);
    this.localPlayerId = "network-player";
    this.localState = this.simulation.state.clone();

    // Wire ClockSync to use transport for sending pings
    this.clockSync.setSendFunction((data, reliable) => this.transport.send(data, reliable));

    this.setupTransportHandlers();
  }

  /**
   * Get server info received on connection
   */
  getServerInfo(): ServerInfo | null {
    return this._serverInfo;
  }

  /**
   * Get ClockSync instance for server time conversion.
   */
  getClockSync(): ClockSync {
    return this.clockSync;
  }

  /**
   * Subscribe to server info updates (called when WELCOME received)
   */
  onServerInfo(callback: (info: ServerInfo) => void): () => void {
    this.serverInfoCallbacks.push(callback);
    return () => {
      const index = this.serverInfoCallbacks.indexOf(callback);
      if (index >= 0) this.serverInfoCallbacks.splice(index, 1);
    };
  }

  /**
   * Register callback for server-sent messages (queue notifications, rejection, etc.)
   * Returns unsubscribe function.
   */
  onServerMessage(callback: (msg: { type: string; message: string }) => void): () => void {
    this.serverMessageCallbacks.push(callback);
    return () => {
      const index = this.serverMessageCallbacks.indexOf(callback);
      if (index >= 0) this.serverMessageCallbacks.splice(index, 1);
    };
  }

  /**
   * Enable/disable external prediction mode.
   * When enabled, V2NetworkClient handles all prediction and this class only does network transport.
   */
  setExternalPrediction(enabled: boolean): void {
    this.useExternalPrediction = enabled;
    if (enabled) {
      console.log("[NetworkGameHost] External prediction enabled - V2NetworkClient handles physics");
    }
  }

  async connect(url?: string, playerName?: string, admissionTicket?: string): Promise<void> {
    this.snapshotReceiver.reset();
    NetGraph.reset();
    this._serverInfo = null;
    this._isConnected = false;
    this.connectionRejected = false;
    this.acceptingMessages = true;
    this.resumeToken = null;
    this.waitForInitialResumeToken = Boolean(admissionTicket);
    // Kept so a dropped connection can be reopened as the same player.
    this.serverUrl = url ?? this.serverUrl;
    this.playerName = playerName ?? this.playerName;
    // Install both outcomes before opening the transport: Welcome may arrive
    // before connect() resolves. Every failure clears the handshake timer.
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failConnection(new Error("Timeout waiting for Welcome and JoinAccept"));
      }, 10000); // 10 second timeout
      const clearHandshake = () => {
        clearTimeout(timeout);
        this._onJoinAccept = null;
        this._onJoinReject = null;
      };
      this._onJoinAccept = () => {
        clearHandshake();
        resolve();
      };
      this._onJoinReject = (error) => {
        clearHandshake();
        reject(error);
      };
      void this.transport
        .connect(this.serverUrl || "ws://localhost:8080")
        .then(() => {
          if (!this.acceptingMessages) return;
          this.transport.send(
            MessageCodec.encodeJoin(this.playerName || this.localPlayerId, false, admissionTicket),
            true,
          );
        })
        .catch((error: unknown) => {
          this.failConnection(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  async disconnect(): Promise<void> {
    this.acceptingMessages = false;
    this.resumeToken = null;
    this.waitForInitialResumeToken = false;
    this._serverInfo = null;
    this._onJoinReject?.(new Error("Disconnected before the handshake completed"));
    this._isConnected = false;
    this.stopWatchdog();
    this.clockSync.stop();
    this.snapshotReceiver.reset();
    NetGraph.reset();
    await this.transport.disconnect();
  }

  private failConnection(error: Error): void {
    this.connectionRejected = true;
    this._onJoinReject?.(error);
    // Disable gameplay synchronously, even if transport closure is asynchronous.
    void this.disconnect().catch((closeError) => console.error("[NetworkGameHost] Disconnect failed:", closeError));
    console.error("[NetworkGameHost] Connection rejected:", error.message);
    this.serverMessageCallbacks.forEach((cb) => {
      cb({ type: "error", message: error.message });
    });
  }

  /**
   * Send JoinGame message — spectator → player transition.
   * Server will create entity and respond with JoinAccept.
   */
  /**
   * @param manualPick True when the player chose this side in-game. A side the
   *   lobby assigned is delivered as-is; only an in-game pick is balanced.
   */
  sendJoinGame(teamId?: string, manualPick = false, admissionTicket?: string): void {
    if (!this._isConnected) return;
    const data = MessageCodec.encodeJoinGame(teamId, manualPick, admissionTicket);
    this.transport.send(data, true); // Reliable
    console.log(
      `[NetworkGameHost] Sent JoinGame request${teamId ? ` for team ${teamId}${manualPick ? " (picked)" : " (from lobby)"}` : ""}`,
    );
  }

  /**
   * Send Spectate message — player → spectator transition.
   * Server will remove entity.
   */
  sendSpectate(): void {
    if (!this._isConnected) return;
    const data = MessageCodec.encodeSpectate();
    this.transport.send(data, true); // Reliable
    console.log("[NetworkGameHost] Sent Spectate request");
  }

  /**
   * Send an in-game chat message. The server sanitizes, rate-limits, and
   * rebroadcasts it as a `chat` snapshot event (no local echo — the message
   * appears when it round-trips, Q3-style).
   */
  sendChat(text: string, teamOnly = false): void {
    if (!this._isConnected) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.transport.send(MessageCodec.encodeChat(`${teamOnly ? "/say_team " : ""}${trimmed.slice(0, 128)}`), true); // Reliable
  }

  /** Send an already encoded message over the reliable channel (ready, respawn requests). */
  sendReliable(data: Uint8Array): void {
    this.transport.send(data, true);
  }

  /**
   * Tell the server which spawn kit this player wants.
   *
   * Reliable, and fire-and-forget: the server validates the names and decides
   * when the choice applies, so there is nothing here to confirm or retry.
   */
  sendLoadout(primary: string, secondary: string): void {
    if (!this._isConnected) return;
    this.transport.send(MessageCodec.encodeSetLoadout(primary, secondary), true);
  }

  // Debug counter
  private _sendCommandCalls = 0;

  sendCommand(cmd: Command): void {
    this._sendCommandCalls++;

    if (!this._isConnected) {
      // Log first call and every 250th
      if (this._sendCommandCalls === 1 || this._sendCommandCalls % 250 === 0) {
        console.warn(
          `[NetworkGameHost] sendCommand BLOCKED #${this._sendCommandCalls}: _isConnected=${this._isConnected}`,
        );
      }
      return;
    }

    // Log first successful send
    if (this.commandSequence === 1) {
      console.log(
        `[NetworkGameHost] FIRST sendCommand: _isConnected=${this._isConnected}, playerId=${this.localPlayerId}`,
      );
    }

    // Add sequence number
    const sequencedCmd = {
      ...cmd,
      seq: this.commandSequence++,
    };

    // Send to server using binary protocol
    const data = MessageCodec.encodeCommand(this.localPlayerId, sequencedCmd.seq, sequencedCmd);

    // Buffer for redundancy (last 3 commands re-sent per tick for packet loss resilience)
    this.recentCommandPayloads.push(data);
    if (this.recentCommandPayloads.length > this.COMMAND_REDUNDANCY) {
      this.recentCommandPayloads.shift();
    }

    // Send all buffered commands as separate datagrams (server parses one command per datagram)
    // On packet loss, the missing command will be re-sent as a redundant copy in subsequent ticks
    // Server deduplicates by sequence number — no double-processing
    for (const payload of this.recentCommandPayloads) {
      this.transport.send(payload, false); // Unreliable datagrams
    }

    // Log periodically
    if (this.commandSequence % 250 === 0) {
      console.log(`[NetworkGameHost] Sent ${this.commandSequence} commands to server`);
    }

    // Skip local prediction if V2NetworkClient handles it
    if (this.useExternalPrediction) {
      return;
    }

    // Apply locally for prediction (legacy path - used when V2Client not active)
    this.pendingCommands.push(cmd);
    this.predictLocally(cmd);
  }

  onStateUpdate(callback: (state: GameState) => void): () => void {
    this.stateUpdateCallbacks.push(callback);
    return () => {
      const index = this.stateUpdateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateUpdateCallbacks.splice(index, 1);
      }
    };
  }

  onEvent(callback: (event: GameEvent) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  getInterpolatedEntity(entityId: string): ReturnType<GameState["entities"]["get"]> {
    // Use Client Prediction if possible (requires collision data)
    // Now that BSP collision is wired up in Game, we can safely use this.
    const USE_CLIENT_PREDICTION = true;

    if (USE_CLIENT_PREDICTION) {
      // Check if this is the local player's entity
      const localPlayer = this.localState.players.get(this.localPlayerId);
      const isLocalPlayer = localPlayer && localPlayer.entityId === entityId;

      if (isLocalPlayer) {
        // Use LOCAL PREDICTION for instant feedback
        const predictedEntity = this.localState.entities.get(entityId);
        if (predictedEntity) {
          const correctedEntity = predictedEntity.clone();
          const correction = this.smoothCorrection.getCorrection();
          const transform = correctedEntity.getComponent("transform") as unknown as TransformShape | undefined;
          if (transform?.position) {
            transform.position.x += correction.x;
            transform.position.y += correction.y;
            transform.position.z += correction.z;
          }
          return correctedEntity;
        } else {
          // DEBUG: This should NOT happen in normal gameplay
          console.warn(`[NetworkGameHost] FALLBACK: Local player entity ${entityId} not found in localState!`);
        }
      }
    }

    // Use server interpolation (reliable, but 50ms delayed)
    // This is used for OTHER players, not local player
    console.warn(
      `[NetworkGameHost] Using interpolation buffer for entity ${entityId} (is local player: ${this.localPlayerId === entityId})`,
    );
    const interpolatedState = this.interpolationBuffer.getInterpolatedState(performance.now());
    return interpolatedState.entities.get(entityId);
  }

  getLocalState(): GameState {
    return this.localState;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Set collision world for client-side prediction
   * This allows the prediction simulation to use BSP collision data
   * for accurate local physics before server confirmation arrives.
   */
  setCollisionWorld(collision: unknown): void {
    // Check if simulation has setCollisionWorld method (FPSSimulation does)
    const sim = this.simulation as unknown as Partial<CollisionCapableSimulation> & { constructor?: { name?: string } };
    console.log(
      `[NetworkGameHost] setCollisionWorld called, simulation type: ${sim.constructor?.name}, has method: ${typeof sim.setCollisionWorld === "function"}`,
    );
    if (typeof sim.setCollisionWorld === "function") {
      sim.setCollisionWorld(collision);
      console.log("[NetworkGameHost] Collision world set for client prediction");
    } else {
      console.warn("[NetworkGameHost] Simulation does not support setCollisionWorld");
    }
  }

  /**
   * Update the network host (called from game loop)
   */
  update(): void {
    if (!this._isConnected) return;

    // Apply smooth correction decay (once per frame)
    this.smoothCorrection.applyDecay();

    // Process events from local state
    this.processEvents();
  }

  private setupTransportHandlers(): void {
    this.transport.onMessage((data: Uint8Array) => {
      this.handleMessage(data);
    });

    this.transport.onConnect(() => {
      console.log("[NetworkGameHost] Connected to server");
    });

    this.transport.onDisconnect((reason) => {
      console.log("[NetworkGameHost] Disconnected:", reason);
      const wasConnected = this._isConnected;
      this._isConnected = false;
      this.acceptingMessages = false;
      this._serverInfo = null;
      this._onJoinReject?.(new Error(`Disconnected before the handshake completed: ${reason}`));
      this.stopWatchdog();
      this.clockSync.stop();
      this.lastMatchPhase = null;
      this.snapshotReceiver.reset();
      NetGraph.reset();
      AudioManager.getInstance().loadPlaylist("data/menu.playlist.json");
      // A connection that drops mid-match leaves a seat waiting; take it back
      // rather than making the player rejoin as someone new.
      if (wasConnected && this.resumeToken) void this.resumeSession();
    });

    this.transport.onError((error) => {
      console.error("[NetworkGameHost] Transport error:", error);
    });
  }

  // ============================================================================
  // CONNECTION WATCHDOG
  // ============================================================================

  private static readonly WATCHDOG_INTERVAL_MS = 500;

  /** Start noticing snapshots that stop arriving, from the moment the join is accepted. */
  private startWatchdog(): void {
    this.stopWatchdog();
    const now = performance.now();
    this.watchdog.start(now);
    this.watchdogCheckedAt = now;
    this.watchdogTimer = setInterval(() => this.checkWatchdog(), NetworkGameHost.WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.watchdog.stop();
  }

  /**
   * Reopen the connection and claim the seat the server is holding.
   *
   * A stalled link is not a close: nothing arrives, nothing sent gets through,
   * and neither side reports anything. Dropping the socket ourselves turns that
   * into a reconnect, and the token takes back the same player, entity and score
   * rather than joining as someone new. Attempts stop once the server's grace has
   * passed, because by then the seat is gone.
   */
  private async resumeSession(): Promise<void> {
    if (this.resuming || !this.resumeToken || !this.serverUrl) return;
    this.resuming = true;
    const deadline = performance.now() + this.resumeGraceMs;
    const token = this.resumeToken;
    try {
      while (performance.now() < deadline && this.resumeToken === token && !this.connectionRejected) {
        this._isConnected = false;
        this.acceptingMessages = false;
        this.stopWatchdog();
        this.clockSync.stop();
        try {
          await this.transport.disconnect();
          if (this.resumeToken !== token) return;
          this._serverInfo = null;
          this.snapshotReceiver.reset();
          NetGraph.reset();
          this.acceptingMessages = true;
          await this.transport.connect(this.serverUrl);
          if (!this.acceptingMessages || this.resumeToken !== token) return;
          this.transport.send(MessageCodec.encodeResume(token), true);
          console.warn("[NetworkGameHost] Connection lost — asking the server for our seat back");
          // JoinAccept for the same player ends the resume; the watchdog restarts with it.
          await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_MS));
          if (this._isConnected) {
            console.warn("[NetworkGameHost] Resumed the session");
            return;
          }
        } catch (error) {
          console.warn("[NetworkGameHost] Reconnect attempt failed:", error);
          await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_MS));
        }
      }
      if (this.connectionRejected || this.resumeToken !== token) return;
      console.error(
        `[NetworkGameHost] Could not resume within ${(this.resumeGraceMs / 1000).toFixed(0)}s; the seat is gone. Disconnect from the menu to return to the lobby.`,
      );
    } finally {
      this.resuming = false;
    }
  }

  private noteSnapshotArrived(): void {
    const stalledFor = this.watchdog.dataArrived(performance.now());
    if (stalledFor !== null) {
      console.warn(`[NetworkGameHost] Snapshots resumed after ${(stalledFor / 1000).toFixed(1)}s`);
    }
  }

  private checkWatchdog(): void {
    const now = performance.now();
    const sinceLastCheck = now - this.watchdogCheckedAt;
    this.watchdogCheckedAt = now;

    // A hidden page is throttled, and a blocked main thread leaves snapshots
    // queued unread: neither gap says anything about the connection.
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (hidden || sinceLastCheck > NetworkGameHost.WATCHDOG_INTERVAL_MS * 3) {
      this.watchdog.skipGap(now);
      return;
    }

    const stage = this.watchdog.check(now);
    if (!stage) return;
    const seconds = (this.watchdog.silentFor(now) / 1000).toFixed(1);
    if (stage === "warn") {
      const unsent = this.transport.bufferedAmount?.();
      console.warn(
        `[NetworkGameHost] No snapshot for ${seconds}s: nothing is arriving though the connection is ` +
          `${this.transport.isConnected() ? "open" : "not open"}` +
          (unsent === undefined ? "" : ` (${unsent} bytes waiting to send)`),
      );
    } else if (this.resumeToken) {
      console.error(`[NetworkGameHost] No snapshot for ${seconds}s: the connection has stalled`);
      // Nothing is crossing a stalled link in either direction, and neither side
      // will close it. Drop it and claim the seat the server still holds.
      void this.resumeSession();
    } else {
      console.error(
        `[NetworkGameHost] No snapshot for ${seconds}s: the connection has stalled. Disconnect from the menu to return to the lobby.`,
      );
    }
  }

  /**
   * Handle incoming message using binary protocol
   */
  private handleMessage(data: Uint8Array): void {
    if (!this.acceptingMessages) return;
    try {
      const messageType = MessageCodec.peekMessageType(data);

      switch (messageType) {
        case MessageType.LegacySnapshot:
        case MessageType.Snapshot: {
          // Datagram snapshots may beat the reliable handshake. Drop them until
          // the timing contract and local seat are known; never ACK them early.
          if (!this._serverInfo || !this._isConnected) break;
          // Any snapshot shows the link delivers, even one waiting on a baseline.
          this.noteSnapshotArrived();
          const snapshot = this.snapshotReceiver.receive(data);
          if (snapshot) this.handleSnapshot(snapshot);
          break;
        }
        case MessageType.JoinAccept: {
          if (!this._serverInfo) {
            this.failConnection(new Error("Server sent JoinAccept before a compatible Welcome"));
            break;
          }
          const { playerId, entityId } = MessageCodec.decodeJoinAccept(data);

          // Guard against duplicate JoinAccept messages
          if (this._isConnected) {
            console.log(
              `[NetworkGameHost] Ignoring duplicate JoinAccept: ${playerId} (already connected as ${this.localPlayerId})`,
            );
            break;
          }

          // Update local player ID from server assignment
          this.localPlayerId = playerId;
          this.localEntityId = entityId;
          console.log(`[NetworkGameHost] Join accepted: ${playerId}, entity: ${entityId}`);
          this._isConnected = true;
          this.startWatchdog();

          // CRITICAL: Resolve connect() promise FIRST, before any potentially-throwing code.
          // If spawnPlayer throws, the error is caught by the outer catch and the promise
          // would never resolve, hanging connect() forever.
          if (this._onJoinAccept && (!this.waitForInitialResumeToken || this.resumeToken)) {
            this._onJoinAccept();
            this._onJoinAccept = null;
          }

          // Start Game Music
          AudioManager.getInstance().loadPlaylist("data/game.playlist.json");

          // Start ClockSync after confirmed connection
          this.clockSync.startSync();
          console.log(`[NetworkGameHost] ClockSync started`);

          // Spawn local player in client-side prediction simulation
          try {
            const sim = this.simulation as unknown as Partial<SpawnableSimulation>;
            if (typeof sim.spawnPlayer === "function") {
              sim.spawnPlayer(playerId);
              // CRITICAL: Update localState after spawning so getLocalPlayerPosition() works
              this.localState = this.simulation.state.clone();
              console.log(`[NetworkGameHost] Spawned local player in prediction simulation: ${playerId}`);
            }
          } catch (spawnError) {
            console.error(`[NetworkGameHost] Failed to spawn local player:`, spawnError);
          }

          break;
        }
        case MessageType.ResumeToken: {
          // The seat the server keeps if this connection drops, and for how long.
          const { token, graceMs } = MessageCodec.decodeResumeToken(data);
          this.resumeToken = token;
          this.resumeGraceMs = graceMs;
          if (this._isConnected && this.waitForInitialResumeToken && this._onJoinAccept) {
            this.waitForInitialResumeToken = false;
            this._onJoinAccept();
            this._onJoinAccept = null;
          }
          break;
        }
        case MessageType.Welcome: {
          const welcome = MessageCodec.decodeWelcome(data);
          if (welcome.tickRate !== this.tickRate) {
            this.failConnection(
              new Error(
                `Unsupported server tick rate: ${welcome.tickRate}Hz; this client requires ${this.tickRate}Hz.`,
              ),
            );
            break;
          }
          console.log(`[NetworkGameHost] Welcome from ${welcome.serverName}, map: ${welcome.map}`);

          // Store server info
          this._serverInfo = welcome;

          // Notify callbacks (for map loading, etc.)
          for (const cb of this.serverInfoCallbacks) cb(welcome);
          break;
        }
        case MessageType.Pong: {
          const { clientSendTime, serverTime } = MessageCodec.decodePong(data);
          this.clockSync.processPong(clientSendTime, serverTime);
          break;
        }
        case MessageType.ServerMessage: {
          const msg = MessageCodec.decodeServerMessage(data);
          console.log(`[NetworkGameHost] Server message [${msg.type}]: ${msg.message}`);
          for (const cb of this.serverMessageCallbacks) cb(msg);
          break;
        }
        default:
          console.warn(`[NetworkGameHost] Unknown message type: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      console.error("[NetworkGameHost] Failed to handle message:", error);
      // Keep valid history: an unrelated malformed message must not invalidate
      // acknowledged dependencies. Missing baselines wait for a full snapshot.
    }
  }

  // ============================================================================
  // SNAPSHOT HANDLING - Where the magic happens
  // ============================================================================
  /**
   * Handle incoming snapshot from server.
   *
   * This is the core of client-server synchronization. When a snapshot arrives:
   *
   * 1. BUFFER: Add to interpolation buffer for smooth rendering of other players
   * 2. RECONCILE: Compare our prediction to server truth, calculate error
   * 3. SYNC TICK: Update our tick counter to match server (authoritative time)
   * 4. ACK: Tell server we got this snapshot (for delta compression)
   * 5. CORRECT: Apply smooth correction to our predicted position
   * 6. NOTIFY: Tell the game layer (FPSController) about the new state
   */
  private handleSnapshot(snapshot: GameState): void {
    // Step 1: Buffer for interpolation (smooth rendering of other players)
    this.interpolationBuffer.addSnapshot(snapshot);

    // Step 2: Check our prediction against server truth (legacy only)
    // In V2 mode, V2NetworkClient handles reconciliation — skip legacy path
    // to avoid wasted CPU and stale state corruption
    if (!this.useExternalPrediction) {
      this.reconcilePrediction(snapshot);
    }

    // Step 3: Sync our tick counter to server (server time is authoritative)
    this.currentTick = snapshot.tick;

    // Step 4: Acknowledge receipt (server uses this for delta compression baseline)
    this.sendAck(snapshot.tick);

    // Step 5: Apply accumulated smooth correction (legacy only)
    if (!this.useExternalPrediction) {
      this.applySmothCorrection();
    }

    // In legacy mode (no V2 client), callbacks are fired by predictLocally() only.
    // This prevents flickering from alternating predicted vs interpolated positions.
    // In V2 mode, predictLocally() is skipped, so we MUST fire callbacks here
    // so Game.onServerStateUpdate() can feed snapshots to V2NetworkClient.
    if (this.useExternalPrediction) {
      for (const cb of this.stateUpdateCallbacks) cb(snapshot);
    }

    // Handle Match Phase transitions (for music)
    if (snapshot.matchSnapshot) {
      const currentPhase = snapshot.matchSnapshot.phase;
      if (currentPhase !== this.lastMatchPhase) {
        if (currentPhase === MatchPhase.PostGame) {
          console.log("[NetworkGameHost] Match finished, starting endgame music");
          AudioManager.getInstance().loadPlaylist("data/endgame.playlist.json");
        } else if (this.lastMatchPhase === MatchPhase.PostGame) {
          // Post-game screen over (next warmup) — the endgame playlist loops
          // forever otherwise. Bring back the in-game music.
          console.log("[NetworkGameHost] Post-game over, restoring game music");
          AudioManager.getInstance().loadPlaylist("data/game.playlist.json");
        }
        this.lastMatchPhase = currentPhase;
      }
    }
  }

  /**
   * Send acknowledgment for received snapshot
   */
  private sendAck(tick: number): void {
    const data = MessageCodec.encodeAck(tick);
    this.transport.send(data, true); // ACK only successfully reconstructed state
  }

  /**
   * Apply command locally for prediction
   * Uses predict() instead of tick() to avoid incrementing tick counter.
   * Client tick synchronization is driven by server snapshots, not local prediction.
   */
  private predictLocally(cmd: Command): void {
    // Apply command to local state for immediate feedback
    // Use predict() to run physics WITHOUT incrementing tick counter
    // This prevents client/server tick divergence
    this.simulation.predict([cmd]);
    this.localState = this.simulation.state.clone();

    // Notify callbacks with predicted state for animations
    // This is critical: without this, FPSController only gets state at snapshot rate (20Hz)
    // which causes choppy animations. By notifying here, animations update at prediction rate (125Hz).
    for (const cb of this.stateUpdateCallbacks) cb(this.localState);
  }

  // ============================================================================
  // RECONCILIATION - The heart of client-side prediction
  // ============================================================================
  /**
   * Compare our predicted position with server's authoritative position.
   *
   * SCENARIO: You pressed W and predicted you moved to (100, 50, 200).
   * Server says you're actually at (102, 50, 198). What happened?
   *
   * Maybe another player pushed you. Maybe there was a wall we didn't know about.
   * The server is always right, so we need to correct our prediction.
   *
   * THREE CASES:
   *
   * 1. TINY ERROR (< 0.5 units): Ignore it. Network jitter, floating point drift.
   *    Constantly correcting tiny errors makes the game feel "swimmy".
   *
   * 2. MEDIUM ERROR (0.5 - 100 units): Smooth correction. Gradually drift toward
   *    correct position over ~10-20 frames. Player won't notice.
   *
   * 3. LARGE ERROR (> 100 units): SNAP immediately. This is a teleport, death,
   *    respawn, or lag spike. Smooth correction would look worse than snapping.
   */
  private reconcilePrediction(serverState: GameState): void {
    // Find our player in both states
    // CRITICAL: We compare simulation.state (what prediction uses) vs server
    const localPlayer = this.simulation.state.players.get(this.localPlayerId);
    const serverPlayer = serverState.players.get(this.localPlayerId);

    if (!localPlayer || !serverPlayer) return;

    // Find our entity in both states
    // CRITICAL: We update simulation.state so next predict() uses corrected position
    const localEntity = this.simulation.state.entities.get(localPlayer.entityId);
    const serverEntity = serverState.entities.get(serverPlayer.entityId);

    if (!localEntity || !serverEntity) return;

    // Skip reconciliation during ledge grab — client prediction is deterministic
    // (frozen position), server just hasn't confirmed yet. Correcting here causes micro-shake.
    const movementState = localEntity.getComponent("movementState") as unknown as MovementStateShape | undefined;
    if (movementState?.ledgeGrabState && movementState.ledgeGrabState !== "none") {
      this.smoothCorrection.reset();
      return;
    }

    // Get positions - prefer 'transform' (FPSSimulation) with fallback to 'position' (legacy)
    const localTransform = localEntity.getComponent("transform") as unknown as TransformShape | undefined;
    const serverTransform = serverEntity.getComponent("transform") as unknown as TransformShape | undefined;

    const localPos = localTransform?.position || (localEntity.getComponent("position") as unknown as Vec3 | undefined);
    const serverPos =
      serverTransform?.position || (serverEntity.getComponent("position") as unknown as Vec3 | undefined);

    if (!localPos || !serverPos) return;

    // Calculate prediction error (how far off were we?)
    const dx = serverPos.x - localPos.x;
    const dy = serverPos.y - localPos.y;
    const dz = serverPos.z - localPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // DEBUG: Log error distance occasionally (was 10%, reduced for performance)
    if (Math.random() < 0.005) {
      console.log(
        `[Reconcile] Error: ${distance.toFixed(1)} units | Client: (${localPos.x.toFixed(1)}, ${localPos.y.toFixed(1)}, ${localPos.z.toFixed(1)}) | Server: (${serverPos.x.toFixed(1)}, ${serverPos.y.toFixed(1)}, ${serverPos.z.toFixed(1)})`,
      );
    }

    // Decide how to handle the error
    if (distance > this.SNAP_THRESHOLD) {
      // CASE 3: Large error - snap immediately (teleport, death, major desync)
      // No smooth correction - just hard snap
      localPos.x = serverPos.x;
      localPos.y = serverPos.y;
      localPos.z = serverPos.z;
      this.smoothCorrection.reset(); // Clear any pending smooth corrections
      console.log("[NetworkGameHost] Snapped to server position (large error)");

      // CRITICAL: Update localState to match simulation.state
      this.localState = this.simulation.state.clone();
    } else if (distance > this.SMOOTH_THRESHOLD) {
      // CASE 2: Medium error - smooth correction + reset prediction to server
      // FIX: We MUST reset simulation.state to server position!
      // Otherwise prediction will continue from wrong base and error persists forever.
      // The smooth correction provides visual smoothing to hide the snap.

      // Calculate what the visual difference will be after snapping internally
      // (current localPos -> new serverPos, but rendered with correction offset)
      this.smoothCorrection.addCorrection(localPos.x - serverPos.x, localPos.y - serverPos.y, localPos.z - serverPos.z);

      // CRITICAL: Reset simulation.state position to server (fixes 24-unit drift bug!)
      localPos.x = serverPos.x;
      localPos.y = serverPos.y;
      localPos.z = serverPos.z;

      // Update localState to match
      this.localState = this.simulation.state.clone();
    }
    // CASE 1: Tiny error (below SMOOTH_THRESHOLD) - ignore, prediction is good enough

    // Clean up commands that server has now acknowledged
    // Commands with tick <= serverState.tick have been processed by server
    this.pendingCommands = this.pendingCommands.filter((cmd) => cmd.tick > serverState.tick);
  }

  /**
   * Apply smooth correction to local player position
   */
  private applySmothCorrection(): void {
    if (!this.smoothCorrection.hasCorrection()) return;

    const localPlayer = this.localState.players.get(this.localPlayerId);
    if (!localPlayer) return;

    const localEntity = this.localState.entities.get(localPlayer.entityId);
    if (!localEntity) return;

    // Use 'transform' component (created by FPSSimulation) with fallback to 'position' (legacy)
    const localTransform = localEntity.getComponent("transform") as unknown as TransformShape | undefined;
    const localPos = localTransform?.position || (localEntity.getComponent("position") as unknown as Vec3 | undefined);
    if (!localPos) return;

    const correction = this.smoothCorrection.getCorrection();
    localPos.x += correction.x;
    localPos.y += correction.y;
    localPos.z += correction.z;
  }

  /**
   * Process events from local state
   */
  private processEvents(): void {
    const events = this.localState.events;
    this.localState.events = [];

    events.forEach((event) => {
      for (const callback of this.eventCallbacks) callback(event);
    });
  }
}
