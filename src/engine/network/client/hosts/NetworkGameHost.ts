import type { IGameHost } from '../../core/IGameHost';
import { GameState } from '../../core/GameState';
import type { Command } from '../../core/Command';
import type { Simulation, SimulationConfig } from '../../core/Simulation';
import type { PlayerId } from '../../core/Entity';
import type { Transport } from '../transport/Transport';
import { MessageCodec, MessageType } from '../../protocol/MessageCodec';

/**
 * Snapshot buffer for interpolation
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

    // Interpolate entities
    for (const [id, entity2] of state2.entities) {
      const entity1 = state1.entities.get(id);
      if (!entity1) {
        // New entity, just clone it
        result.entities.set(id, entity2.clone());
        continue;
      }

      const interpolatedEntity = entity2.clone();
      const pos1 = entity1.getComponent('position') as any;
      const pos2 = entity2.getComponent('position') as any;

      if (pos1 && pos2) {
        const interpolatedPos = interpolatedEntity.getComponent('position') as any;
        interpolatedPos.x = pos1.x + (pos2.x - pos1.x) * t;
        interpolatedPos.y = pos1.y + (pos2.y - pos1.y) * t;
        interpolatedPos.z = pos1.z + (pos2.z - pos1.z) * t;
      }

      result.entities.set(id, interpolatedEntity);
    }

    return result;
  }
}

/**
 * Smooth correction for prediction errors
 * Instead of snapping, smoothly interpolate to server position over time
 */
class SmoothCorrection {
  private correctionX: number = 0;
  private correctionY: number = 0;
  private correctionZ: number = 0;
  private correctionDecay: number = 0.1; // Decay factor per frame (lower = smoother)

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

  /**
   * Handle snapshot from server
   */
  private handleSnapshot(snapshot: GameState): void {
    // Add to interpolation buffer
    this.interpolationBuffer.addSnapshot(snapshot);

    // Reconcile prediction with smooth correction
    this.reconcilePrediction(snapshot);

    // Update current tick and send acknowledgment
    this.currentTick = snapshot.tick;
    this.sendAck(snapshot.tick);

    // Apply any smooth correction to local state
    this.applySmothCorrection();

    // Notify listeners
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
   */
  private predictLocally(cmd: Command): void {
    // Apply command to local state for immediate feedback
    this.simulation.tick([cmd]);
    this.localState = this.simulation.state.clone();
  }

  /**
   * Reconcile local prediction with server state using smooth correction
   * Instead of snapping, we calculate the error and apply it smoothly over time
   */
  private reconcilePrediction(serverState: GameState): void {
    const localPlayer = this.localState.players.get(this.localPlayerId);
    const serverPlayer = serverState.players.get(this.localPlayerId);

    if (!localPlayer || !serverPlayer) return;

    const localEntity = this.localState.entities.get(localPlayer.entityId);
    const serverEntity = serverState.entities.get(serverPlayer.entityId);

    if (!localEntity || !serverEntity) return;

    const localPos = localEntity.getComponent('position') as any;
    const serverPos = serverEntity.getComponent('position') as any;

    if (!localPos || !serverPos) return;

    // Calculate prediction error
    const dx = serverPos.x - localPos.x;
    const dy = serverPos.y - localPos.y;
    const dz = serverPos.z - localPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance > this.SNAP_THRESHOLD) {
      // Large error (teleport, respawn, etc.) - snap immediately
      localPos.x = serverPos.x;
      localPos.y = serverPos.y;
      localPos.z = serverPos.z;
      this.smoothCorrection.reset();
      console.log('[NetworkGameHost] Snapped to server position (large error)');
    } else if (distance > this.SMOOTH_THRESHOLD) {
      // Small to medium error - use smooth correction
      this.smoothCorrection.addCorrection(dx, dy, dz);
    }
    // Below SMOOTH_THRESHOLD - prediction is good enough, no correction needed

    // Remove acknowledged commands from pending
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

    const localPos = localEntity.getComponent('position') as any;
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
