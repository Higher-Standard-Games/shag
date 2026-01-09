/**
 * WaterPromptUI - Hempire-style tap-to-water prompts
 * 
 * Shows floating water drop indicators above plants that need watering.
 * Player taps to water and gets bonus growth/quality.
 * 
 * Now uses WorldIndicatorSystem for positioning and rendering.
 */

import { EventBus } from "../../../engine/core/EventBus";
import { WorldIndicatorSystem } from "../../../engine/core/WorldIndicatorSystem";
import { GameScene } from "../GameScene";
import { GameState } from "../GameState";
import { GameTimer } from "../../../engine/core/GameTimer";
import { PlantSystem } from "../PlantSystem";

const INDICATOR_PREFIX = "water_";

export class WaterPromptUI {
  private static instance: WaterPromptUI;
  private activePrompts: Set<string> = new Set();
  private updateTaskId: string = "water_prompt_update";

  private constructor() {}

  public static getInstance(): WaterPromptUI {
    if (!WaterPromptUI.instance) {
      WaterPromptUI.instance = new WaterPromptUI();
    }
    return WaterPromptUI.instance;
  }

  /**
   * Initialize the water prompt system
   * No longer needs screen position function - uses WorldIndicatorSystem
   */
  public init(): void {
    this.startUpdateLoop();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for water prompt events from PlantSystem
    EventBus.on("plant:water_prompt_start", (data: { plantId: string; timeRemaining: number }) => {
      this.showPrompt(data.plantId, data.timeRemaining);
    });

    EventBus.on("plant:water_prompt_missed", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });

    EventBus.on("plant:watered", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });

    EventBus.on("plant:harvested", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });
    
    // Clear all prompts when map changes, then rescan for current map
    EventBus.on("map:loaded", () => {
      this.clearAllPrompts();
      setTimeout(() => {
        this.checkForNewPrompts();
      }, 100);
    });
  }
  
  /**
   * Clear all water prompts (used on map change)
   */
  private clearAllPrompts(): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    for (const plantId of this.activePrompts) {
      const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
      worldIndicator.removeIndicator(indicatorId);
    }
    this.activePrompts.clear();
    console.log("[WaterPromptUI] Cleared all prompts");
  }

  /**
   * Show a water prompt for a plant
   */
  public showPrompt(plantId: string, _expiresIn: number): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    
    // Don't show if WorldIndicatorSystem not initialized
    if (!worldIndicator.isInitialized()) return;

    // Don't show duplicate
    const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
    if (worldIndicator.hasIndicator(indicatorId)) return;

    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;
    
    // Only show prompts for plants in the CURRENT map
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap || plant.mapId !== currentMap) return;

    // Add indicator using WorldIndicatorSystem
    worldIndicator.addIndicator({
      id: indicatorId,
      worldPosition: plant.position,
      config: {
        icon: "💧",
        label: "$2",
        animation: "bounce",
        offsetY: 60,
        onClick: () => {
          this.onPromptClick(plantId);
        },
      },
      data: { plantId },
    });

    this.activePrompts.add(plantId);
  }

  /**
   * Hide a water prompt
   */
  public hidePrompt(plantId: string): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
    
    worldIndicator.removeIndicator(indicatorId);
    this.activePrompts.delete(plantId);
  }

  private onPromptClick(plantId: string): void {
    const plantSystem = PlantSystem.getInstance();
    const promptStatus = plantSystem.getWaterPromptStatus(plantId);
    
    if (promptStatus?.isActive) {
      // Respond to the water prompt (gives bonus)
      const success = plantSystem.respondToWaterPrompt(plantId);
      if (success) {
        EventBus.emit("ui:water_prompt_responded", { plantId });
      }
    } else {
      // Regular watering
      plantSystem.waterPlant(plantId);
    }

    this.hidePrompt(plantId);
  }

  private startUpdateLoop(): void {
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 500, () => {
      this.update();
    });
  }

  private update(): void {
    // Check for new prompts from PlantSystem
    this.checkForNewPrompts();
    
    // Update urgent state for existing prompts
    this.updateUrgentState();
  }

  private checkForNewPrompts(): void {
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap) return;
    
    // Only check plants in the CURRENT map
    const plants = GameState.getInstance().getPlantsInMap(currentMap);
    const plantSystem = PlantSystem.getInstance();

    for (const plant of plants) {
      if (this.activePrompts.has(plant.id)) continue;

      const promptStatus = plantSystem.getWaterPromptStatus(plant.id);
      if (promptStatus?.isActive && promptStatus.timeRemaining > 0) {
        this.showPrompt(plant.id, promptStatus.timeRemaining);
      }
    }
  }

  private updateUrgentState(): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    const plantSystem = PlantSystem.getInstance();

    for (const plantId of this.activePrompts) {
      const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
      const indicator = worldIndicator.getIndicator(indicatorId);
      if (!indicator) continue;

      const promptStatus = plantSystem.getWaterPromptStatus(plantId);
      
      // Add urgent class if water is very low
      const plant = GameState.getInstance().getPlant(plantId);
      if (plant && plant.waterLevel < 20) {
        indicator.element.classList.add("world-indicator-urgent");
      }
      
      // Hide if no longer active
      if (!promptStatus?.isActive) {
        this.hidePrompt(plantId);
      }
    }
  }

  /**
   * Manually trigger checking all plants for water prompts
   */
  public refreshPrompts(): void {
    this.checkForNewPrompts();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    WorldIndicatorSystem.getInstance().removeIndicatorsByPrefix(INDICATOR_PREFIX);
    this.activePrompts.clear();
  }
}
