/**
 * Headless Network Server CLI v2
 *
 * Thin CLI wrapper around GameServer.
 * Handles argument parsing, BSP loading, and bootstrapping.
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
import type { CollisionWorld } from '../engine/network/systems/collision/CollisionWorld';
import { GameServer, type GameServerConfig } from '../games/fps/server/GameServer';
import { Deathmatch } from '../games/fps/server/gametypes/Deathmatch';

// ============================================================================
// Configuration
// ============================================================================

function parseArgs(): GameServerConfig & { gamePath: string } {
    const args = process.argv.slice(2);
    const config = {
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
  --port <n>             Server port (default: 7777)
  --map <name>           Map to load (default: wdm7)
  --name <name>          Server name
  --max <n>              Max clients (default: 16)
  --tickrate <n>         Tick rate in Hz (default: 125)
  --game <path>          Game data path (default: ./game)
  --cert <path>          TLS certificate path
  --key <path>           TLS key path
  --help, -h             Show this help

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

    const gameDir = gamePath.endsWith('.json') ? path.dirname(gamePath) : gamePath;

    const possiblePaths = [
        path.resolve('./public/data', `map_${mapName}.pk3`),
        path.resolve('./public/data/maps', `${mapName}.bsp`),
        path.resolve('./public/data', `${mapName}.bsp`),
        path.join(gameDir, `map_${mapName}.pk3`),
        path.join(gameDir, `${mapName}.bsp`),
        path.join(gameDir, 'maps', `${mapName}.bsp`),
        path.resolve('./public/data/basewsw', `map_${mapName}.pk3`),
        path.resolve('./public/games/default', `map_${mapName}.pk3`),
        path.resolve('./dist/games/default', `map_${mapName}.pk3`),
    ];

    console.log(`[Server] Searching for BSP in: ${possiblePaths.length} locations`);

    let bspBuffer: ArrayBuffer | null = null;

    for (const bspPath of possiblePaths) {
        if (fs.existsSync(bspPath)) {
            console.log(`[Server] Found BSP at: ${bspPath}`);

            if (bspPath.endsWith('.pk3')) {
                const pk3Buffer = fs.readFileSync(bspPath);
                const zip = await JSZip.loadAsync(pk3Buffer);

                for (const filename of Object.keys(zip.files)) {
                    if (filename.endsWith('.bsp')) {
                        const bspFile = zip.files[filename];
                        bspBuffer = await bspFile.async('arraybuffer');
                        console.log(`[Server] Extracted BSP from PK3: ${filename}`);
                        break;
                    }
                }
            } else {
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

    const { BspLoader } = await import('../engine/loader/bsp/BspLoader');
    const { createHeadlessCollisionWorld } = await import('./HeadlessBSPCollisionWorld');

    const bsp = BspLoader.load(bspBuffer);
    console.log(`[Server] BSP parsed: ${bsp.header.isFBSP ? 'FBSP' : 'IBSP'} v${bsp.header.version}`);
    console.log(`[Server] Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}`);

    const collision = await createHeadlessCollisionWorld(bsp);
    console.log(`[Server] Collision world initialized`);

    // Extract spawn points
    const spawnPoints: Array<{ x: number; y: number; z: number }> = [];
    const spawnClassnames = ['info_player_deathmatch', 'info_player_start', 'info_player_team1', 'info_player_team2'];

    for (const entity of bsp.entities) {
        if (spawnClassnames.includes(entity.classname)) {
            const origin = entity.properties.origin;
            if (origin) {
                const [x, y, z] = origin.split(' ').map(Number);
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

    // Create game server with Deathmatch gametype
    const server = new GameServer(config, new Deathmatch());

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
    console.log('[Server] Commands: spawn_bots <N>, status, help');
    console.log('[Server] Press Ctrl+C to stop');
    console.log('');

    // ── stdin command handler ──────────────────────────────────────
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
            case 'spawn_bots':
            case 'bots': {
                const count = parseInt(parts[1] || '3', 10);
                if (isNaN(count) || count < 1 || count > 32) {
                    console.log('[Server] Usage: spawn_bots <1-32>');
                    break;
                }
                server.spawnBots(count);
                break;
            }
            case 'status': {
                console.log(`[Server] Map: ${config.mapName}, Tick rate: ${config.tickRate}Hz`);
                break;
            }
            case 'help': {
                console.log('[Server] Commands:');
                console.log('  spawn_bots <N>  - Spawn N bot entities at spawn points');
                console.log('  status          - Show server status');
                console.log('  help            - Show this help');
                break;
            }
            default:
                console.log(`[Server] Unknown command: ${cmd}. Type 'help' for available commands.`);
        }
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Server] Shutting down...');
        rl.close();
        await server.stop();
        console.log('[Server] Goodbye!');
        process.exit(0);
    });
}

// Run
main().catch(console.error);
