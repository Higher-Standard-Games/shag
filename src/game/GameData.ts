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
import { PlantSystem, type PotDefinition, type LightingLevel } from "./PlantSystem";
import { QuestSystem, type Quest } from "./QuestSystem";
import { ShopSystem, type ShopItem, type ShopCategory } from "./ShopSystem";
import { generateSeedShopItems } from "../data/StrainLoader";
import { CuringSystem, type CuringBarrel } from "./CuringSystem";
import { DealerSystem, type Dealer } from "./DealerSystem";
import { SaveManager } from "./SaveManager";

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
  {
    id: "pot_hydro",
    name: "Hydro Pot",
    icon: "💧",
    zoneType: "plant",
    cost: 1000,
    requiredLevel: 10,
  },
  // Grow Lights (for growlight zones above plants)
  {
    id: "grow_light_basic",
    name: "Basic Lamp",
    icon: "💡",
    zoneType: "growlight",
    cost: 300,
    requiredLevel: 1,
  },
  {
    id: "grow_light_advanced",
    name: "Advanced Lamp",
    icon: "🔆",
    zoneType: "growlight",
    cost: 1000,
    requiredLevel: 3,
  },
  {
    id: "grow_light_ultra",
    name: "Ultra LED Lamp",
    icon: "✨",
    zoneType: "growlight",
    cost: 3000,
    requiredLevel: 5,
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
    id: "pot_hydro",
    name: "Hydro Pot",
    icon: "💧",
    zoneType: "plant",
    cost: 1000,
    requiredLevel: 10,
    buildTime: 60 * 1000, // 60 seconds
    stages: createStages("pot", 1.2), // Same prefabs, slightly larger
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
  // Grow lights for growlight zones (above plants)
  {
    id: "grow_light_basic",
    name: "Basic Lamp",
    icon: "💡",
    zoneType: "growlight",
    cost: 300,
    requiredLevel: 1,
    buildTime: 5 * 1000, // 5 seconds
    stages: createInstantStage("equipment/grow_light.map", 1),
    yieldBonus: 0, // Normal yield
  },
  {
    id: "grow_light_advanced",
    name: "Advanced Lamp",
    icon: "🔆",
    zoneType: "growlight",
    cost: 1000,
    requiredLevel: 3,
    buildTime: 10 * 1000, // 10 seconds
    stages: createInstantStage("equipment/grow_light.map", 1.1),
    yieldBonus: 0.15, // +15% yield
  },
  {
    id: "grow_light_ultra",
    name: "Ultra LED Lamp",
    icon: "✨",
    zoneType: "growlight",
    cost: 3000,
    requiredLevel: 5,
    buildTime: 15 * 1000, // 15 seconds
    stages: createInstantStage("equipment/grow_light.map", 1.2),
    yieldBonus: 0.30, // +30% yield
  },
];

// ==================== Pot Types ====================
// Pots affect grow speed and have size categories for strain compatibility

export const POT_TYPES: PotDefinition[] = [
  {
    id: "pot_basic",
    name: "Basic Pot",
    size: "medium",
    growthSpeedMultiplier: 1.0, // Normal speed
    yieldMultiplier: 1.0, // 100% yield
    cost: 50,
    unlockLevel: 1,
    description: "A simple clay pot. Works for most strains.",
  },
  {
    id: "pot_large",
    name: "Large Pot",
    size: "large",
    growthSpeedMultiplier: 1.0, // Normal speed
    yieldMultiplier: 1.2, // 120% yield - more root space
    cost: 150,
    unlockLevel: 3,
    description: "A spacious pot for bigger plants. Higher yield potential.",
  },
  {
    id: "pot_hydro",
    name: "Hydro Pot",
    size: "medium",
    growthSpeedMultiplier: 0.8, // 20% faster (like permanent fertilizer)
    yieldMultiplier: 1.1, // 110% yield
    cost: 1000,
    unlockLevel: 10,
    description: "Hydroponic system. Always grows 20% faster!",
  },
  {
    id: "basic_small",
    name: "Small Clay Pot",
    size: "small",
    growthSpeedMultiplier: 1.0, // Normal speed
    yieldMultiplier: 0.8, // 80% yield - limited root space
    cost: 0, // Free starter pot
    unlockLevel: 1,
    description: "A simple small pot. Good for compact indica strains.",
  },
  {
    id: "basic_medium",
    name: "Medium Clay Pot",
    size: "medium",
    growthSpeedMultiplier: 1.0, // Normal speed
    yieldMultiplier: 1.0, // 100% yield - balanced
    cost: 100,
    unlockLevel: 1,
    description: "A versatile medium pot. Works for most strains.",
  },
  {
    id: "basic_large",
    name: "Large Clay Pot",
    size: "large",
    growthSpeedMultiplier: 1.1, // 10% slower (more soil to manage)
    yieldMultiplier: 1.2, // 120% yield - more root space
    cost: 250,
    unlockLevel: 2,
    description: "A spacious pot for tall sativas. Higher yield potential.",
  },
  {
    id: "smart_small",
    name: "Small Smart Pot",
    size: "small",
    growthSpeedMultiplier: 0.85, // 15% faster
    yieldMultiplier: 0.9, // 90% yield
    cost: 300,
    unlockLevel: 3,
    description: "Fabric pot with air pruning. Faster growth for small plants.",
  },
  {
    id: "smart_medium",
    name: "Medium Smart Pot",
    size: "medium",
    growthSpeedMultiplier: 0.8, // 20% faster
    yieldMultiplier: 1.1, // 110% yield
    cost: 500,
    unlockLevel: 3,
    description: "Premium fabric pot. Great drainage and aeration.",
  },
  {
    id: "smart_large",
    name: "Large Smart Pot",
    size: "large",
    growthSpeedMultiplier: 0.85, // 15% faster
    yieldMultiplier: 1.3, // 130% yield
    cost: 800,
    unlockLevel: 4,
    description: "Large fabric pot for maximum yield potential.",
  },
  {
    id: "hydro_small",
    name: "Small Hydro System",
    size: "small",
    growthSpeedMultiplier: 0.6, // 40% faster
    yieldMultiplier: 1.0, // 100% yield
    cost: 1500,
    unlockLevel: 5,
    description: "Compact hydroponic system. Blazing fast growth!",
  },
  {
    id: "hydro_medium",
    name: "Medium Hydro System",
    size: "medium",
    growthSpeedMultiplier: 0.5, // 50% faster
    yieldMultiplier: 1.2, // 120% yield
    cost: 2500,
    unlockLevel: 6,
    description: "Professional hydro setup. Speed and yield combined.",
  },
  {
    id: "hydro_large",
    name: "Large Hydro System",
    size: "large",
    growthSpeedMultiplier: 0.5, // 50% faster
    yieldMultiplier: 1.5, // 150% yield
    cost: 4000,
    unlockLevel: 7,
    description: "Industrial hydroponic system. Maximum everything!",
  },
];

// ==================== Lighting Levels ====================
// Passive yield bonus from grow room equipment with intensity for strain compatibility

export const LIGHTING_LEVELS: LightingLevel[] = [
  {
    level: 1,
    name: "Basic Bulb",
    intensity: "low",
    yieldBonus: 0, // No bonus
    growthSpeedBonus: 0, // No speed bonus
    cost: 0,
    unlockLevel: 1,
  },
  {
    level: 2,
    name: "CFL Lights",
    intensity: "low",
    yieldBonus: 0.1, // +10% yield
    growthSpeedBonus: 0.05, // +5% speed
    cost: 300,
    unlockLevel: 2,
  },
  {
    level: 3,
    name: "LED Panel",
    intensity: "medium",
    yieldBonus: 0.2, // +20% yield
    growthSpeedBonus: 0.1, // +10% speed
    cost: 800,
    unlockLevel: 4,
  },
  {
    level: 4,
    name: "HPS System",
    intensity: "high",
    yieldBonus: 0.3, // +30% yield
    growthSpeedBonus: 0.15, // +15% speed
    cost: 2000,
    unlockLevel: 6,
  },
  {
    level: 5,
    name: "Pro Grow Lights",
    intensity: "high",
    yieldBonus: 0.5, // +50% yield
    growthSpeedBonus: 0.25, // +25% speed
    cost: 5000,
    unlockLevel: 8,
  },
];

// ==================== Curing Barrels ====================
// Barrels for curing fresh harvest into sellable product

// ==================== Dealers ====================
// NPCs that buy products from the player

export const DEALERS: Dealer[] = [
  {
    id: "dealer_street",
    name: "Street Dealer",
    title: "Local Buyer",
    icon: "🧢",
    priceMultiplier: 0.8, // Pays 20% less (quick cash)
    preferredCategories: ["fresh"],
    preferredBonus: 0.1, // 10% bonus for fresh
    minReputation: 0,
    maxQuantity: 50, // Max 50g per deal
    dealCooldown: 60000, // 1 minute cooldown
    riskLevel: "low",
    requiredLevel: 1,
    isAvailable: true,
    areaId: "slums_street",
  },
  {
    id: "dealer_dispensary",
    name: "Green Leaf Dispensary",
    title: "Licensed Buyer",
    icon: "🏪",
    priceMultiplier: 1.0, // Standard prices
    preferredCategories: ["cured"],
    preferredBonus: 0.2, // 20% bonus for cured
    minReputation: 10,
    maxQuantity: 200, // Max 200g per deal
    dealCooldown: 300000, // 5 minute cooldown
    riskLevel: "low",
    requiredLevel: 2,
    isAvailable: true,
    areaId: "downtown",
  },
  {
    id: "dealer_wholesale",
    name: "Big Mike",
    title: "Wholesale Buyer",
    icon: "💼",
    priceMultiplier: 1.15, // Pays 15% more
    preferredCategories: ["cured"],
    preferredBonus: 0.15,
    minReputation: 25,
    maxQuantity: 500, // Max 500g per deal
    dealCooldown: 600000, // 10 minute cooldown
    riskLevel: "medium",
    requiredLevel: 5,
    isAvailable: true,
    areaId: "industrial",
  },
  {
    id: "dealer_premium",
    name: "The Connoisseur",
    title: "Premium Buyer",
    icon: "🎩",
    priceMultiplier: 1.5, // Pays 50% more!
    preferredCategories: ["cured"],
    preferredBonus: 0.25, // 25% bonus for cured
    minReputation: 50,
    maxQuantity: 100, // Max 100g per deal (quality over quantity)
    dealCooldown: 1800000, // 30 minute cooldown
    riskLevel: "low",
    requiredLevel: 10,
    isAvailable: true,
    areaId: "uptown",
  },
  {
    id: "dealer_underground",
    name: "Shadow",
    title: "Underground Contact",
    icon: "🕶️",
    priceMultiplier: 2.0, // Pays double!
    preferredCategories: ["cured", "fresh"],
    preferredBonus: 0.1,
    minReputation: 75,
    maxQuantity: 1000, // Bulk deals
    dealCooldown: 3600000, // 1 hour cooldown
    riskLevel: "high", // High heat gain
    requiredLevel: 15,
    isAvailable: true,
    areaId: "underground",
  },
];

export const CURING_BARRELS: CuringBarrel[] = [
  {
    id: "basic_barrel",
    name: "Basic Curing Barrel",
    capacity: 200, // 200g max
    speedMultiplier: 1.0, // Normal speed
    cost: 100,
    unlockLevel: 1,
    // Durability: breaks after 3-6 uses
    minUses: 3,
    maxUses: 6,
    // Requires 2 burps during curing
    burpsRequired: 2,
    qualityBonus: 0,
    icon: "🛢️",
  },
  {
    id: "quality_barrel",
    name: "Quality Curing Barrel",
    capacity: 250, // 250g max
    speedMultiplier: 0.9, // 10% faster
    cost: 500,
    unlockLevel: 3,
    // Durability: breaks after 8-16 uses
    minUses: 8,
    maxUses: 16,
    // No burping needed (only for tier 3+ strains - handled in code)
    burpsRequired: 0,
    burpOnlyForTier: 3,
    qualityBonus: 5, // +5% quality
    icon: "🪵",
  },
  {
    id: "electric_curer",
    name: "Electric Professional Curer",
    capacity: 400, // 400g max
    speedMultiplier: 0.7, // 30% faster
    cost: 2000,
    unlockLevel: 5,
    // Durability: breaks after 16-32 uses
    minUses: 16,
    maxUses: 32,
    // No burping needed
    burpsRequired: 0,
    qualityBonus: 10, // +10% quality
    icon: "⚡",
  },
];

// ==================== Plant Strains ====================
// Strains are now loaded from src/data/strains.json via StrainLoader
// This is the single source of truth for all strain data

// ==================== Customers ====================

export const CUSTOMERS: CustomerTemplate[] = [
  {
    id: "casual_buyer",
    name: "Casual Buyer",
    icon: "🧑",
    unlockLevel: 1,
    basePatience: 5 * 60 * 1000, // 5 minutes
    tipMultiplier: 1.0,
    // Tier 1 strains (unlockLevel 1)
    requestableItems: ["harvest_genetics_afghan_kush", "harvest_genetics_durban_poison", "harvest_genetics_thai"],
    quantityRange: [10, 30], // grams (capped at 50g by daily limit)
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
    // Tier 1-2 strains
    requestableItems: [
      "harvest_genetics_afghan_kush", "harvest_genetics_durban_poison", "harvest_genetics_thai",
      "harvest_genetics_og_kush", "harvest_genetics_skunk_1",
    ],
    quantityRange: [15, 40],
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
    // Tier 2-3 strains (premium)
    requestableItems: [
      "harvest_genetics_og_kush", "harvest_genetics_skunk_1",
      "harvest_genetics_girl_scout_cookies", "harvest_genetics_gelato",
    ],
    quantityRange: [20, 50],
    dialogues: [
      "Only the finest quality, please.",
      "I appreciate the good stuff.",
    ],
  },
  {
    id: "collector",
    name: "Collector",
    icon: "💎",
    unlockLevel: 6,
    basePatience: 2 * 60 * 1000,
    tipMultiplier: 2.0,
    // Tier 4-5 strains (rare/legendary)
    requestableItems: [
      "harvest_genetics_lemon_cherry_gelato", "harvest_genetics_blue_lobster",
      "harvest_genetics_master_kush",
    ],
    quantityRange: [25, 50],
    dialogues: [
      "I only collect the rarest strains.",
      "Money is no object for quality.",
      "Show me what you've got!",
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
// Seeds are generated from strains.json via generateSeedShopItems()
// Only non-seed items are defined here

export const SHOP_ITEMS_BASE: ShopItem[] = [
  // Fertilizers - New System
  {
    id: "fertilizer_basic",
    name: "Basic Fertilizer",
    description: "For light feeders (1 application). Increases yield from 60% to 100%.",
    icon: "🌱",
    category: "supplies",
    price: 50,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "fertilizer_premium",
    name: "Premium Fertilizer",
    description: "For medium feeders (2 applications). Increases yield from 60% to 100%.",
    icon: "🧪",
    category: "supplies",
    price: 100,
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
  {
    id: "fertilizer_advanced",
    name: "Advanced Fertilizer",
    description: "For heavy feeders (3 applications). Increases yield from 60% to 100%.",
    icon: "⚗️",
    category: "supplies",
    price: 200,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 3,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  // Curing Barrels
  {
    id: "basic_barrel",
    name: "Basic Curing Barrel",
    description: "Cures up to 200g of fresh harvest. Required to sell your product!",
    icon: "🛢️",
    category: "supplies",
    price: 100,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "oak_barrel",
    name: "Oak Curing Barrel",
    description: "Cures up to 500g, 25% faster. Premium quality curing.",
    icon: "🪵",
    category: "supplies",
    price: 500,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 3,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "premium_barrel",
    name: "Premium Curing Barrel",
    description: "Cures up to 1kg, 50% faster. Professional grade!",
    icon: "✨",
    category: "supplies",
    price: 2000,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 5,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
];

// Combined shop items: generated seeds from strains.json + base items
export const SHOP_ITEMS: ShopItem[] = [
  ...generateSeedShopItems(),
  ...SHOP_ITEMS_BASE,
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
  {
    id: "fan_basic",
    name: "Oscillating Fan",
    icon: "🌀",
    description: "Improves airflow, reducing pest risk and strengthening stems.",
    zoneType: "equipment",
    effects: [
      { type: "quality_bonus", value: 0.1, radius: 100 }, // +10% quality
      { type: "custom", value: 0.5, radius: 100, customId: "pest_resistance" }, // 50% pest resistance
    ],
    powerConsumption: 3,
    requiresActivation: false,
    automationInterval: 0,
  },
  {
    id: "humidifier",
    name: "Humidifier",
    icon: "💨",
    description: "Maintains optimal humidity, improving water retention.",
    zoneType: "equipment",
    effects: [
      { type: "water_retention", value: 0.3, radius: 120 }, // 30% less water consumption
    ],
    powerConsumption: 5,
    requiresActivation: false,
    automationInterval: 0,
  },
  {
    id: "co2_system",
    name: "CO2 Injector",
    icon: "🫧",
    description: "Boosts photosynthesis for faster growth and bigger yields.",
    zoneType: "equipment",
    effects: [
      { type: "growth_speed", value: 0.35, radius: 150 }, // +35% growth speed
      { type: "yield_bonus", value: 0.15, radius: 150 }, // +15% yield
    ],
    powerConsumption: 15,
    requiresActivation: true, // Needs to be turned on
    automationInterval: 0,
  },
  {
    id: "heater",
    name: "Space Heater",
    icon: "🔥",
    description: "Raises temperature in cold environments.",
    zoneType: "equipment",
    effects: [
      { type: "custom", value: 10, radius: 100, customId: "temp_increase" }, // +10°F
    ],
    powerConsumption: 20,
    requiresActivation: true,
    automationInterval: 0,
  },
  {
    id: "ac_unit",
    name: "AC Unit",
    icon: "❄️",
    description: "Lowers temperature in hot environments.",
    zoneType: "equipment",
    effects: [
      { type: "custom", value: -10, radius: 100, customId: "temp_decrease" }, // -10°F
    ],
    powerConsumption: 25,
    requiresActivation: true,
    automationInterval: 0,
  },
  {
    id: "security_camera",
    name: "Security Camera",
    icon: "📹",
    description: "Reduces risk of theft and raids.",
    zoneType: "equipment",
    effects: [
      { type: "custom", value: 0.25, radius: -1, customId: "security" }, // 25% security boost (global)
    ],
    powerConsumption: 2,
    requiresActivation: false,
    automationInterval: 0,
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
// Strain genetics are now loaded from src/data/strains.json via StrainLoader
// This is the single source of truth for all strain data

import { GeneticsSystem } from "./GeneticsSystem";
import { getAllStrainDefinitions, getAllStrainGenetics } from "../data/StrainLoader";

// ==================== Starting Resources ====================

export const STARTING_MONEY = 1000;
export const STARTING_UNLOCKS = ["basic_pot", "basic_light"];
export const STARTING_AREA = "slums_street";
export const STARTING_LOT = "slums_garage"; // Player starts with this lot

export const STARTING_INVENTORY = [
  { id: "seed_afghan_kush", type: "seed" as const, quantity: 5 }, // Beginner-friendly strain from strains.json
  { id: "fertilizer_basic", type: "fertilizer" as const, quantity: 3 }, // Basic fertilizer for starting strain
  { id: "fertilizer_premium", type: "fertilizer" as const, quantity: 2 }, // Some premium for medium feeders
  { id: "fertilizer_advanced", type: "fertilizer" as const, quantity: 1 }, // One advanced to try
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
    
    // Give player a free starter curing barrel
    const curingSystem = CuringSystem.getInstance();
    const starterBarrelId = `barrel_starter_${Date.now()}`;
    curingSystem.loadState({
      ownedBarrels: [{ id: starterBarrelId, templateId: "basic_barrel" }],
    });
    console.log("Gave player a free starter curing barrel");
  }

  const strainCount = getAllStrainDefinitions().length;
  console.log(`Registered: ${BUILDABLE_ITEMS.length} items, ${OBJECT_TEMPLATES.length} templates, ${strainCount} strains, ${CUSTOMERS.length} customers, ${SHOP_ITEMS.length} shop items, ${QUESTS.length} quests, ${ACHIEVEMENTS.length} achievements, ${WORLD_AREAS.length} areas, ${WORLD_LOTS.length} lots, ${NPCS.length} NPCs`);
}
