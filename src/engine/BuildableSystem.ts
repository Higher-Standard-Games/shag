/**
 * BuildableSystem - Engine-level generic buildable object system
 *
 * Provides a data-driven framework for objects that:
 * - Progress through visual stages over time
 * - Can produce resources
 * - Can consume resources
 * - Can decay/spoil
 * - Can respond to map triggers
 *
 * Games configure behavior via templates. Mappers reference templates
 * by ID in trigger_buildzone entities.
 */

import { devLog } from "./core/DevLog";
import { EventBus } from "./core/EventBus";

// ==================== Stage Definitions ====================

/**
 * Visual stage for a buildable object
 */
export interface BuildableStage {
  /** Minimum progress (0-100) to show this stage */
  minProgress: number;
  /** Maximum progress (0-100) for this stage */
  maxProgress: number;
  /** Prefab path to display (optional) */
  prefab?: string;
  /** Sprite path to display (optional) */
  sprite?: string;
  /** Scale multiplier for this stage */
  scale?: number;
}

// ==================== Behavior Definitions ====================

/**
 * Producer behavior - object produces items over time
 */
export interface ProducerBehavior {
  /** Item ID to produce */
  outputItem: string;
  /** Amount per production cycle */
  amount: number;
  /** Interval between productions (ms) */
  interval: number;
  /** Only produce when in specific phase (for decayable objects) */
  requirePhase?: string;
  /** Maximum stored before collection required */
  maxStored?: number;
}

/**
 * Consumer behavior - object consumes resources
 */
export interface ConsumerBehavior {
  /** Resource type consumed (e.g., "water", "fuel", "power") */
  resource: string;
  /** Consumption rate per minute */
  ratePerMinute: number;
  /** Current level (0-100) */
  level?: number;
  /** Action when resource depleted: "pause" | "damage" | "destroy" */
  onEmpty: "pause" | "damage" | "destroy";
  /** Damage per minute when empty (if onEmpty === "damage") */
  damageRate?: number;
}

/**
 * Decayable behavior - object has lifecycle phases
 */
export interface DecayBehavior {
  /** Ordered phases (e.g., ["growing", "ready", "overripe", "spoiled"]) */
  phases: string[];
  /** Duration of each phase in ms (same order as phases) */
  phaseDurations: number[];
  /** Quality degradation per phase (0-100 starting quality) */
  qualityPerPhase?: number[];
}

/**
 * Triggerable behavior - responds to map triggers
 */
export interface TriggerableBehavior {
  /** Trigger to fire when object is created */
  onCreated?: string;
  /** Trigger to fire when object completes building */
  onComplete?: string;
  /** Trigger to fire when object is collected */
  onCollect?: string;
  /** Trigger to fire when object is destroyed */
  onDestroy?: string;
  /** Trigger to fire on phase change (decayable) */
  onPhaseChange?: string;
}

/**
 * Upgradeable behavior - can be upgraded to another template
 */
export interface UpgradeableBehavior {
  /** Template ID to upgrade to */
  upgradeTo: string;
  /** Cost to upgrade */
  cost: number;
  /** Time to upgrade (ms) */
  upgradeTime: number;
  /** Required player level */
  requiredLevel?: number;
}

/**
 * Light behavior - object emits light when complete
 * Game layer interprets this to create actual light sources
 */
export interface LightBehavior {
  /** Light color as RGB (0-1 range) */
  color: { r: number; g: number; b: number };
  /** Light intensity (1.0 = normal) */
  intensity: number;
  /** Light range in world units */
  range: number;
  /** Offset from object position */
  offset?: { x: number; y: number; z: number };
  /** Whether light is enabled by default */
  enabled?: boolean;
}

/**
 * Container behavior - can hold child objects
 */
export interface ContainerBehavior {
  /** Maximum number of children allowed */
  maxChildren: number;
  /** Allowed child template IDs (empty = any) */
  allowedTemplates?: string[];
  /** Whether children affect parent's visual stage */
  syncVisualWithChildren?: boolean;
}

/**
 * Combined behaviors for a template
 */
export interface BuildableBehaviors {
  producer?: ProducerBehavior;
  consumer?: ConsumerBehavior;
  decay?: DecayBehavior;
  trigger?: TriggerableBehavior;
  upgrade?: UpgradeableBehavior;
  light?: LightBehavior;
  container?: ContainerBehavior;
}

// ==================== Template Definition ====================

/**
 * Template for creating buildable objects
 * Games register these, mappers reference by ID
 */
export interface BuildableTemplate {
  /** Unique template ID (referenced in .map files) */
  id: string;
  /** Display name */
  name: string;
  /** Icon for UI (optional) */
  icon?: string;
  /** Category for grouping in UI */
  category?: string;
  /** Time to build in ms (0 = instant) */
  buildTime: number;
  /** Cost to build (game interprets this) */
  cost?: number;
  /** Required level to build */
  requiredLevel?: number;
  /** Visual stages (must cover 0-100 progress) */
  stages: BuildableStage[];
  /** Optional behaviors */
  behaviors?: BuildableBehaviors;
  /** Custom data for game-specific logic */
  customData?: Record<string, unknown>;
}

// ==================== Instance State ====================

/**
 * Runtime state of a placed buildable object
 */
export interface BuildableInstance {
  /** Unique instance ID */
  id: string;
  /** Template ID */
  templateId: string;
  /** Map ID where placed */
  mapId: string;
  /** World position */
  position: { x: number; y: number; z: number };
  /** Build progress 0-100 */
  progress: number;
  /** Current visual stage index */
  currentStage: number;
  /** When building started (game time ms) */
  startedAt: number;
  /** Whether build is complete */
  isComplete: boolean;
  /** Health (0-100, for damage behavior) */
  health: number;

  // Consumer state
  /** Current resource levels (keyed by resource type) */
  resourceLevels?: Record<string, number>;

  // Decay state
  /** Current phase name (for decayable) */
  currentPhase?: string;
  /** Current phase index */
  currentPhaseIndex?: number;
  /** When current phase started */
  phaseStartedAt?: number;
  /** Quality percentage (degrades over phases) */
  quality?: number;

  // Producer state
  /** Stored production amount (awaiting collection) */
  storedProduction?: number;
  /** Last production time */
  lastProductionAt?: number;

  // Upgrade state
  /** Whether currently upgrading */
  isUpgrading?: boolean;
  /** Upgrade progress 0-100 */
  upgradeProgress?: number;
  /** Upgrade started at */
  upgradeStartedAt?: number;

  /** Custom data for game-specific state */
  customData?: Record<string, unknown>;

  // Zone support
  /** Zone ID where placed (game-specific) */
  zoneId?: string;

  // Parent-child relationships (multi-child support)
  /** Parent instance ID (if this is a child) */
  parentId?: string;
  /** Child instance IDs (if this is a container) */
  childIds?: string[];
  /** Aggregated child progress (0-100, for visual sync) */
  childProgress?: number;
}

/**
 * Child state for tracking children within a container
 */
export interface ChildState {
  id: string;
  templateId: string;
  progress: number;
  customData?: Record<string, unknown>;
}

// ==================== Events ====================

export type BuildableEventType =
  | "created"
  | "progress"
  | "stage_change"
  | "complete"
  | "phase_change"
  | "child_added"
  | "child_removed"
  | "child_progress"
  | "light_enabled"
  | "light_disabled"
  | "resource_low"
  | "resource_empty"
  | "production_ready"
  | "collected"
  | "damaged"
  | "destroyed"
  | "upgrade_start"
  | "upgrade_complete";

export interface BuildableEvent {
  type: BuildableEventType;
  instanceId: string;
  templateId: string;
  data?: Record<string, unknown>;
}

type BuildableEventCallback = (event: BuildableEvent) => void;

// ==================== Helper Functions ====================

/**
 * Create standard 3-stage progression (0%, 50%, 100%)
 */
export function createStages3(basePath: string, scale = 1): BuildableStage[] {
  return [
    { minProgress: 0, maxProgress: 49, prefab: `${basePath}_0.map`, scale },
    { minProgress: 50, maxProgress: 99, prefab: `${basePath}_50.map`, scale },
    { minProgress: 100, maxProgress: 100, prefab: `${basePath}_100.map`, scale },
  ];
}

/**
 * Create 5-stage progression (0%, 25%, 50%, 75%, 100%)
 */
export function createStages5(basePath: string, scale = 1): BuildableStage[] {
  return [
    { minProgress: 0, maxProgress: 24, prefab: `${basePath}_0.map`, scale },
    { minProgress: 25, maxProgress: 49, prefab: `${basePath}_25.map`, scale },
    { minProgress: 50, maxProgress: 74, prefab: `${basePath}_50.map`, scale },
    { minProgress: 75, maxProgress: 99, prefab: `${basePath}_75.map`, scale },
    { minProgress: 100, maxProgress: 100, prefab: `${basePath}_100.map`, scale },
  ];
}

/**
 * Create single-stage (instant build)
 */
export function createInstantStage(prefab: string, scale = 1): BuildableStage[] {
  return [{ minProgress: 0, maxProgress: 100, prefab, scale }];
}

/**
 * Create custom stage thresholds
 */
export function createCustomStages(basePath: string, thresholds: number[], scale = 1): BuildableStage[] {
  const stages: BuildableStage[] = [];
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

// ==================== Main System ====================

/**
 * BuildableSystem - Manages all buildable objects
 *
 * Usage:
 * 1. Register templates: buildableSystem.registerTemplate(template)
 * 2. Create instances: buildableSystem.create(templateId, position, mapId)
 * 3. Listen to events: buildableSystem.on('complete', callback)
 * 4. Update loop called automatically via provided timer
 */
export class BuildableSystem {
  private static instance: BuildableSystem;

  private templates: Map<string, BuildableTemplate> = new Map();
  private instances: Map<string, BuildableInstance> = new Map();
  private eventListeners: BuildableEventCallback[] = [];

  // Time provider (injected by game)
  private getGameTime: () => number = () => Date.now();

  // Visual update callback (injected by game for rendering)
  private onVisualUpdate?: (instance: BuildableInstance, stage: BuildableStage) => void;

  // Trigger callback (injected by game for map trigger integration)
  private onTrigger?: (triggerName: string, instanceId: string) => void;

  private constructor() {}

  public static getInstance(): BuildableSystem {
    if (!BuildableSystem.instance) {
      BuildableSystem.instance = new BuildableSystem();
    }
    return BuildableSystem.instance;
  }

  // ==================== Configuration ====================

  /**
   * Set the game time provider
   */
  public setTimeProvider(getTime: () => number): void {
    this.getGameTime = getTime;
  }

  /**
   * Set callback for visual updates (game renders the visuals)
   */
  public setVisualUpdateCallback(callback: (instance: BuildableInstance, stage: BuildableStage) => void): void {
    this.onVisualUpdate = callback;
  }

  /**
   * Set callback for trigger execution (game handles triggers)
   */
  public setTriggerCallback(callback: (triggerName: string, instanceId: string) => void): void {
    this.onTrigger = callback;
  }

  // ==================== Templates ====================

  public registerTemplate(template: BuildableTemplate): void {
    this.templates.set(template.id, template);
    devLog(`[BuildableSystem] Registered template: ${template.id}`);
  }

  public registerTemplates(templates: BuildableTemplate[]): void {
    for (const t of templates) {
      this.registerTemplate(t);
    }
  }

  public getTemplate(id: string): BuildableTemplate | undefined {
    return this.templates.get(id);
  }

  public getAllTemplates(): BuildableTemplate[] {
    return Array.from(this.templates.values());
  }

  public getTemplatesByCategory(category: string): BuildableTemplate[] {
    return this.getAllTemplates().filter((t) => t.category === category);
  }

  // ==================== Instance Management ====================

  /**
   * Create a new buildable instance
   */
  public create(
    templateId: string,
    position: { x: number; y: number; z: number },
    mapId: string,
    options?: {
      zoneId?: string;
      customData?: Record<string, unknown>;
    },
  ): BuildableInstance | null {
    const template = this.templates.get(templateId);
    if (!template) {
      console.error(`[BuildableSystem] Unknown template: ${templateId}`);
      return null;
    }

    const now = this.getGameTime();
    const id = `buildable_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const instance: BuildableInstance = {
      id,
      templateId,
      mapId,
      position: { ...position },
      progress: template.buildTime === 0 ? 100 : 0,
      currentStage: 0,
      startedAt: now,
      isComplete: template.buildTime === 0,
      health: 100,
      customData: options?.customData,
      zoneId: options?.zoneId,
      childIds: template.behaviors?.container ? [] : undefined,
    };

    // Initialize consumer resources
    if (template.behaviors?.consumer) {
      instance.resourceLevels = {
        [template.behaviors.consumer.resource]: template.behaviors.consumer.level ?? 100,
      };
    }

    // Initialize decay phase
    if (template.behaviors?.decay) {
      instance.currentPhase = template.behaviors.decay.phases[0];
      instance.currentPhaseIndex = 0;
      instance.phaseStartedAt = now;
      instance.quality = 100;
    }

    // Initialize producer
    if (template.behaviors?.producer) {
      instance.storedProduction = 0;
      instance.lastProductionAt = now;
    }

    this.instances.set(id, instance);

    // Update visual
    this.updateVisual(instance);

    // Fire trigger
    if (template.behaviors?.trigger?.onCreated) {
      this.fireTrigger(template.behaviors.trigger.onCreated, id);
    }

    this.emit({
      type: "created",
      instanceId: id,
      templateId,
      data: { position, mapId },
    });

    // For instant builds (buildTime === 0), emit complete event immediately
    if (template.buildTime === 0) {
      this.emit({
        type: "complete",
        instanceId: id,
        templateId,
      });
    }

    devLog(`[BuildableSystem] Created: ${template.name} (${id})`);
    return instance;
  }

  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: shadows the static singleton accessor by name only — different signature, different `this`, intentional public API for external consumers (isometric SHAG project)
  public getInstance(id: string): BuildableInstance | undefined {
    return this.instances.get(id);
  }

  public getInstancesInMap(mapId: string): BuildableInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.mapId === mapId);
  }

  public getAllInstances(): BuildableInstance[] {
    return Array.from(this.instances.values());
  }

  public getInstancesInZone(zoneId: string): BuildableInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.zoneId === zoneId);
  }

  public getInstancesByTemplate(templateId: string): BuildableInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.templateId === templateId);
  }

  // ==================== Child Management ====================

  /**
   * Add a child to a container instance
   */
  public addChild(parentId: string, childId: string): boolean {
    const parent = this.instances.get(parentId);
    const child = this.instances.get(childId);
    if (!parent || !child) return false;

    const template = this.templates.get(parent.templateId);
    const container = template?.behaviors?.container;

    // Check if parent is a container
    if (!container) {
      console.warn(`[BuildableSystem] ${parentId} is not a container`);
      return false;
    }

    // Initialize childIds array if needed
    if (!parent.childIds) {
      parent.childIds = [];
    }

    // Check max children
    if (parent.childIds.length >= container.maxChildren) {
      console.warn(`[BuildableSystem] Container ${parentId} is full`);
      return false;
    }

    // Check allowed templates
    if (container.allowedTemplates && container.allowedTemplates.length > 0) {
      if (!container.allowedTemplates.includes(child.templateId)) {
        console.warn(`[BuildableSystem] Template ${child.templateId} not allowed in container`);
        return false;
      }
    }

    // Add child
    parent.childIds.push(childId);
    child.parentId = parentId;

    this.emit({
      type: "child_added",
      instanceId: parentId,
      templateId: parent.templateId,
      data: { childId, childTemplateId: child.templateId },
    });

    devLog(`[BuildableSystem] Added child ${childId} to parent ${parentId}`);
    return true;
  }

  /**
   * Remove a child from a container
   */
  public removeChild(parentId: string, childId: string): boolean {
    const parent = this.instances.get(parentId);
    const child = this.instances.get(childId);
    if (!parent || !parent.childIds) return false;

    const index = parent.childIds.indexOf(childId);
    if (index === -1) return false;

    parent.childIds.splice(index, 1);
    if (child) {
      child.parentId = undefined;
    }

    // Reset child progress
    parent.childProgress = undefined;

    this.emit({
      type: "child_removed",
      instanceId: parentId,
      templateId: parent.templateId,
      data: { childId },
    });

    devLog(`[BuildableSystem] Removed child ${childId} from parent ${parentId}`);
    return true;
  }

  /**
   * Remove all children from a container
   */
  public removeAllChildren(parentId: string): void {
    const parent = this.instances.get(parentId);
    if (!parent || !parent.childIds) return;

    for (const childId of [...parent.childIds]) {
      this.removeChild(parentId, childId);
    }
  }

  /**
   * Sync child progress to parent (for visual updates)
   * Progress is averaged across all children
   */
  public syncChildProgress(parentId: string, childId: string, progress: number): void {
    const parent = this.instances.get(parentId);
    if (!parent || !parent.childIds?.includes(childId)) return;

    const template = this.templates.get(parent.templateId);
    const container = template?.behaviors?.container;

    // Calculate average progress of all children
    let totalProgress = progress;
    let count = 1;

    for (const cid of parent.childIds) {
      if (cid !== childId) {
        const child = this.instances.get(cid);
        if (child) {
          totalProgress += child.progress;
          count++;
        }
      }
    }

    parent.childProgress = totalProgress / count;

    // Update visual if sync is enabled
    if (container?.syncVisualWithChildren) {
      const oldStage = parent.currentStage;
      parent.currentStage = this.getStageIndex(template!, parent.childProgress);

      if (parent.currentStage !== oldStage) {
        this.updateVisual(parent);
      }
    }

    this.emit({
      type: "child_progress",
      instanceId: parentId,
      templateId: parent.templateId,
      data: { childId, progress, aggregateProgress: parent.childProgress },
    });
  }

  /**
   * Get children of a container
   */
  public getChildren(parentId: string): BuildableInstance[] {
    const parent = this.instances.get(parentId);
    if (!parent || !parent.childIds) return [];

    return parent.childIds.map((id) => this.instances.get(id)).filter((c): c is BuildableInstance => c !== undefined);
  }

  /**
   * Check if container has room for more children
   */
  public hasRoomForChild(parentId: string): boolean {
    const parent = this.instances.get(parentId);
    if (!parent) return false;

    const template = this.templates.get(parent.templateId);
    const container = template?.behaviors?.container;
    if (!container) return false;

    const currentCount = parent.childIds?.length ?? 0;
    return currentCount < container.maxChildren;
  }

  /**
   * Remove an instance
   */
  public destroy(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    const template = this.templates.get(instance.templateId);

    // Fire trigger
    if (template?.behaviors?.trigger?.onDestroy) {
      this.fireTrigger(template.behaviors.trigger.onDestroy, id);
    }

    this.emit({
      type: "destroyed",
      instanceId: id,
      templateId: instance.templateId,
    });

    this.instances.delete(id);
    devLog(`[BuildableSystem] Destroyed: ${id}`);
    return true;
  }

  // ==================== Update Loop ====================

  /**
   * Call this from your game loop (e.g., every 500ms)
   */
  public update(): void {
    const now = this.getGameTime();

    for (const instance of this.instances.values()) {
      const template = this.templates.get(instance.templateId);
      if (!template) continue;

      // Update build progress
      if (!instance.isComplete) {
        this.updateBuildProgress(instance, template, now);
      }

      // Update upgrade progress
      if (instance.isUpgrading) {
        this.updateUpgradeProgress(instance, template, now);
      }

      // Update consumer (resource drain)
      if (template.behaviors?.consumer && instance.isComplete) {
        this.updateConsumer(instance, template, now);
      }

      // Update decay phases
      if (template.behaviors?.decay && instance.isComplete) {
        this.updateDecay(instance, template, now);
      }

      // Update producer
      if (template.behaviors?.producer && instance.isComplete) {
        this.updateProducer(instance, template, now);
      }
    }
  }

  private updateBuildProgress(instance: BuildableInstance, template: BuildableTemplate, now: number): void {
    if (template.buildTime === 0) {
      instance.progress = 100;
      instance.isComplete = true;
      return;
    }

    const elapsed = now - instance.startedAt;
    const newProgress = Math.min(100, (elapsed / template.buildTime) * 100);

    if (newProgress !== instance.progress) {
      const oldStage = instance.currentStage;
      instance.progress = newProgress;
      instance.currentStage = this.getStageIndex(template, newProgress);

      if (instance.currentStage !== oldStage) {
        this.updateVisual(instance);
        this.emit({
          type: "stage_change",
          instanceId: instance.id,
          templateId: template.id,
          data: { oldStage, newStage: instance.currentStage, progress: newProgress },
        });
      }

      this.emit({
        type: "progress",
        instanceId: instance.id,
        templateId: template.id,
        data: { progress: newProgress },
      });
    }

    // Check completion
    if (newProgress >= 100 && !instance.isComplete) {
      instance.isComplete = true;
      instance.phaseStartedAt = now; // Start decay timer from completion

      if (template.behaviors?.trigger?.onComplete) {
        this.fireTrigger(template.behaviors.trigger.onComplete, instance.id);
      }

      this.emit({
        type: "complete",
        instanceId: instance.id,
        templateId: template.id,
      });
    }
  }

  private updateConsumer(instance: BuildableInstance, template: BuildableTemplate, _now: number): void {
    const consumer = template.behaviors!.consumer!;
    const resource = consumer.resource;

    if (!instance.resourceLevels) {
      instance.resourceLevels = { [resource]: 100 };
    }

    const currentLevel = instance.resourceLevels[resource] ?? 100;

    // Drain resource (rate per minute, update assumes ~500ms intervals)
    const drainPerUpdate = consumer.ratePerMinute / 120; // 120 updates per minute
    const newLevel = Math.max(0, currentLevel - drainPerUpdate);
    instance.resourceLevels[resource] = newLevel;

    // Low warning at 30%
    if (newLevel <= 30 && currentLevel > 30) {
      this.emit({
        type: "resource_low",
        instanceId: instance.id,
        templateId: template.id,
        data: { resource, level: newLevel },
      });
    }

    // Empty handling
    if (newLevel <= 0 && currentLevel > 0) {
      this.emit({
        type: "resource_empty",
        instanceId: instance.id,
        templateId: template.id,
        data: { resource },
      });

      if (consumer.onEmpty === "destroy") {
        this.destroy(instance.id);
      }
    }

    // Damage when empty
    if (newLevel <= 0 && consumer.onEmpty === "damage" && consumer.damageRate) {
      const damagePerUpdate = consumer.damageRate / 120;
      instance.health = Math.max(0, instance.health - damagePerUpdate);

      if (instance.health <= 0) {
        this.emit({
          type: "damaged",
          instanceId: instance.id,
          templateId: template.id,
          data: { health: 0, cause: "resource_empty" },
        });
        this.destroy(instance.id);
      }
    }
  }

  private updateDecay(instance: BuildableInstance, template: BuildableTemplate, now: number): void {
    const decay = template.behaviors!.decay!;

    if (instance.currentPhaseIndex === undefined) {
      instance.currentPhaseIndex = 0;
      instance.currentPhase = decay.phases[0];
      instance.phaseStartedAt = now;
    }

    const phaseIndex = instance.currentPhaseIndex;
    const phaseDuration = decay.phaseDurations[phaseIndex];
    const phaseElapsed = now - (instance.phaseStartedAt ?? now);

    // Check phase transition
    if (phaseElapsed >= phaseDuration && phaseIndex < decay.phases.length - 1) {
      const oldPhase = instance.currentPhase;
      instance.currentPhaseIndex = phaseIndex + 1;
      instance.currentPhase = decay.phases[instance.currentPhaseIndex];
      instance.phaseStartedAt = now;

      // Degrade quality
      if (decay.qualityPerPhase && decay.qualityPerPhase[instance.currentPhaseIndex] !== undefined) {
        instance.quality = decay.qualityPerPhase[instance.currentPhaseIndex];
      }

      if (template.behaviors?.trigger?.onPhaseChange) {
        this.fireTrigger(template.behaviors.trigger.onPhaseChange, instance.id);
      }

      this.emit({
        type: "phase_change",
        instanceId: instance.id,
        templateId: template.id,
        data: {
          oldPhase,
          newPhase: instance.currentPhase,
          quality: instance.quality,
          phaseIndex: instance.currentPhaseIndex,
        },
      });
    }
  }

  private updateProducer(instance: BuildableInstance, template: BuildableTemplate, now: number): void {
    const producer = template.behaviors!.producer!;

    // Check phase requirement
    if (producer.requirePhase && instance.currentPhase !== producer.requirePhase) {
      return;
    }

    // Check if paused due to empty resource
    if (template.behaviors?.consumer) {
      const resource = template.behaviors.consumer.resource;
      const level = instance.resourceLevels?.[resource] ?? 0;
      if (level <= 0 && template.behaviors.consumer.onEmpty === "pause") {
        return;
      }
    }

    const lastProduction = instance.lastProductionAt ?? instance.startedAt;
    const elapsed = now - lastProduction;

    if (elapsed >= producer.interval) {
      const stored = instance.storedProduction ?? 0;
      const maxStored = producer.maxStored ?? Infinity;

      if (stored < maxStored) {
        instance.storedProduction = Math.min(maxStored, stored + producer.amount);
        instance.lastProductionAt = now;

        this.emit({
          type: "production_ready",
          instanceId: instance.id,
          templateId: template.id,
          data: {
            item: producer.outputItem,
            amount: producer.amount,
            stored: instance.storedProduction,
          },
        });
      }
    }
  }

  private updateUpgradeProgress(instance: BuildableInstance, template: BuildableTemplate, now: number): void {
    const upgrade = template.behaviors?.upgrade;
    if (!upgrade || !instance.upgradeStartedAt) return;

    const elapsed = now - instance.upgradeStartedAt;
    instance.upgradeProgress = Math.min(100, (elapsed / upgrade.upgradeTime) * 100);

    if (instance.upgradeProgress >= 100) {
      // Complete upgrade - transform to new template
      const newTemplate = this.templates.get(upgrade.upgradeTo);
      if (newTemplate) {
        instance.templateId = upgrade.upgradeTo;
        instance.isUpgrading = false;
        instance.upgradeProgress = undefined;
        instance.upgradeStartedAt = undefined;
        instance.currentStage = 0;
        instance.progress = 100;

        this.updateVisual(instance);

        this.emit({
          type: "upgrade_complete",
          instanceId: instance.id,
          templateId: upgrade.upgradeTo,
          data: { previousTemplate: template.id },
        });
      }
    }
  }

  // ==================== Actions ====================

  /**
   * Add resource to an instance (e.g., watering)
   */
  public addResource(instanceId: string, resource: string, amount: number): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    if (!instance.resourceLevels) {
      instance.resourceLevels = {};
    }

    const current = instance.resourceLevels[resource] ?? 0;
    instance.resourceLevels[resource] = Math.min(100, current + amount);
    return true;
  }

  /**
   * Collect production from a producer
   */
  public collect(instanceId: string): { item: string; amount: number } | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    const template = this.templates.get(instance.templateId);
    if (!template?.behaviors?.producer) return null;

    const amount = instance.storedProduction ?? 0;
    if (amount <= 0) return null;

    instance.storedProduction = 0;

    if (template.behaviors.trigger?.onCollect) {
      this.fireTrigger(template.behaviors.trigger.onCollect, instanceId);
    }

    this.emit({
      type: "collected",
      instanceId,
      templateId: template.id,
      data: { item: template.behaviors.producer.outputItem, amount },
    });

    return { item: template.behaviors.producer.outputItem, amount };
  }

  /**
   * Start upgrading an instance
   */
  public startUpgrade(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.isUpgrading) return false;

    const template = this.templates.get(instance.templateId);
    if (!template?.behaviors?.upgrade) return false;

    instance.isUpgrading = true;
    instance.upgradeProgress = 0;
    instance.upgradeStartedAt = this.getGameTime();

    this.emit({
      type: "upgrade_start",
      instanceId,
      templateId: template.id,
      data: { upgradeTo: template.behaviors.upgrade.upgradeTo },
    });

    return true;
  }

  // ==================== Helpers ====================

  private getStageIndex(template: BuildableTemplate, progress: number): number {
    for (let i = 0; i < template.stages.length; i++) {
      const stage = template.stages[i];
      if (progress >= stage.minProgress && progress <= stage.maxProgress) {
        return i;
      }
    }
    return template.stages.length - 1;
  }

  private updateVisual(instance: BuildableInstance): void {
    const template = this.templates.get(instance.templateId);
    if (!template) return;

    const stage = template.stages[instance.currentStage];
    if (stage && this.onVisualUpdate) {
      this.onVisualUpdate(instance, stage);
    }
  }

  private fireTrigger(triggerName: string, instanceId: string): void {
    if (this.onTrigger) {
      this.onTrigger(triggerName, instanceId);
    }
  }

  // ==================== Events ====================

  public on(callback: BuildableEventCallback): void {
    this.eventListeners.push(callback);
  }

  public off(callback: BuildableEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emit(event: BuildableEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }

    // Also emit to global EventBus
    EventBus.emit(`buildable:${event.type}`, event);
  }

  // ==================== Serialization ====================

  /**
   * Get all instance state for saving
   */
  public serialize(): BuildableInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Restore instances from saved state
   */
  public deserialize(instances: BuildableInstance[]): void {
    this.instances.clear();
    for (const instance of instances) {
      this.instances.set(instance.id, instance);
      this.updateVisual(instance);
    }
    devLog(`[BuildableSystem] Loaded ${instances.length} instances`);
  }

  /**
   * Clear all instances (for new game)
   */
  public clear(): void {
    this.instances.clear();
  }

  /**
   * Clear instances for a specific map
   */
  public clearMap(mapId: string): void {
    for (const [id, instance] of this.instances) {
      if (instance.mapId === mapId) {
        this.instances.delete(id);
      }
    }
  }
}
