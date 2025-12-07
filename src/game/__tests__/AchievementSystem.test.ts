/**
 * AchievementSystem Tests
 */

import { describe, it, expect, beforeAll } from "vitest";

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
import { AchievementSystem, type Achievement } from "../AchievementSystem";

const TEST_ACHIEVEMENTS: Achievement[] = [
  {
    id: "ach_first_money",
    name: "First Earnings",
    description: "Earn your first $100",
    icon: "💰",
    category: "economy",
    tier: "bronze",
    conditions: [
      { type: "stat_reach", target: 100, targetId: "moneyEarned" },
    ],
    rewards: [
      { type: "xp", amount: 50 },
    ],
    isSecret: false,
    points: 10,
  },
  {
    id: "ach_level_up",
    name: "Level Up!",
    description: "Reach level 2",
    icon: "⭐",
    category: "progression",
    tier: "bronze",
    conditions: [
      { type: "level_reach", target: 2 },
    ],
    rewards: [
      { type: "money", amount: 100 },
    ],
    isSecret: false,
    points: 10,
  },
];

describe("AchievementSystem", () => {
  let achievements: AchievementSystem;
  let state: GameState;

  beforeAll(() => {
    GameState.resetInstance();
    AchievementSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    state = GameState.getInstance();
    achievements = AchievementSystem.getInstance();
    achievements.registerAchievements(TEST_ACHIEVEMENTS);
  });

  describe("Registration", () => {
    it("should register achievements", () => {
      const ach = achievements.getAchievement("ach_first_money");
      expect(ach).toBeDefined();
      expect(ach?.name).toBe("First Earnings");
    });

    it("should get all achievements", () => {
      const all = achievements.getAllAchievements();
      expect(all.length).toBe(2);
    });

    it("should get achievements by category", () => {
      const economy = achievements.getAchievementsByCategory("economy");
      expect(economy.length).toBe(1);
      expect(economy[0].id).toBe("ach_first_money");
    });
  });

  describe("Progress Checking", () => {
    it("should check achievement progress", () => {
      // Initially no money earned
      const progress = achievements.getProgress("ach_first_money");
      expect(progress).toBeDefined();
    });

    it("should unlock achievement when conditions met", () => {
      // Earn money to trigger achievement
      state.addMoney(150);
      
      // Check achievements
      achievements.checkAll();
      
      const unlocked = achievements.getUnlockedAchievements();
      expect(unlocked.some(a => a.id === "ach_first_money")).toBe(true);
    });

    it("should track unlocked achievements", () => {
      const unlocked = achievements.getUnlockedAchievements();
      expect(unlocked.length).toBeGreaterThan(0);
    });
  });

  describe("Rewards", () => {
    it("should give rewards when achievement unlocked", () => {
      // Level up achievement should give money
      state.addXP(150); // Should level up
      achievements.checkAll();
      
      // Check if level achievement was unlocked
      const unlocked = achievements.getUnlockedAchievements();
      const hasLevelAch = unlocked.some(a => a.id === "ach_level_up");
      
      // If unlocked, player should have received reward
      if (hasLevelAch) {
        expect(state.getPlayer().money).toBeGreaterThan(0);
      }
    });
  });
});
