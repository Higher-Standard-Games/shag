/**
 * BotVision — Spatial awareness system for bots
 *
 * This is the bot's "eyes" — it bridges raw server data (BotGameState)
 * and intelligent decision-making (BotBrain). Uses BSP collision data
 * to determine line-of-sight, find cover, check walkability, and
 * maintain map knowledge.
 *
 * Architecture:
 *   Server Snapshot → BotGameState (raw data) → BotVision (LOS + spatial) → BotBrain (decisions)
 *
 * BotVision instances are cached per map — all bots on the same map
 * share the same collision world and map knowledge.
 */

import type { CollisionWorld, AABB } from '../engine/network/systems/collision/CollisionWorld';
import type { Vec3 } from '../shared/bsp/BspDataLoader';
import type { BotGameState, VisiblePlayer, VisiblePickup } from './BotGameState';
import { vec3Subtract, vec3Normalize, vec3Add, vec3Scale, vec3Distance } from './BotGameState';

// ── Vision Result Types ─────────────────────────────────────────────────

export interface VisionEnemy {
    /** The player data from BotGameState */
    player: VisiblePlayer;
    /** True if bot has clear line-of-sight to this enemy */
    isVisible: boolean;
    /** True if enemy fired recently (bot "heard" them) */
    isAudible: boolean;
    /** Angle from bot's forward direction to enemy (radians) */
    relativeAngle: number;
}

export interface VisionPickup {
    /** The pickup data from BotGameState */
    pickup: VisiblePickup;
    /** True if bot has clear line-of-sight to this pickup */
    isVisible: boolean;
    /** True if path to pickup is walkable (no walls blocking ground path) */
    isReachable: boolean;
}

export interface VisionResult {
    /** Enemies the bot can actually see (LOS clear) */
    visibleEnemies: VisionEnemy[];
    /** Enemies the bot heard (recent weapon fire) but can't see */
    audibleEnemies: VisionEnemy[];
    /** All enemies sorted by relevance (visible first, then audible) */
    allKnownEnemies: VisionEnemy[];
    /** Pickups with visibility and reachability info */
    pickups: VisionPickup[];
    /** Nearest cover position from the primary threat */
    nearestCover: Vec3 | null;
    /** Enemies we lost sight of but are tracking mentally ("phantoms") */
    trackedEnemies: EnemyTrack[];
    /** Highest-priority chase target (recently visible, now behind cover) */
    chaseTarget: EnemyTrack | null;
    /** Number of LOS traces performed this tick */
    tracesPerformed: number;
}

// ── Enemy Memory / Phantom Tracking ─────────────────────────────────────

export interface EnemyTrack {
    /** Player ID being tracked */
    playerId: string;
    /** Entity ID (for matching with snapshot data) */
    entityId: string;
    /** Last confirmed position (where we actually saw/heard them) */
    lastSeenPosition: Vec3;
    /** Their velocity at last observation */
    lastSeenVelocity: Vec3;
    /** Tick when we last had confirmed data */
    lastSeenTick: number;
    /** Extrapolated current position (predicted) */
    predictedPosition: Vec3;
    /** Confidence: 1.0 = just seen, decays toward 0.0 */
    confidence: number;
    /** How we know about them */
    source: 'visual' | 'sound' | 'damage';
    /** Distance from bot at last observation */
    lastDistance: number;
}

// ── Map Knowledge ───────────────────────────────────────────────────────

export interface MapKnowledgeData {
    /** Spawn point positions from BSP entities */
    spawnPoints: Vec3[];
    /** Item/weapon pickup positions from BSP entities */
    pickupPositions: Array<{ classname: string; position: Vec3 }>;
    /** Map name */
    mapName: string;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Eye height offset from entity position (player camera height) */
const EYE_HEIGHT = 32;

/** Max traces per tick to keep performance bounded */
const MAX_TRACES_PER_TICK = 12;

/** Max enemies to check LOS against per tick */
const MAX_ENEMY_LOS_CHECKS = 5;

/** Max pickups to check LOS/reachability per tick */
const MAX_PICKUP_CHECKS = 4;

/** Number of directions to sample when searching for cover */
const COVER_SEARCH_RAYS = 8;

/** Max distance to search for cover */
const COVER_SEARCH_DISTANCE = 500;

/** How far behind cover to position (units behind the wall) */
const COVER_OFFSET = 50;

/** Player bounding box for walkability checks */
const PLAYER_BOUNDS: AABB = {
    min: { x: -16, y: 0, z: -16 },
    max: { x: 16, y: 64, z: 16 },
};

/** Ticks to consider weapon fire as "audible" */
const AUDIBLE_FIRE_TICKS = 120; // ~2 seconds at 60Hz

// ── Enemy Memory Constants ──────────────────────────────────────────────

/** Max ticks to extrapolate enemy position (3 seconds at 60Hz) */
const MAX_EXTRAPOLATION_TICKS = 180;

/** Ticks until visual track confidence reaches 0 (~4 seconds at 60Hz) */
const VISUAL_TRACK_DECAY_TICKS = 240;

/** Ticks until sound track confidence reaches 0 (~2.5 seconds) */
const SOUND_TRACK_DECAY_TICKS = 150;

/** Initial confidence for sound-based tracks (less certain than visual) */
const SOUND_CONFIDENCE = 0.6;

/** Initial confidence for damage-based tracks (we KNOW they hit us) */
const DAMAGE_CONFIDENCE = 0.8;

/** Minimum confidence to consider a track actionable for chasing */
const CHASE_CONFIDENCE_THRESHOLD = 0.3;

/** Max number of enemy tracks to maintain */
const MAX_ENEMY_TRACKS = 8;

// ── BotVision Class ─────────────────────────────────────────────────────

export class BotVision {
    private _collisionWorld: CollisionWorld;
    private _mapKnowledge: MapKnowledgeData;

    // LOS cache: entityId → { visible: boolean, tick: number }
    private _losCache: Map<string, { visible: boolean; tick: number }> = new Map();
    private _losCacheTTL: number = 3; // Cache LOS results for 3 ticks

    // Enemy memory: playerId → EnemyTrack (persists across ticks)
    private _enemyTracks: Map<string, EnemyTrack> = new Map();

    constructor(collisionWorld: CollisionWorld, mapKnowledge: MapKnowledgeData) {
        this._collisionWorld = collisionWorld;
        this._mapKnowledge = mapKnowledge;

        console.log(`[BotVision] Initialized for map "${mapKnowledge.mapName}"`);
        console.log(`[BotVision] ${mapKnowledge.spawnPoints.length} spawn points, ${mapKnowledge.pickupPositions.length} pickup locations`);
    }

    // ── Accessors ────────────────────────────────────────────────────────

    get mapKnowledge(): MapKnowledgeData {
        return this._mapKnowledge;
    }

    get collisionWorld(): CollisionWorld {
        return this._collisionWorld;
    }

    // ── Core LOS Check ──────────────────────────────────────────────────

    /**
     * Check if there is clear line-of-sight between two points.
     * Uses a zero-radius trace (pure raycast) through BSP geometry.
     *
     * @param from - Origin point (typically bot eye position)
     * @param to - Target point
     * @returns true if no geometry blocks the view
     */
    canSee(from: Vec3, to: Vec3): boolean {
        const result = this._collisionWorld.trace(from, to);
        // fraction === 1 means the trace went the full distance without hitting anything
        return !result.hit;
    }

    /**
     * Check LOS from bot's eye position to a target position.
     * Adds eye height offset to the bot's position.
     */
    canSeeFrom(botPos: Vec3, targetPos: Vec3): boolean {
        const eyePos: Vec3 = { x: botPos.x, y: botPos.y + EYE_HEIGHT, z: botPos.z };
        // Target at their approximate center mass (half height)
        const targetCenter: Vec3 = { x: targetPos.x, y: targetPos.y + EYE_HEIGHT * 0.8, z: targetPos.z };
        return this.canSee(eyePos, targetCenter);
    }

    // ── Vision Query (Main API) ─────────────────────────────────────────

    /**
     * Process BotGameState through spatial awareness.
     * Filters players/pickups by LOS and enriches with spatial data.
     *
     * Performance-bounded: limits traces per tick.
     */
    getVisibleState(state: BotGameState): VisionResult {
        let tracesPerformed = 0;
        const visibleEnemies: VisionEnemy[] = [];
        const audibleEnemies: VisionEnemy[] = [];

        // ── Check LOS to enemies (nearest first, capped) ──────────────
        const enemyCheckCount = Math.min(state.players.length, MAX_ENEMY_LOS_CHECKS);

        for (let i = 0; i < enemyCheckCount && tracesPerformed < MAX_TRACES_PER_TICK; i++) {
            const player = state.players[i];
            if (player.isDead) continue;

            // Check LOS cache
            const cached = this._losCache.get(player.entityId);
            let isVisible: boolean;

            if (cached && state.tick - cached.tick < this._losCacheTTL) {
                isVisible = cached.visible;
            } else {
                isVisible = this.canSeeFrom(state.self.position, player.position);
                this._losCache.set(player.entityId, { visible: isVisible, tick: state.tick });
                tracesPerformed++;
            }

            // Check if we "heard" them (recent weapon fire)
            const lastKnown = state.lastKnownEnemyPositions.get(player.playerId);
            const isAudible = lastKnown
                ? state.tick - lastKnown.tick < AUDIBLE_FIRE_TICKS
                : false;

            // Calculate relative angle
            const relativeAngle = this._calcRelativeAngle(state, player.position);

            const entry: VisionEnemy = {
                player,
                isVisible,
                isAudible,
                relativeAngle,
            };

            if (isVisible) {
                visibleEnemies.push(entry);
            } else if (isAudible) {
                audibleEnemies.push(entry);
            }
        }

        // Also add remaining players (beyond LOS check limit) as audible-only
        for (let i = enemyCheckCount; i < state.players.length; i++) {
            const player = state.players[i];
            if (player.isDead) continue;

            const lastKnown = state.lastKnownEnemyPositions.get(player.playerId);
            const isAudible = lastKnown
                ? state.tick - lastKnown.tick < AUDIBLE_FIRE_TICKS
                : false;

            if (isAudible) {
                audibleEnemies.push({
                    player,
                    isVisible: false,
                    isAudible: true,
                    relativeAngle: this._calcRelativeAngle(state, player.position),
                });
            }
        }

        // ── Check pickups ─────────────────────────────────────────────
        const pickups: VisionPickup[] = [];
        const pickupCheckCount = Math.min(state.pickups.length, MAX_PICKUP_CHECKS);

        for (let i = 0; i < pickupCheckCount && tracesPerformed < MAX_TRACES_PER_TICK; i++) {
            const pickup = state.pickups[i];

            const isVisible = this.canSeeFrom(state.self.position, pickup.position);
            tracesPerformed++;

            // Simple reachability: is the path walkable at ground level?
            let isReachable = isVisible; // If we can see it, assume reachable for now
            if (isVisible && tracesPerformed < MAX_TRACES_PER_TICK) {
                isReachable = this.isPathClear(state.self.position, pickup.position);
                tracesPerformed++;
            }

            pickups.push({ pickup, isVisible, isReachable });
        }

        // ── Find cover ────────────────────────────────────────────────
        let nearestCover: Vec3 | null = null;
        const primaryThreat = visibleEnemies[0] || audibleEnemies[0];
        if (primaryThreat && tracesPerformed < MAX_TRACES_PER_TICK) {
            const coverResult = this._findCoverFromThreat(
                state.self.position,
                primaryThreat.player.position,
                MAX_TRACES_PER_TICK - tracesPerformed,
            );
            nearestCover = coverResult.position;
            tracesPerformed += coverResult.traces;
        }

        // ── Update enemy memory tracks ─────────────────────────────────
        this._updateEnemyTracks(state, visibleEnemies, audibleEnemies);

        // ── Get current tracked enemies (phantoms behind cover) ───────
        const trackedEnemies = this._getActiveTrackedEnemies(state, visibleEnemies);

        // ── Determine chase target ────────────────────────────────────
        const chaseTarget = this._selectChaseTarget(trackedEnemies);

        // ── Combine and sort ──────────────────────────────────────────
        const allKnownEnemies = [...visibleEnemies, ...audibleEnemies];

        return {
            visibleEnemies,
            audibleEnemies,
            allKnownEnemies,
            pickups,
            nearestCover,
            trackedEnemies,
            chaseTarget,
            tracesPerformed,
        };
    }

    // ── Path Checking ───────────────────────────────────────────────────

    /**
     * Check if a straight-line ground path is walkable (no walls blocking).
     * Uses a swept AABB trace with player-sized bounding box.
     */
    isPathClear(from: Vec3, to: Vec3): boolean {
        // Trace at ground level with player bounds
        const result = this._collisionWorld.trace(from, to, PLAYER_BOUNDS);
        // If fraction is close to 1, the path is mostly clear
        return result.fraction > 0.9;
    }

    // ── Cover Finding ───────────────────────────────────────────────────

    /**
     * Find a cover position that blocks LOS from a threat.
     * Samples positions in directions perpendicular to the threat.
     */
    findCover(from: Vec3, threatPosition: Vec3): Vec3 | null {
        const result = this._findCoverFromThreat(from, threatPosition, COVER_SEARCH_RAYS);
        return result.position;
    }

    // ── Item Navigation ─────────────────────────────────────────────────

    /**
     * Find nearest known item position of a given type from BSP data.
     * This uses pre-extracted BSP entity positions, not snapshot entities.
     *
     * @param from - Bot's current position
     * @param type - Item type filter ('health', 'armor', 'weapon', or specific classname)
     * @returns Nearest matching item position, or null
     */
    findNearestItem(from: Vec3, type: string): Vec3 | null {
        let bestDist = Infinity;
        let bestPos: Vec3 | null = null;

        for (const item of this._mapKnowledge.pickupPositions) {
            const matches = this._matchesItemType(item.classname, type);
            if (!matches) continue;

            const dist = vec3Distance(from, item.position);
            if (dist < bestDist) {
                bestDist = dist;
                bestPos = item.position;
            }
        }

        return bestPos;
    }

    /**
     * Find nearest spawn point (useful for predicting enemy spawns).
     */
    findNearestSpawnPoint(from: Vec3): Vec3 | null {
        let bestDist = Infinity;
        let bestPos: Vec3 | null = null;

        for (const sp of this._mapKnowledge.spawnPoints) {
            const dist = vec3Distance(from, sp);
            if (dist < bestDist) {
                bestDist = dist;
                bestPos = sp;
            }
        }

        return bestPos;
    }

    // ── Ground/Height Queries ───────────────────────────────────────────

    /**
     * Check if a position is inside solid geometry (stuck in a wall).
     */
    isInsideSolid(point: Vec3): boolean {
        return this._collisionWorld.pointContents(point) !== 0;
    }

    // ── Cache Management ────────────────────────────────────────────────

    /**
     * Clear LOS cache and enemy memory (call when bot dies/respawns).
     */
    clearCache(): void {
        this._losCache.clear();
        this._enemyTracks.clear();
    }

    // ── Sound & Damage Event Registration ────────────────────────────────

    /**
     * Register a sound event (weapon fire) — creates or refreshes a track.
     * Called by BotClient when processing game events.
     */
    registerSoundEvent(playerId: string, entityId: string, position: Vec3, tick: number): void {
        const existing = this._enemyTracks.get(playerId);
        if (existing && existing.source === 'visual' && existing.confidence > SOUND_CONFIDENCE) {
            // Don't overwrite a better visual track with worse sound data
            return;
        }

        this._enemyTracks.set(playerId, {
            playerId,
            entityId,
            lastSeenPosition: { ...position },
            lastSeenVelocity: { x: 0, y: 0, z: 0 }, // Unknown velocity from sound
            lastSeenTick: tick,
            predictedPosition: { ...position },
            confidence: SOUND_CONFIDENCE,
            source: 'sound',
            lastDistance: 0,
        });
    }

    /**
     * Register a damage event — we KNOW someone hit us from a direction.
     */
    registerDamageEvent(playerId: string, entityId: string, position: Vec3, tick: number): void {
        const existing = this._enemyTracks.get(playerId);
        if (existing && existing.source === 'visual' && existing.confidence > DAMAGE_CONFIDENCE) {
            return;
        }

        this._enemyTracks.set(playerId, {
            playerId,
            entityId,
            lastSeenPosition: { ...position },
            lastSeenVelocity: { x: 0, y: 0, z: 0 },
            lastSeenTick: tick,
            predictedPosition: { ...position },
            confidence: DAMAGE_CONFIDENCE,
            source: 'damage',
            lastDistance: 0,
        });
    }

    /**
     * Get a read-only snapshot of all active enemy tracks (for debugging).
     */
    getEnemyTracks(): ReadonlyMap<string, EnemyTrack> {
        return this._enemyTracks;
    }

    // ── Enemy Memory — Private Methods ──────────────────────────────────

    /**
     * Update enemy tracks based on current visibility.
     * - Visible enemies: refresh/create track at confidence 1.0
     * - Audible enemies (not visible): create/refresh sound track
     * - Previously tracked enemies now invisible: their tracks persist & decay
     */
    private _updateEnemyTracks(
        state: BotGameState,
        visibleEnemies: VisionEnemy[],
        audibleEnemies: VisionEnemy[],
    ): void {
        // Update tracks for currently visible enemies (full confidence)
        for (const ve of visibleEnemies) {
            this._enemyTracks.set(ve.player.playerId, {
                playerId: ve.player.playerId,
                entityId: ve.player.entityId,
                lastSeenPosition: { ...ve.player.position },
                lastSeenVelocity: { ...ve.player.velocity },
                lastSeenTick: state.tick,
                predictedPosition: { ...ve.player.position },
                confidence: 1.0,
                source: 'visual',
                lastDistance: ve.player.distance,
            });
        }

        // Update tracks for audible-only enemies (lower confidence)
        for (const ae of audibleEnemies) {
            const existing = this._enemyTracks.get(ae.player.playerId);
            // Only update if we don't have a recent visual track
            if (!existing || existing.confidence < SOUND_CONFIDENCE || existing.source !== 'visual') {
                this._enemyTracks.set(ae.player.playerId, {
                    playerId: ae.player.playerId,
                    entityId: ae.player.entityId,
                    lastSeenPosition: { ...ae.player.position },
                    lastSeenVelocity: { ...ae.player.velocity },
                    lastSeenTick: state.tick,
                    predictedPosition: { ...ae.player.position },
                    confidence: SOUND_CONFIDENCE,
                    source: 'sound',
                    lastDistance: ae.player.distance,
                });
            }
        }

        // Prune dead tracks and enforce max count
        if (this._enemyTracks.size > MAX_ENEMY_TRACKS) {
            // Remove oldest/lowest confidence tracks
            const sorted = [...this._enemyTracks.entries()]
                .sort((a, b) => a[1].confidence - b[1].confidence);
            while (this._enemyTracks.size > MAX_ENEMY_TRACKS && sorted.length > 0) {
                const [key] = sorted.shift()!;
                this._enemyTracks.delete(key);
            }
        }
    }

    /**
     * Get active tracked enemies that are NOT currently visible.
     * Extrapolates positions and applies confidence decay.
     * Returns only tracks above the chase confidence threshold.
     */
    private _getActiveTrackedEnemies(
        state: BotGameState,
        visibleEnemies: VisionEnemy[],
    ): EnemyTrack[] {
        const visibleIds = new Set(visibleEnemies.map(ve => ve.player.playerId));
        const tracked: EnemyTrack[] = [];

        for (const [playerId, track] of this._enemyTracks) {
            // Skip currently visible enemies — not "tracked", they're "seen"
            if (visibleIds.has(playerId)) continue;

            const elapsed = state.tick - track.lastSeenTick;
            if (elapsed <= 0) continue;

            // Determine decay rate based on source
            const decayTicks = track.source === 'visual'
                ? VISUAL_TRACK_DECAY_TICKS
                : SOUND_TRACK_DECAY_TICKS;

            // Calculate decayed confidence
            const initialConfidence = track.source === 'visual' ? 1.0
                : track.source === 'damage' ? DAMAGE_CONFIDENCE
                    : SOUND_CONFIDENCE;
            const confidence = Math.max(0, initialConfidence - (elapsed / decayTicks));

            // Remove dead tracks
            if (confidence <= 0) {
                this._enemyTracks.delete(playerId);
                continue;
            }

            // Extrapolate position (capped at MAX_EXTRAPOLATION_TICKS)
            const extrapolationTicks = Math.min(elapsed, MAX_EXTRAPOLATION_TICKS);
            const tickDuration = 1 / 60; // ~60Hz ticks
            const predictedPosition = vec3Add(
                track.lastSeenPosition,
                vec3Scale(track.lastSeenVelocity, extrapolationTicks * tickDuration),
            );

            // Update the track in-place
            track.predictedPosition = predictedPosition;
            track.confidence = confidence;

            if (confidence >= CHASE_CONFIDENCE_THRESHOLD) {
                tracked.push(track);
            }
        }

        // Sort by confidence (highest first)
        tracked.sort((a, b) => b.confidence - a.confidence);
        return tracked;
    }

    /**
     * Select the best chase target from tracked enemies.
     * Prefers: high confidence → recent visual → closest distance.
     */
    private _selectChaseTarget(trackedEnemies: EnemyTrack[]): EnemyTrack | null {
        if (trackedEnemies.length === 0) return null;

        // Strongly prefer recently-visible enemies over sound-tracked ones
        const visualTracks = trackedEnemies.filter(t => t.source === 'visual');
        if (visualTracks.length > 0) {
            return visualTracks[0]; // Already sorted by confidence
        }

        // Otherwise pick the highest confidence track
        return trackedEnemies[0];
    }


    /**
     * Calculate the angle from bot's forward direction to a target position.
     */
    private _calcRelativeAngle(state: BotGameState, targetPos: Vec3): number {
        const delta = vec3Subtract(targetPos, state.self.position);
        const targetYaw = Math.atan2(delta.x, delta.z);
        let diff = targetYaw - state.self.yaw;

        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        return diff;
    }

    /**
     * Search for cover in multiple directions away from a threat.
     */
    private _findCoverFromThreat(
        from: Vec3,
        threatPos: Vec3,
        maxTraces: number,
    ): { position: Vec3 | null; traces: number } {
        const threatDir = vec3Normalize(vec3Subtract(threatPos, from));
        let traces = 0;
        let bestCover: Vec3 | null = null;
        let bestDist = Infinity;

        // Sample positions in a ring perpendicular to the threat direction
        const raysToCheck = Math.min(COVER_SEARCH_RAYS, maxTraces);

        for (let i = 0; i < raysToCheck; i++) {
            const angle = (i / raysToCheck) * Math.PI * 2;

            // Create a direction perpendicular to threat, rotated around Y axis
            const searchDir: Vec3 = {
                x: Math.cos(angle) * -threatDir.z + Math.sin(angle) * threatDir.x,
                y: 0,
                z: Math.cos(angle) * threatDir.x + Math.sin(angle) * -threatDir.z,
            };

            const candidatePos = vec3Add(from, vec3Scale(searchDir, COVER_SEARCH_DISTANCE));

            // Check if this position blocks LOS from threat
            const eyeCandidate: Vec3 = { x: candidatePos.x, y: candidatePos.y + EYE_HEIGHT, z: candidatePos.z };
            const threatEye: Vec3 = { x: threatPos.x, y: threatPos.y + EYE_HEIGHT, z: threatPos.z };

            const traceResult = this._collisionWorld.trace(eyeCandidate, threatEye);
            traces++;

            // If trace hits geometry, this position is behind cover!
            if (traceResult.hit && traceResult.fraction < 0.9) {
                // But is it reachable from our current position?
                const pathToCandidate = this._collisionWorld.trace(from, candidatePos, PLAYER_BOUNDS);
                traces++;

                if (pathToCandidate.fraction > 0.5) {
                    // Reachable enough — use the endpoint of the path trace
                    const reachablePos = pathToCandidate.hitPoint || candidatePos;
                    const dist = vec3Distance(from, reachablePos);

                    if (dist < bestDist) {
                        bestDist = dist;
                        // Pull back slightly from the wall
                        const pullback = vec3Scale(vec3Normalize(vec3Subtract(from, reachablePos)), COVER_OFFSET);
                        bestCover = vec3Add(reachablePos, pullback);
                    }
                }

                if (traces >= maxTraces) break;
            }
        }

        return { position: bestCover, traces };
    }

    /**
     * Check if a BSP entity classname matches an item type query.
     */
    private _matchesItemType(classname: string, type: string): boolean {
        switch (type) {
            case 'health':
                return classname.includes('health') || classname === 'item_health_small'
                    || classname === 'item_health_medium' || classname === 'item_health_large'
                    || classname === 'item_health_mega';
            case 'armor':
                return classname.includes('armor') || classname === 'item_armor_shard'
                    || classname === 'item_armor_green' || classname === 'item_armor_yellow'
                    || classname === 'item_armor_red';
            case 'weapon':
                return classname.startsWith('weapon_');
            default:
                // Exact classname match
                return classname === type;
        }
    }
}

// ── Factory Function ────────────────────────────────────────────────────

/**
 * Create a BotVision instance for a given map.
 * Loads the BSP, creates a CollisionWorld, and extracts map knowledge.
 *
 * This is the main entry point — call once per map, share across bots.
 */
export async function createBotVision(mapName: string): Promise<BotVision | null> {
    const { loadBspBuffer, extractMapData } = await import('../shared/bsp/BspDataLoader');
    const { BspLoader } = await import('../engine/loader/bsp/BspLoader');
    const { createHeadlessCollisionWorld } = await import('../cli/HeadlessBSPCollisionWorld');

    console.log(`[BotVision] Loading BSP for map: ${mapName}`);

    const bspBuffer = await loadBspBuffer(mapName);
    if (!bspBuffer) {
        console.warn(`[BotVision] Failed to load BSP for map "${mapName}" — vision disabled`);
        return null;
    }

    const bsp = BspLoader.load(bspBuffer);
    console.log(`[BotVision] BSP parsed: ${bsp.header.isFBSP ? 'FBSP' : 'IBSP'} v${bsp.header.version}`);
    console.log(`[BotVision] Brushes: ${bsp.brushes.length}, Planes: ${bsp.planes.length}`);

    // Create collision world
    const collisionWorld = await createHeadlessCollisionWorld(bsp);
    console.log(`[BotVision] CollisionWorld initialized`);

    // Extract map knowledge
    const mapData = extractMapData(bsp.entities);
    console.log(`[BotVision] Map data: ${mapData.spawnPoints.length} spawns, ${mapData.pickupItems.length} pickups`);
    console.log(`[BotVision] Entity classnames: ${mapData.entityClassnames.join(', ')}`);

    const mapKnowledge: MapKnowledgeData = {
        mapName,
        spawnPoints: mapData.spawnPoints,
        pickupPositions: mapData.pickupItems,
    };

    return new BotVision(collisionWorld, mapKnowledge);
}
