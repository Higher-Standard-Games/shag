import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";

/**
 * Configuration for a sprite sheet
 */
export interface SpriteSheetConfig {
  /** Path to the sprite sheet image */
  path: string;
  /** Width of a single frame in pixels */
  frameWidth: number;
  /** Height of a single frame in pixels */
  frameHeight: number;
  /** Number of animation frames per direction */
  framesPerDirection: number;
  /** Number of directions (1, 4, or 8 typically) */
  directions: number;
  /** Frames per second for animation */
  frameRate: number;
  /** Whether the sprite sheet has transparency */
  hasAlpha?: boolean;
  /** Whether sprites should be affected by scene lights */
  receiveLighting?: boolean;
  /** Base ambient light level (0-1) when receiving lighting */
  ambientLevel?: number;
}

/**
 * Direction indices for 8-way sprites
 * Ordered by angle from camera's perspective
 */
export enum SpriteDirection {
  SOUTH = 0, // Facing camera
  SOUTH_WEST = 1,
  WEST = 2,
  NORTH_WEST = 3,
  NORTH = 4, // Facing away
  NORTH_EAST = 5,
  EAST = 6,
  SOUTH_EAST = 7,
}

/**
 * SpriteSheet handles loading and UV calculation for animated sprite sheets.
 *
 * Expected sprite sheet layout (8-direction example):
 * - Rows: Each row is a direction (S, SW, W, NW, N, NE, E, SE)
 * - Columns: Animation frames for that direction
 */
export class SpriteSheet {
  public readonly config: SpriteSheetConfig;
  public readonly material: StandardMaterial;
  public readonly texture: Texture;

  private columnsInSheet: number;
  private rowsInSheet: number;
  private uSize: number;
  private vSize: number;
  private isLoaded = false;

  constructor(config: SpriteSheetConfig, scene: Scene) {
    this.config = config;

    // Calculate grid dimensions
    this.columnsInSheet = config.framesPerDirection;
    this.rowsInSheet = config.directions;
    this.uSize = 1 / this.columnsInSheet;
    this.vSize = 1 / this.rowsInSheet;

    // Create texture
    this.texture = new Texture(config.path, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
    this.texture.hasAlpha = config.hasAlpha ?? true;
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    // Create material
    this.material = new StandardMaterial(`spritemat_${config.path}`, scene);
    this.material.diffuseTexture = this.texture;
    this.material.specularColor.set(0, 0, 0); // No specular
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.backFaceCulling = false; // Visible from both sides

    // Lighting setup
    if (config.receiveLighting) {
      // Sprites receive lighting from scene lights
      const ambient = config.ambientLevel ?? 0.3;
      this.material.ambientColor = new Color3(ambient, ambient, ambient);
      this.material.emissiveColor = new Color3(ambient, ambient, ambient); // Base visibility
    } else {
      // Self-illuminated sprites (original behavior)
      this.material.emissiveTexture = this.texture;
    }

    // Track when loaded
    this.texture.onLoadObservable.addOnce(() => {
      this.isLoaded = true;
      devLog(`SpriteSheet loaded: ${config.path}`);
    });
  }

  /**
   * Get UV coordinates for a specific frame and direction
   */
  public getUVs(frame: number, direction: SpriteDirection | number): number[] {
    const col = frame % this.columnsInSheet;
    const row = direction % this.rowsInSheet;

    const uMin = col * this.uSize;
    const uMax = uMin + this.uSize;
    // V is flipped in most image formats
    const vMin = 1 - (row + 1) * this.vSize;
    const vMax = vMin + this.vSize;

    // UV coordinates for a quad (2 triangles, 4 vertices)
    // Order: bottom-left, bottom-right, top-right, top-left
    return [
      uMin,
      vMin, // bottom-left
      uMax,
      vMin, // bottom-right
      uMax,
      vMax, // top-right
      uMin,
      vMax, // top-left
    ];
  }

  /**
   * Calculate which direction sprite to show based on entity facing and camera angle
   *
   * @param entityAngle - The angle the entity is facing (radians, 0 = +Z)
   * @param cameraAngle - The angle from entity to camera (radians)
   * @returns The sprite direction index to use
   */
  public static calculateDirection(entityAngle: number, cameraAngle: number): SpriteDirection {
    // Calculate relative angle (how the entity faces relative to camera view)
    let relativeAngle = entityAngle - cameraAngle;

    // Normalize to 0-2PI
    while (relativeAngle < 0) relativeAngle += Math.PI * 2;
    while (relativeAngle >= Math.PI * 2) relativeAngle -= Math.PI * 2;

    // Convert to 8 directions (each direction covers 45 degrees)
    const sector = Math.floor((relativeAngle + Math.PI / 8) / (Math.PI / 4)) % 8;

    // Map sector to our direction enum
    const directionMap: SpriteDirection[] = [
      SpriteDirection.SOUTH, // 0: facing camera
      SpriteDirection.SOUTH_WEST, // 1
      SpriteDirection.WEST, // 2
      SpriteDirection.NORTH_WEST, // 3
      SpriteDirection.NORTH, // 4: facing away
      SpriteDirection.NORTH_EAST, // 5
      SpriteDirection.EAST, // 6
      SpriteDirection.SOUTH_EAST, // 7
    ];

    return directionMap[sector];
  }

  /**
   * For 4-direction sprites, map 8-direction to 4
   */
  public static to4Direction(dir: SpriteDirection): number {
    const map: Record<SpriteDirection, number> = {
      [SpriteDirection.SOUTH]: 0,
      [SpriteDirection.SOUTH_WEST]: 1,
      [SpriteDirection.WEST]: 1,
      [SpriteDirection.NORTH_WEST]: 2,
      [SpriteDirection.NORTH]: 2,
      [SpriteDirection.NORTH_EAST]: 3,
      [SpriteDirection.EAST]: 3,
      [SpriteDirection.SOUTH_EAST]: 0,
    };
    return map[dir];
  }

  public get loaded(): boolean {
    return this.isLoaded;
  }

  public dispose(): void {
    this.material.dispose();
    this.texture.dispose();
  }
}
