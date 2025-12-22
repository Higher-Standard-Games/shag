/**
 * StrainLoader - Loads strain data from strains.json
 * 
 * This is the single source of truth for all strain data.
 * Converts JSON data to both StrainDefinition (PlantSystem) and StrainGenetics (GeneticsSystem).
 */

import type { StrainDefinition } from "../game/PlantSystem";
import type { StrainGenetics, StrainType, SpecialTrait, GeneticTier } from "../game/GeneticsSystem";
import strainsData from "./strains.json";

/**
 * Raw strain data from JSON (flexible typing for JSON import)
 */
interface RawStrain {
  id: string;
  name: string;
  description: string;
  type: StrainType;
  indicaPercent: number;
  thcContent: number;
  cbdContent: number;
  effects: Record<string, number>;
  negativeEffects: Record<string, number>;
  flavors: Record<string, number>;
  terpenes: Record<string, number>;
  growthTraits: {
    floweringTime: number;
    yieldPotential: number;
    heightPotential: number;
    difficulty: number;
    moldResistance: number;
    pestResistance: number;
    droughtTolerance: number;
  };
  appearance: {
    budDensity: number;
    trichomeCoverage: number;
    purpleExpression: number;
    orangeHairs: number;
  };
  lineage: {
    parent1Id?: string;
    parent2Id?: string;
    generation: number;
    isStabilized: boolean;
    breederName?: string;
    originRegion?: string;
  };
  rarity: "common" | "uncommon" | "rare" | "legendary";
  basePrice: number;
  isLandrace: boolean;
  tier: GeneticTier;
  specialTraits: SpecialTrait[];
  unlockLevel: number;
  environment: {
    lightIntensity: "low" | "medium" | "high";
    humidityMin: number;
    humidityMax: number;
    potSize: "small" | "medium" | "large";
    nutrientDemand: "light" | "medium" | "heavy";
  };
  gameplay: {
    growthTime: number;
    stages: number;
    waterConsumption: number;
    baseYield: number;
    xpReward: number;
    seedId: string;
    harvestId: string;
    curedId: string;
    harvestWindow: number;
    overripeTime: number;
    preferredTempMin: number;
    preferredTempMax: number;
    waterPromptInterval: number;
    waterPromptWindow: number;
    curingTime: number;
    seedDropChance: number;
    rareSeedDrops: Array<{ strainId: string; chance: number }>;
    fertilization?: {
      requiredApplications: number;
      fertilizerType: 'basic' | 'premium' | 'advanced';
      applicationTiming: number[];
    };
  };
}

interface StrainsJson {
  strains: RawStrain[];
}

/**
 * Get all raw strain data
 */
export function getRawStrains(): RawStrain[] {
  // Cast through unknown to handle JSON import type inference
  return (strainsData as unknown as StrainsJson).strains;
}

/**
 * Convert raw strain to StrainDefinition for PlantSystem
 */
export function toStrainDefinition(raw: RawStrain): StrainDefinition {
  return {
    id: raw.id,
    name: raw.name,
    growthTime: raw.gameplay.growthTime,
    stages: raw.gameplay.stages,
    waterConsumption: raw.gameplay.waterConsumption,
    baseYield: raw.gameplay.baseYield,
    valuePerGram: raw.basePrice,
    xpReward: raw.gameplay.xpReward,
    seedId: raw.gameplay.seedId,
    harvestId: raw.gameplay.harvestId,
    curedId: raw.gameplay.curedId,
    unlockLevel: raw.unlockLevel,
    harvestWindow: raw.gameplay.harvestWindow,
    overripeTime: raw.gameplay.overripeTime,
    preferredTempMin: raw.gameplay.preferredTempMin,
    preferredTempMax: raw.gameplay.preferredTempMax,
    waterPromptInterval: raw.gameplay.waterPromptInterval,
    waterPromptWindow: raw.gameplay.waterPromptWindow,
    curingTime: raw.gameplay.curingTime,
    seedDropChance: raw.gameplay.seedDropChance,
    rareSeedDrops: raw.gameplay.rareSeedDrops,
    environment: raw.environment,
    fertilization: raw.gameplay.fertilization,
  };
}

/**
 * Convert raw strain to StrainGenetics for GeneticsSystem
 */
export function toStrainGenetics(raw: RawStrain): StrainGenetics {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    indicaPercent: raw.indicaPercent,
    thcContent: raw.thcContent,
    cbdContent: raw.cbdContent,
    effects: raw.effects as StrainGenetics["effects"],
    negativeEffects: raw.negativeEffects as StrainGenetics["negativeEffects"],
    flavors: raw.flavors as StrainGenetics["flavors"],
    terpenes: raw.terpenes as StrainGenetics["terpenes"],
    growthTraits: raw.growthTraits,
    appearance: raw.appearance,
    lineage: raw.lineage,
    rarity: raw.rarity,
    basePrice: raw.basePrice,
    isLandrace: raw.isLandrace,
    tier: raw.tier,
    specialTraits: raw.specialTraits,
    unlockLevel: raw.unlockLevel,
  };
}

/**
 * Get all strains as StrainDefinition[] for PlantSystem
 */
export function getAllStrainDefinitions(): StrainDefinition[] {
  return getRawStrains().map(toStrainDefinition);
}

/**
 * Get all strains as StrainGenetics[] for GeneticsSystem
 */
export function getAllStrainGenetics(): StrainGenetics[] {
  return getRawStrains().map(toStrainGenetics);
}

/**
 * Get a single strain by ID
 */
export function getStrainById(id: string): RawStrain | undefined {
  return getRawStrains().find(s => s.id === id);
}

/**
 * Get strain definition by ID
 */
export function getStrainDefinitionById(id: string): StrainDefinition | undefined {
  const raw = getStrainById(id);
  return raw ? toStrainDefinition(raw) : undefined;
}

/**
 * Get strain genetics by ID
 */
export function getStrainGeneticsById(id: string): StrainGenetics | undefined {
  const raw = getStrainById(id);
  return raw ? toStrainGenetics(raw) : undefined;
}

/**
 * Shop item interface (minimal for seed generation)
 */
export interface SeedShopItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "seeds";
  price: number;
  itemType: "seed";
  quantity: number;
  requiredLevel: number;
  maxPurchases: number;
  stock: number;
  restockInterval: number;
  isVisible: boolean;
  onSale: boolean;
  saleDiscount: number;
  metadata: {
    strainId: string;
  };
}

/**
 * Generate shop seed items from strains.json
 * This ensures seeds in shop match the actual strain seedIds
 */
export function generateSeedShopItems(): SeedShopItem[] {
  const strains = getRawStrains();
  
  // Map rarity to icon
  const rarityIcons: Record<string, string> = {
    common: "🌱",
    uncommon: "🌿",
    rare: "💜",
    legendary: "✨",
  };
  
  // Map rarity to base price multiplier
  const rarityPriceMultiplier: Record<string, number> = {
    common: 1,
    uncommon: 1.5,
    rare: 3,
    legendary: 5,
  };
  
  // Map rarity to quantity per purchase
  const rarityQuantity: Record<string, number> = {
    common: 3,
    uncommon: 2,
    rare: 1,
    legendary: 1,
  };
  
  // Map rarity to stock (-1 = unlimited)
  const rarityStock: Record<string, number> = {
    common: -1,
    uncommon: -1,
    rare: 5,
    legendary: 3,
  };
  
  // Map rarity to restock interval (0 = never, in ms)
  const rarityRestockInterval: Record<string, number> = {
    common: 0,
    uncommon: 0,
    rare: 10 * 60 * 1000, // 10 minutes
    legendary: 30 * 60 * 1000, // 30 minutes
  };

  return strains.map(strain => {
    const basePrice = 25; // Base seed price
    const priceMultiplier = rarityPriceMultiplier[strain.rarity] ?? 1;
    const tierMultiplier = 1 + (strain.tier - 1) * 0.5; // Higher tier = more expensive
    
    return {
      id: strain.gameplay.seedId,
      name: `${strain.name} Seeds`,
      description: strain.description.substring(0, 80) + (strain.description.length > 80 ? "..." : ""),
      icon: rarityIcons[strain.rarity] ?? "🌱",
      category: "seeds" as const,
      price: Math.round(basePrice * priceMultiplier * tierMultiplier),
      itemType: "seed" as const,
      quantity: rarityQuantity[strain.rarity] ?? 2,
      requiredLevel: strain.unlockLevel,
      maxPurchases: -1,
      stock: rarityStock[strain.rarity] ?? -1,
      restockInterval: rarityRestockInterval[strain.rarity] ?? 0,
      isVisible: true,
      onSale: false,
      saleDiscount: 0,
      metadata: {
        strainId: strain.id,
      },
    };
  });
}
