/**
 * BuildableRenderer - Game-level Babylon.js rendering for BuildableSystem
 * 
 * Listens to BuildableSystem events and manages:
 * - Prefab/sprite loading and display
 * - Placeholder mesh creation
 * - Mesh metadata for click detection
 * - Grow light PointLight creation
 */

import {
  Color3,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "babylonjs";
import { 
  BuildableSystem, 
  BuildableInstance, 
  BuildableStage,
  BuildableEvent,
} from "../engine/BuildableSystem";
import { PrefabInstance } from "../engine/loader/PrefabInstance";

export class BuildableRenderer {
  private static instance: BuildableRenderer;
  
  private scene: Scene | null = null;
  private visuals: Map<string, TransformNode | Mesh> = new Map();
  private lights: Map<string, PointLight> = new Map();
  private buildableSystem: BuildableSystem;

  private constructor() {
    this.buildableSystem = BuildableSystem.getInstance();
  }

  public static getInstance(): BuildableRenderer {
    if (!BuildableRenderer.instance) {
      BuildableRenderer.instance = new BuildableRenderer();
    }
    return BuildableRenderer.instance;
  }

  /**
   * Initialize renderer with Babylon.js scene
   */
  public init(scene: Scene): void {
    this.scene = scene;
    
    // Set visual update callback on BuildableSystem
    this.buildableSystem.setVisualUpdateCallback((instance, stage) => {
      this.updateVisual(instance, stage);
    });

    // Listen to BuildableSystem events
    this.buildableSystem.on((event) => this.handleEvent(event));

    // Refresh visuals for any existing instances
    this.refreshAllVisuals();
    
    console.log('[BuildableRenderer] Initialized');
  }

  /**
   * Handle BuildableSystem events
   */
  private handleEvent(event: BuildableEvent): void {
    switch (event.type) {
      case 'complete':
        this.onComplete(event.instanceId);
        break;
      case 'destroyed':
        this.onDestroyed(event.instanceId);
        break;
      case 'child_progress':
        this.onChildProgress(event.instanceId);
        break;
    }
  }

  /**
   * Called when a buildable completes - create lights if needed
   */
  private onComplete(instanceId: string): void {
    const instance = this.buildableSystem.getInstance(instanceId);
    if (!instance) return;

    const template = this.buildableSystem.getTemplate(instance.templateId);
    if (!template?.behaviors?.light) return;

    this.createLight(instance);
  }

  /**
   * Called when a buildable is destroyed - cleanup visuals and lights
   */
  private onDestroyed(instanceId: string): void {
    this.removeVisual(instanceId);
    this.removeLight(instanceId);
  }

  /**
   * Called when child progress changes - may need visual update
   */
  private onChildProgress(instanceId: string): void {
    const instance = this.buildableSystem.getInstance(instanceId);
    if (!instance) return;

    const template = this.buildableSystem.getTemplate(instance.templateId);
    if (!template?.behaviors?.container?.syncVisualWithChildren) return;

    // Visual update is handled by BuildableSystem calling the visual callback
  }

  /**
   * Update visual for an instance
   */
  private async updateVisual(instance: BuildableInstance, stage: BuildableStage): Promise<void> {
    if (!this.scene) return;

    // Remove old visual
    this.removeVisual(instance.id);

    // Determine prefab path
    let prefabPath = stage.prefab;

    // For containers: check if we should show child-based visual
    const template = this.buildableSystem.getTemplate(instance.templateId);
    if (template?.behaviors?.container) {
      const hasChildren = (instance.childIds?.length ?? 0) > 0;
      
      // If container has no children and customData has emptyPrefab, use that
      if (!hasChildren && instance.customData?.emptyPrefab) {
        prefabPath = instance.customData.emptyPrefab as string;
      }
    }

    // Create new visual
    if (prefabPath) {
      try {
        const result = await PrefabInstance.create(prefabPath, this.scene, {
          position: new Vector3(instance.position.x, instance.position.y, instance.position.z),
          scale: stage.scale || 1,
        });
        
        if (result) {
          this.visuals.set(instance.id, result.root);
          
          // Tag all meshes with metadata for click detection
          for (const mesh of result.meshes) {
            mesh.metadata = {
              ...mesh.metadata,
              isBuildableObject: true,
              buildableObjectId: instance.id,
              templateId: instance.templateId,
              zoneId: instance.zoneId,
            };
          }
        }
      } catch (e) {
        console.warn(`[BuildableRenderer] Prefab not found: ${prefabPath}, using placeholder`);
        this.createPlaceholder(instance, stage);
      }
    } else if (stage.sprite) {
      // TODO: Handle sprite-based visuals
      console.warn(`[BuildableRenderer] Sprite visuals not yet implemented: ${stage.sprite}`);
      this.createPlaceholder(instance, stage);
    } else {
      this.createPlaceholder(instance, stage);
    }
  }

  /**
   * Create a placeholder mesh when prefab is not available
   */
  private createPlaceholder(instance: BuildableInstance, stage: BuildableStage): void {
    if (!this.scene) return;

    const size = (stage.scale || 1) * 20;
    const mesh = MeshBuilder.CreateBox(
      `placeholder_${instance.id}`,
      { width: size, height: size * 0.5, depth: size },
      this.scene
    );

    mesh.position = new Vector3(
      instance.position.x,
      instance.position.y + size * 0.25,
      instance.position.z
    );

    // Color based on progress
    const mat = new StandardMaterial(`placeholder_mat_${instance.id}`, this.scene);
    if (instance.progress < 50) {
      mat.diffuseColor = new Color3(0.6, 0.4, 0.2); // Brown - construction
    } else if (instance.progress < 100) {
      mat.diffuseColor = new Color3(0.4, 0.6, 0.3); // Green-ish - growing
    } else {
      mat.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green - complete
    }
    mat.alpha = 0.8;
    mesh.material = mat;

    // Tag with metadata
    mesh.metadata = {
      isBuildableObject: true,
      buildableObjectId: instance.id,
      templateId: instance.templateId,
      zoneId: instance.zoneId,
    };

    this.visuals.set(instance.id, mesh);
  }

  /**
   * Remove visual for an instance
   */
  private removeVisual(instanceId: string): void {
    const visual = this.visuals.get(instanceId);
    if (visual) {
      visual.dispose();
      this.visuals.delete(instanceId);
    }
  }

  /**
   * Create a point light for a buildable with light behavior
   */
  private createLight(instance: BuildableInstance): void {
    if (!this.scene) return;

    const template = this.buildableSystem.getTemplate(instance.templateId);
    const lightBehavior = template?.behaviors?.light;
    if (!lightBehavior) return;

    // Don't create duplicate lights
    if (this.lights.has(instance.id)) return;

    const offset = lightBehavior.offset ?? { x: 0, y: 0, z: 0 };
    const lightPos = new Vector3(
      instance.position.x + offset.x,
      instance.position.y + offset.y,
      instance.position.z + offset.z
    );

    const light = new PointLight(
      `buildable_light_${instance.id}`,
      lightPos,
      this.scene
    );

    light.diffuse = new Color3(
      lightBehavior.color.r,
      lightBehavior.color.g,
      lightBehavior.color.b
    );
    light.specular = new Color3(
      lightBehavior.color.r * 0.5,
      lightBehavior.color.g * 0.5,
      lightBehavior.color.b * 0.5
    );
    light.intensity = lightBehavior.intensity;
    light.range = lightBehavior.range;

    // Enable/disable based on behavior setting
    light.setEnabled(lightBehavior.enabled !== false);

    this.lights.set(instance.id, light);
    console.log(`[BuildableRenderer] Created light for ${instance.id}`);
  }

  /**
   * Remove light for an instance
   */
  private removeLight(instanceId: string): void {
    const light = this.lights.get(instanceId);
    if (light) {
      light.dispose();
      this.lights.delete(instanceId);
    }
  }

  /**
   * Toggle light on/off
   */
  public setLightEnabled(instanceId: string, enabled: boolean): void {
    const light = this.lights.get(instanceId);
    if (light) {
      light.setEnabled(enabled);
    }
  }

  /**
   * Get light for an instance
   */
  public getLight(instanceId: string): PointLight | undefined {
    return this.lights.get(instanceId);
  }

  /**
   * Refresh all visuals (e.g., after loading saved state)
   */
  public refreshAllVisuals(): void {
    for (const instance of this.buildableSystem.getAllInstances()) {
      const template = this.buildableSystem.getTemplate(instance.templateId);
      if (template && template.stages[instance.currentStage]) {
        this.updateVisual(instance, template.stages[instance.currentStage]);
        
        // Create lights for complete instances with light behavior
        if (instance.isComplete && template.behaviors?.light) {
          this.createLight(instance);
        }
      }
    }
  }

  /**
   * Clear all visuals and lights
   */
  public clear(): void {
    for (const visual of this.visuals.values()) {
      visual.dispose();
    }
    this.visuals.clear();

    for (const light of this.lights.values()) {
      light.dispose();
    }
    this.lights.clear();
  }

  /**
   * Dispose renderer
   */
  public dispose(): void {
    this.clear();
    this.scene = null;
  }
}
