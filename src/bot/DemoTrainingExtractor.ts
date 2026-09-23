/**
 * DemoTrainingExtractor — .shagdemo → Training Data
 *
 * Bridges the gap between server-side demo recordings and the
 * TensorFlow.js training pipeline. Takes a compact .shagdemo file
 * and extracts per-player training frames with:
 *   - Neural network inputs (via BotInputNormalizer)
 *   - Player actions (from entity state deltas)
 *   - Computed rewards (via BotRewardComputer)
 *
 * Data flow:
 *   .shagdemo → DemoReader → GameState per tick
 *             → BotGameState per player
 *             → BotInputNormalizer → Float32Array inputs
 *             → BotRewardComputer → reward signal
 *             → ready for model.fit()
 *
 * Usage:
 *   const extractor = new DemoTrainingExtractor();
 *   const dataset = await extractor.extractFromFile('match.shagdemo');
 *   // dataset.players[0].frames → TrainingFrame[]
 */

import * as fs from "node:fs";
import { type DemoFrame, type DemoHeader, DemoReader } from "../shared/demo/DemoReader";
import { InputButtons } from "./BotConfig";
import type { TrainingFrame } from "./BotEpisodeRecorder";
import { BotGameState } from "./BotGameState";
import { buildCombatInput, buildTacticalInput } from "./BotInputNormalizer";
import { BotRewardComputer } from "./BotRewardComputer";

// ── Types ───────────────────────────────────────────────────────────────

export interface DemoDataset {
  /** Demo metadata */
  header: DemoHeader;
  /** Training data extracted per player */
  players: PlayerTrainingData[];
  /** Total frames across all players */
  totalFrames: number;
}

export interface PlayerTrainingData {
  /** Player ID from demo roster */
  playerId: string;
  /** Player name */
  name: string;
  /** Training frames (inputs + actions + rewards) */
  frames: TrainingFrame[];
  /** Summary statistics */
  stats: {
    kills: number;
    deaths: number;
    totalReward: number;
    avgReward: number;
  };
}

// ── DemoTrainingExtractor ─────────────────────────────────────────────

/** A player as the demo header describes them. */
interface DemoPlayerInfo {
  playerId: string;
  name: string;
  accountId?: number;
}

export interface ExtractOptions {
  /**
   * Take every player, bots included. For self-play datasets, where our own
   * bot's behaviour is the point rather than the contamination.
   */
  includeBots?: boolean;
}

/**
 * Which players in a demo are worth learning from.
 *
 * A verified `accountId` comes from a lobby seat ticket, which only a person
 * holds — bots carry no account. Version-1 demos predate accounts entirely, so
 * nothing in them can be proven human.
 */
export function selectPlayers<T extends DemoPlayerInfo>(
  players: readonly T[],
  options: ExtractOptions = {},
): { kept: T[]; dropped: number } {
  if (options.includeBots) return { kept: [...players], dropped: 0 };
  const kept = players.filter((player) => typeof player.accountId === "number" && player.accountId > 0);
  return { kept, dropped: players.length - kept.length };
}

export class DemoTrainingExtractor {
  private _rewardComputer: BotRewardComputer;

  constructor() {
    this._rewardComputer = new BotRewardComputer();
  }

  /**
   * Extract training data from a .shagdemo file on disk.
   */
  async extractFromFile(filepath: string, options: ExtractOptions = {}): Promise<DemoDataset> {
    const data = fs.readFileSync(filepath);
    return this.extract(new Uint8Array(data), options);
  }

  /**
   * Extract training data from raw demo bytes.
   */
  extract(demoData: Uint8Array, options: ExtractOptions = {}): DemoDataset {
    const reader = new DemoReader(demoData);
    const header = reader.readHeader();
    const demoFrames = reader.readAllFrames();

    console.log(`[DemoExtractor] Loaded: ${header.map} (${header.gametype})`);
    console.log(`[DemoExtractor] ${demoFrames.length} frames, ${header.players.length} players`);

    // The point of training on demos is to learn from people. A seat with a
    // verified account is a person; a bot has none, so training on every player
    // in a bot match would teach the network the state machine it exists to
    // grow beyond. Version-1 demos predate accounts and can prove nobody human,
    // so they are refused rather than silently treated as human.
    const selected = selectPlayers(header.players, options);
    console.log(
      `[DemoExtractor] ${selected.kept.length} of ${header.players.length} players kept` +
        `${selected.dropped ? ` (${selected.dropped} without a verified account)` : ""}`,
    );

    // Extract training data for each player
    const players: PlayerTrainingData[] = [];
    let totalFrames = 0;

    for (const playerInfo of selected.kept) {
      const playerData = this._extractPlayerData(playerInfo.playerId, playerInfo.name, demoFrames, header);

      if (playerData.frames.length > 0) {
        // Compute delayed rewards
        this._rewardComputer.computeRewards(playerData.frames);
        this._rewardComputer.normalizeRewards(playerData.frames);

        // Compute stats
        const rewardStats = this._rewardComputer.getStats(playerData.frames);
        playerData.stats.totalReward = rewardStats.totalReward;
        playerData.stats.avgReward = rewardStats.avgReward;

        console.log(
          `[DemoExtractor] ${playerInfo.name}: ${playerData.frames.length} frames, ${playerData.stats.kills}K/${playerData.stats.deaths}D, avg reward: ${rewardStats.avgReward.toFixed(3)}`,
        );

        players.push(playerData);
        totalFrames += playerData.frames.length;
      }
    }

    return { header, players, totalFrames };
  }

  /**
   * Extract training data for a single player from the demo.
   */
  private _extractPlayerData(
    playerId: string,
    name: string,
    demoFrames: DemoFrame[],
    _header: DemoHeader,
  ): PlayerTrainingData {
    // Create a BotGameState that "sees" from this player's perspective
    const gameState = new BotGameState();
    const frames: TrainingFrame[] = [];
    let kills = 0;
    let deaths = 0;

    // Track previous frame state for delta detection
    let prevHealth = 100;
    let prevArmor = 0;

    for (let i = 0; i < demoFrames.length; i++) {
      const demoFrame = demoFrames[i];
      const state = demoFrame.state;

      // Find this player's entity ID from the player roster in this frame
      const playerState = state.players.get(playerId);
      if (!playerState) continue;

      const entityId = playerState.entityId;
      if (!entityId) continue;

      // Set up BotGameState to view from this player's perspective
      gameState.selfEntityId = entityId;
      gameState.selfPlayerId = playerId;

      // Update game state from the snapshot (this does all the heavy lifting:
      // extracts self position/health/armor, other players, pickups, events)
      gameState.update(state);

      // Skip if player is dead (unless it's the death transition)
      const justDied = gameState.self.isDead && prevHealth > 0;
      if (gameState.self.isDead && !justDied) {
        prevHealth = gameState.self.health;
        prevArmor = gameState.self.armor;
        continue;
      }

      // Build neural network inputs
      const tacticalArr = buildTacticalInput(gameState, null);
      const tacticalInput = Array.from(tacticalArr);

      let combatInput: number[] | null = null;
      const nearestEnemy = gameState.getNearestEnemy();
      if (nearestEnemy) {
        const combatArr = buildCombatInput(gameState, nearestEnemy);
        combatInput = Array.from(combatArr);
      }

      // A version-3 demo records the command the server applied, which is what
      // a person actually did. Prefer it: everything below this is guesswork
      // kept only so older recordings still yield something.
      const recorded = demoFrame.inputs.find((entry) => entry.playerId === playerId);

      // Extract player actions from entity state
      // Note: demos store state, not inputs. We infer actions from state changes.
      const entity = state.entities.get(entityId);
      const velocity = entity?.getComponent("velocity") as any;
      const transform = entity?.getComponent("transform") as any;

      const yaw = transform?.rotation?.y ?? 0;
      const pitch = transform?.rotation?.x ?? 0;

      // Infer movement direction from velocity
      const vx = velocity?.linear?.x ?? 0;
      const vz = velocity?.linear?.z ?? 0;
      const speed = Math.sqrt(vx * vx + vz * vz);
      let dirX = 0;
      let dirZ = 0;
      if (speed > 1) {
        // Convert world velocity to view-relative direction
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        dirZ = (-vx * sinYaw + vz * cosYaw) / speed; // forward component
        dirX = (vx * cosYaw + vz * sinYaw) / speed; // strafe (right) component
      }

      // Infer buttons from state + events
      // Demos store state, not inputs — we reconstruct plausible button presses
      // from velocity, direction, events, and movement state.
      let buttons = 0;

      // Movement buttons from view-relative direction
      if (dirZ > 0.3) buttons |= InputButtons.FORWARD;
      if (dirZ < -0.3) buttons |= InputButtons.BACK;
      if (dirX < -0.3) buttons |= InputButtons.LEFT; // Strafe left
      if (dirX > 0.3) buttons |= InputButtons.RIGHT; // Strafe right

      // Sprint — infer from horizontal speed (running players are sprinting)
      if (speed > 1) buttons |= InputButtons.SPRINT;

      // Jump — infer from upward velocity (positive vy = ascending)
      const vy = velocity?.linear?.y ?? 0;
      if (vy > 50) buttons |= InputButtons.JUMP;

      // Crouch — infer from movementState bitmask if available
      const movementState = entity?.getComponent("movementState") as any;
      if (movementState) {
        const msBits = movementState.flags ?? movementState ?? 0;
        if (typeof msBits === "number" && msBits & 1) {
          // bit 0 = crouching/sliding
          buttons |= InputButtons.CROUCH;
        }
      }

      // Fire — check for weapon_fire events from this player this tick
      for (const event of state.events) {
        if (event.type === "weapon_fire" && event.entityId === entityId) {
          buttons |= InputButtons.FIRE;
        }
      }

      // Detect events
      const healthDelta = gameState.self.health - prevHealth;
      const damageTaken = healthDelta < 0 ? -healthDelta : 0;
      const armorDelta = gameState.self.armor - prevArmor;

      let damageDealt = 0;
      let kill = false;
      let death = false;

      // Check kill events
      for (const killEvent of gameState.recentKills) {
        if (killEvent.killerId === playerId || killEvent.killerId === entityId) {
          kill = true;
          kills++;
          damageDealt += 100;
        }
        if (killEvent.victimId === entityId) {
          death = true;
          deaths++;
        }
      }

      // Check if this was a death transition without explicit kill event
      if (justDied && !death) {
        death = true;
        deaths++;
      }

      // Detect item pickup (but NOT respawn health restoration)
      // Respawn: health jumps from 0 to 100 — that's not an item pickup
      const isRespawn = prevHealth === 0 && gameState.self.health > 0;
      const itemPickedUp = !isRespawn && ((healthDelta > 0 && damageTaken === 0) || armorDelta > 0);

      const frame: TrainingFrame = {
        tick: demoFrame.tick,
        tacticalInput,
        combatInput,
        action: recorded
          ? {
              buttons: recorded.buttons,
              weaponSlot: recorded.weaponSlot,
              yaw: recorded.yaw,
              pitch: recorded.pitch,
              directionX: recorded.right,
              directionZ: recorded.forward,
            }
          : {
              buttons,
              weaponSlot: 0,
              yaw,
              pitch,
              directionX: dirX,
              directionZ: dirZ,
            },
        events: {
          damageDealt,
          damageTaken,
          kill,
          death,
          itemPickedUp,
          healthBefore: prevHealth,
          healthAfter: gameState.self.health,
          armorBefore: prevArmor,
          armorAfter: gameState.self.armor,
        },
        reward: 0, // Filled by BotRewardComputer
      };

      frames.push(frame);
      prevHealth = gameState.self.health;
      prevArmor = gameState.self.armor;
    }

    return {
      playerId,
      name,
      frames,
      stats: { kills, deaths, totalReward: 0, avgReward: 0 },
    };
  }
}
