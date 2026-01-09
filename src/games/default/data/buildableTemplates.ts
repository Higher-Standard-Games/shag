/**
 * Engine-level BuildableSystem Templates
 * 
 * Converts game templates to the new engine format.
 * This file is used during incremental migration - both old and new systems
 * can run in parallel until migration is complete.
 */

import { 
  BuildableTemplate, 
  BuildableSystem,
  createStages3,
  createInstantStage,
} from "../../../engine/BuildableSystem";

// ==================== Pot Templates (Containers) ====================

const POT_TEMPLATES: BuildableTemplate[] = [
  {
    id: "pot_basic",
    name: "Basic Pot",
    icon: "🪴",
    category: "plant",
    buildTime: 0, // Instant placement
    cost: 50,
    requiredLevel: 1,
    stages: createInstantStage("pot_100.map"), // Single stage - plant visuals TBD
    behaviors: {
      container: {
        maxChildren: 1,
        allowedTemplates: ["plant"],
        syncVisualWithChildren: true,
      },
    },
    customData: {
      zoneType: "plant",
      emptyPrefab: "pot_empty.map",
    },
  },
  {
    id: "pot_large",
    name: "Large Pot",
    icon: "🌿",
    category: "plant",
    buildTime: 0, // Instant placement
    cost: 150,
    requiredLevel: 3,
    stages: createInstantStage("pot_100.map", 1.5), // Single stage - plant visuals TBD
    behaviors: {
      container: {
        maxChildren: 1,
        allowedTemplates: ["plant"],
        syncVisualWithChildren: true,
      },
    },
    customData: {
      zoneType: "plant",
      emptyPrefab: "pot_empty.map",
      potType: "large",
    },
  },
  {
    id: "pot_hydro",
    name: "Hydro Pot",
    icon: "💧",
    category: "plant",
    buildTime: 0, // Instant placement
    cost: 1000,
    requiredLevel: 10,
    stages: createInstantStage("pot_100.map", 1.2), // Single stage - plant visuals TBD
    behaviors: {
      container: {
        maxChildren: 1,
        allowedTemplates: ["plant"],
        syncVisualWithChildren: true,
      },
      // Hydro pots have auto-watering consumer behavior
      consumer: {
        resource: "water",
        ratePerMinute: 0.1, // Very slow drain
        onEmpty: "pause",
      },
    },
    customData: {
      zoneType: "plant",
      emptyPrefab: "pot_empty.map",
      potType: "hydro",
      autoWater: true,
    },
  },
];

// ==================== Grow Light Templates ====================

const GROW_LIGHT_TEMPLATES: BuildableTemplate[] = [
  {
    id: "grow_light_basic",
    name: "Basic Lamp",
    icon: "💡",
    category: "growlight",
    buildTime: 5 * 1000,
    cost: 300,
    requiredLevel: 1,
    stages: createInstantStage("equipment/grow_light.map"),
    behaviors: {
      light: {
        color: { r: 1.0, g: 0.95, b: 0.8 }, // Warm white
        intensity: 0.8,
        range: 100,
        offset: { x: 0, y: -20, z: 0 }, // Light points down
        enabled: true,
      },
    },
    customData: {
      zoneType: "growlight",
      yieldBonus: 0,
      tier: 1,
    },
  },
  {
    id: "grow_light_advanced",
    name: "Advanced Lamp",
    icon: "🔆",
    category: "growlight",
    buildTime: 10 * 1000,
    cost: 1000,
    requiredLevel: 3,
    stages: createInstantStage("equipment/grow_light.map", 1.1),
    behaviors: {
      light: {
        color: { r: 1.0, g: 0.9, b: 0.7 }, // Warmer
        intensity: 1.2,
        range: 120,
        offset: { x: 0, y: -20, z: 0 },
        enabled: true,
      },
    },
    customData: {
      zoneType: "growlight",
      yieldBonus: 0.15,
      tier: 2,
    },
  },
  {
    id: "grow_light_ultra",
    name: "Ultra LED Lamp",
    icon: "✨",
    category: "growlight",
    buildTime: 15 * 1000,
    cost: 3000,
    requiredLevel: 5,
    stages: createInstantStage("equipment/grow_light.map", 1.2),
    behaviors: {
      light: {
        color: { r: 0.9, g: 0.8, b: 1.0 }, // Purple-ish LED
        intensity: 1.5,
        range: 150,
        offset: { x: 0, y: -20, z: 0 },
        enabled: true,
      },
    },
    customData: {
      zoneType: "growlight",
      yieldBonus: 0.30,
      tier: 3,
    },
  },
];

// ==================== Equipment Templates ====================

const EQUIPMENT_TEMPLATES: BuildableTemplate[] = [
  {
    id: "grow_light",
    name: "Grow Light",
    icon: "💡",
    category: "equipment",
    buildTime: 20 * 1000,
    cost: 200,
    requiredLevel: 2,
    stages: createStages3("equipment/grow_light"),
  },
  {
    id: "water_system",
    name: "Auto Watering",
    icon: "💧",
    category: "equipment",
    buildTime: 60 * 1000,
    cost: 500,
    requiredLevel: 4,
    stages: createStages3("equipment/water_system"),
  },
];

// ==================== Decoration Templates ====================

const DECORATION_TEMPLATES: BuildableTemplate[] = [
  {
    id: "plant_decor",
    name: "Decorative Plant",
    icon: "🌱",
    category: "decoration",
    buildTime: 0, // Instant
    cost: 25,
    requiredLevel: 1,
    stages: createInstantStage("decor/plant_small.map"),
  },
];

// ==================== All Templates ====================

export const ENGINE_BUILDABLE_TEMPLATES: BuildableTemplate[] = [
  ...POT_TEMPLATES,
  ...GROW_LIGHT_TEMPLATES,
  ...EQUIPMENT_TEMPLATES,
  ...DECORATION_TEMPLATES,
];

/**
 * Register all buildable templates with the engine BuildableSystem
 */
export function registerEngineBuildableTemplates(): void {
  const system = BuildableSystem.getInstance();
  
  for (const template of ENGINE_BUILDABLE_TEMPLATES) {
    system.registerTemplate(template);
  }
  
  console.log(`[BuildableTemplates] Registered ${ENGINE_BUILDABLE_TEMPLATES.length} templates with engine BuildableSystem`);
}
