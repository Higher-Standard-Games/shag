/**
 * Buildable Items and Object Templates
 * 
 * Defines items that appear in the build menu and their visual stages.
 */

import { createStages, createInstantStage, type BuildableObjectTemplate } from "../game/BuildableObject";
import type { BuildableItem } from "../game/BuildingSystem";

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
