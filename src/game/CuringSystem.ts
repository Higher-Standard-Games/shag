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

type CuringEventCallback = (event: string, data: unknown) => void;

const DEFAULT_DECAY_TIME = 5 * 60 * 1000; // 5 minutes for testing (normally 24 hours)
const DECAY_CHECK_INTERVAL = 10 * 1000; // Check every 10 seconds

export class CuringSystem {
  private static instance: CuringSystem;
  
  private barrelTemplates: Map<string, CuringBarrel> = new Map();
  private ownedBarrels: Map<string, { templateId: string; position?: { x: number; y: number; z: number } }> = new Map();
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
    this.ownedBarrels.set(barrelId, { templateId });

    console.log(`Purchased ${template.name} (${barrelId})`);
    this.emit("barrel_purchased", { barrelId, template });

    return barrelId;
  }

  public getOwnedBarrels(): Array<{ id: string; template: CuringBarrel; slot?: CuringSlot }> {
    const result: Array<{ id: string; template: CuringBarrel; slot?: CuringSlot }> = [];
    
    for (const [id, data] of this.ownedBarrels) {
      const template = this.barrelTemplates.get(data.templateId);
      if (template) {
        const slot = Array.from(this.curingSlots.values()).find(s => s.barrelId === id);
        result.push({ id, template, slot });
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

    const slot: CuringSlot = {
      id: slotId,
      barrelId,
      strainId: freshItem.strainId,
      freshItemId: freshItem.itemId,
      curedItemId,
      amount: freshItem.amount,
      startedAt: GameTimer.getInstance().getGameTime(),
      curingTime: effectiveCuringTime,
      quality: freshItem.quality,
    };

    this.curingSlots.set(slotId, slot);
    
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
  } | null {
    const slot = this.curingSlots.get(slotId);
    if (!slot) return null;

    const currentTime = GameTimer.getInstance().getGameTime();
    const elapsed = currentTime - slot.startedAt;
    const progress = Math.min(100, (elapsed / slot.curingTime) * 100);
    const timeRemaining = Math.max(0, slot.curingTime - elapsed);

    return {
      progress,
      timeRemaining,
      isComplete: progress >= 100,
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

    // Add cured product to inventory
    const state = GameState.getInstance();
    state.addItem(slot.curedItemId, "harvest", slot.amount);

    // Calculate value
    const freshItem = this.freshStorage.get(slot.freshItemId);
    const baseValue = freshItem?.valuePerGram ?? 10;
    const qualityMultiplier = slot.quality / 100;
    const totalValue = Math.floor(slot.amount * baseValue * qualityMultiplier);

    // Remove curing slot
    this.curingSlots.delete(slotId);

    console.log(`Collected ${slot.amount}g cured ${slot.strainId} (value: $${totalValue})`);
    this.emit("curing_complete", { 
      slot, 
      amount: slot.amount, 
      itemId: slot.curedItemId,
      value: totalValue,
    });

    return { 
      success: true, 
      amount: slot.amount, 
      itemId: slot.curedItemId,
      value: totalValue,
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

    // Check for completed curing
    for (const [id, slot] of this.curingSlots) {
      const elapsed = currentTime - slot.startedAt;
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
    ownedBarrels: Array<{ id: string; templateId: string }>;
    curingSlots: CuringSlot[];
    freshStorage: StoredFreshItem[];
  } {
    return {
      ownedBarrels: Array.from(this.ownedBarrels.entries()).map(([id, data]) => ({ id, templateId: data.templateId })),
      curingSlots: Array.from(this.curingSlots.values()),
      freshStorage: Array.from(this.freshStorage.values()),
    };
  }

  public loadState(state: {
    ownedBarrels?: Array<{ id: string; templateId: string }>;
    curingSlots?: CuringSlot[];
    freshStorage?: StoredFreshItem[];
  }): void {
    if (state.ownedBarrels) {
      this.ownedBarrels.clear();
      for (const barrel of state.ownedBarrels) {
        this.ownedBarrels.set(barrel.id, { templateId: barrel.templateId });
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
