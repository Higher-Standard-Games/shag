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

  --demo <path>      Train from a .shagdemo file, or a directory of them.
                     A directory is read as one corpus: matches already counted
                     are skipped by match id, and whole matches are held out for
                     validation rather than random frames, which would leak.
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

/**
 * Frames across every run. A corpus is a list of runs and a run holds many
 * frames, so counting the outer array reports a handful where there are
 * thousands — and wrote that number into the model's provenance.
 */
function countFrames(runs: readonly { length: number }[]): number {
  return runs.reduce((sum, run) => sum + run.length, 0);
}

/** Say what the run achieved, and whether it was measured on unseen play. */
// biome-ignore lint/suspicious/noExplicitAny: tf.History, without importing TF into this module
function reportLoss(label: string, result: any): void {
  const history = result?.history ?? {};
  const last = (values: unknown): number | null =>
    Array.isArray(values) && values.length > 0 ? (values[values.length - 1] as number) : null;
  const loss = last(history.loss);
  const valLoss = last(history.val_loss);
  const lossText = loss === null ? "n/a" : loss.toFixed(6);
  console.log(
    valLoss === null
      ? `[Trainer] ${label} model loss: ${lossText} (training only — no held-out matches)`
      : `[Trainer] ${label} model loss: ${lossText}, held-out: ${valLoss.toFixed(6)}`,
  );
}

async function trainFromDemo(demoFile: string, config: Partial<TrainerConfig>, includeBots = false): Promise<void> {
  // Dynamic import to avoid loading TF.js unless needed
  const { buildCorpus } = await import("../bot/TrainingCorpus");
  const { writeMetadata, describeCurrentFeatures } = await import("../bot/ModelMetadata");
  const { HybridBrain } = await import("../bot/HybridBrain");
  const { getTF } = await import("../bot/TFBackend");
  const { resolveDifficulty } = await import("../bot/BotConfig");
  const { buildCorpusPairs } = await import("../bot/CloningTargets");
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

  // 1. Gather every recording under the target — a file, or a directory of them
  const corpus = await buildCorpus(demoFile, { includeBots });

  for (const match of corpus.matches) {
    console.log(`[Trainer]   ${path.basename(match.file)} — ${match.map}, ${match.frames} frames`);
  }
  for (const skip of corpus.skipped) {
    console.log(`[Trainer]   skipped ${path.basename(skip.file)} — ${skip.reason}`);
  }

  if (corpus.totalFrames === 0) {
    console.error("[Trainer] No training frames. A demo trains nothing unless it holds a verified player;");
    console.error("[Trainer] pass --include-bots to train on bot play instead.");
    process.exit(1);
  }

  const trainFrames = countFrames(corpus.train);
  const validationFrames = countFrames(corpus.validation);
  console.log(
    `[Trainer] ${corpus.totalFrames} frames from ${corpus.matches.length} match(es): ` +
      `${trainFrames} training, ${validationFrames} validation`,
  );
  if (corpus.validation.length === 0 && corpus.matches.length < 2) {
    console.warn("[Trainer] One match means no validation set — the loss below says memorised, not learned.");
  }

  // 2. Create or load models
  const difficulty = resolveDifficulty(config.difficulty || "medium");
  const brain = new HybridBrain(difficulty);
  const modelDir = config.modelDir || "./src/games/fps/models";

  if (config.resumeTraining) {
    await brain.loadModels(modelDir);
  }
  if (!brain.hasModels) {
    await brain.createFreshModels(config.learningRate);
  }

  // 3. Train on extracted data
  const epochs = config.epochs || 10;
  const batchSize = config.batchSize || 32;
  const tf = getTF();

  console.log(`[Trainer] Training on ${trainFrames} frames (${epochs} epochs, batch ${batchSize})`);

  /**
   * Fit one head on the corpus, measured against the matches held back.
   *
   * Behaviour cloning, run by run: a run is one player in one match and the
   * labels are differences, so frames from two players must never be adjacent.
   *
   * The held-out matches are passed as `validationData` rather than letting
   * Keras take a `validationSplit` off the tail of the training set. A frame
   * split leaks — frames seconds apart in one match are nearly the same frame,
   * so the network is scored on play it has effectively already seen, which is
   * the whole reason the corpus splits by match.
   */
  const fitHead = async (
    label: string,
    // biome-ignore lint/suspicious/noExplicitAny: tf.LayersModel, without importing TF into this module
    model: any,
    head: "tactical" | "combat",
    inputSize: number,
  ): Promise<void> => {
    const train = buildCorpusPairs(corpus.train, head, inputSize);
    if (train.dropped > 0) {
      console.log(
        `[Trainer] ${label}: ${train.dropped} frame(s) dropped — wrong feature width, or a value that is not a number`,
      );
    }
    if (train.pairs.length === 0 || !model) {
      console.warn(`[Trainer] ${label}: nothing to train on.`);
      return;
    }

    const inputTensor = tf.tensor2d(train.pairs.map((pair) => pair.input));
    const targetTensor = tf.tensor2d(train.pairs.map((pair) => pair.target));

    const heldOut = buildCorpusPairs(corpus.validation, head, inputSize);
    const valInput = heldOut.pairs.length > 0 ? tf.tensor2d(heldOut.pairs.map((pair) => pair.input)) : null;
    const valTarget = heldOut.pairs.length > 0 ? tf.tensor2d(heldOut.pairs.map((pair) => pair.target)) : null;

    const result = await model.fit(inputTensor, targetTensor, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 1,
      ...(valInput && valTarget ? { validationData: [valInput, valTarget] } : {}),
    });

    reportLoss(label, result);

    inputTensor.dispose();
    targetTensor.dispose();
    valInput?.dispose();
    valTarget?.dispose();
  };

  await fitHead("Tactical", brain.tacticalModel, "tactical", TACTICAL_INPUT_SIZE);
  await fitHead("Combat", brain.combatModel, "combat", COMBAT_INPUT_SIZE);

  // 4. Save models, and what they were trained on, and clean up
  fs.mkdirSync(path.resolve(modelDir), { recursive: true });
  await brain.saveModels(modelDir);
  writeMetadata(modelDir, {
    ...describeCurrentFeatures(),
    trainedAt: new Date().toISOString(),
    matches: corpus.matches.length,
    trainFrames,
    validationFrames,
    includedBots: includeBots,
    matchIds: corpus.matches.map((match) => match.matchId).filter((id): id is string => Boolean(id)),
  });
  brain.dispose();

  console.log("");
  console.log(`[Trainer] ✅ Demo training complete!`);
  console.log(`[Trainer] Models saved to: ${modelDir}`);
  console.log(`[Trainer] Trained on ${corpus.matches.length} match(es); metadata written beside the weights.`);
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
