/**
 * WorldSystem - Open World with Connected Areas and Purchasable Lots
 * 
 * The world consists of:
 * - Areas: Large zones (maps) that connect to each other
 * - Lots: Purchasable properties within areas where you can build
 * - Portals: Transition points between areas
 * - Access Rules: Level, quest, or purchase requirements to enter areas
 */

import { GameState } from "./GameState";

// ==================== Types ====================

export interface AreaBonus {
  type: "growth_speed" | "water_efficiency" | "customer_rate" | "xp_multiplier" | "yield_bonus" | "price_bonus";
  value: number;
}

export interface Portal {
  id: string;
  targetArea: string;
  targetPortal: string; // Portal ID in target area to spawn at
  position: { x: number; y: number; z: number };
  size: { width: number; height: number };
  label?: string; // e.g., "To Downtown"
}

export interface AccessRequirement {
  type: "level" | "quest_complete" | "item" | "money" | "area_owned" | "custom";
  value: string | number; // Quest ID, item ID, level number, etc.
  consumeItem?: boolean; // If true, item is consumed on entry
}

export interface AreaTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  
  // Map file to load
  mapFile: string;
  
  // Area properties
  tier: "slums" | "suburbs" | "downtown" | "industrial" | "luxury" | "special";
  ambiance?: string; // Background music/atmosphere ID
  
  // Connections to other areas
  portals: Portal[];
  
  // Access restrictions (empty = always accessible)
  accessRequirements: AccessRequirement[];
  accessDeniedMessage?: string;
  
  // Global bonuses when operating in this area
  areaBonuses: AreaBonus[];
  
  // Lots available in this area
  lotIds: string[]; // References to LotTemplate IDs
}

export interface LotTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  
  // Which area this lot is in
  areaId: string;
  
  // Position within the area map (for visual marker)
  position: { x: number; y: number; z: number };
  
  // Purchase requirements
  price: number;
  requiredLevel: number;
  prerequisiteLot?: string; // Must own this lot first
  
  // Lot properties
  size: "small" | "medium" | "large" | "huge";
  maxBuildZones: number;
  maxPlantSlots: number;
  
  // Lot-specific bonuses (stack with area bonuses)
  bonuses: AreaBonus[];
  
  // The map file for this lot's interior/buildable space
  lotMapFile: string;
  
  // Visual
  tier: "basic" | "standard" | "premium" | "luxury";
}

export interface OwnedLot {
  id: string;
  purchasedAt: number;
  nickname?: string; // Player can rename their lots
  // Future: store placed objects, upgrades, etc.
}

type WorldEventType = 
  | "area_entered" 
  | "area_left" 
  | "lot_purchased" 
  | "lot_entered"
  | "lot_left"
  | "access_denied"
  | "portal_used";

type WorldCallback = (event: WorldEventType, data: any) => void;

// ==================== WorldSystem ====================

export class WorldSystem {
  private static instance: WorldSystem;
  
  private areas: Map<string, AreaTemplate> = new Map();
  private lots: Map<string, LotTemplate> = new Map();
  private listeners: WorldCallback[] = [];
  
  // Custom access checkers for "custom" requirement type
  private accessCheckers: Map<string, (value: string) => boolean> = new Map();
  
  private constructor() {}
  
  public static getInstance(): WorldSystem {
    if (!WorldSystem.instance) {
      WorldSystem.instance = new WorldSystem();
    }
    return WorldSystem.instance;
  }
  
  public static resetInstance(): void {
    WorldSystem.instance = null as any;
  }
  
  // ==================== Registration ====================
  
  public registerAreas(areas: AreaTemplate[]): void {
    for (const area of areas) {
      this.areas.set(area.id, area);
    }
    console.log(`WorldSystem: Registered ${areas.length} areas`);
  }
  
  public registerLots(lots: LotTemplate[]): void {
    for (const lot of lots) {
      this.lots.set(lot.id, lot);
    }
    console.log(`WorldSystem: Registered ${lots.length} lots`);
  }
  
  public registerAccessChecker(id: string, checker: (value: string) => boolean): void {
    this.accessCheckers.set(id, checker);
  }
  
  // ==================== Getters ====================
  
  public getArea(id: string): AreaTemplate | undefined {
    return this.areas.get(id);
  }
  
  public getLot(id: string): LotTemplate | undefined {
    return this.lots.get(id);
  }
  
  public getAllAreas(): AreaTemplate[] {
    return Array.from(this.areas.values());
  }
  
  public getAllLots(): LotTemplate[] {
    return Array.from(this.lots.values());
  }
  
  public getLotsInArea(areaId: string): LotTemplate[] {
    return this.getAllLots().filter(lot => lot.areaId === areaId);
  }
  
  // ==================== Current Location ====================
  
  public getCurrentAreaId(): string {
    const state = GameState.getInstance();
    return state.getCustomData<string>("currentArea") || "slums_street";
  }
  
  public getCurrentArea(): AreaTemplate | undefined {
    return this.areas.get(this.getCurrentAreaId());
  }
  
  public getCurrentLotId(): string | null {
    const state = GameState.getInstance();
    return state.getCustomData<string>("currentLot") || null;
  }
  
  public getCurrentLot(): LotTemplate | undefined {
    const lotId = this.getCurrentLotId();
    return lotId ? this.lots.get(lotId) : undefined;
  }
  
  public isInLot(): boolean {
    return this.getCurrentLotId() !== null;
  }
  
  // ==================== Area Access ====================
  
  public canAccessArea(areaId: string): { canAccess: boolean; reason?: string } {
    const area = this.areas.get(areaId);
    if (!area) {
      return { canAccess: false, reason: "Area not found" };
    }
    
    if (area.accessRequirements.length === 0) {
      return { canAccess: true };
    }
    
    const state = GameState.getInstance();
    
    for (const req of area.accessRequirements) {
      switch (req.type) {
        case "level":
          if (state.getPlayer().level < (req.value as number)) {
            return { canAccess: false, reason: `Requires level ${req.value}` };
          }
          break;
          
        case "quest_complete":
          // Check if quest is completed (would need QuestSystem integration)
          const completedQuests = state.getCustomData<string[]>("completedQuests") || [];
          if (!completedQuests.includes(req.value as string)) {
            return { canAccess: false, reason: `Requires completing quest: ${req.value}` };
          }
          break;
          
        case "item":
          if (!state.hasItem(req.value as string, 1)) {
            return { canAccess: false, reason: `Requires item: ${req.value}` };
          }
          break;
          
        case "money":
          if (!state.canAfford(req.value as number)) {
            return { canAccess: false, reason: `Requires $${req.value} entry fee` };
          }
          break;
          
        case "area_owned":
          // Must own at least one lot in specified area
          const ownedLots = this.getOwnedLots();
          const hasLotInArea = ownedLots.some(ol => {
            const lot = this.lots.get(ol.id);
            return lot?.areaId === req.value;
          });
          if (!hasLotInArea) {
            return { canAccess: false, reason: `Must own property in ${req.value}` };
          }
          break;
          
        case "custom":
          const checker = this.accessCheckers.get(req.value as string);
          if (checker && !checker(req.value as string)) {
            return { canAccess: false, reason: area.accessDeniedMessage || "Access denied" };
          }
          break;
      }
    }
    
    return { canAccess: true };
  }
  
  // ==================== Area Navigation ====================
  
  public enterArea(areaId: string, portalId?: string): boolean {
    const access = this.canAccessArea(areaId);
    if (!access.canAccess) {
      console.log(`Cannot enter area ${areaId}: ${access.reason}`);
      this.emit("access_denied", { areaId, reason: access.reason });
      return false;
    }
    
    const area = this.areas.get(areaId)!;
    const state = GameState.getInstance();
    const previousArea = this.getCurrentAreaId();
    
    // Leave current lot if in one
    if (this.isInLot()) {
      this.exitLot();
    }
    
    // Handle entry fee if required
    const moneyReq = area.accessRequirements.find(r => r.type === "money");
    if (moneyReq) {
      state.spendMoney(moneyReq.value as number);
    }
    
    // Consume item if required
    const itemReq = area.accessRequirements.find(r => r.type === "item" && r.consumeItem);
    if (itemReq) {
      state.removeItem(itemReq.value as string, 1);
    }
    
    // Update current area
    state.setCustomData("currentArea", areaId);
    
    // Find spawn position
    let spawnPosition = { x: 0, y: 0, z: 0 };
    if (portalId) {
      const portal = area.portals.find(p => p.id === portalId);
      if (portal) {
        spawnPosition = portal.position;
      }
    }
    
    this.emit("area_left", { areaId: previousArea });
    this.emit("area_entered", { 
      areaId, 
      area, 
      mapFile: area.mapFile,
      spawnPosition,
      fromPortal: portalId
    });
    
    console.log(`Entered area: ${area.name}`);
    return true;
  }
  
  public usePortal(portalId: string): boolean {
    const currentArea = this.getCurrentArea();
    if (!currentArea) return false;
    
    const portal = currentArea.portals.find(p => p.id === portalId);
    if (!portal) {
      console.log(`Portal ${portalId} not found in current area`);
      return false;
    }
    
    this.emit("portal_used", { portal, fromArea: currentArea.id });
    
    return this.enterArea(portal.targetArea, portal.targetPortal);
  }
  
  // ==================== Lot Ownership ====================
  
  public getOwnedLots(): OwnedLot[] {
    const state = GameState.getInstance();
    return state.getCustomData<OwnedLot[]>("ownedLots") || [];
  }
  
  public ownsLot(lotId: string): boolean {
    return this.getOwnedLots().some(lot => lot.id === lotId);
  }
  
  public canPurchaseLot(lotId: string): { canPurchase: boolean; reason?: string } {
    const lot = this.lots.get(lotId);
    if (!lot) {
      return { canPurchase: false, reason: "Lot not found" };
    }
    
    if (this.ownsLot(lotId)) {
      return { canPurchase: false, reason: "Already owned" };
    }
    
    const state = GameState.getInstance();
    
    if (state.getPlayer().level < lot.requiredLevel) {
      return { canPurchase: false, reason: `Requires level ${lot.requiredLevel}` };
    }
    
    if (lot.prerequisiteLot && !this.ownsLot(lot.prerequisiteLot)) {
      const prereq = this.lots.get(lot.prerequisiteLot);
      return { canPurchase: false, reason: `Must own ${prereq?.name || lot.prerequisiteLot} first` };
    }
    
    if (!state.canAfford(lot.price)) {
      return { canPurchase: false, reason: `Need $${lot.price.toLocaleString()}` };
    }
    
    // Must be in the same area to purchase
    if (this.getCurrentAreaId() !== lot.areaId) {
      return { canPurchase: false, reason: "Must be in this area to purchase" };
    }
    
    return { canPurchase: true };
  }
  
  public purchaseLot(lotId: string): boolean {
    const check = this.canPurchaseLot(lotId);
    if (!check.canPurchase) {
      console.log(`Cannot purchase lot: ${check.reason}`);
      return false;
    }
    
    const lot = this.lots.get(lotId)!;
    const state = GameState.getInstance();
    
    state.spendMoney(lot.price);
    
    const owned = this.getOwnedLots();
    owned.push({
      id: lotId,
      purchasedAt: Date.now(),
    });
    state.setCustomData("ownedLots", owned);
    
    state.incrementStat("lotsPurchased");
    state.incrementStat("moneySpentOnLots", lot.price);
    
    console.log(`Purchased lot: ${lot.name} in ${this.getArea(lot.areaId)?.name}`);
    this.emit("lot_purchased", { lotId, lot });
    
    return true;
  }
  
  // ==================== Lot Navigation ====================
  
  public enterLot(lotId: string): boolean {
    if (!this.ownsLot(lotId)) {
      console.log("You don't own this lot");
      return false;
    }
    
    const lot = this.lots.get(lotId);
    if (!lot) return false;
    
    // Must be in the same area
    if (this.getCurrentAreaId() !== lot.areaId) {
      console.log("Must be in the same area to enter lot");
      return false;
    }
    
    const state = GameState.getInstance();
    state.setCustomData("currentLot", lotId);
    
    this.emit("lot_entered", { 
      lotId, 
      lot,
      mapFile: lot.lotMapFile 
    });
    
    console.log(`Entered lot: ${lot.name}`);
    return true;
  }
  
  public exitLot(): boolean {
    if (!this.isInLot()) return false;
    
    const lotId = this.getCurrentLotId();
    const lot = this.getCurrentLot();
    const state = GameState.getInstance();
    
    state.removeCustomData("currentLot");
    
    this.emit("lot_left", { lotId, lot });
    
    console.log("Exited lot");
    return true;
  }
  
  // ==================== Bonuses ====================
  
  public getActiveBonus(type: AreaBonus["type"]): number {
    let total = 0;
    
    // Area bonuses
    const area = this.getCurrentArea();
    if (area) {
      const areaBonus = area.areaBonuses.find(b => b.type === type);
      if (areaBonus) total += areaBonus.value;
    }
    
    // Lot bonuses (if in a lot)
    const lot = this.getCurrentLot();
    if (lot) {
      const lotBonus = lot.bonuses.find(b => b.type === type);
      if (lotBonus) total += lotBonus.value;
    }
    
    return total;
  }
  
  public getAllActiveBonuses(): AreaBonus[] {
    const bonusMap = new Map<string, number>();
    
    const area = this.getCurrentArea();
    if (area) {
      for (const bonus of area.areaBonuses) {
        bonusMap.set(bonus.type, (bonusMap.get(bonus.type) || 0) + bonus.value);
      }
    }
    
    const lot = this.getCurrentLot();
    if (lot) {
      for (const bonus of lot.bonuses) {
        bonusMap.set(bonus.type, (bonusMap.get(bonus.type) || 0) + bonus.value);
      }
    }
    
    return Array.from(bonusMap.entries()).map(([type, value]) => ({
      type: type as AreaBonus["type"],
      value
    }));
  }
  
  // ==================== Queries ====================
  
  public getAccessibleAreas(): AreaTemplate[] {
    return this.getAllAreas().filter(area => this.canAccessArea(area.id).canAccess);
  }
  
  public getLockedAreas(): { area: AreaTemplate; reason: string }[] {
    return this.getAllAreas()
      .map(area => ({ area, ...this.canAccessArea(area.id) }))
      .filter(result => !result.canAccess)
      .map(result => ({ area: result.area, reason: result.reason! }));
  }
  
  public getAvailableLots(): LotTemplate[] {
    return this.getAllLots().filter(lot => {
      if (this.ownsLot(lot.id)) return false;
      return this.canPurchaseLot(lot.id).canPurchase;
    });
  }
  
  public getOwnedLotsInArea(areaId: string): LotTemplate[] {
    const owned = this.getOwnedLots();
    return this.getLotsInArea(areaId).filter(lot => 
      owned.some(o => o.id === lot.id)
    );
  }
  
  // ==================== Events ====================
  
  public on(callback: WorldCallback): void {
    this.listeners.push(callback);
  }
  
  public off(callback: WorldCallback): void {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }
  
  private emit(event: WorldEventType, data: any): void {
    for (const callback of this.listeners) {
      callback(event, data);
    }
  }
}
