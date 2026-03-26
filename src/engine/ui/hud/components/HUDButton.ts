/**
 * HUDButton - Icon button component
 */

import { HUDElement } from "../HUDElement";
import type { HUDButtonConfig } from "../HUDTypes";

export class HUDButton extends HUDElement {
  protected config: HUDButtonConfig;
  private iconEl!: HTMLElement;
  private active: boolean = false;

  constructor(id: string, config: HUDButtonConfig) {
    super(id, config as any);
    this.config = config;
  }

  protected createElement(): HTMLElement {
    const el = document.createElement("button");
    el.className = "hud-button";
    el.id = `hud-${this.id}`;

    // Apply variant
    if (this.config.variant) {
      el.classList.add(`hud-button-${this.config.variant}`);
    }

    // Icon
    this.iconEl = document.createElement("span");
    this.iconEl.className = "hud-button-icon";
    this.iconEl.textContent = this.config.icon || "";
    el.appendChild(this.iconEl);

    // Tooltip
    if (this.config.tooltip) {
      el.title = this.config.tooltip;
    }

    return el;
  }

  public setValue(value: any): void {
    // For buttons, value can be the icon or active state
    if (typeof value === "string") {
      this.iconEl.textContent = value;
    } else if (typeof value === "boolean") {
      this.setActive(value);
    } else if (typeof value === "object" && value !== null) {
      if (value.icon) this.iconEl.textContent = value.icon;
      if (value.active !== undefined) this.setActive(value.active);
      if (value.state) this.setState(value.state);
    }
  }

  /**
   * Set active state
   */
  public setActive(active: boolean): void {
    this.active = active;
    this.element.classList.toggle("hud-button-active", active);
  }

  /**
   * Check if active
   */
  public isActive(): boolean {
    return this.active;
  }

  /**
   * Set button state class
   */
  public setState(state: string): void {
    // Remove existing state classes
    this.element.classList.remove("hud-button-fast", "hud-button-debug", "hud-button-active");

    if (state) {
      this.element.classList.add(`hud-button-${state}`);
    }
  }

  /**
   * Set the icon
   */
  public setIcon(icon: string): void {
    this.iconEl.textContent = icon;
  }
}
