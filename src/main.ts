import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import "@babylonjs/loaders/glTF";
import { AssetLoader } from "./engine/AssetLoader";
import { AudioManager } from "./engine/AudioManager";
import { CapacitorBridge } from "./engine/core/CapacitorBridge";
import { registerEngineServices, ServiceLocator, QualityDetector } from "./engine/core";
import { GameScene } from "@game/GameScene";
import { MenuSystem } from "./engine/MenuSystem";
import { LoadingScreen } from "./engine/ui/LoadingScreen";
import { MainMenu } from "@game/MainMenu";
import { SaveManager } from "@game/SaveManager";
import { registerGameEntityHandlers } from "@game/EntityHandlers";
import { SettingsPanel } from "@game/ui/SettingsPanel";
import { UITheme } from "./engine/ui/UITheme";
import { UIScale } from "./engine/ui/UIScale";
import { DebugConsole } from "./engine/debug";
import { registerEngineCommands } from "./engine/console/commands";
import { registerGameCommands } from "@game/GameCommands";
import { GamePaths } from "./engine/core/GamePaths";
import { EngineVersion } from "./engine/core/EngineVersion";
import { PK3Index } from "./engine/loader/pk3/PK3Index";

/**
 * Main application entry point.
 *
 * Flow:
 * 1. Show loading screen
 * 2. Load all assets (maps, audio, etc.)
 * 3. Show main menu with background map
 * 4. On "Start Game" → initialize game scene
 * 5. ESC key shows pause menu during gameplay
 */
async function main() {
  // Initialize Capacitor bridge early (handles native platform setup)
  await CapacitorBridge.getInstance().init();

  // Initialize GamePaths (reads engine.json and URL params)
  await GamePaths.getInstance().init();

  // Set browser title (uses game title from config if set, else "SHAG Engine v<version>")
  EngineVersion.getInstance().setDocumentTitle();

  // Register engine services with ServiceLocator for explicit init order
  registerEngineServices();

  // Register game-specific entity handlers for MapRenderer
  registerGameEntityHandlers();

  // Initialize core services (no scene required)
  await ServiceLocator.getInstance().initCore();

  // Auto-detect quality and apply to texture memory manager
  const qualityRecommendation = QualityDetector.getInstance().detectQuality();
  console.log(`[Main] Device: ${qualityRecommendation.deviceInfo.type}, Quality: ${qualityRecommendation.quality}`);

  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

  // Create engine
  // Note: FPS throttling is handled in GameScene based on user's "High Performance" setting
  const engine = new Engine(canvas, true, {
    // Disable stencil buffer if not needed (saves memory)
    stencil: false,
  });

  // Handle window resize
  window.addEventListener("resize", () => {
    engine.resize();
  });

  // Phase 1: Loading
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();

  // Ensure PK3 index is up to date (uses cache if valid, rebuilds if changed)
  const pk3Index = PK3Index.getInstance();
  pk3Index.setSearchPaths([GamePaths.getInstance().game() + '/']);
  await pk3Index.ensureIndex((msg) => loadingScreen.setStatus(msg));

  try {
    await AssetLoader.getInstance().loadAll((progress) => {
      loadingScreen.updateProgress(progress);
      // Update status text based on loading phase
      switch (progress.phase) {
        case 'config':
          loadingScreen.setStatus('loading configuration...');
          break;
        case 'maps':
          loadingScreen.setStatus(`loading map: ${progress.currentAsset}`);
          break;
        case 'prefabs':
          loadingScreen.setStatus(`loading prefab: ${progress.currentAsset}`);
          break;
        case 'audio':
          loadingScreen.setStatus(`loading audio: ${progress.currentAsset}`);
          break;
        case 'complete':
          loadingScreen.setStatus('initializing...');
          break;
      }
    });
  } catch (e) {
    console.error("Failed to load assets:", e);
  }

  // Initialize audio manager with loaded config
  AudioManager.getInstance().init();

  // Initialize debug console (PC only, tilde key to toggle)
  const debugConsole = DebugConsole.getInstance();
  debugConsole.enable();

  // Register engine commands
  await registerEngineCommands();
  registerGameCommands();

  // Initialize settings (loads saved settings and applies to audio)
  SettingsPanel.getInstance();

  // Initialize UI scaling system
  UIScale.getInstance().init();

  // Load custom fonts before showing main menu
  const uiTheme = UITheme.getInstance();
  await uiTheme.loadNunitoFont();
  await uiTheme.loadShareTechMonoFont();

  // Phase 2: Wait for user interaction (unlocks browser audio)
  await loadingScreen.waitForReady();
  loadingScreen.hide();

  // Hide native splash screen (Capacitor)
  await CapacitorBridge.getInstance().hideSplashScreen();

  // Track current game scene for returning to main menu
  let currentGameScene: GameScene | null = null;
  const saveManager = SaveManager.getInstance();

  // Function to start a new game
  const startNewGame = (slot: number) => {
    console.log(`Starting new game in slot ${slot}`);
    saveManager.newGame(slot);
    currentGameScene = new GameScene(engine, canvas);
    currentGameScene.start();
    MenuSystem.getInstance().enterGame();
  };

  // Function to load a saved game
  const loadGame = async (slot: number) => {
    console.log(`Loading game from slot ${slot}`);

    // Slot -1 is autosave - use loadAutoSave instead
    const success = slot === -1
      ? await saveManager.loadAutoSave()
      : await saveManager.loadGame(slot);

    if (!success) {
      console.error(`Failed to load game from slot ${slot}`);
      return;
    }
    currentGameScene = new GameScene(engine, canvas);
    currentGameScene.start();
    MenuSystem.getInstance().enterGame();
  };

  // Function to continue from autosave
  const continueGame = async () => {
    console.log("Continuing from autosave");
    const success = await saveManager.loadAutoSave();
    if (!success) {
      console.error("Failed to load autosave");
      return;
    }
    currentGameScene = new GameScene(engine, canvas);
    currentGameScene.start();
    MenuSystem.getInstance().enterGame();
  };

  // Function to show main menu
  const showMainMenu = async () => {
    // Save current game before returning to menu
    if (currentGameScene) {
      saveManager.saveGame();
      currentGameScene.dispose();
      currentGameScene = null;
    }

    // Show main menu
    MenuSystem.getInstance().enterMainMenu();
    const menu = new MainMenu(engine, canvas, {
      onNewGame: startNewGame,
      onLoadGame: loadGame,
      onContinue: continueGame,
    });
    // Expose for debug console commands
    (window as any).mainMenu = menu;
    await menu.show();
  };

  // Initialize menu system with callbacks
  MenuSystem.getInstance().init({
    onMainMenu: showMainMenu,
    onShowSettings: (onClose) => {
      SettingsPanel.getInstance().show(onClose);
    },
    onHideSettings: () => {
      SettingsPanel.getInstance().hide();
    },
  });

  // Show initial main menu
  await showMainMenu();
}

main().catch(console.error);
