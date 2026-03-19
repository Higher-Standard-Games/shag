/**
 * BotTrainer — Autonomous Training Loop
 *
 * Runs headless training sessions: spins up a game server, connects
 * HybridBrain bots, records episodes, computes rewards, and trains
 * the neural networks using TensorFlow.js.
 *
 * Usage:
 *   const trainer = new BotTrainer({ map: 'wdm7', rounds: 100 });
 *   await trainer.train();
 *
 * Architecture:
 *   1. Start headless GameServer (WebSocket only, no WebTransport)
 *   2. Connect 2+ HybridBrain bots with fresh or loaded models
 *   3. Play round (time-limited)
 *   4. BotEpisodeRecorder captures every tick
 *   5. BotRewardComputer assigns delayed rewards
 *   6. Convert frames to tensors → model.fit()
 *   7. Log progress, save checkpoint every N rounds
 *   8. Repeat
 *
 * Performance with @tensorflow/tfjs-node C++ backend:
 *   - 3-min match (~10,800 frames) trains in ~3-5 seconds
 *   - 500 rounds ≈ 25-40 minutes total
 */

import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import { BotClient } from './BotClient';
import { HybridBrain } from './HybridBrain';
import { BotEpisodeRecorder, type TrainingFrame } from './BotEpisodeRecorder';
import { BotRewardComputer } from './BotRewardComputer';
import {
    TACTICAL_INPUT_SIZE,
    COMBAT_INPUT_SIZE,
} from './BotInputNormalizer';
import { getNextBotName, resetBotNameIndex } from './BotConfig';

// ── Training Configuration ──────────────────────────────────────────

export interface TrainerConfig {
    /** Map name to train on */
    map: string;
    /** Number of training rounds */
    rounds: number;
    /** Number of bots per round (2+ for fights) */
    botCount: number;
    /** Match duration in ms (default: 180_000 = 3 min) */
    matchDurationMs: number;
    /** Game server port for training (default: 17777) */
    serverPort: number;
    /** Directory to save/load models */
    modelDir: string;
    /** Save checkpoint every N rounds */
    checkpointInterval: number;
    /** Training epochs per round */
    epochs: number;
    /** Training batch size */
    batchSize: number;
    /** Learning rate */
    learningRate: number;
    /** Bot difficulty for training */
    difficulty: string;
    /** Load existing models to continue training */
    resumeTraining: boolean;
    /** Gametype for training matches */
    gametype: string;
}

export const DEFAULT_TRAINER_CONFIG: TrainerConfig = {
    map: 'wdm7',
    rounds: 100,
    botCount: 2,
    matchDurationMs: 180_000,  // 3 minutes
    serverPort: 17777,         // Different from regular server
    modelDir: './models',
    checkpointInterval: 10,
    epochs: 5,
    batchSize: 32,
    learningRate: 0.001,
    difficulty: 'medium',
    resumeTraining: false,
    gametype: 'duel',
};

// ── Training Statistics ─────────────────────────────────────────────

interface RoundStats {
    round: number;
    duration: number;
    totalFrames: number;
    totalKills: number;
    totalDeaths: number;
    avgReward: number;
    tacticalLoss: number;
    combatLoss: number;
}

// ── BotTrainer ──────────────────────────────────────────────────────

export class BotTrainer {
    private _config: TrainerConfig;
    private _brain: HybridBrain;
    private _rewardComputer: BotRewardComputer;
    private _roundStats: RoundStats[] = [];
    private _startTime: number = 0;

    constructor(config?: Partial<TrainerConfig>) {
        this._config = { ...DEFAULT_TRAINER_CONFIG, ...config };
        this._brain = new HybridBrain({
            aimAccuracy: 0.5, reactionTimeMs: 200,
            trackingSpeed: 3.0, predictionSkill: 0.5, itemTimingSkill: 0.5,
            strafeJumpSkill: 0.5, dodgeSkill: 0.5, mistakeRate: 2, lookAroundInterval: 4
        });
        this._rewardComputer = new BotRewardComputer();
    }

    // ── Main Training Loop ──────────────────────────────────────────

    async train(): Promise<void> {
        this._startTime = Date.now();

        console.log('');
        console.log('╔═══════════════════════════════════════════════╗');
        console.log('║          Bot Training Gym 🧠⚡                ║');
        console.log('║       TensorFlow.js Neural Training           ║');
        console.log('╚═══════════════════════════════════════════════╝');
        console.log('');
        console.log(`[Trainer] Map: ${this._config.map}`);
        console.log(`[Trainer] Rounds: ${this._config.rounds}`);
        console.log(`[Trainer] Bots per round: ${this._config.botCount}`);
        console.log(`[Trainer] Match duration: ${this._config.matchDurationMs / 1000}s`);
        console.log(`[Trainer] Model dir: ${this._config.modelDir}`);
        console.log(`[Trainer] Checkpoint every: ${this._config.checkpointInterval} rounds`);
        console.log('');

        // Load or create models
        if (this._config.resumeTraining) {
            await this._brain.loadModels(this._config.modelDir);
            if (!this._brain.hasModels) {
                console.log('[Trainer] No existing models found, creating fresh ones');
                this._brain.createFreshModels();
            }
        } else {
            this._brain.createFreshModels();
        }

        // Ensure model directory exists
        fs.mkdirSync(path.resolve(this._config.modelDir), { recursive: true });

        // Training loop
        for (let round = 0; round < this._config.rounds; round++) {
            const roundStart = Date.now();
            console.log(`\n[Trainer] ═══ Round ${round + 1}/${this._config.rounds} ═══`);

            try {
                // 1. Play a match and collect episodes
                const episodes = await this._playTrainingRound();

                // 2. Compute rewards
                for (const episode of episodes) {
                    this._rewardComputer.computeRewards(episode.frames);
                    this._rewardComputer.normalizeRewards(episode.frames);
                }

                // 3. Train models on collected data
                const allFrames = episodes.flatMap(e => e.frames);
                const { tacticalLoss, combatLoss } = await this._trainOnFrames(allFrames);

                // 4. Log stats
                const totalKills = episodes.reduce((s, e) => s + e.summary.kills, 0);
                const totalDeaths = episodes.reduce((s, e) => s + e.summary.deaths, 0);
                const avgReward = allFrames.length > 0
                    ? allFrames.reduce((s, f) => s + f.reward, 0) / allFrames.length
                    : 0;

                const stats: RoundStats = {
                    round: round + 1,
                    duration: Date.now() - roundStart,
                    totalFrames: allFrames.length,
                    totalKills,
                    totalDeaths,
                    avgReward,
                    tacticalLoss,
                    combatLoss,
                };
                this._roundStats.push(stats);

                console.log(`[Trainer] Round ${round + 1}: ${allFrames.length} frames, ` +
                    `K/D: ${totalKills}/${totalDeaths}, ` +
                    `avgReward: ${avgReward.toFixed(4)}, ` +
                    `loss: T=${tacticalLoss.toFixed(6)} C=${combatLoss.toFixed(6)}, ` +
                    `${stats.duration}ms`);

                // 5. Save checkpoint
                if ((round + 1) % this._config.checkpointInterval === 0) {
                    await this._saveCheckpoint(round + 1);
                }
            } catch (e) {
                console.error(`[Trainer] Round ${round + 1} failed:`, e);
            }
        }

        // Final save
        await this._saveCheckpoint(this._config.rounds);
        this._printSummary();
    }

    // ── Play Training Round ─────────────────────────────────────────

    /**
     * Play a single training round:
     * Start a game server, connect bots, play match, return episodes.
     */
    private async _playTrainingRound(): Promise<Array<{
        frames: TrainingFrame[];
        summary: { kills: number; deaths: number; damageDealt: number; damageTaken: number };
    }>> {
        resetBotNameIndex();

        // Connect bots to an external game server
        // The trainer expects a running game server on the configured port
        const serverUrl = `ws://localhost:${this._config.serverPort}`;
        const bots: Array<{ client: BotClient; recorder: BotEpisodeRecorder }> = [];

        for (let i = 0; i < this._config.botCount; i++) {
            const botName = getNextBotName();
            const recorder = new BotEpisodeRecorder(botName, this._config.map);

            const client = new BotClient({
                name: botName,
                difficulty: this._config.difficulty,
            });

            try {
                await client.connect(serverUrl);
                recorder.startRecording(0);
                bots.push({ client, recorder });
            } catch (e) {
                console.error(`[Trainer] Failed to connect bot ${botName}:`, e);
            }
        }

        if (bots.length < 2) {
            console.warn('[Trainer] Not enough bots connected, skipping round');
            for (const bot of bots) {
                await bot.client.disconnect();
            }
            return [];
        }

        console.log(`[Trainer] ${bots.length} bots connected, playing ${this._config.matchDurationMs / 1000}s match...`);

        // Wait for match duration
        await new Promise(r => setTimeout(r, this._config.matchDurationMs));

        // Stop recording and disconnect
        const episodes: Array<{
            frames: TrainingFrame[];
            summary: { kills: number; deaths: number; damageDealt: number; damageTaken: number };
        }> = [];

        for (const bot of bots) {
            bot.recorder.stopRecording();
            const summary = bot.recorder.getSummary();
            episodes.push({
                frames: bot.recorder.getFrames(),
                summary: {
                    kills: summary.kills,
                    deaths: summary.deaths,
                    damageDealt: summary.damageDealt,
                    damageTaken: summary.damageTaken,
                },
            });
            await bot.client.disconnect();
        }

        return episodes;
    }

    // ── Model Training ──────────────────────────────────────────────

    /**
     * Train both models on a batch of frames.
     * Returns loss values for logging.
     */
    private async _trainOnFrames(frames: TrainingFrame[]): Promise<{
        tacticalLoss: number;
        combatLoss: number;
    }> {
        if (frames.length === 0) {
            return { tacticalLoss: 0, combatLoss: 0 };
        }

        let tacticalLoss = 0;
        let combatLoss = 0;

        const tacticalModel = this._brain.tacticalModel;
        const combatModel = this._brain.combatModel;

        // ── Train Tactical Model ────────────────────────────────────
        if (tacticalModel) {
            const tactInputs: number[][] = [];
            const tactTargets: number[][] = [];

            for (const frame of frames) {
                if (frame.tacticalInput.length !== TACTICAL_INPUT_SIZE) continue;

                tactInputs.push(frame.tacticalInput);

                // Target: what the bot SHOULD have done, weighted by reward
                // Higher reward → reinforce current action, lower → discourage
                const rewardScale = (frame.reward + 1) / 2; // Map [-1,1] → [0,1]

                // Create target from action: map buttons/slots to output indices
                const target = new Array(8).fill(0.5); // Start at neutral
                target[0] = rewardScale; // Fight confidence = reward
                target[1] = 1 - rewardScale; // Retreat = inverse of reward
                target[3] = (frame.action.buttons & 0x80) ? rewardScale : 1 - rewardScale; // Sprint
                target[5] = (frame.action.buttons & 0x04) ? rewardScale : 1 - rewardScale; // Jump

                tactTargets.push(target);
            }

            if (tactInputs.length > 0) {
                const inputTensor = tf.tensor2d(tactInputs);
                const targetTensor = tf.tensor2d(tactTargets);

                const result = await tacticalModel.fit(inputTensor, targetTensor, {
                    epochs: this._config.epochs,
                    batchSize: this._config.batchSize,
                    shuffle: true,
                    verbose: 0,
                });

                tacticalLoss = result.history.loss
                    ? (result.history.loss[result.history.loss.length - 1] as number)
                    : 0;

                inputTensor.dispose();
                targetTensor.dispose();
            }
        }

        // ── Train Combat Model ──────────────────────────────────────
        if (combatModel) {
            const combatInputs: number[][] = [];
            const combatTargets: number[][] = [];

            for (const frame of frames) {
                if (!frame.combatInput || frame.combatInput.length !== COMBAT_INPUT_SIZE) continue;

                combatInputs.push(frame.combatInput);

                const rewardScale = (frame.reward + 1) / 2;

                // Target from action
                const target = new Array(6).fill(0.5);
                target[0] = (frame.action.buttons & 0x01) ? rewardScale : 1 - rewardScale; // Fire
                target[1] = (frame.action.buttons & 0x02) ? rewardScale : 1 - rewardScale; // ADS
                target[2] = 0.5; // Aim yaw (neutral — actual aiming is complex)
                target[3] = 0.5; // Aim pitch (neutral)
                target[4] = frame.action.directionX < 0 ? rewardScale : 0.5; // Dodge left
                target[5] = frame.action.directionX > 0 ? rewardScale : 0.5; // Dodge right

                combatTargets.push(target);
            }

            if (combatInputs.length > 0) {
                const inputTensor = tf.tensor2d(combatInputs);
                const targetTensor = tf.tensor2d(combatTargets);

                const result = await combatModel.fit(inputTensor, targetTensor, {
                    epochs: this._config.epochs,
                    batchSize: this._config.batchSize,
                    shuffle: true,
                    verbose: 0,
                });

                combatLoss = result.history.loss
                    ? (result.history.loss[result.history.loss.length - 1] as number)
                    : 0;

                inputTensor.dispose();
                targetTensor.dispose();
            }
        }

        return { tacticalLoss, combatLoss };
    }

    // ── Checkpoint Management ───────────────────────────────────────

    private async _saveCheckpoint(round: number): Promise<void> {
        const dir = path.resolve(this._config.modelDir);
        fs.mkdirSync(dir, { recursive: true });

        // Save current models
        await this._brain.saveModels(dir);

        // Save checkpoint copy
        const checkpointDir = path.join(dir, 'checkpoints', `round_${round}`);
        fs.mkdirSync(checkpointDir, { recursive: true });
        await this._brain.saveModels(checkpointDir);

        // Save training stats
        const statsPath = path.join(dir, 'training_stats.json');
        fs.writeFileSync(statsPath, JSON.stringify({
            config: this._config,
            rounds: this._roundStats,
            lastRound: round,
            timestamp: new Date().toISOString(),
        }, null, 2));

        console.log(`[Trainer] 💾 Checkpoint saved: round ${round} → ${dir}`);
    }

    // ── Summary ─────────────────────────────────────────────────────

    private _printSummary(): void {
        const elapsed = (Date.now() - this._startTime) / 1000;
        const totalFrames = this._roundStats.reduce((s, r) => s + r.totalFrames, 0);
        const totalKills = this._roundStats.reduce((s, r) => s + r.totalKills, 0);
        const avgLoss = this._roundStats.length > 0
            ? this._roundStats.reduce((s, r) => s + r.tacticalLoss, 0) / this._roundStats.length
            : 0;

        console.log('');
        console.log('╔═══════════════════════════════════════════════╗');
        console.log('║            Training Complete! 🎉               ║');
        console.log('╚═══════════════════════════════════════════════╝');
        console.log('');
        console.log(`[Trainer] Total time: ${elapsed.toFixed(1)}s`);
        console.log(`[Trainer] Rounds: ${this._roundStats.length}`);
        console.log(`[Trainer] Total frames: ${totalFrames}`);
        console.log(`[Trainer] Total kills: ${totalKills}`);
        console.log(`[Trainer] Avg tactical loss: ${avgLoss.toFixed(6)}`);
        console.log(`[Trainer] Models saved to: ${path.resolve(this._config.modelDir)}`);
        console.log('');
    }
}
