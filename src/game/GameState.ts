/**
 * GameState - Central state management for the game
 * Handles player data, resources, and persistence
 */

import { EventBus } from "../engine/core/EventBus";

// Progression config types
export interface ProgressionConfig {
  leveling: {
    maxLevel: number;
    xpCurve: {
      type: "formula" | "table";
      base: number;
      exponent: number;
    };
    levelRewards: LevelReward[];
  };
  titles: TitleConfig[];
  xpSources: Record<string, XPSourceConfig>;
}

export interface LevelReward {
  level: number;
  rewards: Reward[];
  message?: string;
}

export interface Reward {
  type: "money" | "xp" | "item" | "unlock" | "title";
  amount?: number;
  id?: string;
  quantity?: number;
}

export interface TitleConfig {
  id: string;
  name: string;
  minLevel: number;
}

export interface XPSourceConfig {
  base: number;
  perQuality?: number;
  perValue?: number;
  perTrait?: number;
}

export interface PlayerResources {
  money: number;
  xp: number;
  level: number;
  title?: string;
}

export interface GameStateData {
  version: number;  // Save version for migrations
  player: PlayerResources;
  inventory: InventoryState;
  plants: PlantState[];
  unlocks: string[];
  stats: GameStats;
  customData: Record<string, unknown>; // Generic storage for system-specific data
  lastSaved: number;
  playTime: number;
  
  // Location tracking
  currentAreaId: string;
  currentLotId?: string;
  currentMapId: string;
  
  // Per-map persistent data (built objects, decorations, etc.)
  mapData: Record<string, MapSaveData>;
  
  // Game time
  gameTime: number;  // In-game milliseconds elapsed
  gameDay: number;   // Current game day
}

/**
 * Per-map save data - stores everything placed/built in a map
 */
export interface MapSaveData {
  mapId: string;
  builtObjects: BuiltObjectState[];
  decorations: DecorationState[];
  discoveredSecrets: string[];
  visitedAt?: number;
  customData?: Record<string, unknown>;
}

export interface BuiltObjectState {
  id: string;
  templateId: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  progress: number;  // 0-100 build progress
  isComplete: boolean;
  metadata?: Record<string, unknown>;
}

export interface DecorationState {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation?: number;
}

export interface SaveSlotInfo {
  slot: number;
  exists: boolean;
  isAutoSave?: boolean;
  playerName?: string;
  level?: number;
  money?: number;
  playTime?: number;
  lastSaved?: number;
  day?: number;
  currentArea?: string;
  currentMap?: string;
}

// Current save version - increment when save format changes
const SAVE_VERSION = 1;

export interface InventoryState {
  items: InventoryItem[];
  maxSlots: number;
}

export interface InventoryItem {
  id: string;
  type: ItemType;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export type ItemType = "seed" | "harvest" | "equipment" | "consumable" | "material" | "special" | "fertilizer";

export interface PlantState {
  id: string;
  strain: string;
  position: { x: number; y: number; z: number };
  mapId: string;
  growthStage: number;
  growthProgress: number; // 0-100 within current stage
  waterLevel: number; // 0-100
  health: number; // 0-100
  plantedAt: number; // timestamp
  lastWatered: number; // timestamp
  // Hempire-style mechanics
  potType: string; // "basic" | "smart" | "magic" - affects grow speed
  temperature: number; // Current temperature setting (60-90°F)
  waterPromptsHit: number; // Successful water taps
  waterPromptsMissed: number; // Missed water prompts
  wateringStreak: number; // Consecutive perfect waters (for bonus)
  lastWaterPrompt: number; // Timestamp of last water prompt
  nextWaterPrompt: number; // Timestamp when next prompt appears
  fertilized: boolean; // Legacy field - kept for compatibility
  fertilizedAt?: number; // Legacy field - kept for compatibility
  fertilizerApplications?: number; // Number of fertilizer applications (0-3)
  lastFertilizedAt?: number; // Timestamp of last fertilizer application
}

/**
 * Game stats - generic key-value pairs
 * Common stats: plantsHarvested, moneyEarned, ordersCompleted, timePlayed
 * Games can add custom stats as needed
 */
export type GameStats = Record<string, number>;

// Default state with no game-specific content
// Game code should populate starting inventory via GameData.ts
const DEFAULT_STATE: GameStateData = {
  version: SAVE_VERSION,
  player: {
    money: 0,
    xp: 0,
    level: 1,
  },
  inventory: {
    items: [],
    maxSlots: 20,
  },
  plants: [],
  unlocks: [],
  stats: {},
  customData: {},
  lastSaved: Date.now(),
  playTime: 0,
  // Location - will be set by GameData starting values
  currentAreaId: "",
  currentLotId: undefined,
  currentMapId: "",
  // Per-map data
  mapData: {},
  // Game time
  gameTime: 0,
  gameDay: 1,
};

const STORAGE_KEY_PREFIX = "game_save";
const AUTOSAVE_KEY = "game_autosave";
const MAX_SAVE_SLOTS = 3;

type StateChangeCallback = (state: GameStateData) => void;

// Default progression config (can be overridden by JSON)
const DEFAULT_PROGRESSION: ProgressionConfig = {
  leveling: {
    maxLevel: 50,
    xpCurve: { type: "formula", base: 100, exponent: 1.5 },
    levelRewards: [],
  },
  titles: [],
  xpSources: {},
};

export class GameState {
  private static instance: GameState;
  private state: GameStateData;
  private listeners: Map<string, StateChangeCallback[]> = new Map();
  private sessionStartTime: number = Date.now();
  private progressionConfig: ProgressionConfig = DEFAULT_PROGRESSION;
  private currentSlot: number = 0;

  private constructor() {
    this.state = this.loadFromStorage(0) || { ...DEFAULT_STATE };
    // Note: Autosave is now handled by SaveManager via GameScene
    // to ensure all subsystem states are collected
  }

  private getStorageKey(slot: number): string {
    return `${STORAGE_KEY_PREFIX}_${slot}`;
  }

  public static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState();
    }
    return GameState.instance;
  }

  /**
   * Reset the singleton instance (for testing only)
   */
  public static resetInstance(): void {
    GameState.instance = null as any;
  }

  // ==================== State Access ====================

  public getState(): Readonly<GameStateData> {
    return this.state;
  }

  public getPlayer(): Readonly<PlayerResources> {
    return this.state.player;
  }

  public getInventory(): Readonly<InventoryState> {
    return this.state.inventory;
  }

  public getPlants(): Readonly<PlantState[]> {
    return this.state.plants;
  }

  // ==================== Player Resources ====================

  public addMoney(amount: number): void {
    const oldAmount = this.state.player.money;
    this.state.player.money += amount;
    if (amount > 0) {
      this.state.stats.moneyEarned = (this.state.stats.moneyEarned ?? 0) + amount;
    }
    this.emit("player");
    EventBus.emit("player:money_changed", { 
      oldAmount, 
      newAmount: this.state.player.money, 
      delta: amount 
    });
  }

  public spendMoney(amount: number): boolean {
    if (this.state.player.money >= amount) {
      const oldAmount = this.state.player.money;
      this.state.player.money -= amount;
      this.emit("player");
      EventBus.emit("player:money_changed", { 
        oldAmount, 
        newAmount: this.state.player.money, 
        delta: -amount 
      });
      return true;
    }
    return false;
  }

  public canAfford(amount: number): boolean {
    return this.state.player.money >= amount;
  }

  /**
   * Set progression config from external JSON
   */
  public setProgressionConfig(config: ProgressionConfig): void {
    this.progressionConfig = config;
  }

  public getProgressionConfig(): ProgressionConfig {
    return this.progressionConfig;
  }

  public addXP(amount: number, source?: string): void {
    this.state.player.xp += amount;
    this.checkLevelUp();
    this.emit("player");
    EventBus.emit("player:xp_gained", { amount, source: source ?? "unknown" });
  }

  /**
   * Add XP from a specific source (uses config multipliers)
   */
  public addXPFromSource(source: string, context?: { quality?: number; value?: number; traits?: number }): number {
    const sourceConfig = this.progressionConfig.xpSources[source];
    if (!sourceConfig) {
      console.warn(`Unknown XP source: ${source}`);
      return 0;
    }

    let xp = sourceConfig.base;
    if (context?.quality && sourceConfig.perQuality) {
      xp += context.quality * sourceConfig.perQuality;
    }
    if (context?.value && sourceConfig.perValue) {
      xp += context.value * sourceConfig.perValue;
    }
    if (context?.traits && sourceConfig.perTrait) {
      xp += context.traits * sourceConfig.perTrait;
    }

    xp = Math.floor(xp);
    this.addXP(xp);
    return xp;
  }

  private checkLevelUp(): void {
    const { maxLevel } = this.progressionConfig.leveling;
    let leveledUp = false;
    
    while (
      this.state.player.level < maxLevel &&
      this.state.player.xp >= this.getXPForLevel(this.state.player.level + 1)
    ) {
      this.state.player.level++;
      leveledUp = true;
      
      // Apply level rewards
      const rewards = this.getLevelRewards(this.state.player.level);
      if (rewards) {
        this.applyLevelRewards(rewards);
      }
      
      console.log(`Level up! Now level ${this.state.player.level}`);
    }
    
    if (leveledUp) {
      this.emit("levelup");
      EventBus.emit("player:levelup", { 
        oldLevel: this.state.player.level - 1, 
        newLevel: this.state.player.level 
      });
    }
  }

  private getLevelRewards(level: number): LevelReward | undefined {
    return this.progressionConfig.leveling.levelRewards.find(r => r.level === level);
  }

  private applyLevelRewards(levelReward: LevelReward): void {
    for (const reward of levelReward.rewards) {
      switch (reward.type) {
        case "money":
          if (reward.amount) {
            this.state.player.money += reward.amount;
          }
          break;
        case "unlock":
          if (reward.id) {
            this.unlock(reward.id);
          }
          break;
        case "title":
          if (reward.id) {
            this.state.player.title = reward.id;
          }
          break;
        case "item":
          if (reward.id) {
            this.addItem(reward.id, "special", reward.quantity || 1);
          }
          break;
      }
    }
    
    if (levelReward.message) {
      // Store message for UI to display
      this.setCustomData("lastLevelUpMessage", {
        message: levelReward.message,
        level: levelReward.level,
        timestamp: Date.now(),
      });
    }
  }

  public getXPForLevel(level: number): number {
    const { base, exponent } = this.progressionConfig.leveling.xpCurve;
    return Math.floor(base * Math.pow(level, exponent));
  }

  public getXPProgress(): number {
    const currentLevelXP = this.getXPForLevel(this.state.player.level);
    const nextLevelXP = this.getXPForLevel(this.state.player.level + 1);
    const progress = (this.state.player.xp - currentLevelXP) / (nextLevelXP - currentLevelXP);
    return Math.max(0, Math.min(1, progress));
  }

  public getMaxLevel(): number {
    return this.progressionConfig.leveling.maxLevel;
  }

  public getTitle(): TitleConfig | undefined {
    const titleId = this.state.player.title;
    return this.progressionConfig.titles.find(t => t.id === titleId);
  }

  public getAvailableTitles(): TitleConfig[] {
    return this.progressionConfig.titles.filter(t => t.minLevel <= this.state.player.level);
  }

  // ==================== Inventory ====================

  public addItem(id: string, type: ItemType, quantity: number = 1, metadata?: Record<string, unknown>): boolean {
    const existing = this.state.inventory.items.find(item => item.id === id);
    
    if (existing) {
      existing.quantity += quantity;
    } else {
      if (this.state.inventory.items.length >= this.state.inventory.maxSlots) {
        console.warn("Inventory full!");
        return false;
      }
      this.state.inventory.items.push({ id, type, quantity, metadata });
    }
    
    this.emit("inventory");
    return true;
  }

  public removeItem(id: string, quantity: number = 1): boolean {
    const existing = this.state.inventory.items.find(item => item.id === id);
    
    if (!existing || existing.quantity < quantity) {
      return false;
    }
    
    existing.quantity -= quantity;
    
    if (existing.quantity <= 0) {
      const index = this.state.inventory.items.indexOf(existing);
      this.state.inventory.items.splice(index, 1);
    }
    
    this.emit("inventory");
    return true;
  }

  public hasItem(id: string, quantity: number = 1): boolean {
    const item = this.state.inventory.items.find(i => i.id === id);
    return item !== undefined && item.quantity >= quantity;
  }

  public getItemCount(id: string): number {
    const item = this.state.inventory.items.find(i => i.id === id);
    return item?.quantity || 0;
  }

  public getItemsByType(type: ItemType): InventoryItem[] {
    return this.state.inventory.items.filter(item => item.type === type);
  }

  // ==================== Plants ====================

  public addPlant(plant: Omit<PlantState, "id">): PlantState {
    const newPlant: PlantState = {
      ...plant,
      id: `plant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
    this.state.plants.push(newPlant);
    this.emit("plants");
    return newPlant;
  }

  public updatePlant(id: string, updates: Partial<PlantState>): void {
    const plant = this.state.plants.find(p => p.id === id);
    if (plant) {
      Object.assign(plant, updates);
      this.emit("plants");
    }
  }

  public removePlant(id: string): PlantState | null {
    const index = this.state.plants.findIndex(p => p.id === id);
    if (index !== -1) {
      const removed = this.state.plants.splice(index, 1)[0];
      this.emit("plants");
      return removed;
    }
    return null;
  }

  public getPlant(id: string): PlantState | undefined {
    return this.state.plants.find(p => p.id === id);
  }

  public getPlantsInMap(mapId: string): PlantState[] {
    return this.state.plants.filter(p => p.mapId === mapId);
  }

  // ==================== Unlocks ====================

  public unlock(id: string): void {
    if (!this.state.unlocks.includes(id)) {
      this.state.unlocks.push(id);
      this.emit("unlocks");
    }
  }

  public isUnlocked(id: string): boolean {
    return this.state.unlocks.includes(id);
  }

  // ==================== Stats ====================

  public getStats(): GameStats {
    return { ...this.state.stats };
  }

  public getStat(stat: string): number {
    return this.state.stats[stat] ?? 0;
  }

  public incrementStat(stat: string, amount: number = 1): void {
    this.state.stats[stat] = (this.state.stats[stat] ?? 0) + amount;
    this.emit("stats");
  }

  public setStat(stat: string, value: number): void {
    this.state.stats[stat] = value;
    this.emit("stats");
  }

  // ==================== Custom Data ====================
  // Generic key-value storage for system-specific data (locations, etc.)

  public getCustomData<T>(key: string): T | undefined {
    return this.state.customData[key] as T | undefined;
  }

  public setCustomData<T>(key: string, value: T): void {
    this.state.customData[key] = value;
    this.emit("customData");
  }

  public removeCustomData(key: string): void {
    delete this.state.customData[key];
    this.emit("customData");
  }

  public clearAllCustomData(): void {
    this.state.customData = {};
    this.emit("customData");
  }

  // ==================== Unlocks (Query) ====================

  public getUnlocks(): string[] {
    return [...this.state.unlocks];
  }

  // ==================== Location ====================

  public getCurrentLocation(): { areaId: string; lotId?: string; mapId: string } {
    return {
      areaId: this.state.currentAreaId,
      lotId: this.state.currentLotId,
      mapId: this.state.currentMapId,
    };
  }

  public setCurrentLocation(areaId: string, mapId: string, lotId?: string): void {
    this.state.currentAreaId = areaId;
    this.state.currentMapId = mapId;
    this.state.currentLotId = lotId;
    
    // Mark map as visited
    if (!this.state.mapData[mapId]) {
      this.state.mapData[mapId] = {
        mapId,
        builtObjects: [],
        decorations: [],
        discoveredSecrets: [],
        visitedAt: Date.now(),
      };
    }
    
    this.emit("location");
  }

  // ==================== Map Data ====================

  public getMapData(mapId: string): MapSaveData | undefined {
    return this.state.mapData[mapId];
  }

  public getOrCreateMapData(mapId: string): MapSaveData {
    if (!this.state.mapData[mapId]) {
      this.state.mapData[mapId] = {
        mapId,
        builtObjects: [],
        decorations: [],
        discoveredSecrets: [],
      };
    }
    return this.state.mapData[mapId];
  }

  public addBuiltObject(mapId: string, obj: BuiltObjectState): void {
    const mapData = this.getOrCreateMapData(mapId);
    mapData.builtObjects.push(obj);
    this.emit("mapData");
  }

  public updateBuiltObject(mapId: string, objId: string, updates: Partial<BuiltObjectState>): void {
    const mapData = this.state.mapData[mapId];
    if (!mapData) return;
    
    const obj = mapData.builtObjects.find(o => o.id === objId);
    if (obj) {
      Object.assign(obj, updates);
      this.emit("mapData");
    }
  }

  public removeBuiltObject(mapId: string, objId: string): void {
    const mapData = this.state.mapData[mapId];
    if (!mapData) return;
    
    const index = mapData.builtObjects.findIndex(o => o.id === objId);
    if (index >= 0) {
      mapData.builtObjects.splice(index, 1);
      this.emit("mapData");
    }
  }

  public getBuiltObjects(mapId: string): BuiltObjectState[] {
    return this.state.mapData[mapId]?.builtObjects || [];
  }

  public discoverSecret(mapId: string, secretId: string): void {
    const mapData = this.getOrCreateMapData(mapId);
    if (!mapData.discoveredSecrets.includes(secretId)) {
      mapData.discoveredSecrets.push(secretId);
      this.emit("secret");
    }
  }

  public hasDiscoveredSecret(mapId: string, secretId: string): boolean {
    return this.state.mapData[mapId]?.discoveredSecrets.includes(secretId) || false;
  }

  public clearAllMapData(): void {
    this.state.mapData = {};
    this.emit("mapData");
  }

  // ==================== Game Time ====================

  public getGameTime(): number {
    return this.state.gameTime;
  }

  public getGameDay(): number {
    return this.state.gameDay;
  }

  public setGameTime(time: number, day: number): void {
    this.state.gameTime = time;
    this.state.gameDay = day;
  }

  public advanceGameTime(deltaMs: number): void {
    this.state.gameTime += deltaMs;
  }

  public advanceGameDay(): void {
    this.state.gameDay++;
    this.emit("newday");
  }

  // ==================== Persistence ====================

  /**
   * Save to current slot
   */
  public save(): void {
    this.saveToSlot(this.currentSlot);
  }

  /**
   * Save to a specific slot (0-2)
   */
  public saveToSlot(slot: number): void {
    if (slot < 0 || slot >= MAX_SAVE_SLOTS) {
      console.error(`Invalid save slot: ${slot}`);
      return;
    }

    // Update play time
    const sessionTime = Date.now() - this.sessionStartTime;
    this.state.playTime += sessionTime;
    this.sessionStartTime = Date.now();
    
    this.state.lastSaved = Date.now();
    this.state.version = SAVE_VERSION;
    
    try {
      localStorage.setItem(this.getStorageKey(slot), JSON.stringify(this.state));
      this.currentSlot = slot;
      console.log(`Game saved to slot ${slot}!`);
      this.emit("save");
    } catch (e) {
      console.error("Failed to save game:", e);
    }
  }

  /**
   * Load from a specific slot
   */
  public loadFromSlot(slot: number): boolean {
    const data = this.loadFromStorage(slot);
    if (data) {
      this.state = data;
      this.currentSlot = slot;
      this.sessionStartTime = Date.now();
      this.emit("load");
      return true;
    }
    return false;
  }

  private loadFromStorage(slot: number): GameStateData | null {
    try {
      const saved = localStorage.getItem(this.getStorageKey(slot));
      if (saved) {
        const data = JSON.parse(saved) as GameStateData;
        // Migrate old saves if needed
        const migrated = this.migrateSave(data);
        console.log(`Game loaded from slot ${slot}!`);
        return migrated;
      }
    } catch (e) {
      console.error("Failed to load save:", e);
    }
    return null;
  }

  /**
   * Migrate old save formats to current version
   */
  private migrateSave(data: GameStateData): GameStateData {
    // Add version if missing (pre-versioning saves)
    if (!data.version) {
      data.version = 1;
    }
    
    // Future migrations go here:
    // if (data.version < 2) { ... migrate to v2 ... data.version = 2; }
    
    return data;
  }

  /**
   * Get info about all save slots (including autosave)
   */
  public getSaveSlots(): SaveSlotInfo[] {
    const slots: SaveSlotInfo[] = [];
    
    // Check autosave first
    const autoSaved = localStorage.getItem(AUTOSAVE_KEY);
    if (autoSaved) {
      try {
        const data = JSON.parse(autoSaved) as GameStateData;
        slots.push({
          slot: -1, // -1 indicates autosave
          exists: true,
          isAutoSave: true,
          playerName: data.customData.playerName as string | undefined,
          level: data.player.level,
          money: data.player.money,
          playTime: data.playTime,
          lastSaved: data.lastSaved,
          day: data.gameDay,
          currentArea: data.currentAreaId,
          currentMap: data.currentMapId,
        });
      } catch {
        // Invalid autosave, ignore
      }
    }
    
    // Check manual save slots
    for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
      const saved = localStorage.getItem(this.getStorageKey(i));
      if (saved) {
        try {
          const data = JSON.parse(saved) as GameStateData;
          slots.push({
            slot: i,
            exists: true,
            isAutoSave: false,
            playerName: data.customData.playerName as string | undefined,
            level: data.player.level,
            money: data.player.money,
            playTime: data.playTime,
            lastSaved: data.lastSaved,
            day: data.gameDay,
            currentArea: data.currentAreaId,
            currentMap: data.currentMapId,
          });
        } catch {
          slots.push({ slot: i, exists: false });
        }
      } else {
        slots.push({ slot: i, exists: false });
      }
    }
    
    return slots;
  }

  /**
   * Autosave - continuous save that happens frequently
   */
  public autoSave(): void {
    // Update play time
    const sessionTime = Date.now() - this.sessionStartTime;
    this.state.playTime += sessionTime;
    this.sessionStartTime = Date.now();
    this.state.lastSaved = Date.now();
    this.state.version = SAVE_VERSION;
    
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.state));
      // Don't log autosaves to avoid spam
    } catch (e) {
      console.error("Failed to autosave:", e);
    }
  }

  /**
   * Load from autosave
   */
  public loadAutoSave(): boolean {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as GameStateData;
        this.state = this.migrateSave(data);
        this.currentSlot = -1; // Indicate loaded from autosave
        this.sessionStartTime = Date.now();
        this.emit("load");
        console.log("Loaded from autosave!");
        return true;
      }
    } catch (e) {
      console.error("Failed to load autosave:", e);
    }
    return false;
  }

  /**
   * Check if autosave exists
   */
  public hasAutoSave(): boolean {
    return localStorage.getItem(AUTOSAVE_KEY) !== null;
  }

  /**
   * Delete autosave
   */
  public deleteAutoSave(): void {
    localStorage.removeItem(AUTOSAVE_KEY);
  }

  /**
   * Delete a save slot
   */
  public deleteSaveSlot(slot: number): void {
    if (slot === -1) {
      this.deleteAutoSave();
      return;
    }
    if (slot < 0 || slot >= MAX_SAVE_SLOTS) return;
    localStorage.removeItem(this.getStorageKey(slot));
    console.log(`Deleted save slot ${slot}`);
  }

  /**
   * Reset current game (doesn't delete save)
   */
  public resetGame(): void {
    this.state = { ...DEFAULT_STATE, version: SAVE_VERSION, lastSaved: Date.now() };
    this.emit("reset");
    console.log("Game reset!");
  }

  /**
   * Start a new game in a slot
   */
  public newGame(slot: number): void {
    this.currentSlot = slot;
    this.state = { ...DEFAULT_STATE, version: SAVE_VERSION, lastSaved: Date.now() };
    this.sessionStartTime = Date.now();
    this.emit("newgame");
    console.log(`New game started in slot ${slot}`);
  }

  public hasSaveData(slot?: number): boolean {
    if (slot !== undefined) {
      return localStorage.getItem(this.getStorageKey(slot)) !== null;
    }
    // Check if any slot has data
    for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
      if (localStorage.getItem(this.getStorageKey(i)) !== null) {
        return true;
      }
    }
    return false;
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  /**
   * Export save as JSON string (for backup)
   */
  public exportSave(): string {
    return JSON.stringify(this.state, null, 2);
  }

  /**
   * Import save from JSON string
   */
  public importSave(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString) as GameStateData;
      // Validate it has required fields
      if (!data.player || !data.inventory) {
        throw new Error("Invalid save format");
      }
      this.state = this.migrateSave(data);
      this.emit("load");
      console.log("Save imported successfully!");
      return true;
    } catch (e) {
      console.error("Failed to import save:", e);
      return false;
    }
  }

  // ==================== Events ====================

  public on(event: string, callback: StateChangeCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  public off(event: string, callback: StateChangeCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(this.state);
      }
    }
  }
}
