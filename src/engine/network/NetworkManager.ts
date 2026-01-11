import type { IGameHost } from './core/IGameHost';
import { GameState } from './core/GameState';
import type { Command } from './core/Command';
import { LocalGameHost } from './client/hosts/LocalGameHost';
import { Simulation, SimulationConfig } from './core/Simulation';
import { Entity } from './core/Entity';

/**
 * NetworkManager - manages networking for the game
 * Integrates with existing engine systems and provides unified interface
 */
export class NetworkManager {
  private static instance: NetworkManager;
  private gameHost: IGameHost | null = null;
  private isInitialized: boolean = false;
  
  private constructor() {}
  
  public static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }
  
  /**
   * Initialize networking system
   * Can be called multiple times with different configurations
   */
  async initialize(config?: {
    mode?: 'local' | 'network' | 'listen';
    serverUrl?: string;
    SimulationClass?: new (config: SimulationConfig) => Simulation;
    simulationConfig?: SimulationConfig;
  }): Promise<void> {
    if (this.gameHost) {
      // Shutdown existing host
      await this.shutdown();
    }
    
    const mode = config?.mode || 'local';
    const SimulationClass = config?.SimulationClass || this.getDefaultSimulationClass();
    const simulationConfig = config?.simulationConfig || this.getDefaultSimulationConfig();
    
    switch (mode) {
      case 'local':
        this.gameHost = new LocalGameHost(simulationConfig, SimulationClass);
        break;
        
      case 'network':
        // TODO: Implement NetworkGameHost integration
        throw new Error('Network mode not yet implemented');
        
      case 'listen':
        // TODO: Implement listen server (local server + network clients)
        throw new Error('Listen mode not yet implemented');
        
      default:
        throw new Error(`Unknown network mode: ${mode}`);
    }
    
    // Start the game host
    if ('start' in this.gameHost) {
      (this.gameHost as any).start();
    }
    
    this.isInitialized = true;
    console.log(`[NetworkManager] Initialized in ${mode} mode`);
  }
  
  /**
   * Get the current game host
   */
  getGameHost(): IGameHost | null {
    return this.gameHost;
  }
  
  /**
   * Send a command to the game host
   */
  sendCommand(cmd: Command): void {
    if (!this.gameHost) {
      console.warn('[NetworkManager] No game host initialized');
      return;
    }
    
    this.gameHost.sendCommand(cmd);
  }
  
  /**
   * Subscribe to state updates
   */
  onStateUpdate(callback: (state: GameState) => void): () => void {
    if (!this.gameHost) {
      console.warn('[NetworkManager] No game host initialized');
      return () => {};
    }
    
    return this.gameHost.onStateUpdate(callback);
  }
  
  /**
   * Subscribe to game events
   */
  onEvent(callback: (event: any) => void): () => void {
    if (!this.gameHost) {
      console.warn('[NetworkManager] No game host initialized');
      return () => {};
    }
    
    return this.gameHost.onEvent(callback);
  }
  
  /**
   * Get interpolated entity for rendering
   */
  getInterpolatedEntity(entityId: string): any {
    if (!this.gameHost) {
      return null;
    }
    
    return this.gameHost.getInterpolatedEntity(entityId);
  }
  
  /**
   * Get local state for prediction
   */
  getLocalState(): GameState | null {
    if (!this.gameHost) {
      return null;
    }
    
    return this.gameHost.getLocalState();
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (!this.gameHost) {
      return false;
    }
    
    if ('isConnected' in this.gameHost && typeof this.gameHost.isConnected === 'function') {
      return this.gameHost.isConnected();
    }
    
    return true; // LocalGameHost is always "connected"
  }
  
  /**
   * Update the network manager (called from game loop)
   */
  update(): void {
    if (!this.gameHost) return;
    
    if ('update' in this.gameHost) {
      (this.gameHost as any).update();
    }
  }
  
  /**
   * Shutdown the network manager
   */
  async shutdown(): Promise<void> {
    if (!this.gameHost) return;
    
    if ('stop' in this.gameHost) {
      (this.gameHost as any).stop();
    }
    
    if ('disconnect' in this.gameHost) {
      await (this.gameHost as any).disconnect();
    }
    
    this.gameHost = null;
    this.isInitialized = false;
    
    console.log('[NetworkManager] Shutdown complete');
  }
  
  /**
   * Get current mode
   */
  getMode(): 'local' | 'network' | 'listen' | null {
    if (!this.gameHost) return null;
    
    if (this.gameHost instanceof LocalGameHost) {
      return 'local';
    }
    
    // TODO: Add checks for NetworkGameHost and ListenGameHost
    
    return null;
  }
  
  /**
   * Get default simulation class
   * In production, this would be the actual game simulation
   */
  private getDefaultSimulationClass(): new (config: SimulationConfig) => Simulation {
    // For now, return a mock simulation
    // In production, this would be:
    // return (config) => new GameSimulation(config);
    
    return class MockSimulation extends Simulation {
      protected createInitialState(): GameState {
        const state = new GameState();
        // Add test entity
        const entity = new Entity('test-entity');
        entity.addComponent('position', {
          x: 0, y: 0, z: 0,
          serialize() {},
          deserialize() {},
          clone() { return { ...this }; }
        });
        entity.addComponent('velocity', {
          x: 0, y: 0, z: 0,
          serialize() {},
          deserialize() {},
          clone() { return { ...this }; }
        });
        state.entities.set('test-entity', entity);
        return state;
      }
      
      protected registerSystems(): void {
        // Add game systems here
      }
      
      protected registerCommandHandlers(): void {
        // Add command handlers here
      }
    };
  }
  
  /**
   * Get default simulation configuration
   */
  private getDefaultSimulationConfig(): SimulationConfig {
    return {
      tickRate: 20,
      tickDuration: 50,
      maxPlayers: 16,
      gameRules: {}
    };
  }
}
