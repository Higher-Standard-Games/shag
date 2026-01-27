/**
 * FPSGameManager - Manages network simulation for FPS game
 *
 * Bridges FPSPlayer/FPSController with the authoritative simulation.
 * In single-player, runs LocalGameHost with FPSSimulation.
 * In multiplayer, would use NetworkGameHost instead.
 */

import type { IGameHost } from '../../engine/network/core/IGameHost';
import { LocalGameHost } from '../../engine/network/client/hosts/LocalGameHost';
import { FPSSimulation, FPSInputCommand } from './simulation/FPSSimulation';
import { InputButtons } from '../../engine/network/components/InputComponent';
import type { GameState } from '../../engine/network/core/GameState';
import type { TransformComponent } from '../../engine/network/components/TransformComponent';
import type { VelocityComponent } from '../../engine/network/components/VelocityComponent';

export interface FPSGameConfig {
  tickRate?: number;
  maxPlayers?: number;
}

/**
 * Player input captured from FPSController
 */
export interface PlayerInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  fire: boolean;
  altFire: boolean;
  pitch: number;  // Camera X rotation
  yaw: number;    // Camera Y rotation
}

/**
 * State update for client to apply
 */
export interface PlayerStateUpdate {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  grounded: boolean;
  tick: number;
}

export class FPSGameManager {
  private static instance: FPSGameManager | null = null;

  private gameHost: IGameHost | null = null;
  private simulation: FPSSimulation | null = null;
  private localPlayerId: string = '';
  private commandSeq: number = 0;
  private isRunning: boolean = false;

  // Callbacks
  private onStateUpdateCallbacks: ((state: PlayerStateUpdate) => void)[] = [];

  private constructor() { }

  static getInstance(): FPSGameManager {
    if (!FPSGameManager.instance) {
      FPSGameManager.instance = new FPSGameManager();
    }
    return FPSGameManager.instance;
  }

  /**
   * Initialize local game (single-player mode)
   */
  async initializeLocal(config: FPSGameConfig = {}): Promise<void> {
    // Guard against multiple initializations
    if (this.isRunning) {
      console.warn('[FPSGameManager] Already initialized, skipping');
      return;
    }

    const tickRate = config.tickRate ?? 20;
    const maxPlayers = config.maxPlayers ?? 16;

    console.log(`[FPSGameManager] Initializing local game at ${tickRate}Hz`);

    // Create simulation config
    const simConfig = {
      tickRate,
      tickDuration: 1000 / tickRate,
      maxPlayers,
      gameRules: {},
    };

    // Create LocalGameHost with FPSSimulation
    this.gameHost = new LocalGameHost(simConfig, FPSSimulation);

    // Get reference to simulation (for spawn points, collision world, etc.)
    this.simulation = (this.gameHost as LocalGameHost).getSimulation<FPSSimulation>();

    this.localPlayerId = this.gameHost.localPlayerId;

    // Subscribe to state updates
    this.gameHost.onStateUpdate((state: GameState) => {
      this.onServerStateUpdate(state);
    });

    // Start the host
    this.gameHost.start?.();
    this.isRunning = true;

    console.log(`[FPSGameManager] Local game initialized, player: ${this.localPlayerId}`);
  }

  /**
   * Spawn local player in simulation
   * @param spawnPosition Optional spawn position (uses random spawn point if not provided)
   */
  spawnLocalPlayer(spawnPosition?: { x: number; y: number; z: number }): void {
    if (!this.simulation) {
      console.error('[FPSGameManager] Cannot spawn - not initialized');
      return;
    }

    // Spawn player in simulation
    const entity = this.simulation.spawnPlayer(this.localPlayerId);

    // Override spawn position if provided
    if (spawnPosition) {
      const transform = entity.getComponent<TransformComponent>('transform');
      if (transform) {
        transform.position = { ...spawnPosition };
      }
    }

    console.log(`[FPSGameManager] Spawned local player: ${entity.id}`);
  }

  /**
   * Send player input to simulation
   * Call this each frame from FPSController
   */
  sendInput(input: PlayerInputState): void {
    if (!this.gameHost || !this.isRunning) return;

    // Convert input state to button flags
    let buttons = 0;
    if (input.forward) buttons |= InputButtons.FORWARD;
    if (input.backward) buttons |= InputButtons.BACK;
    if (input.left) buttons |= InputButtons.LEFT;
    if (input.right) buttons |= InputButtons.RIGHT;
    if (input.jump) buttons |= InputButtons.JUMP;
    if (input.crouch) buttons |= InputButtons.CROUCH;
    if (input.sprint) buttons |= InputButtons.SPRINT;
    if (input.fire) buttons |= InputButtons.FIRE;
    if (input.altFire) buttons |= InputButtons.ALT_FIRE;

    // Build world-space direction from buttons using Babylon.js LEFT-HANDED coordinate system
    // In left-handed Y rotation: forward = (sin(yaw), 0, cos(yaw)), right = (cos(yaw), 0, -sin(yaw))
    // This matches what camera.getDirection(Forward/Right) returns in the local code.
    const cosYaw = Math.cos(input.yaw);
    const sinYaw = Math.sin(input.yaw);

    // Forward direction in Babylon left-handed
    const forwardX = sinYaw;
    const forwardZ = cosYaw;
    // Right direction in Babylon left-handed (90° clockwise from forward)
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    // Build world direction from local input
    let dirX = 0;
    let dirZ = 0;
    if (input.forward) { dirX += forwardX; dirZ += forwardZ; }
    if (input.backward) { dirX -= forwardX; dirZ -= forwardZ; }
    if (input.left) { dirX -= rightX; dirZ -= rightZ; }
    if (input.right) { dirX += rightX; dirZ += rightZ; }

    // Normalize the final direction
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dirLen > 0) {
      dirX /= dirLen;
      dirZ /= dirLen;
    }

    // Create input command
    const cmd: FPSInputCommand = {
      type: 'fps_input',
      playerId: this.localPlayerId,
      tick: this.gameHost.currentTick,
      seq: this.commandSeq++,
      direction: { x: dirX, y: 0, z: dirZ },
      pitch: input.pitch,
      yaw: input.yaw,
      buttons,
      serialize: () => new Uint8Array(), // TODO: Implement for network
    };

    // Send to host (runs simulation tick)
    this.gameHost.sendCommand(cmd);
  }

  /**
   * Subscribe to player state updates
   * Returns unsubscribe function
   */
  onPlayerStateUpdate(callback: (state: PlayerStateUpdate) => void): () => void {
    this.onStateUpdateCallbacks.push(callback);
    return () => {
      const index = this.onStateUpdateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onStateUpdateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current local player position from simulation
   */
  getLocalPlayerPosition(): { x: number; y: number; z: number } | null {
    if (!this.gameHost) return null;

    const state = this.gameHost.getLocalState();
    const player = state.players.get(this.localPlayerId);
    if (!player) return null;

    const entity = state.entities.get(player.entityId);
    if (!entity) return null;

    const transform = entity.getComponent<TransformComponent>('transform');
    if (!transform) return null;

    return { ...transform.position };
  }

  /**
   * Get current tick
   */
  getCurrentTick(): number {
    return this.gameHost?.currentTick ?? 0;
  }

  /**
   * Check if running
   */
  isGameRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get local player ID
   */
  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  /**
   * Shutdown game
   */
  shutdown(): void {
    if (this.gameHost) {
      this.gameHost.stop?.();
      this.gameHost = null;
    }
    this.simulation = null;
    this.isRunning = false;
    this.commandSeq = 0;
    this.onStateUpdateCallbacks = [];

    console.log('[FPSGameManager] Shutdown complete');
  }

  /**
   * Handle state update from simulation
   */
  private onServerStateUpdate(state: GameState): void {
    const player = state.players.get(this.localPlayerId);
    if (!player) return;

    const entity = state.entities.get(player.entityId);
    if (!entity) return;

    const transform = entity.getComponent<TransformComponent>('transform');
    const velocity = entity.getComponent<VelocityComponent>('velocity');

    if (!transform || !velocity) return;

    const update: PlayerStateUpdate = {
      position: { ...transform.position },
      velocity: { ...velocity.linear },
      grounded: velocity.grounded,
      tick: state.tick,
    };

    // Notify callbacks
    for (const callback of this.onStateUpdateCallbacks) {
      callback(update);
    }
  }

  /**
   * Set spawn points (from map entities)
   */
  setSpawnPoints(points: Array<{ x: number; y: number; z: number }>): void {
    if (this.simulation) {
      this.simulation.setSpawnPoints(points);
    }
  }

  /**
   * Set collision world (from loaded BSP)
   */
  setCollisionWorld(collision: import('../../engine/network/systems/collision/CollisionWorld').CollisionWorld | null): void {
    if (this.simulation) {
      this.simulation.setCollisionWorld(collision);
      console.log('[FPSGameManager] Collision world set');
    }
  }
}
