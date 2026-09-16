/**
 * LoadingEvents - TypeScript interfaces for loading EventBus events
 *
 * These events provide a decoupled way for loading systems (MapLoader, etc.)
 * to communicate progress to UI components (MapLoadingOverlay, etc.).
 *
 * Event names:
 *   - 'loading:start'    - Loading operation begins
 *   - 'loading:progress' - Progress update during loading
 *   - 'loading:complete' - Loading operation finished
 *   - 'loading:hidden'   - The loading screen finished fading out; the world is on screen
 *
 * Usage:
 *   // Emitting (in MapLoader)
 *   EventBus.emit('loading:start', { type: 'map', id: 'wdm7' });
 *   EventBus.emit('loading:progress', { type: 'map', phase: 'shaders', detail: '...' });
 *   EventBus.emit('loading:complete', { type: 'map', success: true, duration: 2340 });
 *
 *   // Listening (in MapLoadingOverlay)
 *   EventBus.on('loading:start', (event: LoadingStartEvent) => { ... });
 */

/**
 * Loading types - extensible for different scenarios
 * 'generic' is provided for game-specific operations that don't fit other categories
 */
export type LoadingType = "map" | "assets" | "save" | "network" | "generic" | string;

/**
 * Emitted when a loading operation begins
 */
export interface LoadingStartEvent {
  /** Type of loading operation */
  type: LoadingType;
  /** Identifier for what's being loaded (e.g., map name, save slot) */
  id: string;
  /** Optional metadata */
  meta?: {
    /** Human-readable display name */
    displayName?: string;
    /** Game-specific additional data */
    [key: string]: unknown;
  };
}

/**
 * Emitted during loading to report progress
 */
export interface LoadingProgressEvent {
  /** Type of loading operation (should match the start event) */
  type: LoadingType;
  /** Current phase of loading (e.g., 'parsing', 'shaders', 'textures') */
  phase: string;
  /** Human-readable detail message */
  detail?: string;
  /** Optional progress percentage (0-100) */
  percent?: number;
}

/**
 * Emitted when loading completes (success or failure)
 */
export interface LoadingCompleteEvent {
  /** Type of loading operation (should match the start event) */
  type: LoadingType;
  /** Whether loading succeeded */
  success: boolean;
  /** Error message if success is false */
  error?: string;
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Event name constants for type safety
 */
export const LOADING_EVENTS = {
  START: "loading:start",
  PROGRESS: "loading:progress",
  COMPLETE: "loading:complete",
  HIDDEN: "loading:hidden",
} as const;
