import "./style.css";
import { Engine } from "babylonjs";
import { AssetLoader } from "./engine/AssetLoader";
import { AudioManager } from "./engine/AudioManager";
import { GameScene } from "./engine/GameScene";
import { LoadingScreen } from "./engine/LoadingScreen";
import { MainMenu } from "./engine/MainMenu";

/**
 * Main application entry point.
 *
 * Flow:
 * 1. Show loading screen
 * 2. Load all assets (maps, audio, etc.)
 * 3. Show main menu with background map
 * 4. On "Start Game" → initialize game scene
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

  // Phase 2: Main Menu
  loadingScreen.hide();

  const mainMenu = new MainMenu(engine, canvas, {
    onNewGame: () => {
      // Phase 3: Start new game
      const gameScene = new GameScene(engine, canvas);
      gameScene.start();
    },
    onLoadGame: (slot: number) => {
      // Phase 3: Load existing game
      console.log(`Loading game from slot ${slot}`);
      const gameScene = new GameScene(engine, canvas);
      gameScene.start();
    },
    onContinue: () => {
      // Phase 3: Continue from autosave
      console.log("Continuing from autosave");
      const gameScene = new GameScene(engine, canvas);
      gameScene.start();
    },
    onSettings: () => {
      console.log("Settings clicked - not implemented yet");
    },
  });

  await mainMenu.show();
}

main().catch(console.error);
