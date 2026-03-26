/**
 * GameClock — Virtual day/night cycle tests
 *
 * Verifies time progression, period detection, sun/moon position,
 * scheduled events, save/load, and formatting.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { GameClock } from "../core/GameClock";

describe("GameClock", () => {
  let clock: GameClock;

  beforeEach(() => {
    // Get singleton and reset
    clock = GameClock.getInstance();
    clock.reset();
  });

  describe("Initialization", () => {
    it("should start at default 8 AM on day 1", () => {
      const time = clock.getTimeOfDay();
      expect(time.hour).toBe(8);
      expect(time.minute).toBe(0);
      expect(clock.getCurrentDay()).toBe(1);
    });

    it("should accept custom start hour", () => {
      clock.init({ dayLengthSeconds: 180, startHour: 14, startDay: 3 });
      const time = clock.getTimeOfDay();
      expect(time.hour).toBe(14);
      expect(clock.getCurrentDay()).toBe(3);
    });

    it("should preserve time when preserveTime is true", () => {
      clock.setTime(16, 30);
      const day = clock.getCurrentDay();

      clock.init({ dayLengthSeconds: 60 }, true);

      expect(clock.getTimeOfDay().hour).toBe(16);
      expect(clock.getCurrentDay()).toBe(day);
    });
  });

  describe("Time progression", () => {
    it("should advance time on update", () => {
      clock.init({ dayLengthSeconds: 24 }); // 1 sec = 1 hour
      clock.setTime(12, 0);

      // Advance 1 second = 1 hour
      clock.update(1);

      expect(clock.getTimeOfDay().hour).toBe(13);
    });

    it("should roll over to next day", () => {
      clock.init({ dayLengthSeconds: 24 }); // 1 sec = 1 hour
      clock.setTime(23, 0);

      // Advance 2 hours → crosses midnight
      clock.update(2);

      expect(clock.getCurrentDay()).toBe(2);
      expect(clock.getTimeOfDay().hour).toBe(1);
    });

    it("should not advance when paused", () => {
      clock.init({ dayLengthSeconds: 24 });
      clock.setTime(12, 0);

      clock.pause();
      clock.update(5); // 5 hours would normally pass

      expect(clock.getTimeOfDay().hour).toBe(12);
    });
  });

  describe("Time periods", () => {
    it("should classify night (0-5)", () => {
      clock.setTime(3);
      expect(clock.getTimeOfDay().period).toBe("night");
    });

    it("should classify dawn (5-7)", () => {
      clock.setTime(6);
      expect(clock.getTimeOfDay().period).toBe("dawn");
    });

    it("should classify morning (7-12)", () => {
      clock.setTime(10);
      expect(clock.getTimeOfDay().period).toBe("morning");
    });

    it("should classify afternoon (12-17)", () => {
      clock.setTime(14);
      expect(clock.getTimeOfDay().period).toBe("afternoon");
    });

    it("should classify dusk (17-19)", () => {
      clock.setTime(18);
      expect(clock.getTimeOfDay().period).toBe("dusk");
    });

    it("should classify evening (19-24)", () => {
      clock.setTime(22);
      expect(clock.getTimeOfDay().period).toBe("evening");
    });
  });

  describe("isDaytime / isNighttime", () => {
    it("should be daytime from 6-18", () => {
      clock.setTime(12);
      expect(clock.isDaytime()).toBe(true);
      expect(clock.isNighttime()).toBe(false);
    });

    it("should be nighttime before 6", () => {
      clock.setTime(3);
      expect(clock.isDaytime()).toBe(false);
      expect(clock.isNighttime()).toBe(true);
    });

    it("should be nighttime after 18", () => {
      clock.setTime(21);
      expect(clock.isDaytime()).toBe(false);
    });
  });

  describe("Sun/Moon position", () => {
    it("should have sun at 0 at sunrise (6 AM)", () => {
      clock.setTime(6);
      expect(clock.getSunPosition()).toBeCloseTo(0, 1);
    });

    it("should have sun at 0.5 at noon (12 PM)", () => {
      clock.setTime(12);
      expect(clock.getSunPosition()).toBeCloseTo(0.5, 1);
    });

    it("should return -1 for sun at night", () => {
      clock.setTime(3);
      expect(clock.getSunPosition()).toBe(-1);
    });

    it("should return -1 for moon during day", () => {
      clock.setTime(12);
      expect(clock.getMoonPosition()).toBe(-1);
    });

    it("should have valid moon position at night", () => {
      clock.setTime(0);
      const pos = clock.getMoonPosition();
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(1);
    });
  });

  describe("Time formatting", () => {
    it("should format 24h time correctly", () => {
      clock.setTime(14, 30);
      expect(clock.formatTime()).toBe("14:30");
    });

    it("should format midnight correctly", () => {
      clock.setTime(0, 0);
      expect(clock.formatTime()).toBe("00:00");
    });

    it("should format 12h time correctly", () => {
      clock.setTime(14, 30);
      expect(clock.formatTime12h()).toBe("2:30 PM");
    });

    it("should format 12h morning correctly", () => {
      clock.setTime(9, 5);
      expect(clock.formatTime12h()).toBe("9:05 AM");
    });
  });

  describe("Pause/Resume", () => {
    it("should track pause state", () => {
      expect(clock.isPausedState()).toBe(false);

      clock.pause();
      expect(clock.isPausedState()).toBe(true);

      clock.resume();
      expect(clock.isPausedState()).toBe(false);
    });
  });

  describe("Save/Load", () => {
    it("should roundtrip through save/load", () => {
      clock.setTime(15, 45);
      clock.setDay(5);

      const saveData = clock.getSaveData() as any;

      clock.reset(); // Clear state
      clock.loadSaveData(saveData);

      expect(clock.getTimeOfDay().hour).toBe(15);
      expect(clock.getCurrentDay()).toBe(5);
    });
  });
});
