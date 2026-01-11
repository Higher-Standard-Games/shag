import type { IGameHost } from '../../core/IGameHost';
import { GameState } from '../../core/GameState';
import type { Command } from '../../core/Command';
import type { Simulation, SimulationConfig } from '../../core/Simulation';
import type { PlayerId } from '../../core/Entity';
import type { Transport } from '../transport/Transport';

/**
 * Interpolated entity state for smooth rendering
 */
interface InterpolatedEntity {
  /** Entity ID */
  id: string;
  
  /** Current interpolated position */
  position: { x: number; y: number; z: number };
  
  /** Target position from latest snapshot */
  targetPosition: { x: number; y: number; z: number };
  
  /** Previous position for interpolation */
  previousPosition: { x: number; y: number; z: number };
  
  /** Timestamp when snapshot was received */
  snapshotTime: number;
  
  /** Target tick for this snapshot */
  targetTick: number;
}

/**
 * Snapshot buffer for interpolation
 */
class InterpolationBuffer {
  private snapshots: Map<number, GameState> = new Map();
  private currentTick: number = 0;
  private interpolationDelay: number = 100; // 100ms delay
  
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
  getInterpolatedState(renderTime: number): GameState {
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
 * Network game host - connects to remote server
 * Handles client prediction and snapshot interpolation
 */
export class NetworkGameHost implements IGameHost {
  readonly localPlayerId: PlayerId;
  currentTick: number = 0;
  
  private transport: Transport;
  private simulation: Simulation;
  private stateUpdateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: any) => void)[] = [];
  
  private interpolationBuffer = new InterpolationBuffer();
  private pendingCommands: Command[] = [];
  private commandSequence = 0;
  private lastAcknowledgedTick = 0;
  
  private localState: GameState;
  private _isConnected: boolean = false;
  
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
  
  async connect(): Promise<void> {
    await this.transport.connect();
    this._isConnected = true;
    
    // Request initial state
    this.sendMessage({ type: 'join', playerId: this.localPlayerId });
  }
  
  async disconnect(): Promise<void> {
    this._isConnected = false;
    await this.transport.disconnect();
  }
  
  sendCommand(cmd: Command): void {
    if (!this._isConnected) return;
    
    // Add sequence number
    const sequencedCmd = {
      ...cmd,
      seq: this.commandSequence++
    };
    
    // Send to server
    this.sendMessage({
      type: 'command',
      command: sequencedCmd
    });
    
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
  
  private handleMessage(data: Uint8Array): void {
    try {
      // Simple JSON parsing for now (replace with binary later)
      const message = JSON.parse(new TextDecoder().decode(data));
      
      switch (message.type) {
        case 'snapshot':
          this.handleSnapshot(message.snapshot);
          break;
        case 'ack':
          this.handleAcknowledgement(message.tick);
          break;
        case 'event':
          this.handleEvent(message.event);
          break;
      }
    } catch (error) {
      console.error('[NetworkGameHost] Failed to handle message:', error);
    }
  }
  
  private handleSnapshot(snapshot: GameState): void {
    // Add to interpolation buffer
    this.interpolationBuffer.addSnapshot(snapshot);
    
    // Reconcile prediction
    this.reconcilePrediction(snapshot);
    
    // Update current tick
    this.currentTick = snapshot.tick;
    
    // Notify listeners
    const interpolatedState = this.interpolationBuffer.getInterpolatedState(Date.now());
    this.stateUpdateCallbacks.forEach(cb => cb(interpolatedState));
  }
  
  private handleAcknowledgement(tick: number): void {
    this.lastAcknowledgedTick = tick;
    
    // Remove acknowledged commands from pending
    this.pendingCommands = this.pendingCommands.filter(cmd => cmd.tick > tick);
  }
  
  private handleEvent(event: any): void {
    this.eventCallbacks.forEach(cb => cb(event));
  }
  
  private predictLocally(cmd: Command): void {
    // Apply command to local state for immediate feedback
    this.simulation.tick([cmd]);
    this.localState = this.simulation.state.clone();
  }
  
  private reconcilePrediction(serverState: GameState): void {
    // Check if prediction was correct
    const localPlayer = this.localState.players.get(this.localPlayerId);
    const serverPlayer = serverState.players.get(this.localPlayerId);
    
    if (localPlayer && serverPlayer) {
      const localEntity = this.localState.entities.get(localPlayer.entityId);
      const serverEntity = serverState.entities.get(serverPlayer.entityId);
      
      if (localEntity && serverEntity) {
        const localPos = localEntity.getComponent('position') as any;
        const serverPos = serverEntity.getComponent('position') as any;
        
        // If position difference is too large, correct it
        if (localPos && serverPos) {
          const dx = localPos.x - serverPos.x;
          const dy = localPos.y - serverPos.y;
          const dz = localPos.z - serverPos.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          if (distance > 10) {
            // Snap to server position (could smooth this)
            localPos.x = serverPos.x;
            localPos.y = serverPos.y;
            localPos.z = serverPos.z;
          }
        }
      }
    }
  }
  
  private processEvents(): void {
    const events = this.localState.events;
    this.localState.events = [];
    
    events.forEach(event => {
      this.eventCallbacks.forEach(callback => callback(event));
    });
  }
  
  private sendMessage(message: any): void {
    const data = new TextEncoder().encode(JSON.stringify(message));
    this.transport.send(data, false); // Unreliable for most messages
  }
}
