/**
 * GamePaths - Configurable game directory system
 * 
 * Provides centralized path management for loading game assets.
 * Supports multiple games with engine fallback for shared assets.
 * 
 * Directory structure:
 * public/
 * ├── engine/           # Shared engine assets (fonts, default textures)
 * ├── ganjawars/        # Game directory (--game ganjawars)
 * │   ├── config.json
 * │   ├── data/
 * │   ├── maps/
 * │   └── ...
 * └── engine.json       # Root config (defaultGame, engineAssetsPath)
 * 
 * Usage:
 *   await GamePaths.getInstance().init();
 *   const mapPath = GamePaths.getInstance().maps('level1.map');
 */

export interface EngineConfig {
  defaultGame: string;
  engineAssetsPath: string;
}

export class GamePaths {
  private static instance: GamePaths;
  
  private gameName: string = 'game';
  private enginePath: string = '/engine';
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): GamePaths {
    if (!GamePaths.instance) {
      GamePaths.instance = new GamePaths();
    }
    return GamePaths.instance;
  }

  /**
   * Reset instance (for testing)
   */
  public static resetInstance(): void {
    GamePaths.instance = null as any;
  }

  /**
   * Initialize from engine.json and URL params
   */
  public async init(): Promise<void> {
    if (this.initialized) return;

    // Check URL param first (highest priority)
    const urlParams = new URLSearchParams(window.location.search);
    const urlGame = urlParams.get('game');

    if (urlGame) {
      this.gameName = urlGame;
      console.log(`[GamePaths] Game set from URL param: ${this.gameName}`);
    } else {
      // Try to load engine.json
      try {
        const response = await fetch('/engine.json');
        if (response.ok) {
          const config: EngineConfig = await response.json();
          this.gameName = config.defaultGame || 'ganjawars';
          this.enginePath = config.engineAssetsPath || '/engine';
          console.log(`[GamePaths] Loaded from engine.json: game=${this.gameName}`);
        }
      } catch (error) {
        console.log('[GamePaths] No engine.json found, using defaults');
      }
    }

    this.initialized = true;
    console.log(`[GamePaths] Initialized: game=${this.gameName}, engine=${this.enginePath}`);
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current game name
   */
  public getGameName(): string {
    return this.gameName;
  }

  /**
   * Set game name (requires page reload to take effect)
   */
  public setGame(name: string): void {
    if (name !== this.gameName) {
      this.gameName = name;
      console.log(`[GamePaths] Game changed to: ${name} (reload required)`);
    }
  }

  /**
   * Get engine assets path
   */
  public getEnginePath(): string {
    return this.enginePath;
  }

  // ============================================================================
  // Path Builders
  // ============================================================================

  /**
   * Get game root path or path within game directory
   * @param relativePath Optional path relative to game root
   */
  public game(relativePath?: string): string {
    const base = `/${this.gameName}`;
    if (!relativePath) return base;
    return `${base}/${relativePath.replace(/^\//, '')}`;
  }

  /**
   * Get engine assets path or path within engine directory
   * @param relativePath Optional path relative to engine root
   */
  public engine(relativePath?: string): string {
    if (!relativePath) return this.enginePath;
    return `${this.enginePath}/${relativePath.replace(/^\//, '')}`;
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Get maps directory path or specific map file
   */
  public maps(file?: string): string {
    return this.game(file ? `maps/${file}` : 'maps');
  }

  /**
   * Get textures directory path or specific texture file
   */
  public textures(file?: string): string {
    return this.game(file ? `textures/${file}` : 'textures');
  }

  /**
   * Get prefabs directory path or specific prefab file
   */
  public prefabs(file?: string): string {
    return this.game(file ? `prefabs/${file}` : 'prefabs');
  }

  /**
   * Get data directory path or specific data file
   */
  public data(file?: string): string {
    return this.game(file ? `data/${file}` : 'data');
  }

  /**
   * Get music directory path or specific music file
   */
  public music(file?: string): string {
    return this.game(file ? `music/${file}` : 'music');
  }

  /**
   * Get fonts directory path or specific font file
   */
  public fonts(file?: string): string {
    return this.game(file ? `fonts/${file}` : 'fonts');
  }

  // ============================================================================
  // Config File Paths
  // ============================================================================

  /**
   * Get game config.json path
   */
  public configPath(): string {
    return this.game('config.json');
  }

  /**
   * Get engine-settings.json path
   */
  public engineSettingsPath(): string {
    return this.game('engine-settings.json');
  }

  /**
   * Get UI config path
   */
  public uiConfigPath(): string {
    return this.data('ui-config.json');
  }

  /**
   * Get HUD config path
   */
  public hudConfigPath(): string {
    return this.data('hud-config.json');
  }

  // ============================================================================
  // Asset Resolution with Fallback
  // ============================================================================

  /**
   * Resolve an asset path, trying game directory first, then engine fallback
   * @param relativePath Path relative to game/engine root (e.g., 'fonts/Nunito/...')
   * @returns Resolved path that exists
   */
  public async resolve(relativePath: string): Promise<string> {
    // Try game path first
    const gamePath = this.game(relativePath);
    try {
      const response = await fetch(gamePath, { method: 'HEAD' });
      if (response.ok) {
        return gamePath;
      }
    } catch {
      // Fall through to engine path
    }

    // Try engine path
    const enginePath = this.engine(relativePath);
    try {
      const response = await fetch(enginePath, { method: 'HEAD' });
      if (response.ok) {
        return enginePath;
      }
    } catch {
      // Fall through to error
    }

    // Return game path as default (will fail on actual load, but gives correct error)
    console.warn(`[GamePaths] Asset not found in game or engine: ${relativePath}`);
    return gamePath;
  }

  /**
   * Check if an asset exists in game directory
   */
  public async existsInGame(relativePath: string): Promise<boolean> {
    try {
      const response = await fetch(this.game(relativePath), { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if an asset exists in engine directory
   */
  public async existsInEngine(relativePath: string): Promise<boolean> {
    try {
      const response = await fetch(this.engine(relativePath), { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Debug
  // ============================================================================

  /**
   * Get debug info
   */
  public getDebugInfo(): string {
    return [
      'GamePaths',
      '──────────────────',
      `Game: ${this.gameName}`,
      `Engine: ${this.enginePath}`,
      `Initialized: ${this.initialized}`,
      '',
      'Paths:',
      `  config: ${this.configPath()}`,
      `  maps: ${this.maps()}`,
      `  textures: ${this.textures()}`,
      `  prefabs: ${this.prefabs()}`,
      `  data: ${this.data()}`,
      `  music: ${this.music()}`,
    ].join('\n');
  }
}
