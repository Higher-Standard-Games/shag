import type { Camera } from "@babylonjs/core/Cameras/camera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { BillboardSprite } from "./BillboardSprite";
import { SpriteSheet, type SpriteSheetConfig } from "./SpriteSheet";
import type { AnchorPoint, SpriteCategory, SpriteDefinition, SpriteManifest } from "./SpriteTypes";

export type { AnchorPoint, SpriteCategory, SpriteDefinition, SpriteManifest } from "./SpriteTypes";

/**
 * A simple static sprite (single image, no animation)
 */
export interface StaticSprite {
  mesh: Mesh;
  shadowMesh: Mesh | null;
  definition: SpriteDefinition;
  dispose: () => void;
}

/**
 * SpriteManager handles loading and caching sprite sheets,
 * and provides factory methods for creating sprites.
 *
 * Supports both animated sprites (via SpriteSheet) and static sprites (via manifest).
 */
export class SpriteManager {
  private static instance: SpriteManager;

  /** Clear the cached singleton so ServiceLocator re-inits a fresh one (QA-WO13). */
  static resetInstance(): void {
    SpriteManager.instance = null as unknown as SpriteManager;
  }

  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private spriteSheets: Map<string, SpriteSheet> = new Map();
  private sprites: BillboardSprite[] = [];

  // Manifest-based sprites
  private manifest: SpriteManifest | null = null;
  private staticSprites: StaticSprite[] = [];
  private textureCache: Map<string, Texture> = new Map();
  private materialCache: Map<string, StandardMaterial> = new Map();

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

  // ==================== Manifest-based Static Sprites ====================

  /**
   * Load a sprite manifest JSON file
   */
  public async loadManifest(path: string): Promise<SpriteManifest> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load sprite manifest: ${path}`);
    }
    this.manifest = await response.json();
    console.log(`SpriteManager: Loaded manifest with ${Object.keys(this.manifest!.categories).length} categories`);
    return this.manifest!;
  }

  /**
   * Get the loaded manifest
   */
  public getManifest(): SpriteManifest | null {
    return this.manifest;
  }

  /**
   * Get a sprite definition by category and id
   */
  public getSpriteDefinition(category: string, id: string): SpriteDefinition | undefined {
    if (!this.manifest) return undefined;
    const cat = this.manifest.categories[category];
    if (!cat) return undefined;
    return cat.sprites.find((s) => s.id === id);
  }

  /**
   * Get all sprites in a category
   */
  public getCategory(category: string): SpriteCategory | undefined {
    return this.manifest?.categories[category];
  }

  /**
   * Get sprites filtered by biome
   */
  public getSpritesByBiome(category: string, biome: string): SpriteDefinition[] {
    const cat = this.manifest?.categories[category];
    if (!cat) return [];
    return cat.sprites.filter((s) => {
      const biomes = s.biomes ?? ["all"];
      return biomes.includes("all") || biomes.includes(biome);
    });
  }

  /**
   * Create a static sprite from a definition
   */
  public createStaticSprite(definition: SpriteDefinition, position: Vector3, scale: number = 1): StaticSprite | null {
    if (!this.scene) {
      console.warn("SpriteManager: Cannot create static sprite - not initialized");
      return null;
    }

    // If file already has a path (contains /), use it directly
    // Otherwise, prepend manifest basePath if available
    const hasPath = definition.file.includes("/");
    const basePath = hasPath ? "" : this.manifest?.basePath || "";
    const texturePath = basePath + definition.file;

    console.log(`SpriteManager: Creating sprite from ${texturePath} at ${position.toString()}`);

    // Get or create material (cached per texture)
    let material = this.materialCache.get(texturePath);
    if (!material) {
      const texture = new Texture(texturePath, this.scene, false, true);
      texture.hasAlpha = true;

      material = new StandardMaterial(`mat_${definition.id}`, this.scene);
      material.diffuseTexture = texture;
      material.diffuseColor = new Color3(1, 1, 1);
      material.specularColor = new Color3(0, 0, 0);
      material.emissiveColor = new Color3(0, 0, 0); // No self-illumination - affected by scene lighting
      material.useAlphaFromDiffuseTexture = true;
      material.backFaceCulling = false;

      this.materialCache.set(texturePath, material);
      this.textureCache.set(texturePath, texture);
    }

    // Calculate dimensions
    const width = definition.width * scale;
    const height = definition.height * scale;
    const anchor = definition.anchor ?? "bottom-center";
    const isBillboard = definition.billboard !== false; // default true

    // Create quad mesh
    const mesh = this.createQuadMesh(`sprite_${definition.id}_${Date.now()}`, width, height, anchor);
    mesh.material = material;
    mesh.position.copyFrom(position);

    if (isBillboard) {
      mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    }

    // Create shadow if enabled
    let shadowMesh: Mesh | null = null;
    if (definition.shadow) {
      shadowMesh = this.createShadowMesh(
        `${mesh.name}_shadow`,
        width * 0.8,
        height * 0.4,
        definition.shadowOpacity ?? 0.3,
      );
      shadowMesh.position.set(position.x, position.y + 0.1, position.z);
    }

    const staticSprite: StaticSprite = {
      mesh,
      shadowMesh,
      definition,
      dispose: () => {
        mesh.dispose();
        if (shadowMesh) shadowMesh.dispose();
        const idx = this.staticSprites.indexOf(staticSprite);
        if (idx !== -1) this.staticSprites.splice(idx, 1);
      },
    };

    this.staticSprites.push(staticSprite);
    return staticSprite;
  }

  /**
   * Create a quad mesh for a static sprite
   */
  private createQuadMesh(name: string, width: number, height: number, anchor: AnchorPoint): Mesh {
    const mesh = new Mesh(name, this.scene!);

    // Calculate vertex positions based on anchor
    let yOffset = 0;
    let xOffset = 0;

    switch (anchor) {
      case "bottom-center":
        yOffset = 0;
        xOffset = -width / 2;
        break;
      case "center":
        yOffset = -height / 2;
        xOffset = -width / 2;
        break;
      case "bottom-left":
        yOffset = 0;
        xOffset = 0;
        break;
      case "bottom-right":
        yOffset = 0;
        xOffset = -width;
        break;
    }

    const positions = [
      xOffset,
      yOffset,
      0, // bottom-left
      xOffset + width,
      yOffset,
      0, // bottom-right
      xOffset + width,
      yOffset + height,
      0, // top-right
      xOffset,
      yOffset + height,
      0, // top-left
    ];

    const indices = [0, 1, 2, 0, 2, 3];
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1]; // bottom-left, bottom-right, top-right, top-left

    mesh.setVerticesData("position", positions);
    mesh.setVerticesData("normal", normals);
    mesh.setVerticesData("uv", uvs);
    mesh.setIndices(indices);

    return mesh;
  }

  /**
   * Create a shadow mesh (ellipse on ground)
   */
  private createShadowMesh(name: string, width: number, depth: number, opacity: number): Mesh {
    const mesh = MeshBuilder.CreateDisc(name, { radius: 0.5, tessellation: 12 }, this.scene!);
    mesh.rotation.x = Math.PI / 2;
    mesh.scaling.set(width, depth, 1);

    const material = new StandardMaterial(`${name}_mat`, this.scene!);
    material.diffuseColor = new Color3(0, 0, 0);
    material.specularColor = new Color3(0, 0, 0);
    material.emissiveColor = new Color3(0, 0, 0);
    material.alpha = opacity;
    material.backFaceCulling = false;

    mesh.material = material;
    return mesh;
  }

  /**
   * Get all static sprites
   */
  public getStaticSprites(): StaticSprite[] {
    return [...this.staticSprites];
  }

  /**
   * Clear all static sprites
   */
  public clearStaticSprites(): void {
    for (const sprite of this.staticSprites) {
      sprite.dispose();
    }
    this.staticSprites = [];
  }

  /**
   * Clear all caches (call when changing maps)
   */
  public clearCaches(): void {
    this.clearStaticSprites();

    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();

    for (const material of this.materialCache.values()) {
      material.dispose();
    }
    this.materialCache.clear();
  }
}
