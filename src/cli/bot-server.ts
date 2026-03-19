/**
 * Bot Intelligence Server CLI
 *
 * Starts the BIS process that manages bot clients.
 * Bots connect to game servers as real clients via WebSocket.
 *
 * Usage:
 *   npx vite-node src/cli/bot-server.ts
 *   npx vite-node src/cli/bot-server.ts --port 9100
 *   npx vite-node src/cli/bot-server.ts --auto ws://localhost:7777 --count 3
 *
 * The bot server exposes a control WebSocket API on its port.
 * Game servers or admin tools connect here to add/remove bots.
 *
 * For quick testing, use --auto to spawn bots immediately:
 *   --auto <gameServerUrl>   Auto-connect bots to this game server
 *   --count <N>              Number of bots to auto-spawn (default: 3)
 *   --difficulty <level>     Difficulty: easy, medium, hard, insane (default: medium)
 */

import { BotServer } from '../bot/BotServer';

// ── Parse Arguments ─────────────────────────────────────────────────────

interface BotServerArgs {
    port: number;
    autoConnect?: string;
    autoCount: number;
    difficulty: string;
}

function parseArgs(): BotServerArgs {
    const args = process.argv.slice(2);
    const config: BotServerArgs = {
        port: 9100,
        autoCount: 3,
        difficulty: 'medium',
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--port':
                config.port = parseInt(args[++i], 10);
                break;
            case '--auto':
                config.autoConnect = args[++i];
                break;
            case '--count':
                config.autoCount = parseInt(args[++i], 10);
                break;
            case '--difficulty':
            case '-d':
                config.difficulty = args[++i];
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
Bot Intelligence Server (BIS)

Usage: npx vite-node src/cli/bot-server.ts [options]

Options:
  --port <n>          Control API port (default: 9100)
  --auto <url>        Auto-connect bots to a game server URL
  --count <n>         Number of bots to auto-spawn (default: 3)
  --difficulty <lvl>  Bot difficulty: easy, medium, hard, insane (default: medium)
  --help, -h          Show this help

Examples:
  npx vite-node src/cli/bot-server.ts
  npx vite-node src/cli/bot-server.ts --auto ws://localhost:7777 --count 4
  npx vite-node src/cli/bot-server.ts --auto ws://localhost:7777 --difficulty hard
`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const config = parseArgs();

    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║       Bot Intelligence Server (BIS)           ║');
    console.log('║         Phase 1: State Machine AI             ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
    console.log(`[BIS] Control API port: ${config.port}`);
    console.log(`[BIS] Default difficulty: ${config.difficulty}`);
    console.log('');

    const server = new BotServer(config.port);
    await server.start();

    // Auto-connect bots if --auto flag
    if (config.autoConnect) {
        console.log(`[BIS] Auto-connecting ${config.autoCount} bots to ${config.autoConnect}...`);
        console.log('');

        for (let i = 0; i < config.autoCount; i++) {
            try {
                // Stagger connections by 500ms to avoid overwhelming the game server
                if (i > 0) {
                    await new Promise(r => setTimeout(r, 500));
                }
                await server.addBot(config.autoConnect, {
                    difficulty: config.difficulty,
                });
            } catch (err: any) {
                console.error(`[BIS] Failed to spawn bot ${i + 1}: ${err.message}`);
            }
        }

        console.log('');
        console.log(`[BIS] Auto-connect complete. ${server.getStatus().length} bots active.`);
    }

    // ── stdin command handler ───────────────────────────────────────
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
            case 'add':
            case 'addbot': {
                const url = parts[1] || config.autoConnect || 'ws://localhost:7777';
                const diff = parts[2] || config.difficulty;
                try {
                    const bot = await server.addBot(url, { difficulty: diff });
                    console.log(`[BIS] Added bot: ${bot.name} → ${url}`);
                } catch (err: any) {
                    console.error(`[BIS] Failed: ${err.message}`);
                }
                break;
            }

            case 'remove': {
                if (parts[1] === 'all') {
                    const count = await server.removeAllBots();
                    console.log(`[BIS] Removed ${count} bots`);
                } else if (parts[1]) {
                    const removed = await server.removeBot(parts[1]);
                    console.log(removed ? `[BIS] Removed bot ${parts[1]}` : `[BIS] Bot not found`);
                }
                break;
            }

            case 'status':
            case 'list': {
                const bots = server.getStatus();
                if (bots.length === 0) {
                    console.log('[BIS] No active bots');
                } else {
                    console.log(`[BIS] Active bots (${bots.length}):`);
                    for (const bot of bots) {
                        console.log(`  ${bot.name} [${bot.state}/${bot.brainState}] → ${bot.server}`);
                    }
                }
                break;
            }

            case 'help': {
                console.log('[BIS] Commands:');
                console.log('  add [url] [difficulty]  - Add a bot');
                console.log('  remove <botId|all>      - Remove bot(s)');
                console.log('  status                  - Show bot status');
                console.log('  help                    - Show this help');
                break;
            }

            default:
                console.log(`[BIS] Unknown command: ${cmd}. Type 'help' for available commands.`);
        }
    });

    console.log('[BIS] Commands: add, remove, status, help');
    console.log('[BIS] Press Ctrl+C to stop');
    console.log('');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[BIS] Shutting down...');
        rl.close();
        await server.stop();
        console.log('[BIS] Goodbye!');
        process.exit(0);
    });
}

// Run
main().catch(console.error);
