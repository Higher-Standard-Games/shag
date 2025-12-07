/**
 * EquipmentSystem - Generic equipment bonuses and automation
 * 
 * Handles:
 * - Equipment effect definitions (registered by game)
 * - Active equipment tracking
 * - Bonus calculations
 * - Automation (auto-watering, etc.)
 */

import { GameTimer } from "./GameTimer";

/**
 * Equipment effect types
 */
export type EffectType = 
  | "growth_speed"      // Multiplier for plant growth
  | "water_retention"   // Reduces water consumption
  | "yield_bonus"       // Increases harvest yield
  | "xp_bonus"          // Increases XP gained
  | "auto_water"        // Automatically waters plants
  | "quality_bonus"     // Increases product quality
  | "capacity_bonus"    // Increases storage/slots
  | "price_bonus"       // Increases sell prices
  | "custom";           // Custom effect handled by game

/**
 * Equipment effect definition
 */
export interface EquipmentEffect {
  type: EffectType;
  /** Effect value (interpretation depends on type) */
  value: number;
  /** Optional target (e.g., specific plant type, zone) */
  target?: string;
  /** Effect radius (-1 = global) */
  radius: number;
  /** Custom effect ID for game-specific handling */
  customId?: string;
}

/**
 * Equipment template - defines a type of equipment
 */
export interface EquipmentTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Zone type this equipment is placed in */
  zoneType: string;
  /** Effects this equipment provides */
  effects: EquipmentEffect[];
  /** Power consumption (for future energy system) */
  powerConsumption: number;
  /** Whether equipment needs to be "on" to work */
  requiresActivation: boolean;
  /** Automation interval in ms (0 = no automation) */
  automationInterval: number;
  /** Custom automation callback ID */
  automationCallback?: string;
}

/**
 * Active equipment instance
 */
export interface ActiveEquipment {
  id: string;
  templateId: string;
  zoneId: string;
  position: { x: number; y: number; z: number };
  mapId: string;
  isActive: boolean;
  /** Last automation tick */
  lastAutomation: number;
}

type EquipmentEventCallback = (event: string, data: unknown) => void;
type AutomationCallback = (equipment: ActiveEquipment, template: EquipmentTemplate) => void;

export class EquipmentSystem {
  private static instance: EquipmentSystem;

  private templates: Map<string, EquipmentTemplate> = new Map();
  private equipment: Map<string, ActiveEquipment> = new Map();
  private automationCallbacks: Map<string, AutomationCallback> = new Map();
  private eventListeners: EquipmentEventCallback[] = [];
  private updateTaskId = "equipment_system_update";

  private constructor() {}

  public static getInstance(): EquipmentSystem {
    if (!EquipmentSystem.instance) {
      EquipmentSystem.instance = new EquipmentSystem();
    }
    return EquipmentSystem.instance;
  }

  public static resetInstance(): void {
    EquipmentSystem.instance = null as any;
  }

  // ==================== Initialization ====================

  public init(): void {
    this.startUpdateLoop();
  }

  private startUpdateLoop(): void {
    // Run automation every second
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 1000, () => {
      this.runAutomation();
    });
  }

  // ==================== Template Registration ====================

  public registerTemplate(template: EquipmentTemplate): void {
    this.templates.set(template.id, template);
  }

  public registerTemplates(templates: EquipmentTemplate[]): void {
    for (const template of templates) {
      this.registerTemplate(template);
    }
  }

  public getTemplate(id: string): EquipmentTemplate | undefined {
    return this.templates.get(id);
  }

  public clearTemplates(): void {
    this.templates.clear();
  }

  // ==================== Automation Callbacks ====================

  /**
   * Register a custom automation callback
   */
  public registerAutomation(id: string, callback: AutomationCallback): void {
    this.automationCallbacks.set(id, callback);
  }

  public clearAutomation(): void {
    this.automationCallbacks.clear();
  }

  // ==================== Equipment Management ====================

  /**
   * Add active equipment
   */
  public addEquipment(
    templateId: string,
    zoneId: string,
    position: { x: number; y: number; z: number },
    mapId: string
  ): ActiveEquipment | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const id = `equip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = GameTimer.getInstance().getGameTime();

    const equip: ActiveEquipment = {
      id,
      templateId,
      zoneId,
      position,
      mapId,
      isActive: !template.requiresActivation, // Auto-activate if no activation needed
      lastAutomation: now,
    };

    this.equipment.set(id, equip);
    this.emit("equipment_added", { equipment: equip, template });

    return equip;
  }

  /**
   * Remove equipment
   */
  public removeEquipment(id: string): boolean {
    const equip = this.equipment.get(id);
    if (!equip) return false;

    this.equipment.delete(id);
    this.emit("equipment_removed", { equipment: equip });
    return true;
  }

  /**
   * Toggle equipment on/off
   */
  public toggleEquipment(id: string): boolean {
    const equip = this.equipment.get(id);
    if (!equip) return false;

    equip.isActive = !equip.isActive;
    this.emit("equipment_toggled", { equipment: equip, isActive: equip.isActive });
    return equip.isActive;
  }

  /**
   * Set equipment active state
   */
  public setActive(id: string, active: boolean): void {
    const equip = this.equipment.get(id);
    if (equip) {
      equip.isActive = active;
      this.emit("equipment_toggled", { equipment: equip, isActive: active });
    }
  }

  // ==================== Queries ====================

  public getEquipment(id: string): ActiveEquipment | undefined {
    return this.equipment.get(id);
  }

  public getEquipmentInZone(zoneId: string): ActiveEquipment[] {
    return Array.from(this.equipment.values()).filter(e => e.zoneId === zoneId);
  }

  public getEquipmentInMap(mapId: string): ActiveEquipment[] {
    return Array.from(this.equipment.values()).filter(e => e.mapId === mapId);
  }

  public getActiveEquipment(): ActiveEquipment[] {
    return Array.from(this.equipment.values()).filter(e => e.isActive);
  }

  public getEquipmentByTemplate(templateId: string): ActiveEquipment[] {
    return Array.from(this.equipment.values()).filter(e => e.templateId === templateId);
  }

  // ==================== Bonus Calculations ====================

  /**
   * Get total bonus for an effect type at a position
   */
  public getBonus(
    effectType: EffectType,
    position: { x: number; y: number; z: number },
    mapId: string,
    target?: string
  ): number {
    let totalBonus = 0;

    for (const equip of this.equipment.values()) {
      if (!equip.isActive || equip.mapId !== mapId) continue;

      const template = this.templates.get(equip.templateId);
      if (!template) continue;

      for (const effect of template.effects) {
        if (effect.type !== effectType) continue;
        if (effect.target && effect.target !== target) continue;

        // Check radius
        if (effect.radius !== -1) {
          const dx = position.x - equip.position.x;
          const dy = position.y - equip.position.y;
          const dz = position.z - equip.position.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > effect.radius) continue;
        }

        totalBonus += effect.value;
      }
    }

    return totalBonus;
  }

  /**
   * Get multiplier for an effect type (1.0 + bonus)
   */
  public getMultiplier(
    effectType: EffectType,
    position: { x: number; y: number; z: number },
    mapId: string,
    target?: string
  ): number {
    return 1.0 + this.getBonus(effectType, position, mapId, target);
  }

  /**
   * Check if automation effect is active at position
   */
  public hasAutomation(
    effectType: EffectType,
    position: { x: number; y: number; z: number },
    mapId: string
  ): boolean {
    return this.getBonus(effectType, position, mapId) > 0;
  }

  // ==================== Automation ====================

  private runAutomation(): void {
    const now = GameTimer.getInstance().getGameTime();

    for (const equip of this.equipment.values()) {
      if (!equip.isActive) continue;

      const template = this.templates.get(equip.templateId);
      if (!template || template.automationInterval <= 0) continue;

      // Check if it's time to run
      if (now - equip.lastAutomation < template.automationInterval) continue;

      equip.lastAutomation = now;

      // Run custom callback if defined
      if (template.automationCallback) {
        const callback = this.automationCallbacks.get(template.automationCallback);
        if (callback) {
          callback(equip, template);
        }
      }

      this.emit("automation_tick", { equipment: equip, template });
    }
  }

  // ==================== Events ====================

  public onEquipmentEvent(callback: EquipmentEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offEquipmentEvent(callback: EquipmentEventCallback): void {
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

  public getState(): ActiveEquipment[] {
    return Array.from(this.equipment.values());
  }

  public loadState(equipment: ActiveEquipment[]): void {
    this.equipment.clear();
    for (const equip of equipment) {
      this.equipment.set(equip.id, equip);
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    this.equipment.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    this.clear();
    this.eventListeners = [];
  }
}
