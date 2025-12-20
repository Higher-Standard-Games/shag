/**
 * SidePanel - Generic collapsible side panel (Engine Component)
 * 
 * A reusable panel that can be positioned on left or right side.
 * Game code provides content via callbacks.
 * 
 * Features:
 * - Collapsible with header click
 * - Auto-stacking with other panels
 * - Customizable via callbacks
 * - No overlap with BottomBar
 */

export interface SidePanelItem {
  id: string;
  content: string;      // HTML content for the item
  onClick?: () => void; // Optional click handler
}

export interface SidePanelConfig {
  id: string;
  title: string;
  icon: string;
  side: "left" | "right";
  order: number;        // Stack order (lower = higher on screen)
  minHeight?: number;
  maxHeight?: number;
  collapsedByDefault?: boolean;
}

export interface SidePanelCallbacks {
  getItems: () => SidePanelItem[];
  onItemClick?: (itemId: string) => void;
  renderItem?: (item: SidePanelItem) => string;  // Custom item rendering
  getHeaderExtra?: () => string;  // Extra content for header (e.g., count badge)
}

export class SidePanel {
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private contentEl: HTMLDivElement;
  private config: SidePanelConfig;
  private callbacks: SidePanelCallbacks;
  private isCollapsed: boolean;
  private static panels: Map<string, SidePanel> = new Map();

  constructor(config: SidePanelConfig, callbacks: SidePanelCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.isCollapsed = config.collapsedByDefault ?? false;
    
    this.container = this.createContainer();
    this.headerEl = this.createHeader();
    this.contentEl = this.createContent();
    
    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.contentEl);
    
    // Register panel for stacking
    SidePanel.panels.set(config.id, this);
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = `side-panel-${this.config.id}`;
    container.className = "side-panel";
    container.style.cssText = `
      position: fixed;
      ${this.config.side}: 16px;
      width: 220px;
      background: linear-gradient(to bottom, rgba(30, 30, 30, 0.95), rgba(20, 20, 20, 0.98));
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      z-index: 900;
      font-family: 'Segoe UI', system-ui, sans-serif;
      border: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
      transition: all 0.2s ease;
    `;
    return container;
  }

  private createHeader(): HTMLDivElement {
    const header = document.createElement("div");
    header.className = "side-panel-header";
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.05);
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;
    
    header.onclick = () => this.toggleCollapse();
    
    return header;
  }

  private createContent(): HTMLDivElement {
    const content = document.createElement("div");
    content.className = "side-panel-content";
    content.style.cssText = `
      max-height: ${this.config.maxHeight ?? 300}px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.3) transparent;
    `;
    return content;
  }

  private renderHeader(): void {
    const extra = this.callbacks.getHeaderExtra?.() ?? "";
    this.headerEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">${this.config.icon}</span>
        <span class="side-panel-title" style="color: #fff; font-weight: 400; font-size: 20px;">${this.config.title}</span>
        ${extra}
      </div>
      <span style="color: #666; font-size: 12px; transition: transform 0.2s;">
        ${this.isCollapsed ? "▶" : "▼"}
      </span>
    `;
  }

  private renderContent(): void {
    if (this.isCollapsed) {
      this.contentEl.style.display = "none";
      return;
    }
    
    this.contentEl.style.display = "block";
    const items = this.callbacks.getItems();
    
    if (items.length === 0) {
      this.contentEl.innerHTML = `
        <div style="padding: 16px; text-align: center; color: #666; font-size: 12px;">
          No items
        </div>
      `;
      return;
    }
    
    this.contentEl.innerHTML = items.map(item => {
      if (this.callbacks.renderItem) {
        return this.callbacks.renderItem(item);
      }
      return this.defaultRenderItem(item);
    }).join("");
    
    // Add click handlers
    items.forEach(item => {
      if (item.onClick || this.callbacks.onItemClick) {
        const el = this.contentEl.querySelector(`[data-item-id="${item.id}"]`);
        if (el) {
          (el as HTMLElement).style.cursor = "pointer";
          el.addEventListener("click", () => {
            item.onClick?.();
            this.callbacks.onItemClick?.(item.id);
          });
        }
      }
    });
  }

  private defaultRenderItem(item: SidePanelItem): string {
    return `
      <div class="side-panel-item" data-item-id="${item.id}" style="
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        color: #ccc;
        font-size: 12px;
        transition: background 0.2s;
      " onmouseenter="this.style.background='rgba(255,255,255,0.05)'"
         onmouseleave="this.style.background='transparent'">
        ${item.content}
      </div>
    `;
  }

  private toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.render();
    SidePanel.updatePositions();
  }

  public render(): void {
    this.renderHeader();
    this.renderContent();
  }

  public refresh(): void {
    this.render();
  }

  public show(): void {
    if (!this.container.parentElement) {
      document.body.appendChild(this.container);
    }
    this.render();
    SidePanel.updatePositions();
  }

  public hide(): void {
    this.container.remove();
    SidePanel.panels.delete(this.config.id);
    SidePanel.updatePositions();
  }

  public destroy(): void {
    this.hide();
  }

  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.render();
    SidePanel.updatePositions();
  }

  public isVisible(): boolean {
    return !!this.container.parentElement;
  }

  // Static method to update all panel positions (stacking)
  private static updatePositions(): void {
    const leftPanels: SidePanel[] = [];
    const rightPanels: SidePanel[] = [];
    
    for (const panel of SidePanel.panels.values()) {
      if (panel.isVisible()) {
        if (panel.config.side === "left") {
          leftPanels.push(panel);
        } else {
          rightPanels.push(panel);
        }
      }
    }
    
    // Sort by order
    leftPanels.sort((a, b) => a.config.order - b.config.order);
    rightPanels.sort((a, b) => a.config.order - b.config.order);
    
    // Position left panels
    let topOffset = 70; // Below top bar
    for (const panel of leftPanels) {
      panel.container.style.top = `${topOffset}px`;
      topOffset += panel.container.offsetHeight + 10;
    }
    
    // Position right panels
    topOffset = 70;
    for (const panel of rightPanels) {
      panel.container.style.top = `${topOffset}px`;
      topOffset += panel.container.offsetHeight + 10;
    }
  }


  // Static method to refresh all panels
  public static refreshAll(): void {
    for (const panel of SidePanel.panels.values()) {
      panel.refresh();
    }
    SidePanel.updatePositions();
  }
}
