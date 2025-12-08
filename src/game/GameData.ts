/**
 * GameData - Game-specific data definitions
 * 
 * This is where game developers define their content.
 * The engine systems (BuildingSystem, PlantSystem, etc.) are generic.
 * This file contains the game-specific items, strains, etc.
 */

import { AchievementSystem, type Achievement } from "./AchievementSystem";
import { BuildingSystem, type BuildableItem } from "./BuildingSystem";
import { BuildableObjectManager, createStages, createInstantStage, type BuildableObjectTemplate } from "./BuildableObject";
import { EquipmentSystem, type EquipmentTemplate } from "./EquipmentSystem";
import { GameState } from "./GameState";
import { OrderSystem, type CustomerTemplate } from "./OrderSystem";
import { PlantSystem, type StrainDefinition } from "./PlantSystem";
import { QuestSystem, type Quest } from "./QuestSystem";
import { ShopSystem, type ShopItem, type ShopCategory } from "./ShopSystem";

// ==================== Buildable Items ====================
// These appear in the build menu

export const BUILDABLE_ITEMS: BuildableItem[] = [
  // Plant pots
  {
    id: "pot_basic",
    name: "Basic Pot",
    icon: "🪴",
    zoneType: "plant",
    cost: 50,
    requiredLevel: 1,
  },
  {
    id: "pot_large",
    name: "Large Pot",
    icon: "🌿",
    zoneType: "plant",
    cost: 150,
    requiredLevel: 3,
  },
  // Equipment
  {
    id: "grow_light",
    name: "Grow Light",
    icon: "💡",
    zoneType: "equipment",
    cost: 200,
    requiredLevel: 2,
  },
  {
    id: "water_system",
    name: "Auto Watering",
    icon: "💧",
    zoneType: "equipment",
    cost: 500,
    requiredLevel: 4,
  },
  // Decorations
  {
    id: "plant_decor",
    name: "Decorative Plant",
    icon: "🌱",
    zoneType: "decoration",
    cost: 25,
    requiredLevel: 1,
  },
];

// ==================== Buildable Object Templates ====================
// These define the visual stages and build times

export const OBJECT_TEMPLATES: BuildableObjectTemplate[] = [
  {
    id: "pot_basic",
    name: "Basic Pot",
    icon: "🪴",
    zoneType: "plant",
    cost: 50,
    requiredLevel: 1,
    buildTime: 10 * 1000, // 10 seconds
    stages: createStages("pot", 1), // Uses pot_0.map, pot_50.map, pot_100.map
  },
  {
    id: "pot_large",
    name: "Large Pot",
    icon: "🌿",
    zoneType: "plant",
    cost: 150,
    requiredLevel: 3,
    buildTime: 30 * 1000, // 30 seconds
    stages: createStages("pot", 1.5), // Same prefabs, larger scale
  },
  {
    id: "grow_light",
    name: "Grow Light",
    icon: "💡",
    zoneType: "equipment",
    cost: 200,
    requiredLevel: 2,
    buildTime: 20 * 1000, // 20 seconds
    stages: createStages("equipment/grow_light", 1),
  },
  {
    id: "water_system",
    name: "Auto Watering",
    icon: "💧",
    zoneType: "equipment",
    cost: 500,
    requiredLevel: 4,
    buildTime: 60 * 1000, // 60 seconds
    stages: createStages("equipment/water_system", 1),
  },
  {
    id: "plant_decor",
    name: "Decorative Plant",
    icon: "🌱",
    zoneType: "decoration",
    cost: 25,
    requiredLevel: 1,
    buildTime: 0, // Instant
    stages: createInstantStage("decor/plant_small.map", 1),
  },
];

// ==================== Plant Strains ====================
// These define growable plant types

export const PLANT_STRAINS: StrainDefinition[] = [
  {
    id: "basic",
    name: "Basic Bud",
    growthTime: 5 * 60 * 1000, // 5 minutes to grow
    stages: 4,
    waterConsumption: 10, // 10% per minute
    baseYield: 3,
    xpReward: 10,
    seedId: "seed_basic",
    harvestId: "harvest_basic",
    unlockLevel: 1,
    harvestWindow: 3 * 60 * 1000, // 3 minutes at peak quality
    overripeTime: 2 * 60 * 1000, // 2 minutes before spoiled
  },
  {
    id: "og_kush",
    name: "OG Kush",
    growthTime: 10 * 60 * 1000, // 10 minutes to grow
    stages: 5,
    waterConsumption: 15,
    baseYield: 5,
    xpReward: 25,
    seedId: "seed_og_kush",
    harvestId: "harvest_og_kush",
    unlockLevel: 3,
    harvestWindow: 4 * 60 * 1000, // 4 minutes at peak
    overripeTime: 3 * 60 * 1000, // 3 minutes before spoiled
  },
  {
    id: "purple_haze",
    name: "Purple Haze",
    growthTime: 15 * 60 * 1000, // 15 minutes to grow
    stages: 5,
    waterConsumption: 20,
    baseYield: 8,
    xpReward: 50,
    seedId: "seed_purple_haze",
    harvestId: "harvest_purple_haze",
    unlockLevel: 5,
    harvestWindow: 5 * 60 * 1000, // 5 minutes at peak
    overripeTime: 3 * 60 * 1000, // 3 minutes before spoiled
  },
];

// ==================== Customers ====================

export const CUSTOMERS: CustomerTemplate[] = [
  {
    id: "casual_buyer",
    name: "Casual Buyer",
    icon: "🧑",
    unlockLevel: 1,
    basePatience: 5 * 60 * 1000, // 5 minutes
    tipMultiplier: 1.0,
    requestableItems: ["harvest_basic"],
    quantityRange: [1, 3],
    dialogues: [
      "Hey, got any good stuff?",
      "I heard you have quality products.",
      "My friend recommended you!",
    ],
  },
  {
    id: "regular",
    name: "Regular Customer",
    icon: "👨",
    unlockLevel: 2,
    basePatience: 4 * 60 * 1000,
    tipMultiplier: 1.2,
    requestableItems: ["harvest_basic", "harvest_og_kush"],
    quantityRange: [2, 5],
    dialogues: [
      "The usual, please!",
      "You know what I like.",
    ],
  },
  {
    id: "connoisseur",
    name: "Connoisseur",
    icon: "🎩",
    unlockLevel: 4,
    basePatience: 3 * 60 * 1000,
    tipMultiplier: 1.5,
    requestableItems: ["harvest_og_kush", "harvest_purple_haze"],
    quantityRange: [3, 8],
    dialogues: [
      "Only the finest quality, please.",
      "I appreciate the good stuff.",
    ],
  },
];

// ==================== Shop Categories ====================

export const SHOP_CATEGORIES: ShopCategory[] = [
  { id: "seeds", name: "Seeds", icon: "🌱", order: 1 },
  { id: "supplies", name: "Supplies", icon: "🧪", order: 2 },
  { id: "upgrades", name: "Upgrades", icon: "⬆️", order: 3 },
];

// ==================== Shop Items ====================

export const SHOP_ITEMS: ShopItem[] = [
  // Seeds
  {
    id: "seed_basic",
    name: "Basic Seeds",
    description: "Simple, reliable seeds for beginners.",
    icon: "🌱",
    category: "seeds",
    price: 25,
    itemType: "seed",
    quantity: 3,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "seed_og_kush",
    name: "OG Kush Seeds",
    description: "Premium strain with higher yields.",
    icon: "🌿",
    category: "seeds",
    price: 100,
    itemType: "seed",
    quantity: 2,
    requiredLevel: 3,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "seed_purple_haze",
    name: "Purple Haze Seeds",
    description: "Rare exotic strain. Top quality.",
    icon: "💜",
    category: "seeds",
    price: 250,
    itemType: "seed",
    quantity: 1,
    requiredLevel: 5,
    maxPurchases: -1,
    stock: 5,
    restockInterval: 10 * 60 * 1000, // 10 minutes
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  // Supplies
  {
    id: "fertilizer",
    name: "Fertilizer",
    description: "Speeds up plant growth by 20%.",
    icon: "🧪",
    category: "supplies",
    price: 50,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 2,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
];

// ==================== Equipment Templates ====================

export const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  {
    id: "grow_light",
    name: "Grow Light",
    icon: "💡",
    description: "Increases growth speed of nearby plants.",
    zoneType: "equipment",
    effects: [
      { type: "growth_speed", value: 0.25, radius: 150 }, // +25% growth in radius
    ],
    powerConsumption: 10,
    requiresActivation: false,
    automationInterval: 0,
  },
  {
    id: "water_system",
    name: "Auto Watering",
    icon: "💧",
    description: "Automatically waters nearby plants.",
    zoneType: "equipment",
    effects: [
      { type: "auto_water", value: 1, radius: 200 },
    ],
    powerConsumption: 5,
    requiresActivation: false,
    automationInterval: 30 * 1000, // Every 30 seconds
    automationCallback: "auto_water",
  },
];

// ==================== Quests ====================

export const QUESTS: Quest[] = [
  {
    id: "tutorial_plant",
    name: "First Steps",
    description: "Plant your first seed and watch it grow!",
    icon: "🌱",
    category: "main",
    requiredLevel: 1,
    prerequisites: [],
    objectives: [
      {
        id: "plant_seed",
        type: "build",
        description: "Place a pot",
        target: 1,
        current: 0,
        targetId: "pot_basic",
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 50 },
      { type: "money", amount: 100 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
    dialogue: ["Welcome! Let's get you started with your first plant."],
  },
  {
    id: "first_harvest",
    name: "First Harvest",
    description: "Harvest your first plant!",
    icon: "🌿",
    category: "main",
    requiredLevel: 1,
    prerequisites: ["tutorial_plant"],
    objectives: [
      {
        id: "harvest",
        type: "harvest",
        description: "Harvest a plant",
        target: 1,
        current: 0,
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 100 },
      { type: "money", amount: 200 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
  },
  {
    id: "first_sale",
    name: "First Sale",
    description: "Complete your first customer order!",
    icon: "💰",
    category: "main",
    requiredLevel: 1,
    prerequisites: ["first_harvest"],
    objectives: [
      {
        id: "complete_order",
        type: "complete_order",
        description: "Complete an order",
        target: 1,
        current: 0,
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 150 },
      { type: "money", amount: 300 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
  },
];

// ==================== Achievements ====================

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_plant",
    name: "Green Thumb",
    description: "Plant your first seed",
    icon: "🌱",
    category: "growing",
    tier: "bronze",
    conditions: [
      { type: "stat_reach", target: 1, targetId: "plantsHarvested" },
    ],
    rewards: [
      { type: "xp", amount: 25 },
    ],
    isSecret: false,
    points: 10,
  },
  {
    id: "harvest_10",
    name: "Budding Farmer",
    description: "Harvest 10 plants",
    icon: "🌿",
    category: "growing",
    tier: "silver",
    conditions: [
      { type: "stat_reach", target: 10, targetId: "plantsHarvested" },
    ],
    rewards: [
      { type: "xp", amount: 100 },
      { type: "money", amount: 500 },
    ],
    isSecret: false,
    points: 25,
  },
  {
    id: "rich",
    name: "Money Maker",
    description: "Earn $10,000 total",
    icon: "💰",
    category: "economy",
    tier: "gold",
    conditions: [
      { type: "stat_reach", target: 10000, targetId: "moneyEarned" },
    ],
    rewards: [
      { type: "xp", amount: 250 },
    ],
    isSecret: false,
    points: 50,
  },
  {
    id: "level_5",
    name: "Rising Star",
    description: "Reach level 5",
    icon: "⭐",
    category: "progression",
    tier: "silver",
    conditions: [
      { type: "level_reach", target: 5 },
    ],
    rewards: [
      { type: "money", amount: 1000 },
    ],
    isSecret: false,
    points: 25,
  },
];

// ==================== World Areas ====================

import { WorldSystem, type AreaTemplate, type LotTemplate } from "./WorldSystem";

export const WORLD_AREAS: AreaTemplate[] = [
  // === SLUMS - Starting Area ===
  {
    id: "slums_street",
    name: "Slum Street",
    description: "A run-down neighborhood. Cheap, but not much foot traffic.",
    icon: "🏚️",
    mapFile: "maps/areas/slums_street.map",
    tier: "slums",
    portals: [
      {
        id: "to_suburbs",
        targetArea: "suburbs_main",
        targetPortal: "from_slums",
        position: { x: 100, y: 0, z: 0 },
        size: { width: 10, height: 20 },
        label: "To Suburbs →",
      },
    ],
    accessRequirements: [], // Always accessible
    areaBonuses: [], // No bonuses in slums
    lotIds: ["slums_garage", "slums_basement"],
  },
  
  // === SUBURBS - Mid-tier ===
  {
    id: "suburbs_main",
    name: "Quiet Suburbs",
    description: "A peaceful residential area. Better clientele.",
    icon: "🏘️",
    mapFile: "maps/areas/suburbs_main.map",
    tier: "suburbs",
    portals: [
      {
        id: "from_slums",
        targetArea: "slums_street",
        targetPortal: "to_suburbs",
        position: { x: -100, y: 0, z: 0 },
        size: { width: 10, height: 20 },
        label: "← To Slums",
      },
      {
        id: "to_downtown",
        targetArea: "downtown_plaza",
        targetPortal: "from_suburbs",
        position: { x: 100, y: 0, z: 50 },
        size: { width: 10, height: 20 },
        label: "To Downtown →",
      },
    ],
    accessRequirements: [
      { type: "level", value: 3 },
    ],
    accessDeniedMessage: "The suburbs are too nice for you... yet. Reach level 3!",
    areaBonuses: [
      { type: "customer_rate", value: 0.1 }, // +10% customer spawn rate
    ],
    lotIds: ["suburbs_house", "suburbs_shed"],
  },
  
  // === DOWNTOWN - Premium ===
  {
    id: "downtown_plaza",
    name: "Downtown Plaza",
    description: "The heart of the city. High traffic, high risk, high reward.",
    icon: "🏙️",
    mapFile: "maps/areas/downtown_plaza.map",
    tier: "downtown",
    portals: [
      {
        id: "from_suburbs",
        targetArea: "suburbs_main",
        targetPortal: "to_downtown",
        position: { x: -100, y: 0, z: 0 },
        size: { width: 10, height: 20 },
        label: "← To Suburbs",
      },
      {
        id: "to_industrial",
        targetArea: "industrial_district",
        targetPortal: "from_downtown",
        position: { x: 0, y: 0, z: 100 },
        size: { width: 20, height: 10 },
        label: "To Industrial ↑",
      },
    ],
    accessRequirements: [
      { type: "level", value: 5 },
      { type: "quest_complete", value: "establish_reputation" },
    ],
    accessDeniedMessage: "Downtown is for established operators only.",
    areaBonuses: [
      { type: "customer_rate", value: 0.25 },
      { type: "price_bonus", value: 0.15 }, // +15% sale prices
    ],
    lotIds: ["downtown_apartment", "downtown_storefront"],
  },
  
  // === INDUSTRIAL - Large Scale ===
  {
    id: "industrial_district",
    name: "Industrial District",
    description: "Abandoned warehouses. Perfect for large-scale operations.",
    icon: "🏭",
    mapFile: "maps/areas/industrial.map",
    tier: "industrial",
    portals: [
      {
        id: "from_downtown",
        targetArea: "downtown_plaza",
        targetPortal: "to_industrial",
        position: { x: 0, y: 0, z: -100 },
        size: { width: 20, height: 10 },
        label: "↓ To Downtown",
      },
    ],
    accessRequirements: [
      { type: "level", value: 8 },
      { type: "money", value: 1000 }, // Entry fee (bribe)
    ],
    accessDeniedMessage: "The guards want $1,000 to look the other way...",
    areaBonuses: [
      { type: "growth_speed", value: 0.2 },
      { type: "yield_bonus", value: 0.2 },
    ],
    lotIds: ["industrial_warehouse", "industrial_factory"],
  },
];

export const WORLD_LOTS: LotTemplate[] = [
  // === SLUMS LOTS ===
  {
    id: "slums_garage",
    name: "Old Garage",
    description: "A cramped garage. It's not much, but it's yours.",
    icon: "🚗",
    areaId: "slums_street",
    position: { x: 20, y: 0, z: 30 },
    price: 0, // Free starter lot
    requiredLevel: 1,
    size: "small",
    maxBuildZones: 4,
    maxPlantSlots: 4,
    bonuses: [],
    lotMapFile: "maps/lots/slums_garage.map",
    tier: "basic",
  },
  {
    id: "slums_basement",
    name: "Hidden Basement",
    description: "A basement with a secret entrance. More space to grow.",
    icon: "🚪",
    areaId: "slums_street",
    position: { x: 50, y: 0, z: 60 },
    price: 2500,
    requiredLevel: 2,
    prerequisiteLot: "slums_garage",
    size: "medium",
    maxBuildZones: 8,
    maxPlantSlots: 8,
    bonuses: [
      { type: "growth_speed", value: 0.05 },
    ],
    lotMapFile: "maps/lots/slums_basement.map",
    tier: "basic",
  },
  
  // === SUBURBS LOTS ===
  {
    id: "suburbs_house",
    name: "Suburban House",
    description: "A nice house with a big backyard. Very discreet.",
    icon: "🏠",
    areaId: "suburbs_main",
    position: { x: 30, y: 0, z: 40 },
    price: 15000,
    requiredLevel: 3,
    size: "medium",
    maxBuildZones: 12,
    maxPlantSlots: 10,
    bonuses: [
      { type: "customer_rate", value: 0.1 },
    ],
    lotMapFile: "maps/lots/suburbs_house.map",
    tier: "standard",
  },
  {
    id: "suburbs_shed",
    name: "Garden Shed",
    description: "A greenhouse disguised as a garden shed. Perfect conditions.",
    icon: "🌿",
    areaId: "suburbs_main",
    position: { x: 70, y: 0, z: 20 },
    price: 25000,
    requiredLevel: 4,
    prerequisiteLot: "suburbs_house",
    size: "medium",
    maxBuildZones: 10,
    maxPlantSlots: 16,
    bonuses: [
      { type: "growth_speed", value: 0.15 },
      { type: "water_efficiency", value: 0.2 },
    ],
    lotMapFile: "maps/lots/suburbs_shed.map",
    tier: "standard",
  },
  
  // === DOWNTOWN LOTS ===
  {
    id: "downtown_apartment",
    name: "Penthouse Suite",
    description: "A luxury apartment with a hidden grow room.",
    icon: "🏢",
    areaId: "downtown_plaza",
    position: { x: 40, y: 0, z: 50 },
    price: 75000,
    requiredLevel: 6,
    size: "large",
    maxBuildZones: 16,
    maxPlantSlots: 14,
    bonuses: [
      { type: "price_bonus", value: 0.2 },
      { type: "xp_multiplier", value: 0.1 },
    ],
    lotMapFile: "maps/lots/downtown_apartment.map",
    tier: "premium",
  },
  {
    id: "downtown_storefront",
    name: "Dispensary",
    description: "A legitimate storefront. The future is here!",
    icon: "🏪",
    areaId: "downtown_plaza",
    position: { x: 60, y: 0, z: 30 },
    price: 150000,
    requiredLevel: 8,
    prerequisiteLot: "downtown_apartment",
    size: "large",
    maxBuildZones: 20,
    maxPlantSlots: 20,
    bonuses: [
      { type: "customer_rate", value: 0.3 },
      { type: "price_bonus", value: 0.25 },
    ],
    lotMapFile: "maps/lots/downtown_dispensary.map",
    tier: "premium",
  },
  
  // === INDUSTRIAL LOTS ===
  {
    id: "industrial_warehouse",
    name: "Warehouse",
    description: "A massive warehouse. Industrial-scale production.",
    icon: "🏭",
    areaId: "industrial_district",
    position: { x: 50, y: 0, z: 50 },
    price: 250000,
    requiredLevel: 10,
    size: "huge",
    maxBuildZones: 32,
    maxPlantSlots: 40,
    bonuses: [
      { type: "yield_bonus", value: 0.25 },
      { type: "growth_speed", value: 0.2 },
    ],
    lotMapFile: "maps/lots/industrial_warehouse.map",
    tier: "luxury",
  },
  {
    id: "industrial_factory",
    name: "Processing Plant",
    description: "Full automation. This is the endgame.",
    icon: "⚙️",
    areaId: "industrial_district",
    position: { x: 80, y: 0, z: 70 },
    price: 500000,
    requiredLevel: 15,
    prerequisiteLot: "industrial_warehouse",
    size: "huge",
    maxBuildZones: 48,
    maxPlantSlots: 60,
    bonuses: [
      { type: "yield_bonus", value: 0.4 },
      { type: "growth_speed", value: 0.3 },
      { type: "water_efficiency", value: 0.5 },
    ],
    lotMapFile: "maps/lots/industrial_factory.map",
    tier: "luxury",
  },
];

// ==================== NPCs ====================

import { NPCSystem, type NPCTemplate, type NPCDialogue } from "./NPCSystem";

export const NPCS: NPCTemplate[] = [
  // === Tutorial/Guide NPC ===
  {
    id: "npc_mentor",
    name: "Old Pete",
    title: "Retired Grower",
    icon: "👴",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 30, y: 0, z: 40 },
    unlockLevel: 1,
    questIds: ["tutorial_plant", "first_harvest", "first_sale"],
    idleDialogues: [
      "Back in my day, we didn't have all these fancy lights...",
      "Keep at it, kid. You'll get there.",
    ],
    interactions: [
      {
        id: "mentor_quest_tutorial",
        type: "quest_available",
        label: "Learn the Basics",
        icon: "❗",
        priority: 100,
        conditions: [
          { type: "quest_complete", value: "tutorial_plant", negate: true },
          { type: "quest_active", value: "tutorial_plant", negate: true },
        ],
        action: { type: "start_quest", targetId: "tutorial_plant" },
      },
      {
        id: "mentor_quest_harvest",
        type: "quest_available", 
        label: "Time to Harvest",
        icon: "❗",
        priority: 90,
        conditions: [
          { type: "quest_complete", value: "tutorial_plant" },
          { type: "quest_complete", value: "first_harvest", negate: true },
          { type: "quest_active", value: "first_harvest", negate: true },
        ],
        action: { type: "start_quest", targetId: "first_harvest" },
      },
      {
        id: "mentor_chat",
        type: "dialogue",
        label: "Chat",
        icon: "💬",
        priority: 10,
        action: { type: "dialogue", dialogueId: "mentor_idle" },
      },
    ],
  },
  
  // === Seed Shop NPC ===
  {
    id: "npc_seed_dealer",
    name: "Sunny",
    title: "Seed Dealer",
    icon: "🌱",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 60, y: 0, z: 20 },
    unlockLevel: 1,
    shopCategory: "seeds",
    idleDialogues: [
      "Got the freshest seeds in town!",
      "Looking to grow something special?",
    ],
    interactions: [
      {
        id: "seed_shop",
        type: "shop",
        label: "Browse Seeds",
        icon: "🛒",
        priority: 50,
        action: { type: "open_shop", targetId: "seeds" },
      },
      {
        id: "seed_chat",
        type: "dialogue",
        label: "Chat",
        icon: "💬",
        priority: 10,
        action: { type: "dialogue", dialogueId: "seed_dealer_idle" },
      },
    ],
  },
  
  // === Equipment Shop NPC ===
  {
    id: "npc_tech_guy",
    name: "Sparky",
    title: "Equipment Specialist",
    icon: "🔧",
    defaultAreaId: "suburbs_main",
    defaultPosition: { x: 45, y: 0, z: 35 },
    unlockLevel: 3,
    shopCategory: "equipment",
    idleDialogues: [
      "Need some upgrades for your setup?",
      "I've got lights, fans, everything you need!",
    ],
    interactions: [
      {
        id: "equip_shop",
        type: "shop",
        label: "Browse Equipment",
        icon: "🛒",
        priority: 50,
        action: { type: "open_shop", targetId: "equipment" },
      },
    ],
  },
  
  // === Customer NPC (gives orders) ===
  {
    id: "npc_regular_customer",
    name: "Mike",
    title: "Regular Customer",
    icon: "🧔",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 80, y: 0, z: 50 },
    unlockLevel: 2,
    idleDialogues: [
      "Hey, you got anything good?",
      "I'll be back when you have some product.",
    ],
    interactions: [
      {
        id: "customer_order",
        type: "custom",
        label: "Take Order",
        icon: "📋",
        priority: 60,
        conditions: [
          { type: "level", value: 2 },
        ],
        action: { 
          type: "custom", 
          customEvent: "generate_order",
          customData: { customerId: "casual_buyer" },
        },
      },
    ],
  },
  
  // === Locked NPC (appears later) ===
  {
    id: "npc_dealer",
    name: "???",
    title: "Mysterious Figure",
    icon: "🕶️",
    defaultAreaId: "downtown_plaza",
    defaultPosition: { x: 50, y: 0, z: 60 },
    unlockLevel: 5,
    unlockQuest: "first_sale",
    idleDialogues: [
      "You've made a name for yourself...",
      "I might have some... opportunities for you.",
    ],
    interactions: [
      {
        id: "dealer_special",
        type: "quest_available",
        label: "Special Job",
        icon: "❗",
        priority: 100,
        conditions: [
          { type: "level", value: 5 },
        ],
        action: { type: "dialogue", dialogueId: "dealer_intro" },
      },
    ],
  },
];

export const NPC_DIALOGUES: NPCDialogue[] = [
  {
    id: "mentor_idle",
    lines: [
      "You know, growing isn't just about the plants.",
      "It's about patience, care, and knowing your customers.",
      "Stick with me, and you'll learn everything you need.",
    ],
  },
  {
    id: "seed_dealer_idle",
    lines: [
      "These seeds? Best genetics in the city.",
      "I've been in this business for years.",
      "Quality seeds mean quality harvest. Remember that.",
    ],
  },
  {
    id: "dealer_intro",
    lines: [
      "So you're the one everyone's talking about.",
      "I've got connections. Big ones.",
      "But first, I need to know I can trust you...",
    ],
    choices: [
      { text: "I'm interested.", nextDialogue: "dealer_job_offer" },
      { text: "Not right now.", action: { type: "dialogue" } },
    ],
  },
  {
    id: "dealer_job_offer",
    lines: [
      "Good. I like ambition.",
      "Come back when you've got $10,000 saved up.",
      "Then we'll talk business.",
    ],
  },
];

// ==================== Strain Genetics ====================

import { GeneticsSystem, type StrainGenetics } from "./GeneticsSystem";

export const STRAIN_GENETICS: StrainGenetics[] = [
  // === Landrace Strains (Original genetics) ===
  {
    id: "genetics_afghan_kush",
    name: "Afghan Kush",
    description: "A pure indica landrace from the Hindu Kush mountains. Known for heavy relaxation and earthy flavors.",
    type: "indica",
    indicaPercent: 100,
    thcContent: 17,
    cbdContent: 6,
    effects: { relaxed: 90, sleepy: 75, happy: 60, hungry: 50 },
    negativeEffects: { dry_mouth: 40, dry_eyes: 30 },
    flavors: { earthy: 85, woody: 70, herbal: 50, pine: 40 },
    terpenes: { myrcene: 80, caryophyllene: 50, pinene: 40 },
    growthTraits: {
      floweringTime: 55,
      yieldPotential: 70,
      heightPotential: 40,
      difficulty: 30,
      moldResistance: 70,
      pestResistance: 65,
      droughtTolerance: 80,
    },
    appearance: { budDensity: 85, trichomeCoverage: 70, purpleExpression: 20, orangeHairs: 50 },
    lineage: { generation: 0, isStabilized: true, originRegion: "Afghanistan" },
    rarity: "uncommon",
    basePrice: 8,
    isLandrace: true,
    tier: 1,
    specialTraits: ["drought_master"],
    unlockLevel: 1,
  },
  {
    id: "genetics_durban_poison",
    name: "Durban Poison",
    description: "A pure sativa landrace from South Africa. Energizing and uplifting with sweet, earthy flavors.",
    type: "sativa",
    indicaPercent: 0,
    thcContent: 20,
    cbdContent: 1,
    effects: { energetic: 90, uplifted: 85, creative: 80, focused: 75, happy: 70 },
    negativeEffects: { anxious: 30, paranoid: 20 },
    flavors: { sweet: 80, earthy: 60, pine: 50, citrus: 40 },
    terpenes: { terpinolene: 70, myrcene: 40, ocimene: 35 },
    growthTraits: {
      floweringTime: 70,
      yieldPotential: 65,
      heightPotential: 90,
      difficulty: 50,
      moldResistance: 60,
      pestResistance: 55,
      droughtTolerance: 70,
    },
    appearance: { budDensity: 50, trichomeCoverage: 75, purpleExpression: 0, orangeHairs: 70 },
    lineage: { generation: 0, isStabilized: true, originRegion: "South Africa" },
    rarity: "uncommon",
    basePrice: 10,
    isLandrace: true,
    tier: 1,
    specialTraits: ["giant_growth"],
    unlockLevel: 1,
  },
  {
    id: "genetics_thai",
    name: "Thai",
    description: "A legendary sativa landrace from Thailand. Known for cerebral, creative effects.",
    type: "sativa",
    indicaPercent: 0,
    thcContent: 18,
    cbdContent: 0,
    effects: { creative: 95, euphoric: 85, energetic: 80, focused: 70, uplifted: 75 },
    negativeEffects: { anxious: 35, paranoid: 25, dry_mouth: 30 },
    flavors: { citrus: 75, tropical: 70, herbal: 50, earthy: 40 },
    terpenes: { limonene: 65, pinene: 45, terpinolene: 40 },
    growthTraits: {
      floweringTime: 90,
      yieldPotential: 55,
      heightPotential: 95,
      difficulty: 70,
      moldResistance: 40,
      pestResistance: 50,
      droughtTolerance: 60,
    },
    appearance: { budDensity: 35, trichomeCoverage: 65, purpleExpression: 0, orangeHairs: 60 },
    lineage: { generation: 0, isStabilized: true, originRegion: "Thailand" },
    rarity: "rare",
    basePrice: 12,
    isLandrace: true,
    tier: 2,
    specialTraits: ["exotic_flavor"],
    unlockLevel: 3,
  },
  
  // === Classic Hybrids ===
  {
    id: "genetics_og_kush",
    name: "OG Kush",
    description: "The legendary West Coast hybrid. Complex fuel and citrus flavors with powerful relaxation.",
    type: "hybrid",
    indicaPercent: 55,
    thcContent: 23,
    cbdContent: 0,
    effects: { relaxed: 85, euphoric: 80, happy: 75, uplifted: 65, hungry: 50 },
    negativeEffects: { dry_mouth: 50, dry_eyes: 40, dizzy: 20 },
    flavors: { diesel: 80, citrus: 65, earthy: 55, pine: 50, lemon: 45 },
    terpenes: { myrcene: 60, limonene: 55, caryophyllene: 50 },
    growthTraits: {
      floweringTime: 60,
      yieldPotential: 65,
      heightPotential: 55,
      difficulty: 55,
      moldResistance: 50,
      pestResistance: 55,
      droughtTolerance: 60,
    },
    appearance: { budDensity: 80, trichomeCoverage: 85, purpleExpression: 10, orangeHairs: 65 },
    lineage: { 
      parent1Id: "genetics_afghan_kush",
      generation: 1, 
      isStabilized: true, 
      breederName: "Unknown",
      originRegion: "California"
    },
    rarity: "rare",
    basePrice: 15,
    isLandrace: false,
    tier: 2,
    specialTraits: [],
    unlockLevel: 3,
  },
  {
    id: "genetics_skunk_1",
    name: "Skunk #1",
    description: "A foundational hybrid that changed cannabis breeding. Pungent and potent.",
    type: "hybrid",
    indicaPercent: 35,
    thcContent: 17,
    cbdContent: 1,
    effects: { happy: 80, euphoric: 75, relaxed: 65, uplifted: 60, creative: 55 },
    negativeEffects: { dry_mouth: 35, dry_eyes: 25 },
    flavors: { skunk: 95, earthy: 60, sweet: 45, pungent: 70 },
    terpenes: { myrcene: 55, caryophyllene: 45, limonene: 35 },
    growthTraits: {
      floweringTime: 55,
      yieldPotential: 80,
      heightPotential: 60,
      difficulty: 25,
      moldResistance: 75,
      pestResistance: 70,
      droughtTolerance: 65,
    },
    appearance: { budDensity: 70, trichomeCoverage: 70, purpleExpression: 5, orangeHairs: 55 },
    lineage: { 
      parent1Id: "genetics_afghan_kush",
      parent2Id: "genetics_thai",
      generation: 1, 
      isStabilized: true, 
      breederName: "Sacred Seeds"
    },
    rarity: "common",
    basePrice: 8,
    isLandrace: false,
    tier: 1,
    specialTraits: ["heavy_yield"],
    unlockLevel: 1,
  },
  
  // === Modern Strains ===
  {
    id: "genetics_girl_scout_cookies",
    name: "Girl Scout Cookies",
    description: "A modern classic with sweet, earthy flavors and powerful euphoria.",
    type: "hybrid",
    indicaPercent: 60,
    thcContent: 25,
    cbdContent: 1,
    effects: { euphoric: 90, happy: 85, relaxed: 80, uplifted: 70, creative: 60 },
    negativeEffects: { dry_mouth: 45, dry_eyes: 35, paranoid: 15 },
    flavors: { sweet: 85, earthy: 65, mint: 40, vanilla: 35, berry: 30 },
    terpenes: { caryophyllene: 65, limonene: 55, humulene: 40 },
    growthTraits: {
      floweringTime: 63,
      yieldPotential: 60,
      heightPotential: 50,
      difficulty: 60,
      moldResistance: 55,
      pestResistance: 50,
      droughtTolerance: 55,
    },
    appearance: { budDensity: 90, trichomeCoverage: 90, purpleExpression: 40, orangeHairs: 75 },
    lineage: { 
      parent1Id: "genetics_og_kush",
      parent2Id: "genetics_durban_poison",
      generation: 2, 
      isStabilized: true, 
      breederName: "Cookie Fam"
    },
    rarity: "rare",
    basePrice: 18,
    isLandrace: false,
    tier: 3,
    specialTraits: ["high_thc", "frost_giant"],
    unlockLevel: 5,
  },
  {
    id: "genetics_gelato",
    name: "Gelato",
    description: "A dessert strain with incredible flavor and balanced effects.",
    type: "hybrid",
    indicaPercent: 55,
    thcContent: 24,
    cbdContent: 0,
    effects: { relaxed: 85, euphoric: 80, happy: 80, uplifted: 70, creative: 55 },
    negativeEffects: { dry_mouth: 40, dry_eyes: 30 },
    flavors: { sweet: 90, citrus: 70, berry: 65, vanilla: 50, earthy: 35 },
    terpenes: { limonene: 60, caryophyllene: 50, myrcene: 45 },
    growthTraits: {
      floweringTime: 58,
      yieldPotential: 70,
      heightPotential: 55,
      difficulty: 50,
      moldResistance: 60,
      pestResistance: 55,
      droughtTolerance: 50,
    },
    appearance: { budDensity: 85, trichomeCoverage: 95, purpleExpression: 60, orangeHairs: 70 },
    lineage: { 
      parent1Id: "genetics_girl_scout_cookies",
      generation: 3, 
      isStabilized: true, 
      breederName: "Cookie Fam"
    },
    rarity: "rare",
    basePrice: 20,
    isLandrace: false,
    tier: 4,
    specialTraits: ["frost_giant", "purple_pheno", "exotic_flavor"],
    unlockLevel: 7,
  },
  {
    id: "genetics_lemon_cherry_gelato",
    name: "Lemon Cherry Gelato",
    description: "An extremely popular hybrid with complex citrus and berry flavors.",
    type: "hybrid",
    indicaPercent: 50,
    thcContent: 26,
    cbdContent: 0,
    effects: { relaxed: 80, tingly: 75, giggly: 70, happy: 75, euphoric: 65 },
    negativeEffects: { anxious: 25, headache: 15, dizzy: 15 },
    flavors: { lemon: 90, citrus: 85, berry: 75, sweet: 70, earthy: 40 },
    terpenes: { limonene: 75, caryophyllene: 55, myrcene: 40 },
    growthTraits: {
      floweringTime: 60,
      yieldPotential: 75,
      heightPotential: 60,
      difficulty: 45,
      moldResistance: 65,
      pestResistance: 60,
      droughtTolerance: 55,
    },
    appearance: { budDensity: 88, trichomeCoverage: 92, purpleExpression: 50, orangeHairs: 80 },
    lineage: { 
      parent1Id: "genetics_gelato",
      parent2Id: "genetics_girl_scout_cookies",
      generation: 4, 
      isStabilized: true, 
      breederName: "Backpack Boyz"
    },
    rarity: "legendary",
    basePrice: 25,
    isLandrace: false,
    tier: 5,
    specialTraits: ["high_thc", "frost_giant", "purple_pheno", "exotic_flavor", "balanced_hybrid"],
    unlockLevel: 10,
  },
];

// ==================== Starting Resources ====================

export const STARTING_MONEY = 1000;
export const STARTING_UNLOCKS = ["basic_pot", "basic_light"];
export const STARTING_AREA = "slums_street";
export const STARTING_LOT = "slums_garage"; // Player starts with this lot

export const STARTING_INVENTORY = [
  { id: "seed_basic", type: "seed" as const, quantity: 5 },
];

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

  // Register plant strains
  PlantSystem.getInstance().registerStrains(PLANT_STRAINS);

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

  // Register strain genetics
  GeneticsSystem.getInstance().registerStrains(STRAIN_GENETICS);

  // Set up starting resources for new games
  const state = GameState.getInstance();
  if (!state.hasSaveData()) {
    // Starting money
    state.addMoney(STARTING_MONEY);
    
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
  }

  console.log(`Registered: ${BUILDABLE_ITEMS.length} items, ${OBJECT_TEMPLATES.length} templates, ${PLANT_STRAINS.length} strains, ${CUSTOMERS.length} customers, ${SHOP_ITEMS.length} shop items, ${QUESTS.length} quests, ${ACHIEVEMENTS.length} achievements, ${WORLD_AREAS.length} areas, ${WORLD_LOTS.length} lots, ${NPCS.length} NPCs, ${STRAIN_GENETICS.length} genetics`);
}
