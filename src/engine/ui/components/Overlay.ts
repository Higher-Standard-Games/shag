/**
 * Overlay - Reusable backdrop component with optional blur effect
 * 
 * Part of the unified UI system. Use this for any modal/dialog backdrop.
 * Manages its own show/hide animations and click-to-close behavior.
 */

import { UIManager } from "../UIManager";

export interface OverlayConfig {
  id: string;
  blur?: number;           // Blur amount in px (default: 0)
  opacity?: number;        // Background opacity 0-1 (default: 0.6)
  color?: string;          // Background color (default: '#000000')
  zIndex?: number;         // Z-index (default: from UIManager)
  closeOnClick?: boolean;  // Close when clicking overlay (default: true)
  animate?: boolean;       // Fade in/out animation (default: true)
}

export class Overlay {
  private element: HTMLDivElement | null = null;
  private config: Required<OverlayConfig>;
  private onClose?: () => void;
  private visible: boolean = false;

  constructor(config: OverlayConfig, onClose?: () => void) {
    this.config = {
      blur: 0,
      opacity: 0.6,
      color: "#000000",
      zIndex: UIManager.getInstance().getZIndex("OVERLAY"),
      closeOnClick: true,
      animate: true,
      ...config,
    };
    this.onClose = onClose;
  }

  /**
   * Show the overlay
   */
  public show(): void {
    if (this.visible) return;

    this.element = document.createElement("div");
    this.element.id = `overlay-${this.config.id}`;
    this.element.className = "ui-overlay";
    
    // Build background with opacity
    const r = parseInt(this.config.color.slice(1, 3), 16) || 0;
    const g = parseInt(this.config.color.slice(3, 5), 16) || 0;
    const b = parseInt(this.config.color.slice(5, 7), 16) || 0;
    const bgColor = `rgba(${r}, ${g}, ${b}, ${this.config.opacity})`;

    this.element.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${bgColor};
      ${this.config.blur > 0 ? `backdrop-filter: blur(${this.config.blur}px); -webkit-backdrop-filter: blur(${this.config.blur}px);` : ""}
      z-index: ${this.config.zIndex};
      ${this.config.animate ? "animation: uiFadeIn 0.2s ease;" : ""}
    `;

    if (this.config.closeOnClick) {
      this.element.addEventListener("click", (e) => {
        if (e.target === this.element) {
          this.hide();
        }
      });
    }

    document.body.appendChild(this.element);
    this.visible = true;

    // Register with UIManager for ESC key handling
    if (this.onClose) {
      UIManager.getInstance().pushOverlay(this.config.id, () => this.hide());
    }
  }

  /**
   * Hide the overlay
   */
  public hide(): void {
    if (!this.visible || !this.element) return;

    if (this.config.animate) {
      this.element.style.animation = "uiFadeOut 0.2s ease";
      setTimeout(() => {
        this.element?.remove();
        this.element = null;
      }, 200);
    } else {
      this.element.remove();
      this.element = null;
    }

    this.visible = false;

    // Unregister from UIManager
    UIManager.getInstance().popOverlay(this.config.id);

    // Call onClose callback
    this.onClose?.();
  }

  /**
   * Get the overlay element (for appending content)
   */
  public getElement(): HTMLDivElement | null {
    return this.element;
  }

  /**
   * Check if overlay is currently visible
   */
  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update z-index (useful when stacking overlays)
   */
  public setZIndex(zIndex: number): void {
    this.config.zIndex = zIndex;
    if (this.element) {
      this.element.style.zIndex = String(zIndex);
    }
  }
}
