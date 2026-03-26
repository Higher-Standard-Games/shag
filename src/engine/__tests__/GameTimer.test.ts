/**
 * GameTimer — Time management, speed modes, and day/night cycle tests
 *
 * Verifies speed mode cycling, time formatting, day/night utilities,
 * time scale, and timer CRUD.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { GameTimer, SPEED_MULTIPLIERS } from "../core/GameTimer";

describe("GameTimer", () => {
  let timer: GameTimer;

  beforeEach(() => {
    GameTimer.resetInstance();
    timer = GameTimer.getInstance();
    timer.reset();
  });

  describe("Speed modes", () => {
    it("should default to normal mode", () => {
      expect(timer.getSpeedMode()).toBe("normal");
      expect(timer.getSpeedMultiplier()).toBe(1.0);
    });

    it("should set fast mode", () => {
      timer.setSpeedMode("fast");
      expect(timer.getSpeedMode()).toBe("fast");
      expect(timer.getSpeedMultiplier()).toBe(2.0);
    });

    it("should set debug mode when enabled", () => {
      timer.setDebugModeEnabled(true);
      timer.setSpeedMode("debug");
      expect(timer.getSpeedMode()).toBe("debug");
      expect(timer.getSpeedMultiplier()).toBe(10.0);
    });

    it("should reject debug mode when disabled", () => {
      timer.setDebugModeEnabled(false);
      timer.setSpeedMode("debug");
      expect(timer.getSpeedMode()).toBe("normal"); // Should stay normal
    });

    it("should cycle: normal → fast → debug → normal", () => {
      timer.setDebugModeEnabled(true);

      expect(timer.cycleSpeedMode()).toBe("fast");
      expect(timer.cycleSpeedMode()).toBe("debug");
      expect(timer.cycleSpeedMode()).toBe("normal");
    });

    it("should skip debug when disabled: normal → fast → normal", () => {
      timer.setDebugModeEnabled(false);

      expect(timer.cycleSpeedMode()).toBe("fast");
      expect(timer.cycleSpeedMode()).toBe("normal");
    });

    it("should revert to normal when disabling debug mode while in debug", () => {
      timer.setDebugModeEnabled(true);
      timer.setSpeedMode("debug");
      expect(timer.getSpeedMode()).toBe("debug");

      timer.setDebugModeEnabled(false);
      expect(timer.getSpeedMode()).toBe("normal");
    });
  });

  describe("SPEED_MULTIPLIERS", () => {
    it("should have correct values", () => {
      expect(SPEED_MULTIPLIERS.normal).toBe(1.0);
      expect(SPEED_MULTIPLIERS.fast).toBe(2.0);
      expect(SPEED_MULTIPLIERS.debug).toBe(10.0);
    });
  });

  describe("Time formatting", () => {
    it("should format zero as '0s'", () => {
      expect(timer.formatTime(0)).toBe("0s");
    });

    it("should format seconds correctly", () => {
      expect(timer.formatTime(5000)).toBe("5s");
    });

    it("should format minutes and seconds", () => {
      expect(timer.formatTime(90000)).toBe("1m 30s");
    });

    it("should format hours and minutes", () => {
      expect(timer.formatTime(3720000)).toBe("1h 2m");
    });
  });

  describe("Time scale", () => {
    it("should default to 1", () => {
      expect(timer.getTimeScale()).toBe(1);
    });

    it("should update time scale", () => {
      timer.setTimeScale(2);
      expect(timer.getTimeScale()).toBe(2);
    });

    it("should clamp negative to 0", () => {
      timer.setTimeScale(-1);
      expect(timer.getTimeScale()).toBe(0);
    });
  });

  describe("Timer CRUD", () => {
    it("should create and check timer", () => {
      timer.setTimer("test", 1000, () => {});
      expect(timer.hasTimer("test")).toBe(true);
    });

    it("should clear timer", () => {
      timer.setTimer("test", 1000, () => {});
      timer.clearTimer("test");
      expect(timer.hasTimer("test")).toBe(false);
    });

    it("should not crash when clearing nonexistent timer", () => {
      expect(() => timer.clearTimer("nonexistent")).not.toThrow();
    });

    it("should create timer from seconds helper", () => {
      timer.setTimerSeconds("test", 5, () => {});
      expect(timer.hasTimer("test")).toBe(true);
    });

    it("should create timer from minutes helper", () => {
      timer.setTimerMinutes("test", 1, () => {});
      expect(timer.hasTimer("test")).toBe(true);
    });
  });

  describe("Pause/Resume", () => {
    it("should track pause state", () => {
      expect(timer.paused).toBe(false);

      timer.pause();
      expect(timer.paused).toBe(true);

      timer.resume();
      expect(timer.paused).toBe(false);
    });
  });

  describe("Day/Night cycle", () => {
    it("should start at correct hour", () => {
      // Default start hour = 6, gameTime = 0
      expect(timer.getHour()).toBe(6);
    });

    it("should advance hours based on game time", () => {
      // Default: dayLengthMs = 24 * 60 * 1000 = 1,440,000ms
      // 1 hour = 1,440,000 / 24 = 60,000ms
      timer.setGameTime(60000); // 1 hour
      expect(timer.getHour()).toBe(7); // 6 + 1
    });

    it("should wrap hours at 24", () => {
      // Set game time to 18 hours → 6 + 18 = 24 → wraps to 0
      timer.setGameTime(18 * 60000);
      expect(timer.getHour()).toBe(0);
    });

    it("should report daytime correctly", () => {
      timer.setGameTime(6 * 60000); // 12 PM (6 + 6)
      expect(timer.isDaytime()).toBe(true);

      timer.setGameTime(16 * 60000); // 10 PM (6 + 16 = 22)
      expect(timer.isNighttime()).toBe(true);
    });

    it("should get correct time of day periods", () => {
      timer.setGameTime(0); // 6 AM
      expect(timer.getTimeOfDay()).toBe("dawn");

      timer.setGameTime(4 * 60000); // 10 AM
      expect(timer.getTimeOfDay()).toBe("morning");

      timer.setGameTime(6 * 60000); // 12 PM
      expect(timer.getTimeOfDay()).toBe("noon");

      timer.setGameTime(10 * 60000); // 4 PM
      expect(timer.getTimeOfDay()).toBe("afternoon");

      timer.setGameTime(14 * 60000); // 8 PM
      expect(timer.getTimeOfDay()).toBe("evening");

      timer.setGameTime(18 * 60000); // 12 AM
      expect(timer.getTimeOfDay()).toBe("night");
    });

    it("should skip hours correctly", () => {
      timer.setGameTime(0); // 6 AM
      timer.skipHours(6);
      expect(timer.getHour()).toBe(12); // 12 PM
    });

    it("should get day count", () => {
      // Day length = 1,440,000ms. 3 full days.
      timer.setGameTime(3 * 1440000);
      expect(timer.getDay()).toBe(4); // Starts at day 1
    });
  });

  describe("Time string formatting", () => {
    it("should format 24h time correctly", () => {
      timer.setGameTime(6 * 60000 + 30 * 1000); // 6h + 30min worth of time
      // Hour = (6 + 6*60000/60000) % 24 = 12
      expect(timer.getTimeString(true)).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe("Sun intensity", () => {
    it("should return value between 0.1 and 1", () => {
      for (let h = 0; h < 24; h++) {
        timer.setGameTime(h * 60000);
        const intensity = timer.getSunIntensity();
        expect(intensity).toBeGreaterThanOrEqual(0.1);
        expect(intensity).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Reset", () => {
    it("should reset all state", () => {
      timer.setGameTime(100000);
      timer.setSpeedMode("fast");
      timer.setTimer("test", 1000, () => {});

      timer.reset();

      expect(timer.getGameTime()).toBe(0);
      expect(timer.getSpeedMode()).toBe("normal");
      expect(timer.hasTimer("test")).toBe(false);
    });
  });
});
