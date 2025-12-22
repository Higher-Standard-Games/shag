import "./style.css";
import { Engine } from "babylonjs";
import "babylonjs-loaders";
import { AssetLoader } from "./engine/AssetLoader";
import { AudioManager } from "./engine/AudioManager";
import { GameScene } from "./engine/GameScene";
import { MenuSystem } from "./engine/MenuSystem";
import { LoadingScreen } from "./game/LoadingScreen";
import { MainMenu } from "./game/MainMenu";
import { SettingsPanel } from "./ui/SettingsPanel";
import { UITheme } from "./engine/ui/UITheme";

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
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  
  // Detect mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
  
  // Create engine with mobile-optimized settings
  const engine = new Engine(canvas, true, {
    // Limit to device pixel ratio of 2 on mobile to save GPU
    adaptToDeviceRatio: !isMobile,
    // Disable stencil buffer if not needed (saves memory)
    stencil: false,
  });
  
  // Mobile optimization: Limit FPS to 30 on mobile, 60 on desktop
  // This significantly reduces battery drain and heat
  if (isMobile) {
    // 30 FPS is smooth enough for a casual farming game
    engine.setHardwareScalingLevel(1.5); // Render at lower resolution
    // Note: Babylon.js doesn't have direct FPS limiting, but we can use:
    // 1. Lower hardware scaling (renders at lower resolution)
    // 2. The browser's requestAnimationFrame naturally caps at 60fps
    // 3. For 30fps, we'd need custom throttling in render loop
    console.log("[Mobile] Optimized settings: 1.5x hardware scaling");
  } else {
    console.log("[Desktop] Full quality rendering");
  }

  // Handle window resize
  window.addEventListener("resize", () => {
    engine.resize();
  });

  // Phase 1: Loading
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();

  try {
    await AssetLoader.getInstance().loadAll((progress) => {
      loadingScreen.updateProgress(progress);
    });
  } catch (e) {
    console.error("Failed to load assets:", e);
  }

  // Initialize audio manager with loaded config
  AudioManager.getInstance().init();
  
  // Initialize settings (loads saved settings and applies to audio)
  SettingsPanel.getInstance();
  
  // Load custom fonts before showing main menu
  const uiTheme = UITheme.getInstance();
  await uiTheme.loadNunitoFont();

  // Phase 2: Main Menu
  loadingScreen.hide();

  // Track current game scene for returning to main menu
  let currentGameScene: GameScene | null = null;

  // Function to start a game
  const startGame = () => {
    currentGameScene = new GameScene(engine, canvas);
    currentGameScene.start();
    MenuSystem.getInstance().enterGame();
  };

  // Function to show main menu
  const showMainMenu = async () => {
    // Dispose current game if exists
    if (currentGameScene) {
      currentGameScene.dispose();
      currentGameScene = null;
    }

    // Show main menu
    MenuSystem.getInstance().enterMainMenu();
    const menu = new MainMenu(engine, canvas, {
      onNewGame: startGame,
      onLoadGame: (slot: number) => {
        console.log(`Loading game from slot ${slot}`);
        startGame();
      },
      onContinue: () => {
        console.log("Continuing from autosave");
        startGame();
      },
    });
    await menu.show();
  };

  // Initialize menu system with callbacks
  MenuSystem.getInstance().init({
    onMainMenu: showMainMenu,
  });

  // Show initial main menu
  await showMainMenu();
}

main().catch(console.error);
