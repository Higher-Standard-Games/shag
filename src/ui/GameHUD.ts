/**
 * GameHUD - In-game heads-up display
 * Shows player resources, quick inventory, and notifications
 */

import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { BuildableObjectManager } from "../game/BuildableObject";
import { GameClock } from "../game/GameClock";
import { GameState } from "../game/GameState";
import { GameTimer, type GameSpeedMode } from "../game/GameTimer";
import { PlantSystem } from "../game/PlantSystem";
import { UIStyles } from "../engine/ui/UIStyles";
import gameHUDCSS from "./styles/GameHUD.css?raw";

const SELECTION_INDICATOR_ID = "plant_selection";

export class GameHUD {
  private static instance: GameHUD;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;
  private updateInterval: string = "hud_update";

  // Game Award notification queue
  private awardQueue: { icon: string; text: string }[] = [];
  private currentAward: HTMLElement | null = null;
  private isShowingAward: boolean = false;

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
    // Inject styles once
    UIStyles.injectCSS("game-hud", gameHUDCSS);

    this.container = document.createElement("div");
    this.container.id = "game-hud";
    this.container.innerHTML = this.getHTML();
    document.body.appendChild(this.container);

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
          <!-- Harvest button removed - using Events panel instead -->
        </div>
        <div class="hud-time">
          <span id="hud-day" class="hud-day">Day 1</span>
          <span id="hud-clock" class="hud-clock">8:00 AM</span>
          <span id="hud-period" class="hud-period">☀️</span>
          <button id="hud-speed-btn" class="hud-speed-btn" title="Toggle game speed">
            <span class="speed-icon">▶</span>
          </button>
          <button id="hud-fullscreen-btn" class="hud-fullscreen-btn" title="Toggle fullscreen">
            <span class="fullscreen-icon">⛶</span>
          </button>
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
  }

  private updateSpeedButton(mode?: GameSpeedMode): void {
    const speedBtn = this.container?.querySelector("#hud-speed-btn") as HTMLElement;
    if (!speedBtn) return;

    const currentMode = mode ?? GameTimer.getInstance().getSpeedMode();
    const iconEl = speedBtn.querySelector(".speed-icon");

    // Update icon and class based on mode
    speedBtn.classList.remove("fast", "debug");
    
    switch (currentMode) {
      case "normal":
        if (iconEl) iconEl.textContent = "▶";
        speedBtn.title = "Normal speed (1x)";
        break;
      case "fast":
        speedBtn.classList.add("fast");
        if (iconEl) iconEl.textContent = "▶▶";
        speedBtn.title = "Fast speed (2x)";
        break;
      case "debug":
        speedBtn.classList.add("debug");
        if (iconEl) iconEl.textContent = "⚡";
        speedBtn.title = "Debug speed (10x)";
        break;
    }
  }

  /**
   * Show a Game Award notification (queued, auto-dismiss after 2s or on click)
   * @param icon Emoji or icon to display
   * @param text Award text to display
   */
  public showGameAward(icon: string, text: string): void {
    this.awardQueue.push({ icon, text });
    this.processAwardQueue();
  }

  private processAwardQueue(): void {
    if (this.isShowingAward || this.awardQueue.length === 0) return;

    const award = this.awardQueue.shift();
    if (!award) return;

    this.isShowingAward = true;

    // Create award element
    this.currentAward = document.createElement("div");
    this.currentAward.className = "game-award";
    this.currentAward.innerHTML = `
      <div class="game-award-icon">${award.icon}</div>
      <div class="game-award-text">${award.text}</div>
    `;

    // Click to dismiss
    this.currentAward.addEventListener("click", () => this.dismissAward());

    document.body.appendChild(this.currentAward);

    // Auto-dismiss after 2 seconds
    setTimeout(() => this.dismissAward(), 2000);
  }

  private dismissAward(): void {
    if (!this.currentAward) return;

    this.currentAward.style.animation = "awardFadeOut 0.3s ease-out forwards";
    
    setTimeout(() => {
      this.currentAward?.remove();
      this.currentAward = null;
      this.isShowingAward = false;
      
      // Process next award in queue
      this.processAwardQueue();
    }, 300);
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
    PlantSystem.getInstance().onPlantEvent((_plantId, event, data) => {
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
        // Hempire-style water prompt events (disabled - using floating indicators instead)
        case "water_prompt_start":
          // Large overlay disabled - WaterPromptUI handles floating indicators
          // const promptData = data as { timeRemaining: number; streak: number };
          // this.showWaterPrompt(plantId, promptData.timeRemaining, promptData.streak);
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

    // Speed toggle button
    this.container?.querySelector("#hud-speed-btn")?.addEventListener("click", () => {
      const gameTimer = GameTimer.getInstance();
      const newMode = gameTimer.cycleSpeedMode();
      this.updateSpeedButton(newMode);
    });

    // Fullscreen toggle button
    const fullscreenBtn = this.container?.querySelector("#hud-fullscreen-btn");
    fullscreenBtn?.addEventListener("click", () => {
      this.toggleFullscreen();
    });

    // Update fullscreen button state on fullscreen change
    document.addEventListener("fullscreenchange", () => {
      this.updateFullscreenButton();
    });
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn("Fullscreen request failed:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  private updateFullscreenButton(): void {
    const btn = this.container?.querySelector("#hud-fullscreen-btn") as HTMLElement;
    if (!btn) return;

    const icon = btn.querySelector(".fullscreen-icon");
    if (document.fullscreenElement) {
      btn.classList.add("active");
      if (icon) icon.textContent = "⛶";
      btn.title = "Exit fullscreen";
    } else {
      btn.classList.remove("active");
      if (icon) icon.textContent = "⛶";
      btn.title = "Toggle fullscreen";
    }
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
      const plant = GameState.getInstance().getPlant(plantId);
      if (plant) {
        const strain = plantSystem.getStrain(plant.strain);
        const fertType = strain?.fertilization?.fertilizerType || 'basic';
        if (plantSystem.applyFertilizer(plantId, fertType)) {
          this.showNotification("Fertilizer applied! Increases yield!", "success");
          this.showPlantInfo(plantId); // Refresh
        }
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
