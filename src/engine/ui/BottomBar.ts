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
      background: linear-gradient(to bottom, rgba(30, 30, 30, 0.95), rgba(20, 20, 20, 0.98));
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      z-index: 1000;
      font-family: 'Segoe UI', system-ui, sans-serif;
      transition: transform 0.2s ease;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-bottom: none;
    `;
    return container;
  }

  private createTabsContainer(): HTMLDivElement {
    const tabs = document.createElement("div");
    tabs.id = "bottom-bar-tabs";
    tabs.style.cssText = `
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
      scrollbar-color: rgba(255,255,255,0.3) transparent;
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
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(0, 0, 0, 0.3);
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
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #888;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      margin-right: 8px;
      transition: all 0.2s;
    `;
    collapseBtn.onclick = () => this.toggleExpanded();
    collapseBtn.onmouseenter = () => collapseBtn.style.background = "rgba(255, 255, 255, 0.2)";
    collapseBtn.onmouseleave = () => collapseBtn.style.background = "rgba(255, 255, 255, 0.1)";
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
    
    tab.innerHTML = `${category.icon} ${category.name}`;
    tab.style.cssText = `
      background: ${isSelected ? category.color : "rgba(255, 255, 255, 0.1)"};
      border: none;
      color: ${isSelected ? "#fff" : "#aaa"};
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: ${isSelected ? "600" : "400"};
      white-space: nowrap;
      transition: all 0.2s;
      box-shadow: ${isSelected ? "0 2px 8px rgba(0,0,0,0.3)" : "none"};
    `;

    tab.onclick = () => this.selectCategory(category.id);
    tab.onmouseenter = () => {
      if (!isSelected) {
        tab.style.background = "rgba(255, 255, 255, 0.2)";
        tab.style.color = "#fff";
      }
    };
    tab.onmouseleave = () => {
      if (!isSelected) {
        tab.style.background = "rgba(255, 255, 255, 0.1)";
        tab.style.color = "#aaa";
      }
    };

    return tab;
  }

  private selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.selectedItem = null;
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
      background: ${isSelected ? "rgba(76, 175, 80, 0.3)" : "rgba(255, 255, 255, 0.05)"};
      border: 2px solid ${isSelected ? "#4CAF50" : "rgba(255, 255, 255, 0.1)"};
      border-radius: 10px;
      padding: 10px 8px;
      text-align: center;
      cursor: ${isAvailable ? "pointer" : "not-allowed"};
      opacity: ${isAvailable ? "1" : "0.5"};
      transition: all 0.2s;
      min-width: 80px;
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
      color: #fff;
      margin-bottom: 4px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    name.textContent = item.name;
    el.appendChild(name);

    // Cost
    const cost = document.createElement("div");
    cost.style.cssText = `
      font-size: 12px;
      color: ${canAfford ? "#4CAF50" : "#f44336"};
      font-weight: 600;
    `;
    cost.textContent = `$${item.cost}`;
    el.appendChild(cost);

    // Level requirement if not met
    if (!meetsLevel) {
      const lvl = document.createElement("div");
      lvl.style.cssText = `
        font-size: 10px;
        color: #ff9800;
        margin-top: 2px;
      `;
      lvl.textContent = `Lv.${item.levelRequired}`;
      el.appendChild(lvl);
    }

    // Click handler
    if (isAvailable) {
      el.onclick = () => this.selectItem(item);
      el.onmouseenter = () => {
        if (!isSelected) {
          el.style.background = "rgba(255, 255, 255, 0.1)";
          el.style.borderColor = "rgba(255, 255, 255, 0.3)";
        }
      };
      el.onmouseleave = () => {
        if (!isSelected) {
          el.style.background = "rgba(255, 255, 255, 0.05)";
          el.style.borderColor = "rgba(255, 255, 255, 0.1)";
        }
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
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
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

      // Count badge
      if (slot.count > 1) {
        const count = document.createElement("div");
        count.style.cssText = `
          position: absolute;
          bottom: 2px;
          right: 2px;
          background: rgba(0, 0, 0, 0.7);
          color: #fff;
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 4px;
          font-weight: 600;
        `;
        count.textContent = String(slot.count);
        el.appendChild(count);
      }
    }

    el.onclick = () => this.callbacks.onInventorySlotClick(index);
    el.onmouseenter = () => {
      el.style.background = "rgba(255, 255, 255, 0.1)";
      el.style.borderColor = "rgba(255, 255, 255, 0.3)";
    };
    el.onmouseleave = () => {
      el.style.background = "rgba(255, 255, 255, 0.05)";
      el.style.borderColor = "rgba(255, 255, 255, 0.15)";
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
}
