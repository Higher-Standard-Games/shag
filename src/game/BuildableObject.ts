/**
 * BuildableObject - Represents a placed item with growth/progress states
 * Supports multiple visual stages and time-based progression
 */

import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "babylonjs";
import { EventBus } from "../engine/core/EventBus";
import { PrefabInstance } from "../engine/loader/PrefabInstance";
import { GameTimer } from "./GameTimer";

/**
 * Visual stage definition for a buildable object
 */
export interface ObjectStage {
  /** Minimum progress (0-100) to show this stage */
  minProgress: number;
  /** Maximum progress (0-100) for this stage */
  maxProgress: number;
  /** Prefab to display (optional - if not set, uses sprite) */
  prefab?: string;
  /** Sprite to display (optional - if not set, uses prefab) */
  sprite?: string;
  /** Scale multiplier for this stage */
  scale?: number;
  /** Optional callback when entering this stage */
  onEnter?: (object: BuildableObjectState) => void;
}

/**
 * Template for creating buildable objects
 */
export interface BuildableObjectTemplate {
  /** Unique template ID */
  id: string;
  /** Display name */
  name: string;
  /** Icon for UI */
  icon: string;
  /** Zone type this can be placed in */
  zoneType: string;
  /** Cost to build */
  cost: number;
  /** Required player level */
  requiredLevel: number;
  /** Time to complete in milliseconds (game time) */
  buildTime: number;
  /** Visual stages (must cover 0-100 progress) */
  stages: ObjectStage[];
  /** Whether this produces resources when complete */
  isProducer?: boolean;
  /** Production interval in ms (if isProducer) */
  productionInterval?: number;
  /** What it produces (item ID) */
  producesItem?: string;
  /** Amount produced per cycle */
  producesAmount?: number;
  /** Yield bonus for grow lights (0 = normal, 0.15 = +15%, 0.30 = +30%) */
  yieldBonus?: number;
}

/**
 * Instance of a placed buildable object
 */
export interface BuildableObjectState {
  /** Unique instance ID */
  id: string;
  /** Template ID */
  templateId: string;
  /** Zone ID where placed */
  zoneId: string;
  /** Map ID */
  mapId: string;
  /** World position */
  position: { x: number; y: number; z: number };
  /** Build progress 0-100 */
  progress: number;
  /** Current stage index */
  currentStage: number;
  /** When building started (game time) */
  startedAt: number;
  /** Whether complete */
  isComplete: boolean;
  /** Last production time (for producers) */
  lastProduction?: number;
  /** Whether a plant has been planted in this pot (for plant zone types) */
  hasPlant?: boolean;
}

type ObjectEventCallback = (objectId: string, event: string, data?: unknown) => void;

/**
 * Helper to generate standard 3-stage prefab paths
 * Creates: basePath_0.map, basePath_50.map, basePath_100.map
 */
export function createStages(basePath: string, scale: number = 1): ObjectStage[] {
  return [
    { minProgress: 0, maxProgress: 49, prefab: `${basePath}_0.map`, scale },
    { minProgress: 50, maxProgress: 99, prefab: `${basePath}_50.map`, scale },
    { minProgress: 100, maxProgress: 100, prefab: `${basePath}_100.map`, scale },
  ];
}

/**
 * Helper for instant-build items (single stage)
 */
export function createInstantStage(prefab: string, scale: number = 1): ObjectStage[] {
  return [
    { minProgress: 0, maxProgress: 100, prefab, scale },
  ];
}

/**
 * Helper to create custom stage thresholds
 * @param basePath Base prefab path
 * @param thresholds Array of progress thresholds (e.g., [0, 25, 50, 75, 100])
 * @param scale Scale multiplier
 */
export function createCustomStages(basePath: string, thresholds: number[], scale: number = 1): ObjectStage[] {
  const stages: ObjectStage[] = [];
  for (let i = 0; i < thresholds.length; i++) {
    const min = thresholds[i];
    const max = i < thresholds.length - 1 ? thresholds[i + 1] - 1 : 100;
    stages.push({
      minProgress: min,
      maxProgress: max,
      prefab: `${basePath}_${min}.map`,
      scale,
    });
  }
  return stages;
}

export class BuildableObjectManager {
  private static instance: BuildableObjectManager;

  private scene: Scene | null = null;
  private objects: Map<string, BuildableObjectState> = new Map();
  private visuals: Map<string, TransformNode | Mesh> = new Map();
  private templates: Map<string, BuildableObjectTemplate> = new Map();
  private eventListeners: ObjectEventCallback[] = [];
  private updateTaskId = "buildable_objects_update";

  private constructor() {}

  public static getInstance(): BuildableObjectManager {
    if (!BuildableObjectManager.instance) {
      BuildableObjectManager.instance = new BuildableObjectManager();
    }
    return BuildableObjectManager.instance;
  }

  // ==================== Initialization ====================

  public init(scene: Scene): void {
    this.scene = scene;
    this.startUpdateLoop();
    // Refresh all existing visuals to ensure they have metadata
    this.refreshAllVisuals();
  }

  /**
   * Refresh all visuals to ensure they have proper metadata for click detection
   */
  public async refreshAllVisuals(): Promise<void> {
    for (const state of this.objects.values()) {
      await this.updateVisual(state);
    }
  }

  private startUpdateLoop(): void {
    // Update objects every 500ms
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 500, () => {
      this.updateAllObjects();
    });
  }

  // ==================== Templates ====================

  public registerTemplate(template: BuildableObjectTemplate): void {
    this.templates.set(template.id, template);
  }

  public getTemplate(id: string): BuildableObjectTemplate | undefined {
    return this.templates.get(id);
  }

  public getTemplatesByZoneType(zoneType: string): BuildableObjectTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.zoneType === zoneType);
  }

  // ==================== Object Creation ====================

  /**
   * Create a new buildable object at a zone
   */
  public async create(
    templateId: string,
    zoneId: string,
    position: Vector3,
    mapId: string
  ): Promise<BuildableObjectState | null> {
    const template = this.templates.get(templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      return null;
    }

    const id = `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = GameTimer.getInstance().getGameTime();

    const state: BuildableObjectState = {
      id,
      templateId,
      zoneId,
      mapId,
      position: { x: position.x, y: position.y, z: position.z },
      progress: template.buildTime === 0 ? 100 : 0,
      currentStage: 0,
      startedAt: now,
      isComplete: template.buildTime === 0,
      lastProduction: now,
    };

    this.objects.set(id, state);

    // Create initial visual
    await this.updateVisual(state);

    console.log(`Created buildable object: ${template.name} (${id}) at zone ${zoneId}`);
    this.emit("created", id, { template, state });

    return state;
  }

  // ==================== Update Loop ====================

  private updateAllObjects(): void {
    const now = GameTimer.getInstance().getGameTime();

    for (const [id, state] of this.objects) {
      const template = this.templates.get(state.templateId);
      if (!template) continue;

      // Update progress if not complete
      if (!state.isComplete && template.buildTime > 0) {
        const elapsed = now - state.startedAt;
        const newProgress = Math.min(100, (elapsed / template.buildTime) * 100);
        
        if (newProgress !== state.progress) {
          const oldStage = state.currentStage;
          state.progress = newProgress;
          state.currentStage = this.getStageForProgress(template, newProgress);
          state.isComplete = newProgress >= 100;

          // Check for stage change
          if (state.currentStage !== oldStage) {
            this.updateVisual(state);
            this.emit("stage_changed", id, { 
              oldStage, 
              newStage: state.currentStage,
              progress: newProgress,
            });
          }

          // Check for completion
          if (state.isComplete) {
            this.emit("completed", id, { template });
          }
        }
      }

      // Handle production for complete producers
      if (state.isComplete && template.isProducer && template.productionInterval) {
        const timeSinceProduction = now - (state.lastProduction || 0);
        if (timeSinceProduction >= template.productionInterval) {
          state.lastProduction = now;
          this.emit("produced", id, {
            item: template.producesItem,
            amount: template.producesAmount || 1,
          });
        }
      }
    }
  }

  private getStageForProgress(template: BuildableObjectTemplate, progress: number): number {
    for (let i = 0; i < template.stages.length; i++) {
      const stage = template.stages[i];
      if (progress >= stage.minProgress && progress <= stage.maxProgress) {
        return i;
      }
    }
    return template.stages.length - 1;
  }

  // ==================== Visuals ====================

  private async updateVisual(state: BuildableObjectState): Promise<void> {
    if (!this.scene) return;

    const template = this.templates.get(state.templateId);
    if (!template) return;

    const stage = template.stages[state.currentStage];
    if (!stage) return;

    // Remove old visual
    const oldVisual = this.visuals.get(state.id);
    if (oldVisual) {
      oldVisual.dispose();
      this.visuals.delete(state.id);
    }

    // Determine which prefab to use
    let prefabPath = stage.prefab;
    
    // For plant pots: only show plant growth stages if hasPlant is true
    // Otherwise show pot_empty.map (pot without plant geometry)
    if (template.zoneType === "plant" && !state.hasPlant) {
      prefabPath = "pot_empty.map";
    }

    // Create new visual
    if (prefabPath) {
      try {
        const result = await PrefabInstance.create(prefabPath, this.scene, {
          position: new Vector3(state.position.x, state.position.y, state.position.z),
          scale: stage.scale || 1,
        });
        if (result) {
          this.visuals.set(state.id, result.root);
          // Tag all meshes with buildable object metadata for click detection
          for (const mesh of result.meshes) {
            mesh.metadata = {
              ...mesh.metadata,
              isBuildableObject: true,
              buildableObjectId: state.id,
              templateId: state.templateId,
              zoneType: template.zoneType,
            };
          }
        }
      } catch (e) {
        // Prefab not found - create placeholder
        console.warn(`Prefab not found: ${stage.prefab}, using placeholder`);
        this.createPlaceholder(state, stage);
      }
    } else {
      // Create placeholder if no prefab
      this.createPlaceholder(state, stage);
    }
  }

  private createPlaceholder(state: BuildableObjectState, stage: ObjectStage): void {
    if (!this.scene) return;

    // Create a simple box as placeholder
    const size = (stage.scale || 1) * 20;
    const mesh = MeshBuilder.CreateBox(
      `placeholder_${state.id}`,
      { width: size, height: size * 0.5, depth: size },
      this.scene
    );

    mesh.position = new Vector3(
      state.position.x,
      state.position.y + size * 0.25,
      state.position.z
    );

    // Tag with metadata for click detection
    const template = this.templates.get(state.templateId);
    mesh.metadata = {
      isBuildableObject: true,
      buildableObjectId: state.id,
      templateId: state.templateId,
      zoneType: template?.zoneType,
    };

    // Color based on progress
    const mat = new StandardMaterial(`placeholder_mat_${state.id}`, this.scene);
    if (state.progress < 50) {
      mat.diffuseColor = new Color3(0.6, 0.4, 0.2); // Brown - construction
    } else if (state.progress < 100) {
      mat.diffuseColor = new Color3(0.4, 0.6, 0.3); // Green-ish - growing
    } else {
      mat.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green - complete
    }
    mat.alpha = 0.8;
    mesh.material = mat;

    this.visuals.set(state.id, mesh);
  }

  // ==================== Queries ====================

  public getObject(id: string): BuildableObjectState | undefined {
    return this.objects.get(id);
  }

  /**
   * Reset a pot to empty state (after harvest)
   * This resets progress to 0 so it shows an empty pot ready for new seed
   */
  public async resetPot(id: string): Promise<void> {
    const state = this.objects.get(id);
    if (!state) return;

    const template = this.templates.get(state.templateId);
    if (!template || template.zoneType !== "plant") return;

    // Reset to empty state - pot is complete but no plant
    state.progress = 100; // Pot is still built
    state.currentStage = template.stages.length - 1;
    state.isComplete = true;
    state.hasPlant = false; // No plant in pot

    // Update visual to show empty pot
    await this.updateVisual(state);
    
    console.log(`Reset pot ${id} to empty state`);
    this.emit("pot_reset", id, { state });
  }

  /**
   * Mark a pot as having a plant (after seed is planted)
   */
  public async setPlantInPot(id: string, hasPlant: boolean): Promise<void> {
    const state = this.objects.get(id);
    if (!state) return;

    const template = this.templates.get(state.templateId);
    if (!template || template.zoneType !== "plant") return;

    state.hasPlant = hasPlant;
    
    // When planting, reset progress to 0 so plant starts at first growth stage
    // When removing plant, keep pot at 100% (built)
    if (hasPlant) {
      state.progress = 0;
      state.currentStage = 0;
    }
    
    // Update visual - will show plant stages if hasPlant, empty pot if not
    await this.updateVisual(state);
    
    console.log(`Pot ${id} hasPlant set to ${hasPlant}, progress reset to ${state.progress}`);
    
    // Emit event so PotActionIndicator can hide the "Select strain" indicator
    this.emit("plant_state_changed", id, { hasPlant, progress: state.progress });
  }

  /**
   * Set pot progress to match plant growth (0-100%)
   */
  public async syncPotWithPlant(id: string, growthProgress: number): Promise<void> {
    const state = this.objects.get(id);
    if (!state) return;

    const template = this.templates.get(state.templateId);
    if (!template || template.zoneType !== "plant") return;

    const oldStage = state.currentStage;
    state.progress = Math.min(100, Math.max(0, growthProgress));
    state.currentStage = this.getStageForProgress(template, state.progress);
    state.isComplete = state.progress >= 100;

    // Update visual if stage changed
    if (state.currentStage !== oldStage) {
      await this.updateVisual(state);
    }
  }

  public getObjectsInZone(zoneId: string): BuildableObjectState[] {
    return Array.from(this.objects.values()).filter(o => o.zoneId === zoneId);
  }

  public getObjectsInMap(mapId: string): BuildableObjectState[] {
    return Array.from(this.objects.values()).filter(o => o.mapId === mapId);
  }

  public getObjectsByTemplate(templateId: string): BuildableObjectState[] {
    return Array.from(this.objects.values()).filter(o => o.templateId === templateId);
  }

  /**
   * Get progress info for UI display
   */
  public getProgressInfo(id: string): { 
    progress: number; 
    stage: number; 
    stageName: string;
    timeRemaining: number;
    isComplete: boolean;
  } | null {
    const state = this.objects.get(id);
    if (!state) return null;

    const template = this.templates.get(state.templateId);
    if (!template) return null;

    const stageNames = ["Building", "Growing", "Complete"];
    const timeRemaining = state.isComplete 
      ? 0 
      : Math.max(0, template.buildTime - (GameTimer.getInstance().getGameTime() - state.startedAt));

    return {
      progress: state.progress,
      stage: state.currentStage,
      stageName: stageNames[Math.min(state.currentStage, stageNames.length - 1)],
      timeRemaining,
      isComplete: state.isComplete,
    };
  }

  // ==================== Removal ====================

  public remove(id: string): boolean {
    const state = this.objects.get(id);
    if (!state) return false;

    // Remove visual
    const visual = this.visuals.get(id);
    if (visual) {
      visual.dispose();
      this.visuals.delete(id);
    }

    this.objects.delete(id);
    this.emit("removed", id, { state });

    return true;
  }

  // ==================== Events ====================

  public onObjectEvent(callback: ObjectEventCallback): void {
    this.eventListeners.push(callback);
  }

  public offObjectEvent(callback: ObjectEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, objectId: string, data?: unknown): void {
    // Legacy callback system
    for (const callback of this.eventListeners) {
      callback(objectId, event, data);
    }
    
    // Global EventBus - allows any system to listen to building events
    EventBus.emit(`building:${event}`, { objectId, ...data as object });
  }

  // ==================== Serialization ====================

  public getState(): BuildableObjectState[] {
    return Array.from(this.objects.values());
  }

  public async loadState(states: BuildableObjectState[]): Promise<void> {
    // Clear existing
    for (const id of this.objects.keys()) {
      this.remove(id);
    }

    // Load saved states
    for (const state of states) {
      this.objects.set(state.id, state);
      await this.updateVisual(state);
    }
  }

  // ==================== Cleanup ====================

  public clear(): void {
    for (const visual of this.visuals.values()) {
      visual.dispose();
    }
    this.visuals.clear();
    this.objects.clear();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    this.clear();
    this.eventListeners = [];
  }
}
