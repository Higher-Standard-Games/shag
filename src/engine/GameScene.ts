import {
  ArcRotateCamera,
  Color4,
  Engine,
  Scene,
  Vector3,
} from "babylonjs";
import { AchievementSystem } from "../game/AchievementSystem";
import { BuildingSystem } from "../game/BuildingSystem";
import { BuildableObjectManager } from "../game/BuildableObject";
import { EquipmentSystem } from "../game/EquipmentSystem";
import { GameClock } from "../game/GameClock";
import { registerGameData } from "../game/GameData";
import { GameState, GameTimer, HarvestIndicator, PlantSystem } from "../game";
import { OrderSystem } from "../game/OrderSystem";
import { QuestSystem } from "../game/QuestSystem";
import { ShopSystem } from "../game/ShopSystem";
import { TextureManager } from "./loader/TextureManager";
import { RTSCameraController } from "./camera/RTSCameraController";
import { SpriteManager } from "./sprites/SpriteManager";
import { BottomBar, UIConfig, SidePanel, ModalPanel, UITheme, type BuildMenuItem, type InventorySlot, type SidePanelItem, type ModalAction } from "./ui";
import { GameHUD } from "../ui/GameHUD";
import { HarvestCelebration } from "../ui/HarvestCelebration";
import { PotActionIndicator } from "../ui/PotActionIndicator";
import { PlantStatusIndicator } from "../ui/PlantStatusIndicator";
import { WaterPromptUI } from "../ui/WaterPromptUI";
import { AssetLoader } from "./AssetLoader";
import { AudioManager } from "./AudioManager";
import { MapRenderer } from "./MapRenderer";
import { SkyLightSystem } from "./lighting/SkyLightSystem";
import { StreetLampSystem } from "./lighting/StreetLampSystem";
import { WorldIndicatorSystem } from "./core/WorldIndicatorSystem";
import { LampSystem } from "../game/LampSystem";
import { LampInfoPanel } from "../ui/LampInfoPanel";

/**
 * Camera rendering modes:
 * - "perspective": Regular perspective camera, full clustered lighting support
 * - "orthographic": True orthographic, may have light artifacts at screen edges
 * - "fake_ortho": Perspective with very low FOV, looks orthographic but works with clustered lights
 */
export type CameraMode = "perspective" | "orthographic" | "fake_ortho";

// Default camera mode - can be changed at runtime via setCameraMode()
// Note: This is the initial mode before map loads. Map's worldspawn can override.
let CAMERA_MODE: CameraMode = "perspective";

// Default camera heights for each mode
const DEFAULT_CAMERA_HEIGHT: Record<CameraMode, number> = {
  perspective: 1000,
  orthographic: 250,  // This is orthoSize for orthographic mode
  fake_ortho: 1000,   // Radius for fake_ortho
};

export class GameScene {
  private static instance: GameScene;
  
  private engine: Engine;
  private canvas: HTMLCanvasElement;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private orthoSize = 250;
  private cameraHeight: number | null = null;  // Custom height from map
  private currentMap: string | null = null;
  private bottomBar: BottomBar | null = null;
  private questPanel: SidePanel | null = null;
  private orderPanel: SidePanel | null = null;
  private eventsPanel: SidePanel | null = null;
  private plantModal: ModalPanel | null = null;
  private selectedPlantId: string | null = null;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.canvas = canvas;
    GameScene.instance = this;
  }

  public static getInstance(): GameScene {
    return GameScene.instance;
  }

  public async start(): Promise<void> {
    const config = AssetLoader.getInstance().getConfig();
    const startMap = config?.game.startMap || "test.map";

    await this.createScene();
    
    // Initialize BuildingSystem before loading map (so zones can be registered)
    BuildingSystem.getInstance().init(this.scene!);
    BuildableObjectManager.getInstance().init(this.scene!);
    HarvestIndicator.getInstance().init(this.scene!);
    
    await this.loadMap(startMap);

    // Start game music if configured
    const musicKey = config?.assets.music.maps[startMap];
    if (musicKey) {
      AudioManager.getInstance().playMusic(startMap);
    }

    this.startRenderLoop();
  }

  private async createScene(): Promise<void> {
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
    this.scene.collisionsEnabled = true;

    // BabylonJS 8 Performance Optimizations
    // Skip clearing color buffer since we always have a skybox/background
    this.scene.autoClear = false;
    // Skip pointer move picking for better performance (we use click picking)
    this.scene.skipPointerMovePicking = true;
    // Block dirty mechanism during batch operations (materials handle this themselves)
    this.scene.blockMaterialDirtyMechanism = false;

    // Initialize TextureManager for this scene
    TextureManager.getInstance().init(this.scene);

    // Initialize SpriteManager (will be used when loading maps with npc_sprite entities)
    // Camera will be set after it's created

    // Isometric Camera - supports multiple rendering modes
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 4,  // alpha - rotation around Y axis
      Math.PI / 4,   // beta - angle from top (45 degrees for isometric)
      200,           // radius - will be adjusted based on mode
      Vector3.Zero(),
      this.scene
    );
    
    // Apply camera mode settings
    this.applyCameraMode(CAMERA_MODE);
    this.camera.inputs.clear();

    // Resize handler
    window.addEventListener("resize", () => {
      this.engine.resize();
      this.updateCameraOrtho();
    });

    // Initialize GameClock (3 minutes = 1 full day)
    const clock = GameClock.getInstance();
    clock.init({
      dayLengthSeconds: 180, // 3 minutes for full day/night cycle
      startHour: 8,          // Start at 8 AM
      startDay: 1,
    });

    // Initialize dynamic sky lighting (replaces static lights)
    // Using mild values for soft, pleasant lighting
    SkyLightSystem.getInstance().init(this.scene, {
      sunIntensity: 0.6,      // Soft directional sun
      moonIntensity: 0.12,    // Subtle moonlight
      ambientIntensity: 0.25, // Low ambient for contrast
      enableShadows: true,
    });

    // RTS Camera Controller
    new RTSCameraController(this.scene, this.camera, this.canvas);

    // Initialize SpriteManager with scene and camera
    SpriteManager.getInstance().init(this.scene, this.camera);

    // Trigger click handling
    this.setupTriggerHandling();

    // Expose debug functions
    this.exposeDebugFunctions();
  }

  private updateCameraOrtho(): void {
    if (!this.camera) return;

    const ratio = this.canvas.width / this.canvas.height;
    this.camera.orthoTop = this.orthoSize;
    this.camera.orthoBottom = -this.orthoSize;
    this.camera.orthoLeft = -this.orthoSize * ratio;
    this.camera.orthoRight = this.orthoSize * ratio;
  }

  /**
   * Apply camera mode settings
   * @param mode - The camera rendering mode to apply
   */
  private applyCameraMode(mode: CameraMode): void {
    if (!this.camera) return;

    // Use custom height if set, otherwise use default for the mode
    const height = this.cameraHeight ?? DEFAULT_CAMERA_HEIGHT[mode];

    switch (mode) {
      case "perspective":
        // Regular perspective camera - full clustered lighting support
        this.camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
        this.camera.fov = 0.8;
        this.camera.radius = height;
        this.camera.minZ = 1;
        this.camera.maxZ = Math.max(2000, height * 2);
        console.log(`Camera mode: PERSPECTIVE (height: ${height})`);
        break;

      case "orthographic":
        // True orthographic - may have light artifacts at screen edges
        this.camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        this.camera.radius = 200;
        this.camera.minZ = 1;
        this.camera.maxZ = 2000;
        this.orthoSize = height;
        this.updateCameraOrtho();
        console.log(`Camera mode: ORTHOGRAPHIC (orthoSize: ${height})`);
        break;

      case "fake_ortho":
        // Perspective with low FOV - looks orthographic, works with clustered lights
        // FOV scales with height to maintain consistent view size
        this.camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
        this.camera.fov = 0.5;  // Moderate FOV for orthographic-like view
        this.camera.radius = height;
        this.camera.minZ = 1;
        this.camera.maxZ = Math.max(2000, height * 4);
        console.log(`Camera mode: FAKE_ORTHO (radius: ${height})`);
        break;
    }
  }

  /**
   * Change camera mode at runtime
   * @param mode - The new camera mode
   */
  public setCameraMode(mode: CameraMode): void {
    CAMERA_MODE = mode;
    this.applyCameraMode(mode);
    
    // Update ortho bounds if switching to orthographic
    if (mode === "orthographic") {
      this.updateCameraOrtho();
    }
  }

  /**
   * Get current camera mode
   */
  public getCameraMode(): CameraMode {
    return CAMERA_MODE;
  }

  /**
   * Set camera height/distance at runtime
   * @param height - The camera height (meaning varies by mode)
   */
  public setCameraHeight(height: number): void {
    this.cameraHeight = height;
    this.applyCameraMode(CAMERA_MODE);  // Re-apply mode with new height
  }

  /**
   * Get current camera height
   */
  public getCameraHeight(): number {
    return this.cameraHeight ?? DEFAULT_CAMERA_HEIGHT[CAMERA_MODE];
  }

  public async loadMap(mapName: string): Promise<void> {
    if (!this.scene) return;

    console.log(`Loading map: ${mapName}`);

    // Clear existing map
    MapRenderer.clearMap(this.scene);

    // Get pre-loaded map data
    const mapData = AssetLoader.getInstance().getMap(mapName);
    if (!mapData) {
      console.error(`Map not found in cache: ${mapName}`);
      return;
    }

    // Render the map
    const result = await MapRenderer.renderEntities(mapData.entities, this.scene);

    // Apply camera height from map if specified
    if (result.cameraHeight !== null) {
      this.cameraHeight = result.cameraHeight;
    } else {
      this.cameraHeight = null;  // Reset to use defaults
    }

    // Apply camera mode from map if specified, otherwise keep perspective default
    if (result.cameraMode) {
      this.setCameraMode(result.cameraMode);
    } else {
      this.setCameraMode("perspective");
    }

    // Set camera target
    if (this.camera) {
      this.camera.setTarget(result.playerStartPosition);
    }

    this.currentMap = mapName;

    // Switch music if configured
    const config = AssetLoader.getInstance().getConfig();
    const musicKey = config?.assets.music.maps[mapName];
    if (musicKey && this.currentMap !== mapName) {
      AudioManager.getInstance().playMusic(mapName);
    }
  }

  private setupTriggerHandling(): void {
    // Trigger handling is done in RTSCameraController to avoid duplicate events
    // This method is kept for potential future non-click trigger logic
  }

  private exposeDebugFunctions(): void {
    (window as any).loadMap = (mapName: string) => this.loadMap(mapName);
    (window as any).setZoom = (newSize: number) => {
      this.orthoSize = newSize;
      this.updateCameraOrtho();
      console.log(`Zoom set to ${this.orthoSize}`);
    };
    
    // Camera mode toggle
    (window as any).setCameraMode = (mode: CameraMode) => {
      this.setCameraMode(mode);
    };
    (window as any).getCameraMode = () => this.getCameraMode();
    
    // Camera height/distance control
    (window as any).setCameraHeight = (height: number) => {
      this.setCameraHeight(height);
    };
    (window as any).getCameraHeight = () => this.getCameraHeight();
    
    console.log("Camera: setCameraMode('perspective'|'orthographic'|'fake_ortho'), setCameraHeight(number)");

    // Game system debug functions
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
        PlantSystem.getInstance().plantSeed(strain, pos, this.currentMap || "test");
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
        await BuildableObjectManager.getInstance().refreshAllVisuals();
        console.log("Refreshed all buildable object visuals with metadata");
      },
      // New system debug commands
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
      // Clock commands
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

    console.log("Debug: Use 'loadMap(name)', 'setZoom(value)', and 'game.*' in console.");
    console.log("Game commands: game.state(), game.addMoney(100), game.addXP(50), game.plant('basic'), game.timeScale(60)");
    console.log("Clock commands: game.time(), game.setTime(12), game.setDay(5), game.daySpeed(30)");
    console.log("New systems: game.orders(), game.createOrder(), game.quests(), game.achievements(), game.shop(), game.buy('seed_basic')");
  }

  private async initBottomBar(): Promise<void> {
    // Load UI config
    await UIConfig.getInstance().load("/data/ui-config.json");
    
    // Create BottomBar with callbacks
    // Engine handles layout/behavior, game provides content/styling via callbacks
    this.bottomBar = new BottomBar({
      // Actions
      onItemSelect: (item: BuildMenuItem) => {
        console.log("Selected build item:", item.name);
        BuildingSystem.getInstance().selectItem(item.id);
      },
      onInventorySlotClick: (slotIndex: number) => {
        console.log("Inventory slot clicked:", slotIndex);
      },
      
      // Data providers
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
      
      // Game-specific customization (icons, styling)
      renderItemIcon: (item: BuildMenuItem) => this.getBuildItemIcon(item.id),
      renderInventoryIcon: (itemId: string) => this.getInventoryIcon(itemId),
    });
    
    await this.bottomBar.init();
    this.bottomBar.show();
  }

  /**
   * Game-specific: Get icon for inventory items
   */
  private getInventoryIcon(itemId: string): string {
    const iconMap: Record<string, string> = {
      seed_basic: "🌿",
      seed_premium: "🌱",
      fertilizer: "💧",
      water: "💦",
    };
    return iconMap[itemId] || "📦";
  }

  /**
   * Game-specific: Get display name for inventory items
   */
  private getInventoryItemName(itemId: string): string {
    // Check if it's a seed - get strain name
    if (itemId.startsWith("seed_")) {
      const strainId = itemId.replace("seed_", "strain_");
      const strain = PlantSystem.getInstance().getStrain(strainId);
      if (strain) return strain.name;
    }
    // Check if it's a harvest product
    if (itemId.startsWith("harvest_")) {
      const strainId = itemId.replace("harvest_", "strain_");
      const strain = PlantSystem.getInstance().getStrain(strainId);
      if (strain) return strain.name;
    }
    // Fallback name map
    const nameMap: Record<string, string> = {
      fertilizer: "Fertilizer",
      water: "Water",
    };
    return nameMap[itemId] || itemId.replace(/_/g, " ");
  }

  /**
   * Game-specific: Get icon for build menu items
   */
  private getBuildItemIcon(itemId: string): string {
    const iconMap: Record<string, string> = {
      // Plants (match GameData.ts IDs)
      pot_basic: "🪴",
      pot_large: "🌿",
      pot_hydro: "💧",
      // Lights
      grow_light_basic: "💡",
      grow_light_advanced: "🔆",
      grow_light_ultra: "✨",
      // Equipment
      fan: "🌀",
      heater: "🔥",
      dehumidifier: "💨",
      // Decor
      plant_stand: "🪑",
      poster: "🖼️",
      rug: "🟫",
    };
    return iconMap[itemId] || "📦";
  }

  /**
   * Initialize side panels for Quests and Orders (left side, stacked)
   */
  private initSidePanels(): void {
    // Quest Panel
    this.questPanel = new SidePanel(
      {
        id: "quests",
        title: "Quests",
        icon: "📋",
        side: "left",
        order: 1,
        maxHeight: 200,
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
      },
      {
        getItems: (): SidePanelItem[] => {
          const orders = OrderSystem.getInstance().getActiveOrders();
          if (orders.length === 0) {
            return [{
              id: "no-orders",
              content: `<div style="color: #666; text-align: center;">No orders yet. Keep growing!</div>`,
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

    // Events Panel - shows actionable events (plants ready, need water, etc.)
    this.eventsPanel = new SidePanel(
      {
        id: "events",
        title: "Events",
        icon: "🔔",
        side: "left",
        order: 3,
        maxHeight: 200,
      },
      {
        getItems: (): SidePanelItem[] => {
          const events: SidePanelItem[] = [];
          const harvestIndicator = HarvestIndicator.getInstance();
          const plants = GameState.getInstance().getPlants();

          // Check for harvestable plants (prioritize urgent ones)
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

          // Check for plants needing water
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

          // Check for low health plants
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

          // Check for empty pots needing seeds
          const buildableManager = BuildableObjectManager.getInstance();
          const emptyPots = Array.from(buildableManager.getObjectsInMap("")).filter(obj => {
            const template = buildableManager.getTemplate(obj.templateId);
            return template?.zoneType === "plant" && obj.isComplete && !obj.hasPlant;
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

          // No events
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

    // Set up periodic refresh for side panels
    setInterval(() => {
      this.questPanel?.refresh();
      this.orderPanel?.refresh();
      this.eventsPanel?.refresh();
    }, 1000);
  }

  /**
   * Initialize plant info modal panel
   */
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
    
    // Calculate progress percentages
    // Overall growth = (current stage + stage progress) / (total stages - 1)
    // Stage 0 = 0%, final stage (stages-1) = 100%
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
          this.plantModal?.refresh();
        },
      },
      {
        id: "fertilize",
        label: "Fertilize",
        icon: "🧪",
        color: "#9C27B0",
        disabled: plant.fertilized || !GameState.getInstance().hasItem("fertilizer", 1),
        onClick: () => {
          PlantSystem.getInstance().applyFertilizer(this.selectedPlantId!);
          this.plantModal?.refresh();
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

  /**
   * Show plant info modal for a specific plant
   */
  public showPlantInfo(plantId: string): void {
    const plant = GameState.getInstance().getPlant(plantId);
    if (!plant) return;
    
    const strain = PlantSystem.getInstance().getStrain(plant.strain);
    this.selectedPlantId = plantId;
    
    if (this.plantModal) {
      this.plantModal.setTitle(strain?.name || "Plant");
      this.plantModal.show();
    }
  }

  private async startRenderLoop(): Promise<void> {
    // Initialize game systems
    GameState.getInstance(); // Load/create save
    GameTimer.getInstance(); // Start timer
    PlantSystem.getInstance(); // Start plant updates
    OrderSystem.getInstance().init(); // Start order generation
    EquipmentSystem.getInstance().init(); // Start equipment automation
    QuestSystem.getInstance().init(); // Start quest tracking
    AchievementSystem.getInstance(); // Initialize achievements
    // BuildingSystem already initialized in start()
    
    // Register game-specific data (items, strains, etc.)
    registerGameData();
    
    // Check for auto-start quests
    QuestSystem.getInstance().checkAutoStart();
    
    // Initialize UI theme (centralized styling)
    const uiTheme = UITheme.getInstance();
    uiTheme.init();
    
    // Add game-active class to body to prevent text selection
    document.body.classList.add("game-active");
    
    // Load custom fonts
    await uiTheme.loadFont("Chicle", "/fonts/Chicle-Regular.woff2", "400");
    uiTheme.setFontFamily(
      "'Segoe UI', system-ui, -apple-system, sans-serif",  // Body font
      "'Chicle', 'Segoe UI', sans-serif"                   // Heading font
    );
    
    // Show UI
    GameHUD.getInstance().show();
    
    // Initialize and show new BottomBar UI
    await this.initBottomBar();
    
    // Initialize side panels (Quests and Orders on left)
    this.initSidePanels();
    
    // Initialize plant info modal
    this.initPlantModal();
    
    // Initialize WorldIndicatorSystem (generic world-positioned UI indicators)
    if (this.scene && this.camera) {
      WorldIndicatorSystem.getInstance().init(this.scene, this.camera, this.engine);
    }
    
    // Initialize water prompt UI (uses WorldIndicatorSystem)
    WaterPromptUI.getInstance().init();
    
    // Initialize harvest celebration (listens for harvest events)
    HarvestCelebration.init();
    
    // Initialize pot action indicator (uses WorldIndicatorSystem)
    PotActionIndicator.getInstance().initialize();
    
    // Initialize plant status indicators (floating health/water/growth bars)
    PlantStatusIndicator.getInstance().initialize();

    // Initialize lamp system and UI
    LampSystem.getInstance().init();
    LampInfoPanel.getInstance().init();

    this.engine.runRenderLoop(() => {
      if (!this.scene || !this.camera) return;

      // Update game timer
      const deltaTime = GameTimer.getInstance().update();

      // Update game clock (day/night cycle)
      GameClock.getInstance().update(deltaTime);

      // Update street lamps (fade in/out)
      if (StreetLampSystem.getInstance().isInitialized()) {
        StreetLampSystem.getInstance().update(deltaTime);
      }

      // Force isometric view
      this.camera.alpha = -Math.PI / 4;
      this.camera.beta = Math.PI / 4;

      this.scene.render();
    });
  }

  public getScene(): Scene | null {
    return this.scene;
  }

  public dispose(): void {
    // Hide all game UI
    GameHUD.getInstance().hide();
    
    // Hide side panels
    this.questPanel?.hide();
    this.orderPanel?.hide();
    this.eventsPanel?.hide();
    
    // Hide bottom bar
    this.bottomBar?.hide();
    
    // Remove game-active class
    document.body.classList.remove("game-active");
    
    // Save game state
    GameState.getInstance().save();
    
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
