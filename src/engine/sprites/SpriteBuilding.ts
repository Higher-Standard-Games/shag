/**
 * SpriteBuilding - Renders 2D sprite graphics as buildings/objects in the 3D world
 *
 * Supports two rendering modes:
 * - Billboard mode: Sprite always faces the camera (ideal for 2D-style buildings)
 * - Fixed mode: Sprite has fixed rotation in world space (for geometric/decorative elements)
 *
 * Features:
 * - Transparent PNG support with alpha
 * - Emissive glow for neon/light effects
 * - Optional trigger boxes for click interaction
 * - Optional collision boxes for physics/pathfinding
 *
 * Usage in map files:
 * ```
 * {
 * "classname" "sprite_building"
 * "origin" "100 0 200"
 * "texture" "textures/base/shop.png"
 * "width" "128"
 * "height" "128"
 * "billboard" "1"           // Optional: always face camera
 * "angle" "45"              // Optional: Y rotation (non-billboard only)
 * "emissive" "0.2"          // Optional: self-illumination (0=dark at night, 1=always bright)
 * "windowTarget" "shop"     // Optional: dialog to open on click
 * "triggerWidth" "100"      // Optional: clickable area
 * "triggerHeight" "100"
 * "triggerDepth" "30"
 * }
 * ```
 *
 * Day/Night Cycle:
 * - Sprites respond to scene lighting (sun, ambient)
 * - Use "emissive" to control how much the sprite glows in darkness
 * - Low emissive (0-0.2): Building darkens at night
 * - High emissive (0.5+): Neon signs, lit windows stay bright
 */

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

export interface SpriteBuildingConfig {
  /** Unique identifier */
  id: string;
  /** Path to the sprite texture (PNG with transparency) */
  texturePath: string;
  /** Position in world space */
  position: Vector3;
  /** Width of the sprite in world units */
  width: number;
  /** Height of the sprite in world units */
  height: number;
  /** Y rotation in radians (only used when billboard=false) */
  rotation?: number;
  /** If true, sprite always faces camera. If false/undefined, uses fixed rotation */
  billboard?: boolean;
  /** Optional: offset from ground (default: height/2 so bottom touches ground) */
  yOffset?: number;
  /** Optional: trigger properties for interaction */
  trigger?: {
    /** Size of the trigger box around the sprite */
    size: Vector3;
    /** Properties to pass when triggered */
    properties?: Record<string, unknown>;
  };
  /** Optional: collision box for pathfinding/physics */
  collision?: {
    size: Vector3;
  };
  /**
   * Emissive intensity (0-1). Controls self-illumination/glow.
   * - 0 = fully affected by day/night cycle (dark at night)
   * - 0.2 = default, slight glow so visible at night
   * - 0.5+ = bright glow, good for neon signs, lit windows
   * - 1.0 = fully self-lit, ignores day/night
   */
  emissiveIntensity?: number;
  /** Optional: render order for layering */
  renderingGroupId?: number;
}

export class SpriteBuilding {
  private mesh: Mesh;
  private material: StandardMaterial;
  private triggerMesh: Mesh | null = null;
  private collisionMesh: Mesh | null = null;
  private config: SpriteBuildingConfig;
  private scene: Scene;

  constructor(scene: Scene, config: SpriteBuildingConfig) {
    this.scene = scene;
    this.config = config;

    // Create the sprite plane
    this.mesh = MeshBuilder.CreatePlane(
      `sprite_building_${config.id}`,
      { width: config.width, height: config.height },
      scene,
    );

    // Position the sprite
    const yOffset = config.yOffset ?? config.height / 2;
    this.mesh.position = config.position.clone();
    this.mesh.position.y += yOffset;

    // Set rotation or billboard mode
    // billboard=true: sprite always faces camera (for 2D style)
    // billboard=false or not set: fixed rotation (original behavior)
    if (config.billboard) {
      this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    } else {
      // For isometric sprites, typically rotate to face a fixed direction
      this.mesh.rotation.y = config.rotation ?? 0;
    }

    // Create material with texture
    this.material = new StandardMaterial(`sprite_mat_${config.id}`, scene);

    // Ensure texture path starts with /
    const texPath = config.texturePath.startsWith("/") ? config.texturePath : `/${config.texturePath}`;

    // Load texture with alpha support
    const texture = new Texture(
      texPath,
      scene,
      false,
      true,
      Texture.BILINEAR_SAMPLINGMODE,
      () => this.material.markDirty(true), // Force update when loaded
      (_msg, ex) => console.error(`SpriteBuilding: Failed to load texture ${texPath}`, ex),
    );
    texture.hasAlpha = true;

    // Configure material for 2D sprite rendering
    // Use diffuse texture - the hemispheric light will tint it
    this.material.diffuseTexture = texture;
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.ambientColor = new Color3(1, 1, 1);
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.backFaceCulling = false;
    this.material.transparencyMode = 1; // ALPHA_BLEND for smooth edges
    this.material.alpha = 1;

    // No emissive - let scene lighting control the color
    this.material.emissiveColor = new Color3(0, 0, 0);

    this.mesh.material = this.material;

    // Set render order for proper layering
    if (config.renderingGroupId !== undefined) {
      this.mesh.renderingGroupId = config.renderingGroupId;
    }

    // Create trigger mesh if specified
    if (config.trigger) {
      this.createTrigger(config.trigger);
    }

    // Create collision mesh if specified
    if (config.collision) {
      this.createCollision(config.collision);
    }

    // Store metadata for picking
    this.mesh.metadata = {
      isSpriteBuilding: true,
      buildingId: config.id,
      ...config.trigger?.properties,
    };
  }

  private createTrigger(trigger: NonNullable<SpriteBuildingConfig["trigger"]>): void {
    this.triggerMesh = MeshBuilder.CreateBox(
      `sprite_trigger_${this.config.id}`,
      {
        width: trigger.size.x,
        height: trigger.size.y,
        depth: trigger.size.z,
      },
      this.scene,
    );

    this.triggerMesh.position = this.config.position.clone();
    this.triggerMesh.position.y += trigger.size.y / 2;
    this.triggerMesh.visibility = 0; // Invisible
    this.triggerMesh.isPickable = true;

    this.triggerMesh.metadata = {
      isTrigger: true,
      isSpriteBuilding: true,
      buildingId: this.config.id,
      properties: {
        classname: "trigger_sprite",
        ...trigger.properties,
      },
    };
  }

  private createCollision(collision: NonNullable<SpriteBuildingConfig["collision"]>): void {
    this.collisionMesh = MeshBuilder.CreateBox(
      `sprite_collision_${this.config.id}`,
      {
        width: collision.size.x,
        height: collision.size.y,
        depth: collision.size.z,
      },
      this.scene,
    );

    this.collisionMesh.position = this.config.position.clone();
    this.collisionMesh.position.y += collision.size.y / 2;
    this.collisionMesh.visibility = 0;
    this.collisionMesh.isPickable = false;
    this.collisionMesh.checkCollisions = true;

    this.collisionMesh.metadata = {
      isCollision: true,
      buildingId: this.config.id,
    };
  }

  // ==================== Public API ====================

  public getId(): string {
    return this.config.id;
  }

  public getMesh(): Mesh {
    return this.mesh;
  }

  public getPosition(): Vector3 {
    return this.config.position.clone();
  }

  public setPosition(position: Vector3): void {
    this.config.position = position.clone();
    const yOffset = this.config.yOffset ?? this.config.height / 2;
    this.mesh.position = position.clone();
    this.mesh.position.y += yOffset;

    if (this.triggerMesh) {
      this.triggerMesh.position = position.clone();
      this.triggerMesh.position.y += (this.config.trigger?.size.y ?? 0) / 2;
    }

    if (this.collisionMesh) {
      this.collisionMesh.position = position.clone();
      this.collisionMesh.position.y += (this.config.collision?.size.y ?? 0) / 2;
    }
  }

  public setEmissiveIntensity(intensity: number): void {
    this.material.emissiveColor = new Color3(intensity, intensity, intensity);
  }

  /**
   * Update colors based on ambient light for day/night tinting
   * @param ambientColor The scene's current ambient light color
   */
  public updateAmbientTint(_ambientColor: Color3): void {
    // With diffuse texture and no emissive, the scene's hemispheric light
    // automatically tints the sprite. No manual update needed.
    // This method is kept for API compatibility.
  }

  public setVisible(visible: boolean): void {
    this.mesh.setEnabled(visible);
    if (this.triggerMesh) this.triggerMesh.setEnabled(visible);
    if (this.collisionMesh) this.collisionMesh.setEnabled(visible);
  }

  public dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    if (this.triggerMesh) this.triggerMesh.dispose();
    if (this.collisionMesh) this.collisionMesh.dispose();
  }
}

/**
 * SpriteBuildingManager - Manages all sprite buildings in the scene
 */
export class SpriteBuildingManager {
  private static instance: SpriteBuildingManager;
  private scene: Scene | null = null;
  private buildings: Map<string, SpriteBuilding> = new Map();

  private constructor() {}

  public static getInstance(): SpriteBuildingManager {
    if (!SpriteBuildingManager.instance) {
      SpriteBuildingManager.instance = new SpriteBuildingManager();
    }
    return SpriteBuildingManager.instance;
  }

  public init(scene: Scene): void {
    // Clear old buildings when reinitializing (e.g., on HMR reload)
    if (this.scene !== scene) {
      this.buildings.clear();
    }
    this.scene = scene;
  }

  /**
   * Create a sprite building from config
   */
  public create(config: SpriteBuildingConfig): SpriteBuilding | null {
    if (!this.scene) {
      console.error("SpriteBuildingManager not initialized");
      return null;
    }

    if (this.buildings.has(config.id)) {
      console.warn(`Sprite building ${config.id} already exists`);
      return this.buildings.get(config.id)!;
    }

    const building = new SpriteBuilding(this.scene, config);
    this.buildings.set(config.id, building);
    return building;
  }

  /**
   * Create multiple sprite buildings from a sprite sheet
   * Useful for cutting up tileset images
   */
  public createFromSpriteSheet(
    _texturePath: string,
    _configs: Array<{
      id: string;
      position: Vector3;
      /** UV coordinates in the sprite sheet (0-1 range) */
      uvRect: { u: number; v: number; width: number; height: number };
      width: number;
      height: number;
      trigger?: SpriteBuildingConfig["trigger"];
      collision?: SpriteBuildingConfig["collision"];
    }>,
  ): SpriteBuilding[] {
    // For sprite sheets, we'd need custom UV mapping
    // For now, recommend cutting sprites into individual files
    console.warn("Sprite sheet support coming soon - use individual textures for now");
    return [];
  }

  /**
   * Get a building by ID
   */
  public get(id: string): SpriteBuilding | undefined {
    return this.buildings.get(id);
  }

  /**
   * Remove a building
   */
  public remove(id: string): void {
    const building = this.buildings.get(id);
    if (building) {
      building.dispose();
      this.buildings.delete(id);
    }
  }

  /**
   * Get all buildings
   */
  public getAll(): SpriteBuilding[] {
    return Array.from(this.buildings.values());
  }

  /**
   * Update all sprite buildings with ambient light tinting
   * Call this from the game loop or when lighting changes
   */
  public updateAmbientTint(ambientColor: Color3): void {
    for (const building of this.buildings.values()) {
      building.updateAmbientTint(ambientColor);
    }
  }

  /**
   * Dispose all buildings
   */
  public dispose(): void {
    for (const building of this.buildings.values()) {
      building.dispose();
    }
    this.buildings.clear();
  }
}
