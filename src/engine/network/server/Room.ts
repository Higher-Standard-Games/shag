/**
 * Room.ts - Server-Side Game Room
 *
 * This is the heart of the server-side networking. A Room hosts a single game match,
 * managing connected clients and running the authoritative simulation.
 *
 * KEY CONCEPTS:
 *
 * 1. AUTHORITATIVE SERVER: The server's simulation is the "source of truth".
 *    Clients predict locally, but server state always wins.
 *
 * 2. TICK-BASED SIMULATION: The game runs in discrete time steps called "ticks".
 *    At 20Hz, each tick is 50ms. All game logic happens in ticks, not real-time.
 *
 * 3. COMMAND BATCHING: Player inputs (commands) arrive asynchronously over the network.
 *    We queue them and process ALL commands together at the start of each tick.
 *    This ensures deterministic simulation - same inputs = same outputs.
 *
 * 4. SNAPSHOT BROADCASTING: After each tick, we send the current game state to all
 *    clients. Clients use this to correct their local predictions.
 *
 * DATA FLOW:
 *   Client Input → WebSocket → handleClientMessage → pendingCommands queue
 *   Tick Timer → tick() → simulation.tick(pendingCommands) → broadcastSnapshot()
 */

import type { Simulation, SimulationConfig } from '../core/Simulation';
import type { GameState } from '../core/GameState';
import type { Command } from '../core/Command';
import type { PlayerId } from '../core/Entity';
import type { Transport } from '../client/transport/Transport';
import { MessageCodec, MessageType } from '../protocol/MessageCodec';

/**
 * Represents a connected client in a room.
 * Each client has a transport (WebSocket connection) and a player in the simulation.
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
  private config: SimulationConfig;
  private clients: Map<string, Client> = new Map();
  private currentTick: number = 0;
  private isRunning: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private networkInterval: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;   // Timestamp of last physics tick
  private accumulator: number = 0;    // Accumulated time for fixed timestep

  // Server info for welcome message
  private serverId: string;
  private serverName: string;
  private mapName: string;

  // Event callbacks
  private onClientJoinCallbacks: ((client: Client) => void)[] = [];
  private onClientLeaveCallbacks: ((client: Client) => void)[] = [];
  private onTickCallbacks: ((tick: number, state: GameState) => void)[] = [];

  // ============================================================================
  // COMMAND QUEUE - Critical for deterministic simulation!
  // ============================================================================
  // Commands arrive asynchronously from clients over the network. If we processed
  // each command immediately, the simulation would be non-deterministic (depends on
  // network timing). Instead, we queue all commands and process them together at
  // the start of each tick. This ensures: same inputs + same tick = same results.
  private pendingCommands: Command[] = [];

  constructor(
    id: string,
    config: SimulationConfig,
    SimulationClass: new (config: SimulationConfig) => Simulation,
    maxClients: number = 16,
    serverName: string = 'SHAG Server',
    mapName: string = 'default'
  ) {
    this.id = id;
    this.maxClients = maxClients;
    this.config = config;
    this.simulation = new SimulationClass(config);
    this.serverId = `srv_${id}`;
    this.serverName = serverName;
    this.mapName = mapName;
  }

  /**
   * Add a client to the room
   * Follows the handshake protocol: WELCOME → (client JOIN) → JOIN_ACCEPT → SNAPSHOT
   */
  addClient(clientId: string, transport: Transport): boolean {
    if (this.clients.size >= this.maxClients) {
      return false;
    }

    if (this.clients.has(clientId)) {
      return false;
    }

    // Create unique entity for this player
    const playerId = `player_${clientId}`;
    let entityId: string;

    // Check if simulation has a spawnPlayer method (game-specific spawning)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sim = this.simulation as any;
    if (typeof sim.spawnPlayer === 'function') {
      // Use game-specific spawning (e.g., FPSSimulation creates entity with components)
      const entity = sim.spawnPlayer(playerId);
      entityId = entity.id;
      console.log(`[Room ${this.id}] Spawned player ${playerId} via simulation.spawnPlayer, entity: ${entityId}`);
    } else {
      // Fallback: create basic player record
      entityId = `entity_${clientId}`;
      const player = {
        entityId,
        name: clientId,
        team: '',
        score: 0,
        ping: 0,
        serialize() { return {}; },
        deserialize() { },
        clone() { return { ...this }; }
      };
      this.simulation.state.players.set(playerId, player);
    }


    const client: Client = {
      id: clientId,
      transport,
      playerId,
      lastAckTick: 0,
      ping: 0,
      joinTime: Date.now()
    };

    this.clients.set(clientId, client);

    // Set up message handlers for this client
    this.setupClientHandlers(client);

    // === HANDSHAKE PROTOCOL ===
    // Step 1: Send WELCOME with server info
    const welcomeData = MessageCodec.encodeWelcome(
      this.serverId,
      this.serverName,
      this.mapName,
      this.config.tickRate,
      this.maxClients,
      this.clients.size
    );
    transport.send(welcomeData);

    // Step 2: Send JOIN_ACCEPT with client's assigned IDs
    const joinAcceptData = MessageCodec.encodeJoinAccept(clientId, playerId, entityId);
    transport.send(joinAcceptData);

    // Step 3: Send initial snapshot
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sim = this.simulation as any;
    if (typeof sim.despawnPlayer === 'function') {
      sim.despawnPlayer(client.playerId);
    } else {
      this.simulation.state.players.delete(client.playerId);
    }

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
   * Commands are queued and processed in the next tick for deterministic simulation
   */
  handleCommand(clientId: string, command: Command): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Queue command for next tick instead of immediate processing
    // This ensures deterministic simulation: all commands for a tick are processed together
    this.pendingCommands.push(command);
  }

  /**
   * Start the room simulation with separate physics and network loops
   * @param physicsRate - How often physics simulation runs (default 60Hz)
   * @param networkRate - How often snapshots are sent to clients (default 20Hz, sv_pps)
   */
  start(physicsRate: number = 60, networkRate: number = 20): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const physicsDuration = 1000 / physicsRate;
    const networkDuration = 1000 / networkRate;

    // Physics loop - runs simulation at high rate for accuracy
    this.tickInterval = setInterval(() => {
      this.physicsTick();
    }, physicsDuration);

    // Network loop - sends snapshots at lower rate for bandwidth efficiency
    this.networkInterval = setInterval(() => {
      this.broadcastSnapshot();
    }, networkDuration);

    console.log(`[Room ${this.id}] Started: physics=${physicsRate}Hz, network=${networkRate}Hz`);
  }

  /**
   * Stop the room simulation
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Clear physics loop
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Clear network loop
    if (this.networkInterval) {
      clearInterval(this.networkInterval);
      this.networkInterval = null;
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
   * Get the simulation instance
   * Useful for configuring the simulation after room creation (e.g., setting collision world)
   */
  getSimulation(): Simulation {
    return this.simulation;
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
  // ============================================================================
  // PHYSICS TICK - Server simulation heartbeat (runs at high rate, e.g., 60Hz)
  // ============================================================================
  /**
   * Execute one physics tick. Runs at high rate for simulation accuracy.
   * Network snapshots are sent separately at lower rate (sv_pps).
   *
   * The tick follows this sequence:
   * 1. Increment tick counter (this is the authoritative server time)
   * 2. Process ALL queued commands from clients (deterministic order)
   * 3. Run physics and game systems (MovementSystem, etc.)
   * 4. Notify any tick listeners (for debugging, logging, etc.)
   *
   * Note: Snapshot broadcasting is handled by the network loop, not here.
   */
  private physicsTick(): void {
    const outputDebug = Math.random() < 0.05; // 5% chance to log

    // 1. Measure actual wall-clock time since last tick
    const now = Date.now();
    if (this.lastTickTime === 0) {
      this.lastTickTime = now;
      return; // Skip first tick to establish baseline
    }

    let frameTime = now - this.lastTickTime;
    this.lastTickTime = now;

    // Cap frame time to avoid spiral of death on massive lag spikes (e.g. GC pause)
    // If server freezes for 1s, we don't want to run 125 physics steps in one go.
    // Cap at 100ms (max 12 ticks catchup)
    if (frameTime > 100) {
      console.warn(`[Room ${this.id}] Large lag spike: ${frameTime}ms (capped to 100ms)`);
      frameTime = 100;
    }

    // 2. Add to accumulator
    this.accumulator += frameTime;

    // 3. Run fixed physics steps while we have enough accumulated time
    const tickDuration = 1000 / 125; // 8ms (must match physics config)
    let steps = 0;
    const MAX_STEPS = 5; // Safety cap per frame

    while (this.accumulator >= tickDuration && steps < MAX_STEPS) {
      // Step 1: Advance server time
      this.currentTick++;

      // Step 2 & 3: Process commands and run physics
      // We pass pending commands only to the FIRST tick of the batch to ensure responsiveness
      // Subsequent catch-up ticks simulate physics to catch up time
      const commandsToProcess = steps === 0 ? this.pendingCommands : [];

      this.simulation.tick(commandsToProcess);

      // Step 3b: Clear the queue after processing
      if (steps === 0) {
        this.pendingCommands = [];
      }

      // Step 4: Notify listeners
      this.onTickCallbacks.forEach(cb => cb(this.currentTick, this.simulation.state));

      this.accumulator -= tickDuration;
      steps++;
    }

    // If we hit the safety cap, discard remaining accumulator to emit "time skipping"
    // rather than falling permanently behind
    if (steps >= MAX_STEPS && this.accumulator >= tickDuration) {
      if (outputDebug) {
        console.warn(`[Room ${this.id}] Hit max steps safety cap! Discarding ${this.accumulator.toFixed(1)}ms`);
      }
      this.accumulator = 0;
    }

    // Debug logging for loop stability
    if (outputDebug && steps !== 1) {
      // Log if we did 0 ticks (fast loop) or >1 ticks (catchup)
      // This confirms the accumulator is working
      console.log(`[Room ${this.id}] dt=${frameTime}ms -> ran ${steps} ticks`);
    }
  }

  /**
   * Set up message handlers for a client
   */
  setupClientHandlers(client: Client): void {
    client.transport.onMessage((data: Uint8Array) => {
      this.handleClientMessage(client, data);
    });

    client.transport.onDisconnect(() => {
      this.removeClient(client.id);
    });

    client.transport.onError((error) => {
      console.error(`[Room ${this.id}] Transport error for ${client.id}:`, error);
      this.removeClient(client.id);
    });
  }

  /**
   * Handle incoming message from client using binary protocol
   */
  private handleClientMessage(client: Client, data: Uint8Array): void {
    try {
      const messageType = MessageCodec.peekMessageType(data);

      switch (messageType) {
        case MessageType.Join: {
          // Client sent JOIN after receiving WELCOME - we already handled this in addClient
          // Just log and acknowledge
          const { playerName } = MessageCodec.decodeJoin(data);
          console.log(`[Room ${this.id}] Client ${client.id} confirmed join as "${playerName}"`);
          break;
        }
        case MessageType.Input: {
          const { playerId, command } = MessageCodec.decodeCommand(data);
          // Verify player owns this command
          if (playerId === client.playerId) {
            this.handleCommand(client.id, command);
          }
          break;
        }
        case MessageType.Ack: {
          const { tick } = MessageCodec.decodeAck(data);
          client.lastAckTick = tick;
          break;
        }
        default:
          console.warn(`[Room ${this.id}] Unknown message type: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      console.error(`[Room ${this.id}] Failed to handle message from ${client.id}:`, error);
    }
  }

  /**
   * Send snapshot to a single client using binary protocol
   */
  private sendSnapshot(client: Client): void {
    const snapshot = this.createSnapshot();
    // TODO: Use client.lastAckTick for delta compression baseline
    const data = MessageCodec.encodeSnapshot(snapshot);
    client.transport.send(data);
  }

  /**
   * Broadcast snapshot to all connected clients using binary protocol
   */
  private broadcastSnapshot(): void {
    const snapshot = this.createSnapshot();
    // Encode once, send to all (no delta compression for simplicity)
    const data = MessageCodec.encodeSnapshot(snapshot);

    for (const client of this.clients.values()) {
      client.transport.send(data);
    }
  }

  /**
   * Create a snapshot of current game state
   */
  private createSnapshot(): GameState {
    const snapshot = this.simulation.state.clone();
    snapshot.tick = this.currentTick;
    return snapshot;
  }
}
