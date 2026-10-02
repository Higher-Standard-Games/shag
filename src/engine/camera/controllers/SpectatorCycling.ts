/**
 * SpectatorCycling — Manages player list and cycling for spectator mode.
 *
 * Pure logic module (no Babylon.js or DOM dependencies) that:
 * - Builds a sorted list of alive player entity IDs from GameState
 * - Cycles next/previous through the list
 * - Auto-selects a new target when the current one leaves the match. A
 *   target that dies is kept: whether to wait for their respawn
 *   or move on is the game's call, not this list's.
 * - Resolves entity IDs to player display names
 *
 * Designed to be used by both live spectator (Game.ts) and DemoViewer.
 */

import type { GameState } from "../../network/core/GameState";

// ─── Types ───────────────────────────────────────────────────────

export interface SpectatorCyclingState {
  /** Currently spectated entity ID, null if none */
  targetEntityId: string | null;
  /** Sorted list of alive player entity IDs */
  alivePlayerIds: string[];
  /** Display name of the current target */
  targetName: string;
}

// ─── Cycling Logic ───────────────────────────────────────────────

export class SpectatorCycling {
  private targetEntityId: string | null = null;
  private alivePlayerIds: string[] = [];
  /** Every player in the match, dead or alive. */
  private presentIds = new Set<string>();
  private playerNames: Map<string, string> = new Map();
  private _aliveWorkBuffer: string[] = []; // reusable to avoid per-tick allocation

  /**
   * Update the alive player list from a GameState snapshot.
   * Filters for 'player_*' entities with valid position data and not dead.
   *
   * @param state - Latest GameState from server or demo
   * @param excludeEntityId - Optional entity ID to exclude (e.g. local player)
   */
  updateFromGameState(state: GameState, excludeEntityId?: string): void {
    // Reuse work buffer to avoid per-tick allocation
    const alive = this._aliveWorkBuffer;
    alive.length = 0;
    this.presentIds.clear();

    // Snapshot entities carry no health. Who is down comes from combat_state,
    // which the server sends for every player in every snapshot.
    const dead = new Set<string>();
    for (const event of state.events ?? []) {
      if (event.type === "combat_state" && (event as { dead?: boolean }).dead && event.entityId) {
        dead.add(event.entityId);
      }
    }

    for (const [entityId, entity] of state.entities) {
      // Only player entities
      if (!entityId.startsWith("player_")) continue;

      // Exclude self (if provided)
      if (excludeEntityId && entityId === excludeEntityId) continue;

      // Must have a valid transform (position)
      const transform = entity.getComponent("transform") as
        | { position?: { x: number; y: number; z: number } }
        | undefined;
      if (!transform?.position) continue;

      this.presentIds.add(entityId);

      const health = entity.getComponent("health") as { dead?: boolean } | undefined;
      if (health?.dead || dead.has(entityId)) continue;

      alive.push(entityId);
    }

    // Sort for deterministic ordering
    alive.sort();

    // Only replace if list actually changed (avoids unnecessary GC churn)
    if (alive.length !== this.alivePlayerIds.length || !alive.every((id, i) => id === this.alivePlayerIds[i])) {
      this.alivePlayerIds = [...alive];
    }

    // Update player names from GameState.players
    this.playerNames.clear();
    if (state.players) {
      for (const [, playerData] of state.players) {
        // Player data typically has: { entityId, name, ... }
        const pd = playerData as { entityId?: string; name?: string };
        if (pd.entityId && pd.name) {
          this.playerNames.set(pd.entityId, pd.name);
        }
        // A dead player is left out of the snapshot's entities until they
        // respawn, but the player list carries them for as long as they are in
        // the match.
        if (pd.entityId?.startsWith("player_") && pd.entityId !== excludeEntityId) {
          this.presentIds.add(pd.entityId);
        }
      }
    }

    // If current target left the match, auto-cycle
    if (this.targetEntityId && !this.presentIds.has(this.targetEntityId)) {
      this.autoSelectNext();
    }
  }

  /** True while `entityId` is in the snapshot and not dead. */
  isAlive(entityId: string): boolean {
    return this.alivePlayerIds.includes(entityId);
  }

  /**
   * Cycle to the next alive player.
   * Returns the new target entity ID, or null if no players alive.
   */
  next(): string | null {
    if (this.alivePlayerIds.length === 0) return null;

    if (!this.targetEntityId) {
      // No current target — select first
      this.targetEntityId = this.alivePlayerIds[0];
      return this.targetEntityId;
    }

    const ids = this.alivePlayerIds;
    const idx = ids.indexOf(this.targetEntityId);
    const nextIdx = idx === -1 ? this.slotAfter(this.targetEntityId) : (idx + 1) % ids.length;
    this.targetEntityId = ids[nextIdx];
    return this.targetEntityId;
  }

  /**
   * Cycle to the previous alive player.
   * Returns the new target entity ID, or null if no players alive.
   */
  prev(): string | null {
    if (this.alivePlayerIds.length === 0) return null;

    if (!this.targetEntityId) {
      // No current target — select last
      this.targetEntityId = this.alivePlayerIds[this.alivePlayerIds.length - 1];
      return this.targetEntityId;
    }

    const ids = this.alivePlayerIds;
    const idx = ids.indexOf(this.targetEntityId);
    const from = idx === -1 ? this.slotAfter(this.targetEntityId) : idx;
    this.targetEntityId = ids[(from - 1 + ids.length) % ids.length];
    return this.targetEntityId;
  }

  /**
   * Index of the first living player sorted after `entityId`, wrapping to 0.
   * A dead target is not in the list, so ← and → step from where it would sit
   * rather than from the ends.
   */
  private slotAfter(entityId: string): number {
    const at = this.alivePlayerIds.findIndex((id) => id > entityId);
    return at === -1 ? 0 : at;
  }

  /**
   * Pick a new target when the current one leaves the match: a living
   * player first, failing that anyone still here, so a moment when everyone
   * is down does not drop the chase.
   */
  private autoSelectNext(): void {
    this.targetEntityId = this.alivePlayerIds[0] ?? [...this.presentIds].sort()[0] ?? null;
  }

  /**
   * Set a specific target entity ID directly.
   */
  setTarget(entityId: string): void {
    this.targetEntityId = entityId;
  }

  /**
   * Clear the current target.
   */
  clearTarget(): void {
    this.targetEntityId = null;
  }

  /**
   * Get the currently targeted entity ID.
   */
  getTargetEntityId(): string | null {
    return this.targetEntityId;
  }

  /**
   * Get the display name of the current target.
   * Falls back to a formatted entity ID if no name is known.
   */
  getTargetName(): string {
    if (!this.targetEntityId) return "";

    const name = this.playerNames.get(this.targetEntityId);
    if (name) return name;

    // Fallback: format entity ID (e.g. 'player_1' → 'Player 1')
    return this.targetEntityId.replace("player_", "Player ");
  }

  /**
   * Resolve any entity ID to a display name.
   */
  getPlayerName(entityId: string): string {
    const name = this.playerNames.get(entityId);
    if (name) return name;
    return entityId.replace("player_", "Player ");
  }

  /**
   * Get the full list of alive player entity IDs.
   */
  getAlivePlayerIds(): string[] {
    return [...this.alivePlayerIds];
  }

  /**
   * Get the total number of alive players.
   */
  getAliveCount(): number {
    return this.alivePlayerIds.length;
  }

  /**
   * Get the current cycling state (for HUD display).
   */
  getState(): SpectatorCyclingState {
    return {
      targetEntityId: this.targetEntityId,
      alivePlayerIds: [...this.alivePlayerIds],
      targetName: this.getTargetName(),
    };
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.targetEntityId = null;
    this.alivePlayerIds = [];
    this.presentIds.clear();
    this.playerNames.clear();
  }
}
