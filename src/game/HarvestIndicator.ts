/**
 * HarvestIndicator - Shows visual indicators above harvestable plants
 * and provides UI for harvesting
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { EventBus } from "../engine/core/EventBus";
import { GameScene } from "./GameScene";
import { GameState } from "./GameState";
import { GameTimer } from "../engine/core/GameTimer";
import { PlantSystem, type PlantPhase } from "./PlantSystem";

export interface HarvestableInfo {
  plantId: string;
  position: Vector3;
  phase: PlantPhase;
  quality: number;
  strainName: string;
  indicator: TransformNode | null;
}

type HarvestEventCallback = (event: string, data: unknown) => void;

export class HarvestIndicator {
  private static instance: HarvestIndicator;

  private scene: Scene | null = null;
  private harvestables: Map<string, HarvestableInfo> = new Map();
  private indicators: Map<string, TransformNode> = new Map();
  private updateTaskId = "harvest_indicator_update";
  private pulsationPhase = 0;
  private eventListeners: HarvestEventCallback[] = [];

  // Materials
  private readyMaterial: StandardMaterial | null = null;
  private overripeMaterial: StandardMaterial | null = null;
  private spoiledMaterial: StandardMaterial | null = null;

  // UI Elements
  private harvestPanel: HTMLDivElement | null = null;
  private selectedPlantId: string | null = null;

  private constructor() {}

  public static getInstance(): HarvestIndicator {
    if (!HarvestIndicator.instance) {
      HarvestIndicator.instance = new HarvestIndicator();
    }
    return HarvestIndicator.instance;
  }

  public static resetInstance(): void {
    if (HarvestIndicator.instance) {
      HarvestIndicator.instance.dispose();
    }
    HarvestIndicator.instance = null as any;
  }

  // ==================== Initialization ====================

  public init(scene: Scene): void {
    this.scene = scene;
    this.createMaterials();
    this.createHarvestPanel();
    this.setupPlantEvents();
    this.startUpdateLoop();

    // Initial scan for existing harvestable plants
    this.scanForHarvestablePlants();
  }

  private createMaterials(): void {
    if (!this.scene) return;

    // Ready material (bright green, pulsing)
    this.readyMaterial = new StandardMaterial("harvest_ready", this.scene);
    this.readyMaterial.diffuseColor = new Color3(0.2, 1.0, 0.2);
    this.readyMaterial.emissiveColor = new Color3(0.1, 0.6, 0.1);
    this.readyMaterial.alpha = 0.9;
    this.readyMaterial.backFaceCulling = false;

    // Overripe material (yellow/orange)
    this.overripeMaterial = new StandardMaterial("harvest_overripe", this.scene);
    this.overripeMaterial.diffuseColor = new Color3(1.0, 0.8, 0.2);
    this.overripeMaterial.emissiveColor = new Color3(0.6, 0.4, 0.1);
    this.overripeMaterial.alpha = 0.9;
    this.overripeMaterial.backFaceCulling = false;

    // Spoiled material (red/brown)
    this.spoiledMaterial = new StandardMaterial("harvest_spoiled", this.scene);
    this.spoiledMaterial.diffuseColor = new Color3(0.8, 0.3, 0.2);
    this.spoiledMaterial.emissiveColor = new Color3(0.4, 0.1, 0.05);
    this.spoiledMaterial.alpha = 0.9;
    this.spoiledMaterial.backFaceCulling = false;
  }

  private createHarvestPanel(): void {
    // Create the harvest UI panel (hidden by default)
    this.harvestPanel = document.createElement("div");
    this.harvestPanel.id = "harvest-panel";
    this.harvestPanel.style.cssText = `
      position: fixed;
      bottom: 180px;
      left: 50%;
      transform: translateX(-50%);
      background: #FAFAFA;
      border: none;
      border-bottom: 4px solid #4CAF50;
      border-radius: 16px;
      padding: 20px 28px;
      color: #333333;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      min-width: 300px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      z-index: 1500;
    `;

    this.harvestPanel.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 800; color: #333333;">
        <span id="harvest-icon">🌿</span>
        <span id="harvest-title">Ready to Harvest</span>
      </div>
      <div id="harvest-info" style="text-align: center; font-size: 15px; color: #666666;">
        <div id="harvest-strain" style="font-weight: 600; color: #333333;">Basic Bud</div>
        <div id="harvest-quality" style="margin-top: 6px; font-weight: 600;">Quality: 100%</div>
        <div id="harvest-phase" style="margin-top: 6px; font-style: italic;">Perfect timing!</div>
      </div>
      <div style="display: flex; gap: 12px; margin-top: 10px;">
        <button id="harvest-btn" style="
          background: #4CAF50;
          border: none;
          border-bottom: 3px solid #388E3C;
          border-radius: 10px;
          padding: 12px 28px;
          color: white;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.1s ease;
          font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
        ">🌾 Harvest</button>
        <button id="harvest-cancel-btn" style="
          background: #E0E0E0;
          border: none;
          border-bottom: 3px solid #BDBDBD;
          border-radius: 10px;
          padding: 12px 20px;
          color: #666666;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.1s ease;
          font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
        ">Cancel</button>
      </div>
    `;

    document.body.appendChild(this.harvestPanel);

    // Add button event listeners
    const harvestBtn = this.harvestPanel.querySelector("#harvest-btn") as HTMLButtonElement;
    const cancelBtn = this.harvestPanel.querySelector("#harvest-cancel-btn") as HTMLButtonElement;

    harvestBtn.addEventListener("click", () => this.doHarvest());
    harvestBtn.addEventListener("mouseenter", () => {
      harvestBtn.style.transform = "scale(1.05)";
      harvestBtn.style.boxShadow = "0 0 15px rgba(100,255,100,0.5)";
    });
    harvestBtn.addEventListener("mouseleave", () => {
      harvestBtn.style.transform = "scale(1)";
      harvestBtn.style.boxShadow = "none";
    });

    cancelBtn.addEventListener("click", () => this.hideHarvestPanel());
    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "rgba(150,150,150,0.5)";
    });
    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "rgba(100,100,100,0.5)";
    });
  }

  private setupPlantEvents(): void {
    // Listen for plant events via EventBus
    EventBus.on<{ plantId: string }>("plant:ready_to_harvest", (data) => {
      this.addHarvestable(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:harvested", (data) => {
      this.removeHarvestable(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:removed", (data) => {
      this.removeHarvestable(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:died", (data) => {
      this.removeHarvestable(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:overripe", (data) => {
      this.updateHarvestablePhase(data.plantId);
    });
    EventBus.on<{ plantId: string }>("plant:spoiled", (data) => {
      this.updateHarvestablePhase(data.plantId);
    });
    
    // Clear and rescan on map change
    EventBus.on("map:loaded", () => {
      this.clearAllIndicators();
      setTimeout(() => {
        this.scanForHarvestablePlants();
      }, 100);
    });
  }

  /**
   * Clear all harvest indicators (used on map change)
   */
  private clearAllIndicators(): void {
    for (const info of this.harvestables.values()) {
      if (info.indicator) {
        info.indicator.dispose();
      }
    }
    this.harvestables.clear();
    this.indicators.clear();
    console.log("[HarvestIndicator] Cleared all indicators");
  }

  private scanForHarvestablePlants(): void {
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap) return;
    
    // Only scan plants in the CURRENT map
    const plants = GameState.getInstance().getPlantsInMap(currentMap);
    const plantSystem = PlantSystem.getInstance();

    console.log(`[HarvestIndicator] Scanning ${plants.length} plants in ${currentMap}`);
    for (const plant of plants) {
      const visualState = plantSystem.getVisualState(plant.id);
      if (visualState?.isHarvestable) {
        this.addHarvestable(plant.id);
      }
    }
  }

  // ==================== Harvestable Management ====================

  private addHarvestable(plantId: string): void {
    if (this.harvestables.has(plantId)) return;

    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;
    
    // Only add indicators for plants in the CURRENT map
    const currentMap = GameScene.getInstance()?.getCurrentMap();
    if (!currentMap || plant.mapId !== currentMap) return;

    const plantSystem = PlantSystem.getInstance();
    const strain = plantSystem.getStrain(plant.strain);
    const phaseInfo = plantSystem.getPlantPhase(plantId);

    if (!strain || !phaseInfo) return;

    const info: HarvestableInfo = {
      plantId,
      position: new Vector3(plant.position.x, plant.position.y, plant.position.z),
      phase: phaseInfo.phase,
      quality: phaseInfo.quality,
      strainName: strain.name,
      indicator: null,
    };

    this.harvestables.set(plantId, info);
    this.createIndicator(info);

    this.emit("harvestable_added", { plantId, strainName: strain.name });
    console.log(`Harvest indicator added for ${strain.name} (${plantId})`);
  }

  private removeHarvestable(plantId: string): void {
    const info = this.harvestables.get(plantId);
    if (!info) return;

    // Remove indicator
    if (info.indicator) {
      info.indicator.dispose();
    }
    this.indicators.delete(plantId);
    this.harvestables.delete(plantId);

    // Hide panel if this plant was selected
    if (this.selectedPlantId === plantId) {
      this.hideHarvestPanel();
    }

    this.emit("harvestable_removed", { plantId });
  }

  private updateHarvestablePhase(plantId: string): void {
    const info = this.harvestables.get(plantId);
    if (!info) return;

    const plantSystem = PlantSystem.getInstance();
    const phaseInfo = plantSystem.getPlantPhase(plantId);
    if (!phaseInfo) return;

    info.phase = phaseInfo.phase;
    info.quality = phaseInfo.quality;

    // Update indicator material
    this.updateIndicatorMaterial(info);

    // Update panel if this plant is selected
    if (this.selectedPlantId === plantId) {
      this.updateHarvestPanelInfo(info);
    }
  }

  // ==================== Indicators ====================

  private createIndicator(info: HarvestableInfo): void {
    if (!this.scene) return;

    // Create a floating icon above the plant
    const root = new TransformNode(`harvest_indicator_${info.plantId}`, this.scene);
    root.position = info.position.clone();
    root.position.y += 40; // Float above plant

    // Create the icon plane
    const iconSize = 12;
    const iconPlane = MeshBuilder.CreatePlane(
      `harvest_icon_${info.plantId}`,
      { width: iconSize, height: iconSize },
      this.scene
    );
    iconPlane.parent = root;
    iconPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;

    // Create dynamic texture for the icon
    const texture = new DynamicTexture(
      `harvest_texture_${info.plantId}`,
      { width: 128, height: 128 },
      this.scene,
      false
    );
    texture.hasAlpha = true;

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = "bold 80px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✂️", 64, 64);
    texture.update();

    // Create material with the icon
    const iconMat = new StandardMaterial(`harvest_icon_mat_${info.plantId}`, this.scene);
    iconMat.diffuseTexture = texture;
    iconMat.emissiveTexture = texture;
    iconMat.useAlphaFromDiffuseTexture = true;
    iconMat.backFaceCulling = false;
    iconPlane.material = iconMat;

    // Create a glowing ring below the icon
    const ring = MeshBuilder.CreateTorus(
      `harvest_ring_${info.plantId}`,
      { diameter: 20, thickness: 2, tessellation: 32 },
      this.scene
    );
    ring.parent = root;
    ring.position.y = -35; // At plant level
    ring.rotation.x = Math.PI / 2; // Flat on ground

    // Set ring material based on phase
    this.updateIndicatorMaterial(info, ring);

    // Make indicator clickable
    iconPlane.isPickable = true;
    iconPlane.metadata = {
      isHarvestIndicator: true,
      plantId: info.plantId,
    };

    ring.isPickable = true;
    ring.metadata = {
      isHarvestIndicator: true,
      plantId: info.plantId,
    };

    info.indicator = root;
    this.indicators.set(info.plantId, root);
  }

  private updateIndicatorMaterial(info: HarvestableInfo, ring?: Mesh): void {
    if (!ring) {
      const indicator = this.indicators.get(info.plantId);
      if (!indicator) return;
      ring = indicator.getChildMeshes().find(m => m.name.includes("ring")) as Mesh;
      if (!ring) return;
    }

    switch (info.phase) {
      case "ready":
        ring.material = this.readyMaterial;
        break;
      case "overripe":
        ring.material = this.overripeMaterial;
        break;
      case "spoiled":
        ring.material = this.spoiledMaterial;
        break;
      default:
        ring.material = this.readyMaterial;
    }
  }

  // ==================== Update Loop ====================

  private startUpdateLoop(): void {
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 50, () => {
      this.updateIndicators();
    });
  }

  private updateIndicators(): void {
    this.pulsationPhase += 0.1;
    const pulse = (Math.sin(this.pulsationPhase) + 1) / 2;
    const bobOffset = Math.sin(this.pulsationPhase * 0.5) * 2;

    // Update all indicators
    for (const [plantId, indicator] of this.indicators) {
      const info = this.harvestables.get(plantId);
      if (!info) continue;

      // Bob up and down
      indicator.position.y = info.position.y + 40 + bobOffset;

      // Pulse the ring
      const ring = indicator.getChildMeshes().find(m => m.name.includes("ring")) as Mesh;
      if (ring) {
        const baseScale = 1 + pulse * 0.2;
        ring.scaling.setAll(baseScale);
      }
    }

    // Update material emissive for pulsing glow
    if (this.readyMaterial) {
      const intensity = 0.3 + pulse * 0.4;
      this.readyMaterial.emissiveColor = new Color3(intensity * 0.3, intensity, intensity * 0.3);
    }
  }

  // ==================== UI ====================

  public showHarvestPanel(plantId: string): void {
    console.log("[HarvestIndicator] showHarvestPanel called for:", plantId);
    console.log("[HarvestIndicator] harvestables size:", this.harvestables.size);
    const info = this.harvestables.get(plantId);
    console.log("[HarvestIndicator] info found:", !!info, "harvestPanel exists:", !!this.harvestPanel);
    if (!info || !this.harvestPanel) return;

    this.selectedPlantId = plantId;
    this.updateHarvestPanelInfo(info);
    this.harvestPanel.style.display = "flex";
    console.log("[HarvestIndicator] Panel displayed");

    this.emit("panel_opened", { plantId });
  }

  public hideHarvestPanel(): void {
    if (this.harvestPanel) {
      this.harvestPanel.style.display = "none";
    }
    this.selectedPlantId = null;

    this.emit("panel_closed", {});
  }

  private updateHarvestPanelInfo(info: HarvestableInfo): void {
    if (!this.harvestPanel) return;

    const titleEl = this.harvestPanel.querySelector("#harvest-title") as HTMLElement;
    const iconEl = this.harvestPanel.querySelector("#harvest-icon") as HTMLElement;
    const strainEl = this.harvestPanel.querySelector("#harvest-strain") as HTMLElement;
    const qualityEl = this.harvestPanel.querySelector("#harvest-quality") as HTMLElement;
    const phaseEl = this.harvestPanel.querySelector("#harvest-phase") as HTMLElement;
    const harvestBtn = this.harvestPanel.querySelector("#harvest-btn") as HTMLButtonElement;

    strainEl.textContent = info.strainName;
    qualityEl.textContent = `Quality: ${Math.round(info.quality)}%`;

    switch (info.phase) {
      case "ready":
        titleEl.textContent = "Ready to Harvest!";
        iconEl.textContent = "🌿";
        phaseEl.textContent = "✨ Perfect timing!";
        phaseEl.style.color = "#8f8";
        harvestBtn.style.background = "linear-gradient(135deg, #4a4, #282)";
        break;
      case "overripe":
        titleEl.textContent = "Harvest Soon!";
        iconEl.textContent = "⚠️";
        phaseEl.textContent = "⏰ Quality degrading...";
        phaseEl.style.color = "#fa0";
        harvestBtn.style.background = "linear-gradient(135deg, #a84, #642)";
        break;
      case "spoiled":
        titleEl.textContent = "Spoiling!";
        iconEl.textContent = "💀";
        phaseEl.textContent = "😢 Very low quality";
        phaseEl.style.color = "#f66";
        harvestBtn.style.background = "linear-gradient(135deg, #844, #422)";
        break;
      default:
        titleEl.textContent = "Harvest";
        iconEl.textContent = "🌱";
        phaseEl.textContent = "";
        phaseEl.style.color = "#aaa";
    }
  }

  private doHarvest(): void {
    if (!this.selectedPlantId) return;

    const plantSystem = PlantSystem.getInstance();
    const result = plantSystem.harvestPlant(this.selectedPlantId);

    if (result?.success) {
      this.emit("harvested", {
        plantId: this.selectedPlantId,
        yield: result.yield,
        xp: result.xp,
        quality: result.quality,
        phase: result.phase,
      });

      // Show harvest feedback
      this.showHarvestFeedback(result);
    }

    this.hideHarvestPanel();
  }

  private showHarvestFeedback(result: { yield: number; xp: number; quality: number; phase: PlantPhase }): void {
    // Create floating text feedback
    const feedback = document.createElement("div");
    feedback.style.cssText = `
      position: fixed;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      font-size: 24px;
      font-weight: bold;
      color: ${result.phase === "ready" ? "#8f8" : result.phase === "overripe" ? "#fa0" : "#f66"};
      text-shadow: 0 2px 10px rgba(0,0,0,0.8);
      pointer-events: none;
      z-index: 2000;
      animation: harvestFeedback 2s ease-out forwards;
    `;

    const phaseText = result.phase === "ready" ? "Perfect! ✨" : 
                      result.phase === "overripe" ? "Overripe" : "Spoiled";
    
    feedback.innerHTML = `
      <div>🌾 Harvested!</div>
      <div style="font-size: 18px; margin-top: 8px;">+${result.yield} yield • +${result.xp} XP</div>
      <div style="font-size: 14px; margin-top: 4px;">${phaseText}</div>
    `;

    // Add animation keyframes if not already present
    if (!document.getElementById("harvest-feedback-style")) {
      const style = document.createElement("style");
      style.id = "harvest-feedback-style";
      style.textContent = `
        @keyframes harvestFeedback {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -60%) scale(1.1); }
          100% { opacity: 0; transform: translate(-50%, -80%) scale(0.9); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(feedback);
    setTimeout(() => feedback.remove(), 2000);
  }

  // ==================== Public API ====================

  /**
   * Get all currently harvestable plants
   */
  public getHarvestablePlants(): HarvestableInfo[] {
    // Update phases before returning (ensures fresh data)
    const plantSystem = PlantSystem.getInstance();
    for (const [plantId, info] of this.harvestables) {
      const phaseInfo = plantSystem.getPlantPhase(plantId);
      if (phaseInfo) {
        info.phase = phaseInfo.phase;
        info.quality = phaseInfo.quality;
      }
    }
    
    const result = Array.from(this.harvestables.values());
    return result;
  }

  /**
   * Get count of harvestable plants
   */
  public getHarvestableCount(): number {
    return this.harvestables.size;
  }

  /**
   * Check if a plant is harvestable
   */
  public isHarvestable(plantId: string): boolean {
    return this.harvestables.has(plantId);
  }

  /**
   * Handle click on harvest indicator (call from input handler)
   */
  public handleIndicatorClick(plantId: string): void {
    if (this.harvestables.has(plantId)) {
      this.showHarvestPanel(plantId);
    }
  }

  /**
   * Check if panel is open
   */
  public isPanelOpen(): boolean {
    return this.selectedPlantId !== null;
  }

  // ==================== Events ====================

  public onHarvestEvent(callback: HarvestEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offHarvestEvent(callback: HarvestEventCallback): void {
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

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);

    // Remove all indicators
    for (const indicator of this.indicators.values()) {
      indicator.dispose();
    }
    this.indicators.clear();
    this.harvestables.clear();

    // Remove UI
    if (this.harvestPanel) {
      this.harvestPanel.remove();
      this.harvestPanel = null;
    }

    // Dispose materials
    this.readyMaterial?.dispose();
    this.overripeMaterial?.dispose();
    this.spoiledMaterial?.dispose();

    this.eventListeners = [];
    this.selectedPlantId = null;
  }
}
