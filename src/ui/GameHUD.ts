/**
 * GameHUD - In-game heads-up display
 * Shows player resources, quick inventory, and notifications
 */

import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { BuildableObjectManager } from "../game/BuildableObject";
import { GameClock } from "../game/GameClock";
import { GameState } from "../game/GameState";
import { GameTimer } from "../game/GameTimer";
import { HarvestIndicator } from "../game/HarvestIndicator";
import { PlantSystem } from "../game/PlantSystem";

const SELECTION_INDICATOR_ID = "plant_selection";

export class GameHUD {
  private static instance: GameHUD;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;
  private updateInterval: string = "hud_update";

  private constructor() {}

  public static getInstance(): GameHUD {
    if (!GameHUD.instance) {
      GameHUD.instance = new GameHUD();
    }
    return GameHUD.instance;
  }

  public show(): void {
    if (this.isVisible) return;

    this.createHUD();
    this.startUpdates();
    this.setupEventListeners();
    this.isVisible = true;
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.container?.remove();
    this.container = null;
    GameTimer.getInstance().cancelTask(this.updateInterval);
    this.isVisible = false;
  }

  private createHUD(): void {
    this.container = document.createElement("div");
    this.container.id = "game-hud";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

    // Add styles
    const style = document.createElement("style");
    style.textContent = this.getStyles();
    this.container.appendChild(style);

    this.update();
  }

  private getHTML(): string {
    return `
      <div class="hud-top-bar">
        <div class="hud-resources">
          <div class="hud-resource" id="hud-money">
            <span class="hud-icon">💰</span>
            <span class="hud-value">0</span>
          </div>
          <div class="hud-resource" id="hud-level">
            <span class="hud-icon">⭐</span>
            <span class="hud-value">Lv.1</span>
            <div class="hud-xp-bar">
              <div class="hud-xp-fill"></div>
            </div>
          </div>
        </div>
        <div class="hud-buttons">
          <button class="hud-btn hud-harvest-btn" id="hud-harvest-btn" style="display: none;">
            <span class="harvest-icon">✂️</span>
            <span class="harvest-count">0</span>
            <span class="harvest-text">Ready</span>
          </button>
        </div>
        <div class="hud-time">
          <span id="hud-day" class="hud-day">Day 1</span>
          <span id="hud-clock" class="hud-clock">8:00 AM</span>
          <span id="hud-period" class="hud-period">☀️</span>
        </div>
      </div>

      <div class="hud-quick-inventory" id="hud-inventory">
        <!-- Populated dynamically -->
      </div>

      <div class="hud-game-message" id="hud-game-message" style="display: none;">
        <span class="game-message-text"></span>
      </div>

      <div class="hud-notifications" id="hud-notifications">
        <!-- Notifications appear here -->
      </div>

      <div class="hud-plant-info" id="hud-plant-info" style="display: none;">
        <div class="plant-info-header">
          <span class="plant-name">Plant Name</span>
          <span class="plant-mastery">☆☆☆☆☆</span>
          <button class="plant-info-close">×</button>
        </div>
        <div class="plant-info-body">
          <div class="plant-stat">
            <span>Growth:</span>
            <div class="plant-bar"><div class="plant-bar-fill growth-bar"></div></div>
          </div>
          <div class="plant-stat">
            <span>Water:</span>
            <div class="plant-bar"><div class="plant-bar-fill water-bar"></div></div>
          </div>
          <div class="plant-stat">
            <span>Health:</span>
            <div class="plant-bar"><div class="plant-bar-fill health-bar"></div></div>
          </div>
          <div class="plant-stat plant-pot-info">
            <span>Pot:</span>
            <span class="pot-name">Basic Pot</span>
          </div>
          <div class="plant-actions">
            <button class="plant-action-btn" id="btn-water">💧 Water</button>
            <button class="plant-action-btn" id="btn-fertilize">🧪 Fertilize</button>
            <button class="plant-action-btn" id="btn-harvest" disabled>🌿 Harvest</button>
          </div>
        </div>
      </div>

      <div class="hud-water-prompt" id="hud-water-prompt" style="display: none;">
        <div class="water-prompt-content">
          <div class="water-prompt-icon">💧</div>
          <div class="water-prompt-text">TAP TO WATER!</div>
          <div class="water-prompt-timer">
            <div class="water-prompt-bar"></div>
          </div>
          <div class="water-prompt-streak">Streak: <span>0</span></div>
        </div>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      #game-hud {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        z-index: 100;
      }

      #game-hud * {
        pointer-events: auto;
      }

      .hud-top-bar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 15px 20px;
        background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%);
      }

      .hud-resources {
        display: flex;
        gap: 20px;
      }

      .hud-resource {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(0,0,0,0.5);
        padding: 8px 15px;
        border-radius: 20px;
        color: white;
        font-size: 16px;
        font-weight: bold;
      }

      .hud-icon {
        font-size: 20px;
      }

      .hud-xp-bar {
        width: 60px;
        height: 6px;
        background: rgba(255,255,255,0.2);
        border-radius: 3px;
        overflow: hidden;
        margin-left: 5px;
      }

      .hud-xp-fill {
        height: 100%;
        background: linear-gradient(90deg, #ffd700, #ffaa00);
        transition: width 0.3s ease;
      }

      .hud-buttons {
        display: flex;
        gap: 10px;
      }

      .hud-btn {
        background: linear-gradient(135deg, #4CAF50, #45a049);
        border: none;
        color: white;
        padding: 8px 15px;
        border-radius: 20px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        transition: all 0.2s;
      }

      .hud-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 10px rgba(76, 175, 80, 0.4);
      }

      .hud-harvest-btn {
        background: linear-gradient(135deg, #8BC34A, #689F38);
        animation: harvestPulse 1.5s ease-in-out infinite;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .hud-harvest-btn:hover {
        box-shadow: 0 2px 15px rgba(139, 195, 74, 0.6);
      }

      .hud-harvest-btn .harvest-count {
        background: rgba(255,255,255,0.3);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 12px;
      }

      .hud-harvest-btn.overripe {
        background: linear-gradient(135deg, #FFC107, #FF9800);
        animation: harvestPulse 0.8s ease-in-out infinite;
      }

      .hud-harvest-btn.spoiled {
        background: linear-gradient(135deg, #f44336, #d32f2f);
        animation: harvestPulse 0.5s ease-in-out infinite;
      }

      @keyframes harvestPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }

      .hud-time {
        display: flex;
        align-items: center;
        gap: 8px;
        color: white;
        font-size: 14px;
        background: rgba(0,0,0,0.5);
        padding: 8px 15px;
        border-radius: 20px;
      }

      .hud-day {
        font-weight: bold;
        color: #ffd700;
      }

      .hud-clock {
        font-family: 'Courier New', monospace;
        font-weight: bold;
      }

      .hud-period {
        font-size: 18px;
      }

      .hud-quick-inventory {
        /* Hidden - inventory is now in BottomBar */
        display: none;
      }

      .hud-inv-slot {
        width: 50px;
        height: 50px;
        background: rgba(255,255,255,0.1);
        border: 2px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }

      .hud-inv-slot:hover {
        background: rgba(255,255,255,0.2);
        border-color: rgba(255,255,255,0.4);
      }

      .hud-inv-slot .slot-icon {
        font-size: 24px;
      }

      .hud-inv-slot .slot-count {
        font-size: 11px;
        color: white;
        font-weight: bold;
      }

      .hud-game-message {
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 12px 24px;
        border-radius: 25px;
        font-size: 16px;
        font-weight: bold;
        border: 2px solid rgba(76, 175, 80, 0.5);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        z-index: 150;
        animation: messagePopIn 0.3s ease;
      }

      .hud-game-message .game-message-text {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      @keyframes messagePopIn {
        from { transform: translateX(-50%) scale(0.8); opacity: 0; }
        to { transform: translateX(-50%) scale(1); opacity: 1; }
      }

      .hud-notifications {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
        z-index: 140;
      }

      .hud-notification {
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        border-left: 4px solid #4CAF50;
        animation: slideIn 0.3s ease, fadeOut 0.5s ease 2.5s forwards;
      }

      .hud-notification.warning {
        border-left-color: #ff9800;
      }

      .hud-notification.error {
        border-left-color: #f44336;
      }

      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }

      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      .hud-plant-info {
        position: fixed;
        bottom: 100px;
        left: 20px;
        width: 250px;
        background: rgba(0,0,0,0.85);
        border-radius: 10px;
        color: white;
        overflow: hidden;
      }

      .plant-info-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
        background: rgba(76, 175, 80, 0.3);
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .plant-name {
        font-weight: bold;
        font-size: 16px;
      }

      .plant-info-close {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.7;
      }

      .plant-info-close:hover {
        opacity: 1;
      }

      .plant-info-body {
        padding: 15px;
      }

      .plant-stat {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
        font-size: 14px;
      }

      .plant-stat span {
        width: 60px;
      }

      .plant-bar {
        flex: 1;
        height: 8px;
        background: rgba(255,255,255,0.2);
        border-radius: 4px;
        overflow: hidden;
      }

      .plant-bar-fill {
        height: 100%;
        transition: width 0.3s ease;
      }

      .growth-bar {
        background: linear-gradient(90deg, #4CAF50, #8BC34A);
      }

      .water-bar {
        background: linear-gradient(90deg, #2196F3, #03A9F4);
      }

      .health-bar {
        background: linear-gradient(90deg, #f44336, #E91E63);
      }

      .plant-actions {
        display: flex;
        gap: 10px;
        margin-top: 15px;
      }

      .plant-action-btn {
        flex: 1;
        padding: 8px;
        border: none;
        border-radius: 5px;
        background: rgba(255,255,255,0.1);
        color: white;
        cursor: pointer;
        transition: background 0.2s;
      }

      .plant-action-btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.2);
      }

      .plant-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Mastery stars */
      .plant-mastery {
        font-size: 14px;
        color: #ffd700;
        letter-spacing: 2px;
      }

      /* Pot info */
      .pot-name {
        flex: 1;
        color: #aaa;
      }

      /* Water prompt overlay */
      .hud-water-prompt {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 200;
        animation: waterPromptPulse 0.5s ease-in-out infinite;
      }

      .water-prompt-content {
        background: linear-gradient(135deg, rgba(33, 150, 243, 0.95), rgba(3, 169, 244, 0.95));
        padding: 30px 50px;
        border-radius: 20px;
        text-align: center;
        color: white;
        box-shadow: 0 10px 40px rgba(33, 150, 243, 0.5);
        cursor: pointer;
      }

      .water-prompt-icon {
        font-size: 60px;
        margin-bottom: 10px;
        animation: waterDrop 1s ease-in-out infinite;
      }

      .water-prompt-text {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 15px;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }

      .water-prompt-timer {
        width: 200px;
        height: 8px;
        background: rgba(255,255,255,0.3);
        border-radius: 4px;
        overflow: hidden;
        margin: 0 auto 10px;
      }

      .water-prompt-bar {
        height: 100%;
        background: white;
        transition: width 0.1s linear;
        width: 100%;
      }

      .water-prompt-streak {
        font-size: 14px;
        opacity: 0.9;
      }

      .water-prompt-streak span {
        font-weight: bold;
        color: #ffd700;
      }

      @keyframes waterPromptPulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); }
        50% { transform: translate(-50%, -50%) scale(1.02); }
      }

      @keyframes waterDrop {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }

      /* Fertilize button special style */
      #btn-fertilize {
        background: linear-gradient(135deg, #9C27B0, #7B1FA2);
      }

      #btn-fertilize:hover:not(:disabled) {
        background: linear-gradient(135deg, #AB47BC, #8E24AA);
      }
    `;
  }

  private startUpdates(): void {
    // Update HUD every 500ms
    GameTimer.getInstance().scheduleTask(this.updateInterval, 500, () => {
      this.update();
    });
  }

  private update(): void {
    if (!this.container) return;

    const state = GameState.getInstance();
    const player = state.getPlayer();
    const inventory = state.getInventory();

    // Update money
    const moneyEl = this.container.querySelector("#hud-money .hud-value");
    if (moneyEl) {
      moneyEl.textContent = `$${player.money.toLocaleString()}`;
    }

    // Update level and XP
    const levelEl = this.container.querySelector("#hud-level .hud-value");
    if (levelEl) {
      levelEl.textContent = `Lv.${player.level}`;
    }

    const xpFill = this.container.querySelector(".hud-xp-fill") as HTMLElement;
    if (xpFill) {
      xpFill.style.width = `${state.getXPProgress() * 100}%`;
    }

    // Update day/night clock
    const clock = GameClock.getInstance();
    const timeOfDay = clock.getTimeOfDay();
    
    const dayEl = this.container.querySelector("#hud-day");
    if (dayEl) {
      dayEl.textContent = `Day ${clock.getCurrentDay()}`;
    }

    const clockEl = this.container.querySelector("#hud-clock");
    if (clockEl) {
      clockEl.textContent = clock.formatTime12h();
    }

    const periodEl = this.container.querySelector("#hud-period");
    if (periodEl) {
      // Show appropriate icon for time period
      const icons: Record<string, string> = {
        night: "🌙",
        dawn: "🌅",
        morning: "☀️",
        afternoon: "☀️",
        dusk: "🌇",
        evening: "🌙",
      };
      periodEl.textContent = icons[timeOfDay.period] || "☀️";
    }

    // Update quick inventory
    this.updateInventory(inventory.items);

    // Update harvest button
    this.updateHarvestButton();
  }

  private updateHarvestButton(): void {
    const harvestBtn = this.container?.querySelector("#hud-harvest-btn") as HTMLElement;
    if (!harvestBtn) return;

    const harvestIndicator = HarvestIndicator.getInstance();
    const harvestables = harvestIndicator.getHarvestablePlants();
    const count = harvestables.length;

    if (count === 0) {
      harvestBtn.style.display = "none";
      return;
    }

    harvestBtn.style.display = "flex";

    // Update count
    const countEl = harvestBtn.querySelector(".harvest-count");
    if (countEl) {
      countEl.textContent = count.toString();
    }

    // Check for urgency (overripe or spoiled plants)
    const hasOverripe = harvestables.some(h => h.phase === "overripe");
    const hasSpoiled = harvestables.some(h => h.phase === "spoiled");

    harvestBtn.classList.remove("overripe", "spoiled");
    if (hasSpoiled) {
      harvestBtn.classList.add("spoiled");
    } else if (hasOverripe) {
      harvestBtn.classList.add("overripe");
    }
  }

  private updateInventory(items: { id: string; type: string; quantity: number }[]): void {
    const container = this.container?.querySelector("#hud-inventory");
    if (!container) return;

    // Show first 8 items
    const displayItems = items.slice(0, 8);
    
    container.innerHTML = displayItems.map(item => `
      <div class="hud-inv-slot" data-item="${item.id}">
        <span class="slot-icon">${this.getItemIcon(item.id)}</span>
        <span class="slot-count">${item.quantity}</span>
      </div>
    `).join("");

    // Add empty slots
    for (let i = displayItems.length; i < 8; i++) {
      container.innerHTML += `<div class="hud-inv-slot"></div>`;
    }
  }

  private getItemIcon(itemId: string): string {
    const icons: Record<string, string> = {
      seed_basic: "🌱",
      seed_og_kush: "🌱",
      seed_purple_haze: "🌱",
      harvest_basic: "🌿",
      harvest_og_kush: "🌿",
      harvest_purple_haze: "🌿",
      water: "💧",
      fertilizer: "🧪",
    };
    return icons[itemId] || "📦";
  }

  private plantInfoOpenedAt: number = 0;

  private setupEventListeners(): void {
    // Click outside plant info panel to close it
    document.addEventListener("click", (e) => {
      const panel = this.container?.querySelector("#hud-plant-info") as HTMLElement;
      if (!panel || panel.style.display === "none") return;
      
      // Don't close if panel was just opened (within 300ms)
      if (Date.now() - this.plantInfoOpenedAt < 300) return;
      
      // Check if click is outside the panel
      const target = e.target as HTMLElement;
      const isInsidePanel = panel.contains(target);
      const isOnIndicator = target.closest(".world-indicator");
      const isOnCanvas = target.tagName === "CANVAS";
      
      // Close if clicking on canvas (game area) or elsewhere outside panel
      if (!isInsidePanel && !isOnIndicator && isOnCanvas) {
        this.hidePlantInfo();
      }
    });

    // Listen for plant events
    PlantSystem.getInstance().onPlantEvent((plantId, event, data) => {
      switch (event) {
        case "planted":
          this.showNotification(`Planted a new seed!`, "success");
          break;
        case "watered":
          this.showNotification(`Plant watered!`, "success");
          break;
        case "harvested":
          const harvestData = data as { yield: number; xp: number; isPerfect?: boolean };
          if (harvestData.isPerfect) {
            this.showNotification(`🌟 Perfect harvest! ${harvestData.yield} buds! +${harvestData.xp} XP`, "success");
          } else {
            this.showNotification(`Harvested ${harvestData.yield} buds! +${harvestData.xp} XP`, "success");
          }
          break;
        case "needs_water":
          this.showNotification(`A plant needs water!`, "warning");
          break;
        case "died":
          this.showNotification(`A plant has died!`, "error");
          break;
        case "stage_change":
          const stageData = data as { isHarvestable: boolean };
          if (stageData.isHarvestable) {
            this.showNotification(`A plant is ready to harvest!`, "success");
          }
          break;
        // Hempire-style water prompt events
        case "water_prompt_start":
          const promptData = data as { timeRemaining: number; streak: number };
          this.showWaterPrompt(plantId, promptData.timeRemaining, promptData.streak);
          break;
        case "water_prompt_missed":
          this.hideWaterPrompt();
          const missedData = data as { totalMissed: number };
          this.showNotification(`Missed water prompt! (${missedData.totalMissed} missed)`, "warning");
          break;
        // Mastery level up
        case "mastery_levelup":
          const masteryData = data as { strainId: string; newLevel: number };
          const strain = PlantSystem.getInstance().getStrain(masteryData.strainId);
          this.showNotification(`🌟 ${strain?.name ?? "Strain"} mastery level ${masteryData.newLevel}!`, "success");
          break;
        // Fertilizer applied
        case "fertilized":
          this.showNotification(`🧪 Plant fertilized! 25% faster growth!`, "success");
          break;
      }
    });

    // Listen for level up
    GameState.getInstance().on("levelup", (state) => {
      this.showNotification(`Level up! Now level ${state.player.level}!`, "success");
    });

    // Listen for buildable object events
    BuildableObjectManager.getInstance().onObjectEvent((_objectId, event, data) => {
      switch (event) {
        case "created":
          const createData = data as { template: { name: string } };
          this.showNotification(`Building ${createData.template.name}...`, "success");
          break;
        case "stage_changed":
          const stageData = data as { newStage: number; progress: number };
          if (stageData.newStage === 1) {
            this.showNotification(`Construction 50% complete!`, "success");
          }
          break;
        case "completed":
          const completeData = data as { template: { name: string } };
          this.showNotification(`${completeData.template.name} is ready!`, "success");
          break;
      }
    });

    // Harvest button - show first harvestable plant's panel
    this.container?.querySelector("#hud-harvest-btn")?.addEventListener("click", () => {
      const harvestIndicator = HarvestIndicator.getInstance();
      const harvestables = harvestIndicator.getHarvestablePlants();
      if (harvestables.length > 0) {
        // Show panel for first harvestable (prioritize overripe/spoiled)
        const urgent = harvestables.find(h => h.phase === "spoiled" || h.phase === "overripe");
        const target = urgent || harvestables[0];
        harvestIndicator.showHarvestPanel(target.plantId);
      }
    });
  }

  public showNotification(message: string, type: "success" | "warning" | "error" = "success"): void {
    const container = this.container?.querySelector("#hud-notifications");
    if (!container) return;

    const notification = document.createElement("div");
    notification.className = `hud-notification ${type}`;
    notification.textContent = message;
    container.appendChild(notification);

    // Remove after animation
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  /**
   * Show a prominent game message at the top center of the screen
   * Use for important action prompts like "Select strain to grow"
   */
  public showGameMessage(message: string, icon: string = "🌱"): void {
    const messageEl = this.container?.querySelector("#hud-game-message") as HTMLElement;
    const textEl = messageEl?.querySelector(".game-message-text");
    if (!messageEl || !textEl) return;

    textEl.innerHTML = `<span>${icon}</span> ${message}`;
    messageEl.style.display = "block";
  }

  /**
   * Hide the game message
   */
  public hideGameMessage(): void {
    const messageEl = this.container?.querySelector("#hud-game-message") as HTMLElement;
    if (messageEl) {
      messageEl.style.display = "none";
    }
  }

  public showPlantInfo(plantId: string): void {
    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;

    const plantSystem = PlantSystem.getInstance();
    const strain = plantSystem.getStrain(plant.strain);
    if (!strain) return;

    const panel = this.container?.querySelector("#hud-plant-info") as HTMLElement;
    if (!panel) return;

    panel.style.display = "block";
    panel.dataset.plantId = plantId;
    this.plantInfoOpenedAt = Date.now();

    // Show selection indicator above the plant (pulsing ring)
    this.showSelectionIndicator(plant.position);

    // Update name
    const nameEl = panel.querySelector(".plant-name");
    if (nameEl) nameEl.textContent = strain.name;

    // Update mastery stars
    const mastery = plantSystem.getMastery(plant.strain);
    const masteryEl = panel.querySelector(".plant-mastery");
    if (masteryEl) {
      const filled = "★".repeat(mastery.level);
      const empty = "☆".repeat(5 - mastery.level);
      masteryEl.textContent = filled + empty;
    }

    // Update bars
    const visual = plantSystem.getVisualState(plantId);
    if (visual) {
      const growthBar = panel.querySelector(".growth-bar") as HTMLElement;
      const waterBar = panel.querySelector(".water-bar") as HTMLElement;
      const healthBar = panel.querySelector(".health-bar") as HTMLElement;

      const totalProgress = ((plant.growthStage / strain.stages) + (visual.progress / 100 / strain.stages)) * 100;
      if (growthBar) growthBar.style.width = `${totalProgress}%`;
      if (waterBar) waterBar.style.width = `${plant.waterLevel}%`;
      if (healthBar) healthBar.style.width = `${plant.health}%`;

      // Update buttons
      const harvestBtn = panel.querySelector("#btn-harvest") as HTMLButtonElement;
      if (harvestBtn) {
        harvestBtn.disabled = !visual.isHarvestable;
      }
    }

    // Update pot info
    const potNameEl = panel.querySelector(".pot-name");
    const pot = plantSystem.getPot(plant.potType);
    if (potNameEl && pot) {
      const speedText = pot.growthSpeedMultiplier < 1 
        ? ` (${Math.round((1 - pot.growthSpeedMultiplier) * 100)}% faster)`
        : "";
      potNameEl.textContent = pot.name + speedText;
    }

    // Update fertilize button
    const fertilizeBtn = panel.querySelector("#btn-fertilize") as HTMLButtonElement;
    if (fertilizeBtn) {
      const hasFertilizer = GameState.getInstance().getItemCount("fertilizer") > 0;
      fertilizeBtn.disabled = plant.fertilized || !hasFertilizer;
      if (plant.fertilized) {
        fertilizeBtn.textContent = "✓ Fertilized";
      } else {
        fertilizeBtn.textContent = "🧪 Fertilize";
      }
    }

    // Setup button handlers (remove old listeners first)
    const waterBtn = panel.querySelector("#btn-water");
    const harvestBtn = panel.querySelector("#btn-harvest");
    const closeBtn = panel.querySelector(".plant-info-close");

    // Clone and replace to remove old event listeners
    const newWaterBtn = waterBtn?.cloneNode(true);
    const newHarvestBtn = harvestBtn?.cloneNode(true);
    const newFertilizeBtn = fertilizeBtn?.cloneNode(true);
    const newCloseBtn = closeBtn?.cloneNode(true);

    if (waterBtn && newWaterBtn) waterBtn.replaceWith(newWaterBtn);
    if (harvestBtn && newHarvestBtn) harvestBtn.replaceWith(newHarvestBtn);
    if (fertilizeBtn && newFertilizeBtn) fertilizeBtn.replaceWith(newFertilizeBtn);
    if (closeBtn && newCloseBtn) closeBtn.replaceWith(newCloseBtn);

    // Add new event listeners
    panel.querySelector("#btn-water")?.addEventListener("click", () => {
      plantSystem.waterPlant(plantId);
      this.showPlantInfo(plantId); // Refresh
    });

    panel.querySelector("#btn-harvest")?.addEventListener("click", () => {
      plantSystem.harvestPlant(plantId);
      this.hidePlantInfo();
    });

    panel.querySelector("#btn-fertilize")?.addEventListener("click", () => {
      if (plantSystem.applyFertilizer(plantId)) {
        this.showNotification("Plant fertilized! 25% faster growth!", "success");
        this.showPlantInfo(plantId); // Refresh
      }
    });

    panel.querySelector(".plant-info-close")?.addEventListener("click", () => {
      this.hidePlantInfo();
    });
  }

  public hidePlantInfo(): void {
    const panel = this.container?.querySelector("#hud-plant-info") as HTMLElement;
    if (panel) {
      panel.style.display = "none";
    }
    // Remove selection indicator
    this.hideSelectionIndicator();
  }

  // ==================== Selection Indicator ====================

  private showSelectionIndicator(position: { x: number; y: number; z: number }): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    if (!worldIndicator.isInitialized()) return;

    // Remove existing selection indicator
    worldIndicator.removeIndicator(SELECTION_INDICATOR_ID);

    // Add pulsing selection indicator
    worldIndicator.addIndicator({
      id: SELECTION_INDICATOR_ID,
      worldPosition: position,
      config: {
        icon: "🔘",
        animation: "pulse",
        offsetY: 30,
        className: "selection-indicator",
      },
    });
  }

  private hideSelectionIndicator(): void {
    WorldIndicatorSystem.getInstance().removeIndicator(SELECTION_INDICATOR_ID);
  }

  // ==================== Water Prompt UI ====================

  private activeWaterPromptPlantId: string | null = null;
  private waterPromptUpdateInterval: number | null = null;

  public showWaterPrompt(plantId: string, timeRemaining: number, streak: number): void {
    const prompt = this.container?.querySelector("#hud-water-prompt") as HTMLElement;
    if (!prompt) return;

    this.activeWaterPromptPlantId = plantId;
    prompt.style.display = "block";

    // Update streak display
    const streakEl = prompt.querySelector(".water-prompt-streak span");
    if (streakEl) streakEl.textContent = streak.toString();

    // Get strain info for prompt window duration
    const plant = GameState.getInstance().getPlant(plantId);
    const strain = plant ? PlantSystem.getInstance().getStrain(plant.strain) : null;
    const promptWindow = strain?.waterPromptWindow ?? 30000;

    // Start timer bar animation
    const bar = prompt.querySelector(".water-prompt-bar") as HTMLElement;
    if (bar) {
      bar.style.width = `${(timeRemaining / promptWindow) * 100}%`;
    }

    // Update timer bar every 100ms
    if (this.waterPromptUpdateInterval) {
      clearInterval(this.waterPromptUpdateInterval);
    }

    const startTime = Date.now();
    const endTime = startTime + timeRemaining;

    this.waterPromptUpdateInterval = window.setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      const percent = (remaining / promptWindow) * 100;

      if (bar) bar.style.width = `${percent}%`;

      if (remaining <= 0) {
        this.hideWaterPrompt();
      }
    }, 100);

    // Setup click handler
    const content = prompt.querySelector(".water-prompt-content");
    const newContent = content?.cloneNode(true);
    if (content && newContent) {
      content.replaceWith(newContent);
      this.container?.querySelector(".water-prompt-content")?.addEventListener("click", () => {
        this.onWaterPromptClick();
      });
    }
  }

  private onWaterPromptClick(): void {
    if (!this.activeWaterPromptPlantId) return;

    const plantSystem = PlantSystem.getInstance();
    const success = plantSystem.respondToWaterPrompt(this.activeWaterPromptPlantId);

    if (success) {
      const plant = GameState.getInstance().getPlant(this.activeWaterPromptPlantId);
      this.showNotification(`Perfect water! Streak: ${plant?.wateringStreak ?? 0}`, "success");
    }

    this.hideWaterPrompt();
  }

  public hideWaterPrompt(): void {
    const prompt = this.container?.querySelector("#hud-water-prompt") as HTMLElement;
    if (prompt) {
      prompt.style.display = "none";
    }

    this.activeWaterPromptPlantId = null;

    if (this.waterPromptUpdateInterval) {
      clearInterval(this.waterPromptUpdateInterval);
      this.waterPromptUpdateInterval = null;
    }
  }
}
