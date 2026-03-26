/**
 * TextureMemoryManager - Texture LOD and memory budget management
 *
 * Critical for mobile performance:
 * - Tracks texture memory usage
 * - Enforces memory budgets
 * - Supports texture LOD (Level of Detail)
 * - Auto-downsample textures on low-memory devices
 *
 * Usage:
 *   const manager = TextureMemoryManager.getInstance();
 *   manager.init({ memoryBudgetMB: 128 }); // 128MB budget for mobile
 *
 *   // Check before loading large textures
 *   if (manager.canAllocate(textureSize)) {
 *     // Load texture
 *     manager.trackTexture(texture, textureSize);
 *   } else {
 *     // Load lower-res version
 *   }
 */

import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";

export interface TextureMemoryConfig {
  /** Memory budget in MB (default: 256 for desktop, 128 for mobile) */
  memoryBudgetMB: number;
  /** Warn when usage exceeds this percentage (default: 0.8 = 80%) */
  warningThreshold: number;
  /** Auto-unload textures when budget exceeded (default: false) */
  autoUnload: boolean;
  /** Default max texture size (default: 2048) */
  maxTextureSize: number;
  /** Enable LOD system (default: true) */
  lodEnabled: boolean;
  /** LOD bias - higher = lower quality (default: 0) */
  lodBias: number;
}

export interface TrackedTexture {
  /** Texture reference */
  texture: BaseTexture;
  /** Estimated memory size in bytes */
  sizeBytes: number;
  /** Original dimensions */
  originalSize: { width: number; height: number };
  /** Current LOD level (0 = full, 1 = half, 2 = quarter, etc.) */
  lodLevel: number;
  /** Last access timestamp (for LRU eviction) */
  lastAccess: number;
  /** Priority (higher = less likely to be evicted) */
  priority: number;
}

export type QualityLevel = "ultra" | "high" | "medium" | "low" | "potato";

const QUALITY_PRESETS: Record<QualityLevel, Partial<TextureMemoryConfig>> = {
  ultra: { memoryBudgetMB: 512, maxTextureSize: 4096, lodBias: 0 },
  high: { memoryBudgetMB: 256, maxTextureSize: 2048, lodBias: 0 },
  medium: { memoryBudgetMB: 128, maxTextureSize: 1024, lodBias: 1 },
  low: { memoryBudgetMB: 64, maxTextureSize: 512, lodBias: 2 },
  potato: { memoryBudgetMB: 32, maxTextureSize: 256, lodBias: 3 },
};

/**
 * Manages texture memory and LOD for performance optimization
 */
export class TextureMemoryManager {
  private static instance: TextureMemoryManager;
  private _scene: Scene | null = null;

  private config: TextureMemoryConfig = {
    memoryBudgetMB: 256,
    warningThreshold: 0.8,
    autoUnload: false,
    maxTextureSize: 2048,
    lodEnabled: true,
    lodBias: 0,
  };

  private trackedTextures: Map<string, TrackedTexture> = new Map();
  private currentUsageBytes: number = 0;
  private peakUsageBytes: number = 0;

  private constructor() {}

  public static getInstance(): TextureMemoryManager {
    if (!TextureMemoryManager.instance) {
      TextureMemoryManager.instance = new TextureMemoryManager();
    }
    return TextureMemoryManager.instance;
  }

  /**
   * Initialize with scene and optional config
   */
  public init(scene: Scene, config?: Partial<TextureMemoryConfig>): void {
    this._scene = scene;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Auto-detect mobile and adjust budget
    if (this.isMobileDevice() && !config?.memoryBudgetMB) {
      this.config.memoryBudgetMB = 128;
      this.config.maxTextureSize = 1024;
      console.log("[TextureMemoryManager] Mobile detected, using reduced budget");
    }

    console.log(`[TextureMemoryManager] Initialized with ${this.config.memoryBudgetMB}MB budget`);
  }

  /**
   * Apply a quality preset
   */
  public setQuality(level: QualityLevel): void {
    const preset = QUALITY_PRESETS[level];
    this.config = { ...this.config, ...preset };
    console.log(`[TextureMemoryManager] Quality set to '${level}'`);
  }

  /**
   * Get current quality settings
   */
  public getConfig(): Readonly<TextureMemoryConfig> {
    return { ...this.config };
  }

  /** Get scene reference */
  public getScene(): Scene | null {
    return this._scene;
  }

  /**
   * Check if we can allocate memory for a texture
   */
  public canAllocate(sizeBytes: number): boolean {
    const budgetBytes = this.config.memoryBudgetMB * 1024 * 1024;
    return this.currentUsageBytes + sizeBytes <= budgetBytes;
  }

  /**
   * Get available memory in bytes
   */
  public getAvailableBytes(): number {
    const budgetBytes = this.config.memoryBudgetMB * 1024 * 1024;
    return Math.max(0, budgetBytes - this.currentUsageBytes);
  }

  /**
   * Get current usage percentage (0-1)
   */
  public getUsagePercent(): number {
    const budgetBytes = this.config.memoryBudgetMB * 1024 * 1024;
    return this.currentUsageBytes / budgetBytes;
  }

  /**
   * Track a loaded texture
   */
  public trackTexture(texture: BaseTexture, priority: number = 0): void {
    const id = texture.uid.toString();

    if (this.trackedTextures.has(id)) {
      // Update last access time
      const tracked = this.trackedTextures.get(id)!;
      tracked.lastAccess = Date.now();
      return;
    }

    const size = texture.getSize();
    const sizeBytes = this.estimateTextureSize(size.width, size.height, texture);

    const tracked: TrackedTexture = {
      texture,
      sizeBytes,
      originalSize: { width: size.width, height: size.height },
      lodLevel: 0,
      lastAccess: Date.now(),
      priority,
    };

    this.trackedTextures.set(id, tracked);
    this.currentUsageBytes += sizeBytes;
    this.peakUsageBytes = Math.max(this.peakUsageBytes, this.currentUsageBytes);

    // Check budget
    if (this.getUsagePercent() > this.config.warningThreshold) {
      console.warn(`[TextureMemoryManager] Memory usage at ${(this.getUsagePercent() * 100).toFixed(1)}%`);

      if (this.config.autoUnload) {
        this.evictLRU();
      }
    }
  }

  /**
   * Untrack and optionally dispose a texture
   */
  public untrackTexture(texture: BaseTexture, dispose: boolean = false): void {
    const id = texture.uid.toString();
    const tracked = this.trackedTextures.get(id);

    if (tracked) {
      this.currentUsageBytes -= tracked.sizeBytes;
      this.trackedTextures.delete(id);

      if (dispose) {
        texture.dispose();
      }
    }
  }

  /**
   * Evict least recently used textures to free memory
   */
  public evictLRU(targetFreeBytes?: number): number {
    const target = targetFreeBytes ?? this.config.memoryBudgetMB * 1024 * 1024 * 0.2; // Free 20% by default
    let freedBytes = 0;

    // Sort by priority (low first) then by last access (oldest first)
    const sorted = Array.from(this.trackedTextures.entries()).sort((a, b) => {
      if (a[1].priority !== b[1].priority) {
        return a[1].priority - b[1].priority;
      }
      return a[1].lastAccess - b[1].lastAccess;
    });

    for (const [id, tracked] of sorted) {
      if (freedBytes >= target) break;

      // Don't evict high-priority textures
      if (tracked.priority > 5) continue;

      freedBytes += tracked.sizeBytes;
      this.currentUsageBytes -= tracked.sizeBytes;
      tracked.texture.dispose();
      this.trackedTextures.delete(id);

      console.log(`[TextureMemoryManager] Evicted texture, freed ${(tracked.sizeBytes / 1024).toFixed(1)}KB`);
    }

    return freedBytes;
  }

  /**
   * Calculate recommended texture size based on LOD settings
   */
  public getRecommendedSize(originalWidth: number, originalHeight: number): { width: number; height: number } {
    let maxSize = this.config.maxTextureSize;

    // Apply LOD bias (each level halves the size)
    if (this.config.lodEnabled && this.config.lodBias > 0) {
      maxSize = maxSize >> this.config.lodBias;
    }

    // Clamp to max size while maintaining aspect ratio
    const scale = Math.min(1, maxSize / Math.max(originalWidth, originalHeight));

    return {
      width: Math.floor(originalWidth * scale),
      height: Math.floor(originalHeight * scale),
    };
  }

  /**
   * Check if a texture should be downscaled
   */
  public shouldDownscale(width: number, height: number): boolean {
    const maxDim = Math.max(width, height);
    return maxDim > this.config.maxTextureSize;
  }

  /**
   * Estimate texture memory size in bytes
   */
  public estimateTextureSize(width: number, height: number, texture?: BaseTexture): number {
    // Assume RGBA (4 bytes per pixel) by default
    const bytesPerPixel = 4;

    // Check for compressed formats (much smaller)
    if (texture) {
      const internalFormat = (texture as any)._texture?.format;
      if (internalFormat) {
        // DXT/BC compression is roughly 0.5-1 byte per pixel
        // ASTC/ETC2 varies by block size
        // For now, assume standard RGBA
      }
    }

    const baseSize = width * height * bytesPerPixel;

    // Add ~33% for mipmaps if enabled
    const withMipmaps = baseSize * 1.33;

    return Math.ceil(withMipmaps);
  }

  /**
   * Get memory stats
   */
  public getStats(): {
    currentMB: number;
    peakMB: number;
    budgetMB: number;
    usagePercent: number;
    textureCount: number;
  } {
    return {
      currentMB: this.currentUsageBytes / (1024 * 1024),
      peakMB: this.peakUsageBytes / (1024 * 1024),
      budgetMB: this.config.memoryBudgetMB,
      usagePercent: this.getUsagePercent(),
      textureCount: this.trackedTextures.size,
    };
  }

  /**
   * Clear all tracked textures (doesn't dispose them)
   */
  public clear(): void {
    this.trackedTextures.clear();
    this.currentUsageBytes = 0;
  }

  /**
   * Dispose all tracked textures and clear
   */
  public disposeAll(): void {
    for (const tracked of this.trackedTextures.values()) {
      tracked.texture.dispose();
    }
    this.clear();
  }

  /**
   * Dispose the manager
   */
  public dispose(): void {
    this.clear();
    this._scene = null;
  }

  /**
   * Detect mobile device
   */
  private isMobileDevice(): boolean {
    if (typeof navigator === "undefined") return false;

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    if (TextureMemoryManager.instance) {
      TextureMemoryManager.instance.dispose();
    }
    TextureMemoryManager.instance = null as any;
  }
}
