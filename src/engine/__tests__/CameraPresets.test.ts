/**
 * CameraPresets Tests
 *
 * Tests the predefined camera preset data and lookup functions.
 * Pure data validation — no Babylon.js dependencies.
 */

import { describe, expect, it } from "vitest";
import { CAMERA_PRESETS, getCameraPreset, getCameraPresetNames, type CameraPreset } from "../camera/CameraPresets";

describe("CameraPresets", () => {
  // ── Preset Data ───────────────────────────────────────────

  describe("preset data", () => {
    it("has all expected presets", () => {
      const names = getCameraPresetNames();
      expect(names).toContain("isometric_default");
      expect(names).toContain("isometric_close");
      expect(names).toContain("isometric_far");
      expect(names).toContain("topdown");
      expect(names).toContain("fps_default");
      expect(names).toContain("fps_wide");
      expect(names).toContain("sidescroll_default");
      expect(names).toContain("sidescroll_locked");
      expect(names).toContain("follow_default");
      expect(names).toContain("follow_close");
      expect(names).toContain("orbit_default");
      expect(names).toContain("orbit_auto");
    });

    it("all presets have required fields", () => {
      for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
        expect(preset.name, `${key}.name`).toBeDefined();
        expect(preset.description, `${key}.description`).toBeDefined();
        expect(preset.controllerType, `${key}.controllerType`).toBeDefined();
        expect(preset.cameraMode, `${key}.cameraMode`).toBeDefined();
        expect(typeof preset.height, `${key}.height`).toBe("number");
        expect(typeof preset.alpha, `${key}.alpha`).toBe("number");
        expect(typeof preset.beta, `${key}.beta`).toBe("number");
      }
    });

    it("all presets have valid controller types", () => {
      const validTypes = ["isometric", "fps", "sidescroll", "follow", "orbit"];
      for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
        expect(validTypes, `${key}.controllerType`).toContain(preset.controllerType);
      }
    });

    it("all presets have valid camera modes", () => {
      const validModes = ["perspective", "orthographic", "fake_ortho"];
      for (const [key, preset] of Object.entries(CAMERA_PRESETS)) {
        expect(validModes, `${key}.cameraMode`).toContain(preset.cameraMode);
      }
    });
  });

  // ── Controller Categories ─────────────────────────────────

  describe("controller categories", () => {
    it("isometric presets use fake_ortho or orthographic", () => {
      const isoPresets = Object.values(CAMERA_PRESETS).filter(p => p.controllerType === "isometric");
      expect(isoPresets.length).toBeGreaterThanOrEqual(3);
      for (const p of isoPresets) {
        expect(["fake_ortho", "orthographic"]).toContain(p.cameraMode);
      }
    });

    it("fps presets use perspective", () => {
      const fpsPresets = Object.values(CAMERA_PRESETS).filter(p => p.controllerType === "fps");
      expect(fpsPresets.length).toBeGreaterThanOrEqual(2);
      for (const p of fpsPresets) {
        expect(p.cameraMode).toBe("perspective");
      }
    });

    it("follow presets use perspective", () => {
      const followPresets = Object.values(CAMERA_PRESETS).filter(p => p.controllerType === "follow");
      expect(followPresets.length).toBeGreaterThanOrEqual(2);
      for (const p of followPresets) {
        expect(p.cameraMode).toBe("perspective");
      }
    });
  });

  // ── Lookup ────────────────────────────────────────────────

  describe("getCameraPreset", () => {
    it("returns preset by name", () => {
      const preset = getCameraPreset("fps_default");
      expect(preset).toBeDefined();
      expect(preset!.controllerType).toBe("fps");
      expect(preset!.name).toBe("FPS Default");
    });

    it("returns undefined for unknown preset", () => {
      expect(getCameraPreset("nonexistent")).toBeUndefined();
    });
  });

  // ── getCameraPresetNames ──────────────────────────────────

  describe("getCameraPresetNames", () => {
    it("returns all preset names", () => {
      const names = getCameraPresetNames();
      expect(names.length).toBe(Object.keys(CAMERA_PRESETS).length);
    });
  });
});
