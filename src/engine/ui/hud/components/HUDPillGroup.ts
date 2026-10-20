/**
 * HUDPillGroup - Container for multiple related pills/buttons
 */

import { HUDElement } from "../HUDElement";
import type { HUDManager } from "../HUDManager";
import type { HUDPillGroupChild, HUDPillGroupConfig } from "../HUDTypes";

export class HUDPillGroup extends HUDElement {
  protected override config: HUDPillGroupConfig;
  private manager: HUDManager;
  private childElements: Map<string, HTMLElement> = new Map();

  constructor(id: string, config: HUDPillGroupConfig, manager: HUDManager) {
    super(id, config as any);
    this.config = config;
    this.manager = manager;
  }

  protected createElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "hud-pill-group";
    el.id = `hud-${this.id}`;

    // Create child elements
    if (this.config.children) {
      for (const child of this.config.children) {
        const childEl = this.createChildElement(child);
        if (childEl) {
          el.appendChild(childEl);
          this.childElements.set(child.id, childEl);
        }
      }
    }

    return el;
  }

  private createChildElement(child: HUDPillGroupChild): HTMLElement | null {
    // Check platform visibility
    if (child.platforms) {
      const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const platform = isMobile ? "mobile" : "desktop";
      if (!child.platforms.includes(platform)) {
        return null;
      }
    }

    const type = child.type || "value";

    switch (type) {
      case "value": {
        const span = document.createElement("span");
        span.className = "hud-pill-group-value";
        span.dataset.childId = child.id;
        if (child.style === "bold") {
          span.classList.add("hud-pill-group-bold");
        } else if (child.style === "muted") {
          span.classList.add("hud-pill-group-muted");
        }
        return span;
      }

      case "icon": {
        const span = document.createElement("span");
        span.className = "hud-pill-group-icon";
        span.dataset.childId = child.id;
        span.textContent = child.icon || "";
        return span;
      }

      case "button": {
        const btn = document.createElement("button");
        btn.className = "hud-pill-group-btn";
        btn.dataset.childId = child.id;
        btn.textContent = child.icon || "";

        // Wire up click handler from manager
        btn.onclick = (e) => {
          e.stopPropagation();
          const handler = this.manager.getClickHandler(child.id);
          if (handler) handler();
        };

        return btn;
      }

      default:
        return null;
    }
  }

  public setValue(value: any): void {
    // Value is expected to be an object with child IDs as keys
    if (typeof value !== "object" || value === null) return;

    for (const [childId, childValue] of Object.entries(value)) {
      const childEl = this.childElements.get(childId);
      if (childEl) {
        // Find child config for formatting
        const childConfig = this.config.children?.find((c) => c.id === childId);
        let displayValue = childValue;

        if (childConfig?.format && childValue != null) {
          displayValue = this.formatValue(childValue, childConfig.format);
        }

        childEl.textContent = String(displayValue ?? "");
      }
    }
  }

  /**
   * Set a specific child's value
   */
  public setChildValue(childId: string, value: any): void {
    const childEl = this.childElements.get(childId);
    if (!childEl) return;

    const childConfig = this.config.children?.find((c) => c.id === childId);
    let displayValue = value;

    if (childConfig?.format && value != null) {
      displayValue = this.formatValue(value, childConfig.format);
    }

    childEl.textContent = String(displayValue ?? "");
  }

  /**
   * Update button state (e.g., active class)
   */
  public setButtonState(childId: string, state: string): void {
    const childEl = this.childElements.get(childId);
    if (!childEl) return;

    // Remove existing state classes
    childEl.classList.remove("hud-btn-active", "hud-btn-fast", "hud-btn-debug");

    if (state) {
      childEl.classList.add(`hud-btn-${state}`);
    }
  }

  private formatValue(value: any, format: string): string {
    if (format.includes("%d")) {
      return format.replace("%d", String(Math.floor(Number(value))));
    }
    if (format.includes("%s")) {
      return format.replace("%s", String(value));
    }
    return format.replace("%", String(value));
  }
}
