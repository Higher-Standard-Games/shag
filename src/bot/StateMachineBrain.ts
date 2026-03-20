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
import { getWeaponProfile, selectBestWeapon, type WeaponProfile } from './BotWeaponProfile';
import type { BotNavGraph, NavPath } from './BotNavGraph';

// ── Constants ───────────────────────────────────────────────────────────

const LOW_HEALTH_THRESHOLD = 40;
const RETREAT_HEALTH_THRESHOLD = 25;
const FIGHT_RANGE = 2000;
const PICKUP_SEEK_RANGE = 1500;
const DODGE_REACT_TICKS = 30; // React to damage within last 30 ticks
const HUNT_DIRECTION_CHANGE_INTERVAL = 180; // Change hunt direction every ~3 sec at 60Hz

const MELEE_RANGE = 150;
const CLOSE_RANGE = 400;

// Feeler ray constants
const FEELER_FORWARD_DIST = 300;  // Forward ray distance
const FEELER_SIDE_DIST = 200;     // Side ray distance
const FEELER_SIDE_ANGLE = Math.PI / 6; // 30° offset for side rays
const FEELER_STEER_THRESHOLD = 0.6; // fraction below which we steer away

// Path following
const PATH_ARRIVED_THRESHOLD = 100; // Distance to consider "arrived" at a waypoint
const PATH_RECALC_INTERVAL = 120;   // Recalculate path every ~2 seconds

export class StateMachineBrain extends BotBrain {
    // ── Internal state ────────────────────────────────────────────────
    private _huntYaw: number = 0;
    private _huntTimer: number = 0;
    private _stateTimer: number = 0;

    // Movement variety
    private _strafeDirection: number = 1; // 1 or -1
    private _strafeTimer: number = 0;

    // Random look-around for human-feel
    private _lookAroundTimer: number = 0;
    private _lookAroundYaw: number = 0;

    // NavGraph pathfinding
    private _navGraph: BotNavGraph | null = null;
    private _currentPath: NavPath | null = null;
    private _pathTarget: Vec3 | null = null;
    private _pathRecalcTimer: number = 0;
    private _huntPatrolTarget: Vec3 | null = null; // Separate from _pathTarget to avoid confusion

    constructor(difficulty: BotDifficulty) {
        super(difficulty);
        this._huntYaw = Math.random() * Math.PI * 2;
    }

    // ── Main Decision Loop ────────────────────────────────────────────

    // Store last vision result for use across state methods
    private _lastVision: VisionResult | null = null;
    private _lastBotVision: BotVision | null = null;

    decide(
        state: BotGameState,
        vision?: BotVision | null,
        visionResult?: VisionResult | null,
        navGraph?: BotNavGraph | null,
    ): BotInput {
        this._stateTimer++;
        this._pathRecalcTimer++;
        this._lastVision = visionResult ?? null;
        this._lastBotVision = vision ?? null;
        this._navGraph = navGraph ?? null;

        // Dead → just wait (BotClient handles RequestSpawn)
        if (state.self.isDead) {
            this.currentState = BotState.SPAWN;
            this._currentPath = null; // Clear path on death
            this._huntPatrolTarget = null;
            // Clear vision cache on death
            if (vision) vision.clearCache();
            return this._noInput(state);
        }

        // Determine state based on priority
        const newState = this._evaluateState(state);
        if (newState !== this.currentState) {
            this.currentState = newState;
            this._stateTimer = 0;
            this._currentPath = null; // Clear path on state change
            this._huntPatrolTarget = null;
        }

        // Execute current state
        let input: BotInput;
        switch (this.currentState) {
            case BotState.FIGHT:
                input = this._executeFight(state);
                break;
            case BotState.CHASE:
                input = this._executeChase(state);
                break;
            case BotState.DODGE:
                input = this._executeDodge(state);
                break;
            case BotState.RETREAT:
                input = this._executeRetreat(state);
                break;
            case BotState.ITEM_RUN:
                input = this._executeItemRun(state);
                break;
            case BotState.HUNT:
                input = this._executeHunt(state);
                break;
            default:
                input = this._executeHunt(state);
                break;
        }

        // Apply feeler raycasts for wall avoidance (navigation states only)
        if (vision && this.currentState !== BotState.FIGHT && this.currentState !== BotState.DODGE) {
            input = this._applyFeelers(input, state, vision);
        }

        return input;
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
                    e => e.player.playerId === attacker
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

        // Priority 2.5: Lost sight of enemy but tracking them → chase!
        if (this._lastVision?.chaseTarget) {
            return BotState.CHASE;
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
        // Find strongest enemy (from vision or fallback)
        const enemy = this._lastVision?.visibleEnemies[0]?.player
            ?? state.getNearestEnemy();
        if (!enemy) {
            return this._executeHunt(state);
        }

        // Select best weapon for distance (profile-based)
        const { slot: weaponSlot } = selectBestWeapon(
            state.self.weapons, state.self.ammo, state.self.currentWeapon, enemy.distance,
        );

        // Get current weapon profile for ADS/behavior decisions
        const currentProfile = getWeaponProfile(state.self.currentWeapon);

        // Aim at enemy — use projectile prediction if needed
        const aim = currentProfile.isProjectile && currentProfile.projectileSpeed > 0
            ? this._aimAtTargetWithLead(state, enemy, currentProfile)
            : this._aimAtTarget(state, enemy);

        // Strafe while fighting
        this._updateStrafe();
        const strafeInput = this._strafeDirection;

        // Build buttons
        let buttons = 0;
        let wantsFire = false;

        // Only fire if we have ammo for current weapon
        const currentAmmo = state.self.ammo[state.self.currentWeapon];
        if (currentAmmo === undefined || currentAmmo > 0) {
            wantsFire = true;
        }

        // ── Weapon-aware combat behavior ───────────────────────────

        if (currentProfile.isMelee) {
            // MELEE: Rush forward, swing, no ADS
            if (enemy.distance < MELEE_RANGE && wantsFire) {
                buttons |= InputButtons.FIRE;
            }
            // Always rush toward enemy with melee
            buttons |= InputButtons.FORWARD;
            buttons |= InputButtons.SPRINT;
        } else {
            // RANGED COMBAT

            // ADS: Only when weapon needs it AND we're firing
            if (currentProfile.needsADS && wantsFire) {
                buttons |= InputButtons.ALT_FIRE; // ADS
            }

            // Fire
            if (wantsFire) {
                buttons |= InputButtons.FIRE;
            }

            // Movement based on range
            if (enemy.distance > CLOSE_RANGE) {
                buttons |= InputButtons.FORWARD; // Close distance
            } else if (enemy.distance < MELEE_RANGE && !currentProfile.isMelee) {
                buttons |= InputButtons.BACK; // Too close for ranged, back up
            }

            // Back up from splash weapons at close range (avoid self-damage)
            if (currentProfile.hasSplash && enemy.distance < 250) {
                buttons |= InputButtons.BACK;
                buttons &= ~InputButtons.FORWARD;
            }
        }

        // Always sprint — arena FPS players strafe-run by default
        buttons |= InputButtons.SPRINT;

        // Strafe (universal)
        if (strafeInput > 0) {
            buttons |= InputButtons.LEFT;
        } else {
            buttons |= InputButtons.RIGHT;
        }

        // Jump occasionally (dodge + human feel)
        // Low probability — JUMP persists across ~5 server ticks (125Hz/~25Hz input)
        if (Math.random() < 0.004 && state.self.isGrounded) {
            buttons |= InputButtons.JUMP;
        }

        // Movement direction
        let forwardZ = 0;
        if (currentProfile.isMelee) {
            forwardZ = 1; // Always rush forward with melee
        } else if (enemy.distance > CLOSE_RANGE) {
            forwardZ = 1;
        } else if (enemy.distance < MELEE_RANGE || (currentProfile.hasSplash && enemy.distance < 250)) {
            forwardZ = -1;
        }

        return {
            direction: { x: strafeInput * 0.5, y: 0, z: forwardZ },
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

        let buttons = InputButtons.JUMP | InputButtons.SPRINT; // Jump + sprint to dodge

        // Strafe hard
        if (this._strafeDirection > 0) {
            buttons |= InputButtons.LEFT;
        } else {
            buttons |= InputButtons.RIGHT;
        }
        buttons |= InputButtons.FORWARD;

        // Try to aim at nearest visible enemy while dodging
        const enemy = this._lastVision?.visibleEnemies[0]?.player
            ?? state.getNearestEnemy();
        let pitch = state.self.pitch;
        let yaw = state.self.yaw;

        if (enemy) {
            const aim = this._aimAtTarget(state, enemy);
            pitch = aim.pitch;
            yaw = aim.yaw;
            // Only fire if we have vision-confirmed LOS
            if (this._lastVision?.visibleEnemies.some(e => e.player.playerId === enemy.playerId)) {
                buttons |= InputButtons.FIRE;
            }
        }

        return {
            direction: { x: this._strafeDirection, y: 0, z: 1 },
            pitch,
            yaw,
            buttons,
            weaponSlot: 0,
        };
    }

    // ── CHASE State — Pursuit after LOS break ──────────────────────────

    private _executeChase(state: BotGameState): BotInput {
        const target = this._lastVision?.chaseTarget;
        if (!target) {
            // No target to chase — fall back to hunt
            return this._executeHunt(state);
        }

        // Move toward predicted (extrapolated) position using navGraph if available
        const input = this._navigateTo(state, target.predictedPosition, false);

        // Only pre-fire when very close to predicted position (near corners)
        const distToTarget = vec3Length(vec3Subtract(target.predictedPosition, state.self.position));
        if (distToTarget < 200 && target.confidence > 0.7) {
            input.buttons |= InputButtons.FIRE;
        }

        // Select appropriate weapon (use last known distance)
        const { slot: chaseSlot } = selectBestWeapon(
            state.self.weapons, state.self.ammo, state.self.currentWeapon, target.lastDistance,
        );
        if (chaseSlot > 0) {
            input.weaponSlot = chaseSlot;
        }

        return input;
    }

    // ── RETREAT State ─────────────────────────────────────────────────


    private _executeRetreat(state: BotGameState): BotInput {
        // Try NavGraph path to nearest health (cached via _navigateToItem)
        if (this._navGraph) {
            const result = this._navigateToItem(state, 'health', true);
            if (result) return result;
        }

        // Try vision's cover finding
        if (this._lastVision?.nearestCover) {
            return this._navigateTo(state, this._lastVision.nearestCover, true);
        }

        // Try nearest health item from BSP knowledge
        if (this._lastBotVision) {
            const healthPos = this._lastBotVision.findNearestItem(state.self.position, 'health');
            if (healthPos) {
                return this._navigateTo(state, healthPos, true);
            }
        }

        // Find nearest pickup (prefer health)
        const pickup = state.getNearestPickup(PICKUP_SEEK_RANGE);
        if (pickup) {
            return this._navigateTo(state, pickup.position, true);
        }

        // No pickup found → run away from nearest enemy
        const enemy = state.getNearestEnemy();
        if (enemy) {
            // Move away from enemy (guard against same-position producing zero-length vector)
            const rawDir = vec3Subtract(state.self.position, enemy.position);
            const len = vec3Length(rawDir);
            const awayDir = len > 0.01 ? vec3Normalize(rawDir) : { x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 };
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
        // Try NavGraph path to nearest item (weapon > health > armor > ammo)
        // Uses cached _navigateToItem to avoid A* every tick
        if (this._navGraph) {
            for (const itemType of ['weapon', 'health', 'armor', 'ammo']) {
                const result = this._navigateToItem(state, itemType, false);
                if (result) return result;
            }
        }

        // Prefer vision-verified reachable pickups
        if (this._lastVision) {
            const reachable = this._lastVision.pickups.find(p => p.isReachable);
            if (reachable) {
                return this._navigateTo(state, reachable.pickup.position, false);
            }
        }

        // Try BSP-known item positions
        if (this._lastBotVision) {
            const weaponPos = this._lastBotVision.findNearestItem(state.self.position, 'weapon');
            if (weaponPos) {
                return this._navigateTo(state, weaponPos, false);
            }
        }

        // Fallback to raw state pickups
        const pickup = state.getNearestPickup(PICKUP_SEEK_RANGE);
        if (pickup) {
            return this._navigateTo(state, pickup.position, false);
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
            return this._navigateTo(state, huntTarget, false);
        }

        // NavGraph patrol: pick a random nav node to walk toward
        if (this._navGraph) {
            const nodes = this._navGraph.nodes;
            if (nodes.length > 0 && (!this._huntPatrolTarget || this._pathRecalcTimer > PATH_RECALC_INTERVAL * 2)) {
                const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
                this._huntPatrolTarget = randomNode.position;
                this._pathRecalcTimer = 0;
            }
            if (this._huntPatrolTarget) {
                // Check if we've arrived at patrol target
                const distToPatrol = vec3Length(vec3Subtract(this._huntPatrolTarget, state.self.position));
                if (distToPatrol < PATH_ARRIVED_THRESHOLD) {
                    this._huntPatrolTarget = null; // Pick new target next tick
                    this._currentPath = null;
                } else {
                    return this._navigateTo(state, this._huntPatrolTarget, false);
                }
            }
        }

        // Fallback: random patrol — change direction periodically
        if (this._huntTimer > HUNT_DIRECTION_CHANGE_INTERVAL) {
            this._huntYaw += (Math.random() - 0.5) * Math.PI;
            this._huntTimer = 0;
        }

        // Look around randomly (human-feel)
        this._updateLookAround();

        let buttons = InputButtons.FORWARD | InputButtons.SPRINT;

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
        const perfectYaw = horizontalDist > 0.01 ? Math.atan2(delta.x, delta.z) : state.self.yaw;
        const perfectPitch = horizontalDist > 0.01 ? Math.atan2(delta.y, horizontalDist) : (delta.y > 0 ? Math.PI / 2 : -Math.PI / 2);

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

    /**
     * Aim at target with projectile lead prediction.
     * Uses the weapon's projectile speed to predict where the target will be.
     */
    private _aimAtTargetWithLead(state: BotGameState, target: VisiblePlayer, profile: WeaponProfile): { pitch: number; yaw: number } {
        // Estimate travel time: distance / projectileSpeed
        const travelTime = target.distance / (profile.projectileSpeed || 2500);

        // Predicted position = current position + velocity * travelTime
        const predicted: Vec3 = {
            x: target.position.x + (target.velocity?.x ?? 0) * travelTime,
            y: target.position.y + (target.velocity?.y ?? 0) * travelTime,
            z: target.position.z + (target.velocity?.z ?? 0) * travelTime,
        };

        // Splash weapons: aim slightly lower (toward feet)
        if (profile.hasSplash) {
            predicted.y -= 20;
        }

        // Calculate angles to predicted position
        const diff = vec3Subtract(predicted, state.self.position);
        const dist2D = Math.sqrt(diff.x * diff.x + diff.z * diff.z);

        const yaw = Math.atan2(diff.x, diff.z);
        const pitch = -Math.atan2(diff.y, dist2D);

        // Apply difficulty-based inaccuracy (matching _aimAtTarget)
        const inaccuracy = (1 - this.difficulty.aimAccuracy) * 0.15;
        const yawNoise = (Math.random() - 0.5) * inaccuracy;
        const pitchNoise = (Math.random() - 0.5) * inaccuracy;

        // Smooth aiming — tracking speed
        const maxTurnRate = this.difficulty.trackingSpeed * (1 / 60);
        const currentYaw = state.self.yaw;
        const currentPitch = state.self.pitch;

        let targetYaw = yaw + yawNoise;
        let targetPitch = pitch + pitchNoise;

        let yawDiff = targetYaw - currentYaw;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
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

    // ── Movement Helpers ──────────────────────────────────────────────

    /**
     * Navigate to a target position using NavGraph pathfinding when available.
     * Falls back to direct movement when no graph exists.
     */
    private _navigateTo(state: BotGameState, target: Vec3, urgent: boolean): BotInput {
        if (!this._navGraph) {
            return this._moveToward(state, target, urgent);
        }

        // Recalculate path periodically or if target changed significantly
        const targetChanged = !this._pathTarget ||
            vec3Length(vec3Subtract(target, this._pathTarget)) > 200;

        if (targetChanged || !this._currentPath || this._pathRecalcTimer > PATH_RECALC_INTERVAL) {
            this._currentPath = this._navGraph.findPath(state.self.position, target);
            this._pathTarget = target;
            this._pathRecalcTimer = 0;
        }

        // If path found, follow waypoints
        if (this._currentPath) {
            const waypoint = this._navGraph.getNextWaypoint(
                state.self.position, this._currentPath, PATH_ARRIVED_THRESHOLD,
            );
            if (waypoint) {
                return this._moveToward(state, waypoint.position, urgent);
            }
            // Path complete — clear it
            this._currentPath = null;
        }

        // No path found — fall back to direct movement
        return this._moveToward(state, target, urgent);
    }

    /**
     * Navigate to nearest item of a given type using NavGraph.
     * Caches the path to avoid running A* every tick.
     * Returns null if no path to item found.
     */
    private _navigateToItem(state: BotGameState, itemType: string, urgent: boolean): BotInput | null {
        if (!this._navGraph) return null;

        // Only recalculate item paths periodically
        if (!this._currentPath || this._pathRecalcTimer > PATH_RECALC_INTERVAL) {
            const itemPath = this._navGraph.findPathToItem(state.self.position, itemType);
            if (!itemPath) return null;
            this._currentPath = itemPath;
            this._pathTarget = itemPath.nodes[itemPath.nodes.length - 1]?.position ?? null;
            this._pathRecalcTimer = 0;
        }

        if (this._currentPath) {
            const waypoint = this._navGraph.getNextWaypoint(
                state.self.position, this._currentPath, PATH_ARRIVED_THRESHOLD,
            );
            if (waypoint) {
                return this._moveToward(state, waypoint.position, urgent);
            }
            // Arrived at item — clear path
            this._currentPath = null;
        }

        return null;
    }

    /**
     * Direct movement toward a target position.
     * Low-level: walk/sprint/jump toward point.
     *
     * NOTE: Server ticks at 125Hz but bot sends input at 12-33Hz.
     * Last input PERSISTS across ~4-10 server ticks. This means:
     * - JUMP stays pressed for many physics ticks → autohop triggers on landing
     * - Button flags like LEFT/RIGHT must be set alongside direction.x
     *   for the server's strafejump air acceleration to activate
     */
    private _moveToward(state: BotGameState, target: Vec3, urgent: boolean): BotInput {
        const delta = vec3Subtract(target, state.self.position);
        const distance = vec3Length(delta);
        const targetYaw = Math.atan2(delta.x, delta.z);

        // NEVER send zero direction — it persists on the server for 30-80ms
        // causing friction to decelerate the bot to 0 across multiple physics ticks.
        // Even if very close, keep moving forward.

        // Always sprint + forward — arena FPS bots strafe-run by default
        let buttons = InputButtons.FORWARD | InputButtons.SPRINT;

        // Jump — low probability because JUMP persists across 4-10 server ticks
        // (each bot input = ~4-10 physics frames). 0.3% × ~7 ticks ≈ 2% effective.
        if (Math.random() < 0.003 && state.self.isGrounded) {
            buttons |= InputButtons.JUMP;
        }

        // Strafe direction (for dodge/variety). When urgent, add slight strafe
        let strafeX = 0;
        if (urgent && distance > 200) {
            strafeX = this._strafeDirection * 0.3;
            // Set LEFT/RIGHT button flags — critical for server air-strafe physics
            if (strafeX < 0) buttons |= InputButtons.LEFT;
            if (strafeX > 0) buttons |= InputButtons.RIGHT;
        }

        return {
            direction: { x: strafeX, y: 0, z: 1 },
            pitch: 0,
            yaw: targetYaw,
            buttons,
            weaponSlot: 0,
        };
    }

    // ── Feeler Raycasts (Wall Avoidance) ──────────────────────────────

    /**
     * Cast 3 rays from bot position to detect nearby walls.
     * If a wall is detected, steer the bot away from it.
     * Runs after brain decision — adjusts heading, doesn't override state.
     */
    private _applyFeelers(input: BotInput, state: BotGameState, vision: BotVision): BotInput {
        const pos = state.self.position;
        const yaw = input.yaw;
        const cw = vision.collisionWorld;

        // Eye height offset
        const eyePos = { x: pos.x, y: pos.y + 36, z: pos.z };

        // Forward ray
        const fwdEnd = {
            x: eyePos.x + Math.sin(yaw) * FEELER_FORWARD_DIST,
            y: eyePos.y,
            z: eyePos.z + Math.cos(yaw) * FEELER_FORWARD_DIST,
        };
        const fwdResult = cw.trace(eyePos, fwdEnd);

        // Forward-left ray (yaw - 30°)
        const leftYaw = yaw - FEELER_SIDE_ANGLE;
        const leftEnd = {
            x: eyePos.x + Math.sin(leftYaw) * FEELER_SIDE_DIST,
            y: eyePos.y,
            z: eyePos.z + Math.cos(leftYaw) * FEELER_SIDE_DIST,
        };
        const leftResult = cw.trace(eyePos, leftEnd);

        // Forward-right ray (yaw + 30°)
        const rightYaw = yaw + FEELER_SIDE_ANGLE;
        const rightEnd = {
            x: eyePos.x + Math.sin(rightYaw) * FEELER_SIDE_DIST,
            y: eyePos.y,
            z: eyePos.z + Math.cos(rightYaw) * FEELER_SIDE_DIST,
        };
        const rightResult = cw.trace(eyePos, rightEnd);

        // Determine steering adjustment
        let yawAdjust = 0;
        const fwdBlocked = fwdResult.hit && fwdResult.fraction < FEELER_STEER_THRESHOLD;
        const leftBlocked = leftResult.hit && leftResult.fraction < FEELER_STEER_THRESHOLD;
        const rightBlocked = rightResult.hit && rightResult.fraction < FEELER_STEER_THRESHOLD;

        if (fwdBlocked) {
            // Wall directly ahead — steer toward open side
            if (leftBlocked && !rightBlocked) {
                yawAdjust = 0.5; // Turn right
            } else if (rightBlocked && !leftBlocked) {
                yawAdjust = -0.5; // Turn left
            } else if (leftBlocked && rightBlocked) {
                // Walled in on all sides — turn hard (pick random side)
                yawAdjust = this._strafeDirection > 0 ? 1.2 : -1.2;
            } else {
                // Forward blocked but sides open — steer toward more open side
                const leftDist = leftResult.fraction;
                const rightDist = rightResult.fraction;
                yawAdjust = leftDist > rightDist ? -0.4 : 0.4;
            }

            // Jump to get over short obstacles (only if not already jumping)
            if (state.self.isGrounded && !(input.buttons & InputButtons.JUMP)) {
                input.buttons |= InputButtons.JUMP;
            }

            // Apply strafe buttons matching the yaw adjustment
            // so server physics responds to the direction change
            if (yawAdjust > 0) {
                input.buttons |= InputButtons.RIGHT;
                input.buttons &= ~InputButtons.LEFT;
            } else if (yawAdjust < 0) {
                input.buttons |= InputButtons.LEFT;
                input.buttons &= ~InputButtons.RIGHT;
            }
        } else if (leftBlocked && !rightBlocked) {
            yawAdjust = 0.2; // Gentle right
        } else if (rightBlocked && !leftBlocked) {
            yawAdjust = -0.2; // Gentle left
        }

        if (yawAdjust !== 0) {
            input.yaw += yawAdjust;
        }

        return input;
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
        // - Health below 50
        // - Low armor
        if (state.self.health < 50) return true;
        if (state.self.armor < 25) return true;

        // Check ammo
        const currentAmmo = state.self.ammo[state.self.currentWeapon];
        if (currentAmmo !== undefined && currentAmmo < 3) return true;

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
