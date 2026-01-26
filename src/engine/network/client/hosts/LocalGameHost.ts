import type { IGameHost } from '../../core/IGameHost';
import type { GameState } from '../../core/GameState';
import type { Command } from '../../core/Command';
import type { Simulation, SimulationConfig } from '../../core/Simulation';
import type { PlayerId } from '../../core/Entity';

/**
 * Local game host - runs simulation in-process
 * Used for single-player games or listen server hosting
 */
export class LocalGameHost implements IGameHost {
  readonly localPlayerId: PlayerId;
  readonly currentTick: number = 0;

  private simulation: Simulation<any, any>;
  private stateUpdateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: any) => void)[] = [];
  private isRunning: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: SimulationConfig, SimulationClass: new (config: SimulationConfig) => Simulation<any, any>) {
    this.simulation = new SimulationClass(config);
    this.localPlayerId = 'local-player';
  }

  /**
   * Get the simulation instance (for setting collision world, spawn points, etc.)
   */
  getSimulation<T extends Simulation<any, any>>(): T {
    return this.simulation as T;
  }

  /**
   * Send command - executes immediately in local simulation
   */
  sendCommand(cmd: Command): void {
    // Execute command immediately
    this.simulation.tick([cmd]);

    // Notify state update
    this.notifyStateUpdate();

    // Process events
    this.processEvents();
  }

  /**
   * Subscribe to state updates
   */
  onStateUpdate(callback: (state: GameState) => void): () => void {
    this.stateUpdateCallbacks.push(callback);
    return () => {
      const index = this.stateUpdateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateUpdateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to game events
   */
  onEvent(callback: (event: any) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get interpolated entity - same as current for local host
   */
  getInterpolatedEntity(entityId: string): any {
    return this.simulation.state.entities.get(entityId);
  }

  /**
   * Get local state - same as simulation state
   */
  getLocalState(): GameState {
    return this.simulation.state;
  }

  /**
   * Start the simulation loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial state update
    this.notifyStateUpdate();
  }

  /**
   * Stop the simulation loop
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Update simulation (called from game loop)
   */
  update(): void {
    if (!this.isRunning) return;

    // Local host doesn't need to tick continuously
    // Commands are processed immediately when sent
  }

  private notifyStateUpdate(): void {
    const state = this.simulation.state;
    this.stateUpdateCallbacks.forEach(callback => callback(state));
  }

  private processEvents(): void {
    const events = this.simulation.state.events;
    this.simulation.state.events = []; // Clear events

    events.forEach((event: any) => {
      this.eventCallbacks.forEach(callback => callback(event));
    });
  }
}
