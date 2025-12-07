import { type Camera, Scene } from "babylonjs";
import { BillboardSprite } from "./BillboardSprite";
import { SpriteSheet, type SpriteSheetConfig } from "./SpriteSheet";

/**
 * SpriteManager handles loading and caching sprite sheets,
 * and provides factory methods for creating sprites.
 */
export class SpriteManager {
  private static instance: SpriteManager;

  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private spriteSheets: Map<string, SpriteSheet> = new Map();
  private sprites: BillboardSprite[] = [];

  private constructor() {}

  public static getInstance(): SpriteManager {
    if (!SpriteManager.instance) {
      SpriteManager.instance = new SpriteManager();
    }
    return SpriteManager.instance;
  }

  /**
   * Initialize the sprite manager with scene and camera
   */
  public init(scene: Scene, camera: Camera): void {
    this.scene = scene;
    this.camera = camera;
    console.log("SpriteManager initialized");
  }

  /**
   * Load a sprite sheet and cache it
   */
  public loadSpriteSheet(config: SpriteSheetConfig): SpriteSheet {
    if (!this.scene) {
      throw new Error("SpriteManager not initialized - call init() first");
    }

    // Check cache
    const existing = this.spriteSheets.get(config.path);
    if (existing) {
      return existing;
    }

    // Create new sprite sheet
    const sheet = new SpriteSheet(config, this.scene);
    this.spriteSheets.set(config.path, sheet);

    return sheet;
  }

  /**
   * Get a cached sprite sheet
   */
  public getSpriteSheet(path: string): SpriteSheet | undefined {
    return this.spriteSheets.get(path);
  }

  /**
   * Create a new billboard sprite
   */
  public createSprite(name: string, spriteSheet: SpriteSheet): BillboardSprite {
    if (!this.scene || !this.camera) {
      throw new Error("SpriteManager not initialized - call init() first");
    }

    const sprite = new BillboardSprite(name, spriteSheet, this.scene, this.camera);
    this.sprites.push(sprite);

    return sprite;
  }

  /**
   * Create a sprite with a new sprite sheet in one call
   */
  public createSpriteWithSheet(name: string, config: SpriteSheetConfig): BillboardSprite {
    const sheet = this.loadSpriteSheet(config);
    return this.createSprite(name, sheet);
  }

  /**
   * Remove a sprite
   */
  public removeSprite(sprite: BillboardSprite): void {
    const index = this.sprites.indexOf(sprite);
    if (index !== -1) {
      this.sprites.splice(index, 1);
      sprite.dispose();
    }
  }

  /**
   * Get all active sprites
   */
  public getSprites(): BillboardSprite[] {
    return [...this.sprites];
  }

  /**
   * Clear all sprites and sprite sheets
   */
  public clear(): void {
    for (const sprite of this.sprites) {
      sprite.dispose();
    }
    this.sprites = [];

    for (const sheet of this.spriteSheets.values()) {
      sheet.dispose();
    }
    this.spriteSheets.clear();
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null && this.camera !== null;
  }
}
