/**
 * OrderSystem - Generic customer order management
 * 
 * Handles:
 * - Customer definitions (registered by game)
 * - Order generation based on templates
 * - Order fulfillment and rewards
 * - Order expiration
 */

import { EventBus } from "../../engine/core/EventBus";
import { GameState } from "./GameState";
import { GameTimer } from "../../engine/core/GameTimer";
import { PlantSystem } from "./PlantSystem";
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

/**
 * Autosale trigger - for NPC dealers who can automatically sell products
 * Hidden feature for future NPC integration
 */
export interface AutosaleTrigger {
  /** Unique identifier for this trigger */
  id: string;
  /** NPC or source name (for future UI) */
  sourceName: string;
  /** Probability of successful sale (0-1) */
  successRate: number;
  /** Strain tiers this trigger can handle (empty = all tiers) */
  allowedTiers?: number[];
  /** Maximum grams per autosale attempt */
  maxGramsPerSale: number;
  /** Cooldown between autosale attempts (ms) */
  cooldownMs: number;
  /** Last attempt timestamp */
  lastAttemptAt: number;
  /** Whether this trigger is currently active */
  active: boolean;
  /** Price multiplier (1.0 = normal market rate) */
  priceMultiplier: number;
  /** Commission rate (0-1, e.g., 0.1 = 10% goes to the NPC, player gets 90%) */
  commission: number;
}

const DEFAULT_CONFIG: OrderConfig = {
  maxOrders: 3,
  orderInterval: 60 * 1000, // 1 minute
  intervalVariance: 0.3,
  basePricePerItem: 10,
  xpPerItem: 5,
};

// Daily sale limit constants
const DAILY_LIMIT_BASE = 50; // grams at level 1
const DAILY_LIMIT_MAX = 200; // grams at level 10+
const DAILY_LIMIT_LEVEL_CAP = 10; // level at which max is reached

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
  
  // Daily sale tracking
  private dailySoldGrams: number = 0;
  private lastResetDay: number = 0;
  
  // Autosale triggers (hidden feature for NPC dealers)
  private autosaleTriggers: Map<string, AutosaleTrigger> = new Map();
  private autosaleTaskId = "order_system_autosale";

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
    
    // Process autosale triggers periodically
    GameTimer.getInstance().scheduleTask(this.autosaleTaskId, 10000, () => {
      this.processAutosales();
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

  // ==================== Daily Limit ====================

  /**
   * Get the daily sale limit based on player level
   * Scales from 50g at level 1 to 200g at level 10+
   */
  public getDailyLimit(): number {
    const level = GameState.getInstance().getPlayer().level;
    const clampedLevel = Math.min(level, DAILY_LIMIT_LEVEL_CAP);
    const progress = (clampedLevel - 1) / (DAILY_LIMIT_LEVEL_CAP - 1);
    return Math.floor(DAILY_LIMIT_BASE + progress * (DAILY_LIMIT_MAX - DAILY_LIMIT_BASE));
  }

  /**
   * Get remaining daily sale capacity in grams
   */
  public getRemainingDailyLimit(): number {
    this.checkDayReset();
    return Math.max(0, this.getDailyLimit() - this.dailySoldGrams);
  }

  /**
   * Get amount sold today in grams
   */
  public getDailySold(): number {
    this.checkDayReset();
    return this.dailySoldGrams;
  }

  /**
   * Check if we need to reset daily counter (new day)
   */
  private checkDayReset(): void {
    const currentDay = GameTimer.getInstance().getDay();
    if (currentDay !== this.lastResetDay) {
      this.dailySoldGrams = 0;
      this.lastResetDay = currentDay;
      this.emit("daily_limit_reset", { day: currentDay, limit: this.getDailyLimit() });
    }
  }

  /**
   * Record a sale amount against daily limit
   */
  private recordSale(grams: number): void {
    this.checkDayReset();
    this.dailySoldGrams += grams;
    this.emit("daily_sold_updated", { 
      sold: this.dailySoldGrams, 
      limit: this.getDailyLimit(),
      remaining: this.getRemainingDailyLimit(),
    });
  }

  // ==================== Autosale System (Hidden) ====================
  // For future NPC dealer integration - NPCs can automatically sell products

  /**
   * Register an autosale trigger (e.g., from an NPC dealer)
   */
  public registerAutosaleTrigger(trigger: Omit<AutosaleTrigger, "lastAttemptAt">): void {
    this.autosaleTriggers.set(trigger.id, {
      ...trigger,
      lastAttemptAt: 0,
    });
    this.emit("autosale_registered", { trigger });
  }

  /**
   * Remove an autosale trigger
   */
  public removeAutosaleTrigger(triggerId: string): boolean {
    const removed = this.autosaleTriggers.delete(triggerId);
    if (removed) {
      this.emit("autosale_removed", { triggerId });
    }
    return removed;
  }

  /**
   * Get all active autosale triggers
   */
  public getAutosaleTriggers(): AutosaleTrigger[] {
    return Array.from(this.autosaleTriggers.values());
  }

  /**
   * Enable/disable an autosale trigger
   */
  public setAutosaleTriggerActive(triggerId: string, active: boolean): boolean {
    const trigger = this.autosaleTriggers.get(triggerId);
    if (!trigger) return false;
    trigger.active = active;
    this.emit("autosale_updated", { trigger });
    return true;
  }

  /**
   * Process all autosale triggers - called periodically
   */
  private processAutosales(): void {
    const now = GameTimer.getInstance().getGameTime();
    const state = GameState.getInstance();
    
    for (const trigger of this.autosaleTriggers.values()) {
      if (!trigger.active) continue;
      
      // Check cooldown
      if (now - trigger.lastAttemptAt < trigger.cooldownMs) continue;
      
      // Check daily limit
      const remainingLimit = this.getRemainingDailyLimit();
      if (remainingLimit <= 0) continue;
      
      // Find sellable products matching tier restrictions
      const sellableProducts = this.findAutosaleProducts(trigger);
      if (sellableProducts.length === 0) continue;
      
      // Pick a random product to sell
      const product = sellableProducts[Math.floor(Math.random() * sellableProducts.length)];
      
      // Determine quantity (capped by daily limit and trigger max)
      const maxQty = Math.min(trigger.maxGramsPerSale, remainingLimit, product.quantity);
      if (maxQty <= 0) continue;
      
      // Roll for success
      trigger.lastAttemptAt = now;
      const roll = Math.random();
      
      if (roll <= trigger.successRate) {
        // Success! Sell the product
        const quantity = Math.floor(Math.random() * maxQty) + 1; // 1 to maxQty
        const pricePerGram = this.config.basePricePerItem * trigger.priceMultiplier;
        const grossReward = Math.floor(quantity * pricePerGram);
        
        // Apply commission - NPC takes their cut
        const commissionAmount = Math.floor(grossReward * trigger.commission);
        const playerReward = grossReward - commissionAmount;
        
        const xp = Math.floor(quantity * this.config.xpPerItem * 0.5); // Half XP for autosales
        
        // Remove items and give rewards (after commission)
        state.removeItem(product.itemId, quantity);
        state.addMoney(playerReward);
        state.addXP(xp);
        
        // Record against daily limit
        this.recordSale(quantity);
        
        // Update stats (track gross for stats, player gets net)
        state.incrementStat("ordersCompleted");
        state.incrementStat("moneyEarned", playerReward);
        
        this.emit("autosale_success", {
          triggerId: trigger.id,
          sourceName: trigger.sourceName,
          itemId: product.itemId,
          quantity,
          grossReward,
          commission: commissionAmount,
          reward: playerReward,
          xp,
        });
        
        console.log(`[Autosale] ${trigger.sourceName} sold ${quantity}g for $${grossReward} (commission: $${commissionAmount}, player gets: $${playerReward})`);
      } else {
        // Failed attempt
        this.emit("autosale_failed", {
          triggerId: trigger.id,
          sourceName: trigger.sourceName,
          reason: "probability_miss",
        });
      }
    }
  }

  /**
   * Find products that can be sold by an autosale trigger
   */
  private findAutosaleProducts(trigger: AutosaleTrigger): Array<{ itemId: string; quantity: number; tier: number }> {
    const state = GameState.getInstance();
    const inventory = state.getInventory();
    const products: Array<{ itemId: string; quantity: number; tier: number }> = [];
    
    for (const item of inventory.items) {
      // Only harvest items
      if (item.type !== "harvest" || !item.id.startsWith("harvest_")) continue;
      if (item.quantity <= 0) continue;
      
      // Get strain tier from metadata or estimate from item ID
      const tier = (item.metadata?.tier as number) ?? this.estimateStrainTier(item.id);
      
      // Check tier restrictions
      if (trigger.allowedTiers && trigger.allowedTiers.length > 0) {
        if (!trigger.allowedTiers.includes(tier)) continue;
      }
      
      products.push({
        itemId: item.id,
        quantity: item.quantity,
        tier,
      });
    }
    
    return products;
  }

  /**
   * Estimate strain tier from item ID (fallback when metadata not available)
   */
  private estimateStrainTier(itemId: string): number {
    // Default tier mapping based on known strains
    // Tier 1: Basic strains (afghan_kush, durban_poison, thai)
    // Tier 2: OG Kush, Skunk #1
    // Tier 3: GSC, Gelato
    // Tier 4: Lemon Cherry Gelato, Blue Lobster
    // Tier 5: Master Kush
    const tierMap: Record<string, number> = {
      "harvest_genetics_afghan_kush": 1,
      "harvest_genetics_durban_poison": 1,
      "harvest_genetics_thai": 1,
      "harvest_genetics_og_kush": 2,
      "harvest_genetics_skunk_1": 2,
      "harvest_genetics_girl_scout_cookies": 3,
      "harvest_genetics_gelato": 3,
      "harvest_genetics_lemon_cherry_gelato": 4,
      "harvest_genetics_blue_lobster": 4,
      "harvest_genetics_master_kush": 5,
    };
    return tierMap[itemId] ?? 1;
  }

  // ==================== Order Generation ====================

  private tryGenerateOrder(): void {
    const timer = GameTimer.getInstance();
    const now = timer.getGameTime();
    
    // Orders only appear during daytime (6 AM - 8 PM)
    if (!timer.isDaytime()) return;
    
    // Check daily limit - don't generate if we've hit the limit
    if (this.getRemainingDailyLimit() <= 0) return;
    
    // Check if we can generate
    if (this.orders.size >= this.config.maxOrders) return;
    
    // Don't generate orders until player has some stock to sell
    if (!this.playerHasAnyStock()) return;
    
    // Check interval with variance
    const variance = 1 + (Math.random() * 2 - 1) * this.config.intervalVariance;
    const interval = this.config.orderInterval * variance;
    
    if (now - this.lastOrderTime < interval) return;

    // Get available customers
    const customers = this.getUnlockedCustomers();
    if (customers.length === 0) return;

    // Pick random customer
    const customer = customers[Math.floor(Math.random() * customers.length)];
    
    // Generate order (respecting daily limit and player level)
    const order = this.generateOrder(customer);
    if (order) {
      this.orders.set(order.id, order);
      this.lastOrderTime = now;
      this.emit("order_created", { order });
      console.log(`New order from ${customer.name}: ${JSON.stringify(order.items)}`);
    }
  }
  
  /**
   * Check if player has any harvest items in stock
   */
  private playerHasAnyStock(): boolean {
    const inventory = GameState.getInstance().getInventory();
    return inventory.items.some(item => 
      item.type === "harvest" && item.quantity > 0
    );
  }

  /**
   * Filter requestable items to only include strains the player has unlocked
   * Items are harvest IDs like "harvest_genetics_afghan_kush"
   */
  private filterByPlayerLevel(harvestIds: string[]): string[] {
    const playerLevel = GameState.getInstance().getPlayer().level;
    const plantSystem = PlantSystem.getInstance();
    
    return harvestIds.filter(harvestId => {
      const strain = plantSystem.getStrainByHarvestId(harvestId);
      if (!strain) return true; // If strain not found, allow it (fallback)
      return strain.unlockLevel <= playerLevel;
    });
  }

  private generateOrder(customer: CustomerTemplate): Order | null {
    if (customer.requestableItems.length === 0) return null;

    const now = GameTimer.getInstance().getGameTime();
    const id = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check remaining daily limit
    const remainingLimit = this.getRemainingDailyLimit();
    if (remainingLimit <= 0) return null;

    // Filter requestable items to only include strains the player has unlocked
    const unlockedItems = this.filterByPlayerLevel(customer.requestableItems);
    if (unlockedItems.length === 0) return null;

    // Pick random items
    const items: Record<string, number> = {};
    const numItems = 1; // Single item type per order for simplicity
    
    for (let i = 0; i < numItems; i++) {
      const itemId = unlockedItems[
        Math.floor(Math.random() * unlockedItems.length)
      ];
      const [minQty, maxQty] = customer.quantityRange;
      // Cap quantity to remaining daily limit
      const cappedMax = Math.min(maxQty, remainingLimit);
      if (cappedMax < minQty) return null; // Can't generate order within limits
      const quantity = minQty + Math.floor(Math.random() * (cappedMax - minQty + 1));
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

    // Consume items and track total grams sold
    let totalGramsSold = 0;
    for (const [itemId, quantity] of Object.entries(order.items)) {
      state.removeItem(itemId, quantity);
      totalGramsSold += quantity;
    }
    
    // Record sale against daily limit
    this.recordSale(totalGramsSold);

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
    // Legacy callback system
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
    // Global EventBus
    EventBus.emit(`order:${event}`, data as object);
  }

  // ==================== Serialization ====================

  public getState(): { 
    orders: Order[]; 
    dailySoldGrams: number; 
    lastResetDay: number;
    autosaleTriggers: AutosaleTrigger[];
  } {
    return {
      orders: Array.from(this.orders.values()),
      dailySoldGrams: this.dailySoldGrams,
      lastResetDay: this.lastResetDay,
      autosaleTriggers: Array.from(this.autosaleTriggers.values()),
    };
  }

  public loadState(state: { 
    orders?: Order[]; 
    dailySoldGrams?: number; 
    lastResetDay?: number;
    autosaleTriggers?: AutosaleTrigger[];
  } | Order[]): void {
    this.orders.clear();
    this.autosaleTriggers.clear();
    
    // Handle both old format (Order[]) and new format (object with orders)
    if (Array.isArray(state)) {
      // Legacy format
      for (const order of state) {
        this.orders.set(order.id, order);
      }
      this.dailySoldGrams = 0;
      this.lastResetDay = 0;
    } else {
      // New format
      if (state.orders) {
        for (const order of state.orders) {
          this.orders.set(order.id, order);
        }
      }
      this.dailySoldGrams = state.dailySoldGrams ?? 0;
      this.lastResetDay = state.lastResetDay ?? 0;
      
      // Load autosale triggers
      if (state.autosaleTriggers) {
        for (const trigger of state.autosaleTriggers) {
          this.autosaleTriggers.set(trigger.id, trigger);
        }
      }
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.orders.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    GameTimer.getInstance().cancelTask(this.generateTaskId);
    GameTimer.getInstance().cancelTask(this.autosaleTaskId);
    this.clear();
    this.autosaleTriggers.clear();
    this.eventListeners = [];
  }
}
