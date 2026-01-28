/**
 * Simulation.ts - The Core Game Simulation
 *
 * This is the deterministic game simulation that runs identically on server and client.
 * Think of it as a pure function: given the same inputs (commands), it produces the
 * same outputs (state) every time. This predictability is what makes networked games work.
 *
 * KEY CONCEPTS:
 *
 * 1. DETERMINISM: The simulation MUST be deterministic. Same commands in the same order
 *    must produce identical results. This is why we sort commands before processing.
 *
 * 2. tick() vs predict():
 *    - tick(): Used by SERVER. Processes commands, runs physics, increments tick counter.
 *    - predict(): Used by CLIENT. Same logic but WITHOUT incrementing tick counter.
 *
 *    Why the difference? The server is authoritative - its tick counter is the "real" time.
 *    The client runs prediction for instant feedback, but its tick sync comes from server
 *    snapshots, not from counting local predictions.
 *
 * 3. SYSTEMS: Game logic is split into systems (MovementSystem, etc.) that each update
 *    part of the game state. Systems run after commands are processed.
 *
 * 4. COMMAND HANDLERS: Each command type (e.g., 'fps_input') has a handler that
 *    applies the player's input to their entity's components.
 */

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

  // ============================================================================
  // TICK - Server uses this. Advances simulation time.
  // ============================================================================
  /**
   * Advance simulation by one tick. Used by the SERVER.
   *
   * This is the authoritative simulation step:
   * 1. Process all commands (player inputs)
   * 2. Run all systems (physics, game logic)
   * 3. Increment the tick counter (advance game time)
   *
   * The tick counter is important - it's used by clients for:
   * - Knowing which commands have been processed
   * - Reconciling prediction errors
   * - Interpolating between snapshots
   */
  tick(commands: TCommand[]): void {
    this.processCommands(commands);
    this.runSystems();
    this.currentTick++;
  }

  // ============================================================================
  // PREDICT - Client uses this. Does NOT advance tick counter.
  // ============================================================================
  /**
   * Run prediction without incrementing tick counter. Used by the CLIENT.
   *
   * Why is this different from tick()?
   *
   * Imagine you press W to move forward:
   * - Without prediction: You wait 50-100ms for server response. Feels laggy.
   * - With prediction: You see movement immediately. Feels responsive.
   *
   * But here's the catch: if we incremented the tick counter on every prediction,
   * the client's tick would race ahead of the server's. At 60fps, client would be
   * at tick 600 while server is at tick 200!
   *
   * Solution: Client runs physics for instant feedback, but its tick counter is
   * synchronized from server snapshots, not from counting predictions.
   */
  predict(commands: TCommand[]): void {
    this.processCommands(commands);
    this.runSystems();
    // Tick NOT incremented - server snapshots drive client tick sync
  }

  // ============================================================================
  // COMMAND PROCESSING - The input handling stage
  // ============================================================================
  /**
   * Process commands in deterministic order.
   *
   * CRITICAL: Commands must be sorted before processing!
   *
   * Why? Network packets can arrive in any order. If Player A's command arrives
   * before Player B's on one machine, but after on another, the simulations diverge.
   *
   * Sorting by (playerId, sequence) ensures identical order everywhere:
   * - playerId: Alphabetical order of player IDs
   * - sequence: Order within a single player's commands
   */
  private processCommands(commands: TCommand[]): void {
    // Sort for determinism - same order on every machine
    commands.sort((a, b) => {
      if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
      return a.seq - b.seq;
    });

    // Execute each command's handler
    // Handler typically updates the entity's InputComponent with the player's wishes
    for (const cmd of commands) {
      const handler = this.commandHandlers.get(cmd.type);
      if (handler) {
        handler(this.state, cmd);
      }
    }
  }

  // ============================================================================
  // SYSTEMS - The physics and game logic stage
  // ============================================================================
  /**
   * Run all game systems for one tick.
   *
   * Systems are the "doers" of the simulation. After commands set up what players
   * WANT to do (via InputComponent), systems make it HAPPEN:
   *
   * - MovementSystem: Reads InputComponent, applies physics, updates position
   * - (Future) CombatSystem: Processes attacks, applies damage
   * - (Future) ItemSystem: Handles pickups, power-ups
   *
   * Each system receives deltaTime (dt) so physics is frame-rate independent.
   * At 20Hz tick rate, dt = 0.05 seconds (50ms).
   */
  private runSystems(): void {
    const dt = this.config.tickDuration / 1000; // Convert ms to seconds
    for (const system of this.systems) {
      system.update(this.state, dt);
    }
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
