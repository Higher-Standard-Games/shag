/**
 * NPC Data
 * 
 * NPC templates and dialogues.
 */

import type { NPCTemplate, NPCDialogue } from "../NPCSystem";

// ==================== NPCs ====================

export const NPCS: NPCTemplate[] = [
  // === Tutorial/Guide NPC ===
  {
    id: "npc_mentor",
    name: "Old Pete",
    title: "Retired Grower",
    icon: "👴",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 30, y: 0, z: 40 },
    unlockLevel: 1,
    questIds: ["tutorial_plant", "first_harvest", "first_sale"],
    idleDialogues: [
      "Back in my day, we didn't have all these fancy lights...",
      "Keep at it, kid. You'll get there.",
    ],
    interactions: [
      {
        id: "mentor_quest_tutorial",
        type: "quest_available",
        label: "Learn the Basics",
        icon: "❗",
        priority: 100,
        conditions: [
          { type: "quest_complete", value: "tutorial_plant", negate: true },
          { type: "quest_active", value: "tutorial_plant", negate: true },
        ],
        action: { type: "start_quest", targetId: "tutorial_plant" },
      },
      {
        id: "mentor_quest_harvest",
        type: "quest_available", 
        label: "Time to Harvest",
        icon: "❗",
        priority: 90,
        conditions: [
          { type: "quest_complete", value: "tutorial_plant" },
          { type: "quest_complete", value: "first_harvest", negate: true },
          { type: "quest_active", value: "first_harvest", negate: true },
        ],
        action: { type: "start_quest", targetId: "first_harvest" },
      },
      {
        id: "mentor_chat",
        type: "dialogue",
        label: "Chat",
        icon: "💬",
        priority: 10,
        action: { type: "dialogue", dialogueId: "mentor_idle" },
      },
    ],
  },
  
  // === Seed Shop NPC ===
  {
    id: "npc_seed_dealer",
    name: "Sunny",
    title: "Seed Dealer",
    icon: "🌱",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 60, y: 0, z: 20 },
    unlockLevel: 1,
    shopCategory: "seeds",
    idleDialogues: [
      "Got the freshest seeds in town!",
      "Looking to grow something special?",
    ],
    interactions: [
      {
        id: "seed_shop",
        type: "shop",
        label: "Browse Seeds",
        icon: "🛒",
        priority: 50,
        action: { type: "open_shop", targetId: "seeds" },
      },
      {
        id: "seed_chat",
        type: "dialogue",
        label: "Chat",
        icon: "💬",
        priority: 10,
        action: { type: "dialogue", dialogueId: "seed_dealer_idle" },
      },
    ],
  },
  
  // === Equipment Shop NPC ===
  {
    id: "npc_tech_guy",
    name: "Sparky",
    title: "Equipment Specialist",
    icon: "🔧",
    defaultAreaId: "suburbs_main",
    defaultPosition: { x: 45, y: 0, z: 35 },
    unlockLevel: 3,
    shopCategory: "equipment",
    idleDialogues: [
      "Need some upgrades for your setup?",
      "I've got lights, fans, everything you need!",
    ],
    interactions: [
      {
        id: "equip_shop",
        type: "shop",
        label: "Browse Equipment",
        icon: "🛒",
        priority: 50,
        action: { type: "open_shop", targetId: "equipment" },
      },
    ],
  },
  
  // === Customer NPC (gives orders) ===
  {
    id: "npc_regular_customer",
    name: "Mike",
    title: "Regular Customer",
    icon: "🧔",
    defaultAreaId: "slums_street",
    defaultPosition: { x: 80, y: 0, z: 50 },
    unlockLevel: 2,
    idleDialogues: [
      "Hey, you got anything good?",
      "I'll be back when you have some product.",
    ],
    interactions: [
      {
        id: "customer_order",
        type: "custom",
        label: "Take Order",
        icon: "📋",
        priority: 60,
        conditions: [
          { type: "level", value: 2 },
        ],
        action: { 
          type: "custom", 
          customEvent: "generate_order",
          customData: { customerId: "casual_buyer" },
        },
      },
    ],
  },
  
  // === Locked NPC (appears later) ===
  {
    id: "npc_dealer",
    name: "???",
    title: "Mysterious Figure",
    icon: "🕶️",
    defaultAreaId: "downtown_plaza",
    defaultPosition: { x: 50, y: 0, z: 60 },
    unlockLevel: 5,
    unlockQuest: "first_sale",
    idleDialogues: [
      "You've made a name for yourself...",
      "I might have some... opportunities for you.",
    ],
    interactions: [
      {
        id: "dealer_special",
        type: "quest_available",
        label: "Special Job",
        icon: "❗",
        priority: 100,
        conditions: [
          { type: "level", value: 5 },
        ],
        action: { type: "dialogue", dialogueId: "dealer_intro" },
      },
    ],
  },
];

// ==================== NPC Dialogues ====================

export const NPC_DIALOGUES: NPCDialogue[] = [
  {
    id: "mentor_idle",
    lines: [
      "You know, growing isn't just about the plants.",
      "It's about patience, care, and knowing your customers.",
      "Stick with me, and you'll learn everything you need.",
    ],
  },
  {
    id: "seed_dealer_idle",
    lines: [
      "These seeds? Best genetics in the city.",
      "I've been in this business for years.",
      "Quality seeds mean quality harvest. Remember that.",
    ],
  },
  {
    id: "dealer_intro",
    lines: [
      "So you're the one everyone's talking about.",
      "I've got connections. Big ones.",
      "But first, I need to know I can trust you...",
    ],
    choices: [
      { text: "I'm interested.", nextDialogue: "dealer_job_offer" },
      { text: "Not right now.", action: { type: "dialogue" } },
    ],
  },
  {
    id: "dealer_job_offer",
    lines: [
      "Good. I like ambition.",
      "Come back when you've got $10,000 saved up.",
      "Then we'll talk business.",
    ],
  },
];
