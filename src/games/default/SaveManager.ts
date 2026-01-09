/**
 * SaveManager - Game-specific save/load orchestration
 * 
 * This is the GAME-LEVEL save manager that coordinates saving/loading
 * of game-specific subsystems. It works alongside the ENGINE-LEVEL
 * PersistenceManager (src/engine/core/PersistenceManager.ts).
 * 
 * Architecture:
 * - ENGINE (PersistenceManager): Generic save slots, localStorage, autosave timer,
 *   Saveable interface, map data structure, events
 * - GAME (SaveManager): Game-specific subsystem coordination, GameState,
 *   CuringSystem, OrderSystem, etc.
 * 
 * Coordinates saving and loading of all game subsystems:
 * - GameState (player data, inventory, plants, unlocks, stats)
 * - BuildableSystem (built items per map)
 * - CuringSystem (barrels, curing slots, fresh storage)
 * - OrderSystem (active orders)
 * - QuestSystem (active/completed quests)
 * - AchievementSystem (progress)
 * - EquipmentSystem (active equipment)
 * - DealerSystem (reputation, heat)
 * - ShopSystem (purchase history, stock)
 * - GameTimer (game time)
 * - GameClock (day/time)
 * 
 * Handles:
 * - Full save/load to localStorage slots
 * - Map transitions (save current map state, load new map state)
 * - New game initialization
 * - Autosave coordination
 */

import { AchievementSystem } from "./AchievementSystem";
import { BuildableSystem, type BuildableInstance } from "../../engine/BuildableSystem";
import { CuringSystem } from "./CuringSystem";
import { DealerSystem } from "./DealerSystem";
import { EquipmentSystem } from "./EquipmentSystem";
import { GameClock } from "../../engine/core/GameClock";
import { GameState } from "./GameState";
import { GameTimer } from "../../engine/core/GameTimer";
import { OrderSystem } from "./OrderSystem";
import { QuestSystem } from "./QuestSystem";
import { ShopSystem } from "./ShopSystem";
import { EventBus } from "../../engine/core/EventBus";

/**
 * Extended save data that includes all subsystem states
 * This is stored in GameState.customData under specific keys
 */
interface SubsystemSaveData {
  // Curing system
  curingSystem?: {
    ownedBarrels: Array<{ id: string; templateId: string }>;
    curingSlots: unknown[];
    freshStorage: unknown[];
  };
  
  // Order system
  orderSystem?: {
    orders: unknown[];
    dailySoldGrams?: number;
    lastResetDay?: number;
    autosaleTriggers?: unknown[];
  };
  
  // Quest system
  questSystem?: {
    activeQuests: unknown[];
    completedQuests: string[];
    cooldowns: Record<string, number>;
  };
  
  // Achievement system
  achievementSystem?: {
    progress: unknown[];
  };
  
  // Equipment system
  equipmentSystem?: {
    equipment: unknown[];
  };
  
  // Dealer system
  dealerSystem?: {
    reputation: unknown[];
    dealHistory: unknown[];
    heat: number;
  };
  
  // Shop system
  shopSystem?: {
    purchaseHistory: unknown[];
    purchaseCounts: Record<string, number>;
    stocks: Record<string, number>;
  };
  
  // Game clock
  gameClock?: {
    currentHour: number;
    currentMinute: number;
    currentDay: number;
  };
}

export class SaveManager {
  private static instance: SaveManager;
  
  /** Flag indicating if we're loading a saved game (vs new game) */
  private isLoadingGame: boolean = false;
  
  private constructor() {}
  
  public static getInstance(): SaveManager {
    if (!SaveManager.instance) {
      SaveManager.instance = new SaveManager();
    }
    return SaveManager.instance;
  }
  
  /**
   * Check if we're currently loading a saved game
   * Used by GameScene to know whether to preserve time on GameClock.init()
   */
  public isLoading(): boolean {
    return this.isLoadingGame;
  }
  
  /**
   * Clear the loading flag (called after GameScene finishes initializing)
   */
  public clearLoadingFlag(): void {
    this.isLoadingGame = false;
  }
  
  // ==================== Full Save/Load ====================
  
  /**
   * Save complete game state to a slot
   * Collects state from all subsystems and saves to GameState
   */
  public saveGame(slot?: number): void {
    console.log("[SaveManager] Saving game...");
    
    const gameState = GameState.getInstance();
    const currentMapId = gameState.getCurrentLocation().mapId;
    
    // 1. Save current map's built objects
    this.saveCurrentMapState(currentMapId);
    
    // 2. Collect all subsystem states into customData
    this.collectSubsystemStates();
    
    // 3. Save game time (get day from GameTimer, not GameState)
    const gameTimer = GameTimer.getInstance();
    gameState.setGameTime(gameTimer.getGameTime(), gameTimer.getDay());
    
    // 4. Save to slot (or current slot if not specified)
    if (slot !== undefined) {
      gameState.saveToSlot(slot);
    } else {
      gameState.save();
    }
    
    console.log("[SaveManager] Game saved successfully");
    EventBus.emit("save:complete", { slot: slot ?? gameState.getCurrentSlot() });
  }
  
  /**
   * Load complete game state from a slot
   * Restores all subsystem states from GameState
   */
  public async loadGame(slot: number): Promise<boolean> {
    console.log(`[SaveManager] Loading game from slot ${slot}...`);
    
    this.isLoadingGame = true;
    
    const gameState = GameState.getInstance();
    
    // 1. Load GameState from slot
    const success = gameState.loadFromSlot(slot);
    if (!success) {
      console.error(`[SaveManager] Failed to load from slot ${slot}`);
      this.isLoadingGame = false;
      return false;
    }
    
    // 2. Restore all subsystem states
    await this.restoreSubsystemStates();
    
    // 3. Restore game time
    const savedTime = gameState.getGameTime();
    GameTimer.getInstance().setGameTime(savedTime);
    
    console.log("[SaveManager] Game loaded successfully");
    EventBus.emit("save:loaded", { slot });
    
    return true;
  }
  
  /**
   * Load from autosave
   */
  public async loadAutoSave(): Promise<boolean> {
    console.log("[SaveManager] Loading from autosave...");
    
    this.isLoadingGame = true;
    
    const gameState = GameState.getInstance();
    
    // 1. Load GameState from autosave
    const success = gameState.loadAutoSave();
    if (!success) {
      console.error("[SaveManager] Failed to load autosave");
      this.isLoadingGame = false;
      return false;
    }
    
    // 2. Restore all subsystem states
    await this.restoreSubsystemStates();
    
    // 3. Restore game time
    const savedTime = gameState.getGameTime();
    GameTimer.getInstance().setGameTime(savedTime);
    
    console.log("[SaveManager] Autosave loaded successfully");
    EventBus.emit("save:loaded", { slot: -1 });
    
    return true;
  }
  
  /**
   * Perform autosave (called periodically)
   */
  public autoSave(): void {
    const gameState = GameState.getInstance();
    const currentMapId = gameState.getCurrentLocation().mapId;
    
    // Save current map state
    if (currentMapId) {
      this.saveCurrentMapState(currentMapId);
    }
    
    // Collect subsystem states
    this.collectSubsystemStates();
    
    // Save game time (get day from GameTimer, not GameState)
    const gameTimer = GameTimer.getInstance();
    gameState.setGameTime(gameTimer.getGameTime(), gameTimer.getDay());
    
    // Autosave
    gameState.autoSave();
  }
  
  // ==================== New Game ====================
  
  /**
   * Start a new game - resets all subsystems
   */
  public newGame(slot: number): void {
    console.log(`[SaveManager] Starting new game in slot ${slot}...`);
    
    const gameState = GameState.getInstance();
    
    // 1. Delete old save data from localStorage for this slot
    gameState.deleteSaveSlot(slot);
    
    // 2. Reset GameState to default values
    gameState.newGame(slot);
    
    // 3. Clear all customData (subsystem states) and mapData (built objects)
    gameState.clearAllCustomData();
    gameState.clearAllMapData();
    
    // 4. Reset all subsystems
    this.resetAllSubsystems();
    
    // 5. Reset game time
    GameTimer.getInstance().reset();
    GameClock.getInstance().reset();
    
    // 6. Clear the loading flag (this is a new game, not a load)
    this.isLoadingGame = false;
    
    console.log("[SaveManager] New game started");
    EventBus.emit("save:newgame", { slot });
  }
  
  // ==================== Map Transitions ====================
  
  /**
   * Called before leaving a map - saves current map state
   */
  public saveCurrentMapState(mapId: string): void {
    if (!mapId) return;
    
    console.log(`[SaveManager] Saving map state for: ${mapId}`);
    
    const gameState = GameState.getInstance();
    const buildableSystem = BuildableSystem.getInstance();
    
    // Get current built objects from engine BuildableSystem
    const instances = buildableSystem.getInstancesInMap(mapId);
    
    // Get or create map data
    const mapData = gameState.getOrCreateMapData(mapId);
    
    // Convert BuildableInstance to BuiltObjectState for storage
    // Store extra fields in metadata for restoration
    mapData.builtObjects = instances.map((inst: BuildableInstance) => ({
      id: inst.id,
      templateId: inst.templateId,
      position: inst.position,
      progress: inst.progress,
      isComplete: inst.isComplete,
      metadata: {
        zoneId: inst.zoneId,
        mapId: inst.mapId,
        currentStage: inst.currentStage,
        startedAt: inst.startedAt,
        health: inst.health,
        customData: inst.customData,
        childIds: inst.childIds,
        childProgress: inst.childProgress,
        resourceLevels: inst.resourceLevels,
        storedProduction: inst.storedProduction,
        lastProductionAt: inst.lastProductionAt,
      },
    }));
    
    console.log(`[SaveManager] Saved ${instances.length} built objects for map ${mapId}`);
  }
  
  /**
   * Called after entering a map - loads map state
   */
  public async loadMapState(mapId: string): Promise<void> {
    console.log(`[SaveManager] Loading map state for: ${mapId}`);
    
    const gameState = GameState.getInstance();
    const buildableSystem = BuildableSystem.getInstance();
    
    // Get map data
    const mapData = gameState.getMapData(mapId);
    
    if (mapData && mapData.builtObjects.length > 0) {
      // Convert BuiltObjectState back to BuildableInstance format
      const instances: BuildableInstance[] = mapData.builtObjects.map(obj => {
        const metadata = obj.metadata || {};
        return {
          id: obj.id,
          templateId: obj.templateId,
          position: obj.position,
          progress: obj.progress,
          isComplete: obj.isComplete,
          zoneId: (metadata.zoneId as string) || undefined,
          mapId: (metadata.mapId as string) || mapId,
          currentStage: (metadata.currentStage as number) || 0,
          startedAt: (metadata.startedAt as number) || 0,
          health: (metadata.health as number) || 100,
          customData: metadata.customData as Record<string, unknown> | undefined,
          childIds: metadata.childIds as string[] | undefined,
          childProgress: metadata.childProgress as number | undefined,
          resourceLevels: metadata.resourceLevels as Record<string, number> | undefined,
          storedProduction: metadata.storedProduction as number | undefined,
          lastProductionAt: metadata.lastProductionAt as number | undefined,
        };
      });
      
      // Load into engine BuildableSystem
      buildableSystem.deserialize(instances);
      
      console.log(`[SaveManager] Loaded ${instances.length} built objects for map ${mapId}`);
    } else {
      // Clear any existing objects for this map (new map with no saved state)
      buildableSystem.clearMap(mapId);
      console.log(`[SaveManager] No saved state for map ${mapId}, starting fresh`);
    }
    
    // Update current location
    const currentLocation = gameState.getCurrentLocation();
    gameState.setCurrentLocation(currentLocation.areaId || "home", mapId, currentLocation.lotId);
  }
  
  /**
   * Handle map change - save old map, load new map
   */
  public async changeMap(fromMapId: string, toMapId: string): Promise<void> {
    console.log(`[SaveManager] Changing map: ${fromMapId} -> ${toMapId}`);
    
    // Save current map state
    if (fromMapId) {
      this.saveCurrentMapState(fromMapId);
    }
    
    // Load new map state
    await this.loadMapState(toMapId);
    
    // Trigger autosave after map change
    this.autoSave();
  }
  
  // ==================== Subsystem State Management ====================
  
  /**
   * Collect states from all subsystems into GameState.customData
   */
  private collectSubsystemStates(): void {
    const gameState = GameState.getInstance();
    
    // Curing System
    const curingState = CuringSystem.getInstance().getState();
    gameState.setCustomData("curingSystem", curingState);
    
    // Order System
    const orderSystem = OrderSystem.getInstance();
    gameState.setCustomData("orderSystem", orderSystem.getState());
    
    // Quest System
    const questState = QuestSystem.getInstance().getState();
    gameState.setCustomData("questSystem", questState);
    
    // Achievement System
    gameState.setCustomData("achievementSystem", {
      progress: AchievementSystem.getInstance().getState(),
    });
    
    // Equipment System
    gameState.setCustomData("equipmentSystem", {
      equipment: EquipmentSystem.getInstance().getState(),
    });
    
    // Dealer System
    const dealerState = DealerSystem.getInstance().getState();
    gameState.setCustomData("dealerSystem", dealerState);
    
    // Shop System
    const shopState = ShopSystem.getInstance().getState();
    gameState.setCustomData("shopSystem", shopState);
    
    // Game Clock
    const clock = GameClock.getInstance();
    const timeOfDay = clock.getTimeOfDay();
    gameState.setCustomData("gameClock", {
      currentHour: timeOfDay.hour,
      currentMinute: timeOfDay.minute,
      currentDay: clock.getCurrentDay(),
    });
  }
  
  /**
   * Restore states to all subsystems from GameState.customData
   */
  private async restoreSubsystemStates(): Promise<void> {
    const gameState = GameState.getInstance();
    
    // Curing System
    const curingData = gameState.getCustomData<SubsystemSaveData["curingSystem"]>("curingSystem");
    if (curingData) {
      CuringSystem.getInstance().loadState(curingData as any);
    }
    
    // Order System
    const orderData = gameState.getCustomData<SubsystemSaveData["orderSystem"]>("orderSystem");
    if (orderData) {
      OrderSystem.getInstance().loadState(orderData as any);
    }
    
    // Quest System
    const questData = gameState.getCustomData<SubsystemSaveData["questSystem"]>("questSystem");
    if (questData) {
      QuestSystem.getInstance().loadState(questData as any);
    }
    
    // Achievement System
    const achievementData = gameState.getCustomData<SubsystemSaveData["achievementSystem"]>("achievementSystem");
    if (achievementData?.progress) {
      AchievementSystem.getInstance().loadState(achievementData.progress as any);
    }
    
    // Equipment System
    const equipmentData = gameState.getCustomData<SubsystemSaveData["equipmentSystem"]>("equipmentSystem");
    if (equipmentData?.equipment) {
      EquipmentSystem.getInstance().loadState(equipmentData.equipment as any);
    }
    
    // Dealer System
    const dealerData = gameState.getCustomData<SubsystemSaveData["dealerSystem"]>("dealerSystem");
    if (dealerData) {
      DealerSystem.getInstance().loadState(dealerData as any);
    }
    
    // Shop System
    const shopData = gameState.getCustomData<SubsystemSaveData["shopSystem"]>("shopSystem");
    if (shopData) {
      ShopSystem.getInstance().loadState(shopData as any);
    }
    
    // Game Clock
    const clockData = gameState.getCustomData<SubsystemSaveData["gameClock"]>("gameClock");
    if (clockData) {
      GameClock.getInstance().setTime(clockData.currentHour, clockData.currentMinute);
      GameClock.getInstance().setDay(clockData.currentDay);
    }
    
    // Load current map's built objects
    const currentMapId = gameState.getCurrentLocation().mapId;
    if (currentMapId) {
      await this.loadMapState(currentMapId);
    }
  }
  
  /**
   * Reset all subsystems for a new game
   */
  private resetAllSubsystems(): void {
    // Clear engine BuildableSystem
    BuildableSystem.getInstance().clear();
    
    // Clear CuringSystem
    CuringSystem.getInstance().clear();
    
    // Clear OrderSystem
    OrderSystem.getInstance().clear();
    
    // Clear QuestSystem
    QuestSystem.getInstance().clear();
    
    // Clear AchievementSystem
    AchievementSystem.getInstance().clear();
    
    // Clear EquipmentSystem
    EquipmentSystem.getInstance().clear();
    
    // Clear DealerSystem
    DealerSystem.getInstance().clear();
    
    // Clear ShopSystem
    ShopSystem.getInstance().clear();
  }
}
