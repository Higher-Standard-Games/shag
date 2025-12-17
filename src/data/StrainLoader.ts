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
