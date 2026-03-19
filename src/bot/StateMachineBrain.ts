/**
 * StateMachineBrain - Phase 1 rule-based AI
 *
 * Priority-based state machine for bot decision making:
 *   1. DEAD?       → Wait, then request respawn
 *   2. Being shot? → FIGHT (engage attacker) or DODGE
 *   3. Enemy LOS   → FIGHT (aim + shoot)
 *   4. Low health  → RETREAT (find health pickups)
 *   5. Need items  → ITEM_RUN (navigate to pickups)
 *   6. Default     → HUNT (patrol/seek enemies)
 *
 * Uses difficulty settings to control aim accuracy, reaction time,
 * prediction skill, and other human-feel parameters.
 */

import { BotBrain, BotState, type BotInput } from './BotBrain';
import type { BotGameState, VisiblePlayer, Vec3 } from './BotGameState';
import { vec3Subtract, vec3Normalize, vec3Length } from './BotGameState';
import { InputButtons, type BotDifficulty } from './BotConfig';
import type { BotVision, VisionResult } from './BotVision';

// ── Constants ───────────────────────────────────────────────────────────

const LOW_HEALTH_THRESHOLD = 40;
const RETREAT_HEALTH_THRESHOLD = 25;
const FIGHT_RANGE = 2000;
const PICKUP_SEEK_RANGE = 1500;
const DODGE_REACT_TICKS = 30; // React to damage within last 30 ticks
const HUNT_DIRECTION_CHANGE_INTERVAL = 180; // Change hunt direction every ~3 sec at 60Hz

// Weapon slot preferences by distance range
// Slot indices are 1-based as sent in weaponSlot field
const WEAPON_PREFERENCE = {
    close: ['riotgun', 'plasmagun', 'rocketlauncher'],
    medium: ['plasmagun', 'rocketlauncher', 'riotgun'],
    long: ['electrobolt', 'rocketlauncher', 'plasmagun'],
};

export class StateMachineBrain extends BotBrain {
    // ── Internal state ────────────────────────────────────────────────
    private _huntYaw: number = 0;
    private _huntTimer: number = 0;
    private _stateTimer: number = 0;
    // Reserved for future reaction delay system
    private _lastDecisionTick = 0; // eslint-disable-line
    private _reactionDelay = 0; // eslint-disable-line
    private _pendingReaction: { target: VisiblePlayer; startTick: number } | null = null; // eslint-disable-line

    // Movement variety
    private _strafeDirection: number = 1; // 1 or -1
    private _strafeTimer: number = 0;

    // Random look-around for human-feel
    private _lookAroundTimer: number = 0;
    private _lookAroundYaw: number = 0;

    constructor(difficulty: BotDifficulty) {
        super(difficulty);
        this._huntYaw = Math.random() * Math.PI * 2;
        this._reactionDelay = this.difficulty.reactionTimeMs;
    }

    // ── Main Decision Loop ────────────────────────────────────────────

    // Store last vision result for use across state methods
    private _lastVision: VisionResult | null = null;
    private _lastBotVision: BotVision | null = null;

    decide(state: BotGameState, vision?: BotVision | null, visionResult?: VisionResult | null): BotInput {
        this._stateTimer++;
        this._lastVision = visionResult ?? null;
        this._lastBotVision = vision ?? null;

        // Dead → just wait (BotClient handles RequestSpawn)
        if (state.self.isDead) {
            this.currentState = BotState.SPAWN;
            // Clear vision cache on death
            if (vision) vision.clearCache();
            return this._noInput(state);
        }

        // Determine state based on priority
        const newState = this._evaluateState(state);
        if (newState !== this.currentState) {
            this.currentState = newState;
            this._stateTimer = 0;
        }

        // Execute current state
        switch (this.currentState) {
            case BotState.FIGHT:
                return this._executeFight(state);
            case BotState.DODGE:
                return this._executeDodge(state);
            case BotState.RETREAT:
                return this._executeRetreat(state);
            case BotState.ITEM_RUN:
                return this._executeItemRun(state);
            case BotState.HUNT:
                return this._executeHunt(state);
            default:
                return this._executeHunt(state);
        }
    }

    // ── State Evaluation ──────────────────────────────────────────────

    private _evaluateState(state: BotGameState): BotState {
        const recentlyDamaged = state.wasRecentlyDamaged(DODGE_REACT_TICKS);

        // Use vision data if available, otherwise fall back to raw state
        const hasVisibleEnemy = this._lastVision
            ? this._lastVision.visibleEnemies.length > 0
            : (state.getNearestEnemy() !== null);

        const nearestVisibleEnemy = this._lastVision
            ? this._lastVision.visibleEnemies[0]?.player ?? null
            : state.getNearestEnemy();

        // Priority 1: Being shot at → engage or dodge
        if (recentlyDamaged) {
            const attacker = state.getLastAttacker();
            if (attacker && this._lastVision) {
                // Can we actually SEE the attacker? (LOS check via vision)
                const attackerVisible = this._lastVision.visibleEnemies.find(
                    e => e.player.entityId === attacker
                );
                if (attackerVisible) {
                    return BotState.FIGHT;
                }
            } else if (attacker && nearestVisibleEnemy) {
                // No vision → fallback: assume nearest enemy is attacker
                return BotState.FIGHT;
            }
            // Can't see attacker → dodge/retreat
            if (state.self.health < RETREAT_HEALTH_THRESHOLD) {
                return BotState.RETREAT;
            }
            return BotState.DODGE;
        }

        // Priority 2: Enemy visible → fight
        if (hasVisibleEnemy && nearestVisibleEnemy && nearestVisibleEnemy.distance < FIGHT_RANGE) {
            return BotState.FIGHT;
        }

        // Priority 3: Low health → retreat to find health
        if (state.self.health < LOW_HEALTH_THRESHOLD) {
            const hasPickup = state.getNearestPickup(PICKUP_SEEK_RANGE);
            if (hasPickup) {
                return BotState.RETREAT;
            }
        }

        // Priority 4: Need items → go get them
        if (this._shouldSeekItems(state)) {
            return BotState.ITEM_RUN;
        }

        // Default: Hunt for enemies
        return BotState.HUNT;
    }

    // ── FIGHT State ───────────────────────────────────────────────────

    private _executeFight(state: BotGameState): BotInput {
        // Prefer vision-verified visible enemy, fall back to raw state
        const enemy = this._lastVision?.visibleEnemies[0]?.player
            ?? state.getNearestEnemy();
        if (!enemy) {
            return this._executeHunt(state);
        }

        // Aim at enemy with prediction
        const aim = this._aimAtTarget(state, enemy);

        // Select best weapon for distance
        const weaponSlot = this._selectWeaponForDistance(state, enemy.distance);

        // Strafe while fighting
        this._updateStrafe();
        const strafeInput = this._strafeDirection;

        // Build buttons
        let buttons = InputButtons.FIRE; // Always shoot when fighting

        // Add movement
        if (enemy.distance > 300) {
            buttons |= InputButtons.FORWARD; // Close distance
        }
        if (enemy.distance < 150) {
            buttons |= InputButtons.BACK; // Too close, back up
        }

        // Strafe
        if (strafeInput > 0) {
            buttons |= InputButtons.LEFT;
        } else {
            buttons |= InputButtons.RIGHT;
        }

        // Jump occasionally (dodge + human feel)
        if (Math.random() < 0.02 && state.self.isGrounded) {
            buttons |= InputButtons.JUMP;
        }

        return {
            direction: { x: strafeInput * 0.5, y: 0, z: enemy.distance > 300 ? 1 : (enemy.distance < 150 ? -1 : 0) },
            pitch: aim.pitch,
            yaw: aim.yaw,
            buttons,
            weaponSlot,
        };
    }

    // ── DODGE State ───────────────────────────────────────────────────

    private _executeDodge(state: BotGameState): BotInput {
        // Pick a random direction and move quickly
        this._updateStrafe();

        let buttons = InputButtons.JUMP; // Jump to dodge

        // Strafe hard
        if (this._strafeDirection > 0) {
            buttons |= InputButtons.LEFT;
        } else {
            buttons |= InputButtons.RIGHT;
        }
        buttons |= InputButtons.FORWARD;

        // Try to aim at nearest enemy while dodging
        const enemy = state.getNearestEnemy();
        let pitch = state.self.pitch;
        let yaw = state.self.yaw;

        if (enemy) {
            const aim = this._aimAtTarget(state, enemy);
            pitch = aim.pitch;
            yaw = aim.yaw;
            buttons |= InputButtons.FIRE;
        }

        return {
            direction: { x: this._strafeDirection, y: 0, z: 1 },
            pitch,
            yaw,
            buttons,
            weaponSlot: 0,
        };
    }

    // ── RETREAT State ─────────────────────────────────────────────────

    private _executeRetreat(state: BotGameState): BotInput {
        // Try vision's cover finding first
        if (this._lastVision?.nearestCover) {
            return this._moveToward(state, this._lastVision.nearestCover, true);
        }

        // Try nearest health item from BSP knowledge
        if (this._lastBotVision) {
            const healthPos = this._lastBotVision.findNearestItem(state.self.position, 'health');
            if (healthPos) {
                return this._moveToward(state, healthPos, true);
            }
        }

        // Find nearest pickup (prefer health)
        const pickup = state.getNearestPickup(PICKUP_SEEK_RANGE);
        if (pickup) {
            return this._moveToward(state, pickup.position, true);
        }

        // No pickup found → run away from nearest enemy
        const enemy = state.getNearestEnemy();
        if (enemy) {
            // Move away from enemy
            const awayDir = vec3Normalize(vec3Subtract(state.self.position, enemy.position));
            const targetYaw = Math.atan2(awayDir.x, awayDir.z);

            return {
                direction: { x: 0, y: 0, z: 1 },
                pitch: 0,
                yaw: targetYaw,
                buttons: InputButtons.FORWARD | InputButtons.SPRINT,
                weaponSlot: 0,
            };
        }

        // No enemy to run from → hunt
        return this._executeHunt(state);
    }

    // ── ITEM_RUN State ────────────────────────────────────────────────

    private _executeItemRun(state: BotGameState): BotInput {
        // Prefer vision-verified reachable pickups
        if (this._lastVision) {
            const reachable = this._lastVision.pickups.find(p => p.isReachable);
            if (reachable) {
                return this._moveToward(state, reachable.pickup.position, false);
            }
        }

        // Try BSP-known item positions
        if (this._lastBotVision) {
            const weaponPos = this._lastBotVision.findNearestItem(state.self.position, 'weapon');
            if (weaponPos) {
                return this._moveToward(state, weaponPos, false);
            }
        }

        // Fallback to raw state pickups
        const pickup = state.getNearestPickup(PICKUP_SEEK_RANGE);
        if (pickup) {
            return this._moveToward(state, pickup.position, false);
        }

        // No pickups found → hunt
        return this._executeHunt(state);
    }

    // ── HUNT State ────────────────────────────────────────────────────

    private _executeHunt(state: BotGameState): BotInput {
        this._huntTimer++;

        // Check if we know a last enemy position to investigate
        const huntTarget = this._getHuntTarget(state);
        if (huntTarget) {
            return this._moveToward(state, huntTarget, false);
        }

        // Random patrol — change direction periodically
        if (this._huntTimer > HUNT_DIRECTION_CHANGE_INTERVAL) {
            this._huntYaw += (Math.random() - 0.5) * Math.PI;
            this._huntTimer = 0;
        }

        // Look around randomly (human-feel)
        this._updateLookAround();

        let buttons = InputButtons.FORWARD;

        // Jump occasionally
        if (Math.random() < 0.01 && state.self.isGrounded) {
            buttons |= InputButtons.JUMP;
        }

        return {
            direction: { x: 0, y: 0, z: 1 },
            pitch: 0,
            yaw: this._huntYaw + this._lookAroundYaw,
            buttons,
            weaponSlot: 0,
        };
    }

    // ── Aiming ────────────────────────────────────────────────────────

    private _aimAtTarget(state: BotGameState, target: VisiblePlayer): { pitch: number; yaw: number } {
        let targetPos = { ...target.position };

        // Predict target position based on velocity (for projectile weapons)
        if (this.difficulty.predictionSkill > 0) {
            const prediction = this._predictTargetPosition(state, target);
            targetPos = prediction;
        }

        // Calculate aim angles
        const delta = vec3Subtract(targetPos, state.self.position);
        const horizontalDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
        const perfectYaw = Math.atan2(delta.x, delta.z);
        const perfectPitch = Math.atan2(delta.y, horizontalDist);

        // Add inaccuracy based on difficulty
        const inaccuracy = (1 - this.difficulty.aimAccuracy) * 0.15;
        const yawNoise = (Math.random() - 0.5) * inaccuracy;
        const pitchNoise = (Math.random() - 0.5) * inaccuracy;

        // Smooth aiming — don't snap instantly (tracking speed)
        const maxTurnRate = this.difficulty.trackingSpeed * (1 / 60); // per tick at 60Hz
        const currentYaw = state.self.yaw;
        const currentPitch = state.self.pitch;

        let targetYaw = perfectYaw + yawNoise;
        let targetPitch = perfectPitch + pitchNoise;

        // Wrap yaw difference to [-PI, PI]
        let yawDiff = targetYaw - currentYaw;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

        // Clamp turn rate
        if (Math.abs(yawDiff) > maxTurnRate) {
            yawDiff = Math.sign(yawDiff) * maxTurnRate;
        }

        let pitchDiff = targetPitch - currentPitch;
        if (Math.abs(pitchDiff) > maxTurnRate) {
            pitchDiff = Math.sign(pitchDiff) * maxTurnRate;
        }

        return {
            yaw: currentYaw + yawDiff,
            pitch: currentPitch + pitchDiff,
        };
    }

    private _predictTargetPosition(_state: BotGameState, target: VisiblePlayer): Vec3 {
        // Estimate projectile travel time
        const distance = target.distance;
        const estimatedProjectileSpeed = 1400; // rough average projectile speed
        const travelTime = distance / estimatedProjectileSpeed;

        // Apply prediction with skill factor
        const predFactor = this.difficulty.predictionSkill * travelTime;

        return {
            x: target.position.x + target.velocity.x * predFactor,
            y: target.position.y + target.velocity.y * predFactor,
            z: target.position.z + target.velocity.z * predFactor,
        };
    }

    // ── Weapon Selection ──────────────────────────────────────────────

    private _selectWeaponForDistance(state: BotGameState, distance: number): number {
        // Determine range category
        let prefs: string[];
        if (distance < 300) {
            prefs = WEAPON_PREFERENCE.close;
        } else if (distance < 800) {
            prefs = WEAPON_PREFERENCE.medium;
        } else {
            prefs = WEAPON_PREFERENCE.long;
        }

        // Find best available weapon
        for (const weaponName of prefs) {
            const slotIndex = state.self.weapons.indexOf(weaponName);
            if (slotIndex >= 0) {
                // Check if we have ammo
                const ammo = state.self.ammo[weaponName];
                if (ammo === undefined || ammo > 0) {
                    const slot = slotIndex + 1; // 1-indexed
                    // Only switch if not already on this weapon
                    if (state.self.currentWeapon !== weaponName) {
                        return slot;
                    }
                    return 0; // Already on best weapon
                }
            }
        }

        return 0; // Keep current weapon
    }

    // ── Movement Helpers ──────────────────────────────────────────────

    private _moveToward(state: BotGameState, target: Vec3, urgent: boolean): BotInput {
        const delta = vec3Subtract(target, state.self.position);
        const distance = vec3Length(delta);
        const targetYaw = Math.atan2(delta.x, delta.z);

        let buttons = InputButtons.FORWARD;

        if (urgent) {
            buttons |= InputButtons.SPRINT;
        }

        // Jump to get over obstacles
        if (Math.random() < 0.015 && state.self.isGrounded) {
            buttons |= InputButtons.JUMP;
        }

        // If close enough, stop
        if (distance < 50) {
            buttons = 0;
        }

        return {
            direction: { x: 0, y: 0, z: distance > 50 ? 1 : 0 },
            pitch: 0,
            yaw: targetYaw,
            buttons,
            weaponSlot: 0,
        };
    }

    private _updateStrafe(): void {
        this._strafeTimer++;
        if (this._strafeTimer > 30 + Math.random() * 40) {
            this._strafeDirection *= -1; // Flip strafe direction
            this._strafeTimer = 0;
        }
    }

    private _updateLookAround(): void {
        this._lookAroundTimer++;
        const interval = this.difficulty.lookAroundInterval * 60; // Convert seconds to ticks
        if (this._lookAroundTimer > interval) {
            this._lookAroundYaw = (Math.random() - 0.5) * 0.5; // Small random look
            this._lookAroundTimer = 0;
        }
    }

    // ── Decision Helpers ──────────────────────────────────────────────

    private _shouldSeekItems(state: BotGameState): boolean {
        // Seek items if:
        // - Low on ammo for current weapon
        // - Missing key weapons
        // - Health below 80
        // - No armor
        if (state.self.health < 80) return true;
        if (state.self.armor < 50) return true;

        // Check ammo
        const currentAmmo = state.self.ammo[state.self.currentWeapon];
        if (currentAmmo !== undefined && currentAmmo < 5) return true;

        return false;
    }

    private _getHuntTarget(state: BotGameState): Vec3 | null {
        // Go to last known enemy position (if recent)
        let bestTarget: Vec3 | null = null;
        let bestTick = 0;

        for (const [, data] of state.lastKnownEnemyPositions) {
            if (data.tick > bestTick && state.tick - data.tick < 300) {
                bestTick = data.tick;
                bestTarget = data.position;
            }
        }

        return bestTarget;
    }

    private _noInput(_state: BotGameState): BotInput {
        return {
            direction: { x: 0, y: 0, z: 0 },
            pitch: _state.self.pitch,
            yaw: _state.self.yaw,
            buttons: 0,
            weaponSlot: 0,
        };
    }
}
