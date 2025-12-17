/**
 * WaterPromptUI - Hempire-style tap-to-water prompts
 * 
 * Shows floating water drop indicators above plants that need watering.
 * Player taps to water and gets bonus growth/quality.
 */

import { EventBus } from "../engine/core/EventBus";
import { GameState } from "../game/GameState";
import { GameTimer } from "../game/GameTimer";
import { PlantSystem } from "../game/PlantSystem";

interface ActivePrompt {
  plantId: string;
  element: HTMLElement;
  expiresAt: number;
  position: { x: number; y: number; z: number };
}

export class WaterPromptUI {
  private static instance: WaterPromptUI;
  private container: HTMLElement | null = null;
  private prompts: Map<string, ActivePrompt> = new Map();
  private updateTaskId: string = "water_prompt_update";
  private styleInjected: boolean = false;
  private getScreenPosition: ((worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null = null;

  private constructor() {}

  public static getInstance(): WaterPromptUI {
    if (!WaterPromptUI.instance) {
      WaterPromptUI.instance = new WaterPromptUI();
    }
    return WaterPromptUI.instance;
  }

  /**
   * Initialize the water prompt system
   * @param getScreenPosition Function to convert world position to screen coordinates
   */
  public init(getScreenPosition: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null): void {
    this.getScreenPosition = getScreenPosition;
    this.injectStyles();
    this.createContainer();
    this.startUpdateLoop();
    this.setupEventListeners();
  }

  private createContainer(): void {
    this.container = document.createElement("div");
    this.container.id = "water-prompt-container";
    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Listen for water prompt events from PlantSystem
    EventBus.on("plant:water_prompt", (data: { plantId: string; expiresIn: number }) => {
      this.showPrompt(data.plantId, data.expiresIn);
    });

    EventBus.on("plant:water_prompt_expired", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });

    EventBus.on("plant:watered", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });

    EventBus.on("plant:harvested", (data: { plantId: string }) => {
      this.hidePrompt(data.plantId);
    });
  }

  /**
   * Show a water prompt for a plant
   */
  public showPrompt(plantId: string, expiresIn: number): void {
    // Don't show duplicate
    if (this.prompts.has(plantId)) return;

    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;

    const element = document.createElement("div");
    element.className = "water-prompt";
    element.innerHTML = `
      <div class="water-prompt-icon">💧</div>
      <div class="water-prompt-timer"></div>
    `;

    element.addEventListener("click", () => {
      this.onPromptClick(plantId);
    });

    this.container?.appendChild(element);

    const prompt: ActivePrompt = {
      plantId,
      element,
      expiresAt: GameTimer.getInstance().getGameTime() + expiresIn,
      position: plant.position,
    };

    this.prompts.set(plantId, prompt);
    this.updatePromptPosition(prompt);

    // Animate in
    requestAnimationFrame(() => {
      element.classList.add("water-prompt-visible");
    });
  }

  /**
   * Hide a water prompt
   */
  public hidePrompt(plantId: string): void {
    const prompt = this.prompts.get(plantId);
    if (!prompt) return;

    prompt.element.classList.remove("water-prompt-visible");
    prompt.element.classList.add("water-prompt-hiding");

    setTimeout(() => {
      prompt.element.remove();
      this.prompts.delete(plantId);
    }, 300);
  }

  private onPromptClick(plantId: string): void {
    const plantSystem = PlantSystem.getInstance();
    const promptStatus = plantSystem.getWaterPromptStatus(plantId);
    
    if (promptStatus?.isActive) {
      // Respond to the water prompt (gives bonus)
      const success = plantSystem.respondToWaterPrompt(plantId);
      if (success) {
        this.showWaterEffect(plantId);
        EventBus.emit("ui:water_prompt_responded", { plantId });
      }
    } else {
      // Regular watering
      plantSystem.waterPlant(plantId);
      this.showWaterEffect(plantId);
    }

    this.hidePrompt(plantId);
  }

  private showWaterEffect(plantId: string): void {
    const prompt = this.prompts.get(plantId);
    if (!prompt) return;

    // Create splash effect
    const splash = document.createElement("div");
    splash.className = "water-splash";
    splash.innerHTML = "💦";
    splash.style.left = prompt.element.style.left;
    splash.style.top = prompt.element.style.top;
    this.container?.appendChild(splash);

    setTimeout(() => splash.remove(), 600);
  }

  private startUpdateLoop(): void {
    GameTimer.getInstance().scheduleTask(this.updateTaskId, 100, () => {
      this.update();
    });
  }

  private update(): void {
    const currentTime = GameTimer.getInstance().getGameTime();

    for (const [plantId, prompt] of this.prompts) {
      // Update position
      this.updatePromptPosition(prompt);

      // Update timer display
      const timeLeft = Math.max(0, prompt.expiresAt - currentTime);
      const timerEl = prompt.element.querySelector(".water-prompt-timer");
      if (timerEl) {
        const seconds = Math.ceil(timeLeft / 1000);
        timerEl.textContent = seconds > 0 ? `${seconds}s` : "";
      }

      // Check expiration
      if (timeLeft <= 0) {
        this.hidePrompt(plantId);
      }

      // Pulse faster as time runs out
      if (timeLeft < 5000) {
        prompt.element.classList.add("water-prompt-urgent");
      }
    }

    // Also check for new prompts from PlantSystem
    this.checkForNewPrompts();
  }

  private checkForNewPrompts(): void {
    const plants = GameState.getInstance().getPlants();
    const plantSystem = PlantSystem.getInstance();

    for (const plant of plants) {
      if (this.prompts.has(plant.id)) continue;

      const promptStatus = plantSystem.getWaterPromptStatus(plant.id);
      if (promptStatus?.isActive && promptStatus.timeRemaining > 0) {
        this.showPrompt(plant.id, promptStatus.timeRemaining);
      }
    }
  }

  private updatePromptPosition(prompt: ActivePrompt): void {
    if (!this.getScreenPosition) return;

    // Position above the plant
    const worldPos = {
      x: prompt.position.x,
      y: prompt.position.y + 80, // Above the plant
      z: prompt.position.z,
    };

    const screenPos = this.getScreenPosition(worldPos);
    if (screenPos) {
      prompt.element.style.left = `${screenPos.x}px`;
      prompt.element.style.top = `${screenPos.y}px`;
      prompt.element.style.display = "flex";
    } else {
      prompt.element.style.display = "none";
    }
  }

  /**
   * Manually trigger checking all plants for water prompts
   */
  public refreshPrompts(): void {
    this.checkForNewPrompts();
  }

  public dispose(): void {
    GameTimer.getInstance().cancelTask(this.updateTaskId);
    this.container?.remove();
    this.prompts.clear();
  }

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      #water-prompt-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
      }

      .water-prompt {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .water-prompt-visible {
        opacity: 1;
      }

      .water-prompt-hiding {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.5);
      }

      .water-prompt-icon {
        font-size: 36px;
        filter: drop-shadow(0 2px 8px rgba(74, 144, 226, 0.6));
        animation: water-bounce 1s ease-in-out infinite;
      }

      .water-prompt-urgent .water-prompt-icon {
        animation: water-bounce 0.3s ease-in-out infinite;
        filter: drop-shadow(0 2px 12px rgba(255, 100, 100, 0.8));
      }

      .water-prompt-timer {
        font-size: 12px;
        font-weight: 600;
        color: #fff;
        background: rgba(0, 0, 0, 0.6);
        padding: 2px 8px;
        border-radius: 10px;
        min-width: 30px;
        text-align: center;
      }

      .water-prompt-urgent .water-prompt-timer {
        background: rgba(255, 50, 50, 0.8);
      }

      .water-prompt:hover .water-prompt-icon {
        transform: scale(1.2);
      }

      @keyframes water-bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
      }

      .water-splash {
        position: absolute;
        transform: translate(-50%, -50%);
        font-size: 48px;
        pointer-events: none;
        animation: splash 0.6s ease-out forwards;
      }

      @keyframes splash {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(0.5);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -100%) scale(1.5);
        }
      }
    `;
    document.head.appendChild(style);
  }
}
