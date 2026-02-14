/**
 * Headless Network Server CLI v2
 *
 * Dedicated game server using the next-gen server architecture.
 * Uses Simulation + WorldState + Subsystems from src/engine/server.
 * Networking via WebTransport (QUIC-based, low-latency).
 *
 * Usage:
 *   npx vite-node src/cli/headless-netserver-v2.ts --port 7777 --map wdm7
 *   npx vite-node src/cli/headless-netserver-v2.ts --help
 *
 * Requirements:
 *   - TLS certificates for WebTransport (use mkcert for development)
 *   - @fails-components/webtransport or @aspect-build/webtransport
 */

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { Simulation } from '../engine/server/core/Simulation';
import { createPlayerEntity } from '../engine/server/ecs/Entity';
import { playerId as createPlayerId } from '../engine/server/ecs/types';
import type { PlayerId } from '../engine/server/ecs/types';
import { FPSMovementSubsystem, ProjectileSystem, WeaponSystem, CombatSystem } from '../games/fps/server/systems';
import {
    WebSocketServerTransport,
    type Transport,
    type TransportConfig,
    type ClientConnection,
} from '../engine/server/network/transport/WebSocketTransport';
import type { CollisionWorld } from '../engine/network/systems/collision/CollisionWorld';

// Use client-compatible protocol
import { MessageCodec, MessageType } from '../engine/network/protocol/MessageCodec';
import { GameState, type PlayerState } from '../engine/network/core/GameState';
import { Entity } from '../engine/network/core/Entity';

// ============================================================================
// Configuration
// ============================================================================

interface ServerConfig {
    port: number;
    serverName: string;
    mapName: string;
    maxClients: number;
    tickRate: number;
    gamePath: string;
    certPath: string;
    keyPath: string;
}

function parseArgs(): ServerConfig {
    const args = process.argv.slice(2);
    const config: ServerConfig = {
        port: 7777,
        serverName: 'SHAG Server v2',
        mapName: 'wdm7',
        maxClients: 16,
        tickRate: 125,
        gamePath: './game',
        certPath: './certs/localhost.pem',
        keyPath: './certs/localhost-key.pem',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith('--map=')) {
            config.mapName = arg.substring(6);
            continue;
        }

        switch (arg) {
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
            case '--game':
                config.gamePath = args[++i];
                break;
            case '--cert':
                config.certPath = args[++i];
                break;
            case '--key':
                config.keyPath = args[++i];
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
            default:
                if (!arg.startsWith('-') && !args[i - 1]?.startsWith('--')) {
                    config.mapName = arg;
                }
                break;
        }
    }

    return config;
}

function printHelp(): void {
    console.log(`
SHAG Dedicated Server v2 (Next-Gen Architecture)

Usage: npx vite-node src/cli/headless-netserver-v2.ts [options]

Options:
  --port <number>      Server port (default: 7777)
  --name <string>      Server name (default: "SHAG Server v2")
  --map <name>         Map to load (default: wdm7)
  --max <number>       Max clients (default: 16)
  --tickrate <number>  Physics tick rate (default: 125)
  --game <path>        Game data path (default: ./game)
  --cert <path>        TLS certificate path (default: ./certs/localhost.pem)
  --key <path>         TLS private key path (default: ./certs/localhost-key.pem)
  --help, -h           Show this help

WebTransport Setup:
  WebTransport requires TLS certificates. For development:
    1. Install mkcert: https://github.com/FiloSottile/mkcert
    2. Run: mkcert -install && mkcert localhost
    3. Move localhost.pem and localhost-key.pem to ./certs/

Examples:
  npx vite-node src/cli/headless-netserver-v2.ts --map wdm7
  npx vite-node src/cli/headless-netserver-v2.ts --port 7777 --map wdm2
`);
}

// ============================================================================
// BSP Loading (Headless)
// ============================================================================

interface BspData {
    collision: CollisionWorld;
    spawnPoints: Array<{ x: number; y: number; z: number }>;
}

async function loadBspCollision(mapName: string, gamePath: string): Promise<BspData | null> {
    console.log(`[Server] Loading BSP: ${mapName}`);

    // Resolve paths - gamePath might be a JSON file or directory
    const gameDir = gamePath.endsWith('.json') ? path.dirname(gamePath) : gamePath;

    // Try to find the BSP file in various locations
    // Client loads from data/ (served via public/data/) — this is the primary location
    const possiblePaths = [
        // Primary: public/data/ — matches client PK3Loader basePath
        path.resolve('./public/data', `map_${mapName}.pk3`),
        path.resolve('./public/data/maps', `${mapName}.bsp`),
        path.resolve('./public/data', `${mapName}.bsp`),
        // Game-specific data directories (for multi-game support)
        path.join(gameDir, `map_${mapName}.pk3`),
        path.join(gameDir, `${mapName}.bsp`),
        path.join(gameDir, 'maps', `${mapName}.bsp`),
        // Warsow basewsw format
        path.resolve('./public/data/basewsw', `map_${mapName}.pk3`),
        // Legacy/fallback locations
        path.resolve('./public/games/default', `map_${mapName}.pk3`),
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
    const { createHeadlessCollisionWorld } = await import('./HeadlessBSPCollisionWorld');

    const bsp = BspLoader.load(bspBuffer);
    console.log(`[Server] BSP parsed: ${bsp.header.isFBSP ? 'FBSP' : 'IBSP'} v${bsp.header.version}`);
    console.log(`[Server] Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}`);

    // Create server-side BSP collision world (AWAIT async init!)
    const collision = await createHeadlessCollisionWorld(bsp);
    console.log(`[Server] Collision world initialized (SharedCollisionWorld - server-authoritative mode)`);

    // Extract spawn points
    const spawnPoints: Array<{ x: number; y: number; z: number }> = [];
    const spawnClassnames = ['info_player_deathmatch', 'info_player_start', 'info_player_team1', 'info_player_team2'];

    for (const entity of bsp.entities) {
        if (spawnClassnames.includes(entity.classname)) {
            const origin = entity.properties.origin;
            if (origin) {
                const [x, y, z] = origin.split(' ').map(Number);
                // Convert from Quake coords (z-up) to Babylon coords (y-up)
                // Also add PLAYER_ORIGIN_HEIGHT (24 units) because:
                // - BSP spawn entities are at FEET level
                // - But player physics uses ORIGIN level (24 units above feet)
                const PLAYER_ORIGIN_HEIGHT = 24;
                spawnPoints.push({ x, y: z + PLAYER_ORIGIN_HEIGHT, z: y });
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
// Client Management
// ============================================================================

interface ClientInfo {
    id: string;
    connection: ClientConnection;
    playerId: PlayerId;
    /** Last processed input sequence (for reconciliation) */
    lastInputSeq: number;
}

// ============================================================================
// Server Class
// ============================================================================

class NextGenServer {
    private config: ServerConfig;
    private simulation: Simulation;
    private transport: Transport;
    private clients: Map<string, ClientInfo> = new Map();
    private nextPlayerId: number = 1;
    private spawnPoints: Array<{ x: number; y: number; z: number }> = [];
    private running: boolean = false;
    private tickInterval: ReturnType<typeof setInterval> | null = null;

    // Subsystems
    private physicsSystem: FPSMovementSubsystem;
    private projectileSystem: ProjectileSystem;
    private weaponSystem: WeaponSystem;
    private combatSystem: CombatSystem;

    constructor(config: ServerConfig) {
        this.config = config;

        // Create simulation (125Hz physics)
        this.simulation = new Simulation({
            tickMs: 1000 / config.tickRate,
        });

        // Create subsystems
        this.physicsSystem = new FPSMovementSubsystem();
        this.projectileSystem = new ProjectileSystem();
        this.weaponSystem = new WeaponSystem();
        this.combatSystem = new CombatSystem();

        // Add subsystems to simulation
        this.simulation.addSubsystem(this.physicsSystem);
        this.simulation.addSubsystem(this.projectileSystem);
        this.simulation.addSubsystem(this.weaponSystem);
        this.simulation.addSubsystem(this.combatSystem);

        // Create WebTransport transport
        const transportConfig: TransportConfig = {
            port: config.port,
            maxClients: config.maxClients,
            certPath: config.certPath,
            keyPath: config.keyPath,
        };

        this.transport = new WebSocketServerTransport(transportConfig, {
            onConnect: (conn) => this.handleConnect(conn),
            onDisconnect: (conn, reason) => this.handleDisconnect(conn, reason),
            onDatagram: (conn, data) => this.handleDatagram(conn, data),
            onReliable: (conn, data) => this.handleReliable(conn, data),
            onError: (conn, error) => this.handleError(conn, error),
        });

        console.log(`[Server] Created simulation with ${this.simulation.getSubsystems().length} subsystems`);
    }

    /**
     * Set collision world (after BSP load)
     */
    setCollisionWorld(collision: CollisionWorld): void {
        this.physicsSystem.setCollisionWorld(collision);
        this.projectileSystem.setCollisionWorld(collision);
        console.log(`[Server] Collision world configured for physics and projectiles`);
    }

    /**
     * Set spawn points (after BSP load)
     */
    setSpawnPoints(points: Array<{ x: number; y: number; z: number }>): void {
        this.spawnPoints = points;
        console.log(`[Server] ${points.length} spawn points configured`);
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        if (this.running) return;

        // Initialize simulation
        this.simulation.initialize();

        // Start transport
        await this.transport.start();

        this.running = true;

        // Start tick loop
        const tickMs = 1000 / this.config.tickRate;
        this.tickInterval = setInterval(() => {
            this.tick();
        }, tickMs);

        console.log(`[Server] Tick loop started at ${this.config.tickRate}Hz`);
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        if (!this.running) return;

        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        await this.transport.stop();

        this.running = false;
        this.simulation.cleanup();

        console.log(`[Server] Stopped`);
    }

    /**
     * Handle new client connection (WebSocket opened)
     * Note: Player is NOT spawned here - must wait for Join message
     */
    private handleConnect(conn: ClientConnection): void {
        // Just log the connection - player spawn happens when Join message is received
        console.log(`[Server] WebSocket connected: ${conn.id}`);
    }

    /**
     * Handle client disconnect
     */
    private handleDisconnect(conn: ClientConnection, reason: string): void {
        const client = this.clients.get(conn.id);
        if (!client) return;

        // Remove player entity
        const state = this.simulation.getStateMut();
        for (const entity of state.allEntities()) {
            if (entity.ownerId === Number(client.playerId)) {
                state.removeEntity(entity.id);
                break;
            }
        }

        this.clients.delete(conn.id);
        console.log(`[Server] Player ${client.playerId} (${conn.id}) disconnected: ${reason}`);
        console.log(`[Server] Players: ${this.clients.size}/${this.config.maxClients}`);
    }

    /**
     * Handle incoming datagram (unreliable - for inputs)
     */
    private handleDatagram(conn: ClientConnection, data: Uint8Array): void {
        if (data.length === 0) return;

        try {
            const msgType = MessageCodec.peekMessageType(data);

            // Handle Join message (for WebSocket which routes all messages here)
            if (msgType === MessageType.Join) {
                const { playerName } = MessageCodec.decodeJoin(data);
                console.log(`[Server] Join request from: ${playerName}`);

                // Check if client already exists (already connected)
                let client = this.clients.get(conn.id);
                if (!client) {
                    // New connection - create player entity
                    const pid = createPlayerId(this.nextPlayerId++);
                    const spawnPoint = this.getSpawnPoint();
                    const entity = createPlayerEntity(
                        this.simulation.getStateMut().generateEntityId(),
                        pid,
                        spawnPoint
                    );
                    this.simulation.getStateMut().addEntity(entity);

                    // Track client
                    client = {
                        id: conn.id,
                        connection: conn,
                        playerId: pid,
                        lastInputSeq: 0,
                    };
                    this.clients.set(conn.id, client);

                    console.log(`[Server] Player ${pid} (${conn.id}) spawned at (${spawnPoint.x.toFixed(1)}, ${spawnPoint.y.toFixed(1)}, ${spawnPoint.z.toFixed(1)})`);

                    // DEBUG: Test floor detection at spawn position to compare with client
                    const floorTestBounds = {
                        min: { x: -16, y: -24, z: -16 },
                        max: { x: 16, y: 32, z: 16 }
                    };
                    const floorTraceStart = { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z };
                    const floorTraceEnd = { x: spawnPoint.x, y: spawnPoint.y - 200, z: spawnPoint.z };
                    const collision = this.physicsSystem.getCollisionWorld();
                    if (collision) {
                        const floorTrace = collision.trace(floorTraceStart, floorTraceEnd, floorTestBounds);
                        const floorY = floorTrace.hit
                            ? spawnPoint.y - 200 * floorTrace.fraction
                            : 'NO HIT';
                        const expectedOriginY = typeof floorY === 'number' ? floorY + 24 : 'N/A';
                        console.log(`[Server] FLOOR TRACE at spawn: spawnY=${spawnPoint.y.toFixed(1)}, floorY=${typeof floorY === 'number' ? floorY.toFixed(1) : floorY}, expectedOriginY=${typeof expectedOriginY === 'number' ? expectedOriginY.toFixed(1) : expectedOriginY}`);
                    }

                    console.log(`[Server] Players: ${this.clients.size}/${this.config.maxClients}`);
                }

                // Send Welcome (contains map name for client to load)
                this.sendWelcome(client);
                // Send JoinAccept (contains player/entity IDs)
                this.sendJoinAccept(client);
                return;
            }

            // All other messages require an existing client
            const client = this.clients.get(conn.id);
            if (!client) return;

            if (msgType === MessageType.Input) {
                // Decode command using client protocol
                const { command } = MessageCodec.decodeCommand(data);

                // Find player entity and queue input for next tick
                const state = this.simulation.getStateMut();
                for (const entity of state.allEntities()) {
                    if (entity.ownerId === Number(client.playerId) && entity.input) {
                        const mutEntity = state.getEntityMut(entity.id);
                        if (mutEntity?.input) {
                            // Queue input for processing during next tick
                            // (prevents lost inputs when multiple arrive between ticks)
                            const buttons = command.buttons || 0;
                            mutEntity.input.inputQueue.push({
                                forward: command.direction?.z || 0,
                                right: command.direction?.x || 0,
                                pitch: command.pitch || 0,
                                yaw: command.yaw || 0,
                                buttons,
                                sequence: command.seq || 0,
                            });

                            // Track latest seq for client reconciliation ACK
                            client.lastInputSeq = command.seq || 0;
                        }
                        break;
                    }
                }
            } else if (msgType === MessageType.Ack) {
                // Handle acknowledgment (for delta compression baseline)
                const { tick } = MessageCodec.decodeAck(data);
                // Could track per-client acknowledged tick for delta encoding
                // For now just log occasionally
                if (tick % 1000 === 0) {
                    console.log(`[Server] Client ${client.playerId} acked tick ${tick}`);
                }
            }
        } catch {
            // Silently ignore malformed packets
        }
    }

    /**
     * Handle incoming reliable message (for auth, chat, etc.)
     */
    private handleReliable(conn: ClientConnection, data: Uint8Array): void {
        if (data.length === 0) return;

        try {
            const msgType = MessageCodec.peekMessageType(data);

            if (msgType === MessageType.Join) {
                // Client wants to join - we already handled on connect, but send ack
                const { playerName } = MessageCodec.decodeJoin(data);
                console.log(`[Server] Join request from: ${playerName}`);

                const client = this.clients.get(conn.id);
                if (client) {
                    this.sendJoinAccept(client);
                }
            }
        } catch {
            // Silently ignore malformed packets  
        }
    }

    /**
     * Handle connection error
     */
    private handleError(conn: ClientConnection, error: Error): void {
        console.error(`[Server] Client ${conn.id} error:`, error.message);
    }

    /**
     * Get server stats
     */
    getStats() {
        return {
            players: this.clients.size,
            maxPlayers: this.config.maxClients,
            tick: Number(this.simulation.currentTick),
        };
    }

    /**
     * Run one simulation tick
     */
    private tick(): void {
        // Run simulation
        this.simulation.tick();

        // Broadcast state snapshot to clients (via datagrams - fast, unreliable)
        this.broadcastSnapshot();
    }

    /**
     * Convert WorldState to client-compatible GameState
     */
    private toGameState(): GameState {
        const state = this.simulation.getState();
        const gameState = new GameState();
        gameState.tick = Number(state.tick);

        // Convert entities
        for (const entity of state.allEntities()) {
            // Use 'player_N' format to match client's FPSSimulation.spawnPlayer entity IDs
            const clientEntity = new Entity(`player_${entity.id}`);

            // Add transform/position
            if (entity.transform) {
                clientEntity.addComponent('transform', {
                    position: { ...entity.transform.position },
                    rotation: { x: entity.transform.rotation.x, y: entity.transform.rotation.y, z: entity.transform.rotation.z, w: 1 },
                    serialize: () => ({}),
                    deserialize: () => { },
                    clone: function () { return { ...this }; }
                });
                clientEntity.addComponent('position', {
                    x: entity.transform.position.x,
                    y: entity.transform.position.y,
                    z: entity.transform.position.z,
                    serialize: () => ({}),
                    deserialize: () => { },
                    clone: function () { return { ...this }; }
                });
            }

            // Add velocity
            if (entity.physics) {
                clientEntity.addComponent('velocity', {
                    x: entity.physics.velocity.x,
                    y: entity.physics.velocity.y,
                    z: entity.physics.velocity.z,
                    linear: { ...entity.physics.velocity },
                    angular: { x: 0, y: 0, z: 0 },
                    grounded: entity.physics.grounded,
                    serialize: () => ({}),
                    deserialize: () => { },
                    clone: function () { return { ...this }; }
                });

                // Add movement state for client effects (crouchslide, walljump, ledge grab)
                clientEntity.addComponent('movementState', {
                    isSliding: entity.physics.isSliding ?? false,
                    isCrouching: entity.physics.isCrouching ?? false,
                    crouchViewOffset: entity.physics.crouchViewOffset ?? 0,
                    wallJumpState: entity.physics.wallJumpState ?? 'none',
                    ledgeGrabState: entity.physics.ledgeGrabState ?? 'none',
                    actualHorizSpeed: entity.physics.actualHorizSpeed ?? 0,
                    serialize: () => ({}),
                    deserialize: () => { },
                    clone: function () { return { ...this }; }
                });
            }

            gameState.entities.set(clientEntity.id, clientEntity);

            // If this entity has an owner, add to players
            if (entity.ownerId !== undefined) {
                const playerId = `player_${entity.ownerId}`;
                if (!gameState.players.has(playerId)) {
                    const playerState: PlayerState = {
                        entityId: clientEntity.id,
                        name: `Player ${entity.ownerId}`,
                        team: '',
                        score: 0,
                        ping: 0,
                        serialize: () => ({}),
                        deserialize: () => { },
                        clone() { return { ...this, serialize: this.serialize, deserialize: this.deserialize, clone: this.clone }; }
                    };
                    gameState.players.set(playerId, playerState);
                }
            }
        }

        return gameState;
    }

    /**
     * Broadcast world state snapshot to all clients
     * Each client gets their own ackedInputSeq for reconciliation
     */
    private broadcastSnapshot(): void {
        if (this.clients.size === 0) return;

        // Send per-client snapshot with their ackedInputSeq
        for (const client of this.clients.values()) {
            try {
                const gameState = this.toGameState();
                gameState.ackedInputSeq = client.lastInputSeq;
                const snapshotBytes = MessageCodec.encodeSnapshot(gameState);
                client.connection.sendDatagram(snapshotBytes);
            } catch {
                // Client may have disconnected
            }
        }
    }

    /**
     * Send welcome message to client (reliable)
     */
    private sendWelcome(client: ClientInfo): void {
        const welcomeBytes = MessageCodec.encodeWelcome(
            'server-v2',   // serverId
            this.config.serverName,
            this.config.mapName,
            this.config.tickRate,
            this.config.maxClients,
            this.clients.size
        );
        client.connection.sendReliable(welcomeBytes);
    }

    /**
     * Send join accept to client (reliable)  
     */
    private sendJoinAccept(client: ClientInfo): void {
        const playerId = `player_${client.playerId}`;
        // Use same entity ID format as client (FPSSimulation.spawnPlayer creates 'player_N')
        const entityId = `player_${client.playerId}`;

        const acceptBytes = MessageCodec.encodeJoinAccept(
            client.id,  // clientId
            playerId,
            entityId
        );
        client.connection.sendReliable(acceptBytes);
        console.log(`[Server] Sent JoinAccept to ${client.id}: playerId=${playerId}, entityId=${entityId}`);
    }

    /**
     * Get a spawn point
     */
    private getSpawnPoint(): { x: number; y: number; z: number } {
        if (this.spawnPoints.length === 0) {
            console.log(`[Server] No spawn points available, using default`);
            return { x: 0, y: 100, z: 0 };
        }
        const index = Math.floor(Math.random() * this.spawnPoints.length);
        const spawn = this.spawnPoints[index];
        console.log(`[Server] Selected spawn point ${index + 1}/${this.spawnPoints.length}: (${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}, ${spawn.z.toFixed(1)})`);
        return { ...spawn };
    }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    const config = parseArgs();

    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║     SHAG Dedicated Server v2 (Next-Gen)       ║');
    console.log('║         WebTransport / QUIC Edition           ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
    console.log(`[Server] Name: ${config.serverName}`);
    console.log(`[Server] Port: ${config.port}`);
    console.log(`[Server] Map: ${config.mapName}`);
    console.log(`[Server] Max clients: ${config.maxClients}`);
    console.log(`[Server] Tick rate: ${config.tickRate}Hz`);
    console.log(`[Server] TLS Cert: ${config.certPath}`);
    console.log('');

    // Check for TLS certificates
    if (!fs.existsSync(config.certPath) || !fs.existsSync(config.keyPath)) {
        console.log('[Server] WARNING: TLS certificates not found.');
        console.log('[Server] WebTransport requires TLS. Running in mock mode for testing.');
        console.log('');
        console.log('[Server] To generate certificates for development:');
        console.log('  1. Install mkcert: https://github.com/FiloSottile/mkcert');
        console.log('  2. Run: mkcert -install');
        console.log('  3. Run: mkcert localhost');
        console.log('  4. Create ./certs/ directory and move the .pem files there');
        console.log('');
    }

    // Load BSP
    const bspData = await loadBspCollision(config.mapName, config.gamePath);

    // Create server
    const server = new NextGenServer(config);

    if (bspData) {
        server.setCollisionWorld(bspData.collision);
        server.setSpawnPoints(bspData.spawnPoints);
    } else {
        console.log('[Server] Running without BSP collision (open space mode)');
    }

    // Start server
    await server.start();

    console.log('');
    console.log(`[Server] ✓ Ready for connections`);
    console.log('[Server] Press Ctrl+C to stop');
    console.log('');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Server] Shutting down...');
        await server.stop();
        console.log('[Server] Goodbye!');
        process.exit(0);
    });
}

// Run
main().catch(console.error);
