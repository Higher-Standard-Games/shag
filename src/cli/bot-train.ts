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
  const { buildCombatTarget, buildTacticalTarget } = await import("../bot/CloningTargets");
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

  console.log(
    `[Trainer] ${corpus.totalFrames} frames from ${corpus.matches.length} match(es): ` +
      `${corpus.train.length} training, ${corpus.validation.length} validation`,
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
    await brain.createFreshModels();
  }

  // 3. Train on extracted data
  const epochs = config.epochs || 10;
  const batchSize = config.batchSize || 32;
  const tf = getTF();

  // Collect all frames from all players
  const allFrames = corpus.train;
  console.log(`[Trainer] Training on ${allFrames.length} frames (${epochs} epochs, batch ${batchSize})`);

  // Validation comes from matches held out of training, so the number below is
  // measured on play the network has never seen. With one match there is none,
  // and a training loss alone only says the frames were memorised.
  const validationSplit = corpus.validation.length > 0 ? 0.2 : 0;

  // Build tactical training data (keep frame + input together to avoid index misalignment)
  const tactPairs = allFrames
    .filter((f) => f.tacticalInput.length === TACTICAL_INPUT_SIZE)
    .map((f) => ({ input: f.tacticalInput, frame: f }));

  const tactInputs = tactPairs.map((p) => p.input);
  // Behaviour cloning: the target is what the person did on this frame. The
  // previous frame comes along because a turn is a difference, not a position.
  const tactTargets = tactPairs.map((p, index) =>
    buildTacticalTarget(p.frame, index > 0 ? tactPairs[index - 1].frame : undefined),
  );

  if (tactInputs.length > 0 && brain.tacticalModel) {
    const inputTensor = tf.tensor2d(tactInputs);
    const targetTensor = tf.tensor2d(tactTargets);

    const result = await brain.tacticalModel.fit(inputTensor, targetTensor, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 1,
      ...(validationSplit > 0 ? { validationSplit } : {}),
    });

    reportLoss("Tactical", result);

    inputTensor.dispose();
    targetTensor.dispose();
  }

  // Build combat training tensors
  const combatFrames = allFrames.filter((f) => f.combatInput && f.combatInput.length === COMBAT_INPUT_SIZE);

  if (combatFrames.length > 0 && brain.combatModel) {
    const combatInputs = combatFrames.map((f) => f.combatInput!);
    const combatTargets = combatFrames.map((f, index) =>
      buildCombatTarget(f, index > 0 ? combatFrames[index - 1] : undefined),
    );

    const inputTensor = tf.tensor2d(combatInputs);
    const targetTensor = tf.tensor2d(combatTargets);

    const result = await brain.combatModel.fit(inputTensor, targetTensor, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 1,
      ...(validationSplit > 0 ? { validationSplit } : {}),
    });

    reportLoss("Combat", result);

    inputTensor.dispose();
    targetTensor.dispose();
  }

  // 4. Save models, and what they were trained on, and clean up
  fs.mkdirSync(path.resolve(modelDir), { recursive: true });
  await brain.saveModels(modelDir);
  writeMetadata(modelDir, {
    ...describeCurrentFeatures(),
    trainedAt: new Date().toISOString(),
    matches: corpus.matches.length,
    trainFrames: corpus.train.length,
    validationFrames: corpus.validation.length,
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
