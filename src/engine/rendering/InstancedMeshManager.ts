/**
 * InstancedMeshManager - GPU instancing for repeated geometry
 *
 * Reduces draw calls by batching identical meshes into instanced renders.
 * Critical for mobile performance with repeated objects (trees, props, etc.)
 *
 * Usage:
 *   const manager = InstancedMeshManager.getInstance();
 *   manager.init(scene);
 *
 *   // Register a mesh as a template for instancing
 *   manager.registerTemplate('tree_pine', treeMesh);
 *
 *   // Create instances (much cheaper than cloning)
 *   const instance1 = manager.createInstance('tree_pine', position1, rotation1);
 *   const instance2 = manager.createInstance('tree_pine', position2, rotation2);
 *
 *   // Remove instance when done
 *   manager.removeInstance(instance1);
 */

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";

export interface InstanceData {
  /** Unique ID for this instance */
  id: string;
  /** Template name this instance was created from */
  templateName: string;
  /** Reference to the InstancedMesh */
  mesh: InstancedMesh;
  /** Index in the instance buffer */
  bufferIndex: number;
}

export interface TemplateData {
  /** Source mesh used as template */
  sourceMesh: Mesh;
  /** All instances created from this template */
  instances: Map<string, InstanceData>;
  /** Current instance count */
  count: number;
  /** Maximum instances (for buffer sizing) */
  maxInstances: number;
}

export interface InstanceTransform {
  position: Vector3;
  rotation?: Vector3;
  scaling?: Vector3;
}

/**
 * Manages GPU-instanced meshes for performance optimization
 */
export class InstancedMeshManager {
  private static instance: InstancedMeshManager | null = null;
  private scene: Scene | null = null;
  private templates: Map<string, TemplateData> = new Map();
  private instanceCounter: number = 0;

  // Default max instances per template (can be overridden per-template)
  private defaultMaxInstances: number = 1000;

  private constructor() {}

  public static getInstance(): InstancedMeshManager {
    if (!InstancedMeshManager.instance) {
      InstancedMeshManager.instance = new InstancedMeshManager();
    }
    return InstancedMeshManager.instance;
  }

  /**
   * Initialize with scene reference
   */
  public init(scene: Scene): void {
    this.scene = scene;
    devLog("[InstancedMeshManager] Initialized");
  }

  /**
   * Check if manager is initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Register a mesh as a template for instancing
   * The source mesh will be hidden and used only as a template
   *
   * @param name Unique template name
   * @param mesh Source mesh to use as template
   * @param maxInstances Maximum number of instances (for buffer pre-allocation)
   */
  public registerTemplate(name: string, mesh: Mesh, maxInstances: number = this.defaultMaxInstances): void {
    if (this.templates.has(name)) {
      console.warn(`[InstancedMeshManager] Template '${name}' already registered`);
      return;
    }

    // Ensure the source mesh is ready for instancing
    mesh.isVisible = false;
    mesh.setEnabled(true);

    // Make sure the mesh has its buffers ready
    if (!mesh.geometry) {
      console.warn(`[InstancedMeshManager] Mesh '${name}' has no geometry`);
      return;
    }

    this.templates.set(name, {
      sourceMesh: mesh,
      instances: new Map(),
      count: 0,
      maxInstances,
    });

    devLog(`[InstancedMeshManager] Registered template '${name}' (max: ${maxInstances})`);
  }

  /**
   * Create an instance from a registered template
   *
   * @param templateName Name of the registered template
   * @param transform Position, rotation, and scale for the instance
   * @returns Instance data or null if template not found
   */
  public createInstance(templateName: string, transform: InstanceTransform): InstanceData | null {
    const template = this.templates.get(templateName);
    if (!template) {
      console.warn(`[InstancedMeshManager] Template '${templateName}' not found`);
      return null;
    }

    if (template.count >= template.maxInstances) {
      console.warn(`[InstancedMeshManager] Max instances (${template.maxInstances}) reached for '${templateName}'`);
      return null;
    }

    // Generate unique instance ID
    const instanceId = `${templateName}_${this.instanceCounter++}`;

    // Create the instanced mesh
    const instancedMesh = template.sourceMesh.createInstance(instanceId);

    // Apply transform
    instancedMesh.position = transform.position.clone();

    if (transform.rotation) {
      instancedMesh.rotation = transform.rotation.clone();
    }

    if (transform.scaling) {
      instancedMesh.scaling = transform.scaling.clone();
    }

    // Store instance data
    const instanceData: InstanceData = {
      id: instanceId,
      templateName,
      mesh: instancedMesh,
      bufferIndex: template.count,
    };

    template.instances.set(instanceId, instanceData);
    template.count++;

    return instanceData;
  }

  /**
   * Create multiple instances at once (more efficient)
   *
   * @param templateName Name of the registered template
   * @param transforms Array of transforms for each instance
   * @returns Array of instance data
   */
  public createInstances(templateName: string, transforms: InstanceTransform[]): InstanceData[] {
    const results: InstanceData[] = [];

    for (const transform of transforms) {
      const instance = this.createInstance(templateName, transform);
      if (instance) {
        results.push(instance);
      }
    }

    return results;
  }

  /**
   * Update an instance's transform
   */
  public updateInstance(instanceId: string, transform: Partial<InstanceTransform>): boolean {
    // Find the instance across all templates
    for (const template of this.templates.values()) {
      const instance = template.instances.get(instanceId);
      if (instance) {
        if (transform.position) {
          instance.mesh.position = transform.position.clone();
        }
        if (transform.rotation) {
          instance.mesh.rotation = transform.rotation.clone();
        }
        if (transform.scaling) {
          instance.mesh.scaling = transform.scaling.clone();
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Remove an instance
   */
  public removeInstance(instanceId: string): boolean {
    for (const template of this.templates.values()) {
      const instance = template.instances.get(instanceId);
      if (instance) {
        instance.mesh.dispose();
        template.instances.delete(instanceId);
        template.count--;
        return true;
      }
    }
    return false;
  }

  /**
   * Remove an instance by its data reference
   */
  public removeInstanceByData(instanceData: InstanceData): boolean {
    return this.removeInstance(instanceData.id);
  }

  /**
   * Remove all instances of a template
   */
  public clearTemplate(templateName: string): void {
    const template = this.templates.get(templateName);
    if (!template) return;

    for (const instance of template.instances.values()) {
      instance.mesh.dispose();
    }
    template.instances.clear();
    template.count = 0;

    devLog(`[InstancedMeshManager] Cleared all instances of '${templateName}'`);
  }

  /**
   * Remove a template and all its instances
   */
  public removeTemplate(templateName: string): void {
    const template = this.templates.get(templateName);
    if (!template) return;

    this.clearTemplate(templateName);
    template.sourceMesh.dispose();
    this.templates.delete(templateName);

    devLog(`[InstancedMeshManager] Removed template '${templateName}'`);
  }

  /**
   * Get instance count for a template
   */
  public getInstanceCount(templateName: string): number {
    return this.templates.get(templateName)?.count ?? 0;
  }

  /**
   * Get total instance count across all templates
   */
  public getTotalInstanceCount(): number {
    let total = 0;
    for (const template of this.templates.values()) {
      total += template.count;
    }
    return total;
  }

  /**
   * Check if a template is registered
   */
  public hasTemplate(templateName: string): boolean {
    return this.templates.has(templateName);
  }

  /**
   * Get all registered template names
   */
  public getTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Clear all templates and instances
   */
  public clear(): void {
    for (const templateName of this.templates.keys()) {
      this.removeTemplate(templateName);
    }
    this.templates.clear();
    this.instanceCounter = 0;
    devLog("[InstancedMeshManager] Cleared all templates and instances");
  }

  /**
   * Dispose the manager
   */
  public dispose(): void {
    this.clear();
    this.scene = null;
  }

  /**
   * Get debug info about templates and instances
   */
  public getDebugInfo(): {
    templates: { name: string; count: number; maxInstances: number }[];
    totalInstances: number;
  } {
    const templates = Array.from(this.templates.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      maxInstances: data.maxInstances,
    }));

    return {
      templates,
      totalInstances: this.getTotalInstanceCount(),
    };
  }

  /**
   * Create instances from a thin instance buffer (advanced, higher performance)
   * Uses matrix buffers for maximum GPU efficiency
   *
   * @param templateName Name of the registered template
   * @param matrices Array of world matrices for each instance
   */
  public createThinInstances(templateName: string, matrices: Matrix[]): void {
    const template = this.templates.get(templateName);
    if (!template) {
      console.warn(`[InstancedMeshManager] Template '${templateName}' not found`);
      return;
    }

    // Convert matrices to Float32Array for thin instances
    const matrixData = new Float32Array(matrices.length * 16);
    for (let i = 0; i < matrices.length; i++) {
      matrices[i].copyToArray(matrixData, i * 16);
    }

    // Set thin instance buffers on the source mesh
    template.sourceMesh.isVisible = true;
    template.sourceMesh.thinInstanceSetBuffer("matrix", matrixData, 16);

    devLog(`[InstancedMeshManager] Created ${matrices.length} thin instances for '${templateName}'`);
  }

  /**
   * Helper to create a world matrix from transform
   */
  public static createMatrix(transform: InstanceTransform): Matrix {
    const position = transform.position;
    const rotation = transform.rotation ?? Vector3.Zero();
    const scaling = transform.scaling ?? Vector3.One();

    return Matrix.Compose(scaling, Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z), position);
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    if (InstancedMeshManager.instance) {
      InstancedMeshManager.instance.dispose();
    }
    InstancedMeshManager.instance = null;
  }
}
