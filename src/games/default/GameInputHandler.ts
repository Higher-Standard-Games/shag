/**
 * GameInputHandler - Game-specific click and input handling
 * 
 * Handles all game-specific interactions like:
 * - Plant zone clicks (planting, plant info, harvesting)
 * - Growlight clicks
 * - Trigger clicks (map transitions, dialogs, spawning)
 * - Build zone clicks
 * - Harvest indicator clicks
 * 
 * This separates game logic from the engine-level camera controller.
 */

import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { EventBus } from "../../engine/core/EventBus";
import { BuildableSystem } from "../../engine/BuildableSystem";
import { SpawnValidator } from "../../engine/SpawnValidator";
import { PrefabInstance } from "../../engine/loader";
import { GameScene } from "./GameScene";
import { BuildingSystem } from "./BuildingSystem";
import { GameState } from "./GameState";
import { HarvestIndicator } from "./HarvestIndicator";
import { PlantSystem } from "./PlantSystem";
import { GameHUD } from "./ui/GameHUD";
import { SeedSelectionPopup } from "./ui/SeedSelectionPopup";
import { UIManager } from "./ui/UIManager";
import { LampInfoPanel } from "./ui/LampInfoPanel";

export class GameInputHandler {
  private static instance: GameInputHandler | null = null;

  private scene: Scene;

  private constructor(scene: Scene) {
    this.scene = scene;
    this.setupEventListeners();
  }

  static init(scene: Scene): GameInputHandler {
    if (GameInputHandler.instance) {
      GameInputHandler.instance.dispose();
    }
    GameInputHandler.instance = new GameInputHandler(scene);
    return GameInputHandler.instance;
  }

  static getInstance(): GameInputHandler | null {
    return GameInputHandler.instance;
  }

  /**
   * Handle a click at the given screen coordinates
   * Called by the camera controller's click callback
   */
  handleClick(screenX: number, screenY: number, wasDrag: boolean): void {
    // Only process clicks, not drags
    if (wasDrag) return;

    // Check if click is over UI elements - don't process scene clicks on UI
    const bottomBar = document.getElementById('bottom-bar');
    const gameHud = document.getElementById('game-hud');
    const debugConsole = document.getElementById('debug-console');
    
    // Check if click is within any UI element bounds
    const isOverUI = [bottomBar, gameHud, debugConsole].some(el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return screenX >= rect.left && screenX <= rect.right && 
             screenY >= rect.top && screenY <= rect.bottom;
    });
    
    if (isOverUI) {
      // Click is on UI element - skip scene handling
      return;
    }

    // Use multiPick to find ALL meshes under cursor
    const multiPick = this.scene.multiPick(screenX, screenY);
    if (!multiPick || multiPick.length === 0) return;

    // Check for harvest indicator click first (highest priority)
    if (this.handleHarvestIndicatorClick(multiPick)) return;

    // Check for plant zone click
    if (this.handlePlantZoneClick(multiPick)) return;

    // Check for growlight click
    if (this.handleGrowlightClick(multiPick)) return;

    // Check for build zone click (when in build mode)
    if (this.handleBuildZoneClick(multiPick, screenX, screenY)) return;

    // Check for trigger click
    this.handleTriggerClick(multiPick);
  }

  /**
   * Handle pointer move for hover effects
   */
  handlePointerMove(screenX: number, screenY: number): void {
    this.updateHoveredBuildZone(screenX, screenY);
  }

  private setupEventListeners(): void {
    // Listen for pot:needs_seed event from PotActionIndicator
    EventBus.on<{ objectId: string; position: { x: number; y: number; z: number } }>("pot:needs_seed", (data) => {
      const buildableSystem = BuildableSystem.getInstance();
      const buildableInst = buildableSystem.getInstance(data.objectId);
      if (!buildableInst) return;

      // Show seed selection popup
      SeedSelectionPopup.show(
        buildableInst.position,
        buildableInst.mapId,
        (result) => {
          const strain = PlantSystem.getInstance().getStrain(result.strainId);
          GameHUD.getInstance().showNotification(`Planted ${strain?.name ?? result.strainId}!`, "success");
        },
        () => {
          // On cancel - restore indicator if pot is still empty
          if (!buildableInst.customData?.plantId) {
            EventBus.emit("pot:restore_indicator", { objectId: data.objectId });
          }
        }
      );
    });
  }

  private handleHarvestIndicatorClick(multiPick: ReturnType<Scene["multiPick"]>): boolean {
    const harvestIndicatorPick = multiPick?.find(p =>
      p.hit && p.pickedMesh?.metadata?.isHarvestIndicator
    );

    if (harvestIndicatorPick && harvestIndicatorPick.pickedMesh) {
      const plantId = harvestIndicatorPick.pickedMesh.metadata.plantId;
      HarvestIndicator.getInstance().handleIndicatorClick(plantId);
      return true;
    }
    return false;
  }

  private handlePlantZoneClick(multiPick: ReturnType<Scene["multiPick"]>): boolean {
    const plantZonePick = multiPick?.find(p =>
      p.hit &&
      p.pickedMesh?.metadata?.isBuildableObject &&
      p.pickedMesh?.metadata?.zoneType === "plant"
    );

    if (!plantZonePick || !plantZonePick.pickedMesh) return false;

    const mesh = plantZonePick.pickedMesh;
    const buildableObjectId = mesh.metadata.buildableObjectId;
    const buildableInst = BuildableSystem.getInstance().getInstance(buildableObjectId);

    if (!buildableInst) return false;

    // Find plant at this position
    const plants = GameState.getInstance().getPlants();
    const plant = plants.find(p =>
      Math.abs(p.position.x - buildableInst.position.x) < 5 &&
      Math.abs(p.position.z - buildableInst.position.z) < 5
    );

    if (plant) {
      // Check if plant is harvestable
      const harvestIndicator = HarvestIndicator.getInstance();
      const isHarvestable = harvestIndicator.isHarvestable(plant.id);

      if (isHarvestable) {
        harvestIndicator.showHarvestPanel(plant.id);
      } else {
        // Show plant info modal
        GameScene.getInstance().showPlantInfo(plant.id);
      }
    } else {
      // No plant in this pot - show seed selection popup
      SeedSelectionPopup.show(
        buildableInst.position,
        buildableInst.mapId,
        (result) => {
          const strain = PlantSystem.getInstance().getStrain(result.strainId);
          GameHUD.getInstance().showNotification(`Planted ${strain?.name ?? result.strainId}!`, "success");
        }
      );
    }

    return true;
  }

  private handleGrowlightClick(multiPick: ReturnType<Scene["multiPick"]>): boolean {
    const growlightPick = multiPick?.find(p =>
      p.hit &&
      p.pickedMesh?.metadata?.isBuildableObject &&
      p.pickedMesh?.metadata?.zoneType === "growlight"
    );

    if (!growlightPick || !growlightPick.pickedMesh) return false;

    const buildableObjectId = growlightPick.pickedMesh.metadata.buildableObjectId;
    const buildableInst = BuildableSystem.getInstance().getInstance(buildableObjectId);

    if (buildableInst && buildableInst.isComplete) {
      LampInfoPanel.getInstance().show(buildableObjectId, buildableInst.position);
      return true;
    }

    return false;
  }

  private handleBuildZoneClick(multiPick: ReturnType<Scene["multiPick"]>, _screenX: number, _screenY: number): boolean {
    const buildingSystem = BuildingSystem.getInstance();

    if (!buildingSystem.inBuildMode || !buildingSystem.selectedItem) return false;

    const targetZoneType = buildingSystem.selectedItem.zoneType;

    // Find a build zone that matches our selected item's zone type
    const matchingZone = multiPick?.find(p =>
      p.hit &&
      p.pickedMesh?.metadata?.isBuildZone &&
      p.pickedMesh?.metadata?.zoneType === targetZoneType
    );

    if (matchingZone && matchingZone.pickedMesh) {
      const zoneId = matchingZone.pickedMesh.metadata.zoneId;
      buildingSystem.buildAt(zoneId);
      return true;
    } else if (!multiPick?.some(p => p.pickedMesh?.metadata?.isBuildZone)) {
      // Clicked outside any build zone while in build mode - cancel
      buildingSystem.exitBuildMode();
      return true;
    }

    // If clicked on wrong zone type, stay in build mode
    return false;
  }

  private handleTriggerClick(multiPick: ReturnType<Scene["multiPick"]>): boolean {
    const triggerPick = multiPick?.find(p =>
      p.hit &&
      p.pickedMesh?.metadata &&
      (p.pickedMesh.metadata.isTrigger || p.pickedMesh.metadata.properties?.classname?.includes("trigger"))
    );

    if (!triggerPick || !triggerPick.pickedMesh) return false;

    const mesh = triggerPick.pickedMesh;
    const props = mesh.metadata.properties;

    // Check for windowTarget (dialog)
    if (props?.windowTarget) {
      UIManager.getInstance().openDialog(props.windowTarget, props);
    }

    // Check for targetMap - map transition
    if (props?.targetMap) {
      return this.handleMapTransition(mesh, props);
    }

    // Check for spawnModel - dynamically spawn a prefab
    if (props?.spawnModel) {
      return this.handleSpawn(props);
    }

    return true;
  }

  private handleMapTransition(mesh: any, props: any): boolean {
    // Check level requirement
    if (props.requiredLevel) {
      const playerLevel = GameState.getInstance().getPlayer().level;
      const requiredLevel = parseInt(props.requiredLevel, 10);

      if (playerLevel < requiredLevel) {
        const message = props.deniedMessage || `Requires level ${requiredLevel}`;
        GameHUD.getInstance().showNotification(message, "warning");
        return true;
      }
    }

    const gameScene = GameScene.getInstance();
    if (!gameScene) {
      console.error("GameScene instance not found!");
      return true;
    }

    // Record the trigger position for return
    mesh.computeWorldMatrix(true);
    const boundingInfo = mesh.getBoundingInfo();
    const triggerPos = boundingInfo.boundingBox.centerWorld.clone();
    gameScene.setMapEntryTrigger(props.targetMap, triggerPos);

    gameScene.loadMap(props.targetMap).catch(err => {
      console.error("Failed to load map:", err);
    });

    return true;
  }

  private handleSpawn(props: any): boolean {
    // Parse spawn position
    let spawnPos = new Vector3(0, 0, 0);
    const spawnOrigin = props.spawnOrigin || props.origin;
    if (spawnOrigin) {
      const parts = spawnOrigin.split(" ").map(parseFloat);
      spawnPos = new Vector3(parts[0], parts[2], parts[1]); // Quake to Babylon coords
    }

    // Validate spawn
    const validatorIds = props.spawnValidators
      ? props.spawnValidators.split(",").map((s: string) => s.trim())
      : undefined;

    const validation = SpawnValidator.getInstance().validate(
      {
        prefabName: props.spawnModel,
        position: spawnPos,
        scene: this.scene,
        triggerProperties: props,
      },
      validatorIds
    );

    if (!validation.allowed) {
      console.log(`Spawn blocked: ${validation.reason}`);
      return true;
    }

    // Spawn the prefab
    PrefabInstance.create(props.spawnModel, this.scene, {
      position: spawnPos,
      angle: props.spawnAngle ? parseFloat(props.spawnAngle) : Math.random() * 360,
      scale: props.spawnScale ? parseFloat(props.spawnScale) : 1,
      dropToGround: props.spawnDropToGround === "1",
      dropOffset: props.spawnDropOffset ? parseFloat(props.spawnDropOffset) : 0,
    }).then((result) => {
      if (result) {
        console.log(`Spawned prefab: ${props.spawnModel} at ${result.finalPosition.toString()}`);
      }
    });

    return true;
  }

  private updateHoveredBuildZone(screenX: number, screenY: number): void {
    const buildingSystem = BuildingSystem.getInstance();

    // Only track hover when in build mode
    if (!buildingSystem.inBuildMode || !buildingSystem.selectedItem) {
      if (buildingSystem.hoveredZoneId !== null) {
        buildingSystem.setHoveredZone(null);
      }
      return;
    }

    // Use multiPick to find ALL meshes under cursor
    const multiPick = this.scene.multiPick(screenX, screenY);
    const targetZoneType = buildingSystem.selectedItem.zoneType;

    // Find a build zone that matches our selected item's zone type
    const matchingZone = multiPick?.find(p =>
      p.hit &&
      p.pickedMesh?.metadata?.isBuildZone &&
      p.pickedMesh?.metadata?.zoneType === targetZoneType
    );

    if (matchingZone && matchingZone.pickedMesh) {
      const zoneId = matchingZone.pickedMesh.metadata.zoneId;
      buildingSystem.setHoveredZone(zoneId);
    } else {
      buildingSystem.setHoveredZone(null);
    }
  }

  dispose(): void {
    // EventBus listeners are cleaned up automatically
    GameInputHandler.instance = null;
  }
}
