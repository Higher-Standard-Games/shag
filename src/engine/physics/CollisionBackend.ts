/**
 * CollisionBackend - Abstract interface for swappable collision systems
 * 
 * Implementations:
 * - BrushCollisionBackend: Original BSP brush-based collision
 * - ClipBrushBackend: Generated clip brushes from floor faces
 * - BabylonPhysicsBackend: Babylon.js mesh-based collision
 */

import { Vector3, Scene } from 'babylonjs';
import type { BspFile } from '../loader/bsp/BspLoader';

/**
 * Result of a collision trace
 */
export interface TraceResult {
  /** Fraction of trace completed (0-1, 1 = no hit) */
  fraction: number;
  /** End position after collision */
  endPos: Vector3;
  /** Surface normal at hit point (if hit) */
  normal?: Vector3;
  /** Whether trace started inside solid */
  startSolid: boolean;
  /** Whether trace is entirely inside solid */
  allSolid: boolean;
  /** Content flags at hit point */
  contents: number;
  hitBrushIndex?: number;
  hitTextureName?: string;
}

/**
 * Options for collision trace
 */
export interface TraceOptions {
  /** Trace radius for sphere/capsule traces (0 = ray) */
  radius?: number;
  /** Height for capsule traces */
  height?: number;
  /** Content mask - only collide with these contents */
  contentMask?: number;
  /**
   * If true, restricts brush-based collision to clip textures only
   * (e.g. textures/common/fullclip, textures/common/playerclip)
   */
  clipTexturesOnly?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Backend type identifier
 */
export type CollisionBackendType = 'brush' | 'clipbrush' | 'babylon';

/**
 * Abstract collision backend interface
 */
export interface CollisionBackend {
  /** Backend type identifier */
  readonly type: CollisionBackendType;
  
  /** Human-readable name */
  readonly name: string;
  
  /**
   * Initialize the backend with BSP data
   */
  init(bsp: BspFile, scene?: Scene): Promise<void>;
  
  /**
   * Perform a collision trace from start to end
   */
  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult;
  
  /**
   * Get content flags at a point
   */
  pointContents(point: Vector3): number;
  
  /**
   * Check if a point is on the ground
   */
  isOnGround(point: Vector3, options?: TraceOptions): boolean;
  
  /**
   * Find ground position below a point
   */
  findGround(point: Vector3, maxDistance?: number): { position: Vector3; normal: Vector3 } | null;
  
  /**
   * Get debug statistics
   */
  getStats(): CollisionStats;
  
  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Collision statistics for debugging
 */
export interface CollisionStats {
  /** Number of traces performed */
  traceCount: number;
  /** Number of collision hits */
  hitCount: number;
  /** Average trace time in ms */
  avgTraceTimeMs: number;
  /** Backend-specific stats */
  backendStats: Record<string, number>;
}

/**
 * Create a default trace result (no collision)
 */
export function createDefaultTraceResult(_start: Vector3, end: Vector3): TraceResult {
  return {
    fraction: 1.0,
    endPos: end.clone(),
    startSolid: false,
    allSolid: false,
    contents: 0,
  };
}

/**
 * Content flags (Q3-compatible)
 */
export const Contents = {
  SOLID: 0x1,
  LAVA: 0x8,
  SLIME: 0x10,
  WATER: 0x20,
  FOG: 0x40,
  PLAYERCLIP: 0x10000,
  MONSTERCLIP: 0x20000,
  TRIGGER: 0x40000000,
} as const;
