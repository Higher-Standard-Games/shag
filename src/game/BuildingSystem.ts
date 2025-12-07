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
import { QuestSystem } from "./QuestSystem";

export interface BuildZone {
  id: string;
  position: Vector3;
  size: number;
  zoneType: string; // "plant", "equipment", "decoration", etc.
  occupied: boolean;
  occupiedBy: string | null; // ID of item/plant in this zone
  mesh: Mesh | null; // Visual indicator
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
  private highlightMaterial: StandardMaterial | null = null;
  private occupiedMaterial: StandardMaterial | null = null;
  private normalMaterial: StandardMaterial | null = null;

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

    // Highlight material (green, for available zones)
    this.highlightMaterial = new StandardMaterial("buildZone_highlight", this.scene);
    this.highlightMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2);
    this.highlightMaterial.emissiveColor = new Color3(0.1, 0.4, 0.1);
    this.highlightMaterial.alpha = 0.6;
    this.highlightMaterial.backFaceCulling = false;

    // Occupied material (red, for taken zones)
    this.occupiedMaterial = new StandardMaterial("buildZone_occupied", this.scene);
    this.occupiedMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2);
    this.occupiedMaterial.emissiveColor = new Color3(0.4, 0.1, 0.1);
    this.occupiedMaterial.alpha = 0.4;
    this.occupiedMaterial.backFaceCulling = false;

    // Normal material (subtle, when not in build mode)
    this.normalMaterial = new StandardMaterial("buildZone_normal", this.scene);
    this.normalMaterial.diffuseColor = new Color3(0.3, 0.6, 0.3);
    this.normalMaterial.emissiveColor = new Color3(0.1, 0.3, 0.1);
    this.normalMaterial.alpha = 0.4;
    this.normalMaterial.backFaceCulling = false;
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
      mapId,
    };

    // Create visual mesh
    zone.mesh = this.createZoneMesh(zone);

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
      if (!zone.mesh) continue;

      if (this._inBuildMode && zone.zoneType === this._selectedZoneType) {
        // In build mode for this zone type
        zone.mesh.material = zone.occupied ? this.occupiedMaterial : this.highlightMaterial;
        zone.mesh.visibility = 1;
      } else {
        // Not in build mode or different zone type
        zone.mesh.material = this.normalMaterial;
        zone.mesh.visibility = this._inBuildMode ? 0.5 : 1;
      }
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
