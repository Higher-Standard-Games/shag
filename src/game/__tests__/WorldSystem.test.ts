/**
 * WorldSystem Tests
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

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
import { WorldSystem, type AreaTemplate, type LotTemplate } from "../WorldSystem";

const TEST_AREAS: AreaTemplate[] = [
  {
    id: "area_start",
    name: "Starting Area",
    description: "The beginning",
    icon: "🏠",
    mapFile: "maps/start.map",
    tier: "slums",
    portals: [
      {
        id: "to_mid",
        targetArea: "area_mid",
        targetPortal: "from_start",
        position: { x: 100, y: 0, z: 0 },
        size: { width: 10, height: 20 },
      },
    ],
    accessRequirements: [],
    areaBonuses: [],
    lotIds: ["lot_starter"],
  },
  {
    id: "area_mid",
    name: "Mid Area",
    description: "Requires level 3",
    icon: "🏘️",
    mapFile: "maps/mid.map",
    tier: "suburbs",
    portals: [
      {
        id: "from_start",
        targetArea: "area_start",
        targetPortal: "to_mid",
        position: { x: -100, y: 0, z: 0 },
        size: { width: 10, height: 20 },
      },
    ],
    accessRequirements: [{ type: "level", value: 3 }],
    accessDeniedMessage: "Need level 3",
    areaBonuses: [{ type: "growth_speed", value: 0.1 }],
    lotIds: ["lot_mid"],
  },
  {
    id: "area_paid",
    name: "Paid Area",
    description: "Requires entry fee",
    icon: "💰",
    mapFile: "maps/paid.map",
    tier: "downtown",
    portals: [],
    accessRequirements: [{ type: "money", value: 100 }],
    areaBonuses: [],
    lotIds: [],
  },
];

const TEST_LOTS: LotTemplate[] = [
  {
    id: "lot_starter",
    name: "Starter Lot",
    description: "Free starter",
    icon: "🏠",
    areaId: "area_start",
    position: { x: 0, y: 0, z: 0 },
    price: 0,
    requiredLevel: 1,
    size: "small",
    maxBuildZones: 4,
    maxPlantSlots: 4,
    bonuses: [],
    lotMapFile: "maps/lots/starter.map",
    tier: "basic",
  },
  {
    id: "lot_mid",
    name: "Mid Lot",
    description: "Costs money",
    icon: "🏘️",
    areaId: "area_mid",
    position: { x: 0, y: 0, z: 0 },
    price: 500,
    requiredLevel: 3,
    size: "medium",
    maxBuildZones: 8,
    maxPlantSlots: 8,
    bonuses: [{ type: "yield_bonus", value: 0.1 }],
    lotMapFile: "maps/lots/mid.map",
    tier: "standard",
  },
];

describe("WorldSystem", () => {
  let world: WorldSystem;
  let state: GameState;

  beforeAll(() => {
    GameState.resetInstance();
    WorldSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    state = GameState.getInstance();
    world = WorldSystem.getInstance();
    world.registerAreas(TEST_AREAS);
    world.registerLots(TEST_LOTS);
  });

  describe("Registration", () => {
    it("should register areas", () => {
      expect(world.getAllAreas()).toHaveLength(3);
      expect(world.getArea("area_start")).toBeDefined();
    });

    it("should register lots", () => {
      expect(world.getAllLots()).toHaveLength(2);
      expect(world.getLot("lot_starter")).toBeDefined();
    });

    it("should get lots in area", () => {
      const lots = world.getLotsInArea("area_start");
      expect(lots).toHaveLength(1);
      expect(lots[0].id).toBe("lot_starter");
    });
  });

  describe("Area Access", () => {
    it("should allow access to areas with no requirements", () => {
      const result = world.canAccessArea("area_start");
      expect(result.canAccess).toBe(true);
    });

    it("should deny access when level too low", () => {
      const result = world.canAccessArea("area_mid");
      expect(result.canAccess).toBe(false);
      expect(result.reason).toContain("level");
    });

    it("should allow access when level requirement met", () => {
      // Give player enough XP to reach level 3
      state.addXP(300);
      const result = world.canAccessArea("area_mid");
      expect(result.canAccess).toBe(true);
    });

    it("should check money requirement for entry", () => {
      const result = world.canAccessArea("area_paid");
      expect(result.canAccess).toBe(false);
      expect(result.reason).toContain("$100");
    });
  });

  describe("Area Navigation", () => {
    it("should enter accessible area", () => {
      const entered = world.enterArea("area_start");
      expect(entered).toBe(true);
      expect(world.getCurrentAreaId()).toBe("area_start");
    });

    it("should use portal to travel", () => {
      world.enterArea("area_start");
      const used = world.usePortal("to_mid");
      expect(used).toBe(true);
      expect(world.getCurrentAreaId()).toBe("area_mid");
    });
  });

  describe("Lot Ownership", () => {
    beforeEach(() => {
      // Reset to starting area
      state.setCustomData("currentArea", "area_start");
      state.setCustomData("ownedLots", []);
    });

    it("should not own lots initially", () => {
      expect(world.ownsLot("lot_starter")).toBe(false);
    });

    it("should purchase free lot", () => {
      const purchased = world.purchaseLot("lot_starter");
      expect(purchased).toBe(true);
      expect(world.ownsLot("lot_starter")).toBe(true);
    });

    it("should require being in area to purchase", () => {
      state.setCustomData("currentArea", "area_mid");
      const result = world.canPurchaseLot("lot_starter");
      expect(result.canPurchase).toBe(false);
      expect(result.reason).toContain("same area");
    });

    it("should require money for paid lots", () => {
      state.setCustomData("currentArea", "area_mid");
      const initialMoney = state.getPlayer().money;
      
      // Not enough money
      if (initialMoney < 500) {
        const result = world.canPurchaseLot("lot_mid");
        expect(result.canPurchase).toBe(false);
      }
      
      // Add money and try again
      state.addMoney(1000);
      const result = world.canPurchaseLot("lot_mid");
      expect(result.canPurchase).toBe(true);
    });
  });

  describe("Lot Navigation", () => {
    beforeEach(() => {
      state.setCustomData("currentArea", "area_start");
      state.setCustomData("ownedLots", [{ id: "lot_starter", purchasedAt: Date.now() }]);
      state.removeCustomData("currentLot");
    });

    it("should enter owned lot", () => {
      const entered = world.enterLot("lot_starter");
      expect(entered).toBe(true);
      expect(world.isInLot()).toBe(true);
      expect(world.getCurrentLotId()).toBe("lot_starter");
    });

    it("should not enter unowned lot", () => {
      const entered = world.enterLot("lot_mid");
      expect(entered).toBe(false);
    });

    it("should exit lot", () => {
      world.enterLot("lot_starter");
      const exited = world.exitLot();
      expect(exited).toBe(true);
      expect(world.isInLot()).toBe(false);
    });
  });

  describe("Bonuses", () => {
    it("should get area bonuses", () => {
      state.setCustomData("currentArea", "area_mid");
      const bonus = world.getActiveBonus("growth_speed");
      expect(bonus).toBe(0.1);
    });

    it("should stack area and lot bonuses", () => {
      state.setCustomData("currentArea", "area_mid");
      state.setCustomData("ownedLots", [{ id: "lot_mid", purchasedAt: Date.now() }]);
      state.setCustomData("currentLot", "lot_mid");
      
      const yieldBonus = world.getActiveBonus("yield_bonus");
      expect(yieldBonus).toBe(0.1); // From lot
      
      const growthBonus = world.getActiveBonus("growth_speed");
      expect(growthBonus).toBe(0.1); // From area
    });
  });
});
