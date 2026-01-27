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

  // Fixed timestep accumulator
  private tickDuration: number; // ms per tick
  private lastTickTime: number = 0;
  private timeAccumulator: number = 0;
  private pendingCommands: Command[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: SimulationConfig, SimulationClass: new (config: SimulationConfig) => Simulation<any, any>) {
    this.simulation = new SimulationClass(config);
    this.localPlayerId = 'local-player';
    this.tickDuration = config.tickDuration; // e.g., 16.67ms for 60Hz
    this.lastTickTime = performance.now();
  }

  /**
   * Get the simulation instance (for setting collision world, spawn points, etc.)
   */
  getSimulation<T extends Simulation<any, any>>(): T {
    return this.simulation as T;
  }

  /**
   * Send command - queues for next tick instead of executing immediately
   */
  sendCommand(cmd: Command): void {
    // Queue command for processing on next tick
    this.pendingCommands.push(cmd);

    // Process any pending ticks based on elapsed time
    this.processAccumulatedTime();
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

  /**
   * Process accumulated time and run simulation ticks at fixed rate
   * This ensures consistent physics regardless of render framerate
   */
  private processAccumulatedTime(): void {
    const now = performance.now();
    const elapsed = now - this.lastTickTime;
    this.lastTickTime = now;

    // Add elapsed time to accumulator
    this.timeAccumulator += elapsed;

    // Cap accumulator to prevent spiral of death (max 5 ticks per call)
    const maxAccumulator = this.tickDuration * 5;
    if (this.timeAccumulator > maxAccumulator) {
      this.timeAccumulator = maxAccumulator;
    }

    // Run ticks while we have enough accumulated time
    while (this.timeAccumulator >= this.tickDuration) {
      // Execute tick with all pending commands
      this.simulation.tick(this.pendingCommands);
      this.pendingCommands = []; // Clear commands after processing

      this.timeAccumulator -= this.tickDuration;

      // Notify state update after each tick
      this.notifyStateUpdate();

      // Process events
      this.processEvents();
    }
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
