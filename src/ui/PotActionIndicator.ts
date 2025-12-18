/**
 * PotActionIndicator - Shows bouncing icons above pots that need player action
 * (e.g., empty pots that need a strain selected)
 */

import { BuildableObjectManager } from "../game/BuildableObject";
import { EventBus } from "../engine/core/EventBus";
import { GameHUD } from "./GameHUD";

interface ActiveIndicator {
  objectId: string;
  element: HTMLElement;
}

export class PotActionIndicator {
  private static instance: PotActionIndicator;
  private container: HTMLElement | null = null;
  private indicators: Map<string, ActiveIndicator> = new Map();
  private getScreenPosition: ((worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null = null;
  private styleInjected: boolean = false;
  private animationFrameId: number | null = null;

  private constructor() {}

  public static getInstance(): PotActionIndicator {
    if (!PotActionIndicator.instance) {
      PotActionIndicator.instance = new PotActionIndicator();
    }
    return PotActionIndicator.instance;
  }

  public initialize(
    getScreenPosition: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null
  ): void {
    this.getScreenPosition = getScreenPosition;
    this.injectStyles();
    this.createContainer();
    this.setupEventListeners();
    this.startUpdateLoop();
    
    // Check for any existing empty pots that need indicators
    // (in case pots were loaded from save before this was initialized)
    setTimeout(() => {
      this.checkAllPots("showcase");
    }, 500);
  }

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      #pot-action-indicators {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
      }

      .pot-action-indicator {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        cursor: pointer;
      }

      .pot-action-icon {
        font-size: 32px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        animation: pot-bounce 1s ease-in-out infinite;
      }

      .pot-action-label {
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
        white-space: nowrap;
        margin-top: 4px;
        border: 1px solid rgba(76, 175, 80, 0.5);
      }

      @keyframes pot-bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-15px); }
      }
    `;
    document.head.appendChild(style);
  }

  private createContainer(): void {
    this.container = document.createElement("div");
    this.container.id = "pot-action-indicators";
    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Listen for pot completion via EventBus
    EventBus.on<{ objectId: string; template: { zoneType: string } }>("building:completed", (data) => {
      if (data.template.zoneType === "plant") {
        this.showIndicatorForPot(data.objectId);
      }
    });

    // Listen for plant being planted (stage changed with hasPlant)
    EventBus.on<{ objectId: string }>("building:stage_changed", (data) => {
      const buildableManager = BuildableObjectManager.getInstance();
      const state = buildableManager.getObject(data.objectId);
      if (state?.hasPlant) {
        this.hideIndicator(data.objectId);
      }
    });

    // Listen for seed planted event to hide indicator
    EventBus.on<{ plantId: string; position: { x: number; z: number } }>("plant:planted", () => {
      // Check all indicators and hide any that now have plants
      for (const [objectId] of this.indicators) {
        const buildableManager = BuildableObjectManager.getInstance();
        const state = buildableManager.getObject(objectId);
        if (state?.hasPlant) {
          this.hideIndicator(objectId);
        }
      }
    });
  }

  public showIndicatorForPot(objectId: string): void {
    // Don't show if not initialized yet
    if (!this.getScreenPosition || !this.container) {
      console.warn("PotActionIndicator: Not initialized yet, skipping indicator for", objectId);
      return;
    }

    const buildableManager = BuildableObjectManager.getInstance();
    const state = buildableManager.getObject(objectId);
    
    if (!state || state.hasPlant) return;

    // Check if indicator already exists
    if (this.indicators.has(objectId)) return;

    const element = document.createElement("div");
    element.className = "pot-action-indicator";
    element.innerHTML = `
      <span class="pot-action-icon">🌱</span>
      <span class="pot-action-label">Select strain</span>
    `;

    // Click to open seed selection - emit event via EventBus
    element.addEventListener("click", () => {
      EventBus.emit("pot:needs_seed", { objectId, position: state.position });
    });

    this.container.appendChild(element);

    // Store the objectId so we can look up fresh position each frame
    const indicator: ActiveIndicator = {
      objectId,
      element,
    };
    
    this.indicators.set(objectId, indicator);
    this.updateIndicatorPosition(indicator);

    // Show game message
    GameHUD.getInstance().showGameMessage("Select strain to grow", "🌱");
  }

  public hideIndicator(objectId: string): void {
    const indicator = this.indicators.get(objectId);
    if (indicator) {
      indicator.element.remove();
      this.indicators.delete(objectId);
    }

    // Hide game message if no more indicators
    if (this.indicators.size === 0) {
      GameHUD.getInstance().hideGameMessage();
    }
  }

  private updateIndicatorPosition(indicator: ActiveIndicator): void {
    if (!this.getScreenPosition) {
      return;
    }

    // Get fresh position from the buildable object (in case it moved)
    const buildableManager = BuildableObjectManager.getInstance();
    const state = buildableManager.getObject(indicator.objectId);
    if (!state) return;

    // Position above the pot (y=0 for ground level objects)
    const worldPos = {
      x: state.position.x,
      y: (state.position.y || 0) + 40, // Above the pot
      z: state.position.z,
    };

    const screenPos = this.getScreenPosition(worldPos);
    if (screenPos && screenPos.x > 0 && screenPos.y > 0 && 
        screenPos.x < window.innerWidth && screenPos.y < window.innerHeight) {
      indicator.element.style.left = `${screenPos.x}px`;
      indicator.element.style.top = `${screenPos.y}px`;
      indicator.element.style.display = "flex";
    } else {
      // Hide if off-screen
      indicator.element.style.display = "none";
    }
  }

  private startUpdateLoop(): void {
    // Update positions every frame
    const update = () => {
      for (const indicator of this.indicators.values()) {
        this.updateIndicatorPosition(indicator);
      }
      this.animationFrameId = requestAnimationFrame(update);
    };
    update();
  }

  /**
   * Check all pots and show indicators for empty ones
   */
  public checkAllPots(mapId: string): void {
    const buildableManager = BuildableObjectManager.getInstance();
    const objects = buildableManager.getObjectsInMap(mapId);

    for (const obj of objects) {
      const template = buildableManager.getTemplate(obj.templateId);
      if (template?.zoneType === "plant" && obj.isComplete && !obj.hasPlant) {
        this.showIndicatorForPot(obj.id);
      }
    }
  }

  public dispose(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.container?.remove();
    this.indicators.clear();
  }
}
