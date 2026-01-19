/**
 * LoadingAnimation - Reusable smoke/puff animation for loading screens
 *
 * Creates an animated background effect with colored puffs rising and fading.
 * Used by both the startup LoadingScreen and in-game MapLoadingOverlay.
 *
 * Usage:
 *   const animation = new LoadingAnimation();
 *   animation.create(parentElement, { colors: SHAG_PALETTE });
 *   // ... later ...
 *   animation.destroy();
 */

import { PaletteColor, SHAG_PALETTE } from './LoadingPalettes';

export interface LoadingAnimationConfig {
  /** Color palette for the puffs */
  colors: PaletteColor[];
  /** Number of puff elements to create (default: 30) */
  puffCount: number;
  /** Minimum puff size in pixels (default: 40) */
  minSize: number;
  /** Maximum puff size in pixels (default: 250) */
  maxSize: number;
  /** Minimum animation duration in seconds (default: 8) */
  minDuration: number;
  /** Maximum animation duration in seconds (default: 25) */
  maxDuration: number;
  /** Maximum animation delay in seconds (default: 12) */
  maxDelay: number;
  /** Blur amount in pixels (default: 40) */
  blur: number;
}

const DEFAULT_CONFIG: LoadingAnimationConfig = {
  colors: SHAG_PALETTE,
  puffCount: 30,
  minSize: 40,
  maxSize: 250,
  minDuration: 8,
  maxDuration: 25,
  maxDelay: 12,
  blur: 40,
};

export class LoadingAnimation {
  private container: HTMLDivElement | null = null;
  private puffs: HTMLDivElement[] = [];
  private config: LoadingAnimationConfig = DEFAULT_CONFIG;
  private isPaused: boolean = false;

  /**
   * Create and attach the smoke animation to a parent element
   * @param parent - The parent element to attach the animation container to
   * @param config - Optional configuration overrides
   */
  create(parent: HTMLElement, config?: Partial<LoadingAnimationConfig>): void {
    // Merge config with defaults
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'ui-loading-smoke-container';

    // Create puff elements
    for (let i = 0; i < this.config.puffCount; i++) {
      const puff = this.createPuff(i);
      this.puffs.push(puff);
      this.container.appendChild(puff);
    }

    parent.appendChild(this.container);
  }

  /**
   * Create a single puff element with randomized properties
   */
  private createPuff(index: number): HTMLDivElement {
    const puff = document.createElement('div');
    puff.className = 'ui-loading-smoke-puff';

    // Get color from palette (cycle through)
    const color = this.config.colors[index % this.config.colors.length];

    // Random size within range
    const size = this.config.minSize + Math.random() * (this.config.maxSize - this.config.minSize);
    puff.style.width = `${size}px`;
    puff.style.height = `${size}px`;

    // Random horizontal position
    puff.style.left = `${Math.random() * 100}%`;

    // Random drift direction and rotation
    const driftX = (Math.random() - 0.5) * 200;
    const rotation = (Math.random() - 0.5) * 360;
    puff.style.setProperty('--drift-x', `${driftX}px`);
    puff.style.setProperty('--rotation', `${rotation}deg`);

    // Random animation timing
    const duration = this.config.minDuration + Math.random() * (this.config.maxDuration - this.config.minDuration);
    const delay = Math.random() * this.config.maxDelay;
    puff.style.animationDuration = `${duration}s`;
    puff.style.animationDelay = `${delay}s`;

    // Set color with radial gradient for soft edges
    puff.style.background = `radial-gradient(circle, ${color.bg} 0%, transparent 70%)`;

    // Set blur
    puff.style.filter = `blur(${this.config.blur}px)`;

    return puff;
  }

  /**
   * Pause the animation
   */
  pause(): void {
    if (this.isPaused || !this.container) return;
    this.isPaused = true;
    this.container.style.animationPlayState = 'paused';
    this.puffs.forEach(puff => {
      puff.style.animationPlayState = 'paused';
    });
  }

  /**
   * Resume the animation
   */
  play(): void {
    if (!this.isPaused || !this.container) return;
    this.isPaused = false;
    this.container.style.animationPlayState = 'running';
    this.puffs.forEach(puff => {
      puff.style.animationPlayState = 'running';
    });
  }

  /**
   * Check if animation is currently paused
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Update the color palette dynamically
   * @param colors - New color palette to apply
   */
  setColors(colors: PaletteColor[]): void {
    this.config.colors = colors;
    this.puffs.forEach((puff, index) => {
      const color = colors[index % colors.length];
      puff.style.background = `radial-gradient(circle, ${color.bg} 0%, transparent 70%)`;
    });
  }

  /**
   * Remove the animation and clean up
   */
  destroy(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.puffs = [];
  }

  /**
   * Check if animation is currently active
   */
  get isActive(): boolean {
    return this.container !== null;
  }
}
