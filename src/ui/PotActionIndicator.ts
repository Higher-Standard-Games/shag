/**
 * PotActionIndicator - Shows bouncing icons above pots that need player action
 * (e.g., empty pots that need a strain selected)
 * 
 * Now uses WorldIndicatorSystem for positioning and rendering.
 */

import { BuildableObjectManager } from "../game/BuildableObject";
import { EventBus } from "../engine/core/EventBus";
import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { GameHUD } from "./GameHUD";

const INDICATOR_PREFIX = "pot_action_";

export class PotActionIndicator {
  private static instance: PotActionIndicator;
  private activeIndicators: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): PotActionIndicator {
    if (!PotActionIndicator.instance) {
      PotActionIndicator.instance = new PotActionIndicator();
    }
    return PotActionIndicator.instance;
  }

  /**
   * Initialize the pot action indicator system
   * No longer needs a screen position function - uses WorldIndicatorSystem
   */
  public initialize(): void {
    this.setupEventListeners();
    
    // Check for any existing empty pots that need indicators
    // (in case pots were loaded from save before this was initialized)
    setTimeout(() => {
      this.checkAllPots("showcase");
    }, 500);
  }

  private setupEventListeners(): void {
    // Listen for pot completion via EventBus
    EventBus.on<{ objectId: string; template: { zoneType: string } }>("building:completed", (data) => {
      if (data.template.zoneType === "plant") {
        this.showIndicatorForPot(data.objectId);
      }
    });

    // Listen for plant being planted (stage changed with hasPlant)
    EventBus.on<{ objectId: string }>("building:stage_changed", (data) => {
      const buildableManager = BuildableObjectManager.getInstance();
      const state = buildableManager.getObject(data.objectId);
      if (state?.hasPlant) {
        this.hideIndicator(data.objectId);
      }
    });

    // Listen for plant state changed (from BuildableObjectManager.setPlantInPot)
    EventBus.on<{ objectId: string; hasPlant: boolean }>("building:plant_state_changed", (data) => {
      if (data.hasPlant) {
        this.hideIndicator(data.objectId);
      }
    });
  }

  public showIndicatorForPot(objectId: string): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    
    // Don't show if WorldIndicatorSystem not initialized yet
    if (!worldIndicator.isInitialized()) {
      console.warn("PotActionIndicator: WorldIndicatorSystem not initialized yet");
      return;
    }

    const buildableManager = BuildableObjectManager.getInstance();
    const state = buildableManager.getObject(objectId);
    
    if (!state || state.hasPlant) return;

    // Check if indicator already exists
    const indicatorId = `${INDICATOR_PREFIX}${objectId}`;
    if (worldIndicator.hasIndicator(indicatorId)) return;

    // Add indicator using WorldIndicatorSystem
    worldIndicator.addIndicator({
      id: indicatorId,
      worldPosition: state.position,
      config: {
        icon: "🌱",
        label: "Select strain",
        animation: "bounce",
        offsetY: 40,
        onClick: () => {
          EventBus.emit("pot:needs_seed", { objectId, position: state.position });
        },
      },
      data: { objectId },
    });

    this.activeIndicators.add(objectId);

    // Show game message
    GameHUD.getInstance().showGameMessage("Select strain to grow", "🌱");
  }

  public hideIndicator(objectId: string): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    const indicatorId = `${INDICATOR_PREFIX}${objectId}`;
    
    worldIndicator.removeIndicator(indicatorId);
    this.activeIndicators.delete(objectId);

    // Hide game message if no more indicators
    if (this.activeIndicators.size === 0) {
      GameHUD.getInstance().hideGameMessage();
    }
  }

  /**
   * Check all pots and show indicators for empty ones
   */
  public checkAllPots(mapId: string): void {
    const buildableManager = BuildableObjectManager.getInstance();
    const objects = buildableManager.getObjectsInMap(mapId);

    for (const obj of objects) {
      const template = buildableManager.getTemplate(obj.templateId);
      if (template?.zoneType === "plant" && obj.isComplete && !obj.hasPlant) {
        this.showIndicatorForPot(obj.id);
      }
    }
  }

  public dispose(): void {
    // Remove all indicators via WorldIndicatorSystem
    WorldIndicatorSystem.getInstance().removeIndicatorsByPrefix(INDICATOR_PREFIX);
    this.activeIndicators.clear();
  }
}
