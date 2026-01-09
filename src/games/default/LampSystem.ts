/**
 * LampSystem - Manages grow light settings and their effects on plants
 * 
 * Features:
 * - Intensity control (affects growth speed)
 * - Spectrum control (warm/cool - affects quality)
 * - Coverage radius (how many plants are affected)
 * - Power cost calculation
 */

import { EventBus } from "../../engine/core/EventBus";
import { BuildableSystem } from "../../engine/BuildableSystem";
import { GameState } from "./GameState";

// ==================== Types ====================

export interface LampSettings {
  intensity: number;      // 0-100% (affects growth speed)
  spectrum: number;       // 0-100 (0=warm/red, 100=cool/blue)
  isOn: boolean;          // Power state
}

export interface LampState {
  objectId: string;
  templateId: string;
  settings: LampSettings;
  position: { x: number; y: number; z: number };
  coverageRadius: number;
  powerCostPerDay: number;
}

export interface LampEffect {
  growthSpeedBonus: number;   // Multiplier (1.0 = normal)
  qualityBonus: number;       // Multiplier (1.0 = normal)
  yieldBonus: number;         // From lamp template
}

// Default settings for new lamps
const DEFAULT_LAMP_SETTINGS: LampSettings = {
  intensity: 75,
  spectrum: 50,
  isOn: true,
};

// Lamp tier definitions
const LAMP_TIERS: Record<string, { 
  baseRadius: number; 
  basePowerCost: number;
  maxIntensity: number;
  yieldBonus: number;
}> = {
  grow_light_basic: { 
    baseRadius: 150, 
    basePowerCost: 5, 
    maxIntensity: 80,
    yieldBonus: 0,
  },
  grow_light_advanced: { 
    baseRadius: 200, 
    basePowerCost: 10, 
    maxIntensity: 100,
    yieldBonus: 0.15,
  },
  grow_light_ultra: { 
    baseRadius: 250, 
    basePowerCost: 20, 
    maxIntensity: 100,
    yieldBonus: 0.30,
  },
};

// ==================== LampSystem ====================

export class LampSystem {
  private static instance: LampSystem;
  private lampStates: Map<string, LampState> = new Map();
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): LampSystem {
    if (!LampSystem.instance) {
      LampSystem.instance = new LampSystem();
    }
    return LampSystem.instance;
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.setupEventListeners();
    this.loadExistingLamps();
    
    console.log("LampSystem initialized");
  }

  private setupEventListeners(): void {
    // Listen for new lamps being built
    EventBus.on<{ objectId: string; template: { id: string; zoneType: string } }>(
      "building:completed",
      (data) => {
        if (data.template.zoneType === "growlight") {
          this.registerLamp(data.objectId, data.template.id);
        }
      }
    );
  }

  private loadExistingLamps(): void {
    const buildableSystem = BuildableSystem.getInstance();
    const allInstances = buildableSystem.getInstancesInMap("showcase");

    for (const inst of allInstances) {
      const template = buildableSystem.getTemplate(inst.templateId);
      if (template?.customData?.zoneType === "growlight" && inst.isComplete) {
        this.registerLamp(inst.id, inst.templateId);
      }
    }
  }

  // ==================== Lamp Management ====================

  private registerLamp(objectId: string, templateId: string): void {
    if (this.lampStates.has(objectId)) return;

    const buildableSystem = BuildableSystem.getInstance();
    const inst = buildableSystem.getInstance(objectId);
    if (!inst) return;

    const tier = LAMP_TIERS[templateId] || LAMP_TIERS.grow_light_basic;

    // Load saved settings or use defaults
    const savedSettings = this.loadLampSettings(objectId);

    const lampState: LampState = {
      objectId,
      templateId,
      settings: savedSettings || { ...DEFAULT_LAMP_SETTINGS },
      position: inst.position,
      coverageRadius: tier.baseRadius,
      powerCostPerDay: tier.basePowerCost,
    };

    this.lampStates.set(objectId, lampState);
    console.log(`Registered lamp: ${objectId} (${templateId})`);
  }

  public getLamp(objectId: string): LampState | undefined {
    return this.lampStates.get(objectId);
  }

  public getAllLamps(): LampState[] {
    return Array.from(this.lampStates.values());
  }

  // ==================== Settings Control ====================

  public setIntensity(objectId: string, intensity: number): void {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return;

    const tier = LAMP_TIERS[lamp.templateId] || LAMP_TIERS.grow_light_basic;
    lamp.settings.intensity = Math.max(0, Math.min(tier.maxIntensity, intensity));
    
    this.saveLampSettings(objectId, lamp.settings);
    EventBus.emit("lamp:settings_changed", { objectId, settings: lamp.settings });
  }

  public setSpectrum(objectId: string, spectrum: number): void {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return;

    lamp.settings.spectrum = Math.max(0, Math.min(100, spectrum));
    
    this.saveLampSettings(objectId, lamp.settings);
    EventBus.emit("lamp:settings_changed", { objectId, settings: lamp.settings });
  }

  public togglePower(objectId: string): boolean {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return false;

    lamp.settings.isOn = !lamp.settings.isOn;
    
    this.saveLampSettings(objectId, lamp.settings);
    EventBus.emit("lamp:power_changed", { objectId, isOn: lamp.settings.isOn });
    
    return lamp.settings.isOn;
  }

  public setPower(objectId: string, isOn: boolean): void {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return;

    lamp.settings.isOn = isOn;
    
    this.saveLampSettings(objectId, lamp.settings);
    EventBus.emit("lamp:power_changed", { objectId, isOn });
  }

  // ==================== Effect Calculations ====================

  /**
   * Get the combined lamp effect for a plant at a given position
   */
  public getLampEffectAtPosition(position: { x: number; z: number }): LampEffect {
    let totalGrowthBonus = 0;
    let totalQualityBonus = 0;
    let totalYieldBonus = 0;
    let lampCount = 0;

    for (const lamp of this.lampStates.values()) {
      if (!lamp.settings.isOn) continue;

      // Check if position is within lamp coverage
      const dx = position.x - lamp.position.x;
      const dz = position.z - lamp.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance <= lamp.coverageRadius) {
        lampCount++;
        const tier = LAMP_TIERS[lamp.templateId] || LAMP_TIERS.grow_light_basic;

        // Intensity affects growth speed (0-100% → 0.5-1.5x)
        const intensityFactor = 0.5 + (lamp.settings.intensity / 100);
        totalGrowthBonus += intensityFactor - 1;

        // Spectrum affects quality
        // Warm (0-40): Better for flowering, +quality
        // Balanced (40-60): Normal
        // Cool (60-100): Better for veg, +growth
        const spectrum = lamp.settings.spectrum;
        if (spectrum < 40) {
          // Warm - quality bonus
          totalQualityBonus += 0.1 * (1 - spectrum / 40);
        } else if (spectrum > 60) {
          // Cool - extra growth bonus
          totalGrowthBonus += 0.1 * ((spectrum - 60) / 40);
        }

        // Yield bonus from lamp tier
        totalYieldBonus += tier.yieldBonus;
      }
    }

    // Average bonuses if multiple lamps (diminishing returns)
    if (lampCount > 1) {
      totalGrowthBonus = totalGrowthBonus / lampCount * 1.5; // Some stacking benefit
      totalQualityBonus = totalQualityBonus / lampCount * 1.5;
      totalYieldBonus = Math.min(0.5, totalYieldBonus); // Cap at 50%
    }

    return {
      growthSpeedBonus: 1 + totalGrowthBonus,
      qualityBonus: 1 + totalQualityBonus,
      yieldBonus: totalYieldBonus,
    };
  }

  /**
   * Get plants covered by a specific lamp
   */
  public getPlantsInCoverage(objectId: string): string[] {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return [];

    const plants = GameState.getInstance().getPlants();
    const coveredPlants: string[] = [];

    for (const plant of plants) {
      const dx = plant.position.x - lamp.position.x;
      const dz = plant.position.z - lamp.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance <= lamp.coverageRadius) {
        coveredPlants.push(plant.id);
      }
    }

    return coveredPlants;
  }

  /**
   * Calculate daily power cost for all active lamps
   */
  public getDailyPowerCost(): number {
    let totalCost = 0;

    for (const lamp of this.lampStates.values()) {
      if (lamp.settings.isOn) {
        // Power cost scales with intensity
        const intensityFactor = lamp.settings.intensity / 100;
        totalCost += lamp.powerCostPerDay * intensityFactor;
      }
    }

    return Math.round(totalCost);
  }

  // ==================== Persistence ====================

  private saveLampSettings(objectId: string, settings: LampSettings): void {
    const key = `lamp_settings_${objectId}`;
    localStorage.setItem(key, JSON.stringify(settings));
  }

  private loadLampSettings(objectId: string): LampSettings | null {
    const key = `lamp_settings_${objectId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  }

  // ==================== UI Helpers ====================

  /**
   * Get display info for a lamp
   */
  public getLampDisplayInfo(objectId: string): {
    name: string;
    intensity: number;
    spectrum: number;
    spectrumLabel: string;
    isOn: boolean;
    coverageCount: number;
    powerCost: number;
  } | null {
    const lamp = this.lampStates.get(objectId);
    if (!lamp) return null;

    const buildableSystem = BuildableSystem.getInstance();
    const template = buildableSystem.getTemplate(lamp.templateId);

    // Spectrum label
    let spectrumLabel = "Balanced";
    if (lamp.settings.spectrum < 40) {
      spectrumLabel = "Warm (Flower)";
    } else if (lamp.settings.spectrum > 60) {
      spectrumLabel = "Cool (Veg)";
    }

    const coveredPlants = this.getPlantsInCoverage(objectId);
    const intensityFactor = lamp.settings.intensity / 100;

    return {
      name: template?.name || "Grow Light",
      intensity: lamp.settings.intensity,
      spectrum: lamp.settings.spectrum,
      spectrumLabel,
      isOn: lamp.settings.isOn,
      coverageCount: coveredPlants.length,
      powerCost: Math.round(lamp.powerCostPerDay * intensityFactor),
    };
  }
}
