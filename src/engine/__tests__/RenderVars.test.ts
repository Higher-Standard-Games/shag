/**
 * RenderVars Tests
 *
 * Tests the Q3-style render variable system: get/set/reset, clamping,
 * integer rounding, config import/export, change listeners, and category listing.
 *
 * Note: RenderVars depends on Cvar and localStorage. We mock localStorage
 * and reset both RenderVars and Cvar state between tests.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock localStorage before importing modules that use it
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
// biome-ignore lint/suspicious/noExplicitAny: mock global for tests
(globalThis as any).localStorage = localStorageMock;

// Mock requestAnimationFrame (not available in Node)
// biome-ignore lint/suspicious/noExplicitAny: mock global for tests
(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  cb();
  return 0;
};

import { Cvar } from "../core/Cvar";
import { RenderVars } from "../rendering/RenderVars";

// ─── Helpers ────────────────────────────────────────────────────

function resetState(): void {
  // Reset Cvar state
  // biome-ignore lint/suspicious/noExplicitAny: test helper accessing private state
  const CvarAny = Cvar as any;
  CvarAny.cvars = new Map();
  CvarAny.initialized = false;
  CvarAny.consoleIntegration = null;

  // Reset RenderVars singleton
  // biome-ignore lint/suspicious/noExplicitAny: test helper accessing private state
  const RVAny = RenderVars as any;
  RVAny.instance = undefined;
}

function getRV(): RenderVars {
  return RenderVars.getInstance();
}

// ─── Tests ──────────────────────────────────────────────────────

describe("RenderVars", () => {
  beforeEach(() => {
    resetState();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetState();
  });

  // ── Singleton ─────────────────────────────────────────────

  describe("singleton", () => {
    it("returns same instance", () => {
      const a = RenderVars.getInstance();
      const b = RenderVars.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── Default Variables ─────────────────────────────────────

  describe("defaults", () => {
    it("initializes all expected r_* variables", () => {
      const rv = getRV();
      const names = rv.getNames();

      // Core material vars
      expect(names).toContain("r_deluxe");
      expect(names).toContain("r_bsp_pbr");
      expect(names).toContain("r_normalmap");
      expect(names).toContain("r_glossmap");
      expect(names).toContain("r_lightmap");
      expect(names).toContain("r_ambient");
      expect(names).toContain("r_emissive");
      expect(names).toContain("r_anisotropy");
      expect(names).toContain("r_webgpu");
      expect(names).toContain("r_wireframe");

      // Post-processing
      expect(names).toContain("r_bloom");
      expect(names).toContain("r_exposure");
      expect(names).toContain("r_contrast");
    });

    it("has correct default values", () => {
      const rv = getRV();
      expect(rv.get("r_deluxe")).toBe(1);
      expect(rv.get("r_bsp_pbr")).toBe(1);
      expect(rv.get("r_normalmap")).toBe(1.0);
      expect(rv.get("r_glossmap")).toBe(1.0);
      expect(rv.get("r_lightmap")).toBe(1.0);
      expect(rv.get("r_anisotropy")).toBe(8);
      expect(rv.get("r_webgpu")).toBe(0);
      expect(rv.get("r_wireframe")).toBe(0);
    });

    it("includes day/night variables", () => {
      const rv = getRV();
      const names = rv.getNames();
      expect(names).toContain("r_daynight");
      expect(names).toContain("r_daynight_time");
      expect(names).toContain("r_daynight_speed");
    });
  });

  // ── Get/Set ───────────────────────────────────────────────

  describe("get/set", () => {
    it("gets a variable value", () => {
      const rv = getRV();
      expect(rv.get("r_normalmap")).toBe(1.0);
    });

    it("returns undefined for unknown variable", () => {
      const rv = getRV();
      expect(rv.get("r_nonexistent")).toBeUndefined();
    });

    it("sets a variable value", () => {
      const rv = getRV();
      expect(rv.set("r_normalmap", 2.0)).toBe(true);
      expect(rv.get("r_normalmap")).toBe(2.0);
    });

    it("returns false for unknown variable", () => {
      const rv = getRV();
      expect(rv.set("r_nonexistent", 1.0)).toBe(false);
    });

    it("returns true when value unchanged (no-op)", () => {
      const rv = getRV();
      expect(rv.set("r_normalmap", 1.0)).toBe(true);
    });
  });

  // ── Clamping ──────────────────────────────────────────────

  describe("clamping", () => {
    it("clamps values to maximum", () => {
      const rv = getRV();
      rv.set("r_normalmap", 10.0); // max is 4.0
      expect(rv.get("r_normalmap")).toBe(4.0);
    });

    it("clamps values to minimum", () => {
      const rv = getRV();
      rv.set("r_normalmap", -5.0); // min is 0
      expect(rv.get("r_normalmap")).toBe(0);
    });

    it("allows values within range", () => {
      const rv = getRV();
      rv.set("r_normalmap", 2.5);
      expect(rv.get("r_normalmap")).toBe(2.5);
    });
  });

  // ── Integer Rounding ──────────────────────────────────────

  describe("integer rounding", () => {
    it("rounds r_anisotropy to integer", () => {
      const rv = getRV();
      rv.set("r_anisotropy", 6.7);
      expect(rv.get("r_anisotropy")).toBe(7);
    });

    it("rounds r_wireframe to integer", () => {
      const rv = getRV();
      rv.set("r_wireframe", 0.8);
      expect(rv.get("r_wireframe")).toBe(1);
    });

    it("rounds restart-only r_webgpu to integer", () => {
      const rv = getRV();
      rv.set("r_webgpu", 0.2);
      expect(rv.get("r_webgpu")).toBe(0);
    });

    it("rounds r_ktx2 to integer", () => {
      const rv = getRV();
      rv.set("r_ktx2", 0.2);
      expect(rv.get("r_ktx2")).toBe(0);
    });
  });

  // ── Reset ─────────────────────────────────────────────────

  describe("reset", () => {
    it("resets a single variable to default", () => {
      const rv = getRV();
      rv.set("r_normalmap", 3.0);
      expect(rv.reset("r_normalmap")).toBe(true);
      expect(rv.get("r_normalmap")).toBe(1.0);
    });

    it("returns false for unknown variable", () => {
      const rv = getRV();
      expect(rv.reset("r_nonexistent")).toBe(false);
    });

    it("resetAll resets all variables", () => {
      const rv = getRV();
      rv.set("r_normalmap", 3.0);
      rv.set("r_glossmap", 2.0);
      rv.resetAll();
      expect(rv.get("r_normalmap")).toBe(1.0);
      expect(rv.get("r_glossmap")).toBe(1.0);
    });
  });

  describe("PBR gloss tuning", () => {
    it("scales microSurfaceTexture on PBR materials when r_glossmap changes", () => {
      const rv = getRV();
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const mesh = MeshBuilder.CreateBox("box", {}, scene);
      const material = new PBRMaterial("pbr", scene);
      const glossTex = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false);

      material.microSurfaceTexture = glossTex;
      material.microSurfaceTexture.level = 1.0;
      mesh.material = material;

      // biome-ignore lint/suspicious/noExplicitAny: testing private helper directly
      (rv as any).applyToMesh(mesh, 1.0, 1.5, 1.0, 1.0, 8, false);
      expect(material.microSurfaceTexture?.level).toBeCloseTo(1.5);

      // biome-ignore lint/suspicious/noExplicitAny: testing private helper directly
      (rv as any).applyToMesh(mesh, 1.0, 1.0, 1.0, 1.0, 8, false);
      expect(material.microSurfaceTexture?.level).toBeCloseTo(1.0);

      scene.dispose();
      engine.dispose();
    });
  });

  // ── Get Variable Info ─────────────────────────────────────

  describe("getVar", () => {
    it("returns full variable info", () => {
      const rv = getRV();
      const v = rv.getVar("r_normalmap");
      expect(v).toBeDefined();
      expect(v?.name).toBe("r_normalmap");
      expect(v?.min).toBe(0);
      expect(v?.max).toBe(4.0);
      expect(v?.category).toBe("material");
      expect(v?.description).toContain("Normal");
    });

    it("returns undefined for unknown", () => {
      const rv = getRV();
      expect(rv.getVar("r_nope")).toBeUndefined();
    });
  });

  // ── Listing ───────────────────────────────────────────────

  describe("listing", () => {
    it("getNames returns sorted array", () => {
      const rv = getRV();
      const names = rv.getNames();
      expect(names.length).toBeGreaterThan(0);
      // Check sorting
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("getAll returns all variables", () => {
      const rv = getRV();
      const all = rv.getAll();
      expect(all.length).toBeGreaterThan(10);
      // Should be sorted by name
      for (let i = 1; i < all.length; i++) {
        expect(all[i].name >= all[i - 1].name).toBe(true);
      }
    });

    it("getByCategory filters correctly", () => {
      const rv = getRV();
      const materials = rv.getByCategory("material");
      expect(materials.length).toBeGreaterThan(0);
      for (const v of materials) {
        expect(v.category).toBe("material");
      }

      const debug = rv.getByCategory("debug");
      expect(debug.length).toBeGreaterThan(0);
      for (const v of debug) {
        expect(v.category).toBe("debug");
      }
    });
  });

  // ── Config Import/Export ──────────────────────────────────

  describe("config import/export", () => {
    it("exports all current values", () => {
      const rv = getRV();
      const config = rv.exportConfig();
      expect(config).toContain("r_normalmap");
      expect(config).toContain("r_bloom");
    });

    it("export/import roundtrips correctly", () => {
      const rv = getRV();
      rv.set("r_normalmap", 2.5);
      rv.set("r_glossmap", 0.5);

      const config = rv.exportConfig();

      // Reset and reimport
      rv.resetAll();
      expect(rv.get("r_normalmap")).toBe(1.0);

      const result = rv.importConfig(config);
      expect(result.applied).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
      expect(rv.get("r_normalmap")).toBe(2.5);
      expect(rv.get("r_glossmap")).toBe(0.5);
    });

    it("importConfig skips comments and empty lines", () => {
      const rv = getRV();
      const result = rv.importConfig("// comment\n# hash comment\n\nr_normalmap 2.0");
      expect(result.applied).toBe(1);
    });

    it("importConfig reports errors for invalid lines", () => {
      const rv = getRV();
      const result = rv.importConfig("invalid line format");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("importConfig rejects unknown variables", () => {
      const rv = getRV();
      const result = rv.importConfig("r_unknown_var 5.0");
      // Should fail on unknown var
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ── Listeners ─────────────────────────────────────────────

  describe("listeners", () => {
    it("notifies on value change", () => {
      const rv = getRV();
      const callback = vi.fn();
      rv.onChange("r_normalmap", callback);
      rv.set("r_normalmap", 2.0);
      expect(callback).toHaveBeenCalledWith(2.0);
    });

    it("does not notify when value unchanged", () => {
      const rv = getRV();
      const callback = vi.fn();
      rv.onChange("r_normalmap", callback);
      rv.set("r_normalmap", 1.0); // same as default
      expect(callback).not.toHaveBeenCalled();
    });

    it("unsubscribe stops notifications", () => {
      const rv = getRV();
      const callback = vi.fn();
      const unsub = rv.onChange("r_normalmap", callback);

      rv.set("r_normalmap", 2.0);
      expect(callback).toHaveBeenCalledTimes(1);

      unsub();
      rv.set("r_normalmap", 3.0);
      expect(callback).toHaveBeenCalledTimes(1); // No new call
    });

    it("handles listener errors gracefully", () => {
      const rv = getRV();
      rv.onChange("r_normalmap", () => {
        throw new Error("boom");
      });
      // Should not throw
      expect(() => rv.set("r_normalmap", 2.0)).not.toThrow();
    });
  });
});
