/**
 * GameScene - Game-specific scene implementation
 * 
 * Extends EngineScene with all game-specific functionality:
 * - Game systems (PlantSystem, QuestSystem, OrderSystem, etc.)
 * - Game UI (GameHUD, BottomBar, SidePanels, etc.)
 * - Game audio via GameAudio
 * - Save/load via SaveManager
 * - Game-specific debug commands
 */

import { AchievementSystem } from "./AchievementSystem";
import { BuildingSystem } from "./BuildingSystem";
import { EquipmentSystem } from "./EquipmentSystem";
import { GameClock } from "./GameClock";
import { registerGameData } from "./GameData";
import { GameState, GameTimer, HarvestIndicator, PlantSystem } from "./index";
import { OrderSystem } from "./OrderSystem";
import { QuestSystem } from "./QuestSystem";
import { ShopSystem } from "./ShopSystem";
import { GameInputHandler } from "./GameInputHandler";
import { LampSystem } from "./LampSystem";
import { BuildableRenderer } from "./BuildableRenderer";
import { SaveManager } from "./SaveManager";
import { GameAudio } from "./GameAudio";

import { SettingsPanel } from "../ui/SettingsPanel";
import { GameHUD } from "../ui/GameHUD";
import { HarvestCelebration } from "../ui/HarvestCelebration";
import { PotActionIndicator } from "../ui/PotActionIndicator";
import { PlantStatusIndicator } from "../ui/PlantStatusIndicator";
import { WaterPromptUI } from "../ui/WaterPromptUI";
import { LampInfoPanel } from "../ui/LampInfoPanel";

import { EngineScene, type MapLoadResult } from "../engine/EngineScene";
import { BottomBar, UIConfig, SidePanel, ModalPanel, UITheme, type BuildMenuItem, type InventorySlot, type SidePanelItem, type ModalAction } from "../engine/ui";
import { CameraSystem } from "../engine/camera";
import { BuildableSystem } from "../engine/BuildableSystem";
import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { CapacitorBridge } from "../engine/core/CapacitorBridge";
import { Engine } from "@babylonjs/core/Engines/engine";

export class GameScene extends EngineScene {
  private static instance: GameScene;

  private bottomBar: BottomBar | null = null;
  private questPanel: SidePanel | null = null;
  private orderPanel: SidePanel | null = null;
  private eventsPanel: SidePanel | null = null;
  private plantModal: ModalPanel | null = null;
  private selectedPlantId: string | null = null;

  // Autosave interval
  private autoSaveInterval: number | null = null;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    super(engine, canvas);
    GameScene.instance = this;

    // Read performance setting
    const settings = SettingsPanel.getInstance().getSettings();
    this.updatePerformanceMode(settings.highPerformanceRendering);

    // Listen for performance setting changes
    window.addEventListener("performanceSettingChanged", ((e: CustomEvent) => {
      this.updatePerformanceMode(e.detail.highPerformance);
    }) as EventListener);
  }

  public static getInstance(): GameScene {
    return GameScene.instance;
  }

  /**
   * Provide game time for BuildableSystem
   */
  protected override getGameTime(): number {
    return GameTimer.getInstance().getGameTime();
  }

  // ==================== Hook implementations ====================

  protected override async onSceneCreated(): Promise<void> {
    const scene = this.getScene()!;

    // Initialize BuildingSystem before loading map
    BuildingSystem.getInstance().init(scene);

    // Initialize BuildableRenderer
    BuildableRenderer.getInstance().init(scene);

    // Expose for debugging
    (window as unknown as Record<string, unknown>).BuildableSystem = BuildableSystem;
    (window as unknown as Record<string, unknown>).BuildableRenderer = BuildableRenderer;

    // Initialize HarvestIndicator
    HarvestIndicator.getInstance().init(scene);

    // Initialize GameClock using engine settings
    const { EngineSettings } = await import("../engine/core/EngineSettings");
    const engineSettings = EngineSettings.getInstance();
    const timeSettings = engineSettings.getTimeSettings();
    const clock = GameClock.getInstance();
    const preserveTime = SaveManager.getInstance().isLoading();
    clock.init({
      dayLengthSeconds: timeSettings.dayLengthSeconds,
      startHour: timeSettings.startHour,
      startDay: timeSettings.startDay,
    }, preserveTime);

    // Initialize game input handler
    const gameInputHandler = GameInputHandler.init(scene);
    const cameraSystem = CameraSystem.getInstance();
    const controller = cameraSystem.getActiveController();
    if (controller && 'setClickCallback' in controller) {
      (controller as any).setClickCallback((screenX: number, screenY: number, wasDrag: boolean) => {
        gameInputHandler.handleClick(screenX, screenY, wasDrag);
      });
    }
  }

  protected override async onStart(): Promise<void> {
    // Start game music playlist
    await GameAudio.getInstance().startGamePlaylist();

    // Start periodic autosave
    this.startAutoSave();

    // Clear the loading flag
    SaveManager.getInstance().clearLoadingFlag();

    // Initialize game systems
    GameState.getInstance();
    GameTimer.getInstance();
    PlantSystem.getInstance();
    OrderSystem.getInstance().init();
    EquipmentSystem.getInstance().init();
    QuestSystem.getInstance().init();
    AchievementSystem.getInstance();

    // Register game-specific data
    registerGameData();

    // Check for auto-start quests
    QuestSystem.getInstance().checkAutoStart();

    // Initialize UI theme
    const uiTheme = UITheme.getInstance();
    uiTheme.init();
    document.body.classList.add("game-active");
    uiTheme.setFontFamily(
      "'Nunito', 'Segoe UI', system-ui, sans-serif",
      "'Nunito', 'Segoe UI', system-ui, sans-serif"
    );

    // Show game UI
    GameHUD.getInstance().show();
    await this.initBottomBar();
    this.initSidePanels();
    this.initPlantModal();

    // Initialize WorldIndicatorSystem
    const scene = this.getScene();
    const camera = this.getCamera();
    const engine = this.getEngine();
    if (scene && camera) {
      WorldIndicatorSystem.getInstance().init(scene, camera, engine);
    }

    // Initialize game UI systems
    WaterPromptUI.getInstance().init();
    HarvestCelebration.init();
    PotActionIndicator.getInstance().initialize();
    PlantStatusIndicator.getInstance().initialize();
    LampSystem.getInstance().init();
    LampInfoPanel.getInstance().init();

    // Expose game debug functions
    this.exposeGameDebugFunctions();
  }

  protected override async onMapUnloading(mapName: string): Promise<void> {
    SaveManager.getInstance().saveCurrentMapState(mapName);
  }

  protected override async onMapLoaded(result: MapLoadResult): Promise<void> {
    // Update BuildingSystem with current map
    BuildingSystem.getInstance().setCurrentMap(result.mapName);

    // Load saved state for this map
    await SaveManager.getInstance().loadMapState(result.mapName);

    // Handle playlist
    const gameAudio = GameAudio.getInstance();
    if (result.playlist) {
      console.log(`[GameScene] Map specifies playlist: ${result.playlist}`);
      await gameAudio.loadMapPlaylist(result.playlist);
    } else if (!gameAudio.isPlaylistPlaying()) {
      console.log("[GameScene] No playlist specified, starting game playlist");
      await gameAudio.startGamePlaylist();
    }
  }

  protected override onUpdate(_deltaTime: number): void {
    // Update game timer
    const gameDelta = GameTimer.getInstance().update();

    // Update game clock (day/night cycle)
    GameClock.getInstance().update(gameDelta);
  }

  protected override onAppBackgrounded(): void {
    SaveManager.getInstance().autoSave();
  }

  protected override onBackButton(): void {
    import("../engine/MenuSystem").then(({ MenuSystem }) => {
      const menuSystem = MenuSystem.getInstance();
      if (menuSystem.isInGame()) {
        menuSystem.showPauseMenu();
      } else {
        CapacitorBridge.getInstance().exitApp();
      }
    });
  }

  protected override onDispose(): void {
    // Stop autosave
    this.stopAutoSave();

    // Hide all game UI
    GameHUD.getInstance().hide();
    this.questPanel?.hide();
    this.orderPanel?.hide();
    this.eventsPanel?.hide();
    this.bottomBar?.hide();

    // Remove game-active class
    document.body.classList.remove("game-active");

    // Save game state
    SaveManager.getInstance().saveGame();
  }

  // ==================== Autosave ====================

  private startAutoSave(): void {
    if (this.autoSaveInterval !== null) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = window.setInterval(() => {
      SaveManager.getInstance().autoSave();
    }, 30000);

    console.log("[GameScene] Autosave started (30s interval)");
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval !== null) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  // ==================== UI Initialization ====================

  private async initBottomBar(): Promise<void> {
    await UIConfig.getInstance().load("/game/data/ui-config.json");

    this.bottomBar = new BottomBar({
      onItemSelect: (item: BuildMenuItem) => {
        console.log("Selected build item:", item.name);
        BuildingSystem.getInstance().selectItem(item.id);
      },
      onInventorySlotClick: (slotIndex: number) => {
        console.log("Inventory slot clicked:", slotIndex);
      },
      onCategoryChange: () => {
        BuildingSystem.getInstance().exitBuildMode();
      },
      onCollapse: () => {
        BuildingSystem.getInstance().exitBuildMode();
      },
      getPlayerLevel: () => GameState.getInstance().getPlayer().level,
      getPlayerMoney: () => GameState.getInstance().getPlayer().money,
      getInventory: (): InventorySlot[] => {
        const inventoryState = GameState.getInstance().getInventory();
        const slots: InventorySlot[] = [];
        for (const item of inventoryState.items) {
          if (item.quantity > 0) {
            slots.push({
              itemId: item.id,
              icon: this.getInventoryIcon(item.id),
              count: item.quantity,
              name: this.getInventoryItemName(item.id),
            });
          }
        }
        while (slots.length < 8) {
          slots.push({ itemId: null, icon: null, count: 0 });
        }
        return slots;
      },
      renderItemIcon: (item: BuildMenuItem) => this.getBuildItemIcon(item.id),
      renderInventoryIcon: (itemId: string) => this.getInventoryIcon(itemId),
    });

    await this.bottomBar.init();
    this.bottomBar.show();
  }

  private getInventoryIcon(itemId: string): string {
    const iconMap: Record<string, string> = {
      seed_basic: "🌿",
      seed_premium: "🌱",
      fertilizer: "💧",
      water: "💦",
    };
    return iconMap[itemId] || "📦";
  }

  private getInventoryItemName(itemId: string): string {
    if (itemId.startsWith("seed_")) {
      const strainId = itemId.replace("seed_", "strain_");
      const strain = PlantSystem.getInstance().getStrain(strainId);
      if (strain) return strain.name;
    }
    if (itemId.startsWith("harvest_")) {
      const strainId = itemId.replace("harvest_", "strain_");
      const strain = PlantSystem.getInstance().getStrain(strainId);
      if (strain) return strain.name;
    }
    const nameMap: Record<string, string> = {
      fertilizer: "Fertilizer",
      water: "Water",
    };
    return nameMap[itemId] || itemId.replace(/_/g, " ");
  }

  private getBuildItemIcon(itemId: string): string {
    const iconMap: Record<string, string> = {
      pot_basic: "🪴",
      pot_large: "🌿",
      pot_hydro: "💧",
      grow_light_basic: "💡",
      grow_light_advanced: "🔆",
      grow_light_ultra: "✨",
      fan: "🌀",
      heater: "🔥",
      dehumidifier: "💨",
      plant_stand: "🪑",
      poster: "🖼️",
      rug: "🟫",
    };
    return iconMap[itemId] || "📦";
  }

  private initSidePanels(): void {
    // Quest Panel
    this.questPanel = new SidePanel(
      {
        id: "quests",
        title: "Quests",
        icon: "📜",
        side: "left",
        order: 1,
        maxHeight: 200,
        collapsedByDefault: true,
      },
      {
        getItems: (): SidePanelItem[] => {
          const activeQuests = QuestSystem.getInstance().getActiveQuests();
          return activeQuests.map(aq => {
            const quest = QuestSystem.getInstance().getQuest(aq.questId);
            const isMain = quest?.category === "main";
            return {
              id: aq.questId,
              content: `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span>${quest?.name || aq.questId}</span>
                  ${isMain ? '<span style="background: #4CAF50; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px;">MAIN</span>' : ''}
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 4px;">
                  ${aq.objectives.map(obj => `
                    <div style="display: flex; align-items: center; gap: 4px;">
                      <span style="color: ${obj.current >= obj.target ? '#4CAF50' : '#666'};">
                        ${obj.current >= obj.target ? '✓' : '☐'}
                      </span>
                      <span>${obj.description}</span>
                      <span style="color: #666;">${obj.current}/${obj.target}</span>
                    </div>
                  `).join('')}
                </div>
              `,
            };
          });
        },
        getHeaderExtra: () => {
          const count = QuestSystem.getInstance().getActiveQuests().length;
          return count > 0 ? `<span style="background: #4CAF50; color: #fff; padding: 2px 6px; border-radius: 10px; font-size: 10px;">${count}</span>` : '';
        },
      }
    );
    this.questPanel.show();

    // Order Panel
    this.orderPanel = new SidePanel(
      {
        id: "orders",
        title: "Orders",
        icon: "📦",
        side: "left",
        order: 2,
        maxHeight: 200,
        collapsedByDefault: true,
      },
      {
        getItems: (): SidePanelItem[] => {
          const orders = OrderSystem.getInstance().getActiveOrders();
          if (orders.length === 0) {
            return [{
              id: "no-orders",
              content: `<div style="color: #888888; font-size: 14px;">No orders yet. Keep growing!</div>`,
            }];
          }
          const currentTime = GameTimer.getInstance().getGameTime();
          return orders.map(order => {
            const timeLeft = order.expiresAt - currentTime;
            const minutesLeft = Math.max(0, Math.floor(timeLeft / 60000));
            const isUrgent = minutesLeft < 5;
            return {
              id: order.id,
              content: `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span>${order.customerName}</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: ${isUrgent ? '#F44336' : '#888'}; font-size: 11px;">⏱️ ${minutesLeft}m</span>
                    <span style="color: #FFC107;">$${order.baseReward}</span>
                  </div>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 4px;">
                  ${Object.entries(order.items).map(([strainId, qty]) => `${qty}x ${strainId}`).join(', ')}
                </div>
              `,
            };
          });
        },
        getHeaderExtra: () => {
          const count = OrderSystem.getInstance().getActiveOrders().length;
          return count > 0 ? `<span style="background: #FFC107; color: #000; padding: 2px 6px; border-radius: 10px; font-size: 10px;">${count}</span>` : '';
        },
      }
    );
    this.orderPanel.show();

    // Events Panel
    this.eventsPanel = new SidePanel(
      {
        id: "events",
        title: "Events",
        icon: "🔔",
        side: "left",
        order: 3,
        maxHeight: 200,
        collapsedByDefault: true,
      },
      {
        getItems: (): SidePanelItem[] => {
          const events: SidePanelItem[] = [];
          const harvestIndicator = HarvestIndicator.getInstance();
          const plants = GameState.getInstance().getPlants();

          const harvestables = harvestIndicator.getHarvestablePlants();
          const spoiled = harvestables.filter(h => h.phase === "spoiled");
          const overripe = harvestables.filter(h => h.phase === "overripe");
          const ready = harvestables.filter(h => h.phase === "ready");

          if (spoiled.length > 0) {
            events.push({
              id: "event-spoiled",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #F44336;">
                  <span>⚠️</span>
                  <span>${spoiled.length} plant${spoiled.length > 1 ? 's' : ''} spoiling!</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Harvest immediately</div>
              `,
              onClick: () => {
                if (spoiled[0]) harvestIndicator.showHarvestPanel(spoiled[0].plantId);
              },
            });
          }

          if (overripe.length > 0) {
            events.push({
              id: "event-overripe",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #FF9800;">
                  <span>🍂</span>
                  <span>${overripe.length} plant${overripe.length > 1 ? 's' : ''} overripe</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Quality degrading</div>
              `,
              onClick: () => {
                if (overripe[0]) harvestIndicator.showHarvestPanel(overripe[0].plantId);
              },
            });
          }

          if (ready.length > 0) {
            events.push({
              id: "event-ready",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #4CAF50;">
                  <span>✂️</span>
                  <span>${ready.length} plant${ready.length > 1 ? 's' : ''} ready to harvest</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Peak quality</div>
              `,
              onClick: () => {
                if (ready[0]) harvestIndicator.showHarvestPanel(ready[0].plantId);
              },
            });
          }

          const needsWater = plants.filter(p => p.waterLevel < 30);
          if (needsWater.length > 0) {
            events.push({
              id: "event-water",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #2196F3;">
                  <span>💧</span>
                  <span>${needsWater.length} plant${needsWater.length > 1 ? 's' : ''} need water</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Water level low</div>
              `,
              onClick: () => {
                if (needsWater[0]) this.showPlantInfo(needsWater[0].id);
              },
            });
          }

          const lowHealth = plants.filter(p => p.health < 50 && p.health > 0);
          if (lowHealth.length > 0) {
            events.push({
              id: "event-health",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #E91E63;">
                  <span>❤️</span>
                  <span>${lowHealth.length} plant${lowHealth.length > 1 ? 's' : ''} unhealthy</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Check conditions</div>
              `,
              onClick: () => {
                if (lowHealth[0]) this.showPlantInfo(lowHealth[0].id);
              },
            });
          }

          const buildableSystem = BuildableSystem.getInstance();
          const currentMapId = this.getCurrentMap() || "";
          const emptyPots = buildableSystem.getInstancesInMap(currentMapId).filter(inst => {
            const template = buildableSystem.getTemplate(inst.templateId);
            return template?.category === "plant" && inst.isComplete && !inst.customData?.plantId;
          });
          if (emptyPots.length > 0) {
            events.push({
              id: "event-empty-pots",
              content: `
                <div style="display: flex; align-items: center; gap: 8px; color: #9E9E9E;">
                  <span>🌱</span>
                  <span>${emptyPots.length} pot${emptyPots.length > 1 ? 's' : ''} empty</span>
                </div>
                <div style="color: #888; font-size: 11px; margin-top: 2px;">Select a strain to plant</div>
              `,
            });
          }

          if (events.length === 0) {
            return [{
              id: "no-events",
              content: `<div style="color: #666; text-align: center;">No events. All good! 👍</div>`,
            }];
          }

          return events;
        },
        getHeaderExtra: () => {
          const harvestIndicator = HarvestIndicator.getInstance();
          const harvestables = harvestIndicator.getHarvestablePlants();
          const plants = GameState.getInstance().getPlants();
          const needsWater = plants.filter(p => p.waterLevel < 30).length;
          const lowHealth = plants.filter(p => p.health < 50 && p.health > 0).length;

          const urgentCount = harvestables.filter(h => h.phase === "spoiled" || h.phase === "overripe").length;
          const totalCount = harvestables.length + needsWater + lowHealth;

          if (urgentCount > 0) {
            return `<span style="background: #F44336; color: #fff; padding: 2px 6px; border-radius: 10px; font-size: 10px; animation: pulse 1s infinite;">${urgentCount}</span>`;
          }
          if (totalCount > 0) {
            return `<span style="background: #4CAF50; color: #fff; padding: 2px 6px; border-radius: 10px; font-size: 10px;">${totalCount}</span>`;
          }
          return '';
        },
      }
    );
    this.eventsPanel.show();

    // Periodic refresh
    setInterval(() => {
      this.questPanel?.refresh();
      this.orderPanel?.refresh();
      this.eventsPanel?.refresh();
    }, 1000);
  }

  private initPlantModal(): void {
    this.plantModal = new ModalPanel(
      {
        id: "plant-info",
        title: "Plant",
        icon: "🌿",
        width: 340,
      },
      {
        renderContent: () => this.renderPlantContent(),
        getActions: (): ModalAction[] => this.getPlantActions(),
        onClose: () => {
          this.selectedPlantId = null;
          GameHUD.getInstance().hidePlantInfo();
        },
      }
    );
  }

  private renderPlantContent(): string {
    if (!this.selectedPlantId) return "<div>No plant selected</div>";

    const plant = GameState.getInstance().getPlant(this.selectedPlantId);
    if (!plant) return "<div>Plant not found</div>";

    const strain = PlantSystem.getInstance().getStrain(plant.strain);
    if (!strain) return "<div>Unknown strain</div>";

    const mastery = PlantSystem.getInstance().getMastery(plant.strain);
    const stars = "★".repeat(mastery.level) + "☆".repeat(5 - mastery.level);

    const maxStage = strain.stages - 1;
    const overallGrowth = maxStage > 0
      ? ((plant.growthStage + (plant.growthProgress / 100)) / maxStage) * 100
      : 100;
    const growthPercent = Math.min(100, overallGrowth);
    const waterPercent = Math.min(100, plant.waterLevel);
    const healthPercent = Math.min(100, plant.health);

    return `
      <div style="text-align: center; margin-bottom: 12px;">
        <div style="font-size: 14px; color: #FFD700; letter-spacing: 2px;">${stars}</div>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #aaa; font-size: 13px;">Growth</span>
          <div style="flex: 1; margin: 0 12px; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
            <div style="width: ${growthPercent}%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); border-radius: 4px;"></div>
          </div>
          <span style="color: #fff; font-size: 12px; min-width: 40px; text-align: right;">${Math.floor(growthPercent)}%</span>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #aaa; font-size: 13px;">Water</span>
          <div style="flex: 1; margin: 0 12px; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
            <div style="width: ${waterPercent}%; height: 100%; background: linear-gradient(90deg, #2196F3, #03A9F4); border-radius: 4px;"></div>
          </div>
          <span style="color: #fff; font-size: 12px; min-width: 40px; text-align: right;">${Math.floor(waterPercent)}%</span>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #aaa; font-size: 13px;">Health</span>
          <div style="flex: 1; margin: 0 12px; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
            <div style="width: ${healthPercent}%; height: 100%; background: linear-gradient(90deg, #F44336, #E91E63); border-radius: 4px;"></div>
          </div>
          <span style="color: #fff; font-size: 12px; min-width: 40px; text-align: right;">${Math.floor(healthPercent)}%</span>
        </div>
      </div>
      
      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div style="display: flex; justify-content: space-between; color: #888; font-size: 12px;">
          <span>Pot:</span>
          <span style="color: #fff;">Basic Pot</span>
        </div>
      </div>
    `;
  }

  private getPlantActions(): ModalAction[] {
    if (!this.selectedPlantId) return [];

    const plant = GameState.getInstance().getPlant(this.selectedPlantId);
    if (!plant) return [];

    const canHarvest = plant.growthProgress >= 100 && plant.growthStage >= 3;

    return [
      {
        id: "water",
        label: "Water",
        icon: "💧",
        color: "#2196F3",
        onClick: () => {
          PlantSystem.getInstance().waterPlant(this.selectedPlantId!);
          this.plantModal?.hide();
        },
      },
      {
        id: "fertilize",
        label: "Fertilize",
        icon: "🧪",
        color: "#9C27B0",
        disabled: (() => {
          const strain = PlantSystem.getInstance().getStrain(plant.strain);
          const fertType = strain?.fertilization?.fertilizerType || 'basic';
          const fertItemId = `fertilizer_${fertType}`;
          const hasFertilizer = GameState.getInstance().hasItem(fertItemId);
          const fertStatus = PlantSystem.getInstance().getFertilizationStatus(this.selectedPlantId!);
          const isFullyFertilized = fertStatus ? fertStatus.applications >= fertStatus.required : false;
          return !hasFertilizer || isFullyFertilized;
        })(),
        onClick: () => {
          const strain = PlantSystem.getInstance().getStrain(plant.strain);
          const fertType = strain?.fertilization?.fertilizerType || 'basic';
          PlantSystem.getInstance().applyFertilizer(this.selectedPlantId!, fertType);
          this.plantModal?.hide();
        },
      },
      {
        id: "harvest",
        label: "Harvest",
        icon: "🌾",
        primary: true,
        color: canHarvest ? "#4CAF50" : undefined,
        disabled: !canHarvest,
        onClick: () => {
          PlantSystem.getInstance().harvestPlant(this.selectedPlantId!);
          this.plantModal?.hide();
        },
      },
    ];
  }

  public showPlantInfo(plantId: string): void {
    console.log("[GameScene] showPlantInfo called for:", plantId);
    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) {
      console.log("[GameScene] Plant not found:", plantId);
      return;
    }

    const strain = PlantSystem.getInstance().getStrain(plant.strain);
    this.selectedPlantId = plantId;

    if (this.plantModal) {
      this.plantModal.setTitle(strain?.name || "Plant");
      this.plantModal.show();
    }
  }

  // ==================== Game Debug Functions ====================

  private exposeGameDebugFunctions(): void {
    const currentMap = () => this.getCurrentMap();

    (window as any).game = {
      state: () => GameState.getInstance().getState(),
      addMoney: (amount: number) => {
        GameState.getInstance().addMoney(amount);
        console.log(`Added $${amount}`);
      },
      addXP: (amount: number) => {
        GameState.getInstance().addXP(amount);
        console.log(`Added ${amount} XP`);
      },
      addItem: (id: string, type: string, qty: number) => {
        GameState.getInstance().addItem(id, type as any, qty);
        console.log(`Added ${qty}x ${id}`);
      },
      plant: (strain: string = "basic") => {
        const pos = { x: Math.random() * 200 - 100, y: 0, z: Math.random() * 200 - 100 };
        PlantSystem.getInstance().plantSeed(strain, pos, currentMap() || "test");
      },
      timeScale: (scale: number) => {
        GameTimer.getInstance().setTimeScale(scale);
        console.log(`Time scale: ${scale}x`);
      },
      save: () => GameState.getInstance().save(),
      reset: () => GameState.getInstance().resetGame(),
      clearSave: () => {
        localStorage.clear();
        console.log("Saved game cleared. Refresh the page to start fresh.");
      },
      refreshPots: async () => {
        BuildableRenderer.getInstance().refreshAllVisuals();
        console.log("Refreshed all buildable object visuals with metadata");
      },
      orders: () => OrderSystem.getInstance().getActiveOrders(),
      createOrder: () => {
        (OrderSystem.getInstance() as any).tryGenerateOrder();
        console.log("Order generated");
      },
      quests: () => QuestSystem.getInstance().getActiveQuests(),
      achievements: () => AchievementSystem.getInstance().getUnlockedAchievements(),
      shop: () => ShopSystem.getInstance().getAvailableItems(),
      buy: (itemId: string) => {
        const result = ShopSystem.getInstance().purchase(itemId);
        console.log(result ? "Purchased!" : "Failed to purchase");
      },
      equipment: () => EquipmentSystem.getInstance().getActiveEquipment(),
      time: () => {
        const clock = GameClock.getInstance();
        return `Day ${clock.getCurrentDay()}, ${clock.formatTime12h()} (${clock.getTimeOfDay().period})`;
      },
      setTime: (hour: number, minute: number = 0) => {
        GameClock.getInstance().setTime(hour, minute);
        console.log(`Time set to ${GameClock.getInstance().formatTime()}`);
      },
      setDay: (day: number) => {
        GameClock.getInstance().setDay(day);
        console.log(`Day set to ${day}`);
      },
      daySpeed: (seconds: number) => {
        GameClock.getInstance().setDayLengthSeconds(seconds);
        console.log(`Day length set to ${seconds} seconds`);
      },
    };

    console.log("Game commands: game.state(), game.addMoney(100), game.addXP(50), game.plant('basic'), game.timeScale(60)");
    console.log("Clock commands: game.time(), game.setTime(12), game.setDay(5), game.daySpeed(30)");
    console.log("New systems: game.orders(), game.createOrder(), game.quests(), game.achievements(), game.shop(), game.buy('seed_basic')");
  }
}
