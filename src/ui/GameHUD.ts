/**
 * GameHUD - In-game heads-up display
 * Shows player resources, quick inventory, and notifications
 */

import { BuildableObjectManager } from "../game/BuildableObject";
import { GameState } from "../game/GameState";
import { GameTimer } from "../game/GameTimer";
import { PlantSystem } from "../game/PlantSystem";
import { ShopPanel } from "./ShopPanel";

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
          <button class="hud-btn" id="hud-shop-btn">🛒 Shop</button>
        </div>
        <div class="hud-time">
          <span id="hud-game-time">0:00</span>
          <span id="hud-time-scale" class="hud-time-scale">1x</span>
        </div>
      </div>

      <div class="hud-quick-inventory" id="hud-inventory">
        <!-- Populated dynamically -->
      </div>

      <div class="hud-notifications" id="hud-notifications">
        <!-- Notifications appear here -->
      </div>

      <div class="hud-plant-info" id="hud-plant-info" style="display: none;">
        <div class="plant-info-header">
          <span class="plant-name">Plant Name</span>
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
          <div class="plant-actions">
            <button class="plant-action-btn" id="btn-water">💧 Water</button>
            <button class="plant-action-btn" id="btn-harvest" disabled>🌿 Harvest</button>
          </div>
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

      .hud-time {
        display: flex;
        align-items: center;
        gap: 10px;
        color: white;
        font-size: 14px;
        background: rgba(0,0,0,0.5);
        padding: 8px 15px;
        border-radius: 20px;
      }

      .hud-time-scale {
        background: rgba(255,255,255,0.2);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 12px;
      }

      .hud-quick-inventory {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 5px;
        background: rgba(0,0,0,0.6);
        padding: 10px;
        border-radius: 10px;
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

      .hud-notifications {
        position: fixed;
        top: 80px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 300px;
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
    const timer = GameTimer.getInstance();
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

    // Update time
    const timeEl = this.container.querySelector("#hud-game-time");
    if (timeEl) {
      timeEl.textContent = timer.formatTime();
    }

    const scaleEl = this.container.querySelector("#hud-time-scale");
    if (scaleEl) {
      scaleEl.textContent = `${timer.getTimeScale()}x`;
    }

    // Update quick inventory
    this.updateInventory(inventory.items);
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

  private setupEventListeners(): void {
    // Listen for plant events
    PlantSystem.getInstance().onPlantEvent((_plantId, event, data) => {
      switch (event) {
        case "planted":
          this.showNotification(`Planted a new seed!`, "success");
          break;
        case "watered":
          this.showNotification(`Plant watered!`, "success");
          break;
        case "harvested":
          const harvestData = data as { yield: number; xp: number };
          this.showNotification(`Harvested ${harvestData.yield} buds! +${harvestData.xp} XP`, "success");
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

    // Shop button
    this.container?.querySelector("#hud-shop-btn")?.addEventListener("click", () => {
      ShopPanel.getInstance().toggle();
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

  public showPlantInfo(plantId: string): void {
    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;

    const strain = PlantSystem.getInstance().getStrain(plant.strain);
    if (!strain) return;

    const panel = this.container?.querySelector("#hud-plant-info") as HTMLElement;
    if (!panel) return;

    panel.style.display = "block";
    panel.dataset.plantId = plantId;

    // Update name
    const nameEl = panel.querySelector(".plant-name");
    if (nameEl) nameEl.textContent = strain.name;

    // Update bars
    const visual = PlantSystem.getInstance().getVisualState(plantId);
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

    // Setup button handlers
    const waterBtn = panel.querySelector("#btn-water");
    const harvestBtn = panel.querySelector("#btn-harvest");
    const closeBtn = panel.querySelector(".plant-info-close");

    waterBtn?.addEventListener("click", () => {
      PlantSystem.getInstance().waterPlant(plantId);
      this.showPlantInfo(plantId); // Refresh
    });

    harvestBtn?.addEventListener("click", () => {
      PlantSystem.getInstance().harvestPlant(plantId);
      this.hidePlantInfo();
    });

    closeBtn?.addEventListener("click", () => {
      this.hidePlantInfo();
    });
  }

  public hidePlantInfo(): void {
    const panel = this.container?.querySelector("#hud-plant-info") as HTMLElement;
    if (panel) {
      panel.style.display = "none";
    }
  }
}
