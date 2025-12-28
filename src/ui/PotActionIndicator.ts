/**
 * PotActionIndicator - Shows bouncing icons above pots that need player action
 * (e.g., empty pots that need a strain selected)
 * 
 * Now uses WorldIndicatorSystem for positioning and rendering.
 */

import { BuildableSystem } from "../engine/BuildableSystem";
import { EventBus } from "../engine/core/EventBus";
import { GameScene } from "../engine/GameScene";
import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";

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
      this.checkCurrentMapPots();
    }, 500);
  }

  /**
   * Check pots in the current map only
   */
  private checkCurrentMapPots(): void {
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap) return;
    this.checkAllPots(currentMap);
  }

  private setupEventListeners(): void {
    // Listen for pot completion via EventBus
    EventBus.on<{ objectId: string; template: { zoneType: string } }>("building:completed", (data) => {
      if (data.template.zoneType === "plant") {
        this.showIndicatorForPot(data.objectId);
      }
    });

    // Listen for plant being planted (stage changed with plant in customData)
    EventBus.on<{ objectId: string }>("building:stage_changed", (data) => {
      const buildableSystem = BuildableSystem.getInstance();
      const instance = buildableSystem.getInstance(data.objectId);
      if (instance?.customData?.plantId) {
        this.hideIndicator(data.objectId);
      }
    });

    // Listen for plant state changed (child added to pot)
    EventBus.on<{ objectId: string; hasPlant: boolean }>("building:plant_state_changed", (data) => {
      if (data.hasPlant) {
        this.hideIndicator(data.objectId);
      }
    });
    
    // Restore indicator if seed selection was cancelled
    EventBus.on<{ objectId: string }>("pot:restore_indicator", (data) => {
      this.showIndicatorForPot(data.objectId);
    });
    
    // Clear and rescan on map change
    EventBus.on("map:loaded", () => {
      this.activeIndicators.clear();
      setTimeout(() => {
        this.checkCurrentMapPots();
      }, 100);
    });
  }

  public showIndicatorForPot(objectId: string): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    
    // Don't show if WorldIndicatorSystem not initialized yet
    if (!worldIndicator.isInitialized()) {
      return;
    }

    const buildableSystem = BuildableSystem.getInstance();
    const instance = buildableSystem.getInstance(objectId);
    
    if (!instance || instance.customData?.plantId) return;
    
    // Only show indicators for pots in the CURRENT map
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap || instance.mapId !== currentMap) return;

    // Check if indicator already exists
    const indicatorId = `${INDICATOR_PREFIX}${objectId}`;
    if (worldIndicator.hasIndicator(indicatorId)) return;

    // Add indicator using WorldIndicatorSystem
    worldIndicator.addIndicator({
      id: indicatorId,
      worldPosition: instance.position,
      config: {
        icon: "🌱",
        label: "Select strain",
        animation: "bounce",
        offsetY: 40,
        onClick: () => {
          // Hide indicator immediately when clicked to prevent race conditions
          // (user clicking fast on multiple pots before async plant flow completes)
          this.hideIndicator(objectId);
          EventBus.emit("pot:needs_seed", { objectId, position: instance.position });
        },
      },
      data: { objectId },
    });

    this.activeIndicators.add(objectId);
  }

  public hideIndicator(objectId: string): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    const indicatorId = `${INDICATOR_PREFIX}${objectId}`;
    
    worldIndicator.removeIndicator(indicatorId);
    this.activeIndicators.delete(objectId);
  }

  /**
   * Check all pots and show indicators for empty ones
   */
  public checkAllPots(mapId: string): void {
    const buildableSystem = BuildableSystem.getInstance();
    const instances = buildableSystem.getInstancesInMap(mapId);

    for (const inst of instances) {
      const template = buildableSystem.getTemplate(inst.templateId);
      // Check if it's a pot (plant category) that's complete and has no plant
      if (template?.category === "plant" && inst.isComplete && !inst.customData?.plantId) {
        this.showIndicatorForPot(inst.id);
      }
    }
  }

  public dispose(): void {
    // Remove all indicators via WorldIndicatorSystem
    WorldIndicatorSystem.getInstance().removeIndicatorsByPrefix(INDICATOR_PREFIX);
    this.activeIndicators.clear();
  }
}
