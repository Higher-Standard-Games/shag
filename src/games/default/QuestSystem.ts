/**
 * QuestSystem - Generic quest/mission management
 * 
 * Handles:
 * - Quest definitions (registered by game)
 * - Quest progress tracking
 * - Objective completion
 * - Rewards
 */

import { EventBus } from "../../engine/core/EventBus";
import { GameState } from "./GameState";
import { GameTimer } from "../../engine/core/GameTimer";

/**
 * Quest objective types
 */
export type ObjectiveType =
  | "collect"       // Collect X items
  | "harvest"       // Harvest X plants
  | "build"         // Build X items
  | "earn"          // Earn X money
  | "reach_level"   // Reach level X
  | "complete_order"// Complete X orders
  | "visit"         // Visit a location
  | "talk"          // Talk to NPC
  | "custom";       // Custom objective

/**
 * Quest objective definition
 */
export interface QuestObjective {
  id: string;
  type: ObjectiveType;
  description: string;
  /** Target value (e.g., collect 5 items) */
  target: number;
  /** Current progress */
  current: number;
  /** Optional: specific item/NPC/location ID */
  targetId?: string;
  /** Whether this objective is complete */
  isComplete: boolean;
  /** Whether this objective is optional */
  isOptional: boolean;
  /** Custom data for game-specific handling */
  customData?: Record<string, unknown>;
}

/**
 * Quest reward definition
 */
export interface QuestReward {
  type: "money" | "xp" | "item" | "unlock" | "custom";
  /** Amount for money/xp, quantity for items */
  amount: number;
  /** Item ID for item rewards, unlock ID for unlocks */
  targetId?: string;
  /** Custom reward ID */
  customId?: string;
}

/**
 * Quest definition
 */
export interface Quest {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Quest category (main, side, daily, etc.) */
  category: string;
  /** Required player level */
  requiredLevel: number;
  /** Prerequisites (other quest IDs) */
  prerequisites: string[];
  /** Quest objectives */
  objectives: QuestObjective[];
  /** Rewards on completion */
  rewards: QuestReward[];
  /** Whether quest auto-starts when available */
  autoStart: boolean;
  /** Whether quest can be abandoned */
  canAbandon: boolean;
  /** Whether quest repeats (daily, etc.) */
  isRepeatable: boolean;
  /** Repeat cooldown in ms */
  repeatCooldown: number;
  /** Time limit in ms (0 = no limit) */
  timeLimit: number;
  /** Dialogue/story text */
  dialogue?: string[];
  /** NPC that gives this quest */
  giverNpc?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Active quest instance
 */
export interface ActiveQuest {
  questId: string;
  status: "active" | "completed" | "failed" | "abandoned";
  objectives: QuestObjective[];
  startedAt: number;
  completedAt?: number;
  expiresAt?: number;
}

type QuestEventCallback = (event: string, data: unknown) => void;
type ObjectiveHandler = (objective: QuestObjective, eventData: unknown) => boolean;

export class QuestSystem {
  private static instance: QuestSystem;

  private quests: Map<string, Quest> = new Map();
  private activeQuests: Map<string, ActiveQuest> = new Map();
  private completedQuests: Set<string> = new Set();
  private questCooldowns: Map<string, number> = new Map();
  private objectiveHandlers: Map<ObjectiveType, ObjectiveHandler> = new Map();
  private eventListeners: QuestEventCallback[] = [];
  private updateTaskId = "quest_system_update";

  private constructor() {
    this.registerDefaultHandlers();
  }

  public static getInstance(): QuestSystem {
    if (!QuestSystem.instance) {
      QuestSystem.instance = new QuestSystem();
    }
    return QuestSystem.instance;
  }

  public static resetInstance(): void {
    QuestSystem.instance = null as any;
  }

  // ==================== Initialization ====================

  public init(): void {
    this.startUpdateLoop();
  }

  private startUpdateLoop(): void {
    // Check for expired quests
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 5000, () => {
      this.checkExpiredQuests();
    });
  }

  private registerDefaultHandlers(): void {
    // Collect items
    this.objectiveHandlers.set("collect", (obj, data) => {
      const { itemId, quantity } = data as { itemId: string; quantity: number };
      if (!obj.targetId || obj.targetId === itemId) {
        obj.current += quantity;
        return obj.current >= obj.target;
      }
      return false;
    });

    // Harvest plants
    this.objectiveHandlers.set("harvest", (obj, data) => {
      const { strainId, quantity } = data as { strainId?: string; quantity: number };
      if (!obj.targetId || obj.targetId === strainId) {
        obj.current += quantity;
        return obj.current >= obj.target;
      }
      return false;
    });

    // Build items
    this.objectiveHandlers.set("build", (obj, data) => {
      const { itemId } = data as { itemId: string };
      if (!obj.targetId || obj.targetId === itemId) {
        obj.current += 1;
        return obj.current >= obj.target;
      }
      return false;
    });

    // Earn money
    this.objectiveHandlers.set("earn", (obj, data) => {
      const { amount } = data as { amount: number };
      obj.current += amount;
      return obj.current >= obj.target;
    });

    // Reach level
    this.objectiveHandlers.set("reach_level", (obj) => {
      const level = GameState.getInstance().getPlayer().level;
      obj.current = level;
      return level >= obj.target;
    });

    // Complete orders
    this.objectiveHandlers.set("complete_order", (obj) => {
      obj.current += 1;
      return obj.current >= obj.target;
    });

    // Visit location
    this.objectiveHandlers.set("visit", (obj, data) => {
      const { locationId } = data as { locationId: string };
      if (obj.targetId === locationId) {
        obj.current = 1;
        return true;
      }
      return false;
    });

    // Talk to NPC
    this.objectiveHandlers.set("talk", (obj, data) => {
      const { npcId } = data as { npcId: string };
      if (obj.targetId === npcId) {
        obj.current = 1;
        return true;
      }
      return false;
    });
  }

  // ==================== Quest Registration ====================

  public registerQuest(quest: Quest): void {
    this.quests.set(quest.id, quest);
  }

  public registerQuests(quests: Quest[]): void {
    for (const quest of quests) {
      this.registerQuest(quest);
    }
  }

  public getQuest(id: string): Quest | undefined {
    return this.quests.get(id);
  }

  public clearQuests(): void {
    this.quests.clear();
  }

  // ==================== Custom Handlers ====================

  public registerObjectiveHandler(type: ObjectiveType, handler: ObjectiveHandler): void {
    this.objectiveHandlers.set(type, handler);
  }

  // ==================== Quest Availability ====================

  public getAvailableQuests(): Quest[] {
    const level = GameState.getInstance().getPlayer().level;
    const now = GameTimer.getInstance().getGameTime();

    return Array.from(this.quests.values()).filter(quest => {
      // Check level
      if (quest.requiredLevel > level) return false;

      // Check if already active
      if (this.activeQuests.has(quest.id)) return false;

      // Check if completed (and not repeatable)
      if (this.completedQuests.has(quest.id) && !quest.isRepeatable) return false;

      // Check cooldown for repeatable quests
      if (quest.isRepeatable) {
        const cooldownEnd = this.questCooldowns.get(quest.id) || 0;
        if (now < cooldownEnd) return false;
      }

      // Check prerequisites
      for (const prereq of quest.prerequisites) {
        if (!this.completedQuests.has(prereq)) return false;
      }

      return true;
    });
  }

  public getActiveQuests(): ActiveQuest[] {
    return Array.from(this.activeQuests.values()).filter(q => q.status === "active");
  }

  public getCompletedQuests(): string[] {
    return Array.from(this.completedQuests);
  }

  // ==================== Quest Actions ====================

  /**
   * Start a quest
   */
  public startQuest(questId: string): boolean {
    const quest = this.quests.get(questId);
    if (!quest) return false;

    // Check if available
    const available = this.getAvailableQuests();
    if (!available.find(q => q.id === questId)) {
      this.emit("quest_unavailable", { questId });
      return false;
    }

    const now = GameTimer.getInstance().getGameTime();

    // Create active quest with fresh objectives
    const active: ActiveQuest = {
      questId,
      status: "active",
      objectives: quest.objectives.map(obj => ({ ...obj, current: 0, isComplete: false })),
      startedAt: now,
      expiresAt: quest.timeLimit > 0 ? now + quest.timeLimit : undefined,
    };

    this.activeQuests.set(questId, active);
    this.emit("quest_started", { quest, active });
    console.log(`Quest started: ${quest.name}`);

    return true;
  }

  /**
   * Abandon a quest
   */
  public abandonQuest(questId: string): boolean {
    const active = this.activeQuests.get(questId);
    if (!active || active.status !== "active") return false;

    const quest = this.quests.get(questId);
    if (!quest?.canAbandon) return false;

    active.status = "abandoned";
    this.activeQuests.delete(questId);
    this.emit("quest_abandoned", { questId });

    return true;
  }

  /**
   * Update objective progress
   */
  public updateObjective(
    objectiveType: ObjectiveType,
    eventData: unknown
  ): void {
    const handler = this.objectiveHandlers.get(objectiveType);
    if (!handler) return;

    for (const active of this.activeQuests.values()) {
      if (active.status !== "active") continue;

      let questUpdated = false;

      for (const objective of active.objectives) {
        if (objective.type !== objectiveType || objective.isComplete) continue;

        const wasComplete = objective.isComplete;
        objective.isComplete = handler(objective, eventData);

        if (!wasComplete && objective.isComplete) {
          this.emit("objective_completed", { 
            questId: active.questId, 
            objective,
          });
          questUpdated = true;
        } else if (objective.current !== objective.target) {
          questUpdated = true;
        }
      }

      if (questUpdated) {
        this.checkQuestCompletion(active);
      }
    }
  }

  private checkQuestCompletion(active: ActiveQuest): void {
    // Check if all required objectives are complete
    const requiredComplete = active.objectives
      .filter(o => !o.isOptional)
      .every(o => o.isComplete);

    if (requiredComplete) {
      this.completeQuest(active.questId);
    }
  }

  /**
   * Complete a quest and give rewards
   */
  public completeQuest(questId: string): boolean {
    const active = this.activeQuests.get(questId);
    if (!active || active.status !== "active") return false;

    const quest = this.quests.get(questId);
    if (!quest) return false;

    const now = GameTimer.getInstance().getGameTime();
    active.status = "completed";
    active.completedAt = now;

    // Give rewards
    const state = GameState.getInstance();
    for (const reward of quest.rewards) {
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
      }
    }

    // Mark completed
    this.completedQuests.add(questId);
    this.activeQuests.delete(questId);

    // Set cooldown for repeatable
    if (quest.isRepeatable && quest.repeatCooldown > 0) {
      this.questCooldowns.set(questId, now + quest.repeatCooldown);
    }

    this.emit("quest_completed", { quest, active, rewards: quest.rewards });
    console.log(`Quest completed: ${quest.name}`);

    return true;
  }

  private checkExpiredQuests(): void {
    const now = GameTimer.getInstance().getGameTime();

    for (const active of this.activeQuests.values()) {
      if (active.status !== "active") continue;
      if (active.expiresAt && now >= active.expiresAt) {
        active.status = "failed";
        this.emit("quest_failed", { questId: active.questId, reason: "expired" });
        this.activeQuests.delete(active.questId);
      }
    }
  }

  // ==================== Auto-start ====================

  /**
   * Check and start auto-start quests
   */
  public checkAutoStart(): void {
    const available = this.getAvailableQuests();
    for (const quest of available) {
      if (quest.autoStart) {
        this.startQuest(quest.id);
      }
    }
  }

  // ==================== Events ====================

  public onQuestEvent(callback: QuestEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offQuestEvent(callback: QuestEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    // Legacy callback system
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
    // Global EventBus
    EventBus.emit(`quest:${event}`, data as object);
  }

  // ==================== Serialization ====================

  public getState(): {
    activeQuests: ActiveQuest[];
    completedQuests: string[];
    cooldowns: Record<string, number>;
  } {
    return {
      activeQuests: Array.from(this.activeQuests.values()),
      completedQuests: Array.from(this.completedQuests),
      cooldowns: Object.fromEntries(this.questCooldowns),
    };
  }

  public loadState(state: {
    activeQuests?: ActiveQuest[];
    completedQuests?: string[];
    cooldowns?: Record<string, number>;
  }): void {
    if (state.activeQuests) {
      this.activeQuests.clear();
      for (const active of state.activeQuests) {
        this.activeQuests.set(active.questId, active);
      }
    }
    if (state.completedQuests) {
      this.completedQuests = new Set(state.completedQuests);
    }
    if (state.cooldowns) {
      this.questCooldowns = new Map(Object.entries(state.cooldowns));
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.activeQuests.clear();
    this.completedQuests.clear();
    this.questCooldowns.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    this.clear();
    this.eventListeners = [];
  }
}
