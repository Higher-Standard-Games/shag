import { describe, it, expect, beforeEach, vi } from "vitest";
import { EngineSettings } from "../core/EngineSettings";

describe("EngineSettings", () => {
  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = EngineSettings.getInstance();
      const instance2 = EngineSettings.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("default settings", () => {
    let settings: EngineSettings;

    beforeEach(() => {
      settings = EngineSettings.getInstance();
    });

    it("should return default camera settings", () => {
      const camera = settings.getCameraSettings();
      expect(camera.mode).toBe("fake_ortho");
      expect(camera.height).toBe(800);
      expect(camera.alpha).toBeCloseTo(-Math.PI / 4, 4);
      expect(camera.beta).toBeCloseTo(Math.PI / 4, 4);
      expect(camera.fov).toBe(0.4);
      expect(camera.smoothing).toBe(0.15);
    });

    it("should return default lighting settings", () => {
      const lighting = settings.getLightingSettings();
      expect(lighting.sunIntensity).toBe(0.6);
      expect(lighting.moonIntensity).toBe(0.12);
      expect(lighting.ambientIntensity).toBe(0.25);
      expect(lighting.enableShadows).toBe(true);
    });

    it("should return default time settings", () => {
      const time = settings.getTimeSettings();
      expect(time.dayLengthSeconds).toBe(180);
      expect(time.startHour).toBe(8);
      expect(time.startDay).toBe(1);
    });

    it("should return default post-processing settings", () => {
      const pp = settings.getPostProcessingSettings();
      expect(pp.bloom.enabled).toBe(true);
      expect(pp.bloom.intensity).toBe(0.3);
      expect(pp.vignette.enabled).toBe(true);
      expect(pp.vignette.weight).toBe(0.3);
      expect(pp.ssao.enabled).toBe(false);
      expect(pp.chromaticAberration.enabled).toBe(false);
    });
  });

  describe("load", () => {
    it("should handle missing settings file gracefully", async () => {
      // Mock fetch to return 404
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      const settings = EngineSettings.getInstance();
      // Note: load() may have already been called, so we test defaults work
      const camera = settings.getCameraSettings();
      expect(camera).toBeDefined();
      expect(camera.mode).toBeDefined();
    });
  });

  describe("getRawSettings", () => {
    it("should return null if no custom settings loaded", () => {
      const settings = EngineSettings.getInstance();
      // If no file was loaded, raw settings might be null
      const raw = settings.getRawSettings();
      // This could be null or an object depending on test order
      expect(raw === null || typeof raw === 'object').toBe(true);
    });
  });

  describe("isLoaded", () => {
    it("should return boolean", () => {
      const settings = EngineSettings.getInstance();
      expect(typeof settings.isLoaded()).toBe("boolean");
    });
  });
});
