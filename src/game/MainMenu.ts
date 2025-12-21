import {
  ArcRotateCamera,
  Color4,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from "babylonjs";
import { AssetLoader } from "../engine/AssetLoader";
import { AudioManager } from "../engine/AudioManager";
import { MapRenderer } from "../engine/MapRenderer";
import { SettingsPanel } from "../ui/SettingsPanel";
import { GameState } from "./GameState";

export interface MainMenuCallbacks {
  onNewGame: () => void;
  onLoadGame: (slot: number) => void;
  onContinue?: () => void;
  onSettings?: () => void;
}

export class MainMenu {
  private engine: Engine;
  private scene: Scene | null = null;
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private callbacks: MainMenuCallbacks;
  private animationFrame: number | null = null;

  constructor(engine: Engine, canvas: HTMLCanvasElement, callbacks: MainMenuCallbacks) {
    this.engine = engine;
    this.canvas = canvas;
    this.callbacks = callbacks;

    // Create UI overlay
    this.container = document.createElement("div");
    this.container.id = "main-menu";
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 100;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      pointer-events: none;
    `;

    // Blur overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    `;
    this.container.appendChild(overlay);

    // Menu content
    const menuContent = document.createElement("div");
    menuContent.style.cssText = `
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: auto;
    `;

    // Title
    const config = AssetLoader.getInstance().getConfig();
    const title = document.createElement("h1");
    title.textContent = config?.game.title || "Game";
    title.style.cssText = `
      font-size: 3.5rem;
      font-weight: 200;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #fff;
      margin-bottom: 0.5rem;
      text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    menuContent.appendChild(title);

    // Version
    const version = document.createElement("div");
    version.textContent = `v${config?.game.version || "0.0.1"}`;
    version.style.cssText = `
      font-size: 0.875rem;
      color: #888;
      margin-bottom: 3rem;
      letter-spacing: 0.1em;
    `;
    menuContent.appendChild(version);

    // Buttons container
    const buttons = document.createElement("div");
    buttons.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1rem;
    `;

    // Check for existing saves
    const state = GameState.getInstance();
    const hasAutoSave = state.hasAutoSave();
    const saveSlots = state.getSaveSlots();
    const hasSaves = saveSlots.some(s => s.exists);

    // Continue button (if autosave exists)
    if (hasAutoSave) {
      const continueBtn = this.createButton("Continue", () => {
        this.hide();
        state.loadAutoSave();
        this.callbacks.onContinue?.() || this.callbacks.onLoadGame(-1);
      });
      continueBtn.style.background = "rgba(100, 200, 100, 0.2)";
      buttons.appendChild(continueBtn);
    }

    // New Game button
    const newGameBtn = this.createButton("New Game", () => {
      if (hasSaves) {
        this.showNewGameSlotPicker();
      } else {
        this.hide();
        state.newGame(0);
        this.callbacks.onNewGame();
      }
    });
    buttons.appendChild(newGameBtn);

    // Load Game button (if saves exist)
    if (hasSaves) {
      const loadBtn = this.createButton("Load Game", () => {
        this.showLoadGameMenu();
      });
      buttons.appendChild(loadBtn);
    }

    // Settings button - always show
    const settingsBtn = this.createButton("Settings", () => {
      SettingsPanel.getInstance().show(() => {
        // Callback when settings panel closes
        this.callbacks.onSettings?.();
      });
    });
    buttons.appendChild(settingsBtn);

    menuContent.appendChild(buttons);
    this.container.appendChild(menuContent);
  }

  private showLoadGameMenu(): void {
    const state = GameState.getInstance();
    const slots = state.getSaveSlots();
    
    // Create modal overlay
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 200;
    `;

    const title = document.createElement("h2");
    title.textContent = "Load Game";
    title.style.cssText = `
      color: #fff;
      font-size: 2rem;
      margin-bottom: 2rem;
      font-weight: 300;
      letter-spacing: 0.2em;
    `;
    modal.appendChild(title);

    const slotsContainer = document.createElement("div");
    slotsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-width: 500px;
      width: 90%;
    `;

    for (const slot of slots) {
      if (!slot.exists) continue;
      
      const slotBtn = document.createElement("button");
      slotBtn.style.cssText = `
        padding: 1.5rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s ease;
      `;

      const slotName = slot.isAutoSave ? "Autosave" : `Slot ${slot.slot + 1}`;
      const playTime = this.formatPlayTime(slot.playTime || 0);
      const lastSaved = slot.lastSaved ? new Date(slot.lastSaved).toLocaleString() : "Unknown";
      
      slotBtn.innerHTML = `
        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">${slotName}</div>
        <div style="font-size: 0.9rem; color: #aaa;">
          Level ${slot.level || 1} • $${(slot.money || 0).toLocaleString()} • Day ${slot.day || 1}
        </div>
        <div style="font-size: 0.8rem; color: #888; margin-top: 0.25rem;">
          ${playTime} played • ${lastSaved}
        </div>
      `;

      slotBtn.addEventListener("mouseenter", () => {
        slotBtn.style.background = "rgba(255, 255, 255, 0.2)";
      });
      slotBtn.addEventListener("mouseleave", () => {
        slotBtn.style.background = "rgba(255, 255, 255, 0.1)";
      });
      slotBtn.addEventListener("click", () => {
        modal.remove();
        this.hide();
        if (slot.isAutoSave) {
          state.loadAutoSave();
        } else {
          state.loadFromSlot(slot.slot);
        }
        this.callbacks.onLoadGame(slot.slot);
      });

      slotsContainer.appendChild(slotBtn);
    }

    modal.appendChild(slotsContainer);

    // Back button
    const backBtn = this.createButton("Back", () => {
      modal.remove();
    });
    backBtn.style.marginTop = "2rem";
    modal.appendChild(backBtn);

    document.body.appendChild(modal);
  }

  private showNewGameSlotPicker(): void {
    const state = GameState.getInstance();
    
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 200;
    `;

    const title = document.createElement("h2");
    title.textContent = "Choose Save Slot";
    title.style.cssText = `
      color: #fff;
      font-size: 2rem;
      margin-bottom: 2rem;
      font-weight: 300;
      letter-spacing: 0.2em;
    `;
    modal.appendChild(title);

    const slotsContainer = document.createElement("div");
    slotsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-width: 500px;
      width: 90%;
    `;

    for (let i = 0; i < 3; i++) {
      const existingSlot = state.getSaveSlots().find(s => s.slot === i);
      
      const slotBtn = document.createElement("button");
      slotBtn.style.cssText = `
        padding: 1.5rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s ease;
      `;

      if (existingSlot?.exists) {
        const playTime = this.formatPlayTime(existingSlot.playTime || 0);
        slotBtn.innerHTML = `
          <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">Slot ${i + 1} (Overwrite)</div>
          <div style="font-size: 0.9rem; color: #f88;">
            Level ${existingSlot.level || 1} • $${(existingSlot.money || 0).toLocaleString()} • ${playTime}
          </div>
        `;
      } else {
        slotBtn.innerHTML = `
          <div style="font-size: 1.2rem;">Slot ${i + 1}</div>
          <div style="font-size: 0.9rem; color: #888;">Empty</div>
        `;
      }

      slotBtn.addEventListener("mouseenter", () => {
        slotBtn.style.background = "rgba(255, 255, 255, 0.2)";
      });
      slotBtn.addEventListener("mouseleave", () => {
        slotBtn.style.background = "rgba(255, 255, 255, 0.1)";
      });
      slotBtn.addEventListener("click", () => {
        modal.remove();
        this.hide();
        state.newGame(i);
        this.callbacks.onNewGame();
      });

      slotsContainer.appendChild(slotBtn);
    }

    modal.appendChild(slotsContainer);

    const backBtn = this.createButton("Back", () => {
      modal.remove();
    });
    backBtn.style.marginTop = "2rem";
    modal.appendChild(backBtn);

    document.body.appendChild(modal);
  }

  private formatPlayTime(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private createButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      padding: 1rem 3rem;
      font-size: 1.125rem;
      font-weight: 400;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 250px;
    `;

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255, 255, 255, 0.2)";
      btn.style.borderColor = "rgba(255, 255, 255, 0.4)";
      btn.style.transform = "scale(1.02)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(255, 255, 255, 0.1)";
      btn.style.borderColor = "rgba(255, 255, 255, 0.2)";
      btn.style.transform = "scale(1)";
    });

    btn.addEventListener("click", onClick);
    return btn;
  }

  public async show(): Promise<void> {
    // Show "Click to Start" overlay FIRST (before any menu content)
    await this.showClickToStart();
    
    // After click, create background scene with menu map
    await this.createBackgroundScene();

    // Show UI
    document.body.appendChild(this.container);

    // Start render loop for background
    this.startRenderLoop();
    
    // Start menu music (now allowed after user interaction)
    AudioManager.getInstance().playMusic("menu");
  }

  private showClickToStart(): Promise<void> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "click-to-start";
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #000000;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 200;
        cursor: pointer;
      `;

      // Add subtle green glow at bottom
      const glow = document.createElement("div");
      glow.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 150%;
        height: 40%;
        background: radial-gradient(ellipse 50% 100% at 50% 100%, rgba(10, 35, 15, 0.8) 0%, rgba(5, 20, 8, 0.4) 40%, transparent 70%);
        pointer-events: none;
      `;
      overlay.appendChild(glow);

      // Engine logo - centered
      const logo = document.createElement("img");
      logo.src = "engine.svg";
      logo.alt = "Engine";
      logo.style.cssText = `
        width: 250px;
        height: auto;
        margin-bottom: 40px;
      `;
      overlay.appendChild(logo);

      const text = document.createElement("div");
      text.textContent = "Click to Start";
      text.style.cssText = `
        color: #fff;
        font-size: 2.5rem;
        font-family: 'Chicle', 'Segoe UI', sans-serif;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        animation: pulse 2s ease-in-out infinite;
        text-shadow: 0 4px 20px rgba(76, 175, 80, 0.3);
      `;

      // Add pulse animation
      const style = document.createElement("style");
      style.textContent = `
        @keyframes pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `;
      document.head.appendChild(style);

      overlay.appendChild(text);
      document.body.appendChild(overlay);

      // On click, remove overlay and resolve promise
      const handleClick = () => {
        overlay.remove();
        style.remove();
        resolve();
      };

      overlay.addEventListener("click", handleClick, { once: true });
    });
  }

  public hide(): void {
    // Stop render loop
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    // Fade out and remove
    this.container.style.opacity = "0";
    this.container.style.transition = "opacity 0.5s ease";

    setTimeout(() => {
      this.container.remove();
      if (this.scene) {
        this.scene.dispose();
        this.scene = null;
      }
    }, 500);

    // Stop menu music
    AudioManager.getInstance().stopMusic();
  }

  private async createBackgroundScene(): Promise<void> {
    const config = AssetLoader.getInstance().getConfig();
    if (!config?.assets.menuMap) return;

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.08, 1);

    // Camera for background - slowly rotating
    const camera = new ArcRotateCamera(
      "menuCamera",
      0,
      Math.PI / 4,
      200,
      Vector3.Zero(),
      this.scene
    );
    camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;

    const updateOrtho = () => {
      const ratio = this.canvas.width / this.canvas.height;
      const size = 300;
      camera.orthoTop = size;
      camera.orthoBottom = -size;
      camera.orthoLeft = -size * ratio;
      camera.orthoRight = size * ratio;
    };
    updateOrtho();

    // Lights
    const light = new HemisphericLight("menuLight", new Vector3(0, 1, 0), this.scene);
    light.intensity = 0.5;

    // Load menu map
    const mapData = AssetLoader.getInstance().getMap(config.assets.menuMap);
    if (mapData) {
      await MapRenderer.renderEntities(mapData.entities, this.scene);
    }
  }

  private startRenderLoop(): void {
    let angle = 0;

    const render = () => {
      if (!this.scene) return;

      // Slowly rotate camera
      angle += 0.001;
      const camera = this.scene.activeCamera as ArcRotateCamera;
      if (camera) {
        camera.alpha = angle;
      }

      this.scene.render();
      this.animationFrame = requestAnimationFrame(render);
    };

    render();
  }
}
