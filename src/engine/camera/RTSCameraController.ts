import {
  type ArcRotateCamera,
  Matrix,
  type Observer,
  PointerEventTypes,
  type PointerInfo,
  type Scene,
  Vector3,
} from "babylonjs";
import { EventBus } from "../core/EventBus";
import { SpawnValidator } from "../SpawnValidator";
import { GameScene } from "../GameScene";
import { BuildableObjectManager } from "../../game/BuildableObject";
import { BuildingSystem } from "../../game/BuildingSystem";
import { GameState } from "../../game/GameState";
import { HarvestIndicator } from "../../game/HarvestIndicator";
import { PrefabInstance } from "../loader/PrefabInstance";
import { PlantSystem } from "../../game/PlantSystem";
import { GameHUD } from "../../ui/GameHUD";
import { SeedSelectionPopup } from "../../ui/SeedSelectionPopup";
import { UIManager } from "../../ui/UIManager";
import { LampInfoPanel } from "../../ui/LampInfoPanel";

export class RTSCameraController {
  private camera: ArcRotateCamera;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  // Panning State
  private isDragging: boolean = false;
  private startGroundPosition: Vector3 | null = null;
  private isMouseInCanvas: boolean = true;
  private pointerDownPos: { x: number; y: number } | null = null;

  // Smoothing State
  private targetPosition: Vector3;
  private smoothingFactor: number = 0.15;

  // Configuration
  public edgeScrollEnabled: boolean = false;
  public edgeScrollSpeed: number = 1.0;
  public edgeScrollThreshold: number = 20;

  private observer: Observer<PointerInfo> | null = null;
  private renderObserver: Observer<Scene> | null = null;
  private mouseLeaveHandler!: () => void;
  private mouseEnterHandler!: () => void;

  constructor(scene: Scene, camera: ArcRotateCamera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;

    // Initialize target
    this.targetPosition = this.camera.target.clone();
    
    // Listen for map load events to sync targetPosition with new camera target
    EventBus.on("map:loaded", () => {
      this.syncTargetPosition();
    });
    
    this.initializeHandlers();
  }

  /**
   * Sync the controller's target position with the camera's current target.
   * Call this after changing the camera target externally (e.g., map load).
   */
  public syncTargetPosition(): void {
    this.targetPosition = this.camera.target.clone();
    console.log(`[RTSCameraController] Synced targetPosition to: ${this.targetPosition.toString()}`);
  }

  private initializeHandlers(): void {
    this.mouseLeaveHandler = () => {
      this.isDragging = false;
      this.startGroundPosition = null;
      this.isMouseInCanvas = false;
      this.pointerDownPos = null;
    };
    this.mouseEnterHandler = () => {
      this.isMouseInCanvas = true;
    };

    this.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.canvas.addEventListener("mouseenter", this.mouseEnterHandler);

    this.setupInput();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for pot:needs_seed event from PotActionIndicator
    EventBus.on<{ objectId: string; position: { x: number; y: number; z: number } }>("pot:needs_seed", (data) => {
      const buildableManager = BuildableObjectManager.getInstance();
      const buildableObj = buildableManager.getObject(data.objectId);
      if (!buildableObj) return;

      // Show seed selection popup
      SeedSelectionPopup.show(
        buildableObj.position,
        buildableObj.mapId,
        (result) => {
          // Just show notification, don't auto-open plant info
          const strain = PlantSystem.getInstance().getStrain(result.strainId);
          GameHUD.getInstance().showNotification(`Planted ${strain?.name ?? result.strainId}!`, "success");
        }
      );
    });
  }

  private setupInput(): void {
    this.observer = this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          if (pointerInfo.event.button === 0) {
            // Left Click
            this.isDragging = true;
            this.pointerDownPos = { x: this.scene.pointerX, y: this.scene.pointerY };

            // Raycast to ground to find where we grabbed
            this.startGroundPosition = this.getGroundPosition();

            // Reset target to current to avoid jump
            this.targetPosition.copyFrom(this.camera.target);
          }
          break;
        case PointerEventTypes.POINTERUP:
          if (this.isDragging) {
            // Check if we moved significantly
            const dx = this.scene.pointerX - (this.pointerDownPos?.x || 0);
            const dy = this.scene.pointerY - (this.pointerDownPos?.y || 0);
            const distSq = dx * dx + dy * dy;

            // If moved less than 5 pixels, treat as click
            if (distSq < 25) {
              // Use multiPick to find ALL meshes under cursor (handles overlapping objects)
              const multiPick = this.scene.multiPick(this.scene.pointerX, this.scene.pointerY);
              
              // Check for harvest indicator click first
              const harvestIndicatorPick = multiPick?.find(p => p.hit && p.pickedMesh?.metadata?.isHarvestIndicator);
              if (harvestIndicatorPick && harvestIndicatorPick.pickedMesh) {
                const plantId = harvestIndicatorPick.pickedMesh.metadata.plantId;
                HarvestIndicator.getInstance().handleIndicatorClick(plantId);
              }

              // Check for plant zone click (prioritize over growlight)
              const plantZonePick = multiPick?.find(p => 
                p.hit && 
                p.pickedMesh?.metadata?.isBuildableObject && 
                p.pickedMesh?.metadata?.zoneType === "plant"
              );
              
              if (plantZonePick && plantZonePick.pickedMesh) {
                const mesh = plantZonePick.pickedMesh;
                const buildableObjectId = mesh.metadata.buildableObjectId;
                const buildableObj = BuildableObjectManager.getInstance().getObject(buildableObjectId);
                console.log("[RTSCamera] Plant zone clicked, buildableObj:", buildableObj?.id);
                if (buildableObj) {
                  // Find plant at this position
                  const plants = GameState.getInstance().getPlants();
                  const plant = plants.find(p => 
                    Math.abs(p.position.x - buildableObj.position.x) < 5 &&
                    Math.abs(p.position.z - buildableObj.position.z) < 5
                  );
                  console.log("[RTSCamera] Found plant:", plant?.id, "strain:", plant?.strain);
                  if (plant) {
                    // Check if plant is harvestable - show harvest panel instead of management dialog
                    const harvestIndicator = HarvestIndicator.getInstance();
                    const isHarvestable = harvestIndicator.isHarvestable(plant.id);
                    console.log("[RTSCamera] Plant isHarvestable:", isHarvestable);
                    if (isHarvestable) {
                      console.log("[RTSCamera] Showing harvest panel for:", plant.id);
                      harvestIndicator.showHarvestPanel(plant.id);
                    } else {
                      // Show plant info modal (new UI system)
                      console.log("[RTSCamera] Showing plant info for:", plant.id);
                      GameScene.getInstance().showPlantInfo(plant.id);
                    }
                  } else {
                    // No plant in this pot - show seed selection popup
                    SeedSelectionPopup.show(
                      buildableObj.position,
                      buildableObj.mapId,
                      (result) => {
                        // Just show notification, don't auto-open plant info
                        const strain = PlantSystem.getInstance().getStrain(result.strainId);
                        GameHUD.getInstance().showNotification(`Planted ${strain?.name ?? result.strainId}!`, "success");
                      }
                    );
                  }
                }
              } else {
                // Check for growlight click (only if no plant was clicked)
                const growlightPick = multiPick?.find(p => 
                  p.hit && 
                  p.pickedMesh?.metadata?.isBuildableObject && 
                  p.pickedMesh?.metadata?.zoneType === "growlight"
                );
                
                if (growlightPick && growlightPick.pickedMesh) {
                  const buildableObjectId = growlightPick.pickedMesh.metadata.buildableObjectId;
                  const buildableObj = BuildableObjectManager.getInstance().getObject(buildableObjectId);
                  if (buildableObj && buildableObj.isComplete) {
                    LampInfoPanel.getInstance().show(buildableObjectId, buildableObj.position);
                  }
                }
              }

              // Check for build zone click (separate from triggers)
              const buildingSystem = BuildingSystem.getInstance();
              if (buildingSystem.inBuildMode && buildingSystem.selectedItem) {
                // Use multiPick to find ALL meshes under cursor, then find matching zone type
                const buildMultiPick = this.scene.multiPick(this.scene.pointerX, this.scene.pointerY);
                const targetZoneType = buildingSystem.selectedItem.zoneType;
                
                // Find a build zone that matches our selected item's zone type
                const matchingZone = buildMultiPick?.find(p => 
                  p.hit && 
                  p.pickedMesh?.metadata?.isBuildZone && 
                  p.pickedMesh?.metadata?.zoneType === targetZoneType
                );
                
                if (matchingZone && matchingZone.pickedMesh) {
                  const zoneId = matchingZone.pickedMesh.metadata.zoneId;
                  buildingSystem.buildAt(zoneId);
                } else if (!buildMultiPick?.some(p => p.pickedMesh?.metadata?.isBuildZone)) {
                  // Clicked outside any build zone while in build mode - cancel
                  buildingSystem.exitBuildMode();
                }
                // If clicked on wrong zone type, stay in build mode (user might click correct zone)
              }

              // Check for trigger click
              const triggerPick = multiPick?.find(p => 
                p.hit && 
                p.pickedMesh?.metadata &&
                (p.pickedMesh.metadata.isTrigger || p.pickedMesh.metadata.properties?.classname?.includes("trigger"))
              );
              
              if (triggerPick && triggerPick.pickedMesh) {
                const mesh = triggerPick.pickedMesh;
                console.log("TRIGGER CLICKED:", mesh.metadata.properties);

                // Check for windowTarget
                if (mesh.metadata.properties?.windowTarget) {
                  UIManager.getInstance().openDialog(mesh.metadata.properties.windowTarget, mesh.metadata.properties);
                }

                // Check for targetMap - map transition
                if (mesh.metadata.properties?.targetMap) {
                  const props = mesh.metadata.properties;
                  
                  // Check level requirement
                  if (props.requiredLevel) {
                    const playerLevel = GameState.getInstance().getPlayer().level;
                    const requiredLevel = parseInt(props.requiredLevel, 10);
                    console.log(`Level check: player ${playerLevel}, required ${requiredLevel}`);
                    if (playerLevel < requiredLevel) {
                      const message = props.deniedMessage || `Requires level ${requiredLevel}`;
                      GameHUD.getInstance().showNotification(message, "warning");
                      console.log(`Map transition blocked: ${message}`);
                      // Don't return - let the pointer up handler finish to reset isDragging
                    }
                  }
                  
                  // Only proceed with map transition if level check passed
                  const canTransition = !props.requiredLevel || 
                    GameState.getInstance().getPlayer().level >= parseInt(props.requiredLevel, 10);
                  
                  if (canTransition) {
                    console.log(`Switching to map: ${props.targetMap}`);
                    const gameScene = GameScene.getInstance();
                    if (gameScene) {
                      // Record the trigger position so we can return to it later
                      // Get center of trigger mesh bounding box (mesh.position is 0,0,0 for brushes)
                      mesh.computeWorldMatrix(true);
                      const boundingInfo = mesh.getBoundingInfo();
                      const triggerPos = boundingInfo.boundingBox.centerWorld.clone();
                      console.log(`[RTSCamera] Trigger center: ${triggerPos.toString()}`);
                      gameScene.setMapEntryTrigger(props.targetMap, triggerPos);
                      
                      gameScene.loadMap(props.targetMap).catch(err => {
                        console.error("Failed to load map:", err);
                      });
                      // Stop processing - mesh will be disposed after map load
                      return;
                    } else {
                      console.error("GameScene instance not found!");
                    }
                  }
                }

                // Check for spawnModel - dynamically spawn a prefab
                if (mesh.metadata?.properties?.spawnModel) {
                  const props = mesh.metadata.properties;
                  
                  // Parse spawn position (defaults to trigger origin if not specified)
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
                    // TODO: Could show UI feedback here
                  } else {
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
                  }
                }
              }
            }
          }
          this.isDragging = false;
          this.startGroundPosition = null;
          this.pointerDownPos = null;
          break;
        case PointerEventTypes.POINTERMOVE:
          if (this.isDragging) {
            this.handleDrag();
          }
          
          // Track hovered build zone for visual feedback
          this.updateHoveredBuildZone();
          break;
      }
    });

    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.handleEdgeScroll();
      this.applySmoothing();
    });
  }

  private getGroundPosition(): Vector3 | null {
    // Create a ray from the camera passing through the mouse position
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);

    // Intersect with Plane Y=0
    if (Math.abs(ray.direction.y) < 0.0001) return null; // Parallel to plane

    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null; // Behind camera

    return ray.origin.add(ray.direction.scale(t));
  }

  private handleDrag(): void {
    if (!this.startGroundPosition) return;

    const currentGroundPos = this.getGroundPosition();
    if (!currentGroundPos) return;

    const delta = this.startGroundPosition.subtract(currentGroundPos);

    // Safety check for NaN/Infinity
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || !Number.isFinite(delta.z)) return;
    if (delta.lengthSquared() > 10000) return; // Prevent massive jumps

    // Apply to target
    this.targetPosition.addInPlace(delta);

    // CRITICAL: Snap camera to target immediately while dragging.
    this.camera.target.copyFrom(this.targetPosition);

    // Recalculate startGroundPosition based on the NEW camera position
    this.startGroundPosition = this.getGroundPosition();
  }

  private handleEdgeScroll(): void {
    if (!this.edgeScrollEnabled || this.isDragging || !this.isMouseInCanvas) return;

    const x = this.scene.pointerX;
    const y = this.scene.pointerY;

    if (x < 0 || y < 0 || x > this.canvas.width || y > this.canvas.height) return;

    let moveX = 0;
    let moveY = 0;

    if (x < this.edgeScrollThreshold) {
      moveX = -this.edgeScrollSpeed;
    } else if (x > this.canvas.width - this.edgeScrollThreshold) {
      moveX = this.edgeScrollSpeed;
    }

    if (y < this.edgeScrollThreshold) {
      moveY = -this.edgeScrollSpeed;
    } else if (y > this.canvas.height - this.edgeScrollThreshold) {
      moveY = this.edgeScrollSpeed;
    }

    if (moveX !== 0 || moveY !== 0) {
      const forward = this.camera.getDirection(Vector3.Forward());
      forward.y = 0;
      forward.normalize();

      const right = this.camera.getDirection(Vector3.Right());
      right.y = 0;
      right.normalize();

      const moveVector = right.scale(moveX).add(forward.scale(-moveY));
      this.targetPosition.addInPlace(moveVector);
    }
  }

  private applySmoothing(): void {
    // Only smooth if NOT dragging (dragging is 1:1 locked)
    if (this.isDragging) return;

    if (!this.camera.target.equals(this.targetPosition)) {
      this.camera.target = Vector3.Lerp(this.camera.target, this.targetPosition, this.smoothingFactor);

      if (Vector3.DistanceSquared(this.camera.target, this.targetPosition) < 0.001) {
        this.camera.target.copyFrom(this.targetPosition);
      }
    }
  }

  private updateHoveredBuildZone(): void {
    const buildingSystem = BuildingSystem.getInstance();
    
    // Only track hover when in build mode
    if (!buildingSystem.inBuildMode || !buildingSystem.selectedItem) {
      if (buildingSystem.hoveredZoneId !== null) {
        buildingSystem.setHoveredZone(null);
      }
      return;
    }

    // Use multiPick to find ALL meshes under cursor, then find matching zone type
    const multiPick = this.scene.multiPick(this.scene.pointerX, this.scene.pointerY);
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

  public dispose(): void {
    if (this.observer) {
      this.scene.onPointerObservable.remove(this.observer);
    }
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    }
    this.canvas.removeEventListener("mouseleave", this.mouseLeaveHandler);
    this.canvas.removeEventListener("mouseenter", this.mouseEnterHandler);
  }
}
