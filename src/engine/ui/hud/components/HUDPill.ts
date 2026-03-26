/**
 * HUDPill - Simple icon + value pill component
 */

import { HUDElement } from "../HUDElement";
import type { HUDPillConfig } from "../HUDTypes";

export class HUDPill extends HUDElement {
  protected config: HUDPillConfig;
  private iconEl!: HTMLElement;
  private valueEl!: HTMLElement;
  private currentValue: any = null;

  constructor(id: string, config: HUDPillConfig) {
    super(id, config as any);
    this.config = config;
  }

  protected createElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "hud-pill";
    el.id = `hud-${this.id}`;

    // Icon
    this.iconEl = document.createElement("span");
    this.iconEl.className = "hud-pill-icon";
    this.iconEl.textContent = this.config.icon || "";
    el.appendChild(this.iconEl);

    // Value
    this.valueEl = document.createElement("span");
    this.valueEl.className = "hud-pill-value";
    el.appendChild(this.valueEl);

    // Clickable styling
    if (this.config.clickable) {
      el.classList.add("hud-pill-clickable");
    }

    return el;
  }

  public setValue(value: any): void {
    if (value === this.currentValue) return;
    this.currentValue = value;

    // Format the value
    let displayValue = value;
    if (this.config.format && value != null) {
      displayValue = this.formatValue(value, this.config.format);
    }

    this.valueEl.textContent = String(displayValue ?? "");
  }

  /**
   * Format a value using printf-style format string
   */
  private formatValue(value: any, format: string): string {
    // Simple format replacements
    // %d = integer
    // %s = string
    // %f = float
    // %.2f = float with 2 decimals

    if (format.includes("%d")) {
      return format.replace("%d", String(Math.floor(Number(value))));
    }
    if (format.includes("%s")) {
      return format.replace("%s", String(value));
    }
    if (format.includes("%f")) {
      return format.replace("%f", String(Number(value)));
    }
    // %.Nf format
    const floatMatch = format.match(/%\.(\d+)f/);
    if (floatMatch) {
      const decimals = parseInt(floatMatch[1], 10);
      return format.replace(floatMatch[0], Number(value).toFixed(decimals));
    }

    return format.replace("%", String(value));
  }

  /**
   * Set the icon
   */
  public setIcon(icon: string): void {
    this.iconEl.textContent = icon;
  }

  /**
   * Get current value
   */
  public getValue(): any {
    return this.currentValue;
  }
}
