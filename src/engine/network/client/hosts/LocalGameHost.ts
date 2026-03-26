import type { TransformComponent, Vec3 } from "../../components/TransformComponent";
import type { VelocityComponent } from "../../components/VelocityComponent";
import type { Command } from "../../core/Command";
import type { Entity, PlayerId } from "../../core/Entity";
import { type GameEvent, type GameState } from "../../core/GameState";
import type { IGameHost } from "../../core/IGameHost";
import type { Simulation, SimulationConfig } from "../../core/Simulation";

/**
 * Local game host - runs simulation in-process
 * Used for single-player games or listen server hosting
 */
export class LocalGameHost implements IGameHost {
  readonly localPlayerId: PlayerId;
  readonly currentTick: number = 0;

  // biome-ignore lint/suspicious/noExplicitAny: Simulation uses generic type parameters for game-specific state/input
  private simulation: Simulation<any, any>;
  private stateUpdateCallbacks: ((state: GameState) => void)[] = [];
  private eventCallbacks: ((event: GameEvent) => void)[] = [];
  private isRunning: boolean = false;

  // Fixed timestep accumulator
  private tickDuration: number; // ms per tick
  private lastTickTime: number = 0;
  private timeAccumulator: number = 0;
  private pendingCommands: Command[] = [];

  // Interpolation support
  private previousPositions: Map<string, Vec3> = new Map(); // entityId -> previous pos
  private previousVelocities: Map<string, Vec3> = new Map(); // entityId -> previous vel

  // biome-ignore lint/suspicious/noExplicitAny: Simulation uses generic type parameters for game-specific state/input
  constructor(config: SimulationConfig, SimulationClass: new (config: SimulationConfig) => Simulation<any, any>) {
    this.simulation = new SimulationClass(config);
    this.localPlayerId = "local-player";
    this.tickDuration = config.tickDuration; // e.g., 16.67ms for 60Hz
    this.lastTickTime = performance.now();
  }

  /**
   * Get the simulation instance (for setting collision world, spawn points, etc.)
   */
  // biome-ignore lint/suspicious/noExplicitAny: game-specific simulation types vary
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
  onEvent(callback: (event: GameEvent) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get interpolated entity position and velocity
   * Uses stored previous state and interpolation factor for smooth rendering
   */
  getInterpolatedEntity(entityId: string): Entity | undefined {
    return this.simulation.state.entities.get(entityId);
  }

  /**
   * Get interpolated position for an entity
   * Returns current position interpolated from previous based on accumulated time
   */
  getInterpolatedPosition(entityId: string): Vec3 | null {
    const entity = this.simulation.state.entities.get(entityId) as Entity | undefined;
    if (!entity) return null;

    const transform = entity.getComponent<TransformComponent>("transform");
    if (!transform) return null;

    const prevPos = this.previousPositions.get(entityId);
    if (!prevPos) {
      return { ...transform.position };
    }

    const t = this.getInterpolationFactor();
    return {
      x: prevPos.x + (transform.position.x - prevPos.x) * t,
      y: prevPos.y + (transform.position.y - prevPos.y) * t,
      z: prevPos.z + (transform.position.z - prevPos.z) * t,
    };
  }

  /**
   * Get interpolated velocity for an entity
   */
  getInterpolatedVelocity(entityId: string): Vec3 | null {
    const entity = this.simulation.state.entities.get(entityId) as Entity | undefined;
    if (!entity) return null;

    const velocity = entity.getComponent<VelocityComponent>("velocity");
    if (!velocity) return null;

    const prevVel = this.previousVelocities.get(entityId);
    if (!prevVel) {
      return { ...velocity.linear };
    }

    const t = this.getInterpolationFactor();
    return {
      x: prevVel.x + (velocity.linear.x - prevVel.x) * t,
      y: prevVel.y + (velocity.linear.y - prevVel.y) * t,
      z: prevVel.z + (velocity.linear.z - prevVel.z) * t,
    };
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
      // Store previous positions before tick for interpolation
      this.storePreviousState();

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

  /**
   * Store entity positions before tick for interpolation
   */
  private storePreviousState(): void {
    for (const [entityId, rawEntity] of this.simulation.state.entities) {
      const entity = rawEntity as Entity;
      const transform = entity.getComponent<TransformComponent>("transform");
      const velocity = entity.getComponent<VelocityComponent>("velocity");

      if (transform) {
        this.previousPositions.set(entityId, { ...transform.position });
      }
      if (velocity) {
        this.previousVelocities.set(entityId, { ...velocity.linear });
      }
    }
  }

  /**
   * Get interpolation factor (0-1) based on time within current tick
   */
  getInterpolationFactor(): number {
    return Math.min(1, this.timeAccumulator / this.tickDuration);
  }

  private notifyStateUpdate(): void {
    const state = this.simulation.state;
    this.stateUpdateCallbacks.forEach((callback) => callback(state));
  }

  private processEvents(): void {
    const events = this.simulation.state.events;
    this.simulation.state.events = []; // Clear events

    events.forEach((event: GameEvent) => {
      this.eventCallbacks.forEach((callback) => callback(event));
    });
  }
}
