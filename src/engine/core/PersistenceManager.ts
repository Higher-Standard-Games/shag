/**
 * PersistenceManager - Engine-level save/load infrastructure
 * 
 * Provides generic save slot management, localStorage abstraction,
 * and hooks for game-specific save systems.
 * 
 * This is engine-level code that can be reused across different games.
 */

import { EventBus } from "./EventBus";

// ==================== Interfaces ====================

/**
 * Interface for systems that can save/load their state
 */
export interface Saveable {
  /** Get serializable state */
  getState(): unknown;
  /** Load state from saved data */
  loadState(state: unknown): void;
  /** Clear/reset state for new game */
  clear(): void;
}

/**
 * Generic save slot metadata
 */
export interface SaveSlotMeta {
  slot: number;
  exists: boolean;
  isAutoSave: boolean;
  timestamp: number;
  version: number;
  playTime: number;
  /** Game-specific preview data (level, money, etc.) */
  preview?: Record<string, unknown>;
}

/**
 * Base save data structure
 */
export interface BaseSaveData {
  version: number;
  timestamp: number;
  playTime: number;
  currentMapId: string;
  /** Per-map persistent data */
  mapData: Record<string, MapPersistData>;
  /** Game-specific data stored by key */
  gameData: Record<string, unknown>;
}

/**
 * Per-map persistent data (engine-level)
 */
export interface MapPersistData {
  mapId: string;
  /** Placed objects on this map */
  objects: PlacedObjectData[];
  /** Custom map-specific data */
  custom?: Record<string, unknown>;
}

/**
 * Generic placed object data
 */
export interface PlacedObjectData {
  id: string;
  templateId: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  /** Object-specific state */
  state?: Record<string, unknown>;
}

/**
 * Configuration for PersistenceManager
 */
export interface PersistenceConfig {
  /** Prefix for localStorage keys */
  storagePrefix: string;
  /** Key for autosave */
  autoSaveKey: string;
  /** Maximum number of save slots */
  maxSlots: number;
  /** Current save format version */
  saveVersion: number;
  /** Autosave interval in milliseconds (0 to disable) */
  autoSaveInterval: number;
}

const DEFAULT_CONFIG: PersistenceConfig = {
  storagePrefix: "game_save",
  autoSaveKey: "game_autosave",
  maxSlots: 3,
  saveVersion: 1,
  autoSaveInterval: 30000,
};

// ==================== PersistenceManager ====================

export class PersistenceManager {
  private static instance: PersistenceManager;
  private config: PersistenceConfig;
  private currentSlot: number = 0;
  private sessionStartTime: number = Date.now();
  private autoSaveIntervalId: number | null = null;
  
  /** Registered saveable systems */
  private saveables: Map<string, Saveable> = new Map();
  
  /** Callback to collect game-specific save data */
  private collectGameData: (() => Record<string, unknown>) | null = null;
  
  /** Callback to restore game-specific save data */
  private restoreGameData: ((data: Record<string, unknown>) => Promise<void>) | null = null;
  
  /** Callback to get current map ID */
  private getCurrentMapId: (() => string) | null = null;
  
  /** Callback to get preview data for save slot */
  private getPreviewData: (() => Record<string, unknown>) | null = null;

  private constructor(config: Partial<PersistenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public static getInstance(): PersistenceManager {
    if (!PersistenceManager.instance) {
      PersistenceManager.instance = new PersistenceManager();
    }
    return PersistenceManager.instance;
  }

  /**
   * Initialize with custom configuration
   */
  public init(config: Partial<PersistenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set callbacks for game-specific data handling
   */
  public setCallbacks(callbacks: {
    collectGameData?: () => Record<string, unknown>;
    restoreGameData?: (data: Record<string, unknown>) => Promise<void>;
    getCurrentMapId?: () => string;
    getPreviewData?: () => Record<string, unknown>;
  }): void {
    if (callbacks.collectGameData) this.collectGameData = callbacks.collectGameData;
    if (callbacks.restoreGameData) this.restoreGameData = callbacks.restoreGameData;
    if (callbacks.getCurrentMapId) this.getCurrentMapId = callbacks.getCurrentMapId;
    if (callbacks.getPreviewData) this.getPreviewData = callbacks.getPreviewData;
  }

  // ==================== Saveable Registration ====================

  /**
   * Register a saveable system
   */
  public registerSaveable(key: string, saveable: Saveable): void {
    this.saveables.set(key, saveable);
  }

  /**
   * Unregister a saveable system
   */
  public unregisterSaveable(key: string): void {
    this.saveables.delete(key);
  }

  // ==================== Save Operations ====================

  /**
   * Save to current slot
   */
  public save(): void {
    this.saveToSlot(this.currentSlot);
  }

  /**
   * Save to specific slot
   */
  public saveToSlot(slot: number): void {
    const data = this.collectSaveData();
    const key = this.getStorageKey(slot);
    
    try {
      localStorage.setItem(key, JSON.stringify(data));
      this.currentSlot = slot;
      console.log(`[PersistenceManager] Saved to slot ${slot}`);
      EventBus.emit("persistence:saved", { slot });
    } catch (e) {
      console.error(`[PersistenceManager] Failed to save to slot ${slot}:`, e);
      EventBus.emit("persistence:error", { operation: "save", slot, error: e });
    }
  }

  /**
   * Autosave
   */
  public autoSave(): void {
    const data = this.collectSaveData();
    
    try {
      localStorage.setItem(this.config.autoSaveKey, JSON.stringify(data));
      console.log("[PersistenceManager] Autosaved");
      EventBus.emit("persistence:autosaved", {});
    } catch (e) {
      console.error("[PersistenceManager] Failed to autosave:", e);
    }
  }

  // ==================== Load Operations ====================

  /**
   * Load from specific slot
   */
  public async loadFromSlot(slot: number): Promise<boolean> {
    const key = this.getStorageKey(slot);
    
    try {
      const saved = localStorage.getItem(key);
      if (!saved) {
        console.warn(`[PersistenceManager] No save data in slot ${slot}`);
        return false;
      }
      
      const data = JSON.parse(saved) as BaseSaveData;
      await this.restoreSaveData(data);
      this.currentSlot = slot;
      this.sessionStartTime = Date.now();
      
      console.log(`[PersistenceManager] Loaded from slot ${slot}`);
      EventBus.emit("persistence:loaded", { slot });
      return true;
    } catch (e) {
      console.error(`[PersistenceManager] Failed to load from slot ${slot}:`, e);
      EventBus.emit("persistence:error", { operation: "load", slot, error: e });
      return false;
    }
  }

  /**
   * Load from autosave
   */
  public async loadAutoSave(): Promise<boolean> {
    try {
      const saved = localStorage.getItem(this.config.autoSaveKey);
      if (!saved) {
        console.warn("[PersistenceManager] No autosave data");
        return false;
      }
      
      const data = JSON.parse(saved) as BaseSaveData;
      await this.restoreSaveData(data);
      this.currentSlot = -1;
      this.sessionStartTime = Date.now();
      
      console.log("[PersistenceManager] Loaded from autosave");
      EventBus.emit("persistence:loaded", { slot: -1 });
      return true;
    } catch (e) {
      console.error("[PersistenceManager] Failed to load autosave:", e);
      return false;
    }
  }

  // ==================== Slot Management ====================

  /**
   * Get metadata for all save slots
   */
  public getSaveSlots(): SaveSlotMeta[] {
    const slots: SaveSlotMeta[] = [];
    
    // Regular slots
    for (let i = 0; i < this.config.maxSlots; i++) {
      slots.push(this.getSlotMeta(i));
    }
    
    // Autosave slot
    const autoSave = this.getAutoSaveMeta();
    if (autoSave.exists) {
      slots.unshift(autoSave);
    }
    
    return slots;
  }

  /**
   * Get metadata for a specific slot
   */
  public getSlotMeta(slot: number): SaveSlotMeta {
    const key = this.getStorageKey(slot);
    const saved = localStorage.getItem(key);
    
    if (!saved) {
      return {
        slot,
        exists: false,
        isAutoSave: false,
        timestamp: 0,
        version: 0,
        playTime: 0,
      };
    }
    
    try {
      const data = JSON.parse(saved) as BaseSaveData;
      return {
        slot,
        exists: true,
        isAutoSave: false,
        timestamp: data.timestamp,
        version: data.version,
        playTime: data.playTime,
        preview: data.gameData.preview as Record<string, unknown> | undefined,
      };
    } catch {
      return {
        slot,
        exists: false,
        isAutoSave: false,
        timestamp: 0,
        version: 0,
        playTime: 0,
      };
    }
  }

  /**
   * Get autosave metadata
   */
  public getAutoSaveMeta(): SaveSlotMeta {
    const saved = localStorage.getItem(this.config.autoSaveKey);
    
    if (!saved) {
      return {
        slot: -1,
        exists: false,
        isAutoSave: true,
        timestamp: 0,
        version: 0,
        playTime: 0,
      };
    }
    
    try {
      const data = JSON.parse(saved) as BaseSaveData;
      return {
        slot: -1,
        exists: true,
        isAutoSave: true,
        timestamp: data.timestamp,
        version: data.version,
        playTime: data.playTime,
        preview: data.gameData.preview as Record<string, unknown> | undefined,
      };
    } catch {
      return {
        slot: -1,
        exists: false,
        isAutoSave: true,
        timestamp: 0,
        version: 0,
        playTime: 0,
      };
    }
  }

  /**
   * Check if autosave exists
   */
  public hasAutoSave(): boolean {
    return localStorage.getItem(this.config.autoSaveKey) !== null;
  }

  /**
   * Check if any save exists
   */
  public hasAnySave(): boolean {
    if (this.hasAutoSave()) return true;
    for (let i = 0; i < this.config.maxSlots; i++) {
      if (localStorage.getItem(this.getStorageKey(i))) return true;
    }
    return false;
  }

  /**
   * Delete a save slot
   */
  public deleteSlot(slot: number): void {
    if (slot === -1) {
      localStorage.removeItem(this.config.autoSaveKey);
    } else {
      localStorage.removeItem(this.getStorageKey(slot));
    }
    EventBus.emit("persistence:deleted", { slot });
  }

  // ==================== New Game ====================

  /**
   * Start a new game - clears all registered saveables
   */
  public newGame(slot: number): void {
    this.currentSlot = slot;
    this.sessionStartTime = Date.now();
    
    // Clear all registered saveables
    for (const saveable of this.saveables.values()) {
      saveable.clear();
    }
    
    console.log(`[PersistenceManager] New game started in slot ${slot}`);
    EventBus.emit("persistence:newgame", { slot });
  }

  // ==================== Autosave Timer ====================

  /**
   * Start periodic autosave
   */
  public startAutoSave(): void {
    if (this.config.autoSaveInterval <= 0) return;
    
    this.stopAutoSave();
    this.autoSaveIntervalId = window.setInterval(() => {
      this.autoSave();
    }, this.config.autoSaveInterval);
    
    console.log(`[PersistenceManager] Autosave started (${this.config.autoSaveInterval}ms interval)`);
  }

  /**
   * Stop periodic autosave
   */
  public stopAutoSave(): void {
    if (this.autoSaveIntervalId !== null) {
      clearInterval(this.autoSaveIntervalId);
      this.autoSaveIntervalId = null;
    }
  }

  // ==================== Utilities ====================

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  public getPlayTime(): number {
    return Date.now() - this.sessionStartTime;
  }

  public getConfig(): PersistenceConfig {
    return { ...this.config };
  }

  private getStorageKey(slot: number): string {
    return `${this.config.storagePrefix}_${slot}`;
  }

  // ==================== Internal ====================

  private collectSaveData(): BaseSaveData {
    const currentMapId = this.getCurrentMapId?.() || "";
    
    // Collect from registered saveables
    const gameData: Record<string, unknown> = {};
    for (const [key, saveable] of this.saveables) {
      gameData[key] = saveable.getState();
    }
    
    // Collect game-specific data via callback
    if (this.collectGameData) {
      const customData = this.collectGameData();
      Object.assign(gameData, customData);
    }
    
    // Add preview data
    if (this.getPreviewData) {
      gameData.preview = this.getPreviewData();
    }
    
    return {
      version: this.config.saveVersion,
      timestamp: Date.now(),
      playTime: this.getPlayTime(),
      currentMapId,
      mapData: {}, // Map data is managed by game-level SaveManager
      gameData,
    };
  }

  private async restoreSaveData(data: BaseSaveData): Promise<void> {
    // Restore to registered saveables
    for (const [key, saveable] of this.saveables) {
      if (data.gameData[key] !== undefined) {
        saveable.loadState(data.gameData[key]);
      }
    }
    
    // Restore game-specific data via callback
    if (this.restoreGameData) {
      await this.restoreGameData(data.gameData);
    }
  }
}
