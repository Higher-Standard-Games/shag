/**
 * OrderSystem - Generic customer order management
 * 
 * Handles:
 * - Customer definitions (registered by game)
 * - Order generation based on templates
 * - Order fulfillment and rewards
 * - Order expiration
 */

import { GameState } from "./GameState";
import { GameTimer } from "./GameTimer";
import { QuestSystem } from "./QuestSystem";

/**
 * Customer template - defines a type of customer
 */
export interface CustomerTemplate {
  id: string;
  name: string;
  icon: string;
  /** Minimum player level to appear */
  unlockLevel: number;
  /** Base patience (time before order expires) in ms */
  basePatience: number;
  /** Tip multiplier (1.0 = normal, 1.5 = 50% bonus) */
  tipMultiplier: number;
  /** Item types this customer can request */
  requestableItems: string[];
  /** Min/max quantity range */
  quantityRange: [number, number];
  /** Flavor text templates */
  dialogues?: string[];
}

/**
 * Active order instance
 */
export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerIcon: string;
  /** Items requested: { itemId: quantity } */
  items: Record<string, number>;
  /** Base reward (before tips) */
  baseReward: number;
  /** Tip multiplier from customer */
  tipMultiplier: number;
  /** XP reward */
  xpReward: number;
  /** When order was created (game time) */
  createdAt: number;
  /** When order expires (game time) */
  expiresAt: number;
  /** Order status */
  status: "pending" | "ready" | "completed" | "expired";
  /** Optional dialogue */
  dialogue?: string;
}

/**
 * Order generation config
 */
export interface OrderConfig {
  /** Max simultaneous orders */
  maxOrders: number;
  /** Base interval between new orders (ms) */
  orderInterval: number;
  /** Interval variance (0-1, e.g., 0.3 = ±30%) */
  intervalVariance: number;
  /** Base price per item */
  basePricePerItem: number;
  /** XP per item */
  xpPerItem: number;
}

const DEFAULT_CONFIG: OrderConfig = {
  maxOrders: 3,
  orderInterval: 60 * 1000, // 1 minute
  intervalVariance: 0.3,
  basePricePerItem: 10,
  xpPerItem: 5,
};

type OrderEventCallback = (event: string, data: unknown) => void;

export class OrderSystem {
  private static instance: OrderSystem;

  private customers: Map<string, CustomerTemplate> = new Map();
  private orders: Map<string, Order> = new Map();
  private config: OrderConfig = { ...DEFAULT_CONFIG };
  private eventListeners: OrderEventCallback[] = [];
  private updateTaskId = "order_system_update";
  private generateTaskId = "order_system_generate";
  private lastOrderTime: number = 0;

  private constructor() {}

  public static getInstance(): OrderSystem {
    if (!OrderSystem.instance) {
      OrderSystem.instance = new OrderSystem();
    }
    return OrderSystem.instance;
  }

  public static resetInstance(): void {
    OrderSystem.instance = null as any;
  }

  // ==================== Initialization ====================

  public init(): void {
    this.startUpdateLoop();
  }

  private startUpdateLoop(): void {
    // Check for expired orders every second
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 1000, () => {
      this.checkExpiredOrders();
    });

    // Generate new orders periodically
    GameTimer.getInstance().scheduleTask(this.generateTaskId, 5000, () => {
      this.tryGenerateOrder();
    });
  }

  // ==================== Configuration ====================

  public setConfig(config: Partial<OrderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): OrderConfig {
    return { ...this.config };
  }

  // ==================== Customer Registration ====================

  public registerCustomer(customer: CustomerTemplate): void {
    this.customers.set(customer.id, customer);
  }

  public registerCustomers(customers: CustomerTemplate[]): void {
    for (const customer of customers) {
      this.registerCustomer(customer);
    }
  }

  public getCustomer(id: string): CustomerTemplate | undefined {
    return this.customers.get(id);
  }

  public getUnlockedCustomers(): CustomerTemplate[] {
    const level = GameState.getInstance().getPlayer().level;
    return Array.from(this.customers.values()).filter(c => c.unlockLevel <= level);
  }

  public clearCustomers(): void {
    this.customers.clear();
  }

  // ==================== Order Generation ====================

  private tryGenerateOrder(): void {
    const now = GameTimer.getInstance().getGameTime();
    
    // Check if we can generate
    if (this.orders.size >= this.config.maxOrders) return;
    
    // Check interval with variance
    const variance = 1 + (Math.random() * 2 - 1) * this.config.intervalVariance;
    const interval = this.config.orderInterval * variance;
    
    if (now - this.lastOrderTime < interval) return;

    // Get available customers
    const customers = this.getUnlockedCustomers();
    if (customers.length === 0) return;

    // Pick random customer
    const customer = customers[Math.floor(Math.random() * customers.length)];
    
    // Generate order
    const order = this.generateOrder(customer);
    if (order) {
      this.orders.set(order.id, order);
      this.lastOrderTime = now;
      this.emit("order_created", { order });
      console.log(`New order from ${customer.name}: ${JSON.stringify(order.items)}`);
    }
  }

  private generateOrder(customer: CustomerTemplate): Order | null {
    if (customer.requestableItems.length === 0) return null;

    const now = GameTimer.getInstance().getGameTime();
    const id = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Pick random items
    const items: Record<string, number> = {};
    const numItems = 1 + Math.floor(Math.random() * 2); // 1-2 item types
    
    for (let i = 0; i < numItems; i++) {
      const itemId = customer.requestableItems[
        Math.floor(Math.random() * customer.requestableItems.length)
      ];
      const [minQty, maxQty] = customer.quantityRange;
      const quantity = minQty + Math.floor(Math.random() * (maxQty - minQty + 1));
      items[itemId] = (items[itemId] || 0) + quantity;
    }

    // Calculate rewards
    const totalItems = Object.values(items).reduce((a, b) => a + b, 0);
    const baseReward = totalItems * this.config.basePricePerItem;
    const xpReward = totalItems * this.config.xpPerItem;

    // Pick dialogue
    const dialogue = customer.dialogues && customer.dialogues.length > 0
      ? customer.dialogues[Math.floor(Math.random() * customer.dialogues.length)]
      : undefined;

    return {
      id,
      customerId: customer.id,
      customerName: customer.name,
      customerIcon: customer.icon,
      items,
      baseReward,
      tipMultiplier: customer.tipMultiplier,
      xpReward,
      createdAt: now,
      expiresAt: now + customer.basePatience,
      status: "pending",
      dialogue,
    };
  }

  /**
   * Manually create an order (for quests, tutorials, etc.)
   */
  public createOrder(
    customerId: string,
    items: Record<string, number>,
    options?: {
      baseReward?: number;
      xpReward?: number;
      expiresIn?: number;
      dialogue?: string;
    }
  ): Order | null {
    const customer = this.customers.get(customerId);
    if (!customer) return null;

    const now = GameTimer.getInstance().getGameTime();
    const id = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalItems = Object.values(items).reduce((a, b) => a + b, 0);

    const order: Order = {
      id,
      customerId: customer.id,
      customerName: customer.name,
      customerIcon: customer.icon,
      items,
      baseReward: options?.baseReward ?? totalItems * this.config.basePricePerItem,
      tipMultiplier: customer.tipMultiplier,
      xpReward: options?.xpReward ?? totalItems * this.config.xpPerItem,
      createdAt: now,
      expiresAt: now + (options?.expiresIn ?? customer.basePatience),
      status: "pending",
      dialogue: options?.dialogue,
    };

    this.orders.set(order.id, order);
    this.emit("order_created", { order });
    return order;
  }

  // ==================== Order Management ====================

  public getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  public getActiveOrders(): Order[] {
    return Array.from(this.orders.values()).filter(
      o => o.status === "pending" || o.status === "ready"
    );
  }

  public getPendingOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o => o.status === "pending");
  }

  /**
   * Check if player can fulfill an order
   */
  public canFulfill(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "pending") return false;

    const inventory = GameState.getInstance().getInventory();
    
    for (const [itemId, required] of Object.entries(order.items)) {
      const item = inventory.items.find(i => i.id === itemId);
      if (!item || item.quantity < required) {
        return false;
      }
    }
    return true;
  }

  /**
   * Update order status based on inventory
   */
  public updateOrderStatus(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "pending") return;

    if (this.canFulfill(orderId)) {
      order.status = "ready";
      this.emit("order_ready", { order });
    }
  }

  /**
   * Fulfill an order - consume items and give rewards
   */
  public fulfillOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;
    if (order.status === "completed" || order.status === "expired") return false;

    // Check inventory
    if (!this.canFulfill(orderId)) {
      this.emit("order_failed", { order, reason: "insufficient_items" });
      return false;
    }

    const state = GameState.getInstance();

    // Consume items
    for (const [itemId, quantity] of Object.entries(order.items)) {
      state.removeItem(itemId, quantity);
    }

    // Calculate final reward with tip
    const now = GameTimer.getInstance().getGameTime();
    const timeRemaining = order.expiresAt - now;
    const timeTotal = order.expiresAt - order.createdAt;
    const speedBonus = timeRemaining > 0 ? (timeRemaining / timeTotal) * 0.2 : 0; // Up to 20% speed bonus
    
    const finalReward = Math.floor(
      order.baseReward * order.tipMultiplier * (1 + speedBonus)
    );

    // Give rewards
    state.addMoney(finalReward);
    state.addXP(order.xpReward);

    // Update stats
    state.incrementStat("ordersCompleted");
    state.incrementStat("moneyEarned", finalReward);

    // Update quest objectives
    QuestSystem.getInstance().updateObjective("complete_order", {});
    QuestSystem.getInstance().updateObjective("earn", { amount: finalReward });

    // Mark complete
    order.status = "completed";
    this.emit("order_completed", { 
      order, 
      reward: finalReward, 
      xp: order.xpReward,
      speedBonus: speedBonus > 0,
    });

    console.log(`Order completed! Earned $${finalReward} + ${order.xpReward} XP`);

    // Remove after a delay
    setTimeout(() => {
      this.orders.delete(orderId);
    }, 2000);

    return true;
  }

  /**
   * Cancel/dismiss an order
   */
  public cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;

    this.orders.delete(orderId);
    this.emit("order_cancelled", { order });
    return true;
  }

  private checkExpiredOrders(): void {
    const now = GameTimer.getInstance().getGameTime();

    for (const order of this.orders.values()) {
      if (order.status === "pending" || order.status === "ready") {
        if (now >= order.expiresAt) {
          order.status = "expired";
          this.emit("order_expired", { order });
          console.log(`Order expired: ${order.id}`);

          // Remove after a delay
          setTimeout(() => {
            this.orders.delete(order.id);
          }, 2000);
        }
      }
    }
  }

  /**
   * Get time remaining for an order (ms)
   */
  public getTimeRemaining(orderId: string): number {
    const order = this.orders.get(orderId);
    if (!order) return 0;
    
    const now = GameTimer.getInstance().getGameTime();
    return Math.max(0, order.expiresAt - now);
  }

  // ==================== Events ====================

  public onOrderEvent(callback: OrderEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offOrderEvent(callback: OrderEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
  }

  // ==================== Serialization ====================

  public getState(): Order[] {
    return Array.from(this.orders.values());
  }

  public loadState(orders: Order[]): void {
    this.orders.clear();
    for (const order of orders) {
      this.orders.set(order.id, order);
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.orders.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    GameTimer.getInstance().cancelTask(this.generateTaskId);
    this.clear();
    this.eventListeners = [];
  }
}
