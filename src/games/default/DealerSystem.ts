/**
 * DealerSystem - Handles selling products to dealers/buyers
 * 
 * Features:
 * - Multiple dealer types with different price modifiers
 * - Reputation system affects prices
 * - Bulk selling bonuses
 * - Risk/heat system for large deals
 */

import { EventBus } from "../../engine/core/EventBus";
import { GameState } from "./GameState";
import { GameTimer } from "../../engine/core/GameTimer";

export interface Dealer {
  id: string;
  name: string;
  title: string;
  icon: string;
  /** Price multiplier (1.0 = base price, 1.2 = 20% more) */
  priceMultiplier: number;
  /** Preferred product categories (pays more for these) */
  preferredCategories: string[];
  /** Bonus for preferred categories */
  preferredBonus: number;
  /** Minimum reputation required to deal */
  minReputation: number;
  /** Maximum grams per transaction */
  maxQuantity: number;
  /** Cooldown between deals (ms) */
  dealCooldown: number;
  /** Risk level (affects heat gain) */
  riskLevel: "low" | "medium" | "high";
  /** Required player level */
  requiredLevel: number;
  /** Whether dealer is currently available */
  isAvailable: boolean;
  /** Location/area ID */
  areaId?: string;
}

export interface SellableProduct {
  itemId: string;
  name: string;
  category: string; // "fresh" | "cured" | "extract" | "edible"
  basePrice: number;
  quality: number; // 0-100
  quantity: number;
  strainId?: string;
}

export interface DealRecord {
  id: string;
  dealerId: string;
  products: Array<{ itemId: string; quantity: number; pricePerUnit: number }>;
  totalAmount: number;
  totalPrice: number;
  timestamp: number;
  reputation: number;
}

export interface DealerReputation {
  dealerId: string;
  level: number; // 0-100
  totalDeals: number;
  totalVolume: number; // Total grams sold
  totalEarnings: number;
  lastDeal: number;
}

type DealerEventCallback = (event: string, data: unknown) => void;

export class DealerSystem {
  private static instance: DealerSystem;

  private dealers: Map<string, Dealer> = new Map();
  private reputation: Map<string, DealerReputation> = new Map();
  private dealHistory: DealRecord[] = [];
  private lastDealTime: Map<string, number> = new Map();
  private eventListeners: DealerEventCallback[] = [];
  private heat: number = 0; // 0-100, affects risk of getting caught
  private heatDecayRate: number = 1; // Heat decay per minute

  private constructor() {}

  public static getInstance(): DealerSystem {
    if (!DealerSystem.instance) {
      DealerSystem.instance = new DealerSystem();
    }
    return DealerSystem.instance;
  }

  // ==================== Initialization ====================

  public init(): void {
    // Start heat decay loop
    GameTimer.getInstance().scheduleTask("dealer_heat_decay", 60000, () => {
      this.decayHeat();
    });
  }

  // ==================== Dealer Registration ====================

  public registerDealer(dealer: Dealer): void {
    this.dealers.set(dealer.id, dealer);
    
    // Initialize reputation if not exists
    if (!this.reputation.has(dealer.id)) {
      this.reputation.set(dealer.id, {
        dealerId: dealer.id,
        level: 0,
        totalDeals: 0,
        totalVolume: 0,
        totalEarnings: 0,
        lastDeal: 0,
      });
    }
  }

  public registerDealers(dealers: Dealer[]): void {
    for (const dealer of dealers) {
      this.registerDealer(dealer);
    }
    console.log(`DealerSystem: Registered ${dealers.length} dealers`);
  }

  public getDealer(id: string): Dealer | undefined {
    return this.dealers.get(id);
  }

  public getAvailableDealers(): Dealer[] {
    const state = GameState.getInstance();
    const level = state.getPlayer().level;
    const currentTime = GameTimer.getInstance().getGameTime();

    return Array.from(this.dealers.values()).filter(dealer => {
      if (!dealer.isAvailable) return false;
      if (dealer.requiredLevel > level) return false;
      
      const rep = this.reputation.get(dealer.id);
      if (rep && rep.level < dealer.minReputation) return false;

      // Check cooldown
      const lastDeal = this.lastDealTime.get(dealer.id) || 0;
      if (currentTime - lastDeal < dealer.dealCooldown) return false;

      return true;
    });
  }

  // ==================== Selling ====================

  /**
   * Get sellable products from player inventory
   */
  public getSellableProducts(): SellableProduct[] {
    const state = GameState.getInstance();
    const inventory = state.getInventory();
    const products: SellableProduct[] = [];

    for (const item of inventory.items) {
      // Check if item is sellable (harvest type items, or items with cured/fresh prefix)
      if (item.type === "harvest" || item.id.startsWith("cured_") || item.id.startsWith("fresh_") || item.id.startsWith("harvest_")) {
        // Determine category based on metadata or item ID
        const isCured = item.metadata?.cured === true || item.id.startsWith("cured_");
        const category = isCured ? "cured" : "fresh";
        const basePrice = (item.metadata?.valuePerGram as number) || this.getBasePrice(item.id);
        const quality = (item.metadata?.quality as number) || 75;
        
        // Get display name from strain if available
        const strainId = item.metadata?.strainId as string;
        const displayName = strainId 
          ? strainId.replace(/^(strain_|genetics_)/, "").replace(/_/g, " ")
          : item.id.replace(/^(harvest_|cured_|fresh_)/, "").replace(/_/g, " ");

        products.push({
          itemId: item.id,
          name: displayName,
          category,
          basePrice,
          quality,
          quantity: item.quantity,
          strainId,
        });
      }
    }

    return products;
  }

  /**
   * Calculate price for selling to a specific dealer
   */
  public calculatePrice(
    dealerId: string,
    itemId: string,
    quantity: number,
    quality: number = 75
  ): { 
    pricePerUnit: number; 
    totalPrice: number; 
    breakdown: {
      base: number;
      dealerBonus: number;
      qualityBonus: number;
      reputationBonus: number;
      bulkBonus: number;
      preferredBonus: number;
    };
  } | null {
    const dealer = this.dealers.get(dealerId);
    if (!dealer) return null;

    const basePrice = this.getBasePrice(itemId);
    const category = itemId.startsWith("cured_") ? "cured" : "fresh";

    // Dealer price multiplier
    const dealerBonus = basePrice * (dealer.priceMultiplier - 1);

    // Quality bonus (0-50% based on quality)
    const qualityMultiplier = quality / 100;
    const qualityBonus = basePrice * 0.5 * qualityMultiplier;

    // Reputation bonus (0-25% based on rep level)
    const rep = this.reputation.get(dealerId);
    const repLevel = rep?.level || 0;
    const reputationBonus = basePrice * 0.25 * (repLevel / 100);

    // Bulk bonus (5% for 50g+, 10% for 100g+, 15% for 250g+)
    let bulkMultiplier = 0;
    if (quantity >= 250) bulkMultiplier = 0.15;
    else if (quantity >= 100) bulkMultiplier = 0.10;
    else if (quantity >= 50) bulkMultiplier = 0.05;
    const bulkBonus = basePrice * bulkMultiplier;

    // Preferred category bonus
    const isPreferred = dealer.preferredCategories.includes(category);
    const preferredBonus = isPreferred ? basePrice * dealer.preferredBonus : 0;

    const pricePerUnit = Math.floor(
      basePrice + dealerBonus + qualityBonus + reputationBonus + bulkBonus + preferredBonus
    );
    const totalPrice = pricePerUnit * quantity;

    return {
      pricePerUnit,
      totalPrice,
      breakdown: {
        base: basePrice,
        dealerBonus: Math.floor(dealerBonus),
        qualityBonus: Math.floor(qualityBonus),
        reputationBonus: Math.floor(reputationBonus),
        bulkBonus: Math.floor(bulkBonus),
        preferredBonus: Math.floor(preferredBonus),
      },
    };
  }

  /**
   * Execute a sale to a dealer
   */
  public sell(
    dealerId: string,
    items: Array<{ itemId: string; quantity: number; quality?: number }>
  ): {
    success: boolean;
    totalEarnings?: number;
    xpGained?: number;
    reputationGained?: number;
    heatGained?: number;
    reason?: string;
  } {
    const dealer = this.dealers.get(dealerId);
    if (!dealer) {
      return { success: false, reason: "Dealer not found" };
    }

    // Check availability
    if (!this.getAvailableDealers().find(d => d.id === dealerId)) {
      return { success: false, reason: "Dealer not available" };
    }

    const state = GameState.getInstance();
    const inventory = state.getInventory();

    // Validate all items exist in inventory
    let totalQuantity = 0;
    for (const item of items) {
      const invItem = inventory.items.find(i => i.id === item.itemId);
      if (!invItem || invItem.quantity < item.quantity) {
        return { success: false, reason: `Not enough ${item.itemId}` };
      }
      totalQuantity += item.quantity;
    }

    // Check max quantity
    if (totalQuantity > dealer.maxQuantity) {
      return { success: false, reason: `Max ${dealer.maxQuantity}g per deal` };
    }

    // Calculate total price and process sale
    let totalEarnings = 0;
    const soldItems: Array<{ itemId: string; quantity: number; pricePerUnit: number }> = [];

    for (const item of items) {
      const quality = item.quality || 75;
      const priceInfo = this.calculatePrice(dealerId, item.itemId, item.quantity, quality);
      if (!priceInfo) continue;

      totalEarnings += priceInfo.totalPrice;
      soldItems.push({
        itemId: item.itemId,
        quantity: item.quantity,
        pricePerUnit: priceInfo.pricePerUnit,
      });

      // Remove from inventory
      state.removeItem(item.itemId, item.quantity);
    }

    // Add money
    state.addMoney(totalEarnings);

    // Calculate XP (1 XP per $10 earned)
    const xpGained = Math.floor(totalEarnings / 10);
    state.addXP(xpGained, "dealing");

    // Update reputation
    const reputationGained = this.calculateReputationGain(dealerId, totalQuantity, totalEarnings);
    this.addReputation(dealerId, reputationGained, totalQuantity, totalEarnings);

    // Add heat based on risk level
    const heatGained = this.calculateHeatGain(dealer, totalQuantity);
    this.addHeat(heatGained);

    // Record deal
    const currentTime = GameTimer.getInstance().getGameTime();
    this.lastDealTime.set(dealerId, currentTime);

    const dealRecord: DealRecord = {
      id: `deal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      dealerId,
      products: soldItems,
      totalAmount: totalQuantity,
      totalPrice: totalEarnings,
      timestamp: currentTime,
      reputation: reputationGained,
    };
    this.dealHistory.push(dealRecord);

    // Update stats
    state.incrementStat("totalSales");
    // Track money from deals in stats
    const currentDealsEarnings = (state.getStats().moneyFromDeals ?? 0) + totalEarnings;
    state.setStat("moneyFromDeals", currentDealsEarnings);

    // Emit events
    this.emit("sale_complete", {
      dealerId,
      dealer,
      items: soldItems,
      totalEarnings,
      xpGained,
      reputationGained,
      heatGained,
    });

    console.log(`Sold ${totalQuantity}g to ${dealer.name} for $${totalEarnings}`);

    return {
      success: true,
      totalEarnings,
      xpGained,
      reputationGained,
      heatGained,
    };
  }

  // ==================== Reputation ====================

  public getReputation(dealerId: string): DealerReputation | undefined {
    return this.reputation.get(dealerId);
  }

  private calculateReputationGain(_dealerId: string, quantity: number, earnings: number): number {
    // Base rep: 1 per 10g sold
    let rep = Math.floor(quantity / 10);
    
    // Bonus for larger deals
    if (quantity >= 100) rep += 5;
    if (quantity >= 250) rep += 10;

    // Bonus for high earnings
    if (earnings >= 1000) rep += 2;
    if (earnings >= 5000) rep += 5;

    return Math.min(rep, 10); // Cap at 10 per deal
  }

  private addReputation(dealerId: string, amount: number, volume: number, earnings: number): void {
    const rep = this.reputation.get(dealerId);
    if (!rep) return;

    rep.level = Math.min(100, rep.level + amount);
    rep.totalDeals++;
    rep.totalVolume += volume;
    rep.totalEarnings += earnings;
    rep.lastDeal = GameTimer.getInstance().getGameTime();

    this.emit("reputation_changed", { dealerId, newLevel: rep.level, change: amount });
  }

  // ==================== Heat System ====================

  public getHeat(): number {
    return this.heat;
  }

  public getHeatLevel(): "cool" | "warm" | "hot" | "dangerous" {
    if (this.heat < 25) return "cool";
    if (this.heat < 50) return "warm";
    if (this.heat < 75) return "hot";
    return "dangerous";
  }

  private calculateHeatGain(dealer: Dealer, quantity: number): number {
    const riskMultiplier = dealer.riskLevel === "low" ? 0.5 : dealer.riskLevel === "medium" ? 1 : 2;
    const quantityFactor = Math.floor(quantity / 50); // 1 heat per 50g
    return Math.floor((1 + quantityFactor) * riskMultiplier);
  }

  private addHeat(amount: number): void {
    const oldHeat = this.heat;
    this.heat = Math.min(100, this.heat + amount);
    
    if (this.heat !== oldHeat) {
      this.emit("heat_changed", { oldHeat, newHeat: this.heat, change: amount });
    }

    // Check for danger threshold
    if (oldHeat < 75 && this.heat >= 75) {
      this.emit("heat_dangerous", { heat: this.heat });
    }
  }

  private decayHeat(): void {
    if (this.heat > 0) {
      const oldHeat = this.heat;
      this.heat = Math.max(0, this.heat - this.heatDecayRate);
      
      if (this.heat !== oldHeat) {
        this.emit("heat_decayed", { oldHeat, newHeat: this.heat });
      }
    }
  }

  // ==================== Helpers ====================

  private getBasePrice(itemId: string): number {
    // Default prices by type
    if (itemId.startsWith("cured_")) return 15; // Cured sells for more
    if (itemId.startsWith("fresh_")) return 8;
    return 10;
  }

  // ==================== Events ====================

  public on(callback: DealerEventCallback): void {
    this.eventListeners.push(callback);
  }

  public off(callback: DealerEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    // Legacy callback system
    for (const listener of this.eventListeners) {
      listener(event, data);
    }
    
    // Global EventBus
    EventBus.emit(`dealer:${event}`, data as object);
  }

  // ==================== State Management ====================

  public getState(): {
    reputation: Array<DealerReputation>;
    dealHistory: DealRecord[];
    heat: number;
    lastDealTime: Array<{ dealerId: string; time: number }>;
  } {
    return {
      reputation: Array.from(this.reputation.values()),
      dealHistory: this.dealHistory.slice(-50), // Keep last 50 deals
      heat: this.heat,
      lastDealTime: Array.from(this.lastDealTime.entries()).map(([dealerId, time]) => ({ dealerId, time })),
    };
  }

  public loadState(state: {
    reputation?: Array<DealerReputation>;
    dealHistory?: DealRecord[];
    heat?: number;
    lastDealTime?: Array<{ dealerId: string; time: number }>;
  }): void {
    if (state.reputation) {
      for (const rep of state.reputation) {
        this.reputation.set(rep.dealerId, rep);
      }
    }
    if (state.dealHistory) {
      this.dealHistory = state.dealHistory;
    }
    if (state.heat !== undefined) {
      this.heat = state.heat;
    }
    if (state.lastDealTime) {
      for (const { dealerId, time } of state.lastDealTime) {
        this.lastDealTime.set(dealerId, time);
      }
    }
  }

  public clear(): void {
    this.reputation.clear();
    this.dealHistory = [];
    this.heat = 0;
    this.lastDealTime.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask("dealer_heat_decay");
    this.clear();
    this.eventListeners = [];
  }
}
