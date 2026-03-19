/**
 * Bot Training CLI — bot:train
 *
 * Autonomous training script that connects bots to a running game server
 * and trains TensorFlow.js neural networks through gameplay.
 *
 * Usage:
 *   npx vite-node src/cli/bot-train.ts -- --map wdm7 --rounds 100
 *   npx vite-node src/cli/bot-train.ts -- --resume --models ./models/wdm7
 *
 * Prerequisites:
 *   A game server must be running on the specified port (default: 17777).
 *   Start one with: npm run net:server -- --port 17777 --map wdm7
 */

import { BotTrainer, DEFAULT_TRAINER_CONFIG, type TrainerConfig } from '../bot/BotTrainer';

// ── Argument Parsing ────────────────────────────────────────────────

function parseArgs(): Partial<TrainerConfig> {
    const args = process.argv.slice(2);
    const config: Partial<TrainerConfig> = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--map':
                config.map = args[++i];
                break;
            case '--rounds':
                config.rounds = parseInt(args[++i], 10);
                break;
            case '--bots':
                config.botCount = parseInt(args[++i], 10);
                break;
            case '--duration':
                config.matchDurationMs = parseInt(args[++i], 10) * 1000;
                break;
            case '--port':
                config.serverPort = parseInt(args[++i], 10);
                break;
            case '--models':
                config.modelDir = args[++i];
                break;
            case '--checkpoint':
                config.checkpointInterval = parseInt(args[++i], 10);
                break;
            case '--epochs':
                config.epochs = parseInt(args[++i], 10);
                break;
            case '--batch':
                config.batchSize = parseInt(args[++i], 10);
                break;
            case '--lr':
                config.learningRate = parseFloat(args[++i]);
                break;
            case '--difficulty':
                config.difficulty = args[++i];
                break;
            case '--resume':
                config.resumeTraining = true;
                break;
            case '--gametype':
                config.gametype = args[++i];
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
    const d = DEFAULT_TRAINER_CONFIG;
    console.log(`
Bot Training Gym 🧠⚡

Trains TensorFlow.js neural networks through autonomous bot gameplay.
Requires a running game server on the target port.

Usage: npx vite-node src/cli/bot-train.ts [options]

Options:
  --map <name>       Map to train on (default: ${d.map})
  --rounds <n>       Number of training rounds (default: ${d.rounds})
  --bots <n>         Bots per round (default: ${d.botCount})
  --duration <sec>   Match duration in seconds (default: ${d.matchDurationMs / 1000})
  --port <n>         Game server port (default: ${d.serverPort})
  --models <dir>     Model save/load directory (default: ${d.modelDir})
  --checkpoint <n>   Save every N rounds (default: ${d.checkpointInterval})
  --epochs <n>       Training epochs per round (default: ${d.epochs})
  --batch <n>        Batch size (default: ${d.batchSize})
  --lr <n>           Learning rate (default: ${d.learningRate})
  --difficulty <lvl> Bot difficulty (default: ${d.difficulty})
  --gametype <type>  Gametype: duel, dm, tdm (default: ${d.gametype})
  --resume           Continue training from existing models
  --help, -h         Show this help

Examples:
  # Start a game server first:
  npm run net:server -- --port 17777 --map wdm7

  # Then train bots against each other:
  npx vite-node src/cli/bot-train.ts -- --map wdm7 --rounds 100

  # Resume training with existing models:
  npx vite-node src/cli/bot-train.ts -- --resume --models ./models/wdm7

  # Long overnight training session:
  npx vite-node src/cli/bot-train.ts -- --rounds 500 --duration 180
`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const config = parseArgs();
    const trainer = new BotTrainer(config);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[Trainer] Interrupted — saving final checkpoint...');
        process.exit(0);
    });

    await trainer.train();
}

main().catch(console.error);
