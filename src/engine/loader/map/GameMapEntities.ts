/** Game-owned entity work at the map loader's existing synchronous boundaries. */
export interface GameMapEntities {
  /** Populate definitions before discovering model dependencies. */
  initializeDefinitions(): void;
  /** Install spawn handlers and pre-render hooks before entity dispatch. */
  registerHandlers(): void;
  /** Release map entities before their preloaded models and world materials. */
  disposeMapEntities(): void;
}

let adapter: GameMapEntities | null = null;

export function registerGameMapEntities(value: GameMapEntities): void {
  adapter = value;
}

export function getGameMapEntities(): GameMapEntities | null {
  return adapter;
}

export function clearGameMapEntities(): void {
  adapter = null;
}
