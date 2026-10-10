/**
 * GameplayMapLauncher - game-specific hook for server-backed map launches.
 *
 * Engine console commands do not know how a game starts authoritative
 * gameplay. The active game module registers one launcher at boot.
 */

export interface GameplayMapLaunchResult {
  serverUrl: string;
  map: string;
  gametype: string;
  matchId?: string;
}

export interface GameplayMapLaunchOptions {
  /** Record a training demo under this name on the launched server. */
  trainingDemo?: string;
}

export interface GameplayMapLauncher {
  launch(mapName: string, gametype: string, options?: GameplayMapLaunchOptions): Promise<GameplayMapLaunchResult>;
  unload(): Promise<void> | void;
}

let registered: GameplayMapLauncher | null = null;

export function registerGameplayMapLauncher(launcher: GameplayMapLauncher): void {
  registered = launcher;
}

export function getGameplayMapLauncher(): GameplayMapLauncher | null {
  return registered;
}

export function clearGameplayMapLauncher(): void {
  registered = null;
}
