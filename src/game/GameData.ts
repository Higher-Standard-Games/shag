/**
 * GameData - Game-specific data registration
 * 
 * This file registers all game data with the engine systems.
 * Data definitions are now split into focused files in src/data/:
 * - buildables.ts - Buildable items and object templates
 * - growing.ts - Pots, lighting, curing barrels
 * - commerce.ts - Dealers, customers, shop items
 * - equipment.ts - Equipment templates
 * - quests.ts - Quests and achievements
 * - world.ts - Areas and lots
 * - npcs.ts - NPCs and dialogues
 */

import { AchievementSystem } from "./AchievementSystem";
import { BuildingSystem } from "./BuildingSystem";
import { BuildableObjectManager } from "./BuildableObject";
import { CuringSystem } from "./CuringSystem";
import { DealerSystem } from "./DealerSystem";
import { EquipmentSystem } from "./EquipmentSystem";
import { GameState, type ItemType } from "./GameState";
import { GeneticsSystem } from "./GeneticsSystem";
import { NPCSystem } from "./NPCSystem";
import { OrderSystem } from "./OrderSystem";
import { PlantSystem } from "./PlantSystem";
import { QuestSystem } from "./QuestSystem";
import { SaveManager } from "./SaveManager";
import { ShopSystem } from "./ShopSystem";
import { WorldSystem } from "./WorldSystem";

// Import all data from focused data files
import {
  BUILDABLE_ITEMS,
  OBJECT_TEMPLATES,
  POT_TYPES,
  LIGHTING_LEVELS,
  CURING_BARRELS,
  DEALERS,
  CUSTOMERS,
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  EQUIPMENT_TEMPLATES,
  QUESTS,
  ACHIEVEMENTS,
  WORLD_AREAS,
  WORLD_LOTS,
  NPCS,
  NPC_DIALOGUES,
  getAllStrainDefinitions,
  getAllStrainGenetics,
  newGameConfig,
} from "../data";

// Re-export data for backwards compatibility
export {
  BUILDABLE_ITEMS,
  OBJECT_TEMPLATES,
  POT_TYPES,
  LIGHTING_LEVELS,
  CURING_BARRELS,
  DEALERS,
  CUSTOMERS,
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  EQUIPMENT_TEMPLATES,
  QUESTS,
  ACHIEVEMENTS,
  WORLD_AREAS,
  WORLD_LOTS,
  NPCS,
  NPC_DIALOGUES,
} from "../data";

// Also re-export SHOP_ITEMS_BASE for any code that needs it
export { SHOP_ITEMS_BASE } from "../data/commerce";

// ==================== Starting Resources (loaded from newgame.json) ====================

export const STARTING_MONEY = newGameConfig.startingMoney;
export const STARTING_UNLOCKS = newGameConfig.startingUnlocks;
export const STARTING_AREA = newGameConfig.startingArea;
export const STARTING_LOT = newGameConfig.startingLot;
export const STARTING_INVENTORY = newGameConfig.startingInventory.map(item => ({
  id: item.id,
  type: item.type as ItemType,
  quantity: item.quantity,
}));
export const STARTING_BARREL = newGameConfig.startingBarrel;

// ==================== Registration ====================

/**
 * Register all game data with the engine systems
 * Call this once during game initialization
 */
export function registerGameData(): void {
  console.log("Registering game data...");

  // Register buildable items
  BuildingSystem.getInstance().registerItems(BUILDABLE_ITEMS);

  // Register object templates
  const objectManager = BuildableObjectManager.getInstance();
  for (const template of OBJECT_TEMPLATES) {
    objectManager.registerTemplate(template);
  }

  // Register plant strains, pots, and lighting (strains loaded from strains.json)
  const plantSystem = PlantSystem.getInstance();
  plantSystem.registerStrains(getAllStrainDefinitions());
  plantSystem.registerPots(POT_TYPES);
  plantSystem.registerLightingLevels(LIGHTING_LEVELS);

  // Register customers
  OrderSystem.getInstance().registerCustomers(CUSTOMERS);

  // Register shop
  ShopSystem.getInstance().registerCategories(SHOP_CATEGORIES);
  ShopSystem.getInstance().registerItems(SHOP_ITEMS);

  // Register equipment templates
  EquipmentSystem.getInstance().registerTemplates(EQUIPMENT_TEMPLATES);

  // Register quests
  QuestSystem.getInstance().registerQuests(QUESTS);

  // Register achievements
  AchievementSystem.getInstance().registerAchievements(ACHIEVEMENTS);

  // Register world areas and lots
  WorldSystem.getInstance().registerAreas(WORLD_AREAS);
  WorldSystem.getInstance().registerLots(WORLD_LOTS);

  // Register NPCs and dialogues
  NPCSystem.getInstance().registerNPCs(NPCS);
  NPCSystem.getInstance().registerDialogues(NPC_DIALOGUES);

  // Register strain genetics (loaded from strains.json)
  GeneticsSystem.getInstance().registerStrains(getAllStrainGenetics());

  // Register curing barrels
  CuringSystem.getInstance().registerBarrels(CURING_BARRELS);
  CuringSystem.getInstance().init();

  // Register dealers
  DealerSystem.getInstance().registerDealers(DEALERS);
  DealerSystem.getInstance().init();

  // Set up starting resources for new games only (not when loading)
  const state = GameState.getInstance();
  const saveManager = SaveManager.getInstance();
  
  // Only add starting resources if this is NOT a loaded game
  const isLoadingGame = saveManager.isLoading();
  console.log(`[GameData] registerGameData called. isLoading: ${isLoadingGame}, current money: ${state.getPlayer().money}`);
  
  if (!isLoadingGame) {
    // Starting money
    state.addMoney(STARTING_MONEY);
    console.log(`[GameData] Added starting money: $${STARTING_MONEY}`);
    
    // Starting inventory
    for (const item of STARTING_INVENTORY) {
      state.addItem(item.id, item.type, item.quantity);
    }
    
    // Starting unlocks
    for (const unlock of STARTING_UNLOCKS) {
      state.unlock(unlock);
    }
    
    // Starting location and lot
    state.setCustomData("currentArea", STARTING_AREA);
    state.setCustomData("ownedLots", [{ id: STARTING_LOT, purchasedAt: Date.now() }]);
    
    // Give player a free starter curing barrel (from newgame.json)
    if (STARTING_BARREL) {
      const curingSystem = CuringSystem.getInstance();
      const starterBarrelId = `barrel_starter_${Date.now()}`;
      curingSystem.loadState({
        ownedBarrels: [{ id: starterBarrelId, templateId: STARTING_BARREL.templateId }],
      });
      console.log(`Gave player a free starter curing barrel: ${STARTING_BARREL.templateId}`);
    }
  }

  const strainCount = getAllStrainDefinitions().length;
  console.log(`Registered: ${BUILDABLE_ITEMS.length} items, ${OBJECT_TEMPLATES.length} templates, ${strainCount} strains, ${CUSTOMERS.length} customers, ${SHOP_ITEMS.length} shop items, ${QUESTS.length} quests, ${ACHIEVEMENTS.length} achievements, ${WORLD_AREAS.length} areas, ${WORLD_LOTS.length} lots, ${NPCS.length} NPCs`);
}
