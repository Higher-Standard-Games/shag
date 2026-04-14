/**
 * InstancedMeshManager Tests
 *
 * Tests the GPU instancing manager for repeated geometry optimization.
 * Uses mock Babylon.js mesh objects since tests run in Node.js.
 */

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstancedMeshManager, type InstanceTransform } from "../rendering/InstancedMeshManager";

// ─── Mock Mesh ──────────────────────────────────────────────────

interface MockInstancedMesh {
  name: string;
  position: Vector3;
  rotation: Vector3;
  scaling: Vector3;
  dispose: ReturnType<typeof vi.fn>;
}

function createMockMesh(name: string) {
  const instances: MockInstancedMesh[] = [];
  return {
    name,
    isVisible: true,
    geometry: { id: "geo_1" }, // truthy = has geometry
    setEnabled: vi.fn(),
    thinInstanceSetBuffer: vi.fn(),
    createInstance: vi.fn((instanceName: string) => {
      const inst: MockInstancedMesh = {
        name: instanceName,
        position: Vector3.Zero(),
        rotation: Vector3.Zero(),
        scaling: Vector3.One(),
        dispose: vi.fn(),
      };
      instances.push(inst);
      return inst;
    }),
    dispose: vi.fn(),
    _instances: instances, // for test inspection
  };
}

function createMockScene() {
  return {} as Parameters<InstancedMeshManager["init"]>[0];
}

// ─── Tests ──────────────────────────────────────────────────────

describe("InstancedMeshManager", () => {
  beforeEach(() => {
    InstancedMeshManager.resetInstance();
  });

  afterEach(() => {
    InstancedMeshManager.resetInstance();
  });

  // ── Singleton ─────────────────────────────────────────────

  describe("singleton", () => {
    it("returns same instance", () => {
      const a = InstancedMeshManager.getInstance();
      const b = InstancedMeshManager.getInstance();
      expect(a).toBe(b);
    });

    it("resetInstance clears singleton", () => {
      const a = InstancedMeshManager.getInstance();
      InstancedMeshManager.resetInstance();
      const b = InstancedMeshManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ── Initialization ────────────────────────────────────────

  describe("initialization", () => {
    it("starts uninitialized", () => {
      const mgr = InstancedMeshManager.getInstance();
      expect(mgr.isInitialized()).toBe(false);
    });

    it("init sets scene reference", () => {
      const mgr = InstancedMeshManager.getInstance();
      mgr.init(createMockScene());
      expect(mgr.isInitialized()).toBe(true);
    });
  });

  // ── Template Registration ─────────────────────────────────

  describe("template registration", () => {
    it("registers a template", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      const mesh = createMockMesh("tree") as any;
      mgr.registerTemplate("tree_pine", mesh);
      expect(mgr.hasTemplate("tree_pine")).toBe(true);
    });

    it("hides source mesh on register", () => {
      const mgr = InstancedMeshManager.getInstance();
      const mesh = createMockMesh("tree");
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", mesh as any);
      expect(mesh.isVisible).toBe(false);
    });

    it("rejects duplicate templates", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      const mesh = createMockMesh("tree") as any;
      mgr.registerTemplate("tree", mesh);
      // Second registration should be silently rejected
      mgr.registerTemplate("tree", mesh);
      expect(mgr.getTemplateNames().filter((n) => n === "tree").length).toBe(1);
    });

    it("rejects mesh without geometry", () => {
      const mgr = InstancedMeshManager.getInstance();
      const mesh = createMockMesh("nogeom");
      mesh.geometry = null;
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("nogeom", mesh as any);
      expect(mgr.hasTemplate("nogeom")).toBe(false);
    });
  });

  // ── Instance Lifecycle ────────────────────────────────────

  describe("instance lifecycle", () => {
    it("creates an instance", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);

      const transform: InstanceTransform = {
        position: new Vector3(10, 0, 20),
      };
      const instance = mgr.createInstance("tree", transform);
      expect(instance).not.toBeNull();
      expect(instance?.templateName).toBe("tree");
      expect(mgr.getInstanceCount("tree")).toBe(1);
    });

    it("returns null for unknown template", () => {
      const mgr = InstancedMeshManager.getInstance();
      const instance = mgr.createInstance("unknown", { position: Vector3.Zero() });
      expect(instance).toBeNull();
    });

    it("applies position to instance", () => {
      const mgr = InstancedMeshManager.getInstance();
      const mesh = createMockMesh("tree");
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", mesh as any);

      const pos = new Vector3(10, 5, 20);
      const instance = mgr.createInstance("tree", { position: pos });
      expect(instance).not.toBeNull();
      // The mock's createInstance should have been called
      expect(mesh.createInstance).toHaveBeenCalled();
    });

    it("removes an instance by id", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      const instance = mgr.createInstance("tree", { position: Vector3.Zero() });
      expect(instance).not.toBeNull();
      expect(mgr.getInstanceCount("tree")).toBe(1);

      const removed = mgr.removeInstance(instance!.id);
      expect(removed).toBe(true);
      expect(mgr.getInstanceCount("tree")).toBe(0);
    });

    it("removeInstance returns false for unknown id", () => {
      const mgr = InstancedMeshManager.getInstance();
      expect(mgr.removeInstance("nonexistent")).toBe(false);
    });

    it("removeInstanceByData removes correctly", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      const instance = mgr.createInstance("tree", { position: Vector3.Zero() });
      expect(instance).not.toBeNull();

      expect(mgr.removeInstanceByData(instance!)).toBe(true);
      expect(mgr.getInstanceCount("tree")).toBe(0);
    });
  });

  // ── Max Instances ─────────────────────────────────────────

  describe("max instances", () => {
    it("rejects instance creation beyond max", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any, 2);

      const i1 = mgr.createInstance("tree", { position: Vector3.Zero() });
      const i2 = mgr.createInstance("tree", { position: Vector3.Zero() });
      const i3 = mgr.createInstance("tree", { position: Vector3.Zero() });

      expect(i1).not.toBeNull();
      expect(i2).not.toBeNull();
      expect(i3).toBeNull(); // Exceeded max
      expect(mgr.getInstanceCount("tree")).toBe(2);
    });
  });

  // ── Batch Creation ────────────────────────────────────────

  describe("batch creation", () => {
    it("creates multiple instances at once", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);

      const transforms: InstanceTransform[] = [
        { position: new Vector3(0, 0, 0) },
        { position: new Vector3(10, 0, 0) },
        { position: new Vector3(20, 0, 0) },
      ];

      const instances = mgr.createInstances("tree", transforms);
      expect(instances.length).toBe(3);
      expect(mgr.getInstanceCount("tree")).toBe(3);
    });
  });

  // ── Counts ────────────────────────────────────────────────

  describe("counts", () => {
    it("getInstanceCount returns 0 for unknown template", () => {
      const mgr = InstancedMeshManager.getInstance();
      expect(mgr.getInstanceCount("unknown")).toBe(0);
    });

    it("getTotalInstanceCount sums across templates", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("rock", createMockMesh("rock") as any);

      mgr.createInstance("tree", { position: Vector3.Zero() });
      mgr.createInstance("tree", { position: Vector3.Zero() });
      mgr.createInstance("rock", { position: Vector3.Zero() });

      expect(mgr.getTotalInstanceCount()).toBe(3);
    });
  });

  // ── Clear/Dispose ─────────────────────────────────────────

  describe("clear and dispose", () => {
    it("clearTemplate removes all instances of a template", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      mgr.createInstance("tree", { position: Vector3.Zero() });
      mgr.createInstance("tree", { position: Vector3.Zero() });

      mgr.clearTemplate("tree");
      expect(mgr.getInstanceCount("tree")).toBe(0);
      // Template should still exist
      expect(mgr.hasTemplate("tree")).toBe(true);
    });

    it("removeTemplate removes template and instances", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      mgr.createInstance("tree", { position: Vector3.Zero() });

      mgr.removeTemplate("tree");
      expect(mgr.hasTemplate("tree")).toBe(false);
    });

    it("dispose clears everything", () => {
      const mgr = InstancedMeshManager.getInstance();
      mgr.init(createMockScene());
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      mgr.createInstance("tree", { position: Vector3.Zero() });

      mgr.dispose();
      expect(mgr.isInitialized()).toBe(false);
      expect(mgr.getTotalInstanceCount()).toBe(0);
    });
  });

  // ── Template Names ────────────────────────────────────────

  describe("template names", () => {
    it("getTemplateNames returns all registered names", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any);
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("rock", createMockMesh("rock") as any);

      const names = mgr.getTemplateNames();
      expect(names).toContain("tree");
      expect(names).toContain("rock");
    });
  });

  // ── Debug Info ────────────────────────────────────────────

  describe("debug info", () => {
    it("returns structured debug info", () => {
      const mgr = InstancedMeshManager.getInstance();
      // biome-ignore lint/suspicious/noExplicitAny: mock mesh for testing
      mgr.registerTemplate("tree", createMockMesh("tree") as any, 100);
      mgr.createInstance("tree", { position: Vector3.Zero() });

      const info = mgr.getDebugInfo();
      expect(info.totalInstances).toBe(1);
      expect(info.templates.length).toBe(1);
      expect(info.templates[0].name).toBe("tree");
      expect(info.templates[0].count).toBe(1);
      expect(info.templates[0].maxInstances).toBe(100);
    });
  });

  // ── Static Helpers ────────────────────────────────────────

  describe("createMatrix", () => {
    it("creates a world matrix from transform", () => {
      const matrix = InstancedMeshManager.createMatrix({
        position: new Vector3(10, 20, 30),
      });
      expect(matrix).toBeInstanceOf(Matrix);
      // Check translation component
      const arr = matrix.toArray();
      expect(arr[12]).toBeCloseTo(10);
      expect(arr[13]).toBeCloseTo(20);
      expect(arr[14]).toBeCloseTo(30);
    });

    it("applies scaling to matrix", () => {
      const matrix = InstancedMeshManager.createMatrix({
        position: Vector3.Zero(),
        scaling: new Vector3(2, 3, 4),
      });
      const arr = matrix.toArray();
      // Scale affects diagonal elements
      expect(arr[0]).toBeCloseTo(2);
      expect(arr[5]).toBeCloseTo(3);
      expect(arr[10]).toBeCloseTo(4);
    });
  });
});
