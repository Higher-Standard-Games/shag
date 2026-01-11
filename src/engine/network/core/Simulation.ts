import type { GameState } from './GameState';
import type { Command, CommandHandler } from './Command';

/**
 * Configuration for simulation
 */
export interface SimulationConfig {
  /** Tick rate in Hz */
  tickRate: number;
  
  /** Duration of each tick in milliseconds */
  tickDuration: number;
  
  /** Maximum number of players */
  maxPlayers: number;
  
  /** Game-specific rules */
  gameRules: any;
}

/**
 * Base class for game systems
 * Both engine and game can provide systems
 */
export abstract class GameSystem {
  abstract update(state: GameState, deltaTime: number): void;
}

/**
 * Abstract simulation base class.
 * Games extend this to create their game-specific simulation.
 */
export abstract class Simulation<
  TState extends GameState = GameState,
  TCommand extends Command = Command
> {
  state: TState;
  currentTick: number = 0;
  protected config: SimulationConfig;

  protected systems: GameSystem[] = [];
  protected commandHandlers: Map<string, CommandHandler<TCommand>> = new Map();

  constructor(config: SimulationConfig) {
    this.config = config;
    this.state = this.createInitialState();
    this.registerSystems();
    this.registerCommandHandlers();
  }

  /** Override to create game-specific initial state */
  protected abstract createInitialState(): TState;

  /** Override to register game-specific systems */
  protected abstract registerSystems(): void;

  /** Override to register game-specific command handlers */
  protected abstract registerCommandHandlers(): void;

  /**
   * Advance simulation by one tick.
   * This method is final - don't override.
   */
  tick(commands: TCommand[]): void {
    // Sort commands for determinism
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      return a.seq - b.seq;
    });

    // Execute all commands
    for (const cmd of commands) {
      const handler = this.commandHandlers.get(cmd.type);
      if (handler) {
        handler(this.state, cmd);
      }
    }

    // Update all systems
    const dt = this.config.tickDuration / 1000;
    for (const system of this.systems) {
      system.update(this.state, dt);
    }

    this.currentTick++;
  }

  /** Add a system (engine or game-specific) */
  protected addSystem(system: GameSystem): void {
    this.systems.push(system);
  }

  /** Register a command handler */
  protected onCommand(type: string, handler: CommandHandler<TCommand>): void {
    this.commandHandlers.set(type, handler);
  }
}
