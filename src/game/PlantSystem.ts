/**
 * PlantSystem - Manages plant growth, watering, and harvesting
 */

import { GameState, type PlantState } from "./GameState";
import { GameTimer } from "./GameTimer";
import { QuestSystem } from "./QuestSystem";

export interface StrainDefinition {
  id: string;
  name: string;
  growthTime: number; // Total time in ms to fully grow
  stages: number; // Number of growth stages
  waterConsumption: number; // Water consumed per minute
  baseYield: number; // Base harvest amount
  xpReward: number;
  seedId: string;
  harvestId: string;
  unlockLevel: number;
  // Harvest window settings
  harvestWindow?: number; // Time in ms plant stays at peak quality (default: growthTime / 2)
  overripeTime?: number; // Time in ms before plant spoils after harvest window (default: harvestWindow)
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
  private eventListeners: PlantEventCallback[] = [];
  private updateInterval: string = "plant_system_update";

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

  // ==================== Plant Actions ====================

  /**
   * Plant a seed at a position
   */
  public plantSeed(
    strainId: string,
    position: { x: number; y: number; z: number },
    mapId: string
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

    // Create plant
    const plant = this.gameState.addPlant({
      strain: strainId,
      position,
      mapId,
      growthStage: 0,
      growthProgress: 0,
      waterLevel: 100,
      health: 100,
      plantedAt: this.gameTimer.getGameTime(),
      lastWatered: this.gameTimer.getGameTime(),
    });

    console.log(`Planted ${strain.name} at (${position.x}, ${position.y}, ${position.z})`);
    this.emit("planted", plant.id, { strain: strainId });

    return plant;
  }

  /**
   * Water a plant
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
   * Harvest a plant
   */
  public harvestPlant(plantId: string): { success: boolean; yield: number; xp: number; quality: number; phase: PlantPhase } | null {
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

    // Calculate yield based on health AND quality
    const healthMultiplier = plant.health / 100;
    const qualityMultiplier = phaseInfo.quality / 100;
    const totalMultiplier = healthMultiplier * qualityMultiplier;
    
    const yield_ = Math.max(1, Math.floor(strain.baseYield * totalMultiplier));
    const xp = Math.max(1, Math.floor(strain.xpReward * totalMultiplier));

    // Bonus XP for perfect timing
    const bonusXp = phaseInfo.phase === "ready" ? Math.floor(strain.xpReward * 0.25) : 0;
    const totalXp = xp + bonusXp;

    // Add harvest to inventory
    this.gameState.addItem(strain.harvestId, "harvest", yield_);
    
    // Add XP
    this.gameState.addXP(totalXp);

    // Update stats
    this.gameState.incrementStat("plantsHarvested");
    if (phaseInfo.phase === "ready") {
      this.gameState.incrementStat("perfectHarvests");
    }

    // Update quest objectives
    QuestSystem.getInstance().updateObjective("harvest", { 
      strainId: strain.id, 
      quantity: 1 
    });

    // Remove plant
    this.gameState.removePlant(plantId);

    const phaseText = phaseInfo.phase === "ready" ? "(Perfect!)" : 
                      phaseInfo.phase === "overripe" ? "(Overripe)" : 
                      phaseInfo.phase === "spoiled" ? "(Spoiled!)" : "";
    console.log(`Harvested ${yield_} ${strain.name} ${phaseText}, gained ${totalXp} XP`);
    
    this.emit("harvested", plantId, { 
      yield: yield_, 
      xp: totalXp, 
      strain: strain.id,
      phase: phaseInfo.phase,
      quality: phaseInfo.quality,
      bonusXp,
    });

    return {
      success: true,
      yield: yield_,
      xp: totalXp,
      quality: phaseInfo.quality,
      phase: phaseInfo.phase,
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

    // Calculate time since last update
    const timeSincePlanted = currentTime - plant.plantedAt;
    const stageTime = strain.growthTime / strain.stages;

    // Calculate current stage and progress
    const totalProgress = timeSincePlanted / strain.growthTime;
    const newStage = Math.min(strain.stages - 1, Math.floor(totalProgress * strain.stages));
    const stageProgress = ((timeSincePlanted % stageTime) / stageTime) * 100;

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

    // Check for phase changes (only for harvestable plants)
    if (newStage >= strain.stages - 1) {
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

    // Calculate water consumption
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
    for (const callback of this.eventListeners) {
      callback(plantId, event, data);
    }
  }

  // ==================== Cleanup ====================

  public dispose(): void {
    this.gameTimer.cancelTask(this.updateInterval);
    this.eventListeners = [];
  }
}
