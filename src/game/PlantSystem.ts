/**
 * PlantSystem - Manages plant growth, watering, and harvesting
 */

import { BuildableObjectManager } from "./BuildableObject";
import { CuringSystem } from "./CuringSystem";
import { EquipmentSystem } from "./EquipmentSystem";
import { EventBus } from "../engine/core/EventBus";
import { GameState, type PlantState } from "./GameState";
import { GameTimer } from "./GameTimer";
import { QuestSystem } from "./QuestSystem";

export interface StrainDefinition {
  id: string;
  name: string;
  growthTime: number; // Total time in ms to fully grow
  stages: number; // Number of growth stages
  waterConsumption: number; // Water consumed per minute (legacy, kept for compatibility)
  baseYield: number; // Base harvest amount in GRAMS (e.g., 150 = 150g)
  xpReward: number;
  seedId: string;
  harvestId: string; // Fresh harvest item ID (uncured)
  curedId?: string; // Cured product item ID (sellable)
  unlockLevel: number;
  // Value per gram (affects selling price)
  valuePerGram: number; // Base $/gram for this strain (e.g., 8 = $8/gram)
  // Harvest window settings
  harvestWindow?: number; // Time in ms plant stays at peak quality (default: growthTime / 2)
  overripeTime?: number; // Time in ms before plant spoils after harvest window (default: harvestWindow)
  // Hempire-style: Temperature preferences (°F)
  preferredTempMin?: number; // Min temp for green zone (default: 68)
  preferredTempMax?: number; // Max temp for green zone (default: 78)
  // Hempire-style: Water prompt timing
  waterPromptInterval?: number; // ms between water prompts (default: growthTime / 10)
  waterPromptWindow?: number; // ms player has to respond (default: 30000 = 30s)
  // Curing time (default: 7 in-game days)
  curingTime?: number; // ms to cure (default: 7 * 24 * 60 * 60 * 1000)
  // Seed drop mechanics
  seedDropChance?: number; // Chance to drop a seed on harvest (0-1, default: 0.1 = 10%)
  rareSeedDrops?: Array<{ strainId: string; chance: number }>; // Rare seeds that can drop
}

/**
 * Pot types - affect grow speed
 */
export interface PotDefinition {
  id: string;
  name: string;
  growthSpeedMultiplier: number; // 1.0 = normal, 0.5 = 2x faster
  cost: number;
  unlockLevel: number;
  description: string;
}

/**
 * Grow room lighting levels - passive yield bonus
 */
export interface LightingLevel {
  level: number;
  name: string;
  yieldBonus: number; // percentage bonus (0.1 = 10%)
  cost: number;
  unlockLevel: number;
}

/**
 * Strain mastery - tracks perfect grows per strain
 */
export interface StrainMastery {
  strainId: string;
  perfectGrows: number; // count of perfect grows
  level: number; // 0-5 stars
  bonusYield: number; // flat bonus buds per harvest
}

/**
 * Plant lifecycle phases
 */
export type PlantPhase = 
  | "growing"      // Still growing, not ready
  | "ready"        // Ready to harvest, peak quality
  | "overripe"     // Past peak, quality degrading
  | "spoiled";     // Too late, minimal yield

export interface PlantVisualState {
  plantId: string;
  stage: number;
  progress: number;
  needsWater: boolean;
  isDead: boolean;
  isHarvestable: boolean;
  phase: PlantPhase;
  qualityPercent: number; // 0-100, degrades when overripe
  timeInPhase: number; // ms in current phase
  phaseTimeRemaining?: number; // ms until next phase (if applicable)
}

// No hardcoded strains - game code registers via registerStrain()

type PlantEventCallback = (plantId: string, event: string, data?: unknown) => void;

export class PlantSystem {
  private static instance: PlantSystem;
  private gameState: GameState;
  private gameTimer: GameTimer;
  private strains: Map<string, StrainDefinition> = new Map();
  private pots: Map<string, PotDefinition> = new Map();
  private lightingLevels: LightingLevel[] = [];
  private masteryData: Map<string, StrainMastery> = new Map();
  private eventListeners: PlantEventCallback[] = [];
  private updateInterval: string = "plant_system_update";
  
  // Current grow room state
  private currentLightingLevel: number = 1;

  private constructor() {
    this.gameState = GameState.getInstance();
    this.gameTimer = GameTimer.getInstance();
    
    // Start plant update loop
    this.startUpdateLoop();
  }

  public static getInstance(): PlantSystem {
    if (!PlantSystem.instance) {
      PlantSystem.instance = new PlantSystem();
    }
    return PlantSystem.instance;
  }

  public static resetInstance(): void {
    PlantSystem.instance = null as any;
  }

  // ==================== Strain Data ====================

  public registerStrain(strain: StrainDefinition): void {
    this.strains.set(strain.id, strain);
  }

  public registerStrains(strains: StrainDefinition[]): void {
    for (const strain of strains) {
      this.registerStrain(strain);
    }
  }

  public getStrain(id: string): StrainDefinition | undefined {
    return this.strains.get(id);
  }

  public getAllStrains(): StrainDefinition[] {
    return Array.from(this.strains.values());
  }

  public getUnlockedStrains(): StrainDefinition[] {
    const playerLevel = this.gameState.getPlayer().level;
    return this.getAllStrains().filter(s => s.unlockLevel <= playerLevel);
  }

  public clearStrains(): void {
    this.strains.clear();
  }

  // ==================== Pot Data ====================

  public registerPot(pot: PotDefinition): void {
    this.pots.set(pot.id, pot);
  }

  public registerPots(pots: PotDefinition[]): void {
    for (const pot of pots) {
      this.registerPot(pot);
    }
  }

  public getPot(id: string): PotDefinition | undefined {
    return this.pots.get(id);
  }

  public getAllPots(): PotDefinition[] {
    return Array.from(this.pots.values());
  }

  public getUnlockedPots(): PotDefinition[] {
    const playerLevel = this.gameState.getPlayer().level;
    return this.getAllPots().filter(p => p.unlockLevel <= playerLevel);
  }

  // ==================== Lighting ====================

  public registerLightingLevels(levels: LightingLevel[]): void {
    this.lightingLevels = levels.sort((a, b) => a.level - b.level);
  }

  public getLightingLevel(): number {
    return this.currentLightingLevel;
  }

  public getLightingBonus(): number {
    const level = this.lightingLevels.find(l => l.level === this.currentLightingLevel);
    return level?.yieldBonus ?? 0;
  }

  public upgradeLighting(): boolean {
    const nextLevel = this.lightingLevels.find(l => l.level === this.currentLightingLevel + 1);
    if (!nextLevel) return false;
    
    const playerLevel = this.gameState.getPlayer().level;
    if (nextLevel.unlockLevel > playerLevel) return false;
    
    if (!this.gameState.spendMoney(nextLevel.cost)) return false;
    
    this.currentLightingLevel = nextLevel.level;
    this.emit("lighting_upgraded", "", { level: this.currentLightingLevel, bonus: nextLevel.yieldBonus });
    return true;
  }

  // ==================== Mastery ====================

  public getMastery(strainId: string): StrainMastery {
    let mastery = this.masteryData.get(strainId);
    if (!mastery) {
      mastery = {
        strainId,
        perfectGrows: 0,
        level: 0,
        bonusYield: 0,
      };
      this.masteryData.set(strainId, mastery);
    }
    return mastery;
  }

  public getAllMastery(): StrainMastery[] {
    return Array.from(this.masteryData.values());
  }

  private addPerfectGrow(strainId: string): void {
    const mastery = this.getMastery(strainId);
    mastery.perfectGrows++;
    
    // Level up every 5 perfect grows (0-5 stars)
    const newLevel = Math.min(5, Math.floor(mastery.perfectGrows / 5));
    if (newLevel > mastery.level) {
      mastery.level = newLevel;
      mastery.bonusYield = newLevel; // +1 bud per star level
      this.emit("mastery_levelup", "", { strainId, level: newLevel, bonusYield: mastery.bonusYield });
    }
  }

  // ==================== Plant Actions ====================

  /**
   * Plant a seed at a position
   * @param potType - Type of pot to use (affects grow speed)
   * @param initialTemp - Initial temperature setting (default: 72°F)
   */
  public plantSeed(
    strainId: string,
    position: { x: number; y: number; z: number },
    mapId: string,
    potType: string = "basic",
    initialTemp: number = 72
  ): PlantState | null {
    const strain = this.getStrain(strainId);
    if (!strain) {
      console.error(`Unknown strain: ${strainId}`);
      return null;
    }

    // Check if player has the seed
    if (!this.gameState.hasItem(strain.seedId)) {
      console.warn("No seeds available!");
      this.emit("no_seeds", "", { strainId });
      return null;
    }

    // Remove seed from inventory
    this.gameState.removeItem(strain.seedId);

    const currentTime = this.gameTimer.getGameTime();
    
    // Calculate first water prompt time
    const waterPromptInterval = strain.waterPromptInterval ?? Math.floor(strain.growthTime / 10);
    const firstWaterPrompt = currentTime + waterPromptInterval;

    // Create plant with Hempire-style fields
    const plant = this.gameState.addPlant({
      strain: strainId,
      position,
      mapId,
      growthStage: 0,
      growthProgress: 0,
      waterLevel: 100,
      health: 100,
      plantedAt: currentTime,
      lastWatered: currentTime,
      // Hempire-style fields
      potType,
      temperature: initialTemp,
      waterPromptsHit: 0,
      waterPromptsMissed: 0,
      wateringStreak: 0,
      lastWaterPrompt: 0,
      nextWaterPrompt: firstWaterPrompt,
      fertilized: false,
    });

    console.log(`Planted ${strain.name} at (${position.x}, ${position.y}, ${position.z}) in ${potType} pot at ${initialTemp}°F`);
    this.emit("planted", plant.id, { strain: strainId, potType, temperature: initialTemp });

    return plant;
  }

  /**
   * Water a plant (legacy method - fills water to 100%)
   */
  public waterPlant(plantId: string): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    if (plant.waterLevel >= 100) {
      console.log("Plant doesn't need water");
      return false;
    }

    // Fill water to 100%
    this.gameState.updatePlant(plantId, {
      waterLevel: 100,
      lastWatered: this.gameTimer.getGameTime(),
    });

    console.log(`Watered plant ${plantId}`);
    this.emit("watered", plantId);

    return true;
  }

  /**
   * Respond to a water prompt (Hempire-style active watering)
   * Call this when player taps the water icon during a prompt
   * @returns true if prompt was active and successfully responded to
   */
  public respondToWaterPrompt(plantId: string): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    const currentTime = this.gameTimer.getGameTime();
    const strain = this.getStrain(plant.strain);
    if (!strain) return false;

    // Check if there's an active water prompt
    const promptWindow = strain.waterPromptWindow ?? 30000; // 30s default
    const promptStart = plant.nextWaterPrompt;
    const promptEnd = promptStart + promptWindow;

    if (currentTime < promptStart || currentTime > promptEnd) {
      console.log("No active water prompt");
      return false;
    }

    // Success! Player responded in time
    const newStreak = plant.wateringStreak + 1;
    const waterPromptInterval = strain.waterPromptInterval ?? Math.floor(strain.growthTime / 10);
    
    this.gameState.updatePlant(plantId, {
      waterPromptsHit: plant.waterPromptsHit + 1,
      wateringStreak: newStreak,
      lastWaterPrompt: currentTime,
      nextWaterPrompt: currentTime + waterPromptInterval,
      waterLevel: 100, // Also refill water
      lastWatered: currentTime,
    });

    console.log(`Water prompt hit! Streak: ${newStreak}`);
    this.emit("water_prompt_hit", plantId, { streak: newStreak });

    return true;
  }

  /**
   * Check if a plant currently has an active water prompt
   */
  public hasActiveWaterPrompt(plantId: string): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    const currentTime = this.gameTimer.getGameTime();
    const strain = this.getStrain(plant.strain);
    if (!strain) return false;

    const promptWindow = strain.waterPromptWindow ?? 30000;
    const promptStart = plant.nextWaterPrompt;
    const promptEnd = promptStart + promptWindow;

    return currentTime >= promptStart && currentTime <= promptEnd;
  }

  /**
   * Get water prompt status for a plant
   */
  public getWaterPromptStatus(plantId: string): { 
    isActive: boolean; 
    timeRemaining: number; 
    streak: number;
    hitRate: number;
  } | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const currentTime = this.gameTimer.getGameTime();
    const strain = this.getStrain(plant.strain);
    if (!strain) return null;

    const promptWindow = strain.waterPromptWindow ?? 30000;
    const promptStart = plant.nextWaterPrompt;
    const promptEnd = promptStart + promptWindow;
    
    const isActive = currentTime >= promptStart && currentTime <= promptEnd;
    const timeRemaining = isActive ? promptEnd - currentTime : 0;
    
    const totalPrompts = plant.waterPromptsHit + plant.waterPromptsMissed;
    const hitRate = totalPrompts > 0 ? plant.waterPromptsHit / totalPrompts : 1;

    return {
      isActive,
      timeRemaining,
      streak: plant.wateringStreak,
      hitRate,
    };
  }

  // ==================== Grow Light Detection ====================

  /**
   * Get the grow light above a plant (if any)
   * Grow lights are 128 units above plant positions
   */
  public getGrowLightAbove(plantId: string): { templateId: string; yieldBonus: number } | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const buildableManager = BuildableObjectManager.getInstance();
    const allObjects = Array.from(buildableManager.getObjectsInMap(plant.mapId));
    
    // Look for a grow light at the same X/Y position but 128 units higher (Z)
    const lightAbove = allObjects.find(obj => {
      // Check if it's a grow light type
      const isGrowLight = obj.templateId.startsWith("grow_light");
      if (!isGrowLight) return false;
      
      // Check if it's above this plant (same X/Y, Z is ~128 higher)
      const sameX = Math.abs(obj.position.x - plant.position.x) < 10;
      const sameY = Math.abs(obj.position.z - plant.position.z) < 10; // Z in 3D = Y in map
      const abovePlant = obj.position.y > plant.position.y + 50; // Y in 3D = height
      
      return sameX && sameY && abovePlant;
    });

    if (!lightAbove) return null;

    // Get the template to find yield bonus
    const template = buildableManager.getTemplate(lightAbove.templateId);
    const yieldBonus = template?.yieldBonus ?? 0;

    return { templateId: lightAbove.templateId, yieldBonus };
  }

  /**
   * Check if a plant has a grow light installed above it
   */
  public hasGrowLight(plantId: string): boolean {
    return this.getGrowLightAbove(plantId) !== null;
  }

  /**
   * Get grow light multipliers for a plant
   * Without light: 2x slower growth, 50% less yield
   * With light: normal speed, yield bonus based on lamp type
   */
  public getGrowLightMultipliers(plantId: string): { speedMultiplier: number; yieldMultiplier: number } {
    const light = this.getGrowLightAbove(plantId);
    
    if (light) {
      // Has light: normal speed, yield bonus from lamp type
      return { speedMultiplier: 1.0, yieldMultiplier: 1.0 + light.yieldBonus };
    } else {
      // No light: 2x slower, 50% yield
      return { speedMultiplier: 2.0, yieldMultiplier: 0.5 };
    }
  }

  // ==================== Temperature Control ====================

  /**
   * Set the temperature for a plant's grow environment
   * @param temperature Temperature in °F (60-90 range)
   */
  public setTemperature(plantId: string, temperature: number): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    // Clamp to valid range
    const clampedTemp = Math.max(60, Math.min(90, temperature));
    
    this.gameState.updatePlant(plantId, {
      temperature: clampedTemp,
    });

    console.log(`Set temperature for ${plantId} to ${clampedTemp}°F`);
    this.emit("temperature_changed", plantId, { temperature: clampedTemp });

    return true;
  }

  /**
   * Check if temperature is in the optimal range for a strain
   */
  public isTemperatureOptimal(plantId: string): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    const strain = this.getStrain(plant.strain);
    if (!strain) return false;

    const minTemp = strain.preferredTempMin ?? 68;
    const maxTemp = strain.preferredTempMax ?? 78;

    return plant.temperature >= minTemp && plant.temperature <= maxTemp;
  }

  /**
   * Get temperature status for a plant
   */
  public getTemperatureStatus(plantId: string): {
    current: number;
    min: number;
    max: number;
    isOptimal: boolean;
  } | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const strain = this.getStrain(plant.strain);
    if (!strain) return null;

    const minTemp = strain.preferredTempMin ?? 68;
    const maxTemp = strain.preferredTempMax ?? 78;

    return {
      current: plant.temperature,
      min: minTemp,
      max: maxTemp,
      isOptimal: plant.temperature >= minTemp && plant.temperature <= maxTemp,
    };
  }

  // ==================== Fertilizer ====================

  /**
   * Apply fertilizer to boost growth speed by 2x
   * Fertilizer effect lasts until harvest
   */
  public applyFertilizer(plantId: string): boolean {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return false;

    const strain = this.getStrain(plant.strain);
    if (!strain) return false;

    // Check if player has fertilizer
    if (!this.gameState.hasItem("fertilizer")) {
      console.warn("No fertilizer available!");
      this.emit("no_fertilizer", plantId);
      return false;
    }

    // Already fertilized or already ready
    if (plant.fertilized || plant.growthStage >= strain.stages - 1) {
      console.log("Cannot fertilize this plant");
      return false;
    }

    // Remove fertilizer from inventory
    this.gameState.removeItem("fertilizer");

    // Mark as fertilized - growth speed will be 2x
    this.gameState.updatePlant(plantId, {
      fertilized: true,
      fertilizedAt: this.gameTimer.getGameTime(),
    });

    console.log(`Fertilized ${plantId} - 25% faster growth!`);
    this.emit("fertilized", plantId, { strain: plant.strain, speedBoost: 1.25 });

    return true;
  }

  /**
   * Harvest a plant - Hempire-style yield calculation
   * Yield = Base + WaterBonus + TempBonus + LightBonus + MasteryBonus
   */
  public harvestPlant(plantId: string): { 
    success: boolean; 
    yield: number; 
    xp: number; 
    quality: number; 
    phase: PlantPhase;
    bonuses: {
      base: number;
      water: number;
      temp: number;
      light: number;
      mastery: number;
    };
    isPerfectGrow: boolean;
  } | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const strain = this.getStrain(plant.strain);
    if (!strain) return null;

    // Check if harvestable (final stage)
    if (plant.growthStage < strain.stages - 1) {
      console.log("Plant not ready for harvest");
      this.emit("harvest_failed", plantId, { reason: "not_ready" });
      return null;
    }

    // Get phase and quality
    const phaseInfo = this.getPlantPhase(plantId);
    if (!phaseInfo) return null;

    // === HEMPIRE-STYLE YIELD CALCULATION ===
    const base = strain.baseYield;
    
    // Water bonus: 0-50% of base based on hit rate
    const totalPrompts = plant.waterPromptsHit + plant.waterPromptsMissed;
    const waterHitRate = totalPrompts > 0 ? plant.waterPromptsHit / totalPrompts : 1;
    const waterBonus = Math.floor(base * 0.5 * waterHitRate);
    const perfectWater = waterHitRate >= 1.0;
    
    // Temperature bonus: 25% of base if in optimal range
    const tempOptimal = this.isTemperatureOptimal(plantId);
    const tempBonus = tempOptimal ? Math.floor(base * 0.25) : 0;
    
    // Lighting bonus: based on grow room equipment level
    const lightBonus = Math.floor(base * this.getLightingBonus());
    
    // Mastery bonus: flat bonus from strain mastery level
    const mastery = this.getMastery(plant.strain);
    const masteryBonus = mastery.bonusYield;
    
    // Quality multiplier (from harvest timing - ready/overripe/spoiled)
    const qualityMultiplier = phaseInfo.quality / 100;
    
    // Health multiplier (from plant care)
    const healthMultiplier = plant.health / 100;
    
    // Grow light penalty: 50% yield without light
    const growLightMultipliers = this.getGrowLightMultipliers(plantId);
    const growLightYieldMultiplier = growLightMultipliers.yieldMultiplier;
    
    // Equipment yield bonus (CO2, etc.)
    const equipmentYieldBonus = EquipmentSystem.getInstance().getBonus(
      "yield_bonus",
      plant.position,
      plant.mapId
    );
    
    // Equipment quality bonus (fans, etc.)
    const equipmentQualityBonus = EquipmentSystem.getInstance().getBonus(
      "quality_bonus",
      plant.position,
      plant.mapId
    );
    const adjustedQuality = Math.min(100, phaseInfo.quality + (equipmentQualityBonus * 100));
    const adjustedQualityMultiplier = adjustedQuality / 100;
    
    // Final yield calculation
    const rawYield = base + waterBonus + tempBonus + lightBonus + masteryBonus;
    const equipmentYieldMultiplier = 1 + equipmentYieldBonus;
    const yield_ = Math.max(1, Math.floor(rawYield * adjustedQualityMultiplier * healthMultiplier * growLightYieldMultiplier * equipmentYieldMultiplier));
    
    // XP calculation
    const xp = Math.max(1, Math.floor(strain.xpReward * qualityMultiplier * healthMultiplier));
    const bonusXp = phaseInfo.phase === "ready" ? Math.floor(strain.xpReward * 0.25) : 0;
    const totalXp = xp + bonusXp;

    // Check for perfect grow (perfect water + perfect temp + ready phase)
    const isPerfectGrow = perfectWater && tempOptimal && phaseInfo.phase === "ready";
    
    // Award mastery point for perfect grow
    if (isPerfectGrow) {
      this.addPerfectGrow(plant.strain);
    }

    // Add fresh harvest to curing system (needs to be cured before selling)
    const curingSystem = CuringSystem.getInstance();
    const decayTime = 5 * 60 * 1000; // 5 minutes for testing (normally 24 hours)
    curingSystem.addFreshHarvest(
      strain.id,
      strain.harvestId,
      strain.curedId ?? `cured_${strain.id}`,
      yield_,
      phaseInfo.quality,
      strain.valuePerGram ?? 10,
      decayTime
    );
    
    // Add XP
    this.gameState.addXP(totalXp);

    // Update stats
    this.gameState.incrementStat("plantsHarvested");
    if (phaseInfo.phase === "ready") {
      this.gameState.incrementStat("perfectHarvests");
    }
    if (isPerfectGrow) {
      this.gameState.incrementStat("perfectGrows");
    }

    // Update quest objectives
    QuestSystem.getInstance().updateObjective("harvest", { 
      strainId: strain.id, 
      quantity: 1 
    });

    // Seed drop chance (higher for perfect grows)
    const seedDrops = this.calculateSeedDrops(strain, isPerfectGrow, phaseInfo.quality);
    for (const drop of seedDrops) {
      this.gameState.addItem(drop.seedId, "seed", drop.quantity);
      this.emit("seed_dropped", plantId, { seedId: drop.seedId, quantity: drop.quantity, isRare: drop.isRare });
    }

    // Remove plant
    this.gameState.removePlant(plantId);

    // Reset the pot visual to empty state (ready for new seed)
    // Find the pot at this plant's position
    const buildableManager = BuildableObjectManager.getInstance();
    const allObjects = Array.from(buildableManager.getObjectsInMap(plant.mapId));
    const potAtPosition = allObjects.find(obj => 
      Math.abs(obj.position.x - plant.position.x) < 5 &&
      Math.abs(obj.position.z - plant.position.z) < 5
    );
    if (potAtPosition) {
      buildableManager.resetPot(potAtPosition.id);
    }

    const phaseText = isPerfectGrow ? "(PERFECT GROW!)" :
                      phaseInfo.phase === "ready" ? "(Perfect Timing!)" : 
                      phaseInfo.phase === "overripe" ? "(Overripe)" : 
                      phaseInfo.phase === "spoiled" ? "(Spoiled!)" : "";
    console.log(`Harvested ${yield_} ${strain.name} ${phaseText}`);
    console.log(`  Base: ${base}, Water: +${waterBonus}, Temp: +${tempBonus}, Light: +${lightBonus}, Mastery: +${masteryBonus}`);
    console.log(`  Quality: ${phaseInfo.quality}%, Health: ${plant.health}%, XP: ${totalXp}`);
    
    const bonuses = { base, water: waterBonus, temp: tempBonus, light: lightBonus, mastery: masteryBonus };
    
    this.emit("harvested", plantId, { 
      yield: yield_, 
      xp: totalXp, 
      strain: strain.id,
      phase: phaseInfo.phase,
      quality: phaseInfo.quality,
      bonusXp,
      bonuses,
      isPerfectGrow,
    });

    return {
      success: true,
      yield: yield_,
      xp: totalXp,
      quality: phaseInfo.quality,
      phase: phaseInfo.phase,
      bonuses,
      isPerfectGrow,
    };
  }

  /**
   * Remove a dead or unwanted plant
   */
  public removePlant(plantId: string): boolean {
    const removed = this.gameState.removePlant(plantId);
    if (removed) {
      console.log(`Removed plant ${plantId}`);
      this.emit("removed", plantId);
      return true;
    }
    return false;
  }

  // ==================== Plant State ====================

  /**
   * Get the current phase of a plant
   */
  public getPlantPhase(plantId: string): { phase: PlantPhase; quality: number; timeInPhase: number; timeRemaining?: number } | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const strain = this.getStrain(plant.strain);
    if (!strain) return null;

    const currentTime = this.gameTimer.getGameTime();
    const timeSincePlanted = currentTime - plant.plantedAt;
    
    // Not yet ready
    if (plant.growthStage < strain.stages - 1) {
      const timeToReady = strain.growthTime - timeSincePlanted;
      return {
        phase: "growing",
        quality: 100,
        timeInPhase: timeSincePlanted,
        timeRemaining: Math.max(0, timeToReady),
      };
    }

    // Calculate time since becoming ready
    const timeSinceReady = timeSincePlanted - strain.growthTime;
    const harvestWindow = strain.harvestWindow ?? strain.growthTime / 2;
    const overripeTime = strain.overripeTime ?? harvestWindow;

    if (timeSinceReady < harvestWindow) {
      // Peak quality - ready to harvest
      return {
        phase: "ready",
        quality: 100,
        timeInPhase: timeSinceReady,
        timeRemaining: harvestWindow - timeSinceReady,
      };
    }

    const timeSinceOverripe = timeSinceReady - harvestWindow;
    
    if (timeSinceOverripe < overripeTime) {
      // Overripe - quality degrading linearly
      const qualityLoss = (timeSinceOverripe / overripeTime) * 70; // Lose up to 70%
      return {
        phase: "overripe",
        quality: Math.max(30, 100 - qualityLoss),
        timeInPhase: timeSinceOverripe,
        timeRemaining: overripeTime - timeSinceOverripe,
      };
    }

    // Spoiled - minimal yield
    return {
      phase: "spoiled",
      quality: 10, // 10% quality
      timeInPhase: timeSinceOverripe - overripeTime,
    };
  }

  /**
   * Get visual state for rendering
   */
  public getVisualState(plantId: string): PlantVisualState | null {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return null;

    const strain = this.getStrain(plant.strain);
    if (!strain) return null;

    const phaseInfo = this.getPlantPhase(plantId);
    if (!phaseInfo) return null;

    return {
      plantId,
      stage: plant.growthStage,
      progress: plant.growthProgress,
      needsWater: plant.waterLevel < 30,
      isDead: plant.health <= 0,
      isHarvestable: plant.growthStage >= strain.stages - 1,
      phase: phaseInfo.phase,
      qualityPercent: phaseInfo.quality,
      timeInPhase: phaseInfo.timeInPhase,
      phaseTimeRemaining: phaseInfo.timeRemaining,
    };
  }

  /**
   * Get time remaining until next stage
   */
  public getTimeToNextStage(plantId: string): number {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return 0;

    const strain = this.getStrain(plant.strain);
    if (!strain) return 0;

    const stageTime = strain.growthTime / strain.stages;
    const progressTime = (plant.growthProgress / 100) * stageTime;
    return stageTime - progressTime;
  }

  /**
   * Get time remaining until harvest ready
   */
  public getTimeToHarvest(plantId: string): number {
    const plant = this.gameState.getPlant(plantId);
    if (!plant) return 0;

    const strain = this.getStrain(plant.strain);
    if (!strain) return 0;

    const stagesRemaining = (strain.stages - 1) - plant.growthStage;
    const stageTime = strain.growthTime / strain.stages;
    const currentStageRemaining = this.getTimeToNextStage(plantId);

    return (stagesRemaining * stageTime) + currentStageRemaining;
  }

  // ==================== Update Loop ====================

  private startUpdateLoop(): void {
    // Update plants every second (real-time)
    this.gameTimer.scheduleTask(this.updateInterval, 1000, () => {
      this.updateAllPlants();
    });
  }

  private updateAllPlants(): void {
    const plants = this.gameState.getPlants();
    const currentTime = this.gameTimer.getGameTime();

    for (const plant of plants) {
      this.updatePlant(plant, currentTime);
    }
  }

  private updatePlant(plant: PlantState, currentTime: number): void {
    const strain = this.getStrain(plant.strain);
    if (!strain) return;

    // Skip dead plants
    if (plant.health <= 0) return;

    // Skip plants that are already harvestable (no more growth updates needed)
    if (plant.growthStage >= strain.stages - 1) {
      this.checkPhaseChanges(plant, strain, currentTime);
      return;
    }

    // Get pot speed multiplier
    const pot = this.getPot(plant.potType);
    const potSpeedMultiplier = pot?.growthSpeedMultiplier ?? 1.0;
    
    // Fertilizer gives 25% speed boost
    const fertilizerBoost = plant.fertilized ? 0.8 : 1.0; // 0.8 = 25% faster

    // Grow light penalty: 2x slower without light
    const lightMultipliers = this.getGrowLightMultipliers(plant.id);
    const lightSpeedPenalty = lightMultipliers.speedMultiplier;

    // Equipment bonuses (fans, CO2, etc.)
    const equipmentSpeedBonus = EquipmentSystem.getInstance().getBonus(
      "growth_speed",
      plant.position,
      plant.mapId
    );
    const equipmentSpeedMultiplier = 1 / (1 + equipmentSpeedBonus); // Convert bonus to faster time

    // Combined speed multiplier (pot + fertilizer + light penalty + equipment)
    const speedMultiplier = potSpeedMultiplier * fertilizerBoost * lightSpeedPenalty * equipmentSpeedMultiplier;

    // Calculate time since last update (adjusted for speed boosts)
    const timeSincePlanted = currentTime - plant.plantedAt;
    const effectiveTime = timeSincePlanted / speedMultiplier; // Faster = more effective time
    const stageTime = strain.growthTime / strain.stages;

    // Calculate current stage and progress
    const totalProgress = effectiveTime / strain.growthTime;
    const newStage = Math.min(strain.stages - 1, Math.floor(totalProgress * strain.stages));
    const stageProgress = ((effectiveTime % stageTime) / stageTime) * 100;

    // Check for stage change
    if (newStage > plant.growthStage) {
      const isNowHarvestable = newStage >= strain.stages - 1;
      this.emit("stage_change", plant.id, { 
        oldStage: plant.growthStage, 
        newStage,
        isHarvestable: isNowHarvestable,
      });
      
      // Emit ready event when plant becomes harvestable
      if (isNowHarvestable && plant.growthStage < strain.stages - 1) {
        this.emit("ready_to_harvest", plant.id, { strain: plant.strain });
      }
    }

    // === HEMPIRE-STYLE WATER PROMPTS ===
    const promptWindow = strain.waterPromptWindow ?? 30000; // 30s default
    const waterPromptInterval = strain.waterPromptInterval ?? Math.floor(strain.growthTime / 10);
    
    // Check if water prompt just became active
    const promptStart = plant.nextWaterPrompt;
    const promptEnd = promptStart + promptWindow;
    const wasPromptActive = this.gameState.getCustomData<boolean>(`water_prompt_active_${plant.id}`);
    const isPromptActive = currentTime >= promptStart && currentTime <= promptEnd;
    
    if (isPromptActive && !wasPromptActive) {
      // Water prompt just started - notify UI
      this.gameState.setCustomData(`water_prompt_active_${plant.id}`, true);
      this.emit("water_prompt_start", plant.id, { 
        timeRemaining: promptEnd - currentTime,
        streak: plant.wateringStreak,
      });
    }
    
    // Check if water prompt expired (missed)
    if (currentTime > promptEnd && wasPromptActive) {
      // Player missed the water prompt!
      this.gameState.setCustomData(`water_prompt_active_${plant.id}`, false);
      
      const newMissed = plant.waterPromptsMissed + 1;
      const nextPrompt = currentTime + waterPromptInterval;
      
      this.gameState.updatePlant(plant.id, {
        waterPromptsMissed: newMissed,
        wateringStreak: 0, // Reset streak on miss
        lastWaterPrompt: promptEnd,
        nextWaterPrompt: nextPrompt,
      });
      
      this.emit("water_prompt_missed", plant.id, { 
        totalMissed: newMissed,
        nextPromptIn: waterPromptInterval,
      });
    }

    // Calculate water consumption (legacy - still affects health)
    const timeSinceWatered = currentTime - plant.lastWatered;
    const minutesSinceWatered = timeSinceWatered / 60000;
    const waterConsumed = minutesSinceWatered * strain.waterConsumption;
    const newWaterLevel = Math.max(0, 100 - waterConsumed);

    // Calculate health damage from dehydration
    let newHealth = plant.health;
    if (newWaterLevel <= 0) {
      // Lose 5% health per minute when completely dry
      const dryTime = timeSinceWatered - (100 / strain.waterConsumption) * 60000;
      if (dryTime > 0) {
        const dryMinutes = dryTime / 60000;
        newHealth = Math.max(0, plant.health - (dryMinutes * 5));
      }
    }

    // Check for death
    if (newHealth <= 0 && plant.health > 0) {
      this.emit("died", plant.id, { strain: plant.strain });
    }

    // Check for low water warning
    if (newWaterLevel < 30 && plant.waterLevel >= 30) {
      this.emit("needs_water", plant.id);
    }

    // Update plant state
    this.gameState.updatePlant(plant.id, {
      growthStage: newStage,
      growthProgress: stageProgress,
      waterLevel: newWaterLevel,
      health: newHealth,
    });
  }

  /**
   * Check for phase changes on harvestable plants
   */
  private checkPhaseChanges(plant: PlantState, _strain: StrainDefinition, _currentTime: number): void {
    const phaseInfo = this.getPlantPhase(plant.id);
    const previousPhase = this.gameState.getCustomData<string>(`plant_phase_${plant.id}`);
    
    if (phaseInfo && phaseInfo.phase !== previousPhase) {
      this.gameState.setCustomData(`plant_phase_${plant.id}`, phaseInfo.phase);
      
      if (phaseInfo.phase === "overripe") {
        this.emit("overripe", plant.id, { 
          strain: plant.strain,
          quality: phaseInfo.quality,
          timeRemaining: phaseInfo.timeRemaining,
        });
      } else if (phaseInfo.phase === "spoiled") {
        this.emit("spoiled", plant.id, { strain: plant.strain });
      }
    }
  }

  // ==================== Seed Drops ====================

  /**
   * Calculate seed drops on harvest
   * - Base chance to get same strain seed back
   * - Perfect grows have higher chance
   * - Rare seed drops possible from certain strains
   */
  private calculateSeedDrops(
    strain: StrainDefinition,
    isPerfectGrow: boolean,
    quality: number
  ): Array<{ seedId: string; quantity: number; isRare: boolean }> {
    const drops: Array<{ seedId: string; quantity: number; isRare: boolean }> = [];

    // Base seed drop chance (default 10%, +20% for perfect grow)
    const baseChance = strain.seedDropChance ?? 0.1;
    const perfectBonus = isPerfectGrow ? 0.2 : 0;
    const qualityBonus = (quality / 100) * 0.1; // Up to +10% for 100% quality
    const totalChance = Math.min(0.8, baseChance + perfectBonus + qualityBonus);

    // Roll for same-strain seed
    if (Math.random() < totalChance) {
      drops.push({ seedId: strain.seedId, quantity: 1, isRare: false });
    }

    // Roll for rare seed drops (if defined)
    if (strain.rareSeedDrops && strain.rareSeedDrops.length > 0) {
      for (const rareDrop of strain.rareSeedDrops) {
        // Perfect grows double rare drop chance
        const rareChance = isPerfectGrow ? rareDrop.chance * 2 : rareDrop.chance;
        if (Math.random() < rareChance) {
          const rareStrain = this.getStrain(rareDrop.strainId);
          if (rareStrain) {
            drops.push({ seedId: rareStrain.seedId, quantity: 1, isRare: true });
          }
        }
      }
    }

    return drops;
  }

  // ==================== Events ====================

  public onPlantEvent(callback: PlantEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offPlantEvent(callback: PlantEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, plantId: string, data?: unknown): void {
    // Legacy callback system
    for (const callback of this.eventListeners) {
      callback(plantId, event, data);
    }
    
    // Global EventBus - allows any system to listen to plant events
    EventBus.emit(`plant:${event}`, { plantId, ...data as object });
  }

  // ==================== Cleanup ====================

  public dispose(): void {
    this.gameTimer.cancelTask(this.updateInterval);
    this.eventListeners = [];
  }
}
