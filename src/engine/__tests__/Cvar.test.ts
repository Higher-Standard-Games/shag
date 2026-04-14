/**
 * Cvar System Tests
 *
 * Tests the Quake-style console variable system used for engine/game configuration.
 * Covers registration, get/set, type coercion, toggle, reset, listing, readonly,
 * change callbacks, config import/export, and case insensitivity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cvar, type CvarValue } from "../core/Cvar";

// ─── Helpers ────────────────────────────────────────────────────

/** Clear all Cvar state between tests */
function resetCvarState(): void {
  // Access private static state to reset between tests
  // biome-ignore lint/suspicious/noExplicitAny: test helper accessing private state
  const CvarAny = Cvar as any;
  CvarAny.cvars = new Map();
  CvarAny.initialized = false;
  CvarAny.consoleIntegration = null;
}

// Mock localStorage
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

// ─── Tests ──────────────────────────────────────────────────────

describe("Cvar", () => {
  beforeEach(() => {
    resetCvarState();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetCvarState();
  });

  // ── Registration ────────────────────────────────────────────

  describe("register", () => {
    it("should register a float cvar with auto-type detection", () => {
      // Note: 1.0 is detected as int by JS (Number.isInteger(1.0) === true)
      // Use a non-integer default for auto-float detection
      const cvar = Cvar.register("r_bloom", 1.5);
      expect(cvar.name).toBe("r_bloom");
      expect(cvar.type).toBe("float");
      expect(cvar.value).toBe(1.5);
      expect(cvar.defaultValue).toBe(1.5);
    });

    it("should detect integer 1.0 as int type (JS behavior)", () => {
      const cvar = Cvar.register("r_test", 1.0);
      // Number.isInteger(1.0) === true in JavaScript
      expect(cvar.type).toBe("int");
    });

    it("should register an int cvar with auto-type detection", () => {
      const cvar = Cvar.register("r_anisotropy", 8);
      expect(cvar.type).toBe("int");
      expect(cvar.value).toBe(8);
    });

    it("should register a bool cvar with auto-type detection", () => {
      const cvar = Cvar.register("cl_autohop", true);
      expect(cvar.type).toBe("bool");
      expect(cvar.value).toBe(true);
    });

    it("should register a string cvar with auto-type detection", () => {
      const cvar = Cvar.register("cl_name", "Player");
      expect(cvar.type).toBe("string");
      expect(cvar.value).toBe("Player");
    });

    it("should store name as lowercase", () => {
      Cvar.register("R_Bloom", 1.0);
      expect(Cvar.exists("r_bloom")).toBe(true);
      expect(Cvar.exists("R_Bloom")).toBe(true);
    });

    it("should apply explicit type override", () => {
      const cvar = Cvar.register("r_wireframe", 0, { type: "int" });
      expect(cvar.type).toBe("int");
    });

    it("should apply min/max to default value", () => {
      const cvar = Cvar.register("r_bloom", 5.0, { min: 0, max: 3.0 });
      expect(cvar.value).toBe(3.0);
      expect(cvar.defaultValue).toBe(3.0);
    });

    it("should set description and flags", () => {
      const cvar = Cvar.register("r_test", 1.0, {
        description: "Test variable",
        hidden: true,
        readonly: true,
      });
      expect(cvar.description).toBe("Test variable");
      expect(cvar.flags.hidden).toBe(true);
      expect(cvar.flags.readonly).toBe(true);
    });

    it("should default persist to true", () => {
      const cvar = Cvar.register("r_test", 1.0);
      expect(cvar.flags.persist).toBe(true);
    });
  });

  // ── Get/Set ─────────────────────────────────────────────────

  describe("get/set", () => {
    it("should get registered value", () => {
      Cvar.register("r_bloom", 1.5);
      expect(Cvar.get("r_bloom")).toBe(1.5);
    });

    it("should return undefined for unregistered cvar", () => {
      expect(Cvar.get("nonexistent")).toBeUndefined();
    });

    it("should set a value", () => {
      Cvar.register("r_bloom", 1.0);
      expect(Cvar.set("r_bloom", 2.0)).toBe(true);
      expect(Cvar.get("r_bloom")).toBe(2.0);
    });

    it("should return false for unknown cvar", () => {
      expect(Cvar.set("nonexistent", 1.0)).toBe(false);
    });

    it("should clamp to min/max on set", () => {
      Cvar.register("r_bloom", 1.0, { min: 0, max: 3.0 });
      Cvar.set("r_bloom", 5.0);
      expect(Cvar.get("r_bloom")).toBe(3.0);
      Cvar.set("r_bloom", -1.0);
      expect(Cvar.get("r_bloom")).toBe(0);
    });

    it("should be case-insensitive", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.set("R_BLOOM", 2.0);
      expect(Cvar.get("R_Bloom")).toBe(2.0);
    });

    it("should prevent setting readonly cvars", () => {
      Cvar.register("sv_version", "1.0.0", { readonly: true });
      expect(Cvar.set("sv_version", "2.0.0")).toBe(false);
      expect(Cvar.get("sv_version")).toBe("1.0.0");
    });

    it("should return true (no-op) when value unchanged", () => {
      Cvar.register("r_bloom", 1.0);
      expect(Cvar.set("r_bloom", 1.0)).toBe(true);
    });
  });

  // ── Typed Getters ──────────────────────────────────────────

  describe("typed getters", () => {
    it("getString returns string representation", () => {
      Cvar.register("r_bloom", 1.5);
      expect(Cvar.getString("r_bloom")).toBe("1.5");
    });

    it("getString returns empty for nonexistent", () => {
      expect(Cvar.getString("nope")).toBe("");
    });

    it("getNumber returns numeric value", () => {
      Cvar.register("r_bloom", 2.5);
      expect(Cvar.getNumber("r_bloom")).toBe(2.5);
    });

    it("getNumber converts bool to 0/1", () => {
      Cvar.register("cl_autohop", true);
      expect(Cvar.getNumber("cl_autohop")).toBe(1);
    });

    it("getNumber returns 0 for nonexistent", () => {
      expect(Cvar.getNumber("nope")).toBe(0);
    });

    it("getBool returns boolean value", () => {
      Cvar.register("cl_autohop", true);
      expect(Cvar.getBool("cl_autohop")).toBe(true);
    });

    it("getBool treats 0 as false", () => {
      Cvar.register("r_wire", 0, { type: "int" });
      expect(Cvar.getBool("r_wire")).toBe(false);
    });

    it("getBool treats nonzero as true", () => {
      Cvar.register("r_wire", 1, { type: "int" });
      expect(Cvar.getBool("r_wire")).toBe(true);
    });

    it("getBool returns false for nonexistent", () => {
      expect(Cvar.getBool("nope")).toBe(false);
    });

    it("getInt returns rounded value", () => {
      Cvar.register("r_bloom", 2.7, { type: "float" });
      expect(Cvar.getInt("r_bloom")).toBe(3);
    });
  });

  // ── Type Coercion ─────────────────────────────────────────

  describe("type coercion", () => {
    it("coerces string to int on set", () => {
      Cvar.register("r_aniso", 8, { type: "int" });
      Cvar.set("r_aniso", "12" as unknown as CvarValue);
      expect(Cvar.get("r_aniso")).toBe(12);
    });

    it("coerces string to float on set", () => {
      Cvar.register("r_bloom", 1.0, { type: "float" });
      Cvar.set("r_bloom", "2.5" as unknown as CvarValue);
      expect(Cvar.get("r_bloom")).toBe(2.5);
    });

    it("coerces string to bool on set", () => {
      Cvar.register("cl_auto", true, { type: "bool" });
      Cvar.set("cl_auto", "false" as unknown as CvarValue);
      expect(Cvar.get("cl_auto")).toBe(false);
    });

    it("coerces number 0 to bool false", () => {
      Cvar.register("cl_auto", true, { type: "bool" });
      Cvar.set("cl_auto", 0);
      expect(Cvar.get("cl_auto")).toBe(false);
    });

    it("rounds float to int", () => {
      Cvar.register("r_aniso", 8, { type: "int" });
      Cvar.set("r_aniso", 6.7);
      expect(Cvar.get("r_aniso")).toBe(7);
    });
  });

  // ── Toggle ────────────────────────────────────────────────

  describe("toggle", () => {
    it("toggles bool cvar", () => {
      Cvar.register("cl_auto", true, { type: "bool" });
      Cvar.toggle("cl_auto");
      expect(Cvar.getBool("cl_auto")).toBe(false);
      Cvar.toggle("cl_auto");
      expect(Cvar.getBool("cl_auto")).toBe(true);
    });

    it("toggles non-bool between 0 and 1", () => {
      Cvar.register("r_wire", 0, { type: "int" });
      Cvar.toggle("r_wire");
      expect(Cvar.get("r_wire")).toBe(1);
      Cvar.toggle("r_wire");
      expect(Cvar.get("r_wire")).toBe(0);
    });

    it("returns false for unknown cvar", () => {
      expect(Cvar.toggle("nope")).toBe(false);
    });
  });

  // ── Reset ─────────────────────────────────────────────────

  describe("reset", () => {
    it("resets a cvar to default", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.set("r_bloom", 2.5);
      expect(Cvar.reset("r_bloom")).toBe(true);
      expect(Cvar.get("r_bloom")).toBe(1.0);
    });

    it("returns false for unknown cvar", () => {
      expect(Cvar.reset("nope")).toBe(false);
    });

    it("resetAll resets all non-readonly cvars", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.register("sv_ver", "1.0", { readonly: true });
      Cvar.set("r_bloom", 3.0);
      Cvar.resetAll();
      expect(Cvar.get("r_bloom")).toBe(1.0);
      expect(Cvar.get("sv_ver")).toBe("1.0");
    });
  });

  // ── Change Callbacks ──────────────────────────────────────

  describe("change callbacks", () => {
    it("calls onChange when value changes", () => {
      const onChange = vi.fn();
      Cvar.register("r_bloom", 1.0, { onChange });
      Cvar.set("r_bloom", 2.0);
      expect(onChange).toHaveBeenCalledWith(2.0, 1.0);
    });

    it("does not call onChange when value unchanged", () => {
      const onChange = vi.fn();
      Cvar.register("r_bloom", 1.0, { onChange });
      Cvar.set("r_bloom", 1.0);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("handles onChange errors gracefully", () => {
      const onChange = vi.fn(() => {
        throw new Error("boom");
      });
      Cvar.register("r_bloom", 1.0, { onChange });
      // Should not throw
      expect(Cvar.set("r_bloom", 2.0)).toBe(true);
      expect(Cvar.get("r_bloom")).toBe(2.0);
    });
  });

  // ── Listing & Info ────────────────────────────────────────

  describe("listing", () => {
    it("lists all non-hidden cvars", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.register("r_hidden", 0, { hidden: true });
      Cvar.register("r_wire", 0);
      const list = Cvar.list();
      expect(list.length).toBe(2);
      expect(list.map((c) => c.name)).toContain("r_bloom");
      expect(list.map((c) => c.name)).not.toContain("r_hidden");
    });

    it("filters by prefix", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.register("r_wire", 0);
      Cvar.register("cl_auto", true);
      const list = Cvar.list("r_");
      expect(list.length).toBe(2);
    });

    it("getNames returns sorted non-hidden names", () => {
      Cvar.register("r_wire", 0);
      Cvar.register("r_bloom", 1.0);
      Cvar.register("r_hidden", 0, { hidden: true });
      const names = Cvar.getNames();
      expect(names).toEqual(["r_bloom", "r_wire"]);
    });

    it("exists checks for cvar presence", () => {
      Cvar.register("r_bloom", 1.0);
      expect(Cvar.exists("r_bloom")).toBe(true);
      expect(Cvar.exists("nope")).toBe(false);
    });

    it("getCvar returns full instance", () => {
      Cvar.register("r_bloom", 1.0, { description: "Bloom" });
      const cvar = Cvar.getCvar("r_bloom");
      expect(cvar).toBeDefined();
      expect(cvar?.description).toBe("Bloom");
    });

    it("formatInfo shows current value", () => {
      Cvar.register("r_bloom", 1.0, { description: "Bloom intensity" });
      const info = Cvar.formatInfo("r_bloom");
      expect(info).toContain("r_bloom");
      expect(info).toContain("1");
      expect(info).toContain("Bloom intensity");
    });

    it("formatInfo shows default when changed", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.set("r_bloom", 2.0);
      const info = Cvar.formatInfo("r_bloom");
      expect(info).toContain("default");
    });

    it("formatInfo returns unknown for missing cvar", () => {
      expect(Cvar.formatInfo("nope")).toContain("Unknown");
    });
  });

  // ── Batch & Config ────────────────────────────────────────

  describe("batch operations", () => {
    it("registerMany registers multiple cvars", () => {
      Cvar.registerMany([
        ["r_bloom", 1.0],
        ["r_wire", 0, { type: "int" }],
        ["cl_auto", true],
      ]);
      expect(Cvar.exists("r_bloom")).toBe(true);
      expect(Cvar.exists("r_wire")).toBe(true);
      expect(Cvar.exists("cl_auto")).toBe(true);
    });

    it("exportConfig only exports non-default values", () => {
      Cvar.register("r_bloom", 1.0, { type: "float" });
      Cvar.register("r_wire", 0, { type: "int" });

      // Nothing changed — should be empty
      expect(Cvar.exportConfig()).toBe("");

      Cvar.set("r_bloom", 2.5);
      const config = Cvar.exportConfig();
      expect(config).toContain("r_bloom");
      expect(config).toContain("2.5");
      expect(config).not.toContain("r_wire");
    });

    it("execConfig sets values from config string", () => {
      Cvar.register("r_bloom", 1.0, { type: "float" });
      Cvar.register("r_wire", 0, { type: "int" });

      Cvar.execConfig('r_bloom "2.5"\nr_wire 1');
      expect(Cvar.get("r_bloom")).toBe(2.5);
      expect(Cvar.get("r_wire")).toBe(1);
    });

    it("execConfig skips comments and empty lines", () => {
      Cvar.register("r_bloom", 1.0);
      Cvar.execConfig('// comment\n# another comment\n\nr_bloom "2.0"');
      expect(Cvar.get("r_bloom")).toBe(2.0);
    });
  });

  // ── Console Integration ───────────────────────────────────

  describe("console integration", () => {
    it("calls integration callback for existing cvars", () => {
      Cvar.register("r_bloom", 1.0);
      const callback = vi.fn();
      Cvar.setConsoleIntegration(callback);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("calls integration callback for new cvars", () => {
      const callback = vi.fn();
      Cvar.setConsoleIntegration(callback);
      Cvar.register("r_new", 1.0);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
