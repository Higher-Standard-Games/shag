/**
 * NetworkConnector — small adapter the lobby UI uses to start a network
 * connection without importing any game-module code.
 *
 * The engine doesn't know how a given game wires its networking, so the
 * game submodule registers an implementation at boot. Today the FPS module
 * exports an adapter around `Game.getInstance()`; future SHAG games can
 * provide their own.
 *
 * The registry is a single-slot module-global because there is at most one
 * active network host per app session — a stronger pattern than a
 * ServiceLocator entry for such a narrow injection point.
 */

export interface NetworkConnectOptions {
  /** Auto-join the match as a participating player (default true). */
  autoJoin?: boolean;
  /** Spectator-only connection (default false). Mutually exclusive with autoJoin. */
  watchOnly?: boolean;
}

export interface NetworkConnector {
  /** Returns true if the app currently has an active network connection. */
  isConnected(): boolean;
  /** Establish a network connection to the given server. */
  connect(serverUrl: string, options?: NetworkConnectOptions): Promise<void>;
}

let registered: NetworkConnector | null = null;

/**
 * Register the active NetworkConnector. Called once at boot from the
 * host app (typically `src/main.ts`) after the game module is loaded.
 *
 * Calling twice replaces the previous registration — useful for tests
 * and for re-init flows where a new game module is mounted.
 */
export function registerNetworkConnector(connector: NetworkConnector): void {
  registered = connector;
}

/**
 * Returns the registered NetworkConnector, or `null` if no game module
 * has registered one yet. Callers must handle the null case (the engine
 * cannot connect on its own).
 */
export function getNetworkConnector(): NetworkConnector | null {
  return registered;
}

/**
 * Clear the registration. Provided primarily for tests.
 */
export function clearNetworkConnector(): void {
  registered = null;
}
