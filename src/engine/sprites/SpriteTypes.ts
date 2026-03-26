/**
 * Engine-level sprite type definitions
 * Game-specific sprite data is loaded from a manifest JSON file
 */

export type AnchorPoint = "bottom-center" | "center" | "bottom-left" | "bottom-right";

export interface SpriteDefinition {
  /** Unique identifier for this sprite */
  id: string;

  /** Filename relative to basePath */
  file: string;

  /** Width in world units */
  width: number;

  /** Height in world units */
  height: number;

  /** Anchor point for positioning (default: bottom-center) */
  anchor?: AnchorPoint;

  /** If true, sprite always faces camera (default: true) */
  billboard?: boolean;

  /** If true, render a shadow beneath sprite (default: false) */
  shadow?: boolean;

  /** Shadow opacity 0-1 (default: 0.3) */
  shadowOpacity?: number;

  /** Random scale range [min, max] (default: [1, 1]) */
  scaleRange?: [number, number];

  /** Random Y-axis rotation range in degrees [min, max] - only for non-billboard sprites */
  rotationRange?: [number, number];

  /** Which biomes this sprite can appear in (default: ["all"]) */
  biomes?: string[];
}

export interface SpriteCategory {
  /** List of sprites in this category */
  sprites: SpriteDefinition[];

  /** Default spawn density 0-1 */
  defaultDensity: number;

  /** Avoid placing on roads (default: true) */
  avoidRoads?: boolean;

  /** Prefer placing on grass cells (default: false) */
  preferGrass?: boolean;

  /** Minimum spacing between sprites of this category in world units */
  minSpacing?: number;
}

export interface SpriteManifest {
  /** Manifest version for compatibility */
  version: number;

  /** Base path for sprite files (relative to public/) */
  basePath: string;

  /** Sprite categories */
  categories: Record<string, SpriteCategory>;
}

export interface SpritePlacement {
  /** Sprite definition to use */
  sprite: SpriteDefinition;

  /** World position */
  position: { x: number; y: number; z: number };

  /** Applied scale */
  scale: number;

  /** Y-axis rotation in radians (for non-billboard sprites) */
  rotation?: number;
}
