import { Room } from './Room';
import type { Simulation, SimulationConfig } from '../core/Simulation';
import type { Transport } from '../client/transport/Transport';

/**
 * Server configuration
 */
export interface GameServerConfig {
  serverName?: string;
  mapName?: string;
}

/**
 * GameServer - manages multiple game rooms
 * Handles client connections and routes them to appropriate rooms
 */
export class GameServer {
  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, { transport: Transport; roomId?: string }> = new Map();
  private defaultRoomConfig: SimulationConfig;
  private SimulationClass: new (config: SimulationConfig) => Simulation;
  private serverName: string;
  private mapName: string;

  // Event callbacks
  private onRoomCreateCallbacks: ((room: Room) => void)[] = [];
  private onRoomDestroyCallbacks: ((roomId: string) => void)[] = [];
  private onClientConnectCallbacks: ((clientId: string) => void)[] = [];
  private onClientDisconnectCallbacks: ((clientId: string) => void)[] = [];

  constructor(
    defaultRoomConfig: SimulationConfig,
    SimulationClass: new (config: SimulationConfig) => Simulation,
    config: GameServerConfig = {}
  ) {
    this.defaultRoomConfig = defaultRoomConfig;
    this.SimulationClass = SimulationClass;
    this.serverName = config.serverName ?? 'SHAG Server';
    this.mapName = config.mapName ?? 'default';
  }

  /**
   * Handle new client connection
   */
  addClient(clientId: string, transport: Transport, roomId?: string): boolean {
    // Check if client already exists
    if (this.clients.has(clientId)) {
      console.warn(`[GameServer] Client ${clientId} already connected`);
      return false;
    }

    // Find or create room
    let room = roomId ? this.rooms.get(roomId) : this.getAvailableRoom();

    if (!room) {
      // Create new room
      room = this.createRoom(roomId || `room_${Date.now()}`);
    }

    // Add client to room
    if (!room.addClient(clientId, transport)) {
      console.error(`[GameServer] Failed to add client ${clientId} to room ${room.id}`);
      return false;
    }

    // Track client
    this.clients.set(clientId, { transport, roomId: room.id });

    // Set up message handling for this client
    this.setupClientHandlers(clientId, transport, room);

    // Notify listeners
    this.onClientConnectCallbacks.forEach(cb => cb(clientId));

    console.log(`[GameServer] Client ${clientId} connected to room ${room.id}`);
    return true;
  }

  /**
   * Remove client from server
   */
  removeClient(clientId: string): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    // Remove from room
    if (clientInfo.roomId) {
      const room = this.rooms.get(clientInfo.roomId);
      if (room) {
        room.removeClient(clientId);
      }
    }

    // Stop tracking client
    this.clients.delete(clientId);

    // Notify listeners
    this.onClientDisconnectCallbacks.forEach(cb => cb(clientId));

    console.log(`[GameServer] Client ${clientId} disconnected`);
  }

  /**
   * Create a new room
   */
  createRoom(roomId: string, maxClients: number = 16): Room {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`);
    }

    const room = new Room(roomId, this.defaultRoomConfig, this.SimulationClass, maxClients, this.serverName, this.mapName);

    // Set up room event handlers
    room.onClientJoin((client) => {
      console.log(`[GameServer] Client ${client.id} joined room ${room.id}`);
    });

    room.onClientLeave((client) => {
      console.log(`[GameServer] Client ${client.id} left room ${room.id}`);
    });

    room.onTick((_tick, _state) => {
      // Could be used for logging, analytics, etc.
    });

    this.rooms.set(roomId, room);

    // Start the room
    room.start();

    // Notify listeners
    this.onRoomCreateCallbacks.forEach(cb => cb(room));

    console.log(`[GameServer] Created room ${roomId}`);
    return room;
  }

  /**
   * Destroy a room
   */
  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Remove all clients from room
    const clients = room.getClients();
    for (const client of clients) {
      this.removeClient(client.id);
    }

    // Stop room
    room.stop();

    // Remove from server
    this.rooms.delete(roomId);

    // Notify listeners
    this.onRoomDestroyCallbacks.forEach(cb => cb(roomId));

    console.log(`[GameServer] Destroyed room ${roomId}`);
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Get all rooms
   */
  getRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get server statistics
   */
  getStats(): {
    totalClients: number;
    totalRooms: number;
    rooms: Array<{
      id: string;
      clientCount: number;
      maxClients: number;
      isRunning: boolean;
    }>;
  } {
    return {
      totalClients: this.clients.size,
      totalRooms: this.rooms.size,
      rooms: Array.from(this.rooms.values()).map(room => room.getState())
    };
  }

  /**
   * Shutdown the server
   */
  shutdown(): void {
    console.log('[GameServer] Shutting down...');

    // Destroy all rooms
    const roomIds = Array.from(this.rooms.keys());
    for (const roomId of roomIds) {
      this.destroyRoom(roomId);
    }

    console.log('[GameServer] Shutdown complete');
  }

  /**
   * Event subscription methods
   */
  onRoomCreate(callback: (room: Room) => void): () => void {
    this.onRoomCreateCallbacks.push(callback);
    return () => {
      const index = this.onRoomCreateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onRoomCreateCallbacks.splice(index, 1);
      }
    };
  }

  onRoomDestroy(callback: (roomId: string) => void): () => void {
    this.onRoomDestroyCallbacks.push(callback);
    return () => {
      const index = this.onRoomDestroyCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onRoomDestroyCallbacks.splice(index, 1);
      }
    };
  }

  onClientConnect(callback: (clientId: string) => void): () => void {
    this.onClientConnectCallbacks.push(callback);
    return () => {
      const index = this.onClientConnectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onClientConnectCallbacks.splice(index, 1);
      }
    };
  }

  onClientDisconnect(callback: (clientId: string) => void): () => void {
    this.onClientDisconnectCallbacks.push(callback);
    return () => {
      const index = this.onClientDisconnectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onClientDisconnectCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Private methods
   */
  private getAvailableRoom(): Room | null {
    // Find room with space
    for (const room of this.rooms.values()) {
      if (room.getClients().length < room.maxClients) {
        return room;
      }
    }
    return null;
  }

  /**
   * Set up message handlers for a client
   * Note: Room now handles its own message routing via setupClientHandlers
   * This is just for connection-level handling
   */
  private setupClientHandlers(clientId: string, transport: Transport, _room: Room): void {
    // Room handles message parsing, we just handle connection events
    transport.onDisconnect(() => {
      this.removeClient(clientId);
    });

    transport.onError((error) => {
      console.error(`[GameServer] Transport error for ${clientId}:`, error);
      this.removeClient(clientId);
    });
  }
}
