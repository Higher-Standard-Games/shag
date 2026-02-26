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

import type { IGameHost } from '../../core/IGameHost';
import { GameState } from '../../core/GameState';
import type { Command } from '../../core/Command';
import type { Simulation, SimulationConfig } from '../../core/Simulation';
import type { PlayerId } from '../../core/Entity';
import type { Transport } from '../transport/Transport';
import { MessageCodec, MessageType } from '../../protocol/MessageCodec';
import { ClockSync } from '../ClockSync';

// ============================================================================
// INTERPOLATION BUFFER
// ============================================================================
/**
 * Stores recent server snapshots for smooth interpolation.
 *
 * Why interpolate? Server sends snapshots at fixed rate (e.g., 20Hz). If we just render
 * the latest snapshot, movement looks choppy. Instead, we render slightly in the past,
 * interpolating between two known snapshots for buttery-smooth visuals.
 *
 * The trade-off: We're always rendering ~2 ticks behind "real time". But this latency
 * is barely noticeable and the smoothness is worth it.
 */
class InterpolationBuffer {
  private snapshots: { state: GameState; timestamp: number }[] = [];
  private interpolationDelay: number = 50; // 50ms delay - reduced for responsiveness

  /** Get interpolation delay in ms */
  getInterpolationDelay(): number {
    return this.interpolationDelay;
  }

  /**
   * Add a new snapshot to the buffer with timestamp
   */
  addSnapshot(snapshot: GameState): void {
    const now = Date.now();
    this.snapshots.push({ state: snapshot, timestamp: now });

    // Keep only the last 10 snapshots
    while (this.snapshots.length > 10) {
      this.snapshots.shift();
    }
  }

  /**
   * Get interpolated state for rendering
   * Uses actual time to calculate smooth interpolation between snapshots
   */
  getInterpolatedState(renderTime: number): GameState {
    // We render in the past to ensure we always have two snapshots to interpolate between
    const targetTime = renderTime - this.interpolationDelay;

    // Need at least 2 snapshots to interpolate
    if (this.snapshots.length < 2) {
      // Return latest snapshot if we have one
      if (this.snapshots.length === 1) {
        return this.snapshots[0].state;
      }
      return new GameState();
    }

    // Find the two snapshots to interpolate between
    // We want snapshot1.timestamp <= targetTime <= snapshot2.timestamp
    let snapshot1 = this.snapshots[0];
    let snapshot2 = this.snapshots[1];

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].timestamp <= targetTime &&
        this.snapshots[i + 1].timestamp >= targetTime) {
        snapshot1 = this.snapshots[i];
        snapshot2 = this.snapshots[i + 1];
        break;
      }
      // If we've passed the target time, use these two
      if (this.snapshots[i].timestamp > targetTime) {
        if (i > 0) {
          snapshot1 = this.snapshots[i - 1];
          snapshot2 = this.snapshots[i];
        }
        break;
      }
      // If we're beyond all snapshots, use the two most recent
      if (i === this.snapshots.length - 2) {
        snapshot1 = this.snapshots[i];
        snapshot2 = this.snapshots[i + 1];
      }
    }

    // Calculate interpolation factor t (0 to 1)
    const timeDiff = snapshot2.timestamp - snapshot1.timestamp;
    let t: number;
    if (timeDiff <= 0) {
      t = 1; // Same timestamp, use snapshot2
    } else {
      t = Math.max(0, Math.min(1, (targetTime - snapshot1.timestamp) / timeDiff));
    }

    // Interpolate between the two snapshots
    return this.interpolateStates(snapshot1.state, snapshot2.state, t);
  }

  private interpolateStates(state1: GameState, state2: GameState, t: number): GameState {
    const result = new GameState();
    result.tick = state1.tick;
    result.events = []; // Events aren't interpolated

    // Copy players from state2 (needed for FPSGameManager to find local player)
    for (const [id, player] of state2.players) {
      result.players.set(id, player);
    }

    // Interpolate entities
    for (const [id, entity2] of state2.entities) {
      const entity1 = state1.entities.get(id);
      if (!entity1) {
        // New entity, just clone it
        result.entities.set(id, entity2.clone());
        continue;
      }

      const interpolatedEntity = entity2.clone();

      // Interpolate position component
      const pos1 = entity1.getComponent('position') as any;
      const pos2 = entity2.getComponent('position') as any;

      if (pos1 && pos2) {
        const interpolatedPos = interpolatedEntity.getComponent('position') as any;
        if (interpolatedPos) {
          interpolatedPos.x = pos1.x + (pos2.x - pos1.x) * t;
          interpolatedPos.y = pos1.y + (pos2.y - pos1.y) * t;
          interpolatedPos.z = pos1.z + (pos2.z - pos1.z) * t;
        }
      }

      // Interpolate transform.position (for FPSGameManager compatibility)
      const transform1 = entity1.getComponent('transform') as any;
      const transform2 = entity2.getComponent('transform') as any;

      if (transform1?.position && transform2?.position) {
        const interpolatedTransform = interpolatedEntity.getComponent('transform') as any;
        if (interpolatedTransform?.position) {
          interpolatedTransform.position.x = transform1.position.x + (transform2.position.x - transform1.position.x) * t;
          interpolatedTransform.position.y = transform1.position.y + (transform2.position.y - transform1.position.y) * t;
          interpolatedTransform.position.z = transform1.position.z + (transform2.position.z - transform1.position.z) * t;
        }
      }

      // Interpolate velocity.linear (for smooth movement display)
      const vel1 = entity1.getComponent('velocity') as any;
      const vel2 = entity2.getComponent('velocity') as any;

      if (vel1?.linear && vel2?.linear) {
        const interpolatedVel = interpolatedEntity.getComponent('velocity') as any;
        if (interpolatedVel?.linear) {
          interpolatedVel.linear.x = vel1.linear.x + (vel2.linear.x - vel1.linear.x) * t;
          interpolatedVel.linear.y = vel1.linear.y + (vel2.linear.y - vel1.linear.y) * t;
          interpolatedVel.linear.z = vel1.linear.z + (vel2.linear.z - vel1.linear.z) * t;
        }
      }

      result.entities.set(id, interpolatedEntity);
    }

    return result;
  }
}

// ============================================================================
// SMOOTH CORRECTION
// ============================================================================
/**
 * Smoothly corrects prediction errors instead of jarring snaps.
 *
 * HOW IT WORKS:
 *
 *   1. reconcilePrediction() finds error: we predicted (100, 50, 200) but server says (102, 50, 198)
 *   2. Error = (2, 0, -2). Instead of teleporting 2 units, we store this as "correction needed"
 *   3. Each frame, getCorrection() returns 10% of remaining error and decays the stored amount
 *   4. Over ~10-20 frames, we smoothly drift to the correct position
 *
 * The decay factor (0.1) means each frame we apply 10% of the error and keep 90%.
 * After 10 frames: 0.9^10 ≈ 35% remains. After 20: 0.9^20 ≈ 12% remains.
 * This creates a smooth exponential ease-out curve.
 *
 * WHY NOT JUST SNAP?
 *   Snapping causes visible jitter. Players hate it. Smooth correction is invisible
 *   unless the error is large (> 100 units = teleport/death, then we DO snap).
 */
class SmoothCorrection {
  private correctionX: number = 0;
  private correctionY: number = 0;
  private correctionZ: number = 0;
  private correctionDecay: number = 0.1; // 10% applied per frame, 90% kept for next

  /**
   * Add a correction offset (difference between predicted and server position)
   */
  addCorrection(dx: number, dy: number, dz: number): void {
    this.correctionX += dx;
    this.correctionY += dy;
    this.correctionZ += dz;
  }

  /**
   * Get current correction WITHOUT side effects.
   * Safe to call multiple times per frame (for camera, rendering, etc.)
   */
  getCorrection(): { x: number; y: number; z: number } {
    return {
      x: this.correctionX * this.correctionDecay,
      y: this.correctionY * this.correctionDecay,
      z: this.correctionZ * this.correctionDecay,
    };
  }

  /**
   * Apply decay to stored correction. Call ONCE per frame in update() loop.
   * This prevents flickering from multiple getCorrection() calls per frame.
   */
  applyDecay(): void {
    // Decay the stored correction
    this.correctionX *= (1 - this.correctionDecay);
    this.correctionY *= (1 - this.correctionDecay);
    this.correctionZ *= (1 - this.correctionDecay);

    // Zero out small corrections to avoid perpetual micro-corrections
    const epsilon = 0.01;
    if (Math.abs(this.correctionX) < epsilon) this.correctionX = 0;
    if (Math.abs(this.correctionY) < epsilon) this.correctionY = 0;
    if (Math.abs(this.correctionZ) < epsilon) this.correctionZ = 0;
  }

  /**
   * Check if there's significant correction remaining
   */
  hasCorrection(): boolean {
    const epsilon = 0.01;
    return Math.abs(this.correctionX) > epsilon ||
      Math.abs(this.correctionY) > epsilon ||
      Math.abs(this.correctionZ) > epsilon;
  }

  /**
   * Reset all corrections (for large teleports)
   */
  reset(): void {
    this.correctionX = 0;
    this.correctionY = 0;
    this.correctionZ = 0;
  }
}

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
  localPlayerId: PlayerId;  // Updated from server JoinAccept
  localEntityId: string = '';  // Entity ID for local player
  currentTick: number = 0;

  private transport: Transport;
  private simulation: Simulation;
  private stateUpdateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: any) => void)[] = [];
  private serverInfoCallbacks: ((info: ServerInfo) => void)[] = [];

  private interpolationBuffer = new InterpolationBuffer();
  private smoothCorrection = new SmoothCorrection();
  private pendingCommands: Command[] = [];
  private commandSequence = 1;
  /** Clone of the last acked snapshot — used as decode baseline for delta compression.
   * This must NOT be localState (which gets mutated by prediction). */
  private lastAckedSnapshot: GameState | null = null;

  /** Redundant command buffer: store last N encoded payloads for packet loss resilience */
  private recentCommandPayloads: Uint8Array[] = [];
  private readonly COMMAND_REDUNDANCY = 3; // Send last 3 commands per packet

  /** When true, V2NetworkClient handles prediction - we only do network transport */
  private useExternalPrediction = false;

  /** ClockSync for NTP-like server time synchronization */
  readonly clockSync = new ClockSync();

  private localState: GameState;
  private _isConnected: boolean = false;
  private _serverInfo: ServerInfo | null = null;
  private _onJoinAccept: (() => void) | null = null;  // Called when JoinAccept received

  // Correction threshold - beyond this distance, we snap instead of smooth
  private readonly SNAP_THRESHOLD = 100;
  private readonly SMOOTH_THRESHOLD = 0.5;

  constructor(
    transport: Transport,
    config: SimulationConfig,
    SimulationClass: new (config: SimulationConfig) => Simulation
  ) {
    this.transport = transport;
    console.log(`[NetworkGameHost] Creating simulation with config: tickRate=${config.tickRate}, tickDuration=${config.tickDuration}ms`);
    this.simulation = new SimulationClass(config);
    this.localPlayerId = 'network-player';
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
   * Enable/disable external prediction mode.
   * When enabled, V2NetworkClient handles all prediction and this class only does network transport.
   */
  setExternalPrediction(enabled: boolean): void {
    this.useExternalPrediction = enabled;
    if (enabled) {
      console.log('[NetworkGameHost] External prediction enabled - V2NetworkClient handles physics');
    }
  }

  async connect(url?: string, playerName?: string): Promise<void> {
    // Create promise that resolves when JoinAccept is received
    const joinAcceptPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for JoinAccept'));
      }, 10000);  // 10 second timeout

      // Store the resolve function to be called when JoinAccept arrives
      this._onJoinAccept = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    await this.transport.connect(url || 'ws://localhost:8080');

    // Send join message using binary protocol
    // Use player profile name if provided, otherwise fall back to localPlayerId
    const displayName = playerName || this.localPlayerId;
    const joinData = MessageCodec.encodeJoin(displayName);
    this.transport.send(joinData, true); // Reliable for join

    // Wait for JoinAccept before returning
    await joinAcceptPromise;
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    this.clockSync.stop();
    await this.transport.disconnect();
  }

  /**
   * Send JoinGame message — spectator → player transition.
   * Server will create entity and respond with JoinAccept.
   */
  sendJoinGame(): void {
    if (!this._isConnected) return;
    const data = MessageCodec.encodeJoinGame();
    this.transport.send(data, true); // Reliable
    console.log('[NetworkGameHost] Sent JoinGame request');
  }

  /**
   * Send Spectate message — player → spectator transition.
   * Server will remove entity.
   */
  sendSpectate(): void {
    if (!this._isConnected) return;
    const data = MessageCodec.encodeSpectate();
    this.transport.send(data, true); // Reliable
    console.log('[NetworkGameHost] Sent Spectate request');
  }

  // Debug counter
  private _sendCommandCalls = 0;

  sendCommand(cmd: Command): void {
    this._sendCommandCalls++;

    if (!this._isConnected) {
      // Log first call and every 250th
      if (this._sendCommandCalls === 1 || this._sendCommandCalls % 250 === 0) {
        console.warn(`[NetworkGameHost] sendCommand BLOCKED #${this._sendCommandCalls}: _isConnected=${this._isConnected}`);
      }
      return;
    }

    // Log first successful send
    if (this.commandSequence === 1) {
      console.log(`[NetworkGameHost] FIRST sendCommand: _isConnected=${this._isConnected}, playerId=${this.localPlayerId}`);
    }

    // Add sequence number
    const sequencedCmd = {
      ...cmd,
      seq: this.commandSequence++
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

  onEvent(callback: (event: any) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  getInterpolatedEntity(entityId: string): any {
    // Use Client Prediction if possible (requires collision data)
    // Now that BSP collision is wired up in FPSGameManager, we can safely use this.
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
          const transform = correctedEntity.getComponent('transform') as any;
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
    console.warn(`[NetworkGameHost] Using interpolation buffer for entity ${entityId} (is local player: ${this.localPlayerId === entityId})`);
    const interpolatedState = this.interpolationBuffer.getInterpolatedState(Date.now());
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
  setCollisionWorld(collision: any): void {
    // Check if simulation has setCollisionWorld method (FPSSimulation does)
    const sim = this.simulation as any;
    console.log(`[NetworkGameHost] setCollisionWorld called, simulation type: ${sim.constructor?.name}, has method: ${typeof sim.setCollisionWorld === 'function'}`);
    if (typeof sim.setCollisionWorld === 'function') {
      sim.setCollisionWorld(collision);
      console.log('[NetworkGameHost] Collision world set for client prediction');
    } else {
      console.warn('[NetworkGameHost] Simulation does not support setCollisionWorld');
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
      console.log('[NetworkGameHost] Connected to server');
    });

    this.transport.onDisconnect((reason) => {
      console.log('[NetworkGameHost] Disconnected:', reason);
      this._isConnected = false;
    });

    this.transport.onError((error) => {
      console.error('[NetworkGameHost] Transport error:', error);
    });
  }

  /**
   * Handle incoming message using binary protocol
   */
  private handleMessage(data: Uint8Array): void {
    try {
      const messageType = MessageCodec.peekMessageType(data);

      switch (messageType) {
        case MessageType.Snapshot: {
          const snapshot = MessageCodec.decodeSnapshot(data, this.lastAckedSnapshot ?? undefined);
          this.handleSnapshot(snapshot);
          break;
        }
        case MessageType.JoinAccept: {
          const { playerId, entityId } = MessageCodec.decodeJoinAccept(data);

          // Guard against duplicate JoinAccept messages
          if (this._isConnected) {
            console.log(`[NetworkGameHost] Ignoring duplicate JoinAccept: ${playerId} (already connected as ${this.localPlayerId})`);
            break;
          }

          // Update local player ID from server assignment
          this.localPlayerId = playerId;
          this.localEntityId = entityId;
          console.log(`[NetworkGameHost] Join accepted: ${playerId}, entity: ${entityId}`);
          this._isConnected = true;

          // CRITICAL: Resolve connect() promise FIRST, before any potentially-throwing code.
          // If spawnPlayer throws, the error is caught by the outer catch and the promise
          // would never resolve, hanging connect() forever.
          if (this._onJoinAccept) {
            this._onJoinAccept();
            this._onJoinAccept = null;
          }

          // Start ClockSync after confirmed connection
          this.clockSync.startSync();
          console.log(`[NetworkGameHost] ClockSync started`);

          // Spawn local player in client-side prediction simulation
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sim = this.simulation as any;
            if (typeof sim.spawnPlayer === 'function') {
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
        case MessageType.Welcome: {
          const welcome = MessageCodec.decodeWelcome(data);
          console.log(`[NetworkGameHost] Welcome from ${welcome.serverName}, map: ${welcome.map}`);

          // Store server info
          this._serverInfo = welcome;

          // Notify callbacks (for map loading, etc.)
          this.serverInfoCallbacks.forEach(cb => cb(welcome));
          break;
        }
        case MessageType.Pong: {
          const { clientSendTime, serverTime } = MessageCodec.decodePong(data);
          this.clockSync.processPong(clientSendTime, serverTime);
          break;
        }
        default:
          console.warn(`[NetworkGameHost] Unknown message type: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      console.error('[NetworkGameHost] Failed to handle message:', error);
      // Clear baseline to break cascading delta decode failures —
      // next snapshot will decode without delta baseline
      this.lastAckedSnapshot = null;
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
    this.sendAck(snapshot.tick, snapshot);

    // Step 5: Apply accumulated smooth correction (legacy only)
    if (!this.useExternalPrediction) {
      this.applySmothCorrection();
    }

    // In legacy mode (no V2 client), callbacks are fired by predictLocally() only.
    // This prevents flickering from alternating predicted vs interpolated positions.
    // In V2 mode, predictLocally() is skipped, so we MUST fire callbacks here
    // so FPSGameManager.onServerStateUpdate() can feed snapshots to V2NetworkClient.
    if (this.useExternalPrediction) {
      this.stateUpdateCallbacks.forEach(cb => cb(snapshot));
    }
  }

  /**
   * Send acknowledgment for received snapshot
   */
  private sendAck(tick: number, snapshot: GameState): void {
    const data = MessageCodec.encodeAck(tick);
    this.transport.send(data, false);
    // Store a clone of the RECEIVED snapshot as the decode baseline for future deltas.
    // This must match exactly what the server stores in its snapshot history for this tick.
    this.lastAckedSnapshot = snapshot.clone();
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
    this.stateUpdateCallbacks.forEach(cb => cb(this.localState));
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

    // Get positions - prefer 'transform' (FPSSimulation) with fallback to 'position' (legacy)
    const localTransform = localEntity.getComponent('transform') as any;
    const serverTransform = serverEntity.getComponent('transform') as any;

    const localPos = localTransform?.position || localEntity.getComponent('position') as any;
    const serverPos = serverTransform?.position || serverEntity.getComponent('position') as any;

    if (!localPos || !serverPos) return;

    // Calculate prediction error (how far off were we?)
    const dx = serverPos.x - localPos.x;
    const dy = serverPos.y - localPos.y;
    const dz = serverPos.z - localPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // DEBUG: Log error distance occasionally (was 10%, reduced for performance)
    if (Math.random() < 0.005) {
      console.log(`[Reconcile] Error: ${distance.toFixed(1)} units | Client: (${localPos.x.toFixed(1)}, ${localPos.y.toFixed(1)}, ${localPos.z.toFixed(1)}) | Server: (${serverPos.x.toFixed(1)}, ${serverPos.y.toFixed(1)}, ${serverPos.z.toFixed(1)})`);
    }

    // Decide how to handle the error
    if (distance > this.SNAP_THRESHOLD) {
      // CASE 3: Large error - snap immediately (teleport, death, major desync)
      // No smooth correction - just hard snap
      localPos.x = serverPos.x;
      localPos.y = serverPos.y;
      localPos.z = serverPos.z;
      this.smoothCorrection.reset(); // Clear any pending smooth corrections
      console.log('[NetworkGameHost] Snapped to server position (large error)');

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
    this.pendingCommands = this.pendingCommands.filter(cmd => cmd.tick > serverState.tick);
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
    const localTransform = localEntity.getComponent('transform') as any;
    const localPos = localTransform?.position || localEntity.getComponent('position') as any;
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

    events.forEach(event => {
      this.eventCallbacks.forEach(callback => callback(event));
    });
  }
}

