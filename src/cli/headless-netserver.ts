/**
 * Headless Network Server CLI
 *
 * Dedicated game server for the SHAG Engine.
 * Supports both basic test mode and full FPS mode with BSP collision.
 *
 * Usage:
 *   npx vite-node src/cli/headless-netserver.ts --port 7777 --map wdm7
 *   npx vite-node src/cli/headless-netserver.ts --port 7777 --mode fps --map wdm2
 *   npx vite-node src/cli/headless-netserver.ts --help
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { GameServer } from '../engine/network/server/GameServer';
import { TestSimulation, testConfig } from '../engine/network/test/TestSimulation';
import { FPSSimulation } from '../games/fps/simulation/FPSSimulation';
import type { Simulation, SimulationConfig } from '../engine/network/core/Simulation';
import type { Transport } from '../engine/network/client/transport/Transport';
import type { Command } from '../engine/network/core/Command';
import type { GameState } from '../engine/network/core/GameState';

// ============================================================================
// Configuration
// ============================================================================

interface ServerConfig {
  port: number;
  serverName: string;
  mapName: string;
  maxClients: number;
  tickRate: number;
  mode: 'test' | 'fps';
  gamePath: string;
}

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);
  const config: ServerConfig = {
    port: 7777,
    serverName: 'SHAG Server',
    mapName: 'wdm7',
    maxClients: 16,
    tickRate: 60,
    mode: 'fps',  // Default to FPS mode now
    gamePath: './game',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        config.port = parseInt(args[++i], 10);
        break;
      case '--name':
      case '--hostname':
        config.serverName = args[++i];
        break;
      case '--map':
        config.mapName = args[++i];
        break;
      case '--max':
      case '--maxclients':
        config.maxClients = parseInt(args[++i], 10);
        break;
      case '--tickrate':
        config.tickRate = parseInt(args[++i], 10);
        break;
      case '--mode':
        config.mode = args[++i] as 'test' | 'fps';
        break;
      case '--game':
        config.gamePath = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
SHAG Dedicated Server

Usage:
  npx vite-node src/cli/headless-netserver.ts [options]

Options:
  --port <port>         Server port (default: 7777)
  --name <name>         Server name (default: "SHAG Server")
  --map <map>           Map name without extension (default: wdm7)
  --max <n>             Max clients (default: 16)
  --tickrate <hz>       Server tick rate (default: 60)
  --mode <mode>         Simulation mode: 'fps' or 'test' (default: fps)
  --game <path>         Path to game bundle (default: ./game)
  --help, -h            Show this help

Examples:
  npx vite-node src/cli/headless-netserver.ts --port 27015 --map wdm2
  npx vite-node src/cli/headless-netserver.ts --mode test
`);
}

// ============================================================================
// BSP Loading (Headless) - For FPS Mode
// ============================================================================

interface BspData {
  collision: any;  // BSPCollisionWorld
  spawnPoints: Array<{ x: number; y: number; z: number }>;
}

async function loadBspCollision(mapName: string, gamePath: string): Promise<BspData | null> {
  console.log(`[Server] Loading BSP: ${mapName}`);

  // Resolve paths - gamePath might be a JSON file or directory
  const gameDir = gamePath.endsWith('.json') ? path.dirname(gamePath) : gamePath;

  // Try to find the BSP file in various locations
  const possiblePaths = [
    // Direct paths
    path.join(gameDir, `${mapName}.bsp`),
    path.join(gameDir, 'maps', `${mapName}.bsp`),
    path.join(gameDir, `map_${mapName}.pk3`),
    // Standard locations relative to project root
    path.resolve('./public/games/default', `map_${mapName}.pk3`),
    path.resolve('./public/games/default/maps', `${mapName}.bsp`),
    path.resolve('./public/games/default/basewsw', `map_${mapName}.pk3`),
    // Development dist folder
    path.resolve('./dist/games/default', `map_${mapName}.pk3`),
  ];

  console.log(`[Server] Searching for BSP in: ${possiblePaths.length} locations`);

  let bspBuffer: ArrayBuffer | null = null;

  for (const bspPath of possiblePaths) {
    if (fs.existsSync(bspPath)) {
      console.log(`[Server] Found BSP at: ${bspPath}`);

      if (bspPath.endsWith('.pk3')) {
        // Extract BSP from PK3 using JSZip directly
        const pk3Buffer = fs.readFileSync(bspPath);
        const zip = await JSZip.loadAsync(pk3Buffer);

        // Find the .bsp file inside
        for (const filename of Object.keys(zip.files)) {
          if (filename.endsWith('.bsp')) {
            const bspFile = zip.files[filename];
            bspBuffer = await bspFile.async('arraybuffer');
            console.log(`[Server] Extracted BSP from PK3: ${filename}`);
            break;
          }
        }
      } else {
        // Direct BSP file
        const buffer = fs.readFileSync(bspPath);
        bspBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );
      }
      break;
    }
  }

  if (!bspBuffer) {
    console.warn(`[Server] Could not find BSP for map: ${mapName}`);
    return null;
  }

  // Parse BSP
  const { BspLoader } = await import('../engine/loader/bsp/BspLoader');
  const { HeadlessBSPCollisionWorld } = await import('./HeadlessBSPCollisionWorld');

  const bsp = BspLoader.load(bspBuffer);
  console.log(`[Server] BSP parsed: ${bsp.header.isFBSP ? 'FBSP' : 'IBSP'} v${bsp.header.version}`);
  console.log(`[Server] Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}`);

  // Create server-side BSP collision world
  const collision = new HeadlessBSPCollisionWorld(bsp);
  console.log(`[Server] Collision world initialized (HeadlessBSPCollisionWorld - server-authoritative mode)`);

  // Extract spawn points
  const spawnPoints: Array<{ x: number; y: number; z: number }> = [];
  const spawnClassnames = ['info_player_deathmatch', 'info_player_start', 'info_player_team1', 'info_player_team2'];

  for (const entity of bsp.entities) {
    if (spawnClassnames.includes(entity.classname)) {
      const origin = entity.properties.origin;
      if (origin) {
        const [x, y, z] = origin.split(' ').map(Number);
        // Convert from Quake coords (z-up) to Babylon coords (y-up)
        spawnPoints.push({ x, y: z, z: y });
      }
    }
  }

  if (spawnPoints.length === 0) {
    console.warn('[Server] No spawn points found in BSP, using defaults');
    spawnPoints.push(
      { x: 0, y: 100, z: 0 },
      { x: 100, y: 100, z: 100 },
      { x: -100, y: 100, z: -100 }
    );
  }

  console.log(`[Server] Found ${spawnPoints.length} spawn points`);

  return { collision, spawnPoints };
}

// ============================================================================
// Node.js WebSocket Transport
// ============================================================================

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

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║           SHAG Dedicated Server           ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`[Server] Name: ${config.serverName}`);
  console.log(`[Server] Port: ${config.port}`);
  console.log(`[Server] Mode: ${config.mode.toUpperCase()}`);
  console.log(`[Server] Map: ${config.mapName}`);
  console.log(`[Server] Max clients: ${config.maxClients}`);
  console.log(`[Server] Tick rate: ${config.tickRate}Hz`);
  console.log('');

  // Select simulation based on mode
  let SimulationClass: new (config: SimulationConfig) => Simulation<GameState, Command>;
  let simConfig: SimulationConfig;
  let bspData: BspData | null = null;

  if (config.mode === 'fps') {
    // FPS mode - load BSP collision
    SimulationClass = FPSSimulation as unknown as new (config: SimulationConfig) => Simulation<GameState, Command>;
    simConfig = {
      tickRate: config.tickRate,
      tickDuration: 1000 / config.tickRate,
      maxPlayers: config.maxClients,
      gameRules: {},
    };

    // Try to load BSP
    bspData = await loadBspCollision(config.mapName, config.gamePath);
    if (!bspData) {
      console.log('[Server] Running without BSP collision (open space mode)');
    }
  } else {
    // Test mode - basic simulation
    SimulationClass = TestSimulation;
    simConfig = testConfig;
  }

  // Create game server with server info
  const gameServer = new GameServer(simConfig, SimulationClass, {
    serverName: config.serverName,
    mapName: config.mapName,
  });

  // Hook into room creation to set collision (FPS mode only)
  if (config.mode === 'fps' && bspData) {
    const capturedBspData = bspData;
    gameServer.onRoomCreate((room) => {
      console.log(`[Server] Room ${room.id} created`);

      const simulation = room.getSimulation() as unknown as FPSSimulation;
      if (simulation && capturedBspData) {
        simulation.setCollisionWorld(capturedBspData.collision);
        simulation.setSpawnPoints(capturedBspData.spawnPoints);
        console.log(`[Server] Collision and ${capturedBspData.spawnPoints.length} spawn points configured`);
      }
    });
  }

  // Create WebSocket server
  const wss = new WSServer({ port: config.port });

  let clientCounter = 0;

  wss.on('listening', () => {
    console.log('');
    console.log(`[Server] ✓ Listening on ws://localhost:${config.port}`);
    console.log('[Server] Waiting for connections...');
    console.log('[Server] Press Ctrl+C to stop');
    console.log('');
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = `client_${++clientCounter}`;
    const remoteAddr = req.socket.remoteAddress || 'unknown';
    console.log(`[Server] Client ${clientId} connected from ${remoteAddr}`);

    const transport = new NodeWebSocketTransport(ws);

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

  // Server event logging
  gameServer.onClientConnect(() => {
    const stats = gameServer.getStats();
    console.log(`[Server] Players: ${stats.totalClients}/${config.maxClients}`);
  });

  gameServer.onClientDisconnect(() => {
    const stats = gameServer.getStats();
    console.log(`[Server] Players: ${stats.totalClients}/${config.maxClients}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    gameServer.shutdown();
    wss.close();
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
}

// Run
main().catch(console.error);
