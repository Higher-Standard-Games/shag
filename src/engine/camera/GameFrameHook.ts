/**
 * GameFrameHook — dependency-inversion seam for the per-frame "tick the network
 * + render remote players" concern that camera controllers drive (QA-2 / QA-WO7).
 *
 * Engine camera controllers ran this by importing `games/fps/Game` directly — a
 * build-time cycle that stopped the engine typechecking without the fps
 * submodule and blocked reuse for a second game. The engine now defines this
 * interface and the game registers itself; the engine never imports the game.
 *
 * Null until the game registers (at construction), so a controller ticking
 * before the game exists simply no-ops — the same behavior as the old
 * "ignore if not initialized" guard.
 */
export interface GameFrameHook {
  isGameRunning(): boolean;
  processSnapshots(): void;
  renderRemotePlayers(): void;
}

let current: GameFrameHook | null = null;

/** The active game registers itself here (once, when constructed). */
export function setGameFrameHook(hook: GameFrameHook | null): void {
  current = hook;
}

/** The registered game frame hook, or null before the game exists. */
export function getGameFrameHook(): GameFrameHook | null {
  return current;
}
