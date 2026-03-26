/**
 * ScreenTransition - Handles screen fade effects for map transitions
 *
 * Provides smooth fade-to-black (or other colors) transitions
 * when changing maps or scenes. Only covers the game canvas area,
 * leaving UI elements visible.
 */

import { SkyLightSystem } from "../lighting/SkyLightSystem";
import { UIStyles } from "../ui/UIStyles";

export type TransitionType = "fade" | "fadeWhite" | "fadeColor" | "fadeSky";

export interface TransitionOptions {
  /** Total duration in milliseconds (default: 400) */
  duration?: number;
  /** Color to fade to (default: current sky color, fallback to black) */
  color?: string;
  /** Use current sky/day-cycle color instead of specified color */
  useSkyColor?: boolean;
  /** Easing function (default: ease-in-out) */
  easing?: string;
}

export class ScreenTransition {
  private static instance: ScreenTransition;
  private overlay: HTMLDivElement | null = null;
  private isTransitioning = false;
  private defaultDuration = 400; // ms total (200 fade out + 200 fade in)
  private useSkyColorByDefault = true; // Use sky color by default

  private constructor() {}

  public static getInstance(): ScreenTransition {
    if (!ScreenTransition.instance) {
      ScreenTransition.instance = new ScreenTransition();
    }
    return ScreenTransition.instance;
  }

  /**
   * Initialize the transition overlay (targets game canvas only)
   */
  public init(): void {
    if (this.overlay) return;

    UIStyles.injectBase();

    // Find the game canvas container
    const canvas = document.getElementById("renderCanvas");
    const container = canvas?.parentElement || document.body;

    this.overlay = document.createElement("div");
    this.overlay.id = "screen-transition-overlay";
    this.overlay.className = "ui-screen-transition";

    // Insert overlay into canvas container (so UI stays on top)
    if (container !== document.body) {
      // Make sure container has relative positioning for absolute child
      const containerStyle = window.getComputedStyle(container);
      if (containerStyle.position === "static") {
        container.style.position = "relative";
      }
      container.appendChild(this.overlay);
    } else {
      // Fallback: append to body but use lower z-index
      document.body.appendChild(this.overlay);
    }
  }

  /**
   * Set the default transition duration
   */
  public setDefaultDuration(ms: number): void {
    this.defaultDuration = Math.max(100, ms);
  }

  /**
   * Get the default transition duration
   */
  public getDefaultDuration(): number {
    return this.defaultDuration;
  }

  /**
   * Set whether to use sky color by default
   */
  public setUseSkyColorByDefault(use: boolean): void {
    this.useSkyColorByDefault = use;
  }

  /**
   * Get the current sky color from the day/night cycle
   */
  private getSkyColor(): string {
    try {
      const skyLight = SkyLightSystem.getInstance();
      if (skyLight.isInitialized()) {
        return skyLight.getCurrentSkyColorHex();
      }
    } catch {
      // SkyLightSystem not available
    }
    return "#000000"; // Fallback to black
  }

  /**
   * Perform a fade transition with a callback in the middle
   * Fades out -> calls callback -> fades in
   */
  public async fadeTransition(callback: () => Promise<void>, options?: TransitionOptions): Promise<void> {
    if (this.isTransitioning) {
      console.warn("Transition already in progress");
      return;
    }

    this.init();
    if (!this.overlay) return;

    this.isTransitioning = true;
    const duration = options?.duration ?? this.defaultDuration;
    const halfDuration = duration / 2;
    const easing = options?.easing ?? "ease-in-out";

    // Determine color: explicit color > useSkyColor option > default behavior
    let color: string;
    if (options?.color) {
      color = options.color;
    } else if (options?.useSkyColor !== undefined ? options.useSkyColor : this.useSkyColorByDefault) {
      color = this.getSkyColor();
    } else {
      color = "#000000";
    }

    // Set transition properties
    this.overlay.style.backgroundColor = color;
    this.overlay.style.transition = `opacity ${halfDuration}ms ${easing}`;

    try {
      // Fade out (to sky/specified color)
      await this.fadeOut(halfDuration);

      // Execute the callback (map load, etc.)
      await callback();

      // Small delay to ensure rendering is complete
      await this.delay(50);

      // Fade in (from sky/specified color)
      await this.fadeIn(halfDuration);
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Fade to black (or specified color)
   */
  public async fadeOut(durationMs?: number): Promise<void> {
    this.init();
    if (!this.overlay) return;

    const duration = durationMs ?? this.defaultDuration / 2;
    this.overlay.style.transition = `opacity ${duration}ms ease-in-out`;
    this.overlay.style.opacity = "1";
    this.overlay.style.pointerEvents = "all"; // Block input during transition

    await this.delay(duration);
  }

  /**
   * Fade from black (or specified color) back to normal
   */
  public async fadeIn(durationMs?: number): Promise<void> {
    this.init();
    if (!this.overlay) return;

    const duration = durationMs ?? this.defaultDuration / 2;
    this.overlay.style.transition = `opacity ${duration}ms ease-in-out`;
    this.overlay.style.opacity = "0";

    await this.delay(duration);
    this.overlay.style.pointerEvents = "none"; // Re-enable input
  }

  /**
   * Set the overlay color
   */
  public setColor(color: string): void {
    this.init();
    if (this.overlay) {
      this.overlay.style.backgroundColor = color;
    }
  }

  /**
   * Check if a transition is currently in progress
   */
  public isInTransition(): boolean {
    return this.isTransitioning;
  }

  /**
   * Force reset the transition state (for error recovery)
   */
  public reset(): void {
    if (this.overlay) {
      this.overlay.style.opacity = "0";
      this.overlay.style.pointerEvents = "none";
    }
    this.isTransitioning = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose the overlay
   */
  public dispose(): void {
    if (this.overlay?.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.isTransitioning = false;
  }
}
