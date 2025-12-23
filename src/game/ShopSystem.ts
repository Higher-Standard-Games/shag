/**
 * ShopSystem - Generic shop/store management
 * 
 * Handles:
 * - Shop item definitions (registered by game)
 * - Purchasing items
 * - Stock management (optional)
 * - Discounts and sales
 */

import { EventBus } from "../engine/core/EventBus";
import { GameState } from "./GameState";
import { CuringSystem } from "./CuringSystem";

/**
 * Shop item definition
 */
export interface ShopItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Category for filtering */
  category: string;
  /** Base price */
  price: number;
  /** Item type when added to inventory */
  itemType: "seed" | "consumable" | "equipment" | "material" | "special";
  /** Quantity given per purchase */
  quantity: number;
  /** Required player level to see/buy */
  requiredLevel: number;
  /** Max purchases allowed (-1 = unlimited) */
  maxPurchases: number;
  /** Current stock (-1 = unlimited) */
  stock: number;
  /** Restock interval in ms (0 = never) */
  restockInterval: number;
  /** Whether item is currently visible */
  isVisible: boolean;
  /** Whether item is currently on sale */
  onSale: boolean;
  /** Sale discount (0-1, e.g., 0.2 = 20% off) */
  saleDiscount: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Shop category definition
 */
export interface ShopCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
}

/**
 * Purchase record
 */
export interface PurchaseRecord {
  itemId: string;
  quantity: number;
  totalPrice: number;
  timestamp: number;
}

type ShopEventCallback = (event: string, data: unknown) => void;

export class ShopSystem {
  private static instance: ShopSystem;

  private items: Map<string, ShopItem> = new Map();
  private categories: Map<string, ShopCategory> = new Map();
  private purchaseHistory: PurchaseRecord[] = [];
  private purchaseCounts: Map<string, number> = new Map();
  private lastRestock: Map<string, number> = new Map();
  private eventListeners: ShopEventCallback[] = [];

  private constructor() {}

  public static getInstance(): ShopSystem {
    if (!ShopSystem.instance) {
      ShopSystem.instance = new ShopSystem();
    }
    return ShopSystem.instance;
  }

  public static resetInstance(): void {
    ShopSystem.instance = null as any;
  }

  // ==================== Category Registration ====================

  public registerCategory(category: ShopCategory): void {
    this.categories.set(category.id, category);
  }

  public registerCategories(categories: ShopCategory[]): void {
    for (const category of categories) {
      this.registerCategory(category);
    }
  }

  public getCategories(): ShopCategory[] {
    return Array.from(this.categories.values()).sort((a, b) => a.order - b.order);
  }

  public clearCategories(): void {
    this.categories.clear();
  }

  // ==================== Item Registration ====================

  public registerItem(item: ShopItem): void {
    this.items.set(item.id, { ...item });
  }

  public registerItems(items: ShopItem[]): void {
    for (const item of items) {
      this.registerItem(item);
    }
  }

  public getItem(id: string): ShopItem | undefined {
    return this.items.get(id);
  }

  public clearItems(): void {
    this.items.clear();
  }

  // ==================== Item Queries ====================

  public getAvailableItems(): ShopItem[] {
    const level = GameState.getInstance().getPlayer().level;
    return Array.from(this.items.values()).filter(item => 
      item.isVisible && 
      item.requiredLevel <= level &&
      (item.stock === -1 || item.stock > 0) &&
      (item.maxPurchases === -1 || (this.purchaseCounts.get(item.id) || 0) < item.maxPurchases)
    );
  }

  public getItemsByCategory(category: string): ShopItem[] {
    return this.getAvailableItems().filter(item => item.category === category);
  }

  public getSaleItems(): ShopItem[] {
    return this.getAvailableItems().filter(item => item.onSale);
  }

  /**
   * Get effective price (with sale discount)
   */
  public getEffectivePrice(itemId: string): number {
    const item = this.items.get(itemId);
    if (!item) return 0;
    
    if (item.onSale && item.saleDiscount > 0) {
      return Math.floor(item.price * (1 - item.saleDiscount));
    }
    return item.price;
  }

  // ==================== Purchasing ====================

  /**
   * Check if player can purchase an item
   */
  public canPurchase(itemId: string, quantity: number = 1): { 
    canBuy: boolean; 
    reason?: string;
  } {
    const item = this.items.get(itemId);
    if (!item) {
      return { canBuy: false, reason: "Item not found" };
    }

    if (!item.isVisible) {
      return { canBuy: false, reason: "Item not available" };
    }

    const state = GameState.getInstance();
    const level = state.getPlayer().level;

    if (item.requiredLevel > level) {
      return { canBuy: false, reason: `Requires level ${item.requiredLevel}` };
    }

    if (item.stock !== -1 && item.stock < quantity) {
      return { canBuy: false, reason: "Out of stock" };
    }

    const purchaseCount = this.purchaseCounts.get(itemId) || 0;
    if (item.maxPurchases !== -1 && purchaseCount + quantity > item.maxPurchases) {
      return { canBuy: false, reason: "Purchase limit reached" };
    }

    const totalPrice = this.getEffectivePrice(itemId) * quantity;
    if (!state.canAfford(totalPrice)) {
      return { canBuy: false, reason: "Not enough money" };
    }

    // Check inventory space
    const inventory = state.getInventory();
    const existingItem = inventory.items.find(i => i.id === itemId);
    if (!existingItem && inventory.items.length >= inventory.maxSlots) {
      return { canBuy: false, reason: "Inventory full" };
    }

    return { canBuy: true };
  }

  /**
   * Purchase an item
   */
  public purchase(itemId: string, quantity: number = 1): boolean {
    const check = this.canPurchase(itemId, quantity);
    if (!check.canBuy) {
      this.emit("purchase_failed", { itemId, quantity, reason: check.reason });
      return false;
    }

    const item = this.items.get(itemId)!;
    const state = GameState.getInstance();
    const totalPrice = this.getEffectivePrice(itemId) * quantity;

    // Deduct money
    state.spendMoney(totalPrice);

    // Special handling for curing barrels - register with CuringSystem
    const isBarrel = itemId.includes("barrel");
    if (isBarrel) {
      const curingSystem = CuringSystem.getInstance();
      for (let i = 0; i < quantity; i++) {
        // Add barrel to CuringSystem's owned barrels (money already deducted)
        const barrelId = `barrel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        curingSystem.addOwnedBarrel(barrelId, itemId);
      }
    } else {
      // Add to inventory for non-barrel items
      const itemQuantity = item.quantity * quantity;
      state.addItem(itemId, item.itemType, itemQuantity, item.metadata);
    }

    // Update stock
    if (item.stock !== -1) {
      item.stock -= quantity;
    }

    // Update purchase count
    const currentCount = this.purchaseCounts.get(itemId) || 0;
    this.purchaseCounts.set(itemId, currentCount + quantity);

    // Record purchase
    const record: PurchaseRecord = {
      itemId,
      quantity,
      totalPrice,
      timestamp: Date.now(),
    };
    this.purchaseHistory.push(record);

    this.emit("purchase_success", { item, quantity, totalPrice, record });
    console.log(`Purchased ${quantity}x ${item.name} for $${totalPrice}`);

    return true;
  }

  // ==================== Stock Management ====================

  /**
   * Restock an item
   */
  public restockItem(itemId: string, amount: number): void {
    const item = this.items.get(itemId);
    if (!item) return;

    if (item.stock !== -1) {
      item.stock += amount;
      this.lastRestock.set(itemId, Date.now());
      this.emit("item_restocked", { item, amount });
    }
  }

  /**
   * Set item stock
   */
  public setStock(itemId: string, stock: number): void {
    const item = this.items.get(itemId);
    if (item) {
      item.stock = stock;
    }
  }

  // ==================== Sales ====================

  /**
   * Put an item on sale
   */
  public setSale(itemId: string, discount: number): void {
    const item = this.items.get(itemId);
    if (item) {
      item.onSale = discount > 0;
      item.saleDiscount = Math.max(0, Math.min(1, discount));
      this.emit("sale_started", { item, discount });
    }
  }

  /**
   * End a sale
   */
  public endSale(itemId: string): void {
    const item = this.items.get(itemId);
    if (item) {
      item.onSale = false;
      item.saleDiscount = 0;
      this.emit("sale_ended", { item });
    }
  }

  /**
   * Set visibility
   */
  public setVisible(itemId: string, visible: boolean): void {
    const item = this.items.get(itemId);
    if (item) {
      item.isVisible = visible;
    }
  }

  // ==================== History ====================

  public getPurchaseHistory(): PurchaseRecord[] {
    return [...this.purchaseHistory];
  }

  public getPurchaseCount(itemId: string): number {
    return this.purchaseCounts.get(itemId) || 0;
  }

  public getTotalSpent(): number {
    return this.purchaseHistory.reduce((sum, r) => sum + r.totalPrice, 0);
  }

  // ==================== Events ====================

  public onShopEvent(callback: ShopEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offShopEvent(callback: ShopEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    // Legacy callback system
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
    // Global EventBus
    EventBus.emit(`shop:${event}`, data as object);
  }

  // ==================== Serialization ====================

  public getState(): {
    purchaseHistory: PurchaseRecord[];
    purchaseCounts: Record<string, number>;
    stocks: Record<string, number>;
  } {
    const stocks: Record<string, number> = {};
    for (const [id, item] of this.items) {
      if (item.stock !== -1) {
        stocks[id] = item.stock;
      }
    }

    return {
      purchaseHistory: this.purchaseHistory,
      purchaseCounts: Object.fromEntries(this.purchaseCounts),
      stocks,
    };
  }

  public loadState(state: {
    purchaseHistory?: PurchaseRecord[];
    purchaseCounts?: Record<string, number>;
    stocks?: Record<string, number>;
  }): void {
    if (state.purchaseHistory) {
      this.purchaseHistory = state.purchaseHistory;
    }
    if (state.purchaseCounts) {
      this.purchaseCounts = new Map(Object.entries(state.purchaseCounts));
    }
    if (state.stocks) {
      for (const [id, stock] of Object.entries(state.stocks)) {
        const item = this.items.get(id);
        if (item) {
          item.stock = stock;
        }
      }
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.purchaseHistory = [];
    this.purchaseCounts.clear();
    this.lastRestock.clear();
  }

  public dispose(): void {
    this.clear();
    this.eventListeners = [];
  }
}
