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
import { GameTimer } from "../GameTimer";
import { PlantSystem, type StrainDefinition } from "../PlantSystem";

const TEST_STRAINS: StrainDefinition[] = [
  {
    id: "strain_basic",
    name: "Basic Strain",
    growthTime: 60000, // 1 minute total
    stages: 4,
    waterConsumption: 10, // 10% per minute
    baseYield: 5,
    xpReward: 50,
    seedId: "seed_basic",
    harvestId: "harvest_basic",
    unlockLevel: 1,
  },
  {
    id: "strain_premium",
    name: "Premium Strain",
    growthTime: 120000, // 2 minutes
    stages: 5,
    waterConsumption: 15,
    baseYield: 10,
    xpReward: 100,
    seedId: "seed_premium",
    harvestId: "harvest_premium",
    unlockLevel: 5,
  },
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
    
    // Give player some seeds
    gameState.addItem("seed_basic", "seed", 10);
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
});
