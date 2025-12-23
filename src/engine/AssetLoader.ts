import { MapParser, type Entity } from "./loader/MapParser";
import { PrefabLoader } from "./loader/PrefabLoader";

export interface GameConfig {
  game: {
    title: string;
    version: string;
    startMap: string;
  };
  assets: {
    maps: string[];
    menuMap: string;
    prefabs: string[];
    music: {
      menu: string;
      ingame?: string;
      maps: Record<string, string>;
    };
    textures: string[];
  };
  settings: {
    defaultVolume: number;
    musicEnabled: boolean;
    sfxEnabled: boolean;
  };
}

export interface LoadedMap {
  name: string;
  entities: Entity[];
  raw: string;
}

export interface LoadProgress {
  current: number;
  total: number;
  currentAsset: string;
  phase: "config" | "maps" | "prefabs" | "textures" | "audio" | "complete";
}

export type ProgressCallback = (progress: LoadProgress) => void;

export class AssetLoader {
  private static instance: AssetLoader;

  private config: GameConfig | null = null;
  private loadedMaps: Map<string, LoadedMap> = new Map();
  private loadedAudio: Map<string, HTMLAudioElement> = new Map();

  private constructor() {}

  public static getInstance(): AssetLoader {
    if (!AssetLoader.instance) {
      AssetLoader.instance = new AssetLoader();
    }
    return AssetLoader.instance;
  }

  public async loadAll(onProgress?: ProgressCallback): Promise<void> {
    // Phase 1: Load config
    onProgress?.({
      current: 0,
      total: 1,
      currentAsset: "config.json",
      phase: "config",
    });

    await this.loadConfig();

    if (!this.config) {
      throw new Error("Failed to load game config");
    }

    const totalAssets =
      this.config.assets.maps.length +
      (this.config.assets.prefabs?.length || 0) +
      (this.config.assets.music.menu ? 1 : 0) +
      Object.keys(this.config.assets.music.maps).length;

    let loaded = 0;

    // Phase 2: Load maps
    for (const mapName of this.config.assets.maps) {
      onProgress?.({
        current: loaded,
        total: totalAssets,
        currentAsset: mapName,
        phase: "maps",
      });

      await this.loadMap(mapName);
      loaded++;
    }

    // Phase 3: Load prefabs
    if (this.config.assets.prefabs) {
      for (const prefabName of this.config.assets.prefabs) {
        onProgress?.({
          current: loaded,
          total: totalAssets,
          currentAsset: prefabName,
          phase: "prefabs",
        });

        await PrefabLoader.getInstance().loadPrefab(prefabName);
        loaded++;
      }
    }

    // Phase 4: Load audio (don't fail if audio files don't exist yet)
    if (this.config.assets.music.menu) {
      onProgress?.({
        current: loaded,
        total: totalAssets,
        currentAsset: this.config.assets.music.menu,
        phase: "audio",
      });

      await this.loadAudio("menu", this.config.assets.music.menu);
      loaded++;
    }

    // Load ingame music if specified
    if (this.config.assets.music.ingame) {
      onProgress?.({
        current: loaded,
        total: totalAssets,
        currentAsset: this.config.assets.music.ingame,
        phase: "audio",
      });

      // Extract filename without extension as key
      const ingameKey = this.config.assets.music.ingame.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
      await this.loadAudio(ingameKey, this.config.assets.music.ingame);
      loaded++;
    }

    for (const [mapName, musicPath] of Object.entries(this.config.assets.music.maps)) {
      onProgress?.({
        current: loaded,
        total: totalAssets,
        currentAsset: musicPath,
        phase: "audio",
      });

      await this.loadAudio(mapName, musicPath);
      loaded++;
    }

    onProgress?.({
      current: totalAssets,
      total: totalAssets,
      currentAsset: "",
      phase: "complete",
    });
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/game/config.json");
      this.config = await response.json();
    } catch (e) {
      console.error("Failed to load config:", e);
      throw e;
    }
  }

  private async loadMap(mapName: string): Promise<void> {
    try {
      // Handle both "mapname.map" and "maps/subdir/mapname.map" formats
      const mapPath = mapName.startsWith("maps/") ? `/${mapName}` : `/maps/${mapName}`;
      const response = await fetch(mapPath);
      const raw = await response.text();
      const entities = MapParser.parse(raw);

      this.loadedMaps.set(mapName, {
        name: mapName,
        entities,
        raw,
      });

      console.log(`Loaded map: ${mapName}`);
    } catch (e) {
      console.error(`Failed to load map ${mapName}:`, e);
      // Don't throw - allow game to continue with other maps
    }
  }

  private async loadAudio(key: string, path: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(`/game/${path}`);
      audio.preload = "auto";

      audio.addEventListener("canplaythrough", () => {
        this.loadedAudio.set(key, audio);
        console.log(`Loaded audio: ${path}`);
        resolve();
      });

      audio.addEventListener("error", () => {
        console.warn(`Audio not found (optional): ${path}`);
        resolve(); // Don't fail on missing audio
      });

      // Trigger load
      audio.load();

      // Timeout fallback
      setTimeout(resolve, 3000);
    });
  }

  public getConfig(): GameConfig | null {
    return this.config;
  }

  public getMap(name: string): LoadedMap | undefined {
    return this.loadedMaps.get(name);
  }

  public getAudio(key: string): HTMLAudioElement | undefined {
    return this.loadedAudio.get(key);
  }

  public getAllMaps(): Map<string, LoadedMap> {
    return this.loadedMaps;
  }
}
