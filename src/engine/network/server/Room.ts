import type { Simulation, SimulationConfig } from '../core/Simulation';
import type { GameState } from '../core/GameState';
import type { Command } from '../core/Command';
import type { PlayerId } from '../core/Entity';
import type { Transport } from '../client/transport/Transport';
import { MessageCodec, MessageType } from '../protocol/MessageCodec';

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
  private config: SimulationConfig;
  private clients: Map<string, Client> = new Map();
  private currentTick: number = 0;
  private isRunning: boolean = false;
  private tickInterval: any = null;

  // Server info for welcome message
  private serverId: string;
  private serverName: string;
  private mapName: string;

  // Event callbacks
  private onClientJoinCallbacks: ((client: Client) => void)[] = [];
  private onClientLeaveCallbacks: ((client: Client) => void)[] = [];
  private onTickCallbacks: ((tick: number, state: GameState) => void)[] = [];

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
   */
  handleCommand(clientId: string, command: Command): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Add command to simulation
    this.simulation.tick([command]);
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
  /**
   * Private methods
   */
  private tick(): void {
    this.currentTick++;

    // Run simulation tick (processes movement, physics, etc.)
    this.simulation.tick([]);

    // Notify tick listeners
    this.onTickCallbacks.forEach(cb => cb(this.currentTick, this.simulation.state));

    // Send snapshot to all clients
    this.broadcastSnapshot();
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
