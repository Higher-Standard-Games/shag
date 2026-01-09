/**
 * AchievementSystem - Generic achievement/trophy management
 * 
 * Handles:
 * - Achievement definitions (registered by game)
 * - Progress tracking
 * - Unlock conditions
 * - Rewards
 */

import { GameState } from "./GameState";

/**
 * Achievement condition types
 */
export type ConditionType =
  | "stat_reach"      // Reach a stat value
  | "stat_total"      // Accumulate total stat
  | "level_reach"     // Reach player level
  | "item_collect"    // Collect X of an item
  | "quest_complete"  // Complete specific quest
  | "achievement"     // Unlock another achievement
  | "custom";         // Custom condition

/**
 * Achievement condition
 */
export interface AchievementCondition {
  type: ConditionType;
  /** Target value */
  target: number;
  /** Stat name, item ID, quest ID, etc. */
  targetId?: string;
  /** Custom condition ID */
  customId?: string;
}

/**
 * Achievement reward
 */
export interface AchievementReward {
  type: "money" | "xp" | "item" | "unlock" | "title" | "custom";
  amount: number;
  targetId?: string;
}

/**
 * Achievement definition
 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Category for grouping */
  category: string;
  /** Rarity/tier */
  tier: "bronze" | "silver" | "gold" | "platinum" | "secret";
  /** Unlock conditions (all must be met) */
  conditions: AchievementCondition[];
  /** Rewards on unlock */
  rewards: AchievementReward[];
  /** Whether to hide until unlocked */
  isSecret: boolean;
  /** Points value */
  points: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Achievement progress
 */
export interface AchievementProgress {
  achievementId: string;
  /** Progress per condition */
  conditionProgress: number[];
  /** Whether unlocked */
  isUnlocked: boolean;
  /** When unlocked */
  unlockedAt?: number;
}

type AchievementEventCallback = (event: string, data: unknown) => void;
type ConditionChecker = (condition: AchievementCondition) => number;

export class AchievementSystem {
  private static instance: AchievementSystem;

  private achievements: Map<string, Achievement> = new Map();
  private progress: Map<string, AchievementProgress> = new Map();
  private conditionCheckers: Map<ConditionType, ConditionChecker> = new Map();
  private eventListeners: AchievementEventCallback[] = [];

  private constructor() {
    this.registerDefaultCheckers();
  }

  public static getInstance(): AchievementSystem {
    if (!AchievementSystem.instance) {
      AchievementSystem.instance = new AchievementSystem();
    }
    return AchievementSystem.instance;
  }

  public static resetInstance(): void {
    AchievementSystem.instance = null as any;
  }

  // ==================== Default Condition Checkers ====================

  private registerDefaultCheckers(): void {
    // Stat reach - uses generic stat key
    this.conditionCheckers.set("stat_reach", (cond) => {
      return cond.targetId ? GameState.getInstance().getStat(cond.targetId) : 0;
    });

    // Stat total (same as reach for now)
    this.conditionCheckers.set("stat_total", (cond) => {
      return cond.targetId ? GameState.getInstance().getStat(cond.targetId) : 0;
    });

    // Level reach
    this.conditionCheckers.set("level_reach", () => {
      return GameState.getInstance().getPlayer().level;
    });

    // Item collect
    this.conditionCheckers.set("item_collect", (cond) => {
      const inventory = GameState.getInstance().getInventory();
      const item = inventory.items.find(i => i.id === cond.targetId);
      return item?.quantity || 0;
    });

    // Quest complete
    this.conditionCheckers.set("quest_complete", (cond) => {
      // This would need QuestSystem integration
      // For now, check unlocks as a proxy
      const unlocks = GameState.getInstance().getUnlocks();
      return unlocks.includes(`quest_${cond.targetId}`) ? 1 : 0;
    });

    // Achievement unlock
    this.conditionCheckers.set("achievement", (cond) => {
      const prog = this.progress.get(cond.targetId || "");
      return prog?.isUnlocked ? 1 : 0;
    });
  }

  // ==================== Registration ====================

  public registerAchievement(achievement: Achievement): void {
    this.achievements.set(achievement.id, achievement);
    
    // Initialize progress if not exists
    if (!this.progress.has(achievement.id)) {
      this.progress.set(achievement.id, {
        achievementId: achievement.id,
        conditionProgress: achievement.conditions.map(() => 0),
        isUnlocked: false,
      });
    }
  }

  public registerAchievements(achievements: Achievement[]): void {
    for (const achievement of achievements) {
      this.registerAchievement(achievement);
    }
  }

  public getAchievement(id: string): Achievement | undefined {
    return this.achievements.get(id);
  }

  public clearAchievements(): void {
    this.achievements.clear();
    this.progress.clear();
  }

  // ==================== Custom Checkers ====================

  public registerConditionChecker(type: ConditionType, checker: ConditionChecker): void {
    this.conditionCheckers.set(type, checker);
  }

  // ==================== Queries ====================

  public getAllAchievements(): Achievement[] {
    return Array.from(this.achievements.values());
  }

  public getVisibleAchievements(): Achievement[] {
    return this.getAllAchievements().filter(a => {
      if (a.isSecret) {
        const prog = this.progress.get(a.id);
        return prog?.isUnlocked;
      }
      return true;
    });
  }

  public getUnlockedAchievements(): Achievement[] {
    return this.getAllAchievements().filter(a => {
      const prog = this.progress.get(a.id);
      return prog?.isUnlocked;
    });
  }

  public getLockedAchievements(): Achievement[] {
    return this.getAllAchievements().filter(a => {
      const prog = this.progress.get(a.id);
      return !prog?.isUnlocked;
    });
  }

  public getAchievementsByCategory(category: string): Achievement[] {
    return this.getAllAchievements().filter(a => a.category === category);
  }

  public getProgress(achievementId: string): AchievementProgress | undefined {
    return this.progress.get(achievementId);
  }

  public getTotalPoints(): number {
    let total = 0;
    for (const [id, prog] of this.progress) {
      if (prog.isUnlocked) {
        const achievement = this.achievements.get(id);
        if (achievement) {
          total += achievement.points;
        }
      }
    }
    return total;
  }

  public getUnlockPercentage(): number {
    const total = this.achievements.size;
    if (total === 0) return 0;
    
    const unlocked = Array.from(this.progress.values()).filter(p => p.isUnlocked).length;
    return (unlocked / total) * 100;
  }

  // ==================== Progress Checking ====================

  /**
   * Check all achievements for completion
   */
  public checkAll(): void {
    for (const achievement of this.achievements.values()) {
      this.checkAchievement(achievement.id);
    }
  }

  /**
   * Check a specific achievement
   */
  public checkAchievement(achievementId: string): boolean {
    const achievement = this.achievements.get(achievementId);
    if (!achievement) return false;

    const prog = this.progress.get(achievementId);
    if (!prog || prog.isUnlocked) return false;

    let allMet = true;

    // Check each condition
    for (let i = 0; i < achievement.conditions.length; i++) {
      const condition = achievement.conditions[i];
      const checker = this.conditionCheckers.get(condition.type);
      
      if (checker) {
        const current = checker(condition);
        prog.conditionProgress[i] = current;
        
        if (current < condition.target) {
          allMet = false;
        }
      } else if (condition.type !== "custom") {
        allMet = false;
      }
    }

    if (allMet) {
      this.unlockAchievement(achievementId);
      return true;
    }

    return false;
  }

  /**
   * Manually unlock an achievement
   */
  public unlockAchievement(achievementId: string): boolean {
    const achievement = this.achievements.get(achievementId);
    if (!achievement) return false;

    const prog = this.progress.get(achievementId);
    if (!prog || prog.isUnlocked) return false;

    prog.isUnlocked = true;
    prog.unlockedAt = Date.now();

    // Give rewards
    const state = GameState.getInstance();
    for (const reward of achievement.rewards) {
      switch (reward.type) {
        case "money":
          state.addMoney(reward.amount);
          break;
        case "xp":
          state.addXP(reward.amount);
          break;
        case "item":
          if (reward.targetId) {
            state.addItem(reward.targetId, "special", reward.amount);
          }
          break;
        case "unlock":
          if (reward.targetId) {
            state.unlock(reward.targetId);
          }
          break;
        case "title":
          if (reward.targetId) {
            state.unlock(`title_${reward.targetId}`);
          }
          break;
      }
    }

    this.emit("achievement_unlocked", { achievement, progress: prog });
    console.log(`Achievement unlocked: ${achievement.name}!`);

    // Check achievements that depend on this one
    this.checkAll();

    return true;
  }

  /**
   * Update progress for custom conditions
   */
  public updateCustomProgress(
    achievementId: string,
    conditionIndex: number,
    value: number
  ): void {
    const prog = this.progress.get(achievementId);
    if (!prog || prog.isUnlocked) return;

    prog.conditionProgress[conditionIndex] = value;
    this.checkAchievement(achievementId);
  }

  // ==================== Events ====================

  public onAchievementEvent(callback: AchievementEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offAchievementEvent(callback: AchievementEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
  }

  // ==================== Serialization ====================

  public getState(): AchievementProgress[] {
    return Array.from(this.progress.values());
  }

  public loadState(progressList: AchievementProgress[]): void {
    for (const prog of progressList) {
      this.progress.set(prog.achievementId, prog);
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.progress.clear();
  }

  public dispose(): void {
    this.clear();
    this.eventListeners = [];
  }
}
