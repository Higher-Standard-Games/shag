/**
 * CuringSystem - Manages curing barrels and the curing process
 * 
 * Flow:
 * 1. Player harvests plant -> gets fresh (uncured) product
 * 2. Fresh product goes to storage (decays over time if not cured)
 * 3. Player places fresh product in curing barrel
 * 4. After curing time, product becomes cured (sellable)
 */

import { EventBus } from "../engine/core/EventBus";
import { GameState } from "./GameState";
import { GameTimer } from "./GameTimer";

export interface CuringBarrel {
  id: string;
  name: string;
  capacity: number; // Max grams that can be cured at once
  speedMultiplier: number; // 1.0 = normal, 0.5 = 2x faster
  cost: number;
  unlockLevel: number;
  // Durability settings
  minUses: number; // Minimum uses before breakage chance starts
  maxUses: number; // Maximum uses (100% break chance)
  // Burping requirements
  burpsRequired: number; // Number of burps needed during curing (0 = none)
  burpOnlyForTier?: number; // Only require burps for strains at or above this tier (optional)
  // Quality bonus
  qualityBonus: number; // Percentage bonus to quality (e.g., 5 = +5%)
  // Visual
  icon: string;
}

export interface CuringSlot {
  id: string;
  barrelId: string;
  strainId: string;
  freshItemId: string;
  curedItemId: string;
  amount: number; // Grams being cured
  startedAt: number; // Timestamp when curing started
  curingTime: number; // Total time needed (ms)
  quality: number; // Quality percentage (affects value)
  // Burping tracking
  burpsRequired: number; // Total burps needed
  burpsCompleted: number; // Burps done so far
  nextBurpAt: number; // Timestamp when next burp is due (0 if none needed)
  burpMissed: boolean; // True if a burp was missed (reduces quality)
}

export interface StoredFreshItem {
  id: string;
  strainId: string;
  itemId: string;
  amount: number; // Grams
  harvestedAt: number; // Timestamp
  quality: number; // Quality percentage
  valuePerGram: number; // Base value
  decayTime: number; // Time until spoiled (ms from harvest)
}

export interface OwnedBarrelData {
  templateId: string;
  usesCount: number; // How many times this barrel has been used
  condition: number; // 0-100, visual wear indicator
  position?: { x: number; y: number; z: number };
}

type CuringEventCallback = (event: string, data: unknown) => void;

const DEFAULT_DECAY_TIME = 5 * 60 * 1000; // 5 minutes for testing (normally 24 hours)
const DECAY_CHECK_INTERVAL = 10 * 1000; // Check every 10 seconds
const BURP_WINDOW = 30 * 1000; // 30 seconds to respond to burp prompt

export class CuringSystem {
  private static instance: CuringSystem;
  
  private barrelTemplates: Map<string, CuringBarrel> = new Map();
  private ownedBarrels: Map<string, OwnedBarrelData> = new Map();
  private curingSlots: Map<string, CuringSlot> = new Map();
  private freshStorage: Map<string, StoredFreshItem> = new Map();
  private eventListeners: CuringEventCallback[] = [];
  private updateTaskId = "curing_system_update";

  private constructor() {}

  public static getInstance(): CuringSystem {
    if (!CuringSystem.instance) {
      CuringSystem.instance = new CuringSystem();
    }
    return CuringSystem.instance;
  }

  // ==================== Initialization ====================

  public init(): void {
    this.startUpdateLoop();
  }

  private startUpdateLoop(): void {
    GameTimer.getInstance().scheduleTask(this.updateTaskId, DECAY_CHECK_INTERVAL, () => {
      this.update();
    });
  }

  // ==================== Barrel Templates ====================

  public registerBarrels(barrels: CuringBarrel[]): void {
    for (const barrel of barrels) {
      this.barrelTemplates.set(barrel.id, barrel);
    }
    console.log(`CuringSystem: Registered ${barrels.length} barrel types`);
  }

  public getBarrelTemplate(id: string): CuringBarrel | undefined {
    return this.barrelTemplates.get(id);
  }

  public getAvailableBarrels(): CuringBarrel[] {
    const level = GameState.getInstance().getPlayer().level;
    return Array.from(this.barrelTemplates.values())
      .filter(b => b.unlockLevel <= level);
  }

  // ==================== Barrel Ownership ====================

  public purchaseBarrel(templateId: string): string | null {
    const template = this.barrelTemplates.get(templateId);
    if (!template) {
      console.warn(`Unknown barrel type: ${templateId}`);
      return null;
    }

    const state = GameState.getInstance();
    if (!state.canAfford(template.cost)) {
      console.warn(`Cannot afford barrel: $${template.cost}`);
      this.emit("purchase_failed", { reason: "no_money", templateId });
      return null;
    }

    if (state.getPlayer().level < template.unlockLevel) {
      console.warn(`Level ${template.unlockLevel} required for ${template.name}`);
      this.emit("purchase_failed", { reason: "level_required", templateId });
      return null;
    }

    state.spendMoney(template.cost);

    const barrelId = `barrel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.ownedBarrels.set(barrelId, { 
      templateId, 
      usesCount: 0, 
      condition: 100 
    });

    console.log(`Purchased ${template.name} (${barrelId})`);
    this.emit("barrel_purchased", { barrelId, template });

    return barrelId;
  }

  /**
   * Add a barrel to owned barrels (used by ShopSystem when purchasing)
   */
  public addOwnedBarrel(barrelId: string, templateId: string): void {
    const template = this.barrelTemplates.get(templateId);
    if (!template) {
      console.warn(`Unknown barrel template: ${templateId}`);
      return;
    }
    
    this.ownedBarrels.set(barrelId, { 
      templateId, 
      usesCount: 0, 
      condition: 100 
    });
    console.log(`Added ${template.name} (${barrelId}) to owned barrels`);
    this.emit("barrel_purchased", { barrelId, template });
  }

  public getOwnedBarrels(): Array<{ id: string; template: CuringBarrel; slot?: CuringSlot; data: OwnedBarrelData }> {
    const result: Array<{ id: string; template: CuringBarrel; slot?: CuringSlot; data: OwnedBarrelData }> = [];
    
    for (const [id, data] of this.ownedBarrels) {
      const template = this.barrelTemplates.get(data.templateId);
      if (template) {
        const slot = Array.from(this.curingSlots.values()).find(s => s.barrelId === id);
        result.push({ id, template, slot, data });
      }
    }
    
    return result;
  }

  // ==================== Fresh Storage ====================

  /**
   * Add fresh (uncured) harvest to storage
   * Called after harvesting a plant
   */
  public addFreshHarvest(
    strainId: string,
    freshItemId: string,
    _curedItemId: string, // Stored for reference when curing completes
    amount: number,
    quality: number,
    valuePerGram: number,
    decayTime: number = DEFAULT_DECAY_TIME
  ): string {
    const id = `fresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const item: StoredFreshItem = {
      id,
      strainId,
      itemId: freshItemId,
      amount,
      harvestedAt: GameTimer.getInstance().getGameTime(),
      quality,
      valuePerGram,
      decayTime,
    };

    this.freshStorage.set(id, item);
    
    console.log(`Added ${amount}g fresh ${strainId} to storage (quality: ${quality}%)`);
    this.emit("fresh_added", { item });

    return id;
  }

  public getFreshStorage(): StoredFreshItem[] {
    return Array.from(this.freshStorage.values());
  }

  public getFreshItem(id: string): StoredFreshItem | undefined {
    return this.freshStorage.get(id);
  }

  /**
   * Split a fresh item into two parts (for when harvest exceeds barrel capacity)
   * @param id The fresh item to split
   * @param amount Amount to keep in the original item (rest goes to new item)
   * @returns The new item ID, or null if split failed
   */
  public splitFreshItem(id: string, amount: number): string | null {
    const item = this.freshStorage.get(id);
    if (!item) return null;
    
    if (amount >= item.amount || amount <= 0) return null;
    
    const remainingAmount = item.amount - amount;
    
    // Update original item to have the split amount
    item.amount = amount;
    
    // Create new item with remaining amount
    const newId = `fresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newItem: StoredFreshItem = {
      ...item,
      id: newId,
      amount: remainingAmount,
    };
    
    this.freshStorage.set(newId, newItem);
    
    console.log(`Split fresh item ${id}: ${amount}g + ${remainingAmount}g (new: ${newId})`);
    return newId;
  }

  /**
   * Get decay status of a fresh item
   */
  public getDecayStatus(id: string): { 
    timeRemaining: number; 
    percentRemaining: number; 
    isSpoiled: boolean 
  } | null {
    const item = this.freshStorage.get(id);
    if (!item) return null;

    const currentTime = GameTimer.getInstance().getGameTime();
    const elapsed = currentTime - item.harvestedAt;
    const timeRemaining = Math.max(0, item.decayTime - elapsed);
    const percentRemaining = (timeRemaining / item.decayTime) * 100;

    return {
      timeRemaining,
      percentRemaining,
      isSpoiled: timeRemaining <= 0,
    };
  }

  // ==================== Curing Process ====================

  /**
   * Start curing fresh product in a barrel
   */
  public startCuring(freshItemId: string, barrelId: string, curingTime: number): boolean {
    const freshItem = this.freshStorage.get(freshItemId);
    if (!freshItem) {
      console.warn(`Fresh item not found: ${freshItemId}`);
      return false;
    }

    const barrelData = this.ownedBarrels.get(barrelId);
    if (!barrelData) {
      console.warn(`Barrel not found: ${barrelId}`);
      return false;
    }

    const template = this.barrelTemplates.get(barrelData.templateId);
    if (!template) return false;

    // Check if barrel is already in use
    const existingSlot = Array.from(this.curingSlots.values()).find(s => s.barrelId === barrelId);
    if (existingSlot) {
      console.warn(`Barrel ${barrelId} is already in use`);
      this.emit("curing_failed", { reason: "barrel_in_use", barrelId });
      return false;
    }

    // Check capacity
    if (freshItem.amount > template.capacity) {
      console.warn(`Amount ${freshItem.amount}g exceeds barrel capacity ${template.capacity}g`);
      this.emit("curing_failed", { reason: "over_capacity", barrelId, amount: freshItem.amount, capacity: template.capacity });
      return false;
    }

    // Get cured item ID - use harvest_ prefix to match order system
    // Strip "strain_" prefix if present to get base strain name
    const baseStrainId = freshItem.strainId.replace(/^strain_/, "");
    const curedItemId = `harvest_${baseStrainId}`;

    // Create curing slot
    const slotId = `curing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const effectiveCuringTime = curingTime * template.speedMultiplier;
    const currentTime = GameTimer.getInstance().getGameTime();
    
    // Determine burping requirements
    // TODO: Check strain tier for burpOnlyForTier logic
    const burpsRequired = template.burpsRequired;
    const burpInterval = burpsRequired > 0 ? effectiveCuringTime / (burpsRequired + 1) : 0;
    const nextBurpAt = burpsRequired > 0 ? currentTime + burpInterval : 0;

    const slot: CuringSlot = {
      id: slotId,
      barrelId,
      strainId: freshItem.strainId,
      freshItemId: freshItem.itemId,
      curedItemId,
      amount: freshItem.amount,
      startedAt: currentTime,
      curingTime: effectiveCuringTime,
      quality: freshItem.quality,
      // Burping
      burpsRequired,
      burpsCompleted: 0,
      nextBurpAt,
      burpMissed: false,
    };

    this.curingSlots.set(slotId, slot);
    
    // Increment barrel use count
    barrelData.usesCount++;
    barrelData.condition = Math.max(0, 100 - (barrelData.usesCount / template.maxUses) * 100);
    
    // Remove from fresh storage
    this.freshStorage.delete(freshItemId);

    console.log(`Started curing ${freshItem.amount}g ${freshItem.strainId} in ${template.name}`);
    this.emit("curing_started", { slot, barrel: template });

    return true;
  }

  /**
   * Get curing progress for a slot
   */
  public getCuringProgress(slotId: string): {
    progress: number;
    timeRemaining: number;
    isComplete: boolean;
    needsBurp: boolean;
    burpsRemaining: number;
  } | null {
    const slot = this.curingSlots.get(slotId);
    if (!slot) return null;

    const currentTime = GameTimer.getInstance().getGameTime();
    const elapsed = currentTime - slot.startedAt;
    const progress = Math.min(100, (elapsed / slot.curingTime) * 100);
    const timeRemaining = Math.max(0, slot.curingTime - elapsed);
    const needsBurp = slot.nextBurpAt > 0 && currentTime >= slot.nextBurpAt && slot.burpsCompleted < slot.burpsRequired;
    const burpsRemaining = slot.burpsRequired - slot.burpsCompleted;

    return {
      progress,
      timeRemaining,
      isComplete: progress >= 100,
      needsBurp,
      burpsRemaining,
    };
  }

  /**
   * Perform a burp on a curing slot
   */
  public burpBarrel(slotId: string): boolean {
    const slot = this.curingSlots.get(slotId);
    if (!slot) return false;

    const currentTime = GameTimer.getInstance().getGameTime();
    
    // Check if burp is needed
    if (slot.nextBurpAt === 0 || slot.burpsCompleted >= slot.burpsRequired) {
      console.log("No burp needed");
      return false;
    }

    // Check if we're within the burp window
    if (currentTime < slot.nextBurpAt) {
      console.log("Too early to burp");
      return false;
    }

    // Burp successful
    slot.burpsCompleted++;
    
    // Calculate next burp time
    if (slot.burpsCompleted < slot.burpsRequired) {
      const burpInterval = slot.curingTime / (slot.burpsRequired + 1);
      slot.nextBurpAt = slot.startedAt + (burpInterval * (slot.burpsCompleted + 1));
    } else {
      slot.nextBurpAt = 0; // No more burps needed
    }

    console.log(`Burp ${slot.burpsCompleted}/${slot.burpsRequired} completed`);
    this.emit("burp_completed", { slotId, burpsCompleted: slot.burpsCompleted, burpsRequired: slot.burpsRequired });
    
    return true;
  }

  /**
   * Check if a barrel should break based on usage
   * Returns true if barrel breaks
   */
  public checkBarrelBreakage(barrelId: string): boolean {
    const barrelData = this.ownedBarrels.get(barrelId);
    if (!barrelData) return false;

    const template = this.barrelTemplates.get(barrelData.templateId);
    if (!template) return false;

    // No breakage chance until minimum uses reached
    if (barrelData.usesCount < template.minUses) {
      return false;
    }

    // Calculate breakage chance: 0% at minUses, 100% at maxUses
    const usesInRange = barrelData.usesCount - template.minUses;
    const rangeSize = template.maxUses - template.minUses;
    const breakChance = Math.min(1, usesInRange / rangeSize);

    // Roll for breakage
    const roll = Math.random();
    if (roll < breakChance) {
      // Barrel breaks!
      this.ownedBarrels.delete(barrelId);
      console.log(`${template.name} (${barrelId}) has broken after ${barrelData.usesCount} uses!`);
      this.emit("barrel_broken", { barrelId, template, usesCount: barrelData.usesCount });
      return true;
    }

    return false;
  }

  /**
   * Get barrel condition info
   */
  public getBarrelCondition(barrelId: string): { 
    usesCount: number; 
    condition: number; 
    breakChance: number;
    status: "new" | "good" | "worn" | "critical";
  } | null {
    const barrelData = this.ownedBarrels.get(barrelId);
    if (!barrelData) return null;

    const template = this.barrelTemplates.get(barrelData.templateId);
    if (!template) return null;

    let breakChance = 0;
    if (barrelData.usesCount >= template.minUses) {
      const usesInRange = barrelData.usesCount - template.minUses;
      const rangeSize = template.maxUses - template.minUses;
      breakChance = Math.min(100, (usesInRange / rangeSize) * 100);
    }

    let status: "new" | "good" | "worn" | "critical" = "new";
    if (barrelData.condition < 25) status = "critical";
    else if (barrelData.condition < 50) status = "worn";
    else if (barrelData.condition < 90) status = "good";

    return {
      usesCount: barrelData.usesCount,
      condition: barrelData.condition,
      breakChance,
      status,
    };
  }

  /**
   * Collect cured product from a barrel
   */
  public collectCured(slotId: string): { 
    success: boolean; 
    amount?: number; 
    itemId?: string;
    value?: number;
    barrelBroke?: boolean;
  } {
    const slot = this.curingSlots.get(slotId);
    if (!slot) {
      return { success: false };
    }

    const progress = this.getCuringProgress(slotId);
    if (!progress || !progress.isComplete) {
      console.warn(`Curing not complete for ${slotId}`);
      return { success: false };
    }

    // Get barrel template for quality bonus
    const barrelData = this.ownedBarrels.get(slot.barrelId);
    const template = barrelData ? this.barrelTemplates.get(barrelData.templateId) : null;
    const qualityBonus = template?.qualityBonus ?? 0;
    
    // Apply quality bonus and missed burp penalty
    let finalQuality = Math.min(100, slot.quality + qualityBonus);
    if (slot.burpMissed) {
      finalQuality = Math.max(0, finalQuality - 15); // -15% quality for missed burp
    }

    // Calculate value
    const baseValue = 10; // Default value per gram
    const qualityMultiplier = finalQuality / 100;
    const totalValue = Math.floor(slot.amount * baseValue * qualityMultiplier);

    // Add cured product to inventory with metadata for selling
    const state = GameState.getInstance();
    state.addItem(slot.curedItemId, "harvest", slot.amount, {
      strainId: slot.strainId,
      quality: finalQuality,
      valuePerGram: baseValue,
      cured: true,
    });

    // Remove curing slot
    this.curingSlots.delete(slotId);

    // Check for barrel breakage
    const barrelBroke = this.checkBarrelBreakage(slot.barrelId);

    // Award XP for curing (1 XP per 10g cured + quality bonus)
    const curingXp = Math.max(1, Math.floor(slot.amount / 10) + Math.floor(finalQuality / 25));
    state.addXP(curingXp, "curing");

    console.log(`Collected ${slot.amount}g cured ${slot.strainId} (quality: ${finalQuality}%, value: $${totalValue}, +${curingXp} XP)${barrelBroke ? " - BARREL BROKE!" : ""}`);
    this.emit("curing_complete", { 
      slot, 
      amount: slot.amount, 
      itemId: slot.curedItemId,
      value: totalValue,
      quality: finalQuality,
      xp: curingXp,
      barrelBroke,
    });

    return { 
      success: true, 
      amount: slot.amount, 
      itemId: slot.curedItemId,
      value: totalValue,
      barrelBroke,
    };
  }

  // ==================== Update Loop ====================

  private update(): void {
    const currentTime = GameTimer.getInstance().getGameTime();

    // Check for spoiled fresh items
    for (const [id, item] of this.freshStorage) {
      const elapsed = currentTime - item.harvestedAt;
      if (elapsed >= item.decayTime) {
        // Item has spoiled!
        this.freshStorage.delete(id);
        console.log(`Fresh ${item.strainId} (${item.amount}g) has spoiled!`);
        this.emit("fresh_spoiled", { item });
      } else if (elapsed >= item.decayTime * 0.75) {
        // Warning at 75% decay
        const wasWarned = GameState.getInstance().getCustomData<boolean>(`decay_warned_${id}`);
        if (!wasWarned) {
          GameState.getInstance().setCustomData(`decay_warned_${id}`, true);
          this.emit("fresh_decay_warning", { item, timeRemaining: item.decayTime - elapsed });
        }
      }
    }

    // Check for completed curing and missed burps
    for (const [id, slot] of this.curingSlots) {
      const elapsed = currentTime - slot.startedAt;
      
      // Check for missed burps
      if (slot.nextBurpAt > 0 && !slot.burpMissed && slot.burpsCompleted < slot.burpsRequired) {
        const burpDeadline = slot.nextBurpAt + BURP_WINDOW;
        if (currentTime > burpDeadline) {
          // Burp was missed!
          slot.burpMissed = true;
          console.log(`Burp missed for ${slot.strainId}! Quality will be reduced.`);
          this.emit("burp_missed", { slotId: id, slot });
        } else if (currentTime >= slot.nextBurpAt) {
          // Burp is due - notify
          const wasNotified = GameState.getInstance().getCustomData<boolean>(`burp_due_${id}_${slot.burpsCompleted}`);
          if (!wasNotified) {
            GameState.getInstance().setCustomData(`burp_due_${id}_${slot.burpsCompleted}`, true);
            this.emit("burp_needed", { slotId: id, slot, timeRemaining: burpDeadline - currentTime });
          }
        }
      }
      
      if (elapsed >= slot.curingTime) {
        // Curing complete - notify but don't auto-collect
        const wasNotified = GameState.getInstance().getCustomData<boolean>(`curing_ready_${id}`);
        if (!wasNotified) {
          GameState.getInstance().setCustomData(`curing_ready_${id}`, true);
          this.emit("curing_ready", { slot });
        }
      }
    }
  }

  // ==================== Events ====================

  public on(callback: CuringEventCallback): void {
    this.eventListeners.push(callback);
  }

  public off(callback: CuringEventCallback): void {
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
    
    // Global EventBus - allows any system to listen to curing events
    EventBus.emit(`curing:${event}`, data as object);
  }

  // ==================== State Management ====================

  public getState(): {
    ownedBarrels: Array<{ id: string; templateId: string; usesCount: number; condition: number }>;
    curingSlots: CuringSlot[];
    freshStorage: StoredFreshItem[];
  } {
    return {
      ownedBarrels: Array.from(this.ownedBarrels.entries()).map(([id, data]) => ({ 
        id, 
        templateId: data.templateId,
        usesCount: data.usesCount,
        condition: data.condition,
      })),
      curingSlots: Array.from(this.curingSlots.values()),
      freshStorage: Array.from(this.freshStorage.values()),
    };
  }

  public loadState(state: {
    ownedBarrels?: Array<{ id: string; templateId: string; usesCount?: number; condition?: number }>;
    curingSlots?: CuringSlot[];
    freshStorage?: StoredFreshItem[];
  }): void {
    if (state.ownedBarrels) {
      this.ownedBarrels.clear();
      for (const barrel of state.ownedBarrels) {
        this.ownedBarrels.set(barrel.id, { 
          templateId: barrel.templateId,
          usesCount: barrel.usesCount ?? 0,
          condition: barrel.condition ?? 100,
        });
      }
    }
    if (state.curingSlots) {
      this.curingSlots.clear();
      for (const slot of state.curingSlots) {
        this.curingSlots.set(slot.id, slot);
      }
    }
    if (state.freshStorage) {
      this.freshStorage.clear();
      for (const item of state.freshStorage) {
        this.freshStorage.set(item.id, item);
      }
    }
  }

  public clear(): void {
    this.ownedBarrels.clear();
    this.curingSlots.clear();
    this.freshStorage.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    this.clear();
    this.eventListeners = [];
  }
}
