import type { GameState } from './GameState';
import type { Command } from './Command';
import type { PlayerId } from './Entity';

/**
 * Main game host interface - abstraction for local vs networked games
 * 
 * Game code uses this interface without knowing if it's single-player,
 * multiplayer client, or listen server.
 */
export interface IGameHost {
  /** Local player ID */
  readonly localPlayerId: PlayerId;

  /** Current server tick */
  readonly currentTick: number;

  /**
   * Send a command to the server
   * Works for both local and networked hosts
   */
  sendCommand(cmd: Command): void;

  /**
   * Subscribe to state updates
   * Called when game state changes
   */
  onStateUpdate(callback: (state: GameState) => void): () => void;

  /**
   * Subscribe to game events
   * Called for sounds, effects, etc.
   */
  onEvent(callback: (event: any) => void): () => void;

  /**
   * Get interpolated entity state for rendering
   * Used for smooth remote player movement
   */
  getInterpolatedEntity(entityId: string): any;

  /**
   * Get local player state for prediction
   */
  getLocalState(): GameState;

  /**
   * Connect to server (network hosts only)
   */
  connect?(): Promise<void>;

  /**
   * Disconnect from server
   */
  disconnect?(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected?(): boolean;
}
