import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Service, ServiceLocator } from "../core/ServiceLocator";

describe("ServiceLocator", () => {
  beforeEach(() => {
    ServiceLocator.resetInstance();
  });

  describe("registration", () => {
    it("should register a service", () => {
      const locator = ServiceLocator.getInstance();
      const mockService: Service = {};

      locator.register({
        name: "test",
        factory: () => mockService,
        phase: "core",
      });

      const info = locator.getDebugInfo();
      expect(info).toHaveLength(1);
      expect(info[0].name).toBe("test");
      expect(info[0].phase).toBe("core");
      expect(info[0].initialized).toBe(false);
    });

    it("should warn on duplicate registration", () => {
      const locator = ServiceLocator.getInstance();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      locator.register({ name: "dup", factory: () => ({}), phase: "core" });
      locator.register({ name: "dup", factory: () => ({}), phase: "core" });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already registered"));
      warnSpy.mockRestore();
    });
  });

  describe("initialization", () => {
    it("should initialize services in phase order", async () => {
      const locator = ServiceLocator.getInstance();
      const initOrder: string[] = [];

      const createService = (name: string): Service => ({
        init: () => {
          initOrder.push(name);
        },
      });

      locator.register({ name: "core1", factory: () => createService("core1"), phase: "core" });
      locator.register({ name: "scene1", factory: () => createService("scene1"), phase: "scene" });
      locator.register({ name: "core2", factory: () => createService("core2"), phase: "core" });

      await locator.initCore();
      expect(initOrder).toEqual(["core1", "core2"]);

      await locator.initScene({} as unknown as import("@babylonjs/core/scene").Scene);
      expect(initOrder).toEqual(["core1", "core2", "scene1"]);
    });

    it("should respect dependencies within phase", async () => {
      const locator = ServiceLocator.getInstance();
      const initOrder: string[] = [];

      const createService = (name: string): Service => ({
        init: () => {
          initOrder.push(name);
        },
      });

      // Register B first but it depends on A
      locator.register({
        name: "serviceB",
        factory: () => createService("B"),
        phase: "core",
        dependencies: ["serviceA"],
      });
      locator.register({
        name: "serviceA",
        factory: () => createService("A"),
        phase: "core",
      });

      await locator.initCore();

      // A should be initialized before B
      expect(initOrder).toEqual(["A", "B"]);
    });

    it("should detect circular dependencies", async () => {
      const locator = ServiceLocator.getInstance();

      locator.register({
        name: "A",
        factory: () => ({}),
        phase: "core",
        dependencies: ["B"],
      });
      locator.register({
        name: "B",
        factory: () => ({}),
        phase: "core",
        dependencies: ["A"],
      });

      await expect(locator.initCore()).rejects.toThrow("Circular dependency");
    });

    it("should pass args to init function", async () => {
      const locator = ServiceLocator.getInstance();
      const initSpy = vi.fn();

      locator.register({
        name: "sceneService",
        factory: () => ({ init: initSpy }),
        phase: "scene",
      });

      const mockScene = { name: "mockScene" };
      await locator.initScene(mockScene as unknown as import("@babylonjs/core/scene").Scene);

      expect(initSpy).toHaveBeenCalledWith(mockScene);
    });
  });

  describe("get/has", () => {
    it("should get initialized service", async () => {
      const locator = ServiceLocator.getInstance();
      const mockService = { value: 42 } as Service;

      locator.register({ name: "test", factory: () => mockService, phase: "core" });
      await locator.initCore();

      const retrieved = ServiceLocator.get<typeof mockService>("test");
      expect(retrieved).toBe(mockService);
    });

    it("should throw on missing service", () => {
      expect(() => ServiceLocator.get("nonexistent")).toThrow("not found");
    });

    it("should return undefined for tryGet on missing service", () => {
      const result = ServiceLocator.tryGet("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should report has correctly", async () => {
      const locator = ServiceLocator.getInstance();
      locator.register({ name: "test", factory: () => ({}), phase: "core" });

      expect(ServiceLocator.has("test")).toBe(false);

      await locator.initCore();

      expect(ServiceLocator.has("test")).toBe(true);
      expect(ServiceLocator.has("nonexistent")).toBe(false);
    });
  });

  describe("dispose", () => {
    it("should dispose services in reverse init order", async () => {
      const locator = ServiceLocator.getInstance();
      const disposeOrder: string[] = [];

      const createService = (name: string): Service => ({
        init: () => {},
        dispose: () => {
          disposeOrder.push(name);
        },
      });

      locator.register({ name: "A", factory: () => createService("A"), phase: "core" });
      locator.register({ name: "B", factory: () => createService("B"), phase: "core", dependencies: ["A"] });
      locator.register({ name: "C", factory: () => createService("C"), phase: "core", dependencies: ["B"] });

      await locator.initCore();
      locator.dispose();

      // Should dispose in reverse: C, B, A
      expect(disposeOrder).toEqual(["C", "B", "A"]);
    });

    it("should clear services after dispose", async () => {
      const locator = ServiceLocator.getInstance();
      locator.register({ name: "test", factory: () => ({}), phase: "core" });
      await locator.initCore();

      locator.dispose();

      expect(ServiceLocator.has("test")).toBe(false);
    });
  });

  describe("manual set", () => {
    it("should allow manually setting a service", () => {
      const locator = ServiceLocator.getInstance();
      const mockService = { custom: true } as Service;

      locator.set("custom", mockService);

      const retrieved = ServiceLocator.get<typeof mockService>("custom");
      expect(retrieved).toBe(mockService);
      expect(ServiceLocator.has("custom")).toBe(true);
    });
  });
});
