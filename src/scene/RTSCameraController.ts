import {
  type ArcRotateCamera,
  Matrix,
  type Observer,
  PointerEventTypes,
  type PointerInfo,
  type Scene,
  Vector3,
} from "babylonjs";
import { SpawnValidator } from "../engine/SpawnValidator";
import { BuildingSystem } from "../game/BuildingSystem";
import { HarvestIndicator } from "../game/HarvestIndicator";
import { PrefabInstance } from "../loader/PrefabInstance";
import { UIManager } from "../ui/UIManager";

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
  private mouseLeaveHandler: () => void;
  private mouseEnterHandler: () => void;

  constructor(scene: Scene, camera: ArcRotateCamera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;

    // Initialize target
    this.targetPosition = this.camera.target.clone();

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
              const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
              if (pick.hit && pick.pickedMesh) {
                const mesh = pick.pickedMesh;

                // Check for harvest indicator click
                if (mesh.metadata?.isHarvestIndicator) {
                  const plantId = mesh.metadata.plantId;
                  HarvestIndicator.getInstance().handleIndicatorClick(plantId);
                }

                // Check for build zone click (separate from triggers)
                if (mesh.metadata?.isBuildZone) {
                  const buildingSystem = BuildingSystem.getInstance();
                  if (buildingSystem.inBuildMode && buildingSystem.selectedItem) {
                    const zoneId = mesh.metadata.zoneId;
                    buildingSystem.buildAt(zoneId);
                  }
                }

                // Check for trigger click
                if (
                  mesh.metadata &&
                  (mesh.metadata.isTrigger || mesh.metadata.properties?.classname?.includes("trigger"))
                ) {
                  console.log("TRIGGER CLICKED:", mesh.metadata.properties);

                  // Check for windowTarget
                  if (mesh.metadata.properties?.windowTarget) {
                    UIManager.getInstance().openDialog(mesh.metadata.properties.windowTarget, mesh.metadata.properties);
                  }

                  // Check for spawnModel - dynamically spawn a prefab
                  if (mesh.metadata.properties?.spawnModel) {
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
                      // Don't return - let the normal cleanup happen below
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
    if (!buildingSystem.inBuildMode) {
      if (buildingSystem.hoveredZoneId !== null) {
        buildingSystem.setHoveredZone(null);
      }
      return;
    }

    // Raycast to find what we're hovering over
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    
    if (pick.hit && pick.pickedMesh?.metadata?.isBuildZone) {
      const zoneId = pick.pickedMesh.metadata.zoneId;
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
