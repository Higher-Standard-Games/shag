/**
 * World Data
 * 
 * Areas, lots, and world structure.
 */

import type { AreaTemplate, LotTemplate } from "../game/WorldSystem";

// ==================== World Areas ====================

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
    accessRequirements: [],
    areaBonuses: [],
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
      { type: "customer_rate", value: 0.1 },
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
      { type: "price_bonus", value: 0.15 },
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
      { type: "money", value: 1000 },
    ],
    accessDeniedMessage: "The guards want $1,000 to look the other way...",
    areaBonuses: [
      { type: "growth_speed", value: 0.2 },
      { type: "yield_bonus", value: 0.2 },
    ],
    lotIds: ["industrial_warehouse", "industrial_factory"],
  },
];

// ==================== World Lots ====================

export const WORLD_LOTS: LotTemplate[] = [
  // === SLUMS LOTS ===
  {
    id: "slums_garage",
    name: "Old Garage",
    description: "A cramped garage. It's not much, but it's yours.",
    icon: "🚗",
    areaId: "slums_street",
    position: { x: 20, y: 0, z: 30 },
    price: 0,
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
