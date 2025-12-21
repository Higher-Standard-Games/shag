/**
 * BottomBar - Unified bottom UI panel (Engine Component)
 * 
 * This is a GENERIC engine component. Game-specific customization
 * (icons, colors, item rendering) is provided via callbacks.
 * 
 * Features:
 * - Tabbed build menu with categories from JSON config
 * - Integrated inventory bar
 * - Collapsible/expandable
 * - Mobile-friendly touch targets
 * - Customizable via callbacks (game provides icons, styling)
 */

import { UIConfig, type BuildMenuCategory, type BuildMenuItem } from "./UIConfig";

export interface InventorySlot {
  itemId: string | null;
  icon: string | null;
  count: number;
  name?: string;  // Display name for the item
}

/**
 * Callbacks for game-specific customization
 * The engine handles layout/behavior, game provides content/styling
 */
export interface BottomBarCallbacks {
  // Actions
  onItemSelect: (item: BuildMenuItem) => void;
  onInventorySlotClick: (slotIndex: number) => void;
  
  // Data providers
  getPlayerLevel: () => number;
  getPlayerMoney: () => number;
  getInventory: () => InventorySlot[];
  
  // Customization (optional - engine provides defaults)
  renderItemIcon?: (item: BuildMenuItem) => string;  // Returns HTML/emoji for item icon
  renderInventoryIcon?: (itemId: string) => string;  // Returns HTML/emoji for inventory
  getItemTooltip?: (item: BuildMenuItem) => string;  // Custom tooltip text
  getCategoryStyle?: (category: BuildMenuCategory) => { color?: string; icon?: string };
}

export class BottomBar {
  private container: HTMLDivElement;
  private tabsContainer: HTMLDivElement;
  private itemsContainer: HTMLDivElement;
  private inventoryContainer: HTMLDivElement;
  private callbacks: BottomBarCallbacks;
  private selectedCategory: string | null = null;
  private selectedItem: BuildMenuItem | null = null;
  private isExpanded: boolean = true;
  private categories: BuildMenuCategory[] = [];

  constructor(callbacks: BottomBarCallbacks) {
    this.callbacks = callbacks;
    this.container = this.createContainer();
    this.tabsContainer = this.createTabsContainer();
    this.itemsContainer = this.createItemsContainer();
    this.inventoryContainer = this.createInventoryContainer();
    
    this.container.appendChild(this.tabsContainer);
    this.container.appendChild(this.itemsContainer);
    this.container.appendChild(this.inventoryContainer);
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = "bottom-bar";
    container.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 800px;
      background: #FAFAFA;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      z-index: 1000;
      font-family: 'Segoe UI', system-ui, sans-serif;
      transition: transform 0.2s ease;
      border: 1px solid #E0E0E0;
      border-bottom: none;
    `;
    return container;
  }

  private createTabsContainer(): HTMLDivElement {
    const tabs = document.createElement("div");
    tabs.id = "bottom-bar-tabs";
    tabs.style.cssText = `
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid #E0E0E0;
      overflow-x: auto;
      scrollbar-width: none;
    `;
    return tabs;
  }

  private createItemsContainer(): HTMLDivElement {
    const items = document.createElement("div");
    items.id = "bottom-bar-items";
    items.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
      gap: 8px;
      padding: 12px;
      max-height: 120px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #CCCCCC transparent;
    `;
    return items;
  }

  private createInventoryContainer(): HTMLDivElement {
    const inventory = document.createElement("div");
    inventory.id = "bottom-bar-inventory";
    inventory.style.cssText = `
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid #E0E0E0;
      background: #F0F0F0;
      border-radius: 0 0 16px 16px;
      justify-content: center;
    `;
    return inventory;
  }

  public async init(): Promise<void> {
    const config = UIConfig.getInstance().getConfig();
    if (!config) {
      console.warn("UI config not loaded, loading now...");
      await UIConfig.getInstance().load();
    }

    this.loadCategories();
    this.renderTabs();
    this.renderInventory();

    // Select first category by default
    if (this.categories.length > 0) {
      this.selectCategory(this.categories[0].id);
    }
  }

  private loadCategories(): void {
    const level = this.callbacks.getPlayerLevel();
    this.categories = UIConfig.getInstance().getCategoriesForLevel(level);
  }

  private renderTabs(): void {
    this.tabsContainer.innerHTML = "";

    // Add collapse/expand button
    const collapseBtn = document.createElement("button");
    collapseBtn.innerHTML = this.isExpanded ? "▼" : "▲";
    collapseBtn.style.cssText = `
      background: #E8E8E8;
      border: none;
      border-bottom: 3px solid #CCCCCC;
      color: #666666;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      margin-right: 8px;
      transition: all 0.1s ease;
      position: relative;
      top: 0;
    `;
    collapseBtn.onclick = () => this.toggleExpanded();
    collapseBtn.onmouseenter = () => {
      collapseBtn.style.background = "#F5F5F5";
      collapseBtn.style.top = "-1px";
    };
    collapseBtn.onmouseleave = () => {
      collapseBtn.style.background = "#E8E8E8";
      collapseBtn.style.top = "0";
    };
    this.tabsContainer.appendChild(collapseBtn);

    // Add category tabs
    for (const category of this.categories) {
      const tab = this.createTab(category);
      this.tabsContainer.appendChild(tab);
    }
  }

  private createTab(category: BuildMenuCategory): HTMLButtonElement {
    const tab = document.createElement("button");
    const isSelected = this.selectedCategory === category.id;
    
    tab.innerHTML = `${category.icon} <strong>${category.name}</strong>`;
    
    // 3D button effect for all tabs
    const defaultBg = isSelected ? category.color : "#F5F5F5";
    const defaultBorder = isSelected ? this.darkenColor(category.color, 20) : "#CCCCCC";
    const textColor = isSelected ? "#FFFFFF" : "#333333";
    
    tab.style.cssText = `
      background: ${defaultBg};
      border: none;
      border-bottom: 4px solid ${defaultBorder};
      color: ${textColor};
      padding: 10px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      transition: all 0.1s ease;
      position: relative;
      top: 0;
    `;

    tab.onclick = () => this.selectCategory(category.id);
    tab.onmouseenter = () => {
      if (!isSelected) {
        tab.style.background = "#FFFFFF";
        tab.style.top = "-2px";
      }
    };
    tab.onmouseleave = () => {
      if (!isSelected) {
        tab.style.background = "#F5F5F5";
        tab.style.top = "0";
      }
    };
    // Add press effect
    tab.onmousedown = () => {
      tab.style.top = "2px";
      tab.style.borderBottomWidth = "2px";
    };
    tab.onmouseup = () => {
      tab.style.top = isSelected ? "0" : "-2px";
      tab.style.borderBottomWidth = "4px";
    };

    return tab;
  }

  private selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.selectedItem = null;
    
    // Auto-expand if minimized when clicking a tab
    if (!this.isExpanded) {
      this.isExpanded = true;
      this.itemsContainer.style.display = "grid";
    }
    
    this.renderTabs();
    this.renderItems();
  }

  private renderItems(): void {
    this.itemsContainer.innerHTML = "";

    if (!this.selectedCategory) return;

    const category = this.categories.find(c => c.id === this.selectedCategory);
    if (!category) return;

    const playerMoney = this.callbacks.getPlayerMoney();
    const playerLevel = this.callbacks.getPlayerLevel();

    for (const item of category.items) {
      const itemEl = this.createItemElement(item, playerMoney, playerLevel);
      this.itemsContainer.appendChild(itemEl);
    }

    // Show hint if no items
    if (category.items.length === 0) {
      const hint = document.createElement("div");
      hint.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        color: #666;
        padding: 20px;
        font-size: 14px;
      `;
      hint.textContent = "No items available at your level";
      this.itemsContainer.appendChild(hint);
    }
  }

  private createItemElement(item: BuildMenuItem, playerMoney: number, playerLevel: number): HTMLDivElement {
    const canAfford = playerMoney >= item.cost;
    const meetsLevel = playerLevel >= item.levelRequired;
    const isAvailable = canAfford && meetsLevel;
    const isSelected = this.selectedItem?.id === item.id;

    const el = document.createElement("div");
    el.style.cssText = `
      background: ${isSelected ? "#E8F5E9" : "#FFFFFF"};
      border: none;
      border-bottom: 3px solid ${isSelected ? "#4CAF50" : "#E0E0E0"};
      border-radius: 10px;
      padding: 10px 8px;
      text-align: center;
      cursor: ${isAvailable ? "pointer" : "not-allowed"};
      opacity: ${isAvailable ? "1" : "0.5"};
      transition: all 0.1s ease;
      min-width: 80px;
      position: relative;
      top: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    `;

    // Icon
    const icon = document.createElement("div");
    icon.style.cssText = `
      font-size: 28px;
      margin-bottom: 6px;
      filter: ${isAvailable ? "none" : "grayscale(1)"};
    `;
    // Use emoji fallback if no icon image
    icon.innerHTML = this.getItemIcon(item);
    el.appendChild(icon);

    // Name
    const name = document.createElement("div");
    name.style.cssText = `
      font-size: 11px;
      color: #333333;
      margin-bottom: 4px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    name.textContent = item.name;
    el.appendChild(name);

    // Cost - styled as mini 3D badge
    const cost = document.createElement("div");
    cost.style.cssText = `
      display: inline-block;
      font-size: 11px;
      color: ${canAfford ? "#FFFFFF" : "#D32F2F"};
      background: ${canAfford ? "#4CAF50" : "transparent"};
      border-bottom: ${canAfford ? "2px solid #3D9140" : "none"};
      padding: ${canAfford ? "2px 8px" : "0"};
      border-radius: 4px;
      font-weight: 600;
    `;
    cost.textContent = `$${item.cost}`;
    el.appendChild(cost);

    // Level requirement if not met
    if (!meetsLevel) {
      const lvl = document.createElement("div");
      lvl.style.cssText = `
        font-size: 10px;
        color: #E65100;
        margin-top: 4px;
        font-weight: 500;
      `;
      lvl.textContent = `Lv.${item.levelRequired}`;
      el.appendChild(lvl);
    }

    // Click handler with 3D press effect
    if (isAvailable) {
      el.onclick = () => this.selectItem(item);
      el.onmouseenter = () => {
        if (!isSelected) {
          el.style.background = "#F8F8F8";
          el.style.top = "-2px";
          el.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
        }
      };
      el.onmouseleave = () => {
        if (!isSelected) {
          el.style.background = "#FFFFFF";
          el.style.top = "0";
          el.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.08)";
        }
      };
      el.onmousedown = () => {
        el.style.top = "2px";
        el.style.borderBottomWidth = "1px";
        el.style.boxShadow = "none";
      };
      el.onmouseup = () => {
        el.style.top = "-2px";
        el.style.borderBottomWidth = "3px";
        el.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
      };
    }

    return el;
  }

  private getItemIcon(item: BuildMenuItem): string {
    // Use game-provided renderer if available, otherwise use default emoji
    if (this.callbacks.renderItemIcon) {
      return this.callbacks.renderItemIcon(item);
    }
    // Default fallback - just use a generic icon
    return "📦";
  }

  private selectItem(item: BuildMenuItem): void {
    this.selectedItem = item;
    this.renderItems();
    this.callbacks.onItemSelect(item);
  }

  private renderInventory(): void {
    this.inventoryContainer.innerHTML = "";

    const config = UIConfig.getInstance().getConfig();
    const slots = config?.inventory.slots ?? 8;
    const inventory = this.callbacks.getInventory();

    for (let i = 0; i < slots; i++) {
      const slot = inventory[i] || { itemId: null, icon: null, count: 0 };
      const slotEl = this.createInventorySlot(i, slot);
      this.inventoryContainer.appendChild(slotEl);
    }
  }

  private createInventorySlot(index: number, slot: InventorySlot): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = `
      width: 64px;
      min-height: 64px;
      background: #FFFFFF;
      border: none;
      border-bottom: 3px solid #E0E0E0;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.1s ease;
      position: relative;
      padding: 4px;
      top: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    `;

    if (slot.itemId) {
      // Icon - use game-provided renderer or fallback
      const icon = document.createElement("div");
      icon.style.cssText = `font-size: 22px;`;
      if (this.callbacks.renderInventoryIcon && slot.itemId) {
        icon.innerHTML = this.callbacks.renderInventoryIcon(slot.itemId);
      } else {
        icon.textContent = slot.icon || "📦";
      }
      el.appendChild(icon);

      // Item name
      if (slot.name) {
        const name = document.createElement("div");
        name.style.cssText = `
          font-size: 9px;
          color: #666666;
          text-align: center;
          margin-top: 2px;
          line-height: 1.1;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        `;
        name.textContent = slot.name;
        el.appendChild(name);
      }

      // Count badge
      const count = document.createElement("div");
      count.style.cssText = `
        position: absolute;
        bottom: 2px;
        right: 2px;
        background: #4CAF50;
        color: #FFFFFF;
        font-size: 10px;
        padding: 2px 5px;
        border-radius: 4px;
        font-weight: 600;
        border-bottom: 2px solid #3D9140;
      `;
      count.textContent = String(slot.count);
      el.appendChild(count);
    }

    el.onclick = () => this.callbacks.onInventorySlotClick(index);
    el.onmouseenter = () => {
      el.style.background = "#F8F8F8";
      el.style.top = "-2px";
      el.style.boxShadow = "0 3px 6px rgba(0, 0, 0, 0.12)";
    };
    el.onmouseleave = () => {
      el.style.background = "#FFFFFF";
      el.style.top = "0";
      el.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.08)";
    };
    el.onmousedown = () => {
      el.style.top = "2px";
      el.style.borderBottomWidth = "1px";
      el.style.boxShadow = "none";
    };
    el.onmouseup = () => {
      el.style.top = "-2px";
      el.style.borderBottomWidth = "3px";
      el.style.boxShadow = "0 3px 6px rgba(0, 0, 0, 0.12)";
    };

    return el;
  }

  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    this.itemsContainer.style.display = this.isExpanded ? "grid" : "none";
    this.renderTabs();
  }

  public show(): void {
    if (!this.container.parentElement) {
      document.body.appendChild(this.container);
    }
    this.container.style.transform = "translateX(-50%) translateY(0)";
  }

  public hide(): void {
    this.container.style.transform = "translateX(-50%) translateY(100%)";
  }

  public destroy(): void {
    this.container.remove();
  }

  public refresh(): void {
    this.loadCategories();
    this.renderTabs();
    this.renderItems();
    this.renderInventory();
  }

  public getSelectedItem(): BuildMenuItem | null {
    return this.selectedItem;
  }

  public clearSelection(): void {
    this.selectedItem = null;
    this.renderItems();
  }

  /**
   * Darken a hex color by a percentage
   */
  private darkenColor(hex: string, percent: number): string {
    // Remove # if present
    hex = hex.replace(/^#/, '');
    
    // Parse RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    
    // Darken
    r = Math.max(0, Math.floor(r * (1 - percent / 100)));
    g = Math.max(0, Math.floor(g * (1 - percent / 100)));
    b = Math.max(0, Math.floor(b * (1 - percent / 100)));
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}
