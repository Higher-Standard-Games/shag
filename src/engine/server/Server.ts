/**
 * GameServer - Main server class
 *
 * Entry point for running the game server.
 * Combines simulation, networking, and lag compensation.
 */

import { Simulation } from "./core/Simulation";
import type { TickConfig } from "./tick/TickConfig";
import { FPS_TICK_CONFIG } from "./tick/TickConfig";
import { TickOrchestrator } from "./tick/TickOrchestrator";

export interface ServerConfig {
  /** Server port */
  port: number;

  /** Max players */
  maxPlayers: number;

  /** Tick configuration */
  tickConfig: TickConfig;

  /** Map name to load */
  map: string;
}

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  maxPlayers: 16,
  tickConfig: FPS_TICK_CONFIG,
  map: "wdm14",
};

export class GameServer {
  private config: ServerConfig;
  private simulation: Simulation;
  private tickOrchestrator: TickOrchestrator;
  private running: boolean = false;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.simulation = new Simulation({
      tickMs: 1000 / this.config.tickConfig.physics,
    });
    this.tickOrchestrator = new TickOrchestrator(this.config.tickConfig);
  }

  /**
   * Get simulation instance
   */
  getSimulation(): Simulation {
    return this.simulation;
  }

  /**
   * Get tick orchestrator
   */
  getTickOrchestrator(): TickOrchestrator {
    return this.tickOrchestrator;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log(`[GameServer] Starting on port ${this.config.port}...`);
    console.log(`[GameServer] Map: ${this.config.map}`);
    console.log(`[GameServer] Max players: ${this.config.maxPlayers}`);
    console.log(`[GameServer] Physics: ${this.config.tickConfig.physics} Hz`);

    // Initialize simulation
    this.simulation.initialize();

    // Start tick loop
    this.running = true;
    this.tickOrchestrator.start((realDt) => {
      this.tick(realDt);
    });

    console.log(`[GameServer] Started!`);
  }

  /**
   * Main server tick
   */
  private tick(realDt: number): void {
    // Check how many physics ticks to run
    const physicsTicks = this.tickOrchestrator.shouldTick("physics", realDt);

    // Run simulation ticks
    for (let i = 0; i < physicsTicks; i++) {
      this.simulation.tick();
    }

    // TODO: Check networking ticks for snapshots
    // const networkTicks = this.tickOrchestrator.shouldTick('networking', realDt);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (!this.running) return;

    console.log(`[GameServer] Stopping...`);
    this.running = false;
    this.tickOrchestrator.stop();
    this.simulation.cleanup();
    console.log(`[GameServer] Stopped!`);
  }

  /**
   * Check if running
   */
  get isRunning(): boolean {
    return this.running;
  }
}
