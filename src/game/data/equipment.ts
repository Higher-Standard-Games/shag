/**
 * Equipment Templates
 * 
 * Defines equipment that can be placed in the grow room.
 */

import type { EquipmentTemplate } from "../EquipmentSystem";

// ==================== Equipment Templates ====================

export const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  {
    id: "grow_light",
    name: "Grow Light",
    icon: "💡",
    description: "Increases growth speed of nearby plants.",
    zoneType: "equipment",
    effects: [
      { type: "growth_speed", value: 0.25, radius: 150 },
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
    automationInterval: 30 * 1000,
    automationCallback: "auto_water",
  },
  {
    id: "fan_basic",
    name: "Oscillating Fan",
    icon: "🌀",
    description: "Improves airflow, reducing pest risk and strengthening stems.",
    zoneType: "equipment",
    effects: [
      { type: "quality_bonus", value: 0.1, radius: 100 },
      { type: "custom", value: 0.5, radius: 100, customId: "pest_resistance" },
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
      { type: "water_retention", value: 0.3, radius: 120 },
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
      { type: "growth_speed", value: 0.35, radius: 150 },
      { type: "yield_bonus", value: 0.15, radius: 150 },
    ],
    powerConsumption: 15,
    requiresActivation: true,
    automationInterval: 0,
  },
  {
    id: "heater",
    name: "Space Heater",
    icon: "🔥",
    description: "Raises temperature in cold environments.",
    zoneType: "equipment",
    effects: [
      { type: "custom", value: 10, radius: 100, customId: "temp_increase" },
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
      { type: "custom", value: -10, radius: 100, customId: "temp_decrease" },
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
      { type: "custom", value: 0.25, radius: -1, customId: "security" },
    ],
    powerConsumption: 2,
    requiresActivation: false,
    automationInterval: 0,
  },
];
