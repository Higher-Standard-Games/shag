/**
 * HUDElement - Base class for all HUD components
 */

import type { HUDAnimationType, HUDElementConfig, HUDFlashType } from "./HUDTypes";

export abstract class HUDElement {
  protected id: string;
  protected config: HUDElementConfig;
  protected element: HTMLElement;
  protected visible: boolean = true;
  protected clickHandler?: () => void;

  constructor(id: string, config: HUDElementConfig) {
    this.id = id;
    this.config = config;
    this.element = this.createElement();
    this.visible = config.visible !== false;

    if (!this.visible) {
      this.element.style.display = "none";
    }
  }

  /**
   * Create the DOM element for this component
   */
  protected abstract createElement(): HTMLElement;

  /**
   * Update the displayed value
   */
  public abstract setValue(value: any): void;

  /**
   * Get the DOM element
   */
  public getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Get the element ID
   */
  public getId(): string {
    return this.id;
  }

  /**
   * Set click handler
   */
  public setClickHandler(handler: () => void): void {
    this.clickHandler = handler;
    this.element.style.cursor = "pointer";
    this.element.onclick = (e) => {
      e.stopPropagation();
      handler();
    };
  }

  /**
   * Show the element
   */
  public show(): void {
    if (!this.visible) {
      this.visible = true;
      this.element.style.display = "";
      this.animate("fadeIn");
    }
  }

  /**
   * Hide the element
   */
  public hide(): void {
    if (this.visible) {
      this.visible = false;
      this.animate("fadeOut");
      setTimeout(() => {
        if (!this.visible) {
          this.element.style.display = "none";
        }
      }, 200);
    }
  }

  /**
   * Toggle visibility
   */
  public toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if visible
   */
  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * Flash effect for value changes
   */
  public flash(type: HUDFlashType): void {
    const flashClass = `hud-flash-${type}`;
    this.element.classList.add(flashClass);
    setTimeout(() => {
      this.element.classList.remove(flashClass);
    }, 300);
  }

  /**
   * Pulse animation for attention
   */
  public pulse(): void {
    this.animate("pulse");
  }

  /**
   * Shake animation
   */
  public shake(): void {
    this.animate("shake");
  }

  /**
   * Play an animation
   */
  public animate(animation: HUDAnimationType): void {
    const animClass = `hud-animate-${animation}`;
    this.element.classList.remove(animClass);
    // Force reflow to restart animation
    void this.element.offsetWidth;
    this.element.classList.add(animClass);

    // Remove class after animation completes
    const duration = this.getAnimationDuration(animation);
    setTimeout(() => {
      this.element.classList.remove(animClass);
    }, duration);
  }

  /**
   * Get animation duration in ms
   */
  private getAnimationDuration(animation: HUDAnimationType): number {
    switch (animation) {
      case "fadeIn":
      case "fadeOut":
      case "scaleIn":
      case "scaleOut":
        return 200;
      case "slideIn":
      case "slideOut":
        return 250;
      case "pulse":
        return 500;
      case "shake":
      case "bounce":
        return 300;
      default:
        return 200;
    }
  }

  /**
   * Set a badge value (for elements that support it)
   */
  public setBadge(_value: number | null): void {
    // Override in subclasses that support badges
  }

  /**
   * Destroy the element
   */
  public destroy(): void {
    this.element.remove();
  }
}
