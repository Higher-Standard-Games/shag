/**
 * PlantSystem Tests
 */

import { describe, it, expect, beforeAll } from "vitest";

// Mock localStorage, window, and performance for Node environment
const storage: Record<string, string> = {};

globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
  length: 0,
  key: () => null,
};

globalThis.window = {
  setInterval: (() => 1) as any,
  clearInterval: (() => {}) as any,
} as any;

// Mock performance.now()
let mockTime = 0;
globalThis.performance = {
  now: () => mockTime,
} as any;

import { GameState } from "../GameState";
import { GameTimer } from "../../engine/core/GameTimer";
import { PlantSystem, type StrainDefinition } from "../PlantSystem";

import type { PotDefinition, LightingLevel } from "../PlantSystem";

const TEST_STRAINS: StrainDefinition[] = [
  {
    id: "strain_basic",
    name: "Basic Strain",
    growthTime: 60000, // 1 minute total
    stages: 4,
    waterConsumption: 10, // 10% per minute
    baseYield: 100, // 100g
    valuePerGram: 5, // $5/gram
    xpReward: 50,
    seedId: "seed_basic",
    harvestId: "fresh_basic",
    curedId: "cured_basic",
    unlockLevel: 1,
    // Hempire-style settings
    preferredTempMin: 68,
    preferredTempMax: 78,
    waterPromptInterval: 10000, // Every 10 seconds for testing
    waterPromptWindow: 5000, // 5 second window
  },
  {
    id: "strain_premium",
    name: "Premium Strain",
    growthTime: 120000, // 2 minutes
    stages: 5,
    waterConsumption: 15,
    baseYield: 200, // 200g
    valuePerGram: 10, // $10/gram
    xpReward: 100,
    seedId: "seed_premium",
    harvestId: "fresh_premium",
    curedId: "cured_premium",
    unlockLevel: 5,
    preferredTempMin: 70,
    preferredTempMax: 75,
    waterPromptInterval: 15000,
    waterPromptWindow: 4000,
  },
];

const TEST_POTS: PotDefinition[] = [
  {
    id: "basic",
    name: "Basic Pot",
    size: "medium",
    growthSpeedMultiplier: 1.0,
    yieldMultiplier: 1.0,
    cost: 0,
    unlockLevel: 1,
    description: "Standard pot",
  },
  {
    id: "magic",
    name: "Magic Pot",
    size: "medium",
    growthSpeedMultiplier: 0.5, // 2x faster
    yieldMultiplier: 1.2,
    cost: 1000,
    unlockLevel: 5,
    description: "Grows plants twice as fast",
  },
];

const TEST_LIGHTING: LightingLevel[] = [
  { level: 1, name: "Basic", intensity: "low", yieldBonus: 0, growthSpeedBonus: 0, cost: 0, unlockLevel: 1 },
  { level: 2, name: "LED", intensity: "medium", yieldBonus: 0.2, growthSpeedBonus: 0.1, cost: 500, unlockLevel: 3 },
];

describe("PlantSystem", () => {
  let plantSystem: PlantSystem;
  let gameState: GameState;

  beforeAll(() => {
    mockTime = 0;
    GameState.resetInstance();
    GameTimer.resetInstance();
    PlantSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    gameState = GameState.getInstance();
    GameTimer.getInstance(); // Initialize timer
    plantSystem = PlantSystem.getInstance();
    plantSystem.registerStrains(TEST_STRAINS);
    plantSystem.registerPots(TEST_POTS);
    plantSystem.registerLightingLevels(TEST_LIGHTING);
    
    // Give player plenty of seeds and fertilizer for all tests
    gameState.addItem("seed_basic", "seed", 50);
    gameState.addItem("fertilizer", "consumable", 10);
  });

  describe("Strain Registration", () => {
    it("should register strains", () => {
      const strain = plantSystem.getStrain("strain_basic");
      expect(strain).toBeDefined();
      expect(strain?.name).toBe("Basic Strain");
    });

    it("should get all strains", () => {
      const all = plantSystem.getAllStrains();
      expect(all.length).toBe(2);
    });

    it("should get unlocked strains based on level", () => {
      const unlocked = plantSystem.getUnlockedStrains();
      expect(unlocked.some(s => s.id === "strain_basic")).toBe(true);
      expect(unlocked.some(s => s.id === "strain_premium")).toBe(false);
    });
  });

  describe("Planting", () => {
    it("should plant a seed", () => {
      const initialSeeds = gameState.getItemCount("seed_basic");
      
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 10, y: 0, z: 10 },
        "test_map"
      );
      
      expect(plant).not.toBeNull();
      expect(plant?.strain).toBe("strain_basic");
      expect(plant?.growthStage).toBe(0);
      expect(plant?.waterLevel).toBe(100);
      
      // Seed should be consumed
      const newSeeds = gameState.getItemCount("seed_basic");
      expect(newSeeds).toBe(initialSeeds - 1);
    });

    it("should not plant without seeds", () => {
      const plant = plantSystem.plantSeed(
        "strain_premium", // No premium seeds
        { x: 20, y: 0, z: 20 },
        "test_map"
      );
      
      expect(plant).toBeNull();
    });
  });

  describe("Watering", () => {
    it("should water a plant", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 30, y: 0, z: 30 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      // Manually reduce water level
      gameState.updatePlant(plant.id, { waterLevel: 50 });
      
      const watered = plantSystem.waterPlant(plant.id);
      expect(watered).toBe(true);
      
      const updated = gameState.getPlant(plant.id);
      expect(updated?.waterLevel).toBe(100);
    });

    it("should not water fully watered plant", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 40, y: 0, z: 40 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      // Plant starts at 100% water
      const watered = plantSystem.waterPlant(plant.id);
      expect(watered).toBe(false);
    });
  });

  describe("Visual State", () => {
    it("should get visual state", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 50, y: 0, z: 50 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      const visual = plantSystem.getVisualState(plant.id);
      expect(visual).not.toBeNull();
      expect(visual?.stage).toBe(0);
      expect(visual?.needsWater).toBe(false);
      expect(visual?.isDead).toBe(false);
      expect(visual?.isHarvestable).toBe(false);
    });
  });

  describe("Time Calculations", () => {
    it("should calculate time to next stage", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 60, y: 0, z: 60 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      const timeToNext = plantSystem.getTimeToNextStage(plant.id);
      // Basic strain: 60000ms / 4 stages = 15000ms per stage
      expect(timeToNext).toBeGreaterThan(0);
      expect(timeToNext).toBeLessThanOrEqual(15000);
    });

    it("should calculate time to harvest", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 70, y: 0, z: 70 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      const timeToHarvest = plantSystem.getTimeToHarvest(plant.id);
      // Should be close to full growth time for new plant
      expect(timeToHarvest).toBeGreaterThan(0);
    });
  });

  // ==================== Hempire-Style Mechanics ====================

  describe("Pot System", () => {
    it("should register pots", () => {
      const pot = plantSystem.getPot("basic");
      expect(pot).toBeDefined();
      expect(pot?.name).toBe("Basic Pot");
      expect(pot?.growthSpeedMultiplier).toBe(1.0);
    });

    it("should get all pots", () => {
      const pots = plantSystem.getAllPots();
      expect(pots.length).toBe(2);
    });

    it("should plant with specific pot type", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 80, y: 0, z: 80 },
        "test_map",
        "magic" // Use magic pot
      );
      
      expect(plant).not.toBeNull();
      expect(plant?.potType).toBe("magic");
    });
  });

  describe("Temperature Control", () => {
    it("should set temperature", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 90, y: 0, z: 90 },
        "test_map",
        "basic",
        72 // Initial temp
      );
      
      if (!plant) throw new Error("Plant not created");
      
      expect(plant.temperature).toBe(72);
      
      plantSystem.setTemperature(plant.id, 75);
      const updated = gameState.getPlant(plant.id);
      expect(updated?.temperature).toBe(75);
    });

    it("should check if temperature is optimal", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 100, y: 0, z: 100 },
        "test_map",
        "basic",
        73 // Within 68-78 range
      );
      
      if (!plant) throw new Error("Plant not created");
      
      expect(plantSystem.isTemperatureOptimal(plant.id)).toBe(true);
      
      // Set outside range
      plantSystem.setTemperature(plant.id, 60);
      expect(plantSystem.isTemperatureOptimal(plant.id)).toBe(false);
    });

    it("should get temperature status", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 110, y: 0, z: 110 },
        "test_map",
        "basic",
        70
      );
      
      if (!plant) throw new Error("Plant not created");
      
      const status = plantSystem.getTemperatureStatus(plant.id);
      expect(status).not.toBeNull();
      expect(status?.current).toBe(70);
      expect(status?.min).toBe(68);
      expect(status?.max).toBe(78);
      expect(status?.isOptimal).toBe(true);
    });
  });

  describe("Water Prompts", () => {
    it("should track water prompt status", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 120, y: 0, z: 120 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      const status = plantSystem.getWaterPromptStatus(plant.id);
      expect(status).not.toBeNull();
      expect(status?.streak).toBe(0);
      expect(status?.hitRate).toBe(1); // No prompts yet = 100% rate
    });

    it("should respond to water prompt when active", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 130, y: 0, z: 130 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      // The first water prompt is at nextWaterPrompt (plantedAt + interval)
      // We need to manually update the plant to simulate time passing
      // Set the nextWaterPrompt to a time in the past so we're "in the window"
      const currentGameTime = GameTimer.getInstance().getGameTime();
      gameState.updatePlant(plant.id, {
        nextWaterPrompt: currentGameTime - 1000, // Started 1 second ago
      });
      
      const responded = plantSystem.respondToWaterPrompt(plant.id);
      expect(responded).toBe(true);
      
      const updated = gameState.getPlant(plant.id);
      expect(updated?.waterPromptsHit).toBe(1);
      expect(updated?.wateringStreak).toBe(1);
    });
  });

  describe("Lighting System", () => {
    it("should get lighting level", () => {
      const level = plantSystem.getLightingLevel();
      expect(level).toBe(1); // Starts at level 1
    });

    it("should get lighting bonus", () => {
      const bonus = plantSystem.getLightingBonus();
      expect(bonus).toBe(0); // Level 1 has no bonus
    });
  });

  describe("Mastery System", () => {
    it("should track mastery for strains", () => {
      const mastery = plantSystem.getMastery("strain_basic");
      expect(mastery).toBeDefined();
      expect(mastery.strainId).toBe("strain_basic");
      expect(mastery.level).toBe(0);
      expect(mastery.perfectGrows).toBe(0);
    });

    it("should get all mastery data", () => {
      const allMastery = plantSystem.getAllMastery();
      expect(Array.isArray(allMastery)).toBe(true);
    });
  });

  describe("Fertilizer", () => {
    it("should apply fertilizer for instant growth", () => {
      const plant = plantSystem.plantSeed(
        "strain_basic",
        { x: 140, y: 0, z: 140 },
        "test_map"
      );
      
      if (!plant) throw new Error("Plant not created");
      
      // Plant should start at stage 0
      expect(plant.growthStage).toBe(0);
      
      const applied = plantSystem.applyFertilizer(plant.id, 'basic');
      expect(applied).toBe(true);
      
      const updated = gameState.getPlant(plant.id);
      // Should be at final stage (stages - 1 = 3)
      expect(updated?.growthStage).toBe(3);
      expect(updated?.fertilized).toBe(true);
      // Should have perfect water bonus
      expect(updated?.waterPromptsMissed).toBe(0);
    });
  });
});
