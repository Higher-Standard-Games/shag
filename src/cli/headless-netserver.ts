/**
 * Headless Network Server CLI
 *
 * Dedicated game server for testing the networking stack.
 * Runs a game room and accepts WebSocket connections.
 *
 * Usage:
 *   npm run net:server -- --port 7777 --map wdm7
 *   npm run net:server -- --port 7777 --name "Test Server"
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { GameServer } from '../engine/network/server/GameServer';
import { TestSimulation, testConfig } from '../engine/network/test/TestSimulation';
import type { Transport } from '../engine/network/client/transport/Transport';

// Parse command line arguments
const args = process.argv.slice(2);
let port = 7777;
let serverName = 'SHAG Test Server';
let mapName = 'wdm7';
let maxClients = 16;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--name' && args[i + 1]) {
    serverName = args[i + 1];
    i++;
  } else if (args[i] === '--map' && args[i + 1]) {
    mapName = args[i + 1];
    i++;
  } else if (args[i] === '--max' && args[i + 1]) {
    maxClients = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Headless Network Server

Usage:
  npx vite-node src/cli/headless-netserver.ts [options]

Options:
  --port <port>   Server port (default: 7777)
  --name <name>   Server name (default: "SHAG Test Server")
  --map <map>     Map name (default: wdm7)
  --max <count>   Max clients (default: 16)
  --help, -h      Show this help
`);
    process.exit(0);
  }
}

console.log(`[Server] Starting ${serverName}...`);
console.log(`[Server] Port: ${port}`);
console.log(`[Server] Map: ${mapName}`);
console.log(`[Server] Max clients: ${maxClients}`);

// Create the game server
const gameServer = new GameServer(testConfig, TestSimulation);

// Create WebSocket server
const wss = new WSServer({ port });

// Track clients
let clientCounter = 0;

wss.on('listening', () => {
  console.log(`[Server] Listening on ws://localhost:${port}`);
  console.log(`[Server] Waiting for connections...`);
});

wss.on('connection', (ws: WebSocket, req) => {
  const clientId = `client_${++clientCounter}`;
  const remoteAddr = req.socket.remoteAddress || 'unknown';
  console.log(`[Server] Client ${clientId} connected from ${remoteAddr}`);

  // Create transport wrapper for this WebSocket
  const transport = new NodeWebSocketTransport(ws);

  // Add to game server
  if (!gameServer.addClient(clientId, transport)) {
    console.log(`[Server] Failed to add client ${clientId}`);
    ws.close();
    return;
  }

  ws.on('close', () => {
    console.log(`[Server] Client ${clientId} disconnected`);
    gameServer.removeClient(clientId);
  });

  ws.on('error', (error) => {
    console.error(`[Server] Client ${clientId} error:`, error.message);
    gameServer.removeClient(clientId);
  });
});

wss.on('error', (error) => {
  console.error('[Server] WebSocket server error:', error);
});

// Set up game server events
gameServer.onClientConnect((clientId) => {
  console.log(`[Server] GameServer: Client ${clientId} added`);
  logStats();
});

gameServer.onClientDisconnect((clientId) => {
  console.log(`[Server] GameServer: Client ${clientId} removed`);
  logStats();
});

function logStats(): void {
  const stats = gameServer.getStats();
  console.log(`[Server] Stats: ${stats.totalClients} clients, ${stats.totalRooms} rooms`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  gameServer.shutdown();
  wss.close();
  process.exit(0);
});

console.log('[Server] Press Ctrl+C to stop');

/**
 * Node.js WebSocket transport wrapper
 */
class NodeWebSocketTransport implements Transport {
  private ws: WebSocket;
  private messageCallbacks: ((data: Uint8Array) => void)[] = [];
  private connectCallbacks: (() => void)[] = [];
  private disconnectCallbacks: ((reason?: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.ws.on('message', (data: Buffer) => {
      const uint8 = new Uint8Array(data);
      this.messageCallbacks.forEach(cb => cb(uint8));
    });

    this.ws.on('close', (_code, reason) => {
      this.disconnectCallbacks.forEach(cb => cb(reason?.toString()));
    });

    this.ws.on('error', (error) => {
      this.errorCallbacks.forEach(cb => cb(error));
    });
  }

  async connect(_url: string): Promise<void> {
    // Already connected via constructor
    this.connectCallbacks.forEach(cb => cb());
  }

  async disconnect(): Promise<void> {
    this.ws.close();
  }

  send(data: Uint8Array, _reliable: boolean = true): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  onMessage(callback: (data: Uint8Array) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index >= 0) this.messageCallbacks.splice(index, 1);
    };
  }

  onConnect(callback: () => void): () => void {
    this.connectCallbacks.push(callback);
    return () => {
      const index = this.connectCallbacks.indexOf(callback);
      if (index >= 0) this.connectCallbacks.splice(index, 1);
    };
  }

  onDisconnect(callback: (reason?: string) => void): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      const index = this.disconnectCallbacks.indexOf(callback);
      if (index >= 0) this.disconnectCallbacks.splice(index, 1);
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index >= 0) this.errorCallbacks.splice(index, 1);
    };
  }

  isConnected(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }
}
