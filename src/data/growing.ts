/**
 * Growing System Data
 * 
 * Pot types, lighting levels, and curing barrels.
 */

import type { PotDefinition, LightingLevel } from "../game/PlantSystem";
import type { CuringBarrel } from "../game/CuringSystem";

// ==================== Pot Types ====================
// Pots affect grow speed and have size categories for strain compatibility

export const POT_TYPES: PotDefinition[] = [
  {
    id: "pot_basic",
    name: "Basic Pot",
    size: "medium",
    growthSpeedMultiplier: 1.0,
    yieldMultiplier: 1.0,
    cost: 50,
    unlockLevel: 1,
    description: "A simple clay pot. Works for most strains.",
  },
  {
    id: "pot_large",
    name: "Large Pot",
    size: "large",
    growthSpeedMultiplier: 1.0,
    yieldMultiplier: 1.2,
    cost: 150,
    unlockLevel: 3,
    description: "A spacious pot for bigger plants. Higher yield potential.",
  },
  {
    id: "pot_hydro",
    name: "Hydro Pot",
    size: "medium",
    growthSpeedMultiplier: 0.8,
    yieldMultiplier: 1.1,
    cost: 1000,
    unlockLevel: 10,
    description: "Hydroponic system. Always grows 20% faster!",
  },
  {
    id: "basic_small",
    name: "Small Clay Pot",
    size: "small",
    growthSpeedMultiplier: 1.0,
    yieldMultiplier: 0.8,
    cost: 0,
    unlockLevel: 1,
    description: "A simple small pot. Good for compact indica strains.",
  },
  {
    id: "basic_medium",
    name: "Medium Clay Pot",
    size: "medium",
    growthSpeedMultiplier: 1.0,
    yieldMultiplier: 1.0,
    cost: 100,
    unlockLevel: 1,
    description: "A versatile medium pot. Works for most strains.",
  },
  {
    id: "basic_large",
    name: "Large Clay Pot",
    size: "large",
    growthSpeedMultiplier: 1.1,
    yieldMultiplier: 1.2,
    cost: 250,
    unlockLevel: 2,
    description: "A spacious pot for tall sativas. Higher yield potential.",
  },
  {
    id: "smart_small",
    name: "Small Smart Pot",
    size: "small",
    growthSpeedMultiplier: 0.85,
    yieldMultiplier: 0.9,
    cost: 300,
    unlockLevel: 3,
    description: "Fabric pot with air pruning. Faster growth for small plants.",
  },
  {
    id: "smart_medium",
    name: "Medium Smart Pot",
    size: "medium",
    growthSpeedMultiplier: 0.8,
    yieldMultiplier: 1.1,
    cost: 500,
    unlockLevel: 3,
    description: "Premium fabric pot. Great drainage and aeration.",
  },
  {
    id: "smart_large",
    name: "Large Smart Pot",
    size: "large",
    growthSpeedMultiplier: 0.85,
    yieldMultiplier: 1.3,
    cost: 800,
    unlockLevel: 4,
    description: "Large fabric pot for maximum yield potential.",
  },
  {
    id: "hydro_small",
    name: "Small Hydro System",
    size: "small",
    growthSpeedMultiplier: 0.6,
    yieldMultiplier: 1.0,
    cost: 1500,
    unlockLevel: 5,
    description: "Compact hydroponic system. Blazing fast growth!",
  },
  {
    id: "hydro_medium",
    name: "Medium Hydro System",
    size: "medium",
    growthSpeedMultiplier: 0.5,
    yieldMultiplier: 1.2,
    cost: 2500,
    unlockLevel: 6,
    description: "Professional hydro setup. Speed and yield combined.",
  },
  {
    id: "hydro_large",
    name: "Large Hydro System",
    size: "large",
    growthSpeedMultiplier: 0.5,
    yieldMultiplier: 1.5,
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
    yieldBonus: 0,
    growthSpeedBonus: 0,
    cost: 0,
    unlockLevel: 1,
  },
  {
    level: 2,
    name: "CFL Lights",
    intensity: "low",
    yieldBonus: 0.1,
    growthSpeedBonus: 0.05,
    cost: 300,
    unlockLevel: 2,
  },
  {
    level: 3,
    name: "LED Panel",
    intensity: "medium",
    yieldBonus: 0.2,
    growthSpeedBonus: 0.1,
    cost: 800,
    unlockLevel: 4,
  },
  {
    level: 4,
    name: "HPS System",
    intensity: "high",
    yieldBonus: 0.3,
    growthSpeedBonus: 0.15,
    cost: 2000,
    unlockLevel: 6,
  },
  {
    level: 5,
    name: "Pro Grow Lights",
    intensity: "high",
    yieldBonus: 0.5,
    growthSpeedBonus: 0.25,
    cost: 5000,
    unlockLevel: 8,
  },
];

// ==================== Curing Barrels ====================
// Barrels for curing fresh harvest into sellable product

export const CURING_BARRELS: CuringBarrel[] = [
  {
    id: "basic_barrel",
    name: "Basic Curing Barrel",
    capacity: 200,
    speedMultiplier: 1.0,
    cost: 100,
    unlockLevel: 1,
    minUses: 3,
    maxUses: 6,
    burpsRequired: 2,
    qualityBonus: 0,
    icon: "🛢️",
  },
  {
    id: "quality_barrel",
    name: "Quality Curing Barrel",
    capacity: 250,
    speedMultiplier: 0.9,
    cost: 500,
    unlockLevel: 3,
    minUses: 8,
    maxUses: 16,
    burpsRequired: 0,
    burpOnlyForTier: 3,
    qualityBonus: 5,
    icon: "🪵",
  },
  {
    id: "electric_curer",
    name: "Electric Professional Curer",
    capacity: 400,
    speedMultiplier: 0.7,
    cost: 2000,
    unlockLevel: 5,
    minUses: 16,
    maxUses: 32,
    burpsRequired: 0,
    qualityBonus: 10,
    icon: "⚡",
  },
];
