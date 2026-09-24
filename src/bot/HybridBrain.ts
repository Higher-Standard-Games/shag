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
import type { BotGameState } from "./BotGameState";
import { canInitiateSlide } from "./BotMovementProfile";
import type { BotVision, VisionResult } from "./BotVision";
import { getWeaponProfile } from "./BotWeaponProfile";
import { decodeWeaponSlot } from "./CloningTargets";
import { buildModelInputs, COMBAT_MODEL_INPUT, FeatureHistory, TACTICAL_MODEL_INPUT } from "./ModelInputs";
import { checkCompatibility, readMetadata } from "./ModelMetadata";
import { StateMachineBrain } from "./StateMachineBrain";
import { getTF, initTF } from "./TFBackend";

// ── Output Index Constants ──────────────────────────────────────────
// These map neural network output indices to semantic meanings.
// Changing these requires retraining models.

/**
 * TacticalBrain output indices (5 outputs)
 *
 * Every one of these is something a person presses, which is what makes them
 * trainable from a demo. The head used to begin with three mode confidences —
 * FIGHT, RETREAT, HUNT — that no recording can label; which mode to be in is the
 * state machine's decision, and sharpening it belongs to self-play.
 */
const TACT = {
  MOVE_SPRINT: 0, // 0-1: should sprint
  MOVE_SLIDE: 1, // 0-1: should crouch-slide
  MOVE_JUMP: 2, // 0-1: should jump
  WEAPON_SWITCH: 3, // 0-1: should switch weapon (>0.5 = yes)
  WEAPON_SLOT: 4, // 0-1: which slot, over MAX_WEAPON_SLOT
} as const;

export const TACTICAL_OUTPUT_SIZE = 5;

/** CombatBrain output indices (6 outputs) */
const COMBAT = {
  SHOULD_FIRE: 0, // 0-1: fire weapon
  SHOULD_ADS: 1, // 0-1: aim down sights
  AIM_YAW_ADJUST: 2, // 0-1: yaw adjustment (0.5 = none, 0 = left, 1 = right)
  AIM_PITCH_ADJUST: 3, // 0-1: pitch adjustment (0.5 = none, 0 = down, 1 = up)
  DODGE_LEFT: 4, // 0-1: strafe left to dodge
  DODGE_RIGHT: 5, // 0-1: strafe right to dodge
} as const;

export const COMBAT_OUTPUT_SIZE = 6;

/** Adam's step size when the trainer names none. */
export const DEFAULT_LEARNING_RATE = 0.001;

// ── Confidence Thresholds ───────────────────────────────────────────
// Only override state machine when neural net is confident enough.

const THRESHOLD = {
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
  /** The last few frames each head has seen, stacked the way training stacks them. */
  private readonly _tacticalHistory = new FeatureHistory();
  private readonly _combatHistory = new FeatureHistory();
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
  /**
   * Load both heads' weights from a directory. Resolves true if either loaded;
   * a missing or refused model leaves the bot on the state machine, which is a
   * working bot, so it is reported rather than thrown.
   */
  async loadModels(modelDir: string): Promise<boolean> {
    await initTF();
    const tf = getTF();

    // Weights carry no record of the features they expect, so a normalizer
    // change would otherwise load cleanly and read nonsense.
    const compatibility = checkCompatibility(readMetadata(modelDir));
    if (!compatibility.ok) {
      console.error(`[HybridBrain] Refusing models in ${modelDir}: ${compatibility.reason}`);
      console.error("[HybridBrain] Retrain them, or point at models built for this feature set.");
      return false;
    }
    if (compatibility.reason) {
      console.warn(`[HybridBrain] ${compatibility.reason} (${modelDir})`);
    }

    try {
      const model = await tf.loadLayersModel(`file://${modelDir}/tactical/model.json`);
      this._tacticalModel = this._acceptModel(model, TACTICAL_MODEL_INPUT, "tactical", modelDir);
      if (this._tacticalModel) console.log(`[HybridBrain] Loaded tactical model from ${modelDir}/tactical/`);
    } catch {
      console.warn(`[HybridBrain] No tactical model found at ${modelDir}/tactical/ — using state machine`);
    }

    try {
      const model = await tf.loadLayersModel(`file://${modelDir}/combat/model.json`);
      this._combatModel = this._acceptModel(model, COMBAT_MODEL_INPUT, "combat", modelDir);
      if (this._combatModel) console.log(`[HybridBrain] Loaded combat model from ${modelDir}/combat/`);
    } catch {
      console.warn(`[HybridBrain] No combat model found at ${modelDir}/combat/ — using state machine`);
    }

    // Warm up models with dummy predictions to avoid cold-start latency
    this._warmup();
    return this.hasModels;
  }

  /**
   * Create fresh untrained models (for training from scratch).
   * Initializes TF.js backend if not already done.
   *
   * The learning rate is the caller's, because `--lr` is the trainer's to set;
   * it used to be fixed here, so the flag was accepted and then ignored.
   */
  async createFreshModels(learningRate = DEFAULT_LEARNING_RATE): Promise<void> {
    await initTF();
    const tf = getTF();

    this._tacticalModel = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [TACTICAL_MODEL_INPUT], units: 16, activation: "relu" }),
        tf.layers.dense({ units: 12, activation: "relu" }),
        tf.layers.dense({ units: TACTICAL_OUTPUT_SIZE, activation: "sigmoid" }),
      ],
    });
    this._tacticalModel.compile({
      optimizer: tf.train.adam(learningRate),
      loss: "meanSquaredError",
    });

    this._combatModel = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [COMBAT_MODEL_INPUT], units: 12, activation: "relu" }),
        tf.layers.dense({ units: 8, activation: "relu" }),
        tf.layers.dense({ units: COMBAT_OUTPUT_SIZE, activation: "sigmoid" }),
      ],
    });
    this._combatModel.compile({
      optimizer: tf.train.adam(learningRate),
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
  /**
   * The stacked vectors the networks would be fed at the last decision, or
   * empty before any. The one promise this whole system rests on is that these
   * are built exactly as training builds them; this is how that gets checked.
   */
  get lastInputs(): { tactical: number[]; combat: number[] } {
    return { tactical: this._tacticalHistory.stacked(), combat: this._combatHistory.stacked() };
  }

  get hasModels(): boolean {
    return this._tacticalModel !== null || this._combatModel !== null;
  }
  override getNavigationDebug(): string | null {
    return this._stateMachine.getNavigationDebug();
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

    // A dead frame never enters a stack. A bot is not normally asked to decide
    // while dead, and the stacks' own gap rule is what notices the respawn.
    if (state.self.isDead) {
      return baseInput;
    }

    // 3. Keep the stacks current on every decision, whether or not the network
    // is consulted this time, because a demo's stacks are built from every frame
    // a person played — including the ones spent mid-manoeuvre.
    const inputs = buildModelInputs(state, vision ?? null, visionResult ?? null);
    this._tacticalHistory.push(inputs.tactical, state.tick);
    if (inputs.combat) {
      this._combatHistory.push(inputs.combat, state.tick);
    } else {
      this._combatHistory.clear();
    }

    // Authored sequences own their complete input while active. Neural layers
    // may score future candidates but cannot mutate an in-flight sequence.
    if (this._stateMachine.isSequenceActive()) {
      return baseInput;
    }

    // 4. Tactical model: strategic decision enhancement
    if (this._tacticalModel) {
      const tactOutput = this._runTactical(this._tacticalHistory.stacked());
      if (tactOutput) {
        this._applyTactical(tactOutput, baseInput, state, currentState);
      }
    }

    // 5. Combat model: aim/fire refinement (only during FIGHT), about the same
    // enemy the stack was built about — the first in line of sight, else the
    // nearest, exactly as in training
    if (this._combatModel && currentState === BotState.FIGHT && inputs.combat) {
      const combatOutput = this._runCombat(this._combatHistory.stacked());
      if (combatOutput) {
        this._applyCombat(combatOutput, baseInput, state);
      }
    }

    return baseInput;
  }

  // ── Neural Inference ────────────────────────────────────────────

  /**
   * Run tactical model inference on a stacked input. Returns the outputs or null.
   */
  private _runTactical(stacked: number[]): Float32Array | null {
    try {
      const tf = getTF();
      return tf.tidy(() => {
        const tensor = tf.tensor2d([stacked]);
        const prediction = this._tacticalModel!.predict(tensor);
        return prediction.dataSync() as Float32Array;
      });
    } catch (e) {
      console.error("[HybridBrain] Tactical inference error:", e);
      return null;
    }
  }

  /**
   * Run combat model inference on a stacked input. Returns the outputs or null.
   */
  private _runCombat(stacked: number[]): Float32Array | null {
    try {
      const tf = getTF();
      return tf.tidy(() => {
        const tensor = tf.tensor2d([stacked]);
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
    if (
      output[TACT.MOVE_SLIDE] > THRESHOLD.MOVEMENT_ACTION &&
      canInitiateSlide(speed, true) &&
      (input.buttons & InputButtons.ALT_FIRE) === 0
    ) {
      input.buttons |= InputButtons.CROUCH | InputButtons.FORWARD | InputButtons.SPRINT;
    }

    // Jump suggestion
    if (output[TACT.MOVE_JUMP] > THRESHOLD.MOVEMENT_ACTION) {
      input.buttons |= InputButtons.JUMP;
    }

    // Weapon switch suggestion. The slot is decoded with the inverse of the
    // label it was trained on, so an output means the same weapon on both sides
    // of the network, and is taken only if the bot is carrying it.
    if (output[TACT.WEAPON_SWITCH] > THRESHOLD.WEAPON_SWITCH) {
      const slot = decodeWeaponSlot(output[TACT.WEAPON_SLOT]);
      if (slot >= 1 && slot <= state.self.weapons.length) {
        input.weaponSlot = slot;
      }
    }
  }

  /**
   * Apply combat model outputs to refine aim and fire decisions.
   */
  private _applyCombat(output: Float32Array, input: BotInput, state: BotGameState): void {
    const profile = getWeaponProfile(state.self.currentWeapon);
    const baseAltFireCharge =
      profile.hasChargedProjectile &&
      (input.buttons & InputButtons.ALT_FIRE) !== 0 &&
      (input.buttons & InputButtons.FIRE) === 0;

    // Fire control
    if (output[COMBAT.SHOULD_FIRE] > THRESHOLD.COMBAT_FIRE) {
      input.buttons |= InputButtons.FIRE;
    } else {
      input.buttons &= ~InputButtons.FIRE;
    }

    // ADS control. ALT_FIRE is allowed only as part of an attack: either firing
    // a ranged weapon or holding an existing charged alt-fire attack.
    const isFiring = (input.buttons & InputButtons.FIRE) !== 0;
    if (output[COMBAT.SHOULD_ADS] > THRESHOLD.COMBAT_ADS && (isFiring || baseAltFireCharge)) {
      input.buttons |= InputButtons.ALT_FIRE;
    } else if (!baseAltFireCharge) {
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
  /**
   * Keep a loaded model only if it takes the vector this build feeds it.
   *
   * Metadata catches most mismatches, but weights with none beside them still
   * load — and a model of the wrong width does not fail once, it throws on every
   * decision for the rest of the match. Checking the shape the weights declare
   * turns that into one refusal at load.
   */
  // biome-ignore lint/suspicious/noExplicitAny: tf.LayersModel, kept out of this module's field types
  private _acceptModel(model: any, expected: number, label: string, modelDir: string): any {
    const width = model?.inputs?.[0]?.shape?.[1];
    if (width === expected) return model;
    console.error(
      `[HybridBrain] Refusing the ${label} model in ${modelDir}: it takes ${width} inputs, this build feeds ${expected}`,
    );
    model?.dispose?.();
    return null;
  }

  private _warmup(): void {
    if (this._warmedUp) return;

    try {
      const tf = getTF();
      tf.tidy(() => {
        if (this._tacticalModel) {
          const dummyTact = tf.zeros([1, TACTICAL_MODEL_INPUT]);
          this._tacticalModel.predict(dummyTact);
        }
        if (this._combatModel) {
          const dummyCombat = tf.zeros([1, COMBAT_MODEL_INPUT]);
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
