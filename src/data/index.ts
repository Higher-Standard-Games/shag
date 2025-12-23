/**
 * Data Module Index
 * 
 * Re-exports all game data from focused data files.
 */

// Buildable items and templates
export { BUILDABLE_ITEMS, OBJECT_TEMPLATES } from "./buildables";

// Growing system data
export { POT_TYPES, LIGHTING_LEVELS, CURING_BARRELS } from "./growing";

// Commerce data
export { DEALERS, CUSTOMERS, SHOP_CATEGORIES, SHOP_ITEMS_BASE, SHOP_ITEMS } from "./commerce";

// Equipment templates
export { EQUIPMENT_TEMPLATES } from "./equipment";

// Quests and achievements
export { QUESTS, ACHIEVEMENTS } from "./quests";

// World data
export { WORLD_AREAS, WORLD_LOTS } from "./world";

// NPC data
export { NPCS, NPC_DIALOGUES } from "./npcs";

// Strain data (loaded from JSON)
export { getAllStrainDefinitions, getAllStrainGenetics, generateSeedShopItems } from "./StrainLoader";

// New game config
export { default as newGameConfig } from "./newgame.json";
