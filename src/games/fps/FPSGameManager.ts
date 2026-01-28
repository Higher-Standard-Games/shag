/**
 * FPSGameManager - Manages network simulation for FPS game
 *
 * Bridges FPSPlayer/FPSController with the authoritative simulation.
 * In single-player, runs LocalGameHost with FPSSimulation.
 * In multiplayer, uses NetworkGameHost to connect to a dedicated server.
 */

import type { IGameHost } from '../../engine/network/core/IGameHost';
import { LocalGameHost } from '../../engine/network/client/hosts/LocalGameHost';
import { NetworkGameHost } from '../../engine/network/client/hosts/NetworkGameHost';
import { TransportFactory } from '../../engine/network/client/transport/Transport';
import { FPSSimulation, FPSInputCommand } from './simulation/FPSSimulation';
import { InputButtons } from '../../engine/network/components/InputComponent';
import type { GameState } from '../../engine/network/core/GameState';
import type { TransformComponent } from '../../engine/network/components/TransformComponent';
import type { VelocityComponent } from '../../engine/network/components/VelocityComponent';
import type { MovementStateComponent } from '../../engine/network/components/MovementStateComponent';

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

  // Advanced movement state for client effects
  isSliding: boolean;
  isCrouching: boolean;
  crouchViewOffset: number;
  wallJumpState: 'none' | 'available' | 'charging';
  ledgeGrabState: 'none' | 'grabbing' | 'pulling';
  actualHorizSpeed: number;
}

export class FPSGameManager {
  private static instance: FPSGameManager | null = null;

  private gameHost: IGameHost | null = null;
  private simulation: FPSSimulation | null = null;
  private localPlayerId: string = '';
  private commandSeq: number = 0;
  private isRunning: boolean = false;
  private isNetworkMode: boolean = false;
  private serverUrl: string | null = null;

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
    this.isNetworkMode = false;
    this.serverUrl = null;

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
   * Initialize network game (multiplayer mode)
   * Connects to a dedicated server
   */
  async initializeNetwork(url: string, config: FPSGameConfig = {}): Promise<void> {
    // Guard against multiple initializations - shutdown first if already running
    if (this.isRunning) {
      console.log('[FPSGameManager] Shutting down existing game before connecting...');
      this.shutdown();
    }

    const tickRate = config.tickRate ?? 60;
    const maxPlayers = config.maxPlayers ?? 16;

    console.log(`[FPSGameManager] Connecting to server: ${url}`);

    // Create simulation config for client-side prediction
    const simConfig = {
      tickRate,
      tickDuration: 1000 / tickRate,
      maxPlayers,
      gameRules: {},
    };

    try {
      // Create transport (auto-selects WebTransport or WebSocket)
      const transport = await TransportFactory.create(url);

      // Create network game host with FPSSimulation for client-side prediction
      // Cast needed due to FPSInputCommand vs Command generic variance
      const networkHost = new NetworkGameHost(transport, simConfig, FPSSimulation as any);

      // Guard against duplicate Welcome messages
      let mapLoadStarted = false;

      // Subscribe to server info to load the correct map
      networkHost.onServerInfo(async (serverInfo) => {
        // Prevent duplicate map loading (Welcome can be received multiple times)
        if (mapLoadStarted) {
          console.log(`[FPSGameManager] Ignoring duplicate Welcome message for map: ${serverInfo.map}`);
          return;
        }
        mapLoadStarted = true;

        console.log(`[FPSGameManager] Server map: ${serverInfo.map}`);

        // Load the server's map via console command
        try {
          const { CommandRegistry } = await import('../../engine/console/CommandRegistry');
          const registry = CommandRegistry.getInstance();
          const result = await registry.execute(`map ${serverInfo.map}`);
          console.log(`[FPSGameManager] Map load result: ${result}`);

          // Check if map load failed
          if (typeof result === 'string' && result.includes('Failed')) {
            console.error(`[FPSGameManager] Map load failed, disconnecting...`);
            this.shutdown();
            return;
          }

          // === CRITICAL: Set up FPS controller AFTER map loads ===
          // This prevents the race condition where scene empty/map command overrides the controller
          try {
            const { CameraSystem } = await import('../../engine/camera/CameraSystem');
            const { FPSController } = await import('../../engine/camera/controllers/FPSController');
            const cameraSystem = CameraSystem.getInstance();

            // Ensure FPS controller is registered and active
            if (!cameraSystem.getController('fps')) {
              cameraSystem.registerController('fps', new FPSController());
            }
            cameraSystem.setController('fps');
            console.log(`[FPSGameManager] Switched to FPS camera mode after map load`);

            // Enable network mode on the FPSController
            const controller = cameraSystem.getActiveController();
            if (controller && controller.type === 'fps' && typeof (controller as any).enableNetworkMode === 'function') {
              (controller as any).enableNetworkMode();
              console.log(`[FPSGameManager] Enabled network mode on FPSController`);
            }
          } catch (e) {
            console.warn(`[FPSGameManager] Could not set up FPS controller after map load:`, e);
          }
        } catch (error) {
          console.error(`[FPSGameManager] Failed to load map ${serverInfo.map}:`, error);
          console.log(`[FPSGameManager] Disconnecting due to map load error...`);
          this.shutdown();
        }
      });

      // Set up state BEFORE connect so the onServerInfo callback can use them
      this.gameHost = networkHost;
      this.isNetworkMode = true;
      this.serverUrl = url;
      this.isRunning = true;

      // Connect to server (this triggers onServerInfo callback which loads map)
      await networkHost.connect(url);

      // Update player ID after connect (server assigns it during handshake)
      this.localPlayerId = networkHost.localPlayerId;
      this.simulation = null; // No direct simulation access in network mode

      // Subscribe to state updates
      this.gameHost.onStateUpdate((state: GameState) => {
        this.onServerStateUpdate(state);
      });

      console.log(`[FPSGameManager] Connected to ${url}, player: ${this.localPlayerId}`);
      // Note: FPS controller setup is now done in onServerInfo callback AFTER map loads
      // This prevents race conditions where map loading overrides the controller
    } catch (error) {
      console.error(`[FPSGameManager] Failed to connect to ${url}:`, error);
      throw error;
    }
  }

  /**
   * Check if running in network mode
   */
  isConnectedToServer(): boolean {
    return this.isNetworkMode && this.isRunning;
  }

  /**
   * Get current server URL (if connected)
   */
  getServerUrl(): string | null {
    return this.serverUrl;
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
  /**
   * Get current local player position from simulation
   * Uses interpolation for smooth rendering between ticks
   */
  getLocalPlayerPosition(): { x: number; y: number; z: number } | null {
    if (!this.gameHost) {
      // console.log(`[FPSGameManager] getLocalPlayerPosition: no gameHost`);
      return null;
    }

    const state = this.gameHost.getLocalState();
    const player = state.players.get(this.localPlayerId);
    if (!player) {
      // Only log periodically to avoid spam
      if (Math.random() < 0.01) {
        console.log(`[FPSGameManager] getLocalPlayerPosition: no player for ${this.localPlayerId}, players:`, Array.from(state.players.keys()));
      }
      return null;
    }

    // Use interpolated position for smooth rendering
    const localHost = this.gameHost as LocalGameHost;
    if (localHost.getInterpolatedPosition) {
      const interpPos = localHost.getInterpolatedPosition(player.entityId);
      if (interpPos) return interpPos;
    }

    // Fallback to discrete position
    const entity = state.entities.get(player.entityId);
    if (!entity) {
      if (Math.random() < 0.01) {
        console.log(`[FPSGameManager] getLocalPlayerPosition: no entity for ${player.entityId}`);
      }
      return null;
    }

    const transform = entity.getComponent<TransformComponent>('transform');
    if (!transform) {
      if (Math.random() < 0.01) {
        console.log(`[FPSGameManager] getLocalPlayerPosition: no transform component`);
      }
      return null;
    }

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
      // Disconnect if in network mode
      if (this.isNetworkMode && 'disconnect' in this.gameHost) {
        (this.gameHost as any).disconnect();
      }
      this.gameHost.stop?.();
      this.gameHost = null;
    }
    this.simulation = null;
    this.isRunning = false;
    this.isNetworkMode = false;
    this.serverUrl = null;
    this.commandSeq = 0;
    this.onStateUpdateCallbacks = [];

    console.log('[FPSGameManager] Shutdown complete');
  }

  /**
   * Handle state update from simulation
   */
  private onServerStateUpdate(state: GameState): void {
    const player = state.players.get(this.localPlayerId);
    if (!player) {
      // Debug: log occasionally to avoid spam
      if (Math.random() < 0.01) {
        console.log(`[FPSGameManager] onServerStateUpdate: no player for ${this.localPlayerId}, players:`, Array.from(state.players.keys()));
      }
      return;
    }

    const entity = state.entities.get(player.entityId);
    if (!entity) {
      if (Math.random() < 0.01) {
        console.log(`[FPSGameManager] onServerStateUpdate: no entity for ${player.entityId}, entities:`, Array.from(state.entities.keys()));
      }
      return;
    }

    const transform = entity.getComponent<TransformComponent>('transform');
    const velocity = entity.getComponent<VelocityComponent>('velocity');
    const movementState = entity.getComponent<MovementStateComponent>('movementState');

    if (!transform || !velocity) {
      if (Math.random() < 0.01) {
        const componentNames = entity.getComponentNames ? entity.getComponentNames() : 'unknown';
        console.log(`[FPSGameManager] onServerStateUpdate: missing transform/velocity, components:`, componentNames);
        console.log(`  transform:`, transform);
        console.log(`  velocity:`, velocity);
      }
      return;
    }

    // Debug: log position occasionally
    if (Math.random() < 0.01) {
      console.log(`[FPSGameManager] State update: pos=(${transform.position.x.toFixed(1)}, ${transform.position.y.toFixed(1)}, ${transform.position.z.toFixed(1)})`);
    }

    const update: PlayerStateUpdate = {
      position: { ...transform.position },
      velocity: { ...velocity.linear },
      grounded: velocity.grounded,
      tick: state.tick,
      // Advanced movement state
      isSliding: movementState?.isSliding ?? false,
      isCrouching: movementState?.isCrouching ?? false,
      crouchViewOffset: movementState?.crouchViewOffset ?? 0,
      wallJumpState: movementState?.wallJumpState ?? 'none',
      ledgeGrabState: movementState?.ledgeGrabState ?? 'none',
      actualHorizSpeed: movementState?.actualHorizSpeed ?? 0,
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
