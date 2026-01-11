import { GameServer } from './GameServer';
import type { Simulation, SimulationConfig } from '../core/Simulation';
import type { Transport } from '../client/transport/Transport';

/**
 * Simple WebSocket server implementation for testing
 * In production, this would be replaced by a proper WebSocket server
 */
export class WebSocketServer {
  private gameServer: GameServer;
  private port: number;
  
  constructor(port: number, config: SimulationConfig, SimulationClass: new (config: SimulationConfig) => Simulation) {
    this.port = port;
    this.gameServer = new GameServer(config, SimulationClass);
  }
  
  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    try {
      // For testing, we'll create a mock server
      // In production, use ws or socket.io
      console.log(`[WebSocketServer] Mock server started on port ${this.port}`);
      
      // Set up event handlers
      this.gameServer.onRoomCreate((room) => {
        console.log(`[WebSocketServer] Room created: ${room.id}`);
      });
      
      this.gameServer.onClientConnect((clientId) => {
        console.log(`[WebSocketServer] Client connected: ${clientId}`);
      });
      
      this.gameServer.onClientDisconnect((clientId) => {
        console.log(`[WebSocketServer] Client disconnected: ${clientId}`);
      });
      
    } catch (error) {
      console.error('[WebSocketServer] Failed to start:', error);
      throw error;
    }
  }
  
  /**
   * Stop the server
   */
  stop(): void {
    this.gameServer.shutdown();
    console.log('[WebSocketServer] Server stopped');
  }
  
  /**
   * Add a mock client (for testing)
   */
  addMockClient(clientId: string): void {
    const mockTransport = new MockTransport();
    this.gameServer.addClient(clientId, mockTransport);
  }
  
  /**
   * Get server statistics
   */
  getStats(): any {
    return this.gameServer.getStats();
  }
  
  /**
   * Create a room
   */
  createRoom(roomId: string, maxClients?: number): void {
    this.gameServer.createRoom(roomId, maxClients);
  }
}

/**
 * Mock transport for testing
 */
class MockTransport implements Transport {
  private onMessageCallbacks: ((data: Uint8Array) => void)[] = [];
  private onConnectCallbacks: (() => void)[] = [];
  private onDisconnectCallbacks: ((reason?: string) => void)[] = [];
  private onErrorCallbacks: ((error: Error) => void)[] = [];
  private connected: boolean = false;
  
  async connect(_url?: string): Promise<void> {
    this.connected = true;
    this.onConnectCallbacks.forEach(cb => cb());
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
    this.onDisconnectCallbacks.forEach(cb => cb());
  }
  
  send(data: Uint8Array, _reliable?: boolean): void {
    // Mock implementation - would send over WebSocket
    console.log(`[MockTransport] Sending ${data.length} bytes`);
  }
  
  onMessage(callback: (data: Uint8Array) => void): () => void {
    this.onMessageCallbacks.push(callback);
    return () => {
      const index = this.onMessageCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onMessageCallbacks.splice(index, 1);
      }
    };
  }
  
  onConnect(callback: () => void): () => void {
    this.onConnectCallbacks.push(callback);
    return () => {
      const index = this.onConnectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onConnectCallbacks.splice(index, 1);
      }
    };
  }
  
  onDisconnect(callback: (reason?: string) => void): () => void {
    this.onDisconnectCallbacks.push(callback);
    return () => {
      const index = this.onDisconnectCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onDisconnectCallbacks.splice(index, 1);
      }
    };
  }
  
  onError(callback: (error: Error) => void): () => void {
    this.onErrorCallbacks.push(callback);
    return () => {
      const index = this.onErrorCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onErrorCallbacks.splice(index, 1);
      }
    };
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  // For testing - simulate receiving a message
  simulateMessage(data: Uint8Array): void {
    this.onMessageCallbacks.forEach(cb => cb(data));
  }
}
