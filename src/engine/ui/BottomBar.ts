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

import bottomBarCSS from "./styles/BottomBar.css?raw";
import { type BuildMenuCategory, type BuildMenuItem, UIConfig } from "./UIConfig";
import { UIStyles } from "./UIStyles";

export interface InventorySlot {
  itemId: string | null;
  icon: string | null;
  count: number;
  name?: string; // Display name for the item
}

/**
 * Callbacks for game-specific customization
 * The engine handles layout/behavior, game provides content/styling
 */
export interface BottomBarCallbacks {
  // Actions
  onItemSelect: (item: BuildMenuItem) => void;
  onInventorySlotClick: (slotIndex: number) => void;
  onCategoryChange?: (categoryId: string) => void; // Called when category tab changes
  onCollapse?: () => void; // Called when bar is minimized

  // Data providers
  getPlayerLevel: () => number;
  getPlayerMoney: () => number;
  getInventory: () => InventorySlot[];

  // Customization (optional - engine provides defaults)
  renderItemIcon?: (item: BuildMenuItem) => string; // Returns HTML/emoji for item icon
  renderInventoryIcon?: (itemId: string) => string; // Returns HTML/emoji for inventory
  getItemTooltip?: (item: BuildMenuItem) => string; // Custom tooltip text
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

    // Inject styles once
    UIStyles.injectCSS("bottom-bar", bottomBarCSS);

    this.container = this.createContainer();
    this.tabsContainer = this.createTabsContainer();
    this.itemsContainer = this.createItemsContainer();
    this.inventoryContainer = this.createInventoryContainer();

    this.container.appendChild(this.tabsContainer);
    this.container.appendChild(this.itemsContainer);
    // Note: Inventory is now shown in a separate dialog via GameHUD
    // this.container.appendChild(this.inventoryContainer);
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.id = "bottom-bar";
    return container;
  }

  private createTabsContainer(): HTMLDivElement {
    const tabs = document.createElement("div");
    tabs.id = "bottom-bar-tabs";
    return tabs;
  }

  private createItemsContainer(): HTMLDivElement {
    const items = document.createElement("div");
    items.id = "bottom-bar-items";
    return items;
  }

  private createInventoryContainer(): HTMLDivElement {
    const inventory = document.createElement("div");
    inventory.id = "bottom-bar-inventory";
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
    collapseBtn.className = "bottom-bar-collapse";
    collapseBtn.innerHTML = this.isExpanded ? "▼" : "▲";
    collapseBtn.onclick = () => this.toggleExpanded();
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

    tab.className = `bottom-bar-tab${isSelected ? " active" : ""}`;
    tab.innerHTML = `${category.icon} <strong>${category.name}</strong>`;

    // Set dynamic color via CSS variables for active state
    if (isSelected) {
      tab.style.setProperty("--tab-color", category.color);
      tab.style.setProperty("--tab-border-color", this.darkenColor(category.color, 20));
    }

    tab.onclick = () => this.selectCategory(category.id);
    return tab;
  }

  private selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.selectedItem = null;

    // Auto-expand if minimized when clicking a tab
    if (!this.isExpanded) {
      this.isExpanded = true;
      this.itemsContainer.classList.remove("collapsed");
    }

    // Notify game of category change (e.g., to exit build mode)
    this.callbacks.onCategoryChange?.(categoryId);

    this.renderTabs();
    this.renderItems();
  }

  private renderItems(): void {
    this.itemsContainer.innerHTML = "";

    if (!this.selectedCategory) return;

    const category = this.categories.find((c) => c.id === this.selectedCategory);
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
      hint.className = "bottom-bar-hint";
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
    el.className = `bottom-bar-item${isSelected ? " selected" : ""}${!isAvailable ? " disabled" : ""}`;

    // Icon
    const icon = document.createElement("div");
    icon.className = `bottom-bar-item-icon${!isAvailable ? " disabled" : ""}`;
    icon.innerHTML = this.getItemIcon(item);
    el.appendChild(icon);

    // Name
    const name = document.createElement("div");
    name.className = "bottom-bar-item-name";
    name.textContent = item.name;
    el.appendChild(name);

    // Cost
    const cost = document.createElement("div");
    cost.className = `bottom-bar-item-cost ${canAfford ? "affordable" : "expensive"}`;
    cost.textContent = `$${item.cost}`;
    el.appendChild(cost);

    // Level requirement if not met
    if (!meetsLevel) {
      const lvl = document.createElement("div");
      lvl.className = "bottom-bar-item-level";
      lvl.textContent = `Lv.${item.levelRequired}`;
      el.appendChild(lvl);
    }

    // Click handler
    if (isAvailable) {
      el.onclick = () => this.selectItem(item);
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
    el.className = "bottom-bar-slot";

    if (slot.itemId) {
      // Icon
      const icon = document.createElement("div");
      icon.className = "bottom-bar-slot-icon";
      if (this.callbacks.renderInventoryIcon && slot.itemId) {
        icon.innerHTML = this.callbacks.renderInventoryIcon(slot.itemId);
      } else {
        icon.textContent = slot.icon || "📦";
      }
      el.appendChild(icon);

      // Item name
      if (slot.name) {
        const name = document.createElement("div");
        name.className = "bottom-bar-slot-name";
        name.textContent = slot.name;
        el.appendChild(name);
      }

      // Count badge
      const count = document.createElement("div");
      count.className = "bottom-bar-slot-count";
      count.textContent = String(slot.count);
      el.appendChild(count);
    }

    el.onclick = () => this.callbacks.onInventorySlotClick(index);
    return el;
  }

  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
      this.itemsContainer.classList.remove("collapsed");
    } else {
      this.itemsContainer.classList.add("collapsed");
      // Notify game when bar is minimized (e.g., to exit build mode)
      this.callbacks.onCollapse?.();
    }
    this.renderTabs();
  }

  public show(): void {
    if (!this.container.parentElement) {
      document.body.appendChild(this.container);
    }
    this.container.classList.remove("hidden");
  }

  public hide(): void {
    this.container.classList.add("hidden");
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
    hex = hex.replace(/^#/, "");

    // Parse RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Darken
    r = Math.max(0, Math.floor(r * (1 - percent / 100)));
    g = Math.max(0, Math.floor(g * (1 - percent / 100)));
    b = Math.max(0, Math.floor(b * (1 - percent / 100)));

    // Convert back to hex
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
}
