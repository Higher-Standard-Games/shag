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
  private snapshots: Map<number, GameState> = new Map();
  private currentTick: number = 0;
  private interpolationDelay: number = 100; // 100ms delay

  /** Get interpolation delay in ms */
  getInterpolationDelay(): number {
    return this.interpolationDelay;
  }

  /**
   * Add a new snapshot to the buffer
   */
  addSnapshot(snapshot: GameState): void {
    this.snapshots.set(snapshot.tick, snapshot);

    // Clean up old snapshots
    const cutoffTick = snapshot.tick - 10;
    for (const tick of this.snapshots.keys()) {
      if (tick < cutoffTick) {
        this.snapshots.delete(tick);
      }
    }

    this.currentTick = snapshot.tick;
  }

  /**
   * Get interpolated state for rendering
   */
  getInterpolatedState(_renderTime: number): GameState {
    // Find the best snapshot pair for interpolation
    const targetTick = this.currentTick - 2; // 2 ticks behind for interpolation

    let snapshot1 = this.snapshots.get(targetTick);
    let snapshot2 = this.snapshots.get(targetTick + 1);

    if (!snapshot1) {
      // Fallback to newest available
      snapshot1 = this.snapshots.get(this.currentTick) || new GameState();
      return snapshot1;
    }

    if (!snapshot2) {
      return snapshot1;
    }

    // Simple linear interpolation between snapshots
    const t = 0.5; // Mid-point between ticks
    const interpolated = this.interpolateStates(snapshot1, snapshot2, t);

    return interpolated;
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
   * Get and decay the current correction (call once per frame)
   */
  getCorrection(): { x: number; y: number; z: number } {
    const correction = {
      x: this.correctionX * this.correctionDecay,
      y: this.correctionY * this.correctionDecay,
      z: this.correctionZ * this.correctionDecay,
    };

    // Decay the stored correction
    this.correctionX *= (1 - this.correctionDecay);
    this.correctionY *= (1 - this.correctionDecay);
    this.correctionZ *= (1 - this.correctionDecay);

    // Zero out small corrections to avoid perpetual micro-corrections
    const epsilon = 0.01;
    if (Math.abs(this.correctionX) < epsilon) this.correctionX = 0;
    if (Math.abs(this.correctionY) < epsilon) this.correctionY = 0;
    if (Math.abs(this.correctionZ) < epsilon) this.correctionZ = 0;

    return correction;
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
  private commandSequence = 0;
  private lastBaselineTick = 0;

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
    this.simulation = new SimulationClass(config);
    this.localPlayerId = 'network-player';
    this.localState = this.simulation.state.clone();

    this.setupTransportHandlers();
  }

  /**
   * Get server info received on connection
   */
  getServerInfo(): ServerInfo | null {
    return this._serverInfo;
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

  async connect(url?: string): Promise<void> {
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
    const joinData = MessageCodec.encodeJoin(this.localPlayerId);
    this.transport.send(joinData, true); // Reliable for join

    // Wait for JoinAccept before returning
    await joinAcceptPromise;
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    await this.transport.disconnect();
  }

  sendCommand(cmd: Command): void {
    if (!this._isConnected) {
      // Log once every 100 calls to avoid spam
      if (Math.random() < 0.01) {
        console.log(`[NetworkGameHost] sendCommand skipped - not connected`);
      }
      return;
    }

    // Add sequence number
    const sequencedCmd = {
      ...cmd,
      seq: this.commandSequence++
    };

    // Send to server using binary protocol
    const data = MessageCodec.encodeCommand(this.localPlayerId, sequencedCmd.seq, sequencedCmd);
    this.transport.send(data, false); // Unreliable for commands (sent frequently)

    // Log periodically
    if (this.commandSequence % 60 === 0) {
      console.log(`[NetworkGameHost] Sent ${this.commandSequence} commands to server`);
    }

    // Apply locally for prediction
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
   * Update the network host (called from game loop)
   */
  update(): void {
    if (!this._isConnected) return;

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
          const snapshot = MessageCodec.decodeSnapshot(data, this.lastBaselineTick > 0 ? this.localState : undefined);
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

          // Spawn local player in client-side prediction simulation
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sim = this.simulation as any;
          if (typeof sim.spawnPlayer === 'function') {
            sim.spawnPlayer(playerId);
            // CRITICAL: Update localState after spawning so getLocalPlayerPosition() works
            this.localState = this.simulation.state.clone();
            console.log(`[NetworkGameHost] Spawned local player in prediction simulation: ${playerId}`);
          }

          // Resolve connect() promise
          if (this._onJoinAccept) {
            this._onJoinAccept();
            this._onJoinAccept = null;
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
        default:
          console.warn(`[NetworkGameHost] Unknown message type: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      console.error('[NetworkGameHost] Failed to handle message:', error);
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

    // Step 2: Check our prediction against server truth
    this.reconcilePrediction(snapshot);

    // Step 3: Sync our tick counter to server (server time is authoritative)
    this.currentTick = snapshot.tick;

    // Step 4: Acknowledge receipt (server uses this for delta compression baseline)
    this.sendAck(snapshot.tick);

    // Step 5: Apply accumulated smooth correction to local position
    this.applySmothCorrection();

    // Step 6: Notify game layer with interpolated state for rendering
    const interpolatedState = this.interpolationBuffer.getInterpolatedState(Date.now());
    this.stateUpdateCallbacks.forEach(cb => cb(interpolatedState));
  }

  /**
   * Send acknowledgment for received snapshot
   */
  private sendAck(tick: number): void {
    const data = MessageCodec.encodeAck(tick);
    this.transport.send(data, false);
    this.lastBaselineTick = tick;
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
    const localPlayer = this.localState.players.get(this.localPlayerId);
    const serverPlayer = serverState.players.get(this.localPlayerId);

    if (!localPlayer || !serverPlayer) return;

    // Find our entity in both states
    const localEntity = this.localState.entities.get(localPlayer.entityId);
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

    // Decide how to handle the error
    if (distance > this.SNAP_THRESHOLD) {
      // CASE 3: Large error - snap immediately (teleport, death, major desync)
      localPos.x = serverPos.x;
      localPos.y = serverPos.y;
      localPos.z = serverPos.z;
      this.smoothCorrection.reset(); // Clear any pending smooth corrections
      console.log('[NetworkGameHost] Snapped to server position (large error)');
    } else if (distance > this.SMOOTH_THRESHOLD) {
      // CASE 2: Medium error - queue smooth correction
      this.smoothCorrection.addCorrection(dx, dy, dz);
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
