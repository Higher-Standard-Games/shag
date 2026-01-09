/**
 * ShopSystem Tests
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

// Mock localStorage and window for Node environment
const storage: Record<string, string> = {};

globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
  length: 0,
  key: () => null,
};

globalThis.window = {
  setInterval: (() => 1) as any,
  clearInterval: (() => {}) as any,
} as any;

import { GameState } from "../GameState";
import { ShopSystem, type ShopItem, type ShopCategory } from "../ShopSystem";

const TEST_CATEGORIES: ShopCategory[] = [
  { id: "seeds", name: "Seeds", icon: "🌱", order: 1 },
  { id: "equipment", name: "Equipment", icon: "🔧", order: 2 },
];

const TEST_ITEMS: ShopItem[] = [
  {
    id: "seed_basic",
    name: "Basic Seeds",
    description: "Simple seeds",
    icon: "🌱",
    category: "seeds",
    price: 25,
    itemType: "seed",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "seed_premium",
    name: "Premium Seeds",
    description: "Better seeds",
    icon: "🌿",
    category: "seeds",
    price: 100,
    itemType: "seed",
    quantity: 1,
    requiredLevel: 3,
    maxPurchases: 5,
    stock: 10,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "sale_item",
    name: "Sale Item",
    description: "On sale!",
    icon: "💰",
    category: "equipment",
    price: 200,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: true,
    saleDiscount: 0.5, // 50% off
  },
];

describe("ShopSystem", () => {
  let shop: ShopSystem;
  let state: GameState;

  beforeAll(() => {
    GameState.resetInstance();
    ShopSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    state = GameState.getInstance();
    shop = ShopSystem.getInstance();
    shop.registerCategories(TEST_CATEGORIES);
    shop.registerItems(TEST_ITEMS);
  });

  beforeEach(() => {
    // Reset money for each test
    state.addMoney(1000);
  });

  describe("Registration", () => {
    it("should register categories", () => {
      const categories = shop.getCategories();
      expect(categories).toHaveLength(2);
    });

    it("should register items", () => {
      const items = shop.getAvailableItems();
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it("should get items by category", () => {
      const seeds = shop.getItemsByCategory("seeds");
      expect(seeds).toHaveLength(2);
    });
  });

  describe("Purchasing", () => {
    it("should purchase available item", () => {
      const initialMoney = state.getPlayer().money;
      const result = shop.purchase("seed_basic");
      
      expect(result).toBe(true);
      expect(state.getPlayer().money).toBe(initialMoney - 25);
      expect(state.hasItem("seed_basic", 1)).toBe(true);
    });

    it("should fail when not enough money", () => {
      // Spend all money
      state.spendMoney(state.getPlayer().money);
      
      const result = shop.purchase("seed_basic");
      expect(result).toBe(false);
    });

    it("should respect level requirements", () => {
      // Player starts at level 1, seed_premium requires level 3
      const result = shop.canPurchase("seed_premium");
      expect(result.canBuy).toBe(false);
      expect(result.reason).toContain("level");
    });

    it("should apply sale discount", () => {
      const initialMoney = state.getPlayer().money;
      const result = shop.purchase("sale_item");
      
      expect(result).toBe(true);
      // 200 * 0.5 = 100 (50% off)
      expect(state.getPlayer().money).toBe(initialMoney - 100);
    });
  });

  describe("Stock Management", () => {
    it("should track limited stock", () => {
      const item = shop.getItem("seed_premium");
      expect(item?.stock).toBe(10);
    });

    it("should decrease stock on purchase", () => {
      // Level up to meet requirement
      state.addXP(300);
      
      const initialStock = shop.getItem("seed_premium")?.stock ?? 0;
      shop.purchase("seed_premium");
      
      const newStock = shop.getItem("seed_premium")?.stock ?? 0;
      expect(newStock).toBe(initialStock - 1);
    });
  });

  describe("Price Calculation", () => {
    it("should return base price for non-sale items", () => {
      const price = shop.getEffectivePrice("seed_basic");
      expect(price).toBe(25);
    });

    it("should apply sale discount", () => {
      const price = shop.getEffectivePrice("sale_item");
      expect(price).toBe(100); // 200 * 0.5
    });
  });
});
