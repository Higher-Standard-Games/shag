/**
 * OrderSystem Tests
 */

import { describe, it, expect, beforeAll } from "vitest";

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
import { OrderSystem, type CustomerTemplate } from "../OrderSystem";

const TEST_CUSTOMERS: CustomerTemplate[] = [
  {
    id: "customer_basic",
    name: "Basic Customer",
    icon: "🧑",
    unlockLevel: 1,
    basePatience: 60000, // 1 minute
    tipMultiplier: 1.0,
    requestableItems: ["harvest_basic"],
    quantityRange: [1, 3],
    dialogues: ["Hello!"],
  },
  {
    id: "customer_premium",
    name: "Premium Customer",
    icon: "💎",
    unlockLevel: 5,
    basePatience: 30000,
    tipMultiplier: 1.5,
    requestableItems: ["harvest_premium"],
    quantityRange: [2, 5],
    dialogues: ["I want the good stuff!"],
  },
];

describe("OrderSystem", () => {
  let orders: OrderSystem;
  let state: GameState;

  beforeAll(() => {
    GameState.resetInstance();
    OrderSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    state = GameState.getInstance();
    orders = OrderSystem.getInstance();
    orders.registerCustomers(TEST_CUSTOMERS);
  });

  describe("Registration", () => {
    it("should register customers", () => {
      const customer = orders.getCustomer("customer_basic");
      expect(customer).toBeDefined();
      expect(customer?.name).toBe("Basic Customer");
    });

    it("should get unlocked customers based on level", () => {
      const unlocked = orders.getUnlockedCustomers();
      // Only level 1 customer should be available
      expect(unlocked.some((c: CustomerTemplate) => c.id === "customer_basic")).toBe(true);
      expect(unlocked.some((c: CustomerTemplate) => c.id === "customer_premium")).toBe(false);
    });
  });

  describe("Order Creation", () => {
    it("should create order manually", () => {
      const order = orders.createOrder("customer_basic", { "harvest_basic": 2 });
      expect(order).toBeDefined();
      expect(order?.customerId).toBe("customer_basic");
      expect(order?.items["harvest_basic"]).toBe(2);
    });

    it("should not create order for unknown customer", () => {
      const order = orders.createOrder("unknown_customer", { "item": 1 });
      expect(order).toBeNull();
    });
  });

  describe("Order Management", () => {
    it("should track active orders", () => {
      // Create a fresh order
      orders.createOrder("customer_basic", { "harvest_basic": 1 });
      const active = orders.getActiveOrders();
      expect(active.length).toBeGreaterThan(0);
    });

    it("should check if order can be fulfilled", () => {
      const order = orders.createOrder("customer_basic", { "test_harvest": 5 });
      if (!order) throw new Error("Order not created");

      // Without items, cannot fulfill
      expect(orders.canFulfill(order.id)).toBe(false);

      // Add items
      state.addItem("test_harvest", "harvest", 5);
      expect(orders.canFulfill(order.id)).toBe(true);
    });

    it("should fulfill order when player has items", () => {
      const order = orders.createOrder("customer_basic", { "fulfill_test": 2 });
      if (!order) throw new Error("Order not created");

      // Add required items
      state.addItem("fulfill_test", "harvest", 2);
      const initialMoney = state.getPlayer().money;

      const result = orders.fulfillOrder(order.id);
      expect(result).toBe(true);
      expect(state.getPlayer().money).toBeGreaterThan(initialMoney);
    });

    it("should fail to fulfill without items", () => {
      const order = orders.createOrder("customer_basic", { "missing_item": 10 });
      if (!order) throw new Error("Order not created");

      const result = orders.fulfillOrder(order.id);
      expect(result).toBe(false);
    });
  });
});
