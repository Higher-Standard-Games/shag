import { type Entity, MapParser } from "./MapParser";
import { GamePaths } from "../core/GamePaths";

export interface PrefabDefinition {
  name: string;
  entities: Entity[];
  raw: string;
}

/**
 * PrefabLoader handles loading and caching .map files used as prefabs/models.
 * 
 * Convention: Prefab origin (0,0,0) is the floor/anchor point.
 * When modeling in TrenchBroom, place the bottom center of your model at origin.
 */
export class PrefabLoader {
  private static instance: PrefabLoader;
  private prefabCache: Map<string, PrefabDefinition> = new Map();
  private basePath: string | null = null;

  private constructor() {}

  public static getInstance(): PrefabLoader {
    if (!PrefabLoader.instance) {
      PrefabLoader.instance = new PrefabLoader();
    }
    return PrefabLoader.instance;
  }

  /**
   * Set the base path for prefab loading
   */
  public setBasePath(path: string): void {
    this.basePath = path;
  }

  /**
   * Load a prefab .map file and cache it
   */
  public async loadPrefab(name: string): Promise<PrefabDefinition | null> {
    // Check cache first
    if (this.prefabCache.has(name)) {
      return this.prefabCache.get(name)!;
    }

    try {
      // Normalize path - add .map extension if not present
      const fileName = name.endsWith(".map") ? name : `${name}.map`;
      const basePath = this.basePath || GamePaths.getInstance().prefabs();
      const fullPath = `${basePath}/${fileName}`;

      console.log(`Loading prefab: ${fullPath}`);

      const response = await fetch(fullPath);
      if (!response.ok) {
        console.error(`Prefab not found: ${fullPath}`);
        return null;
      }

      const raw = await response.text();
      const entities = MapParser.parse(raw);

      const prefab: PrefabDefinition = {
        name,
        entities,
        raw,
      };

      this.prefabCache.set(name, prefab);
      console.log(`Loaded prefab: ${name} (${entities.length} entities)`);

      return prefab;
    } catch (e) {
      console.error(`Failed to load prefab ${name}:`, e);
      return null;
    }
  }

  /**
   * Get a cached prefab (must be loaded first)
   */
  public getPrefab(name: string): PrefabDefinition | undefined {
    return this.prefabCache.get(name);
  }

  /**
   * Preload multiple prefabs
   */
  public async preloadPrefabs(names: string[]): Promise<void> {
    const promises = names.map((name) => this.loadPrefab(name));
    await Promise.all(promises);
    console.log(`Preloaded ${names.length} prefabs`);
  }

  /**
   * Clear the prefab cache
   */
  public clearCache(): void {
    this.prefabCache.clear();
  }

  /**
   * Check if a prefab is loaded
   */
  public isPrefabLoaded(name: string): boolean {
    return this.prefabCache.has(name);
  }
}
