/**
 * UIScale - Cross-platform UI scaling system
 * 
 * Provides consistent UI scaling across different screen sizes and devices.
 * Design UI at a reference resolution, then scale proportionally.
 * 
 * Usage:
 * 1. Initialize: UIScale.getInstance().init()
 * 2. Use CSS variables: var(--ui-scale), var(--ui-space-md), etc.
 * 3. Or use JS: UIScale.getInstance().px(16) for scaled pixels
 */

export type ScaleMode = 'fit' | 'fill' | 'width' | 'height';

export interface UIScaleConfig {
  /** Reference design width (default: 1920) */
  designWidth: number;
  /** Reference design height (default: 1080) */
  designHeight: number;
  /** Minimum scale factor (default: 0.4) */
  minScale: number;
  /** Maximum scale factor (default: 2.5) */
  maxScale: number;
  /** Scale calculation mode (default: 'fit') */
  scaleMode: ScaleMode;
  /** Minimum touch target in design pixels (default: 44) */
  minTouchTarget: number;
  /** Breakpoint for mobile detection in design pixels (default: 768) */
  mobileBreakpoint: number;
}

const DEFAULT_CONFIG: UIScaleConfig = {
  designWidth: 1920,
  designHeight: 1080,
  minScale: 0.4,
  maxScale: 2.5,
  scaleMode: 'fit',
  minTouchTarget: 44,
  mobileBreakpoint: 768,
};

// Spacing scale (in design pixels)
const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
};

// Font size scale (in design pixels)
const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
};

// Border radius scale (in design pixels)
const RADII = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export class UIScale {
  private static instance: UIScale;
  private config: UIScaleConfig;
  private currentScale: number = 1;
  private scaleX: number = 1;
  private scaleY: number = 1;
  private listeners: Set<() => void> = new Set();
  private styleElement: HTMLStyleElement | null = null;
  private initialized: boolean = false;
  private forcedScale: number | null = null;
  private debugOverlay: HTMLDivElement | null = null;

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  public static getInstance(): UIScale {
    if (!UIScale.instance) {
      UIScale.instance = new UIScale();
    }
    return UIScale.instance;
  }

  /**
   * Initialize the scaling system
   */
  public init(config?: Partial<UIScaleConfig>): void {
    if (this.initialized) {
      console.warn("[UIScale] Already initialized");
      return;
    }

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.calculateScale();
    this.injectCSSVariables();
    this.setupResizeHandler();
    this.initialized = true;

    console.log(`[UIScale] Initialized - scale: ${this.currentScale.toFixed(3)}, mode: ${this.config.scaleMode}`);
  }

  /**
   * Calculate scale factors based on current viewport
   */
  private calculateScale(): void {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    this.scaleX = viewportWidth / this.config.designWidth;
    this.scaleY = viewportHeight / this.config.designHeight;

    // Calculate scale based on mode
    let scale: number;
    switch (this.config.scaleMode) {
      case 'fit':
        scale = Math.min(this.scaleX, this.scaleY);
        break;
      case 'fill':
        scale = Math.max(this.scaleX, this.scaleY);
        break;
      case 'width':
        scale = this.scaleX;
        break;
      case 'height':
        scale = this.scaleY;
        break;
      default:
        scale = Math.min(this.scaleX, this.scaleY);
    }

    // Apply forced scale if set
    if (this.forcedScale !== null) {
      scale = this.forcedScale;
    }

    // Clamp to min/max
    this.currentScale = Math.max(
      this.config.minScale,
      Math.min(this.config.maxScale, scale)
    );
  }

  /**
   * Inject CSS custom properties
   */
  private injectCSSVariables(): void {
    if (!this.styleElement) {
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'ui-scale-variables';
      document.head.appendChild(this.styleElement);
    }

    const scale = this.currentScale;
    const isMobile = this.isMobile() ? 1 : 0;
    const isPortrait = this.isPortrait() ? 1 : 0;

    // Build CSS variables
    let css = `:root {\n`;
    
    // Scale factors
    css += `  --ui-scale: ${scale};\n`;
    css += `  --ui-scale-x: ${this.scaleX};\n`;
    css += `  --ui-scale-y: ${this.scaleY};\n`;
    
    // Viewport info
    css += `  --ui-viewport-width: ${window.innerWidth}px;\n`;
    css += `  --ui-viewport-height: ${window.innerHeight}px;\n`;
    css += `  --ui-is-mobile: ${isMobile};\n`;
    css += `  --ui-is-portrait: ${isPortrait};\n`;
    
    // Scaled spacing
    for (const [name, value] of Object.entries(SPACING)) {
      css += `  --ui-space-${name}: ${Math.round(value * scale)}px;\n`;
    }
    
    // Scaled font sizes
    for (const [name, value] of Object.entries(FONT_SIZES)) {
      css += `  --ui-font-${name}: ${Math.round(value * scale)}px;\n`;
    }
    
    // Scaled border radii
    for (const [name, value] of Object.entries(RADII)) {
      if (name === 'full') {
        css += `  --ui-radius-${name}: ${value}px;\n`;
      } else {
        css += `  --ui-radius-${name}: ${Math.round(value * scale)}px;\n`;
      }
    }
    
    // Touch targets (ensure minimum size)
    const minTouch = Math.max(44, Math.round(this.config.minTouchTarget * scale));
    css += `  --ui-touch-min: ${minTouch}px;\n`;
    css += `  --ui-touch-comfortable: ${Math.round(minTouch * 1.1)}px;\n`;
    
    // Safe area insets (for notched phones)
    css += `  --ui-safe-top: env(safe-area-inset-top, 0px);\n`;
    css += `  --ui-safe-bottom: env(safe-area-inset-bottom, 0px);\n`;
    css += `  --ui-safe-left: env(safe-area-inset-left, 0px);\n`;
    css += `  --ui-safe-right: env(safe-area-inset-right, 0px);\n`;
    
    css += `}\n`;

    // Add utility classes
    css += `
/* UIScale utility classes */
.ui-scale-hidden-mobile {
  display: ${isMobile ? 'none' : 'block'} !important;
}
.ui-scale-hidden-desktop {
  display: ${isMobile ? 'block' : 'none'} !important;
}
.ui-scale-hidden-portrait {
  display: ${isPortrait ? 'none' : 'block'} !important;
}
.ui-scale-hidden-landscape {
  display: ${isPortrait ? 'block' : 'none'} !important;
}
`;

    this.styleElement.textContent = css;
  }

  /**
   * Setup window resize handler
   */
  private setupResizeHandler(): void {
    let resizeTimeout: number | null = null;

    const handleResize = () => {
      // Debounce resize events
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(() => {
        const oldScale = this.currentScale;
        this.calculateScale();
        
        if (Math.abs(oldScale - this.currentScale) > 0.001) {
          this.injectCSSVariables();
          this.notifyListeners();
          console.log(`[UIScale] Resized - scale: ${this.currentScale.toFixed(3)}`);
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
  }

  /**
   * Notify all listeners of scale change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('[UIScale] Listener error:', e);
      }
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get scaled pixel value
   */
  public px(designPixels: number): number {
    return Math.round(designPixels * this.currentScale);
  }

  /**
   * Get scaled value as CSS string
   */
  public css(designPixels: number): string {
    return `${this.px(designPixels)}px`;
  }

  /**
   * Get current scale factor
   */
  public getScale(): number {
    return this.currentScale;
  }

  /**
   * Get scale factors
   */
  public getScaleFactors(): { scale: number; scaleX: number; scaleY: number } {
    return {
      scale: this.currentScale,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
    };
  }

  /**
   * Check if in mobile mode (based on scaled viewport width)
   */
  public isMobile(): boolean {
    const scaledWidth = window.innerWidth / this.currentScale;
    return scaledWidth < this.config.mobileBreakpoint;
  }

  /**
   * Check if in portrait orientation
   */
  public isPortrait(): boolean {
    return window.innerHeight > window.innerWidth;
  }

  /**
   * Get viewport dimensions
   */
  public getViewport(): { width: number; height: number } {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  /**
   * Get design dimensions
   */
  public getDesignDimensions(): { width: number; height: number } {
    return {
      width: this.config.designWidth,
      height: this.config.designHeight,
    };
  }

  /**
   * Subscribe to scale changes
   */
  public onResize(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Force a specific scale factor (for debugging)
   */
  public forceScale(scale: number | null): void {
    this.forcedScale = scale;
    this.calculateScale();
    this.injectCSSVariables();
    this.notifyListeners();
    
    if (scale === null) {
      console.log('[UIScale] Scale reset to automatic');
    } else {
      console.log(`[UIScale] Scale forced to: ${scale}`);
    }
  }

  /**
   * Set scale mode
   */
  public setScaleMode(mode: ScaleMode): void {
    this.config.scaleMode = mode;
    this.calculateScale();
    this.injectCSSVariables();
    this.notifyListeners();
    console.log(`[UIScale] Scale mode set to: ${mode}`);
  }

  /**
   * Toggle debug overlay showing safe areas and scale info
   */
  public toggleDebug(): void {
    if (this.debugOverlay) {
      this.debugOverlay.remove();
      this.debugOverlay = null;
      console.log('[UIScale] Debug overlay hidden');
      return;
    }

    this.debugOverlay = document.createElement('div');
    this.debugOverlay.id = 'ui-scale-debug';
    this.debugOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 99999;
      font-family: monospace;
      font-size: 12px;
    `;

    // Info panel
    const info = document.createElement('div');
    info.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.8);
      color: #0f0;
      padding: 10px;
      border-radius: 4px;
    `;
    info.innerHTML = `
      <div>Scale: ${this.currentScale.toFixed(3)}</div>
      <div>Mode: ${this.config.scaleMode}</div>
      <div>Viewport: ${window.innerWidth}x${window.innerHeight}</div>
      <div>Design: ${this.config.designWidth}x${this.config.designHeight}</div>
      <div>Mobile: ${this.isMobile()}</div>
      <div>Portrait: ${this.isPortrait()}</div>
    `;
    this.debugOverlay.appendChild(info);

    // Safe area indicators
    const safeTop = document.createElement('div');
    safeTop.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: env(safe-area-inset-top, 0px);
      background: rgba(255,0,0,0.3);
      border-bottom: 1px dashed red;
    `;
    this.debugOverlay.appendChild(safeTop);

    const safeBottom = document.createElement('div');
    safeBottom.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: env(safe-area-inset-bottom, 0px);
      background: rgba(255,0,0,0.3);
      border-top: 1px dashed red;
    `;
    this.debugOverlay.appendChild(safeBottom);

    document.body.appendChild(this.debugOverlay);
    console.log('[UIScale] Debug overlay shown');
  }

  /**
   * Get debug info as string
   */
  public getDebugInfo(): string {
    return [
      `Scale: ${this.currentScale.toFixed(3)}`,
      `Mode: ${this.config.scaleMode}`,
      `Viewport: ${window.innerWidth}x${window.innerHeight}`,
      `Design: ${this.config.designWidth}x${this.config.designHeight}`,
      `ScaleX: ${this.scaleX.toFixed(3)}, ScaleY: ${this.scaleY.toFixed(3)}`,
      `Mobile: ${this.isMobile()}, Portrait: ${this.isPortrait()}`,
      `Forced: ${this.forcedScale ?? 'auto'}`,
    ].join('\n');
  }
}

// Export singleton getter for convenience
export const getUIScale = () => UIScale.getInstance();
