/**
 * PlantStatusIndicator - Shows floating health/water/growth bars above plants
 * 
 * Small, compact status bars that float above each plant without text.
 * Color-coded for quick visual feedback:
 * - Green bar: Growth progress
 * - Blue bar: Water level
 * - Red/Pink bar: Health
 */

import { EventBus } from "../engine/core/EventBus";
import { GameScene } from "../engine/GameScene";
import { GameState } from "../game/GameState";
import { PlantSystem } from "../game/PlantSystem";
import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { UIStyles } from "../engine/ui/UIStyles";
import plantStatusIndicatorCSS from "./styles/PlantStatusIndicator.css?raw";

const INDICATOR_PREFIX = "plant_status_";
const UPDATE_INTERVAL = 1000; // Update every second

export class PlantStatusIndicator {
  private static instance: PlantStatusIndicator;
  private activePlants: Set<string> = new Set();
  private updateIntervalId: number | null = null;
  private styleInjected: boolean = false;

  private constructor() {}

  public static getInstance(): PlantStatusIndicator {
    if (!PlantStatusIndicator.instance) {
      PlantStatusIndicator.instance = new PlantStatusIndicator();
    }
    return PlantStatusIndicator.instance;
  }

  /**
   * Initialize the plant status indicator system
   */
  public initialize(): void {
    this.injectStyles();
    this.setupEventListeners();
    this.startUpdateLoop();
    
    // Scan for existing plants
    setTimeout(() => {
      this.scanExistingPlants();
    }, 500);
  }

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;
    UIStyles.injectCSS("plant-status-indicator", plantStatusIndicatorCSS);
  }

  private setupEventListeners(): void {
    // Listen for plant events via EventBus
    EventBus.on<{ plantId: string }>("plant:planted", (data) => {
      this.addPlantIndicator(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:harvested", (data) => {
      this.removePlantIndicator(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:died", (data) => {
      this.removePlantIndicator(data.plantId);
    });
    
    // Clear all indicators when map changes, then rescan for plants in new map
    EventBus.on("map:loaded", () => {
      this.clearAllIndicators();
      // Rescan after a short delay to let the new map's plants load
      setTimeout(() => {
        this.scanExistingPlants();
      }, 100);
    });
  }

  /**
   * Clear all plant indicators (used on map change)
   */
  public clearAllIndicators(): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    for (const plantId of this.activePlants) {
      const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
      worldIndicator.removeIndicator(indicatorId);
    }
    this.activePlants.clear();
    console.log("[PlantStatusIndicator] Cleared all indicators");
  }

  private startUpdateLoop(): void {
    if (this.updateIntervalId !== null) return;

    this.updateIntervalId = window.setInterval(() => {
      this.updateAllIndicators();
    }, UPDATE_INTERVAL);
  }

  private scanExistingPlants(): void {
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap) return;
    
    // Only scan plants in the CURRENT map, not all maps
    const plants = GameState.getInstance().getPlantsInMap(currentMap);
    console.log(`[PlantStatusIndicator] Scanning ${plants.length} plants in ${currentMap}`);
    for (const plant of plants) {
      this.addPlantIndicator(plant.id);
    }
  }

  private addPlantIndicator(plantId: string): void {
    if (this.activePlants.has(plantId)) return;

    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;

    const plantSystem = PlantSystem.getInstance();
    const strain = plantSystem.getStrain(plant.strain);
    if (!strain) return;

    const worldIndicator = WorldIndicatorSystem.getInstance();
    const indicatorId = `${INDICATOR_PREFIX}${plantId}`;

    // Create the status bars HTML
    const barsHtml = this.createBarsHtml(plantId);

    worldIndicator.addIndicator({
      id: indicatorId,
      worldPosition: {
        x: plant.position.x,
        y: plant.position.y + 2, // Slightly above plant
        z: plant.position.z,
      },
      config: {
        icon: barsHtml,
        animation: "none",
        offsetY: 60, // Higher above the plant
        className: "plant-status-indicator",
      },
      data: { plantId },
    });

    this.activePlants.add(plantId);
  }

  private removePlantIndicator(plantId: string): void {
    if (!this.activePlants.has(plantId)) return;

    const worldIndicator = WorldIndicatorSystem.getInstance();
    const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
    
    worldIndicator.removeIndicator(indicatorId);
    this.activePlants.delete(plantId);
  }

  private createBarsHtml(plantId: string): string {
    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return "";

    const plantSystem = PlantSystem.getInstance();
    const strain = plantSystem.getStrain(plant.strain);
    if (!strain) return "";

    // Calculate overall growth (same formula as GameScene)
    const maxStage = strain.stages - 1;
    const overallGrowth = maxStage > 0 
      ? ((plant.growthStage + (plant.growthProgress / 100)) / maxStage) * 100
      : 100;
    const growthPercent = Math.min(100, overallGrowth);
    const waterPercent = Math.min(100, plant.waterLevel);
    const healthPercent = Math.min(100, plant.health);

    const isHarvestable = plant.growthStage >= strain.stages - 1;
    const isLowWater = waterPercent < 30;
    const isLowHealth = healthPercent < 50;

    return `
      <div class="plant-status-bars${isHarvestable ? ' harvestable' : ''}">
        <div class="plant-status-bar plant-status-bar-growth">
          <div class="plant-status-bar-fill" style="width: ${growthPercent}%"></div>
        </div>
        <div class="plant-status-bar plant-status-bar-water${isLowWater ? ' low' : ''}">
          <div class="plant-status-bar-fill" style="width: ${waterPercent}%"></div>
        </div>
        <div class="plant-status-bar plant-status-bar-health${isLowHealth ? ' low' : ''}">
          <div class="plant-status-bar-fill" style="width: ${healthPercent}%"></div>
        </div>
      </div>
    `;
  }

  private updateAllIndicators(): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();

    for (const plantId of this.activePlants) {
      const indicatorId = `${INDICATOR_PREFIX}${plantId}`;
      const indicator = worldIndicator.getIndicator(indicatorId);
      
      if (indicator) {
        // Update the bars HTML
        const barsHtml = this.createBarsHtml(plantId);
        const iconEl = indicator.element.querySelector(".world-indicator-icon");
        if (iconEl) {
          iconEl.innerHTML = barsHtml;
        }

        // Update position in case plant moved (unlikely but safe)
        const plant = GameState.getInstance().getPlant(plantId);
        if (plant) {
          indicator.worldPosition.x = plant.position.x;
          indicator.worldPosition.y = plant.position.y + 2;
          indicator.worldPosition.z = plant.position.z;
        }
      }
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }

    // Remove all indicators
    for (const plantId of this.activePlants) {
      this.removePlantIndicator(plantId);
    }
    this.activePlants.clear();
  }
}
