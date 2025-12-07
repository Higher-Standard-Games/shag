/**
 * NPCSystem Tests
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
import { QuestSystem } from "../QuestSystem";
import { NPCSystem, type NPCTemplate, type NPCDialogue } from "../NPCSystem";

const TEST_NPCS: NPCTemplate[] = [
  {
    id: "npc_test_shopkeeper",
    name: "Test Shopkeeper",
    title: "Merchant",
    icon: "🛒",
    defaultAreaId: "test_area",
    defaultPosition: { x: 10, y: 0, z: 10 },
    unlockLevel: 1,
    shopCategory: "general",
    interactions: [
      {
        id: "shop_browse",
        type: "shop",
        label: "Browse Items",
        icon: "🛒",
        priority: 50,
        action: { type: "open_shop", targetId: "general" },
      },
      {
        id: "shop_chat",
        type: "dialogue",
        label: "Chat",
        icon: "💬",
        priority: 10,
        action: { type: "dialogue", dialogueId: "shopkeeper_idle" },
      },
    ],
  },
  {
    id: "npc_test_quest_giver",
    name: "Quest Giver",
    title: "Guide",
    icon: "❗",
    defaultAreaId: "test_area",
    defaultPosition: { x: 20, y: 0, z: 20 },
    unlockLevel: 1,
    questIds: ["test_quest"],
    interactions: [
      {
        id: "quest_offer",
        type: "quest_available",
        label: "Accept Quest",
        icon: "❗",
        priority: 100,
        conditions: [
          { type: "quest_complete", value: "test_quest", negate: true },
          { type: "quest_active", value: "test_quest", negate: true },
        ],
        action: { type: "start_quest", targetId: "test_quest" },
      },
    ],
  },
  {
    id: "npc_locked",
    name: "Locked NPC",
    title: "Mystery",
    icon: "🔒",
    defaultAreaId: "test_area",
    defaultPosition: { x: 30, y: 0, z: 30 },
    unlockLevel: 10, // High level requirement
    interactions: [],
  },
];

const TEST_DIALOGUES: NPCDialogue[] = [
  {
    id: "shopkeeper_idle",
    lines: [
      "Welcome to my shop!",
      "Take a look around.",
    ],
  },
  {
    id: "dialogue_with_choices",
    lines: [
      "What would you like to do?",
    ],
    choices: [
      { text: "Buy something", nextDialogue: "shopkeeper_idle" },
      { text: "Leave", action: { type: "dialogue" } },
    ],
  },
];

describe("NPCSystem", () => {
  let npcSystem: NPCSystem;

  beforeAll(() => {
    GameState.resetInstance();
    QuestSystem.resetInstance();
    NPCSystem.resetInstance();
    Object.keys(storage).forEach(k => delete storage[k]);
    
    GameState.getInstance();
    npcSystem = NPCSystem.getInstance();
    npcSystem.registerNPCs(TEST_NPCS);
    npcSystem.registerDialogues(TEST_DIALOGUES);
  });

  describe("Registration", () => {
    it("should register NPCs", () => {
      const template = npcSystem.getTemplate("npc_test_shopkeeper");
      expect(template).toBeDefined();
      expect(template?.name).toBe("Test Shopkeeper");
    });

    it("should register dialogues", () => {
      const dialogue = npcSystem.getDialogue("shopkeeper_idle");
      expect(dialogue).toBeDefined();
      expect(dialogue?.lines.length).toBe(2);
    });

    it("should get all templates", () => {
      const all = npcSystem.getAllTemplates();
      expect(all.length).toBe(3);
    });
  });

  describe("NPC Spawning", () => {
    it("should spawn unlocked NPC", () => {
      const instance = npcSystem.spawnNPC("npc_test_shopkeeper");
      expect(instance).not.toBeNull();
      expect(instance?.templateId).toBe("npc_test_shopkeeper");
      expect(instance?.isVisible).toBe(true);
    });

    it("should not spawn locked NPC", () => {
      const instance = npcSystem.spawnNPC("npc_locked");
      expect(instance).toBeNull();
    });

    it("should spawn NPCs in area", () => {
      npcSystem.despawnAllNPCs();
      npcSystem.spawnNPCsInArea("test_area");
      
      const npcsInArea = npcSystem.getNPCsInArea("test_area");
      // Should spawn shopkeeper and quest giver, but not locked NPC
      expect(npcsInArea.length).toBe(2);
    });

    it("should despawn NPC", () => {
      npcSystem.spawnNPC("npc_test_shopkeeper");
      npcSystem.despawnNPC("npc_test_shopkeeper");
      
      const instance = npcSystem.getInstance("npc_test_shopkeeper");
      expect(instance).toBeUndefined();
    });
  });

  describe("NPC Interactions", () => {
    beforeAll(() => {
      npcSystem.despawnAllNPCs();
      npcSystem.spawnNPC("npc_test_shopkeeper");
      npcSystem.spawnNPC("npc_test_quest_giver");
    });

    it("should return available interactions on click", () => {
      const interactions = npcSystem.clickNPC("npc_test_shopkeeper");
      expect(interactions.length).toBeGreaterThan(0);
      expect(interactions.some(i => i.id === "shop_browse")).toBe(true);
    });

    it("should trigger shop interaction", () => {
      let shopOpened = false;
      npcSystem.on((event) => {
        if (event === "open_shop") {
          shopOpened = true;
        }
      });

      const result = npcSystem.triggerInteraction("npc_test_shopkeeper", "shop_browse");
      expect(result).toBe(true);
      expect(shopOpened).toBe(true);
    });

    it("should update NPC icon based on available interactions", () => {
      npcSystem.updateNPCState("npc_test_shopkeeper");
      const instance = npcSystem.getInstance("npc_test_shopkeeper");
      expect(instance?.currentIcon).toBe("shop");
    });
  });

  describe("Dialogue System", () => {
    it("should start dialogue", () => {
      let dialogueStarted = false;
      npcSystem.on((event) => {
        if (event === "dialogue_started") {
          dialogueStarted = true;
        }
      });

      const dialogue = npcSystem.startDialogue("npc_test_shopkeeper", "shopkeeper_idle");
      expect(dialogue).not.toBeNull();
      expect(dialogue?.lines[0]).toBe("Welcome to my shop!");
      expect(dialogueStarted).toBe(true);
    });

    it("should handle dialogue choices", () => {
      let choiceMade = false;
      npcSystem.on((event) => {
        if (event === "dialogue_choice") {
          choiceMade = true;
        }
      });

      npcSystem.selectDialogueChoice("npc_test_shopkeeper", "dialogue_with_choices", 0);
      expect(choiceMade).toBe(true);
    });
  });

  describe("Unlock Conditions", () => {
    it("should check level requirement", () => {
      const isUnlocked = npcSystem.isNPCUnlocked("npc_locked");
      expect(isUnlocked).toBe(false);
    });

    it("should unlock NPC when level requirement met", () => {
      // Level up the player
      const state = GameState.getInstance();
      for (let i = 0; i < 10; i++) {
        state.addXP(1000);
      }
      
      const isUnlocked = npcSystem.isNPCUnlocked("npc_locked");
      expect(isUnlocked).toBe(true);
    });
  });
});
