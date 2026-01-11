import { Simulation, SimulationConfig } from '../core/Simulation';
import { GameState } from '../core/GameState';
import type { Command } from '../core/Command';
import type { Transport } from '../client/transport/Transport';

/**
 * Simple test server for development
 */
export class TestServer {
  private transport: Transport;
  private simulation: Simulation;
  private clients: Map<string, Transport> = new Map();
  private currentTick: number = 0;
  
  constructor(transport: Transport, SimulationClass: new (config: SimulationConfig) => Simulation) {
    this.transport = transport;
    this.simulation = new SimulationClass({
      tickRate: 20,
      tickDuration: 50,
      maxPlayers: 16,
      gameRules: {}
    });
    
    this.setupTransportHandlers();
  }
  
  private setupTransportHandlers(): void {
    this.transport.onMessage((data: Uint8Array) => {
      this.handleMessage(data);
    });
    
    this.transport.onConnect(() => {
      console.log('[TestServer] Client connected');
    });
  }
  
  private handleMessage(data: Uint8Array): void {
    try {
      const message = JSON.parse(new TextDecoder().decode(data));
      
      switch (message.type) {
        case 'join':
          this.handleJoin(message.playerId);
          break;
        case 'command':
          this.handleCommand(message.command);
          break;
      }
    } catch (error) {
      console.error('[TestServer] Failed to handle message:', error);
    }
  }
  
  private handleJoin(playerId: string): void {
    // Add player to simulation
    const player = {
      entityId: 'test-entity',
      name: playerId,
      team: '',
      score: 0,
      ping: 0,
      serialize() { return {}; },
      deserialize() {},
      clone() { return { ...this }; }
    };
    this.simulation.state.players.set(playerId, player);
    
    console.log(`[TestServer] Player ${playerId} joined`);
  }
  
  private handleCommand(command: Command): void {
    // Add command to simulation
    this.simulation.tick([command]);
    
    // Send updated state to all clients
    this.broadcastSnapshot();
  }
  
    
  private broadcastSnapshot(): void {
    const snapshot = this.simulation.state.clone();
    snapshot.tick = this.currentTick++;
    
    const message = {
      type: 'snapshot',
      snapshot: this.serializeState(snapshot)
    };
    
    const data = new TextEncoder().encode(JSON.stringify(message));
    
    for (const client of this.clients.values()) {
      client.send(data);
    }
  }
  
  private serializeState(state: GameState): any {
    // Simple JSON serialization for testing
    return {
      tick: state.tick,
      entities: Array.from(state.entities.entries()).map(([id, entity]) => ({
        id,
        position: (entity.getComponent('position') as any),
        velocity: (entity.getComponent('velocity') as any)
      })),
      players: Array.from(state.players.entries())
    };
  }
  
  start(): void {
    console.log('[TestServer] Started');
    
    // Simple tick loop
    setInterval(() => {
      this.currentTick++;
      this.broadcastSnapshot();
    }, 50); // 20 Hz
  }
}
