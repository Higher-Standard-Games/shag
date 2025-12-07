/**
 * GeneticsSystem Tests
 */

import { describe, it, expect, beforeAll } from "vitest";

// Mock localStorage and window for Node environment
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

import { GameState } from "../GameState";
import { GeneticsSystem, type StrainGenetics } from "../GeneticsSystem";

const TEST_STRAINS: StrainGenetics[] = [
  // Landrace 1 - Indica
  {
    id: "test_indica_landrace",
    name: "Test Indica",
    description: "A test indica landrace",
    type: "indica",
    indicaPercent: 100,
    thcContent: 15,
    cbdContent: 5,
    effects: { relaxed: 80, sleepy: 70, happy: 50 },
    negativeEffects: { dry_mouth: 30 },
    flavors: { earthy: 80, woody: 60 },
    terpenes: { myrcene: 70, caryophyllene: 40 },
    growthTraits: {
      floweringTime: 55,
      yieldPotential: 70,
      heightPotential: 40,
      difficulty: 30,
      moldResistance: 70,
      pestResistance: 65,
      droughtTolerance: 80,
    },
    appearance: { budDensity: 85, trichomeCoverage: 70, purpleExpression: 20, orangeHairs: 50 },
    lineage: { generation: 0, isStabilized: true, originRegion: "Test Region" },
    rarity: "common",
    basePrice: 8,
    isLandrace: true,
    tier: 1,
    specialTraits: [],
    unlockLevel: 1,
  },
  // Landrace 2 - Sativa
  {
    id: "test_sativa_landrace",
    name: "Test Sativa",
    description: "A test sativa landrace",
    type: "sativa",
    indicaPercent: 0,
    thcContent: 18,
    cbdContent: 1,
    effects: { energetic: 85, creative: 80, uplifted: 75 },
    negativeEffects: { anxious: 25 },
    flavors: { citrus: 75, sweet: 60 },
    terpenes: { limonene: 65, pinene: 45 },
    growthTraits: {
      floweringTime: 70,
      yieldPotential: 60,
      heightPotential: 90,
      difficulty: 50,
      moldResistance: 55,
      pestResistance: 50,
      droughtTolerance: 65,
    },
    appearance: { budDensity: 50, trichomeCoverage: 75, purpleExpression: 0, orangeHairs: 70 },
    lineage: { generation: 0, isStabilized: true, originRegion: "Test Region 2" },
    rarity: "uncommon",
    basePrice: 10,
    isLandrace: true,
    tier: 1,
    specialTraits: [],
    unlockLevel: 1,
  },
  // Hybrid (child of above)
  {
    id: "test_hybrid",
    name: "Test Hybrid",
    description: "A test hybrid",
    type: "hybrid",
    indicaPercent: 50,
    thcContent: 20,
    cbdContent: 2,
    effects: { relaxed: 70, creative: 65, happy: 60 },
    negativeEffects: { dry_mouth: 20 },
    flavors: { earthy: 60, citrus: 55 },
    terpenes: { myrcene: 50, limonene: 45 },
    growthTraits: {
      floweringTime: 60,
      yieldPotential: 70,
      heightPotential: 60,
      difficulty: 40,
      moldResistance: 65,
      pestResistance: 60,
      droughtTolerance: 70,
    },
    appearance: { budDensity: 70, trichomeCoverage: 75, purpleExpression: 10, orangeHairs: 60 },
    lineage: { 
      parent1Id: "test_indica_landrace",
      parent2Id: "test_sativa_landrace",
      generation: 1, 
      isStabilized: true 
    },
    rarity: "uncommon",
    basePrice: 12,
    isLandrace: false,
    tier: 2,
    specialTraits: [],
    unlockLevel: 2,
  },
];

describe("GeneticsSystem", () => {
  let genetics: GeneticsSystem;

  beforeAll(() => {
    GameState.resetInstance();
    GeneticsSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    GameState.getInstance();
    genetics = GeneticsSystem.getInstance();
    genetics.registerStrains(TEST_STRAINS);
  });

  describe("Registration", () => {
    it("should register strains", () => {
      const strain = genetics.getStrain("test_indica_landrace");
      expect(strain).toBeDefined();
      expect(strain?.name).toBe("Test Indica");
    });

    it("should get all strains", () => {
      const all = genetics.getAllStrains();
      expect(all.length).toBe(3);
    });

    it("should get strains by type", () => {
      const indicas = genetics.getStrainsByType("indica");
      expect(indicas.length).toBe(1);
      expect(indicas[0].id).toBe("test_indica_landrace");
    });

    it("should get landrace strains", () => {
      const landraces = genetics.getLandraceStrains();
      expect(landraces.length).toBe(2);
    });
  });

  describe("Trait Analysis", () => {
    it("should get dominant effects", () => {
      const effects = genetics.getDominantEffects("test_indica_landrace");
      expect(effects.length).toBe(3);
      expect(effects[0].effect).toBe("relaxed");
      expect(effects[0].intensity).toBe(80);
    });

    it("should get dominant flavors", () => {
      const flavors = genetics.getDominantFlavors("test_indica_landrace");
      expect(flavors.length).toBe(2);
      expect(flavors[0].flavor).toBe("earthy");
    });

    it("should get dominant terpenes", () => {
      const terpenes = genetics.getDominantTerpenes("test_indica_landrace");
      expect(terpenes.length).toBe(2);
      expect(terpenes[0].terpene).toBe("myrcene");
    });

    it("should calculate quality score", () => {
      const score = genetics.calculateQualityScore("test_indica_landrace");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("Breeding", () => {
    it("should check breeding compatibility", () => {
      const pair = genetics.getBreedingCompatibility(
        "test_indica_landrace",
        "test_sativa_landrace"
      );
      
      expect(pair).not.toBeNull();
      expect(pair?.compatibility).toBeGreaterThan(0);
      expect(pair?.predictedTraits.type).toBe("hybrid");
    });

    it("should breed two strains", () => {
      const result = genetics.breed(
        "test_indica_landrace",
        "test_sativa_landrace",
        { seedCount: 5 }
      );
      
      expect(result.success).toBe(true);
      expect(result.seeds.length).toBe(5);
      expect(result.message).toContain("5 seeds");
    });

    it("should create new strain when breeding", () => {
      const result = genetics.breed(
        "test_indica_landrace",
        "test_sativa_landrace",
        { 
          createNewStrain: true,
          newStrainName: "Custom Test Strain"
        }
      );
      
      expect(result.success).toBe(true);
      expect(result.childStrainId).toBeDefined();
      
      // Verify new strain exists
      const newStrain = genetics.getStrain(result.childStrainId!);
      expect(newStrain).toBeDefined();
      expect(newStrain?.name).toBe("Custom Test Strain");
      expect(newStrain?.lineage.parent1Id).toBe("test_indica_landrace");
      expect(newStrain?.lineage.parent2Id).toBe("test_sativa_landrace");
    });

    it("should generate seeds with phenotype variation", () => {
      const result = genetics.breed(
        "test_indica_landrace",
        "test_sativa_landrace"
      );
      
      expect(result.seeds.length).toBeGreaterThan(0);
      
      const seed = result.seeds[0];
      expect(seed.phenotypeVariation).toBeGreaterThanOrEqual(0);
      expect(seed.phenotypeVariation).toBeLessThanOrEqual(1);
      expect(seed.viability).toBeGreaterThanOrEqual(70);
    });
  });

  describe("Family Tree", () => {
    it("should get family tree", () => {
      const tree = genetics.getFamilyTree("test_hybrid");
      
      expect(tree.length).toBe(3); // Self + 2 parents
      expect(tree.some(s => s.id === "test_hybrid")).toBe(true);
      expect(tree.some(s => s.id === "test_indica_landrace")).toBe(true);
      expect(tree.some(s => s.id === "test_sativa_landrace")).toBe(true);
    });

    it("should get children of a strain", () => {
      const children = genetics.getChildren("test_indica_landrace");
      expect(children.some(s => s.id === "test_hybrid")).toBe(true);
    });

    it("should check shared ancestry", () => {
      // Create a child strain first
      genetics.breed(
        "test_indica_landrace",
        "test_sativa_landrace",
        { createNewStrain: true, newStrainName: "Ancestry Test" }
      );
      
      // The hybrid and any new strain from same parents share ancestry
      const shares = genetics.shareAncestry("test_hybrid", "test_indica_landrace");
      expect(shares).toBe(true);
    });
  });

  describe("Custom Strains", () => {
    it("should track custom strains separately", () => {
      genetics.breed(
        "test_indica_landrace",
        "test_sativa_landrace",
        { createNewStrain: true, newStrainName: "Player Strain" }
      );
      
      const custom = genetics.getCustomStrains();
      expect(custom.length).toBeGreaterThan(0);
      expect(custom.some(s => s.name === "Player Strain")).toBe(true);
    });

    it("should serialize custom strains", () => {
      const data = genetics.getCustomStrainsData();
      expect(data.length).toBeGreaterThan(0);
    });
  });
});
