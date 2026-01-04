/**
 * CollisionManager - Manages swappable collision backends
 * 
 * Provides a unified API for collision detection that can switch
 * between different backend implementations at runtime.
 */

import { Vector3, Scene } from '@babylonjs/core';
import type { BspFile } from '../loader/bsp/BspLoader';
import {
  CollisionBackend,
  CollisionBackendType,
  TraceResult,
  TraceOptions,
  CollisionStats,
  createDefaultTraceResult,
} from './CollisionBackend';
import { ClipBrushBackend } from './ClipBrushBackend';
import { BabylonPhysicsBackend } from './BabylonPhysicsBackend';

/**
 * Singleton collision manager
 */
export class CollisionManager {
  private static instance: CollisionManager | null = null;
  
  private backends: Map<CollisionBackendType, CollisionBackend> = new Map();
  private activeBackend: CollisionBackend | null = null;
  private bsp: BspFile | null = null;
  private scene: Scene | null = null;
  private initialized = false;

  private constructor() {
    // Register available backends
    this.backends.set('clipbrush', new ClipBrushBackend());
    this.backends.set('babylon', new BabylonPhysicsBackend());
  }

  static getInstance(): CollisionManager {
    if (!CollisionManager.instance) {
      CollisionManager.instance = new CollisionManager();
    }
    return CollisionManager.instance;
  }

  /**
   * Initialize collision with BSP data
   */
  async init(bsp: BspFile, scene?: Scene, preferredBackend?: CollisionBackendType): Promise<void> {
    this.bsp = bsp;
    this.scene = scene ?? null;

    // Initialize all backends
    for (const [type, backend] of this.backends) {
      try {
        await backend.init(bsp, scene);
        console.log(`[CollisionManager] Initialized ${backend.name}`);
      } catch (err) {
        console.warn(`[CollisionManager] Failed to init ${type}:`, err);
      }
    }

    // Set active backend
    const backendType = preferredBackend ?? 'clipbrush';
    this.setBackend(backendType);
    
    this.initialized = true;
    console.log(`[CollisionManager] Ready with ${this.activeBackend?.name ?? 'no backend'}`);
  }

  /**
   * Switch to a different collision backend
   */
  setBackend(type: CollisionBackendType): boolean {
    const backend = this.backends.get(type);
    if (!backend) {
      console.warn(`[CollisionManager] Unknown backend: ${type}`);
      return false;
    }

    this.activeBackend = backend;
    console.log(`[CollisionManager] Switched to ${backend.name}`);
    return true;
  }

  /**
   * Get current backend type
   */
  getBackendType(): CollisionBackendType | null {
    return this.activeBackend?.type ?? null;
  }

  /**
   * Get list of available backends
   */
  getAvailableBackends(): { type: CollisionBackendType; name: string }[] {
    return Array.from(this.backends.entries()).map(([type, backend]) => ({
      type,
      name: backend.name,
    }));
  }

  /**
   * Perform a collision trace
   */
  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    if (!this.activeBackend) {
      return createDefaultTraceResult(start, end);
    }
    return this.activeBackend.trace(start, end, options);
  }

  /**
   * Get content flags at a point
   */
  pointContents(point: Vector3): number {
    return this.activeBackend?.pointContents(point) ?? 0;
  }

  /**
   * Check if a point is on the ground
   */
  isOnGround(point: Vector3, options?: TraceOptions): boolean {
    return this.activeBackend?.isOnGround(point, options) ?? false;
  }

  /**
   * Find ground position below a point
   */
  findGround(point: Vector3, maxDistance?: number): { position: Vector3; normal: Vector3 } | null {
    return this.activeBackend?.findGround(point, maxDistance) ?? null;
  }

  /**
   * Get collision statistics
   */
  getStats(): CollisionStats | null {
    return this.activeBackend?.getStats() ?? null;
  }

  /**
   * Check if collision is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.activeBackend !== null;
  }

  /**
   * Dispose all backends
   */
  dispose(): void {
    for (const backend of this.backends.values()) {
      backend.dispose();
    }
    this.activeBackend = null;
    this.initialized = false;
    this.bsp = null;
    this.scene = null;
  }

  /**
   * Re-initialize with current BSP/scene (e.g., after map change)
   */
  async reinit(): Promise<void> {
    if (this.bsp) {
      const currentType = this.activeBackend?.type;
      await this.init(this.bsp, this.scene ?? undefined, currentType);
    }
  }
}

/**
 * Helper to get the collision manager instance
 */
export function getCollisionManager(): CollisionManager {
  return CollisionManager.getInstance();
}
