/**
 * ScreenTransition - Handles screen fade effects for map transitions
 * 
 * Provides smooth fade-to-black (or other colors) transitions
 * when changing maps or scenes.
 */

export type TransitionType = "fade" | "fadeWhite" | "fadeColor";

export interface TransitionOptions {
  /** Total duration in milliseconds (default: 500) */
  duration?: number;
  /** Color to fade to (default: black) */
  color?: string;
  /** Easing function (default: ease-in-out) */
  easing?: string;
}

export class ScreenTransition {
  private static instance: ScreenTransition;
  private overlay: HTMLDivElement | null = null;
  private isTransitioning = false;
  private defaultDuration = 400; // ms total (200 fade out + 200 fade in)

  private constructor() {}

  public static getInstance(): ScreenTransition {
    if (!ScreenTransition.instance) {
      ScreenTransition.instance = new ScreenTransition();
    }
    return ScreenTransition.instance;
  }

  /**
   * Initialize the transition overlay
   */
  public init(): void {
    if (this.overlay) return;

    this.overlay = document.createElement("div");
    this.overlay.id = "screen-transition-overlay";
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: black;
      opacity: 0;
      pointer-events: none;
      z-index: 9999;
      transition: opacity 0.2s ease-in-out;
    `;
    document.body.appendChild(this.overlay);
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
   * Perform a fade transition with a callback in the middle
   * Fades out -> calls callback -> fades in
   */
  public async fadeTransition(
    callback: () => Promise<void>,
    options?: TransitionOptions
  ): Promise<void> {
    if (this.isTransitioning) {
      console.warn("Transition already in progress");
      return;
    }

    this.init();
    if (!this.overlay) return;

    this.isTransitioning = true;
    const duration = options?.duration ?? this.defaultDuration;
    const halfDuration = duration / 2;
    const color = options?.color ?? "black";
    const easing = options?.easing ?? "ease-in-out";

    // Set transition properties
    this.overlay.style.backgroundColor = color;
    this.overlay.style.transition = `opacity ${halfDuration}ms ${easing}`;

    try {
      // Fade out (to black)
      await this.fadeOut(halfDuration);

      // Execute the callback (map load, etc.)
      await callback();

      // Small delay to ensure rendering is complete
      await this.delay(50);

      // Fade in (from black)
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
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.isTransitioning = false;
  }
}
