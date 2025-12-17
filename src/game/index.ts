// Game systems barrel export
export { GameState } from "./GameState";
export type { 
  GameStateData, 
  PlayerResources, 
  InventoryState, 
  InventoryItem, 
  ItemType,
  PlantState,
  GameStats,
} from "./GameState";

export { GameTimer } from "./GameTimer";
export type { TimerEvent, ScheduledTask } from "./GameTimer";

export { PlantSystem } from "./PlantSystem";
export type { StrainDefinition, PlantVisualState } from "./PlantSystem";

export { BuildingSystem } from "./BuildingSystem";
export type { BuildZone, BuildableItem } from "./BuildingSystem";

export { BuildableObjectManager, createStages, createInstantStage, createCustomStages } from "./BuildableObject";
export type { 
  BuildableObjectTemplate, 
  BuildableObjectState, 
  ObjectStage 
} from "./BuildableObject";

export { OrderSystem } from "./OrderSystem";
export type { CustomerTemplate, Order, OrderConfig } from "./OrderSystem";

export { ShopSystem } from "./ShopSystem";
export type { ShopItem, ShopCategory, PurchaseRecord } from "./ShopSystem";

export { EquipmentSystem } from "./EquipmentSystem";
export type { EquipmentTemplate, EquipmentEffect, ActiveEquipment, EffectType } from "./EquipmentSystem";

export { QuestSystem } from "./QuestSystem";
export type { Quest, QuestObjective, QuestReward, ActiveQuest, ObjectiveType } from "./QuestSystem";

export { AchievementSystem } from "./AchievementSystem";
export type { Achievement, AchievementCondition, AchievementReward, AchievementProgress } from "./AchievementSystem";

export { HarvestIndicator } from "./HarvestIndicator";

export { CuringSystem } from "./CuringSystem";
export type { CuringBarrel, CuringSlot, StoredFreshItem } from "./CuringSystem";

export { DealerSystem } from "./DealerSystem";
export type { Dealer, SellableProduct, DealRecord, DealerReputation } from "./DealerSystem";

// Game data registration (call once during init)
export { registerGameData } from "./GameData";
