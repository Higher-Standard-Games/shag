import type { Simulation, SimulationConfig } from '../core/Simulation';
import type { GameState } from '../core/GameState';
import type { Command } from '../core/Command';
import type { PlayerId } from '../core/Entity';
import type { Transport } from '../client/transport/Transport';

/**
 * Represents a connected client in a room
 */
interface Client {
  /** Unique client identifier */
  id: string;
  
  /** Transport for sending messages */
  transport: Transport;
  
  /** Player ID in the simulation */
  playerId: PlayerId;
  
  /** Last acknowledged tick */
  lastAckTick: number;
  
  /** Client ping in milliseconds */
  ping: number;
  
  /** When client joined */
  joinTime: number;
}

/**
 * Room - manages a single game instance with multiple clients
 * Each room has its own simulation and tick rate
 */
export class Room {
  readonly id: string;
  readonly maxClients: number;
  
  private simulation: Simulation;
  private clients: Map<string, Client> = new Map();
  private currentTick: number = 0;
  private isRunning: boolean = false;
  private tickInterval: any = null;
  
  // Event callbacks
  private onClientJoinCallbacks: ((client: Client) => void)[] = [];
  private onClientLeaveCallbacks: ((client: Client) => void)[] = [];
  private onTickCallbacks: ((tick: number, state: GameState) => void)[] = [];
  
  constructor(
    id: string,
    config: SimulationConfig,
    SimulationClass: new (config: SimulationConfig) => Simulation,
    maxClients: number = 16
  ) {
    this.id = id;
    this.maxClients = maxClients;
    this.simulation = new SimulationClass(config);
  }
  
  /**
   * Add a client to the room
   */
  addClient(clientId: string, transport: Transport): boolean {
    if (this.clients.size >= this.maxClients) {
      return false;
    }
    
    if (this.clients.has(clientId)) {
      return false;
    }
    
    // Create player in simulation
    const playerId = `player_${clientId}`;
    const player = {
      entityId: 'test-entity', // In a real game, create unique entity
      name: clientId,
      team: '',
      score: 0,
      ping: 0,
      serialize() { return {}; },
      deserialize() {},
      clone() { return { ...this }; }
    };
    this.simulation.state.players.set(playerId, player);
    
    const client: Client = {
      id: clientId,
      transport,
      playerId,
      lastAckTick: 0,
      ping: 0,
      joinTime: Date.now()
    };
    
    this.clients.set(clientId, client);
    
    // Send initial state to client
    this.sendSnapshot(client);
    
    // Notify listeners
    this.onClientJoinCallbacks.forEach(cb => cb(client));
    
    console.log(`[Room ${this.id}] Client ${clientId} joined (${this.clients.size}/${this.maxClients})`);
    
    return true;
  }
  
  /**
   * Remove a client from the room
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Remove player from simulation
    this.simulation.state.players.delete(client.playerId);
    
    this.clients.delete(clientId);
    
    // Notify listeners
    this.onClientLeaveCallbacks.forEach(cb => cb(client));
    
    console.log(`[Room ${this.id}] Client ${clientId} left (${this.clients.size}/${this.maxClients})`);
    
    // Stop room if empty
    if (this.clients.size === 0) {
      this.stop();
    }
  }
  
  /**
   * Handle command from client
   */
  handleCommand(clientId: string, command: Command): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Add command to simulation
    this.simulation.tick([command]);
    
    console.log(`[Room ${this.id}] Command from ${clientId}: ${command.type}`);
  }
  
  /**
   * Start the room simulation
   */
  start(tickRate: number = 20): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    const tickDuration = 1000 / tickRate;
    
    this.tickInterval = setInterval(() => {
      this.tick();
    }, tickDuration);
    
    console.log(`[Room ${this.id}] Started at ${tickRate} Hz`);
  }
  
  /**
   * Stop the room simulation
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    
    console.log(`[Room ${this.id}] Stopped`);
  }
  
  /**
   * Get current room state
   */
  getState(): {
    id: string;
    clientCount: number;
    maxClients: number;
    currentTick: number;
    isRunning: boolean;
  } {
    return {
      id: this.id,
      clientCount: this.clients.size,
      maxClients: this.maxClients,
      currentTick: this.currentTick,
      isRunning: this.isRunning
    };
  }
  
  /**
   * Get all clients
   */
  getClients(): Client[] {
    return Array.from(this.clients.values());
  }
  
  /**
   * Event subscription methods
   */
  onClientJoin(callback: (client: Client) => void): () => void {
    this.onClientJoinCallbacks.push(callback);
    return () => {
      const index = this.onClientJoinCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onClientJoinCallbacks.splice(index, 1);
      }
    };
  }
  
  onClientLeave(callback: (client: Client) => void): () => void {
    this.onClientLeaveCallbacks.push(callback);
    return () => {
      const index = this.onClientLeaveCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onClientLeaveCallbacks.splice(index, 1);
      }
    };
  }
  
  onTick(callback: (tick: number, state: GameState) => void): () => void {
    this.onTickCallbacks.push(callback);
    return () => {
      const index = this.onTickCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onTickCallbacks.splice(index, 1);
      }
    };
  }
  
  /**
   * Private methods
   */
  private tick(): void {
    this.currentTick++;
    
    // Notify tick listeners
    this.onTickCallbacks.forEach(cb => cb(this.currentTick, this.simulation.state));
    
    // Send snapshot to all clients
    this.broadcastSnapshot();
  }
  
  private sendSnapshot(client: Client): void {
    const snapshot = this.createSnapshot();
    
    const message = {
      type: 'snapshot',
      tick: snapshot.tick,
      state: this.serializeState(snapshot)
    };
    
    const data = new TextEncoder().encode(JSON.stringify(message));
    client.transport.send(data);
  }
  
  private broadcastSnapshot(): void {
    const snapshot = this.createSnapshot();
    
    for (const client of this.clients.values()) {
      this.sendSnapshot(client);
    }
  }
  
  private createSnapshot(): GameState {
    const snapshot = this.simulation.state.clone();
    snapshot.tick = this.currentTick;
    return snapshot;
  }
  
  private serializeState(state: GameState): any {
    // Simple JSON serialization for testing
    // In production, use binary serialization
    return {
      tick: state.tick,
      entities: Array.from(state.entities.entries()).map(([id, entity]) => ({
        id,
        position: (entity.getComponent('position') as any),
        velocity: (entity.getComponent('velocity') as any)
      })),
      players: Array.from(state.players.entries()).map(([id, player]) => ({
        id,
        entityId: player.entityId,
        name: player.name,
        team: player.team,
        score: player.score,
        ping: player.ping
      })),
      events: state.events
    };
  }
}
