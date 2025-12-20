/**
 * WorldIndicatorSystem - Generic engine feature for spawning UI indicators at world positions
 * 
 * Use this for any floating UI elements that need to track world positions:
 * - Water prompts above plants
 * - Action indicators above objects (e.g., "Select strain")
 * - Harvest ready indicators
 * - Damage numbers
 * - Status effects
 * 
 * Usage:
 *   WorldIndicatorSystem.getInstance().init(scene, camera, engine);
 *   WorldIndicatorSystem.getInstance().addIndicator({
 *     id: "water_plant123",
 *     worldPosition: { x: 100, y: 0, z: 200 },
 *     config: { icon: "💧", label: "Tap to water!", animation: "bounce" }
 *   });
 */

import { Scene, ArcRotateCamera, Engine, Vector3 } from "babylonjs";

// ==================== Types ====================

export type IndicatorAnimation = "bounce" | "pulse" | "shake" | "none";

export interface IndicatorConfig {
  icon: string;                    // Emoji or HTML content for the icon
  label?: string;                  // Optional text label below icon
  animation?: IndicatorAnimation;  // Animation type (default: "bounce")
  offsetY?: number;                // Height offset above world position (default: 40)
  onClick?: (indicator: WorldIndicator) => void;  // Click handler
  onExpire?: (indicator: WorldIndicator) => void; // Called when indicator expires
  duration?: number;               // Auto-remove after ms (0 = permanent)
  className?: string;              // Additional CSS class
  zIndex?: number;                 // Z-index override
}

export interface WorldIndicator {
  id: string;
  worldPosition: { x: number; y: number; z: number };
  element: HTMLElement;
  config: IndicatorConfig;
  data?: unknown;                  // Custom data (plantId, objectId, etc.)
  createdAt: number;
}

export interface AddIndicatorOptions {
  id: string;
  worldPosition: { x: number; y: number; z: number };
  config: IndicatorConfig;
  data?: unknown;
}

// ==================== WorldIndicatorSystem ====================

export class WorldIndicatorSystem {
  private static instance: WorldIndicatorSystem;

  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private engine: Engine | null = null;
  private container: HTMLElement | null = null;
  private indicators: Map<string, WorldIndicator> = new Map();
  private animationFrameId: number | null = null;
  private styleInjected: boolean = false;

  private constructor() {}

  public static getInstance(): WorldIndicatorSystem {
    if (!WorldIndicatorSystem.instance) {
      WorldIndicatorSystem.instance = new WorldIndicatorSystem();
    }
    return WorldIndicatorSystem.instance;
  }

  /**
   * Initialize the system with scene, camera, and engine references
   */
  public init(scene: Scene, camera: ArcRotateCamera, engine: Engine): void {
    this.scene = scene;
    this.camera = camera;
    this.engine = engine;
    
    this.injectStyles();
    this.createContainer();
    this.startUpdateLoop();
    
    console.log("WorldIndicatorSystem initialized");
  }

  /**
   * Check if system is initialized
   */
  public isInitialized(): boolean {
    return this.scene !== null && this.camera !== null && this.engine !== null;
  }

  // ==================== Indicator Management ====================

  /**
   * Add a new indicator at a world position
   */
  public addIndicator(options: AddIndicatorOptions): WorldIndicator | null {
    if (!this.isInitialized() || !this.container) {
      console.warn("WorldIndicatorSystem: Not initialized, cannot add indicator");
      return null;
    }

    // Remove existing indicator with same ID
    if (this.indicators.has(options.id)) {
      this.removeIndicator(options.id);
    }

    const config = {
      animation: "bounce" as IndicatorAnimation,
      offsetY: 40,
      zIndex: 100,  // Below UI panels (SidePanel=900, BottomBar=1000)
      ...options.config,
    };

    // Create DOM element
    const element = document.createElement("div");
    element.className = `world-indicator world-indicator-${config.animation}`;
    if (config.className) {
      element.classList.add(config.className);
    }
    element.style.zIndex = String(config.zIndex);

    // Build inner HTML
    let html = `<span class="world-indicator-icon">${config.icon}</span>`;
    if (config.label) {
      html += `<span class="world-indicator-label">${config.label}</span>`;
    }
    element.innerHTML = html;

    // Create indicator object
    const indicator: WorldIndicator = {
      id: options.id,
      worldPosition: { ...options.worldPosition },
      element,
      config,
      data: options.data,
      createdAt: Date.now(),
    };

    // Add click handler
    if (config.onClick) {
      element.addEventListener("click", () => {
        config.onClick!(indicator);
      });
    }

    // Add to DOM and map
    this.container.appendChild(element);
    this.indicators.set(options.id, indicator);

    // Initial position update
    this.updateIndicatorPosition(indicator);

    return indicator;
  }

  /**
   * Remove an indicator by ID
   */
  public removeIndicator(id: string): boolean {
    const indicator = this.indicators.get(id);
    if (!indicator) return false;

    // Call onExpire callback
    if (indicator.config.onExpire) {
      indicator.config.onExpire(indicator);
    }

    // Remove from DOM
    indicator.element.remove();
    this.indicators.delete(id);

    return true;
  }

  /**
   * Get an indicator by ID
   */
  public getIndicator(id: string): WorldIndicator | undefined {
    return this.indicators.get(id);
  }

  /**
   * Check if an indicator exists
   */
  public hasIndicator(id: string): boolean {
    return this.indicators.has(id);
  }

  /**
   * Update an indicator's world position
   */
  public updatePosition(id: string, worldPosition: { x: number; y: number; z: number }): void {
    const indicator = this.indicators.get(id);
    if (indicator) {
      indicator.worldPosition = { ...worldPosition };
    }
  }

  /**
   * Update an indicator's label
   */
  public updateLabel(id: string, label: string): void {
    const indicator = this.indicators.get(id);
    if (indicator) {
      const labelEl = indicator.element.querySelector(".world-indicator-label");
      if (labelEl) {
        labelEl.textContent = label;
      }
    }
  }

  /**
   * Get all indicators with a specific prefix
   */
  public getIndicatorsByPrefix(prefix: string): WorldIndicator[] {
    const result: WorldIndicator[] = [];
    for (const [id, indicator] of this.indicators) {
      if (id.startsWith(prefix)) {
        result.push(indicator);
      }
    }
    return result;
  }

  /**
   * Remove all indicators with a specific prefix
   */
  public removeIndicatorsByPrefix(prefix: string): number {
    let count = 0;
    for (const id of this.indicators.keys()) {
      if (id.startsWith(prefix)) {
        this.removeIndicator(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get count of active indicators
   */
  public getCount(): number {
    return this.indicators.size;
  }

  // ==================== Position Updates ====================

  /**
   * Convert world position to screen position
   */
  private worldToScreen(worldPos: { x: number; y: number; z: number }): { x: number; y: number } | null {
    if (!this.scene || !this.camera || !this.engine) return null;

    const pos = new Vector3(worldPos.x, worldPos.y, worldPos.z);
    const viewMatrix = this.camera.getViewMatrix();
    const projectionMatrix = this.camera.getProjectionMatrix();
    const viewport = this.camera.viewport.toGlobal(
      this.engine.getRenderWidth(),
      this.engine.getRenderHeight()
    );

    const screenPos = Vector3.Project(pos, viewMatrix, projectionMatrix, viewport);
    return { x: screenPos.x, y: screenPos.y };
  }

  /**
   * Update a single indicator's screen position
   */
  private updateIndicatorPosition(indicator: WorldIndicator): void {
    const offsetY = indicator.config.offsetY ?? 40;
    const worldPos = {
      x: indicator.worldPosition.x,
      y: (indicator.worldPosition.y || 0) + offsetY,
      z: indicator.worldPosition.z,
    };

    const screenPos = this.worldToScreen(worldPos);
    
    if (screenPos && 
        screenPos.x > -100 && screenPos.y > -100 && 
        screenPos.x < window.innerWidth + 100 && 
        screenPos.y < window.innerHeight + 100) {
      indicator.element.style.left = `${screenPos.x}px`;
      indicator.element.style.top = `${screenPos.y}px`;
      indicator.element.style.display = "flex";
    } else {
      indicator.element.style.display = "none";
    }
  }

  /**
   * Update loop - runs every frame
   */
  private startUpdateLoop(): void {
    const update = () => {
      const now = Date.now();

      for (const indicator of this.indicators.values()) {
        // Check for expiration
        if (indicator.config.duration && indicator.config.duration > 0) {
          if (now - indicator.createdAt >= indicator.config.duration) {
            this.removeIndicator(indicator.id);
            continue;
          }
        }

        // Update position
        this.updateIndicatorPosition(indicator);
      }

      this.animationFrameId = requestAnimationFrame(update);
    };
    update();
  }

  // ==================== Styles ====================

  private createContainer(): void {
    this.container = document.createElement("div");
    this.container.id = "world-indicators";
    document.body.appendChild(this.container);
  }

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      #world-indicators {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 100;  /* Below UI panels (SidePanel=900, BottomBar=1000) */
      }

      .world-indicator {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        cursor: pointer;
        transition: transform 0.1s ease;
      }

      .world-indicator:hover {
        transform: translate(-50%, -50%) scale(1.1);
      }

      .world-indicator-icon {
        font-size: 32px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
      }

      .world-indicator-label {
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
        white-space: nowrap;
        margin-top: 4px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      /* Bounce animation */
      .world-indicator-bounce .world-indicator-icon {
        animation: wi-bounce 1s ease-in-out infinite;
      }

      @keyframes wi-bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-12px); }
      }

      /* Pulse animation */
      .world-indicator-pulse .world-indicator-icon {
        animation: wi-pulse 1.5s ease-in-out infinite;
      }

      @keyframes wi-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.8; }
      }

      /* Shake animation */
      .world-indicator-shake .world-indicator-icon {
        animation: wi-shake 0.5s ease-in-out infinite;
      }

      @keyframes wi-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        75% { transform: translateX(3px); }
      }

      /* Urgent variant */
      .world-indicator-urgent .world-indicator-icon {
        animation-duration: 0.3s !important;
      }

      .world-indicator-urgent .world-indicator-label {
        background: rgba(255, 50, 50, 0.9);
        border-color: rgba(255, 100, 100, 0.5);
      }

      /* Success variant */
      .world-indicator-success .world-indicator-label {
        background: rgba(50, 180, 50, 0.9);
        border-color: rgba(100, 255, 100, 0.5);
      }

      /* Fade out animation for removal */
      .world-indicator-removing {
        animation: wi-fadeout 0.3s ease-out forwards;
        pointer-events: none;
      }

      @keyframes wi-fadeout {
        from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        to { opacity: 0; transform: translate(-50%, -100%) scale(1.2); }
      }
    `;
    document.head.appendChild(style);
  }

  // ==================== Cleanup ====================

  public dispose(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Remove all indicators
    for (const indicator of this.indicators.values()) {
      indicator.element.remove();
    }
    this.indicators.clear();

    this.container?.remove();
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.engine = null;
  }
}
