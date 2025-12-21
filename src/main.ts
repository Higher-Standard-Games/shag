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
  const engine = new Engine(canvas, true);

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
