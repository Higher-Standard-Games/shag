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

import { UIStyles } from "./UIStyles";
import sidePanelCSS from "./styles/SidePanel.css?raw";

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
  private static resizeListenerAdded: boolean = false;

  constructor(config: SidePanelConfig, callbacks: SidePanelCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.isCollapsed = config.collapsedByDefault ?? false;
    
    // Inject styles once
    UIStyles.injectCSS("side-panel", sidePanelCSS);
    
    this.container = this.createContainer();
    this.headerEl = this.createHeader();
    this.contentEl = this.createContent();
    
    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.contentEl);
    
    // Register panel for stacking
    SidePanel.panels.set(config.id, this);
    
    // Add resize listener once to update positions when window/scale changes
    if (!SidePanel.resizeListenerAdded) {
      SidePanel.resizeListenerAdded = true;
      window.addEventListener('resize', () => SidePanel.updatePositions());
    }
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = `side-panel-${this.config.id}`;
    container.className = `side-panel ${this.config.side}`;
    return container;
  }

  private createHeader(): HTMLDivElement {
    const header = document.createElement("div");
    header.className = "side-panel-header";
    header.onclick = () => this.toggleCollapse();
    return header;
  }

  private createContent(): HTMLDivElement {
    const content = document.createElement("div");
    content.className = "side-panel-content";
    content.style.maxHeight = `${this.config.maxHeight ?? 300}px`;
    return content;
  }

  private renderHeader(): void {
    const extra = this.callbacks.getHeaderExtra?.() ?? "";
    this.headerEl.innerHTML = `
      <div class="side-panel-header-left">
        <span class="side-panel-icon">${this.config.icon}</span>
        <span class="side-panel-title">${this.config.title}</span>
        ${extra}
      </div>
      <span class="side-panel-toggle">${this.isCollapsed ? "▶" : "▼"}</span>
    `;
  }

  private renderContent(): void {
    if (this.isCollapsed) {
      this.contentEl.classList.add("collapsed");
      return;
    }
    
    this.contentEl.classList.remove("collapsed");
    const items = this.callbacks.getItems();
    
    if (items.length === 0) {
      this.contentEl.innerHTML = `<div class="side-panel-empty">No items</div>`;
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
    const hasClick = item.onClick || this.callbacks.onItemClick;
    return `
      <div class="side-panel-item${hasClick ? " clickable" : ""}" data-item-id="${item.id}">
        ${item.content}
      </div>
    `;
  }

  private toggleCollapse(): void {
    const wasCollapsed = this.isCollapsed;
    this.isCollapsed = !this.isCollapsed;
    this.render();
    SidePanel.updatePositions();
    
    // Accordion behavior: collapse other panels when this one expands
    if (wasCollapsed && !this.isCollapsed) {
      SidePanel.collapseOthers(this.config.id);
    }
  }
  
  /**
   * Collapse all other panels (accordion behavior)
   */
  private static collapseOthers(exceptId: string): void {
    for (const [id, panel] of SidePanel.panels.entries()) {
      if (id !== exceptId && !panel.isCollapsed) {
        panel.isCollapsed = true;
        panel.render();
      }
    }
    SidePanel.updatePositions();
  }

  public render(): void {
    this.renderHeader();
    this.renderContent();
  }

  public refresh(): void {
    this.render();
    SidePanel.updatePositions();
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
    // Use requestAnimationFrame to ensure DOM has updated before calculating heights
    requestAnimationFrame(() => {
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
      
      // Calculate available height (viewport height minus top bar and bottom bar)
      // Use UIScale for proper scaling
      const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale') || '1');
      const viewportHeight = window.innerHeight;
      const topBarHeight = Math.round(80 * uiScale); // Space below top bar pills (scaled)
      const bottomBarHeight = Math.round(140 * uiScale); // Approximate height of build bar (scaled)
      const maxBottomY = viewportHeight - bottomBarHeight;
      
      // Position left panels
      const panelGap = Math.round(10 * uiScale); // Gap between panels (scaled)
      let topOffset = topBarHeight;
      for (const panel of leftPanels) {
        panel.container.style.top = `${topOffset}px`;
        
        // Calculate remaining space for this panel
        const remainingSpace = maxBottomY - topOffset - panelGap;
        if (remainingSpace > 0) {
          // Limit content height to fit in remaining space
          const headerHeight = panel.headerEl.offsetHeight;
          const maxContentHeight = Math.max(50, remainingSpace - headerHeight);
          panel.contentEl.style.maxHeight = `${Math.min(panel.config.maxHeight ?? 300, maxContentHeight)}px`;
        }
        
        topOffset += panel.container.offsetHeight + panelGap;
      }
      
      // Position right panels
      topOffset = topBarHeight;
      for (const panel of rightPanels) {
        panel.container.style.top = `${topOffset}px`;
        
        const remainingSpace = maxBottomY - topOffset - panelGap;
        if (remainingSpace > 0) {
          const headerHeight = panel.headerEl.offsetHeight;
          const maxContentHeight = Math.max(50, remainingSpace - headerHeight);
          panel.contentEl.style.maxHeight = `${Math.min(panel.config.maxHeight ?? 300, maxContentHeight)}px`;
        }
        
        topOffset += panel.container.offsetHeight + panelGap;
      }
    });
  }


  // Static method to refresh all panels
  public static refreshAll(): void {
    for (const panel of SidePanel.panels.values()) {
      panel.refresh();
    }
    SidePanel.updatePositions();
  }
}
