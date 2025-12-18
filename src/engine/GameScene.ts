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
import { TextureManager } from "../loader/TextureManager";
import { RTSCameraController } from "../scene/RTSCameraController";
import { SpriteManager } from "../sprites/SpriteManager";
import { BuildMenu } from "../ui/BuildMenu";
import { GameHUD } from "../ui/GameHUD";
import { OrderPanel } from "../ui/OrderPanel";
import { QuestPanel } from "../ui/QuestPanel";
import { HarvestCelebration } from "../ui/HarvestCelebration";
import { PotActionIndicator } from "../ui/PotActionIndicator";
import { WaterPromptUI } from "../ui/WaterPromptUI";
import { AssetLoader } from "./AssetLoader";
import { AudioManager } from "./AudioManager";
import { MapRenderer } from "./MapRenderer";
import { SkyLightSystem } from "./SkyLightSystem";
import { StreetLampSystem } from "./StreetLampSystem";

export class GameScene {
  private engine: Engine;
  private canvas: HTMLCanvasElement;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private orthoSize = 250;
  private currentMap: string | null = null;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.canvas = canvas;
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

    // Initialize TextureManager for this scene
    TextureManager.getInstance().init(this.scene);

    // Initialize SpriteManager (will be used when loading maps with npc_sprite entities)
    // Camera will be set after it's created

    // Isometric Camera
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 4,
      Math.PI / 4,
      200,
      Vector3.Zero(),
      this.scene
    );
    this.camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    this.camera.inputs.clear();

    this.updateCameraOrtho();

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

  private startRenderLoop(): void {
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
    
    // Show UI
    GameHUD.getInstance().show();
    BuildMenu.getInstance().show();
    OrderPanel.getInstance().show();
    QuestPanel.getInstance().show();
    
    // Initialize water prompt UI with screen position converter
    WaterPromptUI.getInstance().init((worldPos) => {
      if (!this.scene || !this.camera) return null;
      const pos = new Vector3(worldPos.x, worldPos.y, worldPos.z);
      const screenPos = Vector3.Project(
        pos,
        this.scene.getTransformMatrix(),
        this.scene.getProjectionMatrix(),
        this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight())
      );
      return { x: screenPos.x, y: screenPos.y };
    });
    
    // Initialize harvest celebration (listens for harvest events)
    HarvestCelebration.init();
    
    // Initialize pot action indicator (shows bouncing icon on empty pots)
    PotActionIndicator.getInstance().initialize((worldPos) => {
      if (!this.scene || !this.camera) return null;
      const pos = new Vector3(worldPos.x, worldPos.y, worldPos.z);
      const screenPos = Vector3.Project(
        pos,
        this.scene.getTransformMatrix(),
        this.scene.getProjectionMatrix(),
        this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight())
      );
      return { x: screenPos.x, y: screenPos.y };
    });

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
    GameHUD.getInstance().hide();
    GameState.getInstance().save();
    
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
