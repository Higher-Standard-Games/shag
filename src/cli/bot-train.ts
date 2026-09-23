/**
 * Bot Training CLI — bot:train
 *
 * Autonomous training script that connects bots to a running game server
 * and trains TensorFlow.js neural networks through gameplay.
 *
 * Two training modes:
 *   1. Live self-play (default): Bots play on a running server, train in-memory
 *   2. Demo training (--demo): Extract training data from .shagdemo recordings
 *
 * Usage:
 *   npx vite-node src/cli/bot-train.ts -- --map wdm7 --rounds 100
 *   npx vite-node src/cli/bot-train.ts -- --resume --models ./models/wdm7
 *   npx vite-node src/cli/bot-train.ts -- --demo match.shagdemo --epochs 50
 *
 * Prerequisites (live mode):
 *   A game server must be running on the specified port (default: 17777).
 *   Start one with: npm run net:server -- --port 17777 --map wdm7
 */

import { BotTrainer, DEFAULT_TRAINER_CONFIG, type TrainerConfig } from "../bot/BotTrainer";
import { runCli } from "./_runCli";

// ── Argument Parsing ────────────────────────────────────────────────

interface CLIArgs {
  trainerConfig: Partial<TrainerConfig>;
  demoFile?: string;
  /** Train on every player in the demo, bots included. Default: people only. */
  includeBots: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const config: Partial<TrainerConfig> = {};
  let demoFile: string | undefined;
  let includeBots = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--map":
        config.map = args[++i];
        break;
      case "--rounds":
        config.rounds = parseInt(args[++i], 10);
        break;
      case "--bots":
        config.botCount = parseInt(args[++i], 10);
        break;
      case "--duration":
        config.matchDurationMs = parseInt(args[++i], 10) * 1000;
        break;
      case "--port":
        config.serverPort = parseInt(args[++i], 10);
        break;
      case "--models":
        config.modelDir = args[++i];
        break;
      case "--checkpoint":
        config.checkpointInterval = parseInt(args[++i], 10);
        break;
      case "--epochs":
        config.epochs = parseInt(args[++i], 10);
        break;
      case "--batch":
        config.batchSize = parseInt(args[++i], 10);
        break;
      case "--lr":
        config.learningRate = parseFloat(args[++i]);
        break;
      case "--difficulty":
        config.difficulty = args[++i];
        break;
      case "--resume":
        config.resumeTraining = true;
        break;
      case "--gametype":
        config.gametype = args[++i];
        break;
      case "--include-bots":
        includeBots = true;
        break;
      case "--demo":
        demoFile = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return { trainerConfig: config, demoFile, includeBots };
}

function printHelp(): void {
  const d = DEFAULT_TRAINER_CONFIG;
  console.log(`
Bot Training Gym 🧠⚡

Trains TensorFlow.js neural networks through autonomous bot gameplay
or from recorded .shagdemo files.

Usage: npx vite-node src/cli/bot-train.ts [options]

═══════════════════════════════════════════════════════════════════
  LIVE SELF-PLAY MODE (default)
═══════════════════════════════════════════════════════════════════

  Requires a running game server on the target port.

  --map <name>       Map to train on (default: ${d.map})
  --rounds <n>       Number of training rounds (default: ${d.rounds})
  --bots <n>         Bots per round (default: ${d.botCount})
  --duration <sec>   Match duration in seconds (default: ${d.matchDurationMs / 1000})
  --port <n>         Game server port (default: ${d.serverPort})

═══════════════════════════════════════════════════════════════════
  DEMO TRAINING MODE
═══════════════════════════════════════════════════════════════════

  Extracts training data from .shagdemo recordings — no server needed.

  --demo <file>      Train from a .shagdemo demo file
  --include-bots     Train on every player in the demo, bots included.
                     By default only players with a verified account are used,
                     because the point is to learn from people.

═══════════════════════════════════════════════════════════════════
  SHARED OPTIONS
═══════════════════════════════════════════════════════════════════

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
  # Live: Start a game server, then train bots:
  npm run net:server -- --port 17777 --map wdm7
  npx vite-node src/cli/bot-train.ts -- --map wdm7 --rounds 100

  # Demo: Train from a recorded match (no server needed):
  npx vite-node src/cli/bot-train.ts -- --demo public/data/demos/wdm7_duel.shagdemo --epochs 50

  # Resume training with existing models:
  npx vite-node src/cli/bot-train.ts -- --resume --models ./models/wdm7
`);
}

// ── Demo Training ───────────────────────────────────────────────────

async function trainFromDemo(demoFile: string, config: Partial<TrainerConfig>, includeBots = false): Promise<void> {
  // Dynamic import to avoid loading TF.js unless needed
  const { DemoTrainingExtractor } = await import("../bot/DemoTrainingExtractor");
  const { HybridBrain } = await import("../bot/HybridBrain");
  const { getTF } = await import("../bot/TFBackend");
  const { resolveDifficulty, InputButtons } = await import("../bot/BotConfig");
  const { TACTICAL_INPUT_SIZE, COMBAT_INPUT_SIZE } = await import("../bot/BotInputNormalizer");
  const fs = await import("node:fs");
  const path = await import("node:path");

  console.log("");
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║        Bot Training Gym 🧠⚡                  ║");
  console.log("║          Demo Training Mode                   ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log("");
  console.log(`[Trainer] Demo file: ${demoFile}`);
  console.log(`[Trainer] Model dir: ${config.modelDir || "./src/games/fps/models"}`);
  console.log("");

  // 1. Extract training data from demo
  const extractor = new DemoTrainingExtractor();
  const dataset = await extractor.extractFromFile(demoFile, { includeBots });

  if (dataset.totalFrames === 0) {
    console.error("[Trainer] No training frames extracted from demo!");
    process.exit(1);
  }

  console.log(`[Trainer] Extracted ${dataset.totalFrames} total frames from ${dataset.players.length} players`);

  // 2. Create or load models
  const difficulty = resolveDifficulty(config.difficulty || "medium");
  const brain = new HybridBrain(difficulty);
  const modelDir = config.modelDir || "./src/games/fps/models";

  if (config.resumeTraining) {
    await brain.loadModels(modelDir);
  }
  if (!brain.hasModels) {
    await brain.createFreshModels();
  }

  // 3. Train on extracted data
  const epochs = config.epochs || 10;
  const batchSize = config.batchSize || 32;
  const tf = getTF();

  // Collect all frames from all players
  const allFrames = dataset.players.flatMap((p) => p.frames);
  console.log(`[Trainer] Training on ${allFrames.length} frames (${epochs} epochs, batch ${batchSize})`);

  // Build tactical training data (keep frame + input together to avoid index misalignment)
  const tactPairs = allFrames
    .filter((f) => f.tacticalInput.length === TACTICAL_INPUT_SIZE)
    .map((f) => ({ input: f.tacticalInput, frame: f }));

  const tactInputs = tactPairs.map((p) => p.input);
  const tactTargets = tactPairs.map((p) => {
    const rewardScale = (p.frame.reward + 1) / 2;
    const target = new Array(8).fill(0.5);
    target[0] = rewardScale;
    target[1] = 1 - rewardScale;
    target[3] = p.frame.action.buttons & InputButtons.SPRINT ? rewardScale : 1 - rewardScale;
    target[5] = p.frame.action.buttons & InputButtons.JUMP ? rewardScale : 1 - rewardScale;
    return target;
  });

  if (tactInputs.length > 0 && brain.tacticalModel) {
    const inputTensor = tf.tensor2d(tactInputs);
    const targetTensor = tf.tensor2d(tactTargets);

    const result = await brain.tacticalModel.fit(inputTensor, targetTensor, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 1,
    });

    const finalLoss = result.history.loss ? (result.history.loss[result.history.loss.length - 1] as number) : 0;
    console.log(`[Trainer] Tactical model final loss: ${finalLoss.toFixed(6)}`);

    inputTensor.dispose();
    targetTensor.dispose();
  }

  // Build combat training tensors
  const combatFrames = allFrames.filter((f) => f.combatInput && f.combatInput.length === COMBAT_INPUT_SIZE);

  if (combatFrames.length > 0 && brain.combatModel) {
    const combatInputs = combatFrames.map((f) => f.combatInput!);
    const combatTargets = combatFrames.map((f) => {
      const rewardScale = (f.reward + 1) / 2;
      const target = new Array(6).fill(0.5);
      target[0] = f.action.buttons & InputButtons.FIRE ? rewardScale : 1 - rewardScale;
      target[1] = f.action.buttons & InputButtons.ALT_FIRE ? rewardScale : 1 - rewardScale;
      target[4] = f.action.directionX < 0 ? rewardScale : 0.5;
      target[5] = f.action.directionX > 0 ? rewardScale : 0.5;
      return target;
    });

    const inputTensor = tf.tensor2d(combatInputs);
    const targetTensor = tf.tensor2d(combatTargets);

    const result = await brain.combatModel.fit(inputTensor, targetTensor, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 1,
    });

    const finalLoss = result.history.loss ? (result.history.loss[result.history.loss.length - 1] as number) : 0;
    console.log(`[Trainer] Combat model final loss: ${finalLoss.toFixed(6)}`);

    inputTensor.dispose();
    targetTensor.dispose();
  }

  // 4. Save models and clean up
  fs.mkdirSync(path.resolve(modelDir), { recursive: true });
  await brain.saveModels(modelDir);
  brain.dispose();

  console.log("");
  console.log(`[Trainer] ✅ Demo training complete!`);
  console.log(`[Trainer] Models saved to: ${modelDir}`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { trainerConfig, demoFile, includeBots } = parseArgs();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Trainer] Interrupted — saving final checkpoint...");
    process.exit(0);
  });

  if (demoFile) {
    await trainFromDemo(demoFile, trainerConfig, includeBots);
  } else {
    const trainer = new BotTrainer(trainerConfig);
    await trainer.train();
  }
}

runCli(main);
