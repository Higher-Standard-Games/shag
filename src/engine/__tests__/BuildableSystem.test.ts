/**
 * BuildableSystem Tests
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BuildableSystem,
  type BuildableTemplate,
  createCustomStages,
  createInstantStage,
  createStages3,
  createStages5,
} from "../BuildableSystem";

describe("BuildableSystem", () => {
  let system: BuildableSystem;
  let mockTime: number;

  beforeEach(() => {
    // Reset singleton for each test
    // @ts-expect-error - accessing private static for testing
    BuildableSystem.instance = undefined;
    system = BuildableSystem.getInstance();

    // Mock time provider
    mockTime = 0;
    system.setTimeProvider(() => mockTime);
  });

  // ==================== Helper Functions ====================

  describe("Stage Helpers", () => {
    it("createStages3 creates 3 stages at 0, 50, 100", () => {
      const stages = createStages3("prefabs/building");
      expect(stages).toHaveLength(3);
      expect(stages[0]).toEqual({ minProgress: 0, maxProgress: 49, prefab: "prefabs/building_0.map", scale: 1 });
      expect(stages[1]).toEqual({ minProgress: 50, maxProgress: 99, prefab: "prefabs/building_50.map", scale: 1 });
      expect(stages[2]).toEqual({ minProgress: 100, maxProgress: 100, prefab: "prefabs/building_100.map", scale: 1 });
    });

    it("createStages5 creates 5 stages", () => {
      const stages = createStages5("prefabs/crop", 0.5);
      expect(stages).toHaveLength(5);
      expect(stages[0].prefab).toBe("prefabs/crop_0.map");
      expect(stages[2].prefab).toBe("prefabs/crop_50.map");
      expect(stages[4].prefab).toBe("prefabs/crop_100.map");
      expect(stages[0].scale).toBe(0.5);
    });

    it("createInstantStage creates single stage", () => {
      const stages = createInstantStage("prefabs/item.map");
      expect(stages).toHaveLength(1);
      expect(stages[0]).toEqual({ minProgress: 0, maxProgress: 100, prefab: "prefabs/item.map", scale: 1 });
    });

    it("createCustomStages creates stages at custom thresholds", () => {
      const stages = createCustomStages("prefabs/tree", [0, 25, 75, 100]);
      expect(stages).toHaveLength(4);
      expect(stages[0].minProgress).toBe(0);
      expect(stages[0].maxProgress).toBe(24);
      expect(stages[1].minProgress).toBe(25);
      expect(stages[1].maxProgress).toBe(74);
    });
  });

  // ==================== Template Registration ====================

  describe("Templates", () => {
    it("should register and retrieve templates", () => {
      const template: BuildableTemplate = {
        id: "test_building",
        name: "Test Building",
        buildTime: 10000,
        stages: createStages3("prefabs/test"),
      };

      system.registerTemplate(template);

      const retrieved = system.getTemplate("test_building");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Building");
    });

    it("should register multiple templates", () => {
      system.registerTemplates([
        { id: "a", name: "A", buildTime: 1000, stages: [] },
        { id: "b", name: "B", buildTime: 2000, stages: [] },
      ]);

      expect(system.getAllTemplates()).toHaveLength(2);
    });

    it("should filter templates by category", () => {
      system.registerTemplates([
        { id: "farm1", name: "Farm 1", buildTime: 1000, stages: [], category: "farms" },
        { id: "farm2", name: "Farm 2", buildTime: 1000, stages: [], category: "farms" },
        { id: "house", name: "House", buildTime: 1000, stages: [], category: "buildings" },
      ]);

      const farms = system.getTemplatesByCategory("farms");
      expect(farms).toHaveLength(2);
    });
  });

  // ==================== Instance Creation ====================

  describe("Instance Creation", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "wheat_farm",
        name: "Wheat Farm",
        buildTime: 10000,
        stages: createStages3("prefabs/wheat"),
      });
    });

    it("should create instance with correct initial state", () => {
      const instance = system.create("wheat_farm", { x: 10, y: 0, z: 20 }, "map1");

      expect(instance).not.toBeNull();
      expect(instance?.templateId).toBe("wheat_farm");
      expect(instance?.mapId).toBe("map1");
      expect(instance?.position).toEqual({ x: 10, y: 0, z: 20 });
      expect(instance?.progress).toBe(0);
      expect(instance?.isComplete).toBe(false);
      expect(instance?.health).toBe(100);
    });

    it("should create instant-build instance as complete", () => {
      system.registerTemplate({
        id: "instant_item",
        name: "Instant Item",
        buildTime: 0,
        stages: createInstantStage("prefabs/item.map"),
      });

      const instance = system.create("instant_item", { x: 0, y: 0, z: 0 }, "map1");

      expect(instance?.progress).toBe(100);
      expect(instance?.isComplete).toBe(true);
    });

    it("should return null for unknown template", () => {
      const instance = system.create("unknown_template", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance).toBeNull();
    });

    it("should emit created event", () => {
      const callback = vi.fn();
      system.on(callback);

      system.create("wheat_farm", { x: 0, y: 0, z: 0 }, "map1");

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "created",
          templateId: "wheat_farm",
        }),
      );
    });
  });

  // ==================== Build Progress ====================

  describe("Build Progress", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "slow_build",
        name: "Slow Build",
        buildTime: 10000, // 10 seconds
        stages: createStages3("prefabs/slow"),
      });
    });

    it("should update progress over time", () => {
      const instance = system.create("slow_build", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance?.progress).toBe(0);

      // Advance time 50%
      mockTime = 5000;
      system.update();

      const updated = system.getInstance(instance!.id);
      expect(updated?.progress).toBe(50);
    });

    it("should complete at 100%", () => {
      const instance = system.create("slow_build", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 10000;
      system.update();

      const updated = system.getInstance(instance!.id);
      expect(updated?.progress).toBe(100);
      expect(updated?.isComplete).toBe(true);
    });

    it("should emit complete event", () => {
      const callback = vi.fn();
      system.on(callback);

      system.create("slow_build", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 10000;
      system.update();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "complete",
        }),
      );
    });

    it("should change stages during build", () => {
      const callback = vi.fn();
      system.on(callback);

      system.create("slow_build", { x: 0, y: 0, z: 0 }, "map1");

      // At 50%, should trigger stage change
      mockTime = 5000;
      system.update();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "stage_change",
          data: expect.objectContaining({ newStage: 1 }),
        }),
      );
    });
  });

  // ==================== Consumer Behavior ====================

  describe("Consumer Behavior", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "water_plant",
        name: "Water Plant",
        buildTime: 0,
        stages: createInstantStage("prefabs/plant.map"),
        behaviors: {
          consumer: {
            resource: "water",
            ratePerMinute: 60, // 1 per second, 0.5 per 500ms update
            onEmpty: "pause",
          },
        },
      });
    });

    it("should initialize with full resource", () => {
      const instance = system.create("water_plant", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance?.resourceLevels?.water).toBe(100);
    });

    it("should drain resource over time", () => {
      const instance = system.create("water_plant", { x: 0, y: 0, z: 0 }, "map1");

      // Simulate multiple updates (60 per minute rate, 120 updates per minute)
      for (let i = 0; i < 10; i++) {
        system.update();
      }

      const updated = system.getInstance(instance!.id);
      expect(updated?.resourceLevels?.water).toBeLessThan(100);
    });

    it("should emit resource_low at 30%", () => {
      const instance = system.create("water_plant", { x: 0, y: 0, z: 0 }, "map1");

      // Subscribe AFTER create to avoid catching 'created' event
      const callback = vi.fn();
      system.on(callback);

      // Manually set to just above 30% and drain enough to cross threshold
      // Rate is 60/min = 0.5 per update, so set to 30.4 to cross 30 in one update
      instance!.resourceLevels!.water = 30.4;

      // One update should drop below 30%
      system.update();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "resource_low",
          data: expect.objectContaining({ resource: "water" }),
        }),
      );
    });

    it("should add resource via addResource", () => {
      const instance = system.create("water_plant", { x: 0, y: 0, z: 0 }, "map1");
      instance!.resourceLevels!.water = 50;

      system.addResource(instance!.id, "water", 30);

      expect(instance?.resourceLevels?.water).toBe(80);
    });

    it("should cap resource at 100", () => {
      const instance = system.create("water_plant", { x: 0, y: 0, z: 0 }, "map1");

      system.addResource(instance!.id, "water", 50);

      expect(instance?.resourceLevels?.water).toBe(100);
    });
  });

  // ==================== Decay Behavior ====================

  describe("Decay Behavior", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "crop",
        name: "Crop",
        buildTime: 0,
        stages: createInstantStage("prefabs/crop.map"),
        behaviors: {
          decay: {
            phases: ["growing", "ready", "overripe", "spoiled"],
            phaseDurations: [5000, 3000, 2000, Infinity],
            qualityPerPhase: [100, 100, 75, 25],
          },
        },
      });
    });

    it("should start in first phase", () => {
      const instance = system.create("crop", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance?.currentPhase).toBe("growing");
      expect(instance?.currentPhaseIndex).toBe(0);
    });

    it("should transition phases over time", () => {
      const instance = system.create("crop", { x: 0, y: 0, z: 0 }, "map1");

      // Advance past first phase (5000ms)
      mockTime = 5500;
      system.update();

      const updated = system.getInstance(instance!.id);
      expect(updated?.currentPhase).toBe("ready");
      expect(updated?.currentPhaseIndex).toBe(1);
    });

    it("should emit phase_change event", () => {
      const callback = vi.fn();
      system.on(callback);

      system.create("crop", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 5500;
      system.update();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "phase_change",
          data: expect.objectContaining({
            oldPhase: "growing",
            newPhase: "ready",
          }),
        }),
      );
    });

    it("should degrade quality per phase", () => {
      const instance = system.create("crop", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance?.quality).toBe(100);

      // Advance past first phase (growing: 5000ms)
      mockTime = 5500;
      system.update();

      // Now in 'ready' phase, quality should still be 100
      expect(system.getInstance(instance!.id)?.currentPhase).toBe("ready");

      // Advance past ready phase (3000ms more = 8500 total)
      mockTime = 8500;
      system.update();

      // Now in 'overripe' phase, quality should be 75
      const updated = system.getInstance(instance!.id);
      expect(updated?.currentPhase).toBe("overripe");
      expect(updated?.quality).toBe(75);
    });
  });

  // ==================== Producer Behavior ====================

  describe("Producer Behavior", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "mine",
        name: "Mine",
        buildTime: 0,
        stages: createInstantStage("prefabs/mine.map"),
        behaviors: {
          producer: {
            outputItem: "ore",
            amount: 5,
            interval: 1000,
            maxStored: 20,
          },
        },
      });
    });

    it("should start with zero stored", () => {
      const instance = system.create("mine", { x: 0, y: 0, z: 0 }, "map1");
      expect(instance?.storedProduction).toBe(0);
    });

    it("should produce over time", () => {
      const instance = system.create("mine", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 1500;
      system.update();

      const updated = system.getInstance(instance!.id);
      expect(updated?.storedProduction).toBe(5);
    });

    it("should emit production_ready event", () => {
      const callback = vi.fn();
      system.on(callback);

      system.create("mine", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 1500;
      system.update();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "production_ready",
          data: expect.objectContaining({
            item: "ore",
            amount: 5,
          }),
        }),
      );
    });

    it("should cap at maxStored", () => {
      const instance = system.create("mine", { x: 0, y: 0, z: 0 }, "map1");

      // Produce multiple times
      for (let i = 1; i <= 10; i++) {
        mockTime = i * 1500;
        system.update();
      }

      const updated = system.getInstance(instance!.id);
      expect(updated?.storedProduction).toBe(20); // Capped at maxStored
    });

    it("should collect production", () => {
      const instance = system.create("mine", { x: 0, y: 0, z: 0 }, "map1");
      instance!.storedProduction = 15;

      const result = system.collect(instance!.id);

      expect(result).toEqual({ item: "ore", amount: 15 });
      expect(instance?.storedProduction).toBe(0);
    });

    it("should emit collected event", () => {
      const callback = vi.fn();
      system.on(callback);

      const instance = system.create("mine", { x: 0, y: 0, z: 0 }, "map1");
      instance!.storedProduction = 10;

      system.collect(instance!.id);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "collected",
          data: expect.objectContaining({ amount: 10 }),
        }),
      );
    });
  });

  // ==================== Trigger Behavior ====================

  describe("Trigger Behavior", () => {
    it("should fire triggers via callback", () => {
      const triggerCallback = vi.fn();
      system.setTriggerCallback(triggerCallback);

      system.registerTemplate({
        id: "gate",
        name: "Gate",
        buildTime: 1000,
        stages: createInstantStage("prefabs/gate.map"),
        behaviors: {
          trigger: {
            onCreated: "gate_placed",
            onComplete: "gate_built",
          },
        },
      });

      system.create("gate", { x: 0, y: 0, z: 0 }, "map1");

      expect(triggerCallback).toHaveBeenCalledWith("gate_placed", expect.any(String));
    });

    it("should fire onComplete trigger", () => {
      const triggerCallback = vi.fn();
      system.setTriggerCallback(triggerCallback);

      system.registerTemplate({
        id: "door",
        name: "Door",
        buildTime: 1000,
        stages: createInstantStage("prefabs/door.map"),
        behaviors: {
          trigger: {
            onComplete: "door_ready",
          },
        },
      });

      system.create("door", { x: 0, y: 0, z: 0 }, "map1");

      mockTime = 1500;
      system.update();

      expect(triggerCallback).toHaveBeenCalledWith("door_ready", expect.any(String));
    });
  });

  // ==================== Serialization ====================

  describe("Serialization", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "test",
        name: "Test",
        buildTime: 0,
        stages: [],
      });
    });

    it("should serialize all instances", () => {
      system.create("test", { x: 1, y: 0, z: 1 }, "map1");
      system.create("test", { x: 2, y: 0, z: 2 }, "map1");

      const serialized = system.serialize();
      expect(serialized).toHaveLength(2);
    });

    it("should deserialize instances", () => {
      const instances = [
        {
          id: "saved_1",
          templateId: "test",
          mapId: "map1",
          position: { x: 5, y: 0, z: 5 },
          progress: 50,
          currentStage: 0,
          startedAt: 0,
          isComplete: false,
          health: 100,
        },
      ];

      system.deserialize(instances);

      expect(system.getAllInstances()).toHaveLength(1);
      expect(system.getInstance("saved_1")).toBeDefined();
    });

    it("should clear all instances", () => {
      system.create("test", { x: 0, y: 0, z: 0 }, "map1");
      system.create("test", { x: 1, y: 0, z: 1 }, "map1");

      system.clear();

      expect(system.getAllInstances()).toHaveLength(0);
    });

    it("should clear instances by map", () => {
      system.create("test", { x: 0, y: 0, z: 0 }, "map1");
      system.create("test", { x: 1, y: 0, z: 1 }, "map2");

      system.clearMap("map1");

      expect(system.getAllInstances()).toHaveLength(1);
      expect(system.getInstancesInMap("map2")).toHaveLength(1);
    });
  });

  // ==================== Instance Management ====================

  describe("Instance Management", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "item",
        name: "Item",
        buildTime: 0,
        stages: [],
      });
    });

    it("should get instances by map", () => {
      system.create("item", { x: 0, y: 0, z: 0 }, "map1");
      system.create("item", { x: 1, y: 0, z: 1 }, "map1");
      system.create("item", { x: 2, y: 0, z: 2 }, "map2");

      expect(system.getInstancesInMap("map1")).toHaveLength(2);
      expect(system.getInstancesInMap("map2")).toHaveLength(1);
    });

    it("should destroy instance", () => {
      const instance = system.create("item", { x: 0, y: 0, z: 0 }, "map1");

      const result = system.destroy(instance!.id);

      expect(result).toBe(true);
      expect(system.getInstance(instance!.id)).toBeUndefined();
    });

    it("should emit destroyed event", () => {
      const callback = vi.fn();
      system.on(callback);

      const instance = system.create("item", { x: 0, y: 0, z: 0 }, "map1");
      system.destroy(instance!.id);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "destroyed",
        }),
      );
    });
  });

  // ==================== Container/Child Behavior ====================

  describe("Container Behavior", () => {
    beforeEach(() => {
      // Container template (pot)
      system.registerTemplate({
        id: "pot",
        name: "Plant Pot",
        buildTime: 0,
        stages: createInstantStage("prefabs/pot.map"),
        behaviors: {
          container: {
            maxChildren: 1,
            allowedTemplates: ["plant"],
            syncVisualWithChildren: true,
          },
        },
      });

      // Child template (plant)
      system.registerTemplate({
        id: "plant",
        name: "Plant",
        buildTime: 60000,
        stages: createStages5("prefabs/plant"),
      });

      // Multi-child container
      system.registerTemplate({
        id: "garden_bed",
        name: "Garden Bed",
        buildTime: 0,
        stages: createInstantStage("prefabs/garden.map"),
        behaviors: {
          container: {
            maxChildren: 4,
          },
        },
      });
    });

    it("should initialize container with empty childIds", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      expect(pot?.childIds).toEqual([]);
    });

    it("should add child to container", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");

      const result = system.addChild(pot!.id, plant!.id);

      expect(result).toBe(true);
      expect(pot?.childIds).toContain(plant!.id);
      expect(plant?.parentId).toBe(pot!.id);
    });

    it("should emit child_added event", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");

      const callback = vi.fn();
      system.on(callback);

      system.addChild(pot!.id, plant!.id);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "child_added",
          data: expect.objectContaining({ childId: plant!.id }),
        }),
      );
    });

    it("should enforce maxChildren limit", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant1 = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      const plant2 = system.create("plant", { x: 1, y: 0, z: 1 }, "map1");

      system.addChild(pot!.id, plant1!.id);
      const result = system.addChild(pot!.id, plant2!.id);

      expect(result).toBe(false);
      expect(pot?.childIds).toHaveLength(1);
    });

    it("should allow multiple children up to maxChildren", () => {
      const garden = system.create("garden_bed", { x: 0, y: 0, z: 0 }, "map1");
      const plants = [
        system.create("plant", { x: 0, y: 0, z: 0 }, "map1"),
        system.create("plant", { x: 1, y: 0, z: 0 }, "map1"),
        system.create("plant", { x: 2, y: 0, z: 0 }, "map1"),
      ];

      for (const plant of plants) {
        system.addChild(garden!.id, plant!.id);
      }

      expect(garden?.childIds).toHaveLength(3);
    });

    it("should remove child from container", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");

      system.addChild(pot!.id, plant!.id);
      const result = system.removeChild(pot!.id, plant!.id);

      expect(result).toBe(true);
      expect(pot?.childIds).toHaveLength(0);
      expect(plant?.parentId).toBeUndefined();
    });

    it("should emit child_removed event", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      system.addChild(pot!.id, plant!.id);

      const callback = vi.fn();
      system.on(callback);

      system.removeChild(pot!.id, plant!.id);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "child_removed",
        }),
      );
    });

    it("should get children of container", () => {
      const garden = system.create("garden_bed", { x: 0, y: 0, z: 0 }, "map1");
      const plant1 = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      const plant2 = system.create("plant", { x: 1, y: 0, z: 1 }, "map1");

      system.addChild(garden!.id, plant1!.id);
      system.addChild(garden!.id, plant2!.id);

      const children = system.getChildren(garden!.id);
      expect(children).toHaveLength(2);
    });

    it("should check hasRoomForChild", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      expect(system.hasRoomForChild(pot!.id)).toBe(true);

      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      system.addChild(pot!.id, plant!.id);

      expect(system.hasRoomForChild(pot!.id)).toBe(false);
    });

    it("should sync child progress to parent", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      system.addChild(pot!.id, plant!.id);

      system.syncChildProgress(pot!.id, plant!.id, 50);

      expect(pot?.childProgress).toBe(50);
    });

    it("should emit child_progress event", () => {
      const pot = system.create("pot", { x: 0, y: 0, z: 0 }, "map1");
      const plant = system.create("plant", { x: 0, y: 0, z: 0 }, "map1");
      system.addChild(pot!.id, plant!.id);

      const callback = vi.fn();
      system.on(callback);

      system.syncChildProgress(pot!.id, plant!.id, 75);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "child_progress",
          data: expect.objectContaining({ progress: 75 }),
        }),
      );
    });
  });

  // ==================== Zone Support ====================

  describe("Zone Support", () => {
    beforeEach(() => {
      system.registerTemplate({
        id: "item",
        name: "Item",
        buildTime: 0,
        stages: [],
      });
    });

    it("should create instance with zoneId", () => {
      const instance = system.create("item", { x: 0, y: 0, z: 0 }, "map1", { zoneId: "zone_1" });
      expect(instance?.zoneId).toBe("zone_1");
    });

    it("should get instances by zone", () => {
      system.create("item", { x: 0, y: 0, z: 0 }, "map1", { zoneId: "zone_a" });
      system.create("item", { x: 1, y: 0, z: 1 }, "map1", { zoneId: "zone_a" });
      system.create("item", { x: 2, y: 0, z: 2 }, "map1", { zoneId: "zone_b" });

      expect(system.getInstancesInZone("zone_a")).toHaveLength(2);
      expect(system.getInstancesInZone("zone_b")).toHaveLength(1);
    });

    it("should get instances by template", () => {
      system.registerTemplate({ id: "other", name: "Other", buildTime: 0, stages: [] });

      system.create("item", { x: 0, y: 0, z: 0 }, "map1");
      system.create("item", { x: 1, y: 0, z: 1 }, "map1");
      system.create("other", { x: 2, y: 0, z: 2 }, "map1");

      expect(system.getInstancesByTemplate("item")).toHaveLength(2);
      expect(system.getInstancesByTemplate("other")).toHaveLength(1);
    });
  });
});
