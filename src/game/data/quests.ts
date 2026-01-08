/**
 * Quests and Achievements
 * 
 * Quest definitions and achievement definitions.
 */

import type { Quest } from "../QuestSystem";
import type { Achievement } from "../AchievementSystem";

// ==================== Quests ====================

export const QUESTS: Quest[] = [
  {
    id: "tutorial_plant",
    name: "First Steps",
    description: "Plant your first seed and watch it grow!",
    icon: "🌱",
    category: "main",
    requiredLevel: 1,
    prerequisites: [],
    objectives: [
      {
        id: "plant_seed",
        type: "build",
        description: "Place a pot",
        target: 1,
        current: 0,
        targetId: "pot_basic",
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 50 },
      { type: "money", amount: 100 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
    dialogue: ["Welcome! Let's get you started with your first plant."],
  },
  {
    id: "first_harvest",
    name: "First Harvest",
    description: "Harvest your first plant!",
    icon: "🌿",
    category: "main",
    requiredLevel: 1,
    prerequisites: ["tutorial_plant"],
    objectives: [
      {
        id: "harvest",
        type: "harvest",
        description: "Harvest a plant",
        target: 1,
        current: 0,
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 100 },
      { type: "money", amount: 200 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
  },
  {
    id: "first_sale",
    name: "First Sale",
    description: "Complete your first customer order!",
    icon: "💰",
    category: "main",
    requiredLevel: 1,
    prerequisites: ["first_harvest"],
    objectives: [
      {
        id: "complete_order",
        type: "complete_order",
        description: "Complete an order",
        target: 1,
        current: 0,
        isComplete: false,
        isOptional: false,
      },
    ],
    rewards: [
      { type: "xp", amount: 150 },
      { type: "money", amount: 300 },
    ],
    autoStart: true,
    canAbandon: false,
    isRepeatable: false,
    repeatCooldown: 0,
    timeLimit: 0,
  },
];

// ==================== Achievements ====================

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_plant",
    name: "Green Thumb",
    description: "Plant your first seed",
    icon: "🌱",
    category: "growing",
    tier: "bronze",
    conditions: [
      { type: "stat_reach", target: 1, targetId: "plantsHarvested" },
    ],
    rewards: [
      { type: "xp", amount: 25 },
    ],
    isSecret: false,
    points: 10,
  },
  {
    id: "harvest_10",
    name: "Budding Farmer",
    description: "Harvest 10 plants",
    icon: "🌿",
    category: "growing",
    tier: "silver",
    conditions: [
      { type: "stat_reach", target: 10, targetId: "plantsHarvested" },
    ],
    rewards: [
      { type: "xp", amount: 100 },
      { type: "money", amount: 500 },
    ],
    isSecret: false,
    points: 25,
  },
  {
    id: "rich",
    name: "Money Maker",
    description: "Earn $10,000 total",
    icon: "💰",
    category: "economy",
    tier: "gold",
    conditions: [
      { type: "stat_reach", target: 10000, targetId: "moneyEarned" },
    ],
    rewards: [
      { type: "xp", amount: 250 },
    ],
    isSecret: false,
    points: 50,
  },
  {
    id: "level_5",
    name: "Rising Star",
    description: "Reach level 5",
    icon: "⭐",
    category: "progression",
    tier: "silver",
    conditions: [
      { type: "level_reach", target: 5 },
    ],
    rewards: [
      { type: "money", amount: 1000 },
    ],
    isSecret: false,
    points: 25,
  },
];
