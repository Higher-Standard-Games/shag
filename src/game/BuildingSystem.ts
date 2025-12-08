/**
 * BuildingSystem - Manages build zones and item placement
 */

import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "babylonjs";
import { BuildableObjectManager } from "./BuildableObject";
import { GameState } from "./GameState";
import { GameTimer } from "./GameTimer";
import { QuestSystem } from "./QuestSystem";

export interface BuildZone {
  id: string;
  position: Vector3;
  size: number;
  zoneType: string; // "plant", "equipment", "decoration", etc.
  occupied: boolean;
  occupiedBy: string | null; // ID of item/plant in this zone
  mesh: Mesh | null; // Visual indicator (fill)
  borderMesh: Mesh | null; // Border outline
  mapId: string;
}

export interface BuildableItem {
  id: string;
  name: string;
  icon: string;
  zoneType: string; // What zone type this can be placed in
  cost: number;
  requiredLevel: number;
  prefab?: string; // Prefab to spawn
  sprite?: string; // Sprite to spawn
  onBuild?: (zone: BuildZone) => void; // Custom build action
}

type BuildEventCallback = (event: string, data: unknown) => void;

export class BuildingSystem {
  private static instance: BuildingSystem;

  private scene: Scene | null = null;
  private zones: Map<string, BuildZone> = new Map();
  private buildableItems: Map<string, BuildableItem> = new Map();
  private currentMapId: string = "";

  // Build mode state
  private _inBuildMode: boolean = false;
  private _selectedZoneType: string | null = null;
  private _selectedItem: BuildableItem | null = null;
  private _hoveredZoneId: string | null = null;
  
  // Materials
  private highlightMaterial: StandardMaterial | null = null;
  private occupiedMaterial: StandardMaterial | null = null;
  private normalMaterial: StandardMaterial | null = null;
  private borderMaterial: StandardMaterial | null = null;
  private borderHoverMaterial: StandardMaterial | null = null;
  private borderOccupiedMaterial: StandardMaterial | null = null;
  
  // Animation
  private pulsationTaskId = "build_zone_pulsation";
  private pulsationPhase = 0;

  private eventListeners: BuildEventCallback[] = [];

  private constructor() {
    // No default items - game code registers items via registerItem()
  }

  public static getInstance(): BuildingSystem {
    if (!BuildingSystem.instance) {
      BuildingSystem.instance = new BuildingSystem();
    }
    return BuildingSystem.instance;
  }

  public static resetInstance(): void {
    BuildingSystem.instance = null as any;
  }

  // ==================== Initialization ====================

  public init(scene: Scene): void {
    this.scene = scene;
    this.createMaterials();
  }

  private createMaterials(): void {
    if (!this.scene) return;

    // Highlight material (green, for available zones) - subtle fill
    this.highlightMaterial = new StandardMaterial("buildZone_highlight", this.scene);
    this.highlightMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2);
    this.highlightMaterial.emissiveColor = new Color3(0.05, 0.2, 0.05);
    this.highlightMaterial.alpha = 0.15; // Very subtle fill
    this.highlightMaterial.backFaceCulling = false;

    // Occupied material (red, for taken zones)
    this.occupiedMaterial = new StandardMaterial("buildZone_occupied", this.scene);
    this.occupiedMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2);
    this.occupiedMaterial.emissiveColor = new Color3(0.2, 0.05, 0.05);
    this.occupiedMaterial.alpha = 0.15;
    this.occupiedMaterial.backFaceCulling = false;

    // Normal material (invisible when not in build mode)
    this.normalMaterial = new StandardMaterial("buildZone_normal", this.scene);
    this.normalMaterial.diffuseColor = new Color3(0.3, 0.6, 0.3);
    this.normalMaterial.emissiveColor = new Color3(0.1, 0.3, 0.1);
    this.normalMaterial.alpha = 0;
    this.normalMaterial.backFaceCulling = false;

    // Border material (bright green outline)
    this.borderMaterial = new StandardMaterial("buildZone_border", this.scene);
    this.borderMaterial.diffuseColor = new Color3(0.3, 1.0, 0.3);
    this.borderMaterial.emissiveColor = new Color3(0.2, 0.8, 0.2);
    this.borderMaterial.alpha = 0.8;
    this.borderMaterial.backFaceCulling = false;

    // Border hover material (brighter, for hovered zone)
    this.borderHoverMaterial = new StandardMaterial("buildZone_border_hover", this.scene);
    this.borderHoverMaterial.diffuseColor = new Color3(0.5, 1.0, 0.5);
    this.borderHoverMaterial.emissiveColor = new Color3(0.4, 1.0, 0.4);
    this.borderHoverMaterial.alpha = 1.0;
    this.borderHoverMaterial.backFaceCulling = false;

    // Border occupied material (red outline)
    this.borderOccupiedMaterial = new StandardMaterial("buildZone_border_occupied", this.scene);
    this.borderOccupiedMaterial.diffuseColor = new Color3(1.0, 0.3, 0.3);
    this.borderOccupiedMaterial.emissiveColor = new Color3(0.6, 0.1, 0.1);
    this.borderOccupiedMaterial.alpha = 0.6;
    this.borderOccupiedMaterial.backFaceCulling = false;
  }

  // ==================== Zone Management ====================

  /**
   * Register a build zone from map entity
   */
  public registerZone(
    id: string,
    position: Vector3,
    size: number,
    zoneType: string,
    mapId: string
  ): BuildZone {
    const zone: BuildZone = {
      id,
      position,
      size,
      zoneType,
      occupied: false,
      occupiedBy: null,
      mesh: null,
      borderMesh: null,
      mapId,
    };

    // Create visual meshes
    zone.mesh = this.createZoneMesh(zone);
    zone.borderMesh = this.createBorderMesh(zone);

    this.zones.set(id, zone);
    console.log(`Registered build zone: ${id} (${zoneType}) at ${position.toString()}`);

    return zone;
  }

  private createZoneMesh(zone: BuildZone): Mesh | null {
    if (!this.scene) return null;

    // Create a flat plane for the zone
    const mesh = MeshBuilder.CreateGround(
      `buildZone_${zone.id}`,
      { width: zone.size, height: zone.size },
      this.scene
    );

    mesh.position = zone.position.clone();
    mesh.position.y += 0.5; // Slightly above ground to avoid z-fighting

    mesh.material = this.normalMaterial;

    // Store zone reference in metadata
    mesh.metadata = {
      isBuildZone: true,
      zoneId: zone.id,
      zoneType: zone.zoneType,
    };

    // Make it pickable
    mesh.isPickable = true;

    return mesh;
  }

  private createBorderMesh(zone: BuildZone): Mesh | null {
    if (!this.scene) return null;

    const halfSize = zone.size / 2;
    const borderHeight = 2; // Height of the border walls
    const borderThickness = 1; // Thickness of border

    // Create 4 border segments as thin boxes
    const borders: Mesh[] = [];

    // North border
    const north = MeshBuilder.CreateBox(`border_n_${zone.id}`, {
      width: zone.size + borderThickness,
      height: borderHeight,
      depth: borderThickness,
    }, this.scene);
    north.position.set(0, borderHeight / 2, halfSize);
    borders.push(north);

    // South border
    const south = MeshBuilder.CreateBox(`border_s_${zone.id}`, {
      width: zone.size + borderThickness,
      height: borderHeight,
      depth: borderThickness,
    }, this.scene);
    south.position.set(0, borderHeight / 2, -halfSize);
    borders.push(south);

    // East border
    const east = MeshBuilder.CreateBox(`border_e_${zone.id}`, {
      width: borderThickness,
      height: borderHeight,
      depth: zone.size + borderThickness,
    }, this.scene);
    east.position.set(halfSize, borderHeight / 2, 0);
    borders.push(east);

    // West border
    const west = MeshBuilder.CreateBox(`border_w_${zone.id}`, {
      width: borderThickness,
      height: borderHeight,
      depth: zone.size + borderThickness,
    }, this.scene);
    west.position.set(-halfSize, borderHeight / 2, 0);
    borders.push(west);

    // Merge into single mesh
    const borderMesh = Mesh.MergeMeshes(borders, true, true, undefined, false, true);
    if (!borderMesh) return null;

    borderMesh.name = `buildZoneBorder_${zone.id}`;
    borderMesh.position = zone.position.clone();
    borderMesh.position.y += 0.5;
    borderMesh.material = this.borderMaterial;
    borderMesh.visibility = 0; // Hidden by default
    borderMesh.isPickable = false;

    // Store zone reference
    borderMesh.metadata = {
      isBuildZoneBorder: true,
      zoneId: zone.id,
    };

    return borderMesh;
  }

  public getZone(id: string): BuildZone | undefined {
    return this.zones.get(id);
  }

  public getZonesByType(zoneType: string): BuildZone[] {
    return Array.from(this.zones.values()).filter(z => z.zoneType === zoneType);
  }

  public getAvailableZones(zoneType: string): BuildZone[] {
    return this.getZonesByType(zoneType).filter(z => !z.occupied);
  }

  public getZonesInMap(mapId: string): BuildZone[] {
    return Array.from(this.zones.values()).filter(z => z.mapId === mapId);
  }

  // ==================== Build Mode ====================

  public get inBuildMode(): boolean {
    return this._inBuildMode;
  }

  public get selectedZoneType(): string | null {
    return this._selectedZoneType;
  }

  public get selectedItem(): BuildableItem | null {
    return this._selectedItem;
  }

  /**
   * Enter build mode for a specific zone type
   */
  public enterBuildMode(zoneType: string, item?: BuildableItem): void {
    this._inBuildMode = true;
    this._selectedZoneType = zoneType;
    this._selectedItem = item || null;

    this.updateZoneVisuals();
    this.startPulsation();
    this.emit("enter_build_mode", { zoneType, item });

    console.log(`Entered build mode: ${zoneType}`);
  }

  /**
   * Exit build mode
   */
  public exitBuildMode(): void {
    this._inBuildMode = false;
    this._selectedZoneType = null;
    this._selectedItem = null;
    this._hoveredZoneId = null;

    this.stopPulsation();
    this.updateZoneVisuals();
    this.emit("exit_build_mode", {});

    console.log("Exited build mode");
  }

  /**
   * Toggle build mode
   */
  public toggleBuildMode(zoneType: string): void {
    if (this._inBuildMode && this._selectedZoneType === zoneType) {
      this.exitBuildMode();
    } else {
      this.enterBuildMode(zoneType);
    }
  }

  /**
   * Select an item to build
   */
  public selectItem(itemId: string): void {
    const item = this.buildableItems.get(itemId);
    if (item) {
      this._selectedItem = item;
      this.enterBuildMode(item.zoneType, item);
    }
  }

  private updateZoneVisuals(): void {
    for (const zone of this.zones.values()) {
      const isTargetZone = this._inBuildMode && zone.zoneType === this._selectedZoneType;
      const isHovered = zone.id === this._hoveredZoneId;

      // Update fill mesh
      if (zone.mesh) {
        if (isTargetZone) {
          zone.mesh.material = zone.occupied ? this.occupiedMaterial : this.highlightMaterial;
          zone.mesh.visibility = isHovered ? 0.3 : 0.15;
        } else {
          zone.mesh.material = this.normalMaterial;
          zone.mesh.visibility = 0;
        }
      }

      // Update border mesh
      if (zone.borderMesh) {
        if (isTargetZone && !zone.occupied) {
          zone.borderMesh.visibility = 1;
          zone.borderMesh.material = isHovered ? this.borderHoverMaterial : this.borderMaterial;
        } else if (isTargetZone && zone.occupied) {
          zone.borderMesh.visibility = 0.6;
          zone.borderMesh.material = this.borderOccupiedMaterial;
        } else {
          zone.borderMesh.visibility = 0;
        }
      }
    }
  }

  /**
   * Set the currently hovered zone (call from mouse move handler)
   */
  public setHoveredZone(zoneId: string | null): void {
    if (this._hoveredZoneId !== zoneId) {
      this._hoveredZoneId = zoneId;
      this.updateZoneVisuals();
    }
  }

  /**
   * Get the currently hovered zone
   */
  public get hoveredZoneId(): string | null {
    return this._hoveredZoneId;
  }

  private startPulsation(): void {
    this.pulsationPhase = 0;
    
    // Schedule pulsation updates
    GameTimer.getInstance().scheduleTask(this.pulsationTaskId, 50, () => {
      if (!this._inBuildMode) return;
      
      this.pulsationPhase += 0.1;
      const pulse = (Math.sin(this.pulsationPhase) + 1) / 2; // 0-1

      // Update border material emissive for pulsing effect
      if (this.borderMaterial) {
        const baseEmissive = 0.2 + pulse * 0.4;
        this.borderMaterial.emissiveColor = new Color3(baseEmissive * 0.5, baseEmissive, baseEmissive * 0.5);
      }
    });
  }

  private stopPulsation(): void {
    GameTimer.getInstance().cancelTask(this.pulsationTaskId);
    
    // Reset border material
    if (this.borderMaterial) {
      this.borderMaterial.emissiveColor = new Color3(0.2, 0.8, 0.2);
    }
  }

  // ==================== Building ====================

  /**
   * Attempt to build at a zone
   */
  public buildAt(zoneId: string, item?: BuildableItem): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      console.warn(`Zone not found: ${zoneId}`);
      return false;
    }

    const buildItem = item || this._selectedItem;
    if (!buildItem) {
      console.warn("No item selected to build");
      return false;
    }

    // Validate zone type
    if (zone.zoneType !== buildItem.zoneType) {
      console.warn(`Cannot build ${buildItem.id} in ${zone.zoneType} zone`);
      this.emit("build_failed", { reason: "wrong_zone_type", zone, item: buildItem });
      return false;
    }

    // Check if occupied
    if (zone.occupied) {
      console.warn(`Zone ${zoneId} is already occupied`);
      this.emit("build_failed", { reason: "occupied", zone, item: buildItem });
      return false;
    }

    // Check cost
    const state = GameState.getInstance();
    if (!state.canAfford(buildItem.cost)) {
      console.warn(`Cannot afford ${buildItem.name} ($${buildItem.cost})`);
      this.emit("build_failed", { reason: "no_money", zone, item: buildItem });
      return false;
    }

    // Check level
    if (state.getPlayer().level < buildItem.requiredLevel) {
      console.warn(`Level ${buildItem.requiredLevel} required for ${buildItem.name}`);
      this.emit("build_failed", { reason: "level_required", zone, item: buildItem });
      return false;
    }

    // Deduct cost
    state.spendMoney(buildItem.cost);

    // Mark zone as occupied
    zone.occupied = true;
    zone.occupiedBy = buildItem.id;

    // Create the buildable object with progress tracking
    const objectManager = BuildableObjectManager.getInstance();
    objectManager.create(
      buildItem.id,
      zoneId,
      zone.position,
      this.currentMapId
    );

    // Execute custom build action
    if (buildItem.onBuild) {
      buildItem.onBuild(zone);
    }

    // Update visuals
    this.updateZoneVisuals();

    // Update quest objectives
    QuestSystem.getInstance().updateObjective("build", { itemId: buildItem.id });

    console.log(`Built ${buildItem.name} at zone ${zoneId}`);
    this.emit("built", { zone, item: buildItem });

    return true;
  }

  /**
   * Clear a zone (remove what's built there)
   */
  public clearZone(zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone || !zone.occupied) {
      return false;
    }

    const previousItem = zone.occupiedBy;
    zone.occupied = false;
    zone.occupiedBy = null;

    this.updateZoneVisuals();
    this.emit("cleared", { zone, previousItem });

    return true;
  }

  // ==================== Buildable Items ====================

  public registerItem(item: BuildableItem): void {
    this.buildableItems.set(item.id, item);
  }

  public getItem(id: string): BuildableItem | undefined {
    return this.buildableItems.get(id);
  }

  public getItemsByZoneType(zoneType: string): BuildableItem[] {
    return Array.from(this.buildableItems.values()).filter(i => i.zoneType === zoneType);
  }

  public getUnlockedItems(): BuildableItem[] {
    const level = GameState.getInstance().getPlayer().level;
    return Array.from(this.buildableItems.values()).filter(i => i.requiredLevel <= level);
  }

  /**
   * Register multiple items at once (convenience method)
   */
  public registerItems(items: BuildableItem[]): void {
    for (const item of items) {
      this.registerItem(item);
    }
  }

  /**
   * Clear all registered items
   */
  public clearItems(): void {
    this.buildableItems.clear();
  }

  // ==================== Events ====================

  public onBuildEvent(callback: BuildEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offBuildEvent(callback: BuildEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    for (const callback of this.eventListeners) {
      callback(event, data);
    }
  }

  // ==================== Cleanup ====================

  public clearZones(): void {
    for (const zone of this.zones.values()) {
      zone.mesh?.dispose();
    }
    this.zones.clear();
  }

  public setCurrentMap(mapId: string): void {
    this.currentMapId = mapId;
  }

  public getCurrentMap(): string {
    return this.currentMapId;
  }
}
