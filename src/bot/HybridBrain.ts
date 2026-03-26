/**
 * HybridBrain — StateMachineBrain + TensorFlow.js Neural Enhancement
 *
 * Wraps the existing rule-based StateMachineBrain and optionally enhances
 * its decisions with trained TensorFlow.js neural networks.
 *
 * Architecture:
 *   1. StateMachineBrain.decide() → base decision (always runs)
 *   2. TacticalModel.predict()    → strategic overrides (if loaded)
 *   3. CombatModel.predict()      → combat refinement (if loaded, in FIGHT)
 *
 * Without loaded models, behaves identically to StateMachineBrain.
 * All tensor operations wrapped in tf.tidy() to prevent memory leaks.
 *
 * NOTE: Uses TFBackend abstraction — tries native C++ addon first,
 * falls back to pure JS. BotClient handles the case where TF.js
 * is entirely unavailable.
 */

import type { BotInput } from "./BotBrain";
import { BotBrain, BotState } from "./BotBrain";
import type { BotDifficulty } from "./BotConfig";
import { InputButtons } from "./BotConfig";
import type { BotGameState, VisiblePlayer } from "./BotGameState";
import { buildCombatInput, buildTacticalInput, COMBAT_INPUT_SIZE, TACTICAL_INPUT_SIZE } from "./BotInputNormalizer";
import { canInitiateSlide } from "./BotMovementProfile";
import type { BotVision, VisionResult } from "./BotVision";
import { StateMachineBrain } from "./StateMachineBrain";
import { getTF, initTF } from "./TFBackend";

// ── Output Index Constants ──────────────────────────────────────────
// These map neural network output indices to semantic meanings.
// Changing these requires retraining models.

/** TacticalBrain output indices (8 outputs) */
const TACT = {
  MODE_FIGHT: 0, // 0-1: confidence to stay in FIGHT
  MODE_RETREAT: 1, // 0-1: confidence to RETREAT
  MODE_HUNT: 2, // 0-1: confidence to HUNT for items/enemies
  MOVE_SPRINT: 3, // 0-1: should sprint
  MOVE_SLIDE: 4, // 0-1: should crouch-slide
  MOVE_JUMP: 5, // 0-1: should jump
  WEAPON_SWITCH: 6, // 0-1: should switch weapon (>0.5 = yes)
  WEAPON_SLOT: 7, // 0-1: which slot (mapped to weapon index)
} as const;

const TACTICAL_OUTPUT_SIZE = 8;

/** CombatBrain output indices (6 outputs) */
const COMBAT = {
  SHOULD_FIRE: 0, // 0-1: fire weapon
  SHOULD_ADS: 1, // 0-1: aim down sights
  AIM_YAW_ADJUST: 2, // 0-1: yaw adjustment (0.5 = none, 0 = left, 1 = right)
  AIM_PITCH_ADJUST: 3, // 0-1: pitch adjustment (0.5 = none, 0 = down, 1 = up)
  DODGE_LEFT: 4, // 0-1: strafe left to dodge
  DODGE_RIGHT: 5, // 0-1: strafe right to dodge
} as const;

const COMBAT_OUTPUT_SIZE = 6;

// ── Confidence Thresholds ───────────────────────────────────────────
// Only override state machine when neural net is confident enough.

const THRESHOLD = {
  TACTICAL_OVERRIDE: 0.7, // Override state machine mode
  MOVEMENT_ACTION: 0.6, // Apply movement mechanic
  COMBAT_FIRE: 0.5, // Fire/don't fire
  COMBAT_ADS: 0.5, // ADS on/off
  WEAPON_SWITCH: 0.6, // Switch weapon
  AIM_DEADZONE: 0.05, // Ignore tiny aim adjustments (within ±0.05 of 0.5)
} as const;

// ── Model type aliases (avoid direct tf namespace in class fields) ──
// We use `any` for the stored model references because the tf types
// come from the dynamically loaded backend. The actual type safety
// is enforced at the point of use via getTF().

type TFModel = any; // tf.LayersModel at runtime

// ── HybridBrain ─────────────────────────────────────────────────────

export class HybridBrain extends BotBrain {
  private _stateMachine: StateMachineBrain;
  private _tacticalModel: TFModel | null = null;
  private _combatModel: TFModel | null = null;
  private _warmedUp: boolean = false;

  constructor(difficulty: BotDifficulty) {
    super(difficulty);
    this._stateMachine = new StateMachineBrain(difficulty);
  }

  /**
   * Load pre-trained TF.js models from disk.
   * Initializes TF.js backend if not already done.
   * Gracefully falls back if models don't exist.
   */
  async loadModels(modelDir: string): Promise<void> {
    await initTF();
    const tf = getTF();

    try {
      this._tacticalModel = await tf.loadLayersModel(`file://${modelDir}/tactical/model.json`);
      console.log(`[HybridBrain] Loaded tactical model from ${modelDir}/tactical/`);
    } catch {
      console.warn(`[HybridBrain] No tactical model found at ${modelDir}/tactical/ — using state machine`);
    }

    try {
      this._combatModel = await tf.loadLayersModel(`file://${modelDir}/combat/model.json`);
      console.log(`[HybridBrain] Loaded combat model from ${modelDir}/combat/`);
    } catch {
      console.warn(`[HybridBrain] No combat model found at ${modelDir}/combat/ — using state machine`);
    }

    // Warm up models with dummy predictions to avoid cold-start latency
    this._warmup();
  }

  /**
   * Create fresh untrained models (for training from scratch).
   * Initializes TF.js backend if not already done.
   */
  async createFreshModels(): Promise<void> {
    await initTF();
    const tf = getTF();

    this._tacticalModel = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [TACTICAL_INPUT_SIZE], units: 16, activation: "relu" }),
        tf.layers.dense({ units: 12, activation: "relu" }),
        tf.layers.dense({ units: TACTICAL_OUTPUT_SIZE, activation: "sigmoid" }),
      ],
    });
    this._tacticalModel.compile({
      optimizer: tf.train.adam(0.001),
      loss: "meanSquaredError",
    });

    this._combatModel = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [COMBAT_INPUT_SIZE], units: 12, activation: "relu" }),
        tf.layers.dense({ units: 8, activation: "relu" }),
        tf.layers.dense({ units: COMBAT_OUTPUT_SIZE, activation: "sigmoid" }),
      ],
    });
    this._combatModel.compile({
      optimizer: tf.train.adam(0.001),
      loss: "meanSquaredError",
    });

    console.log("[HybridBrain] Created fresh untrained models");
    this._warmup();
  }

  /**
   * Save current models to disk.
   */
  async saveModels(modelDir: string): Promise<void> {
    if (this._tacticalModel) {
      await this._tacticalModel.save(`file://${modelDir}/tactical`);
      console.log(`[HybridBrain] Saved tactical model to ${modelDir}/tactical/`);
    }
    if (this._combatModel) {
      await this._combatModel.save(`file://${modelDir}/combat`);
      console.log(`[HybridBrain] Saved combat model to ${modelDir}/combat/`);
    }
  }

  /** Get the tactical model for external training */
  get tacticalModel(): TFModel | null {
    return this._tacticalModel;
  }

  /** Get the combat model for external training */
  get combatModel(): TFModel | null {
    return this._combatModel;
  }

  /** Whether any neural models are loaded */
  get hasModels(): boolean {
    return this._tacticalModel !== null || this._combatModel !== null;
  }

  // ── Core Decision Loop ──────────────────────────────────────────

  decide(
    state: BotGameState,
    vision?: BotVision | null,
    visionResult?: VisionResult | null,
    navGraph?: import("./BotNavGraph").BotNavGraph | null,
  ): BotInput {
    // 1. State machine always runs — gives us the baseline decision
    const baseInput = this._stateMachine.decide(state, vision, visionResult, navGraph);
    const currentState = this._stateMachine.getState();

    // Sync our state for external queries
    this.currentState = currentState;

    // 2. No models loaded → pure state machine (perfectly functional!)
    if (!this._tacticalModel && !this._combatModel) {
      return baseInput;
    }

    // Don't run inference while dead
    if (state.self.isDead) {
      return baseInput;
    }

    // 3. Tactical model: strategic decision enhancement
    if (this._tacticalModel) {
      const tactOutput = this._runTactical(state, vision);
      if (tactOutput) {
        this._applyTactical(tactOutput, baseInput, state, currentState);
      }
    }

    // 4. Combat model: aim/fire refinement (only during FIGHT)
    if (this._combatModel && currentState === BotState.FIGHT) {
      // Use vision's LOS-confirmed enemies, not raw player list
      // (state.players includes enemies behind walls)
      const visibleEnemy = visionResult?.visibleEnemies?.[0]?.player ?? state.players[0]; // Fallback if no vision data
      if (visibleEnemy) {
        const combatOutput = this._runCombat(state, visibleEnemy);
        if (combatOutput) {
          this._applyCombat(combatOutput, baseInput, state);
        }
      }
    }

    return baseInput;
  }

  // ── Neural Inference ────────────────────────────────────────────

  /**
   * Run tactical model inference. Returns Float32Array of outputs or null.
   */
  private _runTactical(state: BotGameState, vision: BotVision | null | undefined): Float32Array | null {
    try {
      const tf = getTF();
      return tf.tidy(() => {
        const input = buildTacticalInput(state, vision ?? null);
        const tensor = tf.tensor2d([Array.from(input)]);
        const prediction = this._tacticalModel!.predict(tensor);
        return prediction.dataSync() as Float32Array;
      });
    } catch (e) {
      console.error("[HybridBrain] Tactical inference error:", e);
      return null;
    }
  }

  /**
   * Run combat model inference. Returns Float32Array of outputs or null.
   */
  private _runCombat(state: BotGameState, enemy: VisiblePlayer): Float32Array | null {
    try {
      const tf = getTF();
      return tf.tidy(() => {
        const input = buildCombatInput(state, enemy);
        const tensor = tf.tensor2d([Array.from(input)]);
        const prediction = this._combatModel!.predict(tensor);
        return prediction.dataSync() as Float32Array;
      });
    } catch (e) {
      console.error("[HybridBrain] Combat inference error:", e);
      return null;
    }
  }

  // ── Output Interpretation ───────────────────────────────────────

  /**
   * Apply tactical model outputs to enhance the base decision.
   */
  private _applyTactical(output: Float32Array, input: BotInput, state: BotGameState, currentState: BotState): void {
    // Movement mechanics (additive — don't remove what state machine set)
    const speed = Math.sqrt(state.self.velocity.x ** 2 + state.self.velocity.y ** 2 + state.self.velocity.z ** 2);

    // Sprint suggestion
    if (output[TACT.MOVE_SPRINT] > THRESHOLD.MOVEMENT_ACTION && currentState !== BotState.FIGHT) {
      input.buttons |= InputButtons.SPRINT;
      input.buttons |= InputButtons.FORWARD;
    }

    // Crouch-slide suggestion (only if speed allows)
    if (output[TACT.MOVE_SLIDE] > THRESHOLD.MOVEMENT_ACTION && canInitiateSlide(speed, true)) {
      input.buttons |= InputButtons.CROUCH;
    }

    // Jump suggestion
    if (output[TACT.MOVE_JUMP] > THRESHOLD.MOVEMENT_ACTION) {
      input.buttons |= InputButtons.JUMP;
    }

    // Weapon switch suggestion
    if (output[TACT.WEAPON_SWITCH] > THRESHOLD.WEAPON_SWITCH) {
      const weaponCount = state.self.weapons.length;
      if (weaponCount > 0) {
        const slotIndex = Math.floor(output[TACT.WEAPON_SLOT] * weaponCount);
        const clampedSlot = Math.min(slotIndex, weaponCount - 1);
        input.weaponSlot = clampedSlot + 1; // 1-indexed
      }
    }

    // Retreat override — if neural net says retreat AND health is low
    if (
      output[TACT.MODE_RETREAT] > THRESHOLD.TACTICAL_OVERRIDE &&
      state.self.health < 80 &&
      currentState === BotState.FIGHT
    ) {
      // Reverse direction to retreat — must set BACK and clear FORWARD
      // so server applies backward movement physics correctly
      input.direction.z = -1;
      input.buttons |= InputButtons.SPRINT | InputButtons.BACK;
      input.buttons &= ~(InputButtons.FIRE | InputButtons.FORWARD);
    }
  }

  /**
   * Apply combat model outputs to refine aim and fire decisions.
   */
  private _applyCombat(output: Float32Array, input: BotInput, _state: BotGameState): void {
    // Fire control
    if (output[COMBAT.SHOULD_FIRE] > THRESHOLD.COMBAT_FIRE) {
      input.buttons |= InputButtons.FIRE;
    } else {
      input.buttons &= ~InputButtons.FIRE;
    }

    // ADS control
    if (output[COMBAT.SHOULD_ADS] > THRESHOLD.COMBAT_ADS) {
      input.buttons |= InputButtons.ALT_FIRE;
    } else {
      input.buttons &= ~InputButtons.ALT_FIRE;
    }

    // Aim adjustments (small nudges, ±0.3 radians max)
    const yawAdj = output[COMBAT.AIM_YAW_ADJUST] - 0.5; // -0.5 to +0.5
    const pitchAdj = output[COMBAT.AIM_PITCH_ADJUST] - 0.5;

    if (Math.abs(yawAdj) > THRESHOLD.AIM_DEADZONE) {
      input.yaw += yawAdj * 0.6; // Scale to ±0.3 radians
    }
    if (Math.abs(pitchAdj) > THRESHOLD.AIM_DEADZONE) {
      input.pitch += pitchAdj * 0.6;
    }

    // Dodge suggestions (strafe direction override)
    // Must set LEFT/RIGHT button flags — server strafe physics requires them
    if (
      output[COMBAT.DODGE_LEFT] > THRESHOLD.MOVEMENT_ACTION &&
      output[COMBAT.DODGE_LEFT] > output[COMBAT.DODGE_RIGHT]
    ) {
      input.direction.x = -1;
      input.buttons |= InputButtons.LEFT;
      input.buttons &= ~InputButtons.RIGHT;
    } else if (output[COMBAT.DODGE_RIGHT] > THRESHOLD.MOVEMENT_ACTION) {
      input.direction.x = 1;
      input.buttons |= InputButtons.RIGHT;
      input.buttons &= ~InputButtons.LEFT;
    }
  }

  // ── Warmup ──────────────────────────────────────────────────────

  /**
   * Run dummy predictions to warm up TF.js (first call is ~50-100ms).
   */
  private _warmup(): void {
    if (this._warmedUp) return;

    try {
      const tf = getTF();
      tf.tidy(() => {
        if (this._tacticalModel) {
          const dummyTact = tf.zeros([1, TACTICAL_INPUT_SIZE]);
          this._tacticalModel.predict(dummyTact);
        }
        if (this._combatModel) {
          const dummyCombat = tf.zeros([1, COMBAT_INPUT_SIZE]);
          this._combatModel.predict(dummyCombat);
        }
      });
    } catch (e) {
      console.warn("[HybridBrain] Warmup failed:", e);
    }

    this._warmedUp = true;
    console.log("[HybridBrain] Model warmup complete");
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  /**
   * Dispose TF.js models to free memory.
   * Call when the bot is being removed.
   */
  dispose(): void {
    if (this._tacticalModel) {
      this._tacticalModel.dispose();
      this._tacticalModel = null;
    }
    if (this._combatModel) {
      this._combatModel.dispose();
      this._combatModel = null;
    }
  }
}
