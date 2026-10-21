/**
 * HUDAccordion - Collapsible panel with header and content
 */

import { HUDElement } from "../HUDElement";
import type { HUDManager } from "../HUDManager";
import type { HUDAccordionConfig } from "../HUDTypes";

/** Fields the default item template reads from a list item; all optional. */
interface HUDAccordionItem {
  icon?: string;
  title?: string;
  name?: string;
  description?: string;
  subtitle?: string;
  progress?: number;
  onClick?: () => void;
  action?: () => void;
}

export class HUDAccordion extends HUDElement {
  protected override config: HUDAccordionConfig;
  private manager: HUDManager;
  private headerEl!: HTMLElement;
  private iconEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private toggleEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private listContainer!: HTMLElement;
  private collapsed: boolean = false;
  private badgeValue: number | null = null;

  constructor(id: string, config: HUDAccordionConfig, manager: HUDManager) {
    super(id, config);
    this.config = config;
    this.manager = manager;
    this.collapsed = config.collapsed ?? false;

    if (this.collapsed) {
      this.element.classList.add("hud-accordion-collapsed");
      this.contentEl.style.display = "none";
    }
  }

  protected createElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "hud-accordion";
    el.id = `hud-${this.id}`;

    // Header
    this.headerEl = document.createElement("div");
    this.headerEl.className = "hud-accordion-header";
    this.headerEl.onclick = () => this.toggle();

    // Header left section
    const headerLeft = document.createElement("div");
    headerLeft.className = "hud-accordion-header-left";

    this.iconEl = document.createElement("span");
    this.iconEl.className = "hud-accordion-icon";
    this.iconEl.textContent = this.config.icon || "";
    headerLeft.appendChild(this.iconEl);

    this.titleEl = document.createElement("span");
    this.titleEl.className = "hud-accordion-title";
    this.titleEl.textContent = this.config.title || "";
    headerLeft.appendChild(this.titleEl);

    this.badgeEl = document.createElement("span");
    this.badgeEl.className = "hud-accordion-badge";
    this.badgeEl.style.display = "none";
    headerLeft.appendChild(this.badgeEl);

    this.headerEl.appendChild(headerLeft);

    // Toggle arrow
    this.toggleEl = document.createElement("span");
    this.toggleEl.className = "hud-accordion-toggle";
    this.toggleEl.textContent = "▶";
    this.headerEl.appendChild(this.toggleEl);

    el.appendChild(this.headerEl);

    // Content
    this.contentEl = document.createElement("div");
    this.contentEl.className = "hud-accordion-content";

    // List container (for list content type)
    if (this.config.content?.type === "list") {
      this.listContainer = document.createElement("div");
      this.listContainer.className = "hud-accordion-list";

      // Empty text
      const emptyEl = document.createElement("div");
      emptyEl.className = "hud-accordion-empty";
      emptyEl.textContent = this.config.content.emptyText || "No items";
      this.listContainer.appendChild(emptyEl);

      this.contentEl.appendChild(this.listContainer);
    }

    el.appendChild(this.contentEl);

    return el;
  }

  public setValue(value: unknown): void {
    // For accordions, value is typically the badge count
    if (typeof value === "number") {
      this.setBadge(value);
    }
  }

  /**
   * Update list content
   */
  public updateList(data: unknown[]): void {
    if (!this.listContainer) return;

    const listBinding = this.manager.getListBinding(this.id);
    const itemTemplate = this.config.content?.type === "list" ? this.config.content.itemTemplate : null;

    // Clear existing items
    this.listContainer.innerHTML = "";

    if (!data || data.length === 0) {
      // Show empty state
      const emptyEl = document.createElement("div");
      emptyEl.className = "hud-accordion-empty";
      emptyEl.textContent = (this.config.content?.type === "list" ? this.config.content.emptyText : null) || "No items";
      this.listContainer.appendChild(emptyEl);
      return;
    }

    // Render items
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      let itemEl: HTMLElement;

      // Use custom renderer if provided
      if (listBinding?.renderItem) {
        itemEl = listBinding.renderItem(item, i);
      } else {
        // Use default template rendering
        itemEl = this.renderItemWithTemplate(item as HUDAccordionItem, itemTemplate);
      }

      this.listContainer.appendChild(itemEl);
    }

    // Update badge with count
    this.setBadge(data.length);
  }

  /**
   * Render an item using a template name
   */
  private renderItemWithTemplate(item: HUDAccordionItem, _templateName: string | null): HTMLElement {
    const el = document.createElement("div");
    el.className = "hud-accordion-item";

    // Default rendering based on common fields
    if (item.icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "hud-item-icon";
      iconEl.textContent = item.icon;
      el.appendChild(iconEl);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "hud-item-content";

    if (item.title || item.name) {
      const titleEl = document.createElement("div");
      titleEl.className = "hud-item-title";
      titleEl.textContent = item.title || item.name || null;
      contentEl.appendChild(titleEl);
    }

    if (item.description || item.subtitle) {
      const descEl = document.createElement("div");
      descEl.className = "hud-item-description";
      descEl.textContent = item.description || item.subtitle || null;
      contentEl.appendChild(descEl);
    }

    if (item.progress !== undefined) {
      const progressEl = document.createElement("div");
      progressEl.className = "hud-item-progress";
      const fillEl = document.createElement("div");
      fillEl.className = "hud-item-progress-fill";
      fillEl.style.width = `${Math.min(100, Math.max(0, item.progress * 100))}%`;
      progressEl.appendChild(fillEl);
      contentEl.appendChild(progressEl);
    }

    el.appendChild(contentEl);

    // Make clickable if item has onClick or action
    if (item.onClick || item.action) {
      el.classList.add("hud-item-clickable");
      el.onclick = () => {
        if (item.onClick) item.onClick();
        else if (item.action) item.action();
      };
    }

    return el;
  }

  /**
   * Collapse the accordion
   */
  public collapse(): void {
    if (this.collapsed) return;
    this.collapsed = true;
    this.element.classList.add("hud-accordion-collapsed");
    this.contentEl.style.display = "none";
    this.toggleEl.textContent = "▶";
  }

  /**
   * Expand the accordion
   */
  public expand(): void {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.element.classList.remove("hud-accordion-collapsed");
    this.contentEl.style.display = "";
    this.toggleEl.textContent = "▼";
  }

  /**
   * Toggle collapsed state
   */
  public override toggle(): void {
    if (this.collapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  /**
   * Check if collapsed
   */
  public isCollapsed(): boolean {
    return this.collapsed;
  }

  /**
   * Set badge value
   */
  public override setBadge(value: number | null): void {
    this.badgeValue = value;

    if (value === null || value === 0) {
      this.badgeEl.style.display = "none";
    } else {
      this.badgeEl.style.display = "";
      this.badgeEl.textContent = String(value);

      // Pulse animation on change
      this.badgeEl.classList.remove("hud-badge-pulse");
      void this.badgeEl.offsetWidth;
      this.badgeEl.classList.add("hud-badge-pulse");
    }
  }

  /**
   * Get badge value
   */
  public getBadge(): number | null {
    return this.badgeValue;
  }
}
