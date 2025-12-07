/**
 * NPCSystem - Generic NPC management with interactions
 * 
 * NPCs can:
 * - Give/complete quests (! icon)
 * - Offer shop/trade ($ icon)
 * - Provide dialogue
 * - Trigger custom events
 * - Have schedules and locations
 */

import { GameState } from "./GameState";
import { QuestSystem } from "./QuestSystem";

// ==================== Types ====================

export type NPCInteractionType = 
  | "quest_available"    // Has quest to give (!)
  | "quest_ready"        // Quest ready to turn in (?)
  | "shop"               // Opens shop ($)
  | "dialogue"           // Just talks
  | "trade"              // Direct trade
  | "service"            // Provides a service
  | "custom";            // Custom interaction

export type NPCIconType = 
  | "quest_available"    // Yellow !
  | "quest_ready"        // Yellow ?
  | "quest_progress"     // Gray ?
  | "shop"               // $ or bag icon
  | "dialogue"           // Speech bubble
  | "locked"             // Lock icon
  | "none";              // No icon

export interface NPCInteraction {
  id: string;
  type: NPCInteractionType;
  label: string;              // "Accept Quest", "Browse Shop", etc.
  icon?: string;              // Emoji or icon ID
  
  // Conditions to show this interaction
  conditions?: InteractionCondition[];
  
  // What happens when triggered
  action: InteractionAction;
  
  // Priority for icon display (higher = shown first)
  priority: number;
}

export interface InteractionCondition {
  type: "level" | "quest_active" | "quest_complete" | "has_item" | "stat" | "custom";
  value: string | number;
  negate?: boolean;  // If true, condition must NOT be met
}

export interface InteractionAction {
  type: "start_quest" | "complete_quest" | "open_shop" | "dialogue" | "trade" | "give_item" | "custom";
  targetId?: string;       // Quest ID, Shop category, etc.
  dialogueId?: string;     // Dialogue to show
  customEvent?: string;    // Custom event to emit
  customData?: unknown;    // Data for custom events
}

export interface NPCDialogue {
  id: string;
  lines: string[];
  speaker?: string;        // Override NPC name
  emotion?: string;        // happy, sad, angry, etc.
  choices?: DialogueChoice[];
  nextDialogue?: string;   // Chain to another dialogue
}

export interface DialogueChoice {
  text: string;
  nextDialogue?: string;
  action?: InteractionAction;
  conditions?: InteractionCondition[];
}

export interface NPCScheduleEntry {
  startHour: number;       // 0-23
  endHour: number;
  areaId: string;
  position: { x: number; y: number; z: number };
  activity?: string;       // "working", "sleeping", "wandering"
}

export interface NPCTemplate {
  id: string;
  name: string;
  title?: string;          // "Shopkeeper", "Quest Giver", etc.
  icon: string;            // Portrait/avatar
  
  // Appearance
  modelId?: string;        // 3D model or sprite
  scale?: number;
  
  // Location
  defaultAreaId: string;
  defaultPosition: { x: number; y: number; z: number };
  schedule?: NPCScheduleEntry[];
  
  // Unlock conditions
  unlockLevel?: number;
  unlockQuest?: string;
  unlockConditions?: InteractionCondition[];
  
  // Interactions this NPC offers
  interactions: NPCInteraction[];
  
  // Default dialogue when no interactions available
  idleDialogues?: string[];
  
  // Shop integration
  shopCategory?: string;   // If NPC is a shopkeeper
  
  // Quest integration  
  questIds?: string[];     // Quests this NPC gives
  
  // Metadata
  faction?: string;
  tags?: string[];
}

export interface NPCInstance {
  templateId: string;
  currentAreaId: string;
  position: { x: number; y: number; z: number };
  isVisible: boolean;
  currentIcon: NPCIconType;
  availableInteractions: string[];  // IDs of currently available interactions
}

type NPCEventType = 
  | "npc_spawned"
  | "npc_despawned"
  | "npc_clicked"
  | "interaction_started"
  | "interaction_completed"
  | "dialogue_started"
  | "dialogue_choice"
  | "dialogue_ended"
  | "icon_changed"
  | "open_shop";

type NPCCallback = (event: NPCEventType, data: unknown) => void;

// ==================== NPCSystem ====================

export class NPCSystem {
  private static instance: NPCSystem;
  
  private templates: Map<string, NPCTemplate> = new Map();
  private instances: Map<string, NPCInstance> = new Map();
  private dialogues: Map<string, NPCDialogue> = new Map();
  private listeners: NPCCallback[] = [];
  
  // Custom condition checkers
  private conditionCheckers: Map<string, (value: string) => boolean> = new Map();
  
  // Custom action handlers
  private actionHandlers: Map<string, (npcId: string, action: InteractionAction) => void> = new Map();
  
  private constructor() {
    this.registerDefaultHandlers();
  }
  
  public static getInstance(): NPCSystem {
    if (!NPCSystem.instance) {
      NPCSystem.instance = new NPCSystem();
    }
    return NPCSystem.instance;
  }
  
  public static resetInstance(): void {
    NPCSystem.instance = null as any;
  }
  
  // ==================== Default Handlers ====================
  
  private registerDefaultHandlers(): void {
    // Quest available check
    this.conditionCheckers.set("quest_available", (questId) => {
      const quest = QuestSystem.getInstance().getQuest(questId);
      if (!quest) return false;
      const available = QuestSystem.getInstance().getAvailableQuests();
      return available.some(q => q.id === questId);
    });
    
    // Quest active check
    this.conditionCheckers.set("quest_active", (questId) => {
      const active = QuestSystem.getInstance().getActiveQuests();
      return active.some(q => q.questId === questId);
    });
    
    // Quest complete check
    this.conditionCheckers.set("quest_complete", (questId) => {
      return QuestSystem.getInstance().getCompletedQuests().includes(questId);
    });
  }
  
  // ==================== Registration ====================
  
  public registerNPC(template: NPCTemplate): void {
    this.templates.set(template.id, template);
  }
  
  public registerNPCs(templates: NPCTemplate[]): void {
    for (const template of templates) {
      this.registerNPC(template);
    }
    console.log(`NPCSystem: Registered ${templates.length} NPCs`);
  }
  
  public registerDialogue(dialogue: NPCDialogue): void {
    this.dialogues.set(dialogue.id, dialogue);
  }
  
  public registerDialogues(dialogues: NPCDialogue[]): void {
    for (const dialogue of dialogues) {
      this.registerDialogue(dialogue);
    }
  }
  
  public registerConditionChecker(type: string, checker: (value: string) => boolean): void {
    this.conditionCheckers.set(type, checker);
  }
  
  public registerActionHandler(type: string, handler: (npcId: string, action: InteractionAction) => void): void {
    this.actionHandlers.set(type, handler);
  }
  
  // ==================== Getters ====================
  
  public getTemplate(id: string): NPCTemplate | undefined {
    return this.templates.get(id);
  }
  
  public getInstance(id: string): NPCInstance | undefined {
    return this.instances.get(id);
  }
  
  public getDialogue(id: string): NPCDialogue | undefined {
    return this.dialogues.get(id);
  }
  
  public getAllTemplates(): NPCTemplate[] {
    return Array.from(this.templates.values());
  }
  
  // ==================== NPC Spawning ====================
  
  public spawnNPC(templateId: string, areaId?: string, position?: { x: number; y: number; z: number }): NPCInstance | null {
    const template = this.templates.get(templateId);
    if (!template) return null;
    
    // Check unlock conditions
    if (!this.isNPCUnlocked(templateId)) return null;
    
    const instance: NPCInstance = {
      templateId,
      currentAreaId: areaId || template.defaultAreaId,
      position: position || { ...template.defaultPosition },
      isVisible: true,
      currentIcon: "none",
      availableInteractions: [],
    };
    
    this.instances.set(templateId, instance);
    this.updateNPCState(templateId);
    
    this.emit("npc_spawned", { npcId: templateId, instance });
    return instance;
  }
  
  public despawnNPC(templateId: string): void {
    const instance = this.instances.get(templateId);
    if (instance) {
      this.instances.delete(templateId);
      this.emit("npc_despawned", { npcId: templateId });
    }
  }
  
  public spawnNPCsInArea(areaId: string): void {
    for (const template of this.templates.values()) {
      if (template.defaultAreaId === areaId && this.isNPCUnlocked(template.id)) {
        this.spawnNPC(template.id);
      }
    }
  }
  
  public despawnAllNPCs(): void {
    for (const id of this.instances.keys()) {
      this.despawnNPC(id);
    }
  }
  
  // ==================== NPC State ====================
  
  public isNPCUnlocked(templateId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;
    
    const state = GameState.getInstance();
    
    // Check level
    if (template.unlockLevel && state.getPlayer().level < template.unlockLevel) {
      return false;
    }
    
    // Check quest
    if (template.unlockQuest) {
      const completed = QuestSystem.getInstance().getCompletedQuests();
      if (!completed.includes(template.unlockQuest)) {
        return false;
      }
    }
    
    // Check custom conditions
    if (template.unlockConditions) {
      for (const cond of template.unlockConditions) {
        if (!this.checkCondition(cond)) return false;
      }
    }
    
    return true;
  }
  
  public updateNPCState(templateId: string): void {
    const instance = this.instances.get(templateId);
    const template = this.templates.get(templateId);
    if (!instance || !template) return;
    
    // Find available interactions
    const available: string[] = [];
    let highestPriority = -1;
    let bestIcon: NPCIconType = "none";
    
    for (const interaction of template.interactions) {
      if (this.isInteractionAvailable(interaction)) {
        available.push(interaction.id);
        
        // Determine icon based on highest priority interaction
        if (interaction.priority > highestPriority) {
          highestPriority = interaction.priority;
          bestIcon = this.getIconForInteraction(interaction);
        }
      }
    }
    
    const iconChanged = instance.currentIcon !== bestIcon;
    instance.availableInteractions = available;
    instance.currentIcon = bestIcon;
    
    if (iconChanged) {
      this.emit("icon_changed", { npcId: templateId, icon: bestIcon });
    }
  }
  
  public updateAllNPCStates(): void {
    for (const id of this.instances.keys()) {
      this.updateNPCState(id);
    }
  }
  
  private getIconForInteraction(interaction: NPCInteraction): NPCIconType {
    switch (interaction.type) {
      case "quest_available": return "quest_available";
      case "quest_ready": return "quest_ready";
      case "shop": return "shop";
      case "dialogue": return "dialogue";
      default: return "none";
    }
  }
  
  // ==================== Conditions ====================
  
  private checkCondition(condition: InteractionCondition): boolean {
    const state = GameState.getInstance();
    let result = false;
    
    switch (condition.type) {
      case "level":
        result = state.getPlayer().level >= (condition.value as number);
        break;
        
      case "quest_active":
        const activeQuests = QuestSystem.getInstance().getActiveQuests();
        result = activeQuests.some(q => q.questId === condition.value);
        break;
        
      case "quest_complete":
        result = QuestSystem.getInstance().getCompletedQuests().includes(condition.value as string);
        break;
        
      case "has_item":
        result = state.hasItem(condition.value as string, 1);
        break;
        
      case "stat":
        const [statName, statValue] = (condition.value as string).split(":");
        result = state.getStat(statName) >= parseInt(statValue);
        break;
        
      case "custom":
        const checker = this.conditionCheckers.get(condition.value as string);
        result = checker ? checker(condition.value as string) : false;
        break;
    }
    
    return condition.negate ? !result : result;
  }
  
  private isInteractionAvailable(interaction: NPCInteraction): boolean {
    if (!interaction.conditions || interaction.conditions.length === 0) {
      return true;
    }
    
    return interaction.conditions.every(cond => this.checkCondition(cond));
  }
  
  // ==================== Interactions ====================
  
  public clickNPC(templateId: string): NPCInteraction[] {
    const instance = this.instances.get(templateId);
    const template = this.templates.get(templateId);
    if (!instance || !template) return [];
    
    this.emit("npc_clicked", { npcId: templateId, template, instance });
    
    // Return available interactions for UI to display
    return template.interactions.filter(i => 
      instance.availableInteractions.includes(i.id)
    );
  }
  
  public triggerInteraction(templateId: string, interactionId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;
    
    const interaction = template.interactions.find(i => i.id === interactionId);
    if (!interaction) return false;
    
    if (!this.isInteractionAvailable(interaction)) return false;
    
    this.emit("interaction_started", { npcId: templateId, interaction });
    
    // Execute action
    this.executeAction(templateId, interaction.action);
    
    this.emit("interaction_completed", { npcId: templateId, interaction });
    
    // Update NPC state after interaction
    this.updateNPCState(templateId);
    
    return true;
  }
  
  private executeAction(npcId: string, action: InteractionAction): void {
    switch (action.type) {
      case "start_quest":
        if (action.targetId) {
          QuestSystem.getInstance().startQuest(action.targetId);
        }
        break;
        
      case "complete_quest":
        if (action.targetId) {
          QuestSystem.getInstance().completeQuest(action.targetId);
        }
        break;
        
      case "open_shop":
        this.emit("open_shop", { 
          npcId, 
          category: action.targetId,
        });
        break;
        
      case "dialogue":
        if (action.dialogueId) {
          this.startDialogue(npcId, action.dialogueId);
        }
        break;
        
      case "give_item":
        if (action.targetId) {
          const state = GameState.getInstance();
          state.addItem(action.targetId, "special", 1);
        }
        break;
        
      case "custom":
        if (action.customEvent) {
          this.emit(action.customEvent as NPCEventType, {
            npcId,
            action,
            data: action.customData,
          });
        }
        // Also check for registered handler
        const handler = this.actionHandlers.get(action.customEvent || "");
        if (handler) {
          handler(npcId, action);
        }
        break;
    }
  }
  
  // ==================== Dialogue ====================
  
  public startDialogue(npcId: string, dialogueId: string): NPCDialogue | null {
    const dialogue = this.dialogues.get(dialogueId);
    if (!dialogue) return null;
    
    const template = this.templates.get(npcId);
    
    this.emit("dialogue_started", {
      npcId,
      dialogue,
      speaker: dialogue.speaker || template?.name,
    });
    
    return dialogue;
  }
  
  public selectDialogueChoice(npcId: string, dialogueId: string, choiceIndex: number): void {
    const dialogue = this.dialogues.get(dialogueId);
    if (!dialogue || !dialogue.choices) return;
    
    const choice = dialogue.choices[choiceIndex];
    if (!choice) return;
    
    this.emit("dialogue_choice", { npcId, dialogueId, choice, choiceIndex });
    
    // Execute choice action if any
    if (choice.action) {
      this.executeAction(npcId, choice.action);
    }
    
    // Continue to next dialogue if specified
    if (choice.nextDialogue) {
      this.startDialogue(npcId, choice.nextDialogue);
    } else {
      this.emit("dialogue_ended", { npcId, dialogueId });
    }
  }
  
  public endDialogue(npcId: string): void {
    this.emit("dialogue_ended", { npcId });
  }
  
  // ==================== Queries ====================
  
  public getNPCsInArea(areaId: string): NPCInstance[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.currentAreaId === areaId && instance.isVisible
    );
  }
  
  public getNPCsWithIcon(icon: NPCIconType): NPCInstance[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.currentIcon === icon
    );
  }
  
  public getNPCsWithQuests(): NPCInstance[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.currentIcon === "quest_available" || instance.currentIcon === "quest_ready"
    );
  }
  
  // ==================== Events ====================
  
  public on(callback: NPCCallback): void {
    this.listeners.push(callback);
  }
  
  public off(callback: NPCCallback): void {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }
  
  private emit(event: NPCEventType | string, data: unknown): void {
    for (const callback of this.listeners) {
      callback(event as NPCEventType, data);
    }
  }
}
