import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AssetLoader } from "../engine/AssetLoader";
import { AudioManager } from "../engine/AudioManager";
import { GameAudio } from "./GameAudio";
import { MapRenderer } from "../engine/MapRenderer";
import { SettingsPanel } from "./ui/SettingsPanel";
import { GameState } from "./GameState";

export interface MainMenuCallbacks {
  onNewGame: (slot: number) => void;
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
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
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

    // Continue button (if autosave exists) - primary green style
    if (hasAutoSave) {
      const continueBtn = this.createButton("Continue", () => {
        this.hide();
        // SaveManager handles loadAutoSave() now
        this.callbacks.onContinue?.() || this.callbacks.onLoadGame(-1);
      }, "primary");
      buttons.appendChild(continueBtn);
    }

    // New Game button
    const newGameBtn = this.createButton("New Game", () => {
      if (hasSaves) {
        this.showNewGameSlotPicker();
      } else {
        this.hide();
        // SaveManager handles newGame() now
        this.callbacks.onNewGame(0);
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
    
    // Create modal overlay with light panel
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 200;
    `;

    // Light panel container
    const panel = document.createElement("div");
    panel.style.cssText = `
      background: #FAFAFA;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      max-width: 500px;
      width: 90%;
    `;

    panel.style.fontFamily = "'Nunito', 'Segoe UI', system-ui, sans-serif";

    const title = document.createElement("h2");
    title.textContent = "Load Game";
    title.style.cssText = `
      color: #333333;
      font-size: 2rem;
      margin: 0 0 1.5rem 0;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-align: center;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;
    panel.appendChild(title);

    const slotsContainer = document.createElement("div");
    slotsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    for (const slot of slots) {
      if (!slot.exists) continue;
      
      const slotBtn = document.createElement("button");
      slotBtn.style.cssText = `
        padding: 16px;
        background: #FFFFFF;
        border: none;
        border-bottom: 3px solid #E0E0E0;
        border-radius: 10px;
        color: #333333;
        cursor: pointer;
        text-align: left;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      `;

      const slotName = slot.isAutoSave ? "Autosave" : `Slot ${slot.slot + 1}`;
      const playTime = this.formatPlayTime(slot.playTime || 0);
      const lastSaved = slot.lastSaved ? new Date(slot.lastSaved).toLocaleString() : "Unknown";
      
      slotBtn.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 4px; color: #333333; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">${slotName}</div>
        <div style="font-size: 0.9rem; color: #666666; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">
          Level ${slot.level || 1} • $${(slot.money || 0).toLocaleString()} • Day ${slot.day || 1}
        </div>
        <div style="font-size: 0.8rem; color: #888888; margin-top: 4px; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">
          ${playTime} played • ${lastSaved}
        </div>
      `;

      slotBtn.addEventListener("mouseenter", () => {
        slotBtn.style.background = "#F8F8F8";
        slotBtn.style.top = "-2px";
        slotBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
      });
      slotBtn.addEventListener("mouseleave", () => {
        slotBtn.style.background = "#FFFFFF";
        slotBtn.style.top = "0";
        slotBtn.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.08)";
        slotBtn.style.borderBottomWidth = "3px";
      });
      slotBtn.addEventListener("mousedown", () => {
        slotBtn.style.top = "2px";
        slotBtn.style.borderBottomWidth = "1px";
        slotBtn.style.boxShadow = "none";
      });
      slotBtn.addEventListener("mouseup", () => {
        slotBtn.style.top = "-2px";
        slotBtn.style.borderBottomWidth = "3px";
        slotBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
      });
      slotBtn.addEventListener("click", () => {
        AudioManager.getInstance().playButtonPress();
        modal.remove();
        this.hide();
        // SaveManager handles loadFromSlot/loadAutoSave now
        this.callbacks.onLoadGame(slot.slot);
      });

      slotsContainer.appendChild(slotBtn);
    }

    panel.appendChild(slotsContainer);

    // Back button
    const backBtn = this.createButton("Back", () => {
      modal.remove();
    });
    backBtn.style.marginTop = "1.5rem";
    backBtn.style.width = "100%";
    panel.appendChild(backBtn);

    modal.appendChild(panel);
    document.body.appendChild(modal);
  }

  private showNewGameSlotPicker(): void {
    const state = GameState.getInstance();
    
    // Create modal overlay with light panel
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 200;
    `;

    // Light panel container
    const panel = document.createElement("div");
    panel.style.cssText = `
      background: #FAFAFA;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      max-width: 500px;
      width: 90%;
    `;

    panel.style.fontFamily = "'Nunito', 'Segoe UI', system-ui, sans-serif";

    const title = document.createElement("h2");
    title.textContent = "Choose Save Slot";
    title.style.cssText = `
      color: #333333;
      font-size: 2rem;
      margin: 0 0 1.5rem 0;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-align: center;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;
    panel.appendChild(title);

    const slotsContainer = document.createElement("div");
    slotsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    for (let i = 0; i < 3; i++) {
      const existingSlot = state.getSaveSlots().find(s => s.slot === i);
      
      const slotBtn = document.createElement("button");
      slotBtn.style.cssText = `
        padding: 16px;
        background: #FFFFFF;
        border: none;
        border-bottom: 3px solid #E0E0E0;
        border-radius: 10px;
        color: #333333;
        cursor: pointer;
        text-align: left;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      `;

      if (existingSlot?.exists) {
        const playTime = this.formatPlayTime(existingSlot.playTime || 0);
        slotBtn.innerHTML = `
          <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 4px; color: #333333; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">Slot ${i + 1} (Overwrite)</div>
          <div style="font-size: 0.9rem; color: #D32F2F; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">
            Level ${existingSlot.level || 1} • $${(existingSlot.money || 0).toLocaleString()} • ${playTime}
          </div>
        `;
      } else {
        slotBtn.innerHTML = `
          <div style="font-size: 1.1rem; font-weight: 600; color: #333333; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">Slot ${i + 1}</div>
          <div style="font-size: 0.9rem; color: #666666; font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;">Empty</div>
        `;
      }

      slotBtn.addEventListener("mouseenter", () => {
        slotBtn.style.background = "#F8F8F8";
        slotBtn.style.top = "-2px";
        slotBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
      });
      slotBtn.addEventListener("mouseleave", () => {
        slotBtn.style.background = "#FFFFFF";
        slotBtn.style.top = "0";
        slotBtn.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.08)";
        slotBtn.style.borderBottomWidth = "3px";
      });
      slotBtn.addEventListener("mousedown", () => {
        slotBtn.style.top = "2px";
        slotBtn.style.borderBottomWidth = "1px";
        slotBtn.style.boxShadow = "none";
      });
      slotBtn.addEventListener("mouseup", () => {
        slotBtn.style.top = "-2px";
        slotBtn.style.borderBottomWidth = "3px";
        slotBtn.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.12)";
      });
      slotBtn.addEventListener("click", () => {
        AudioManager.getInstance().playButtonPress();
        
        if (existingSlot?.exists) {
          // Show confirmation dialog for overwriting
          this.showOverwriteConfirmation(i, existingSlot, () => {
            modal.remove();
            this.hide();
            this.callbacks.onNewGame(i);
          });
        } else {
          // Empty slot - no confirmation needed
          modal.remove();
          this.hide();
          this.callbacks.onNewGame(i);
        }
      });

      slotsContainer.appendChild(slotBtn);
    }

    panel.appendChild(slotsContainer);

    const backBtn = this.createButton("Back", () => {
      modal.remove();
    });
    backBtn.style.marginTop = "1.5rem";
    backBtn.style.width = "100%";
    panel.appendChild(backBtn);

    modal.appendChild(panel);

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

  private showOverwriteConfirmation(
    slot: number, 
    existingSlot: { level?: number; money?: number; playTime?: number },
    onConfirm: () => void
  ): void {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      background: #FAFAFA;
      padding: 2rem;
      border-radius: 16px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    const title = document.createElement("h3");
    title.textContent = "Overwrite Save?";
    title.style.cssText = `
      margin: 0 0 1rem 0;
      color: #D32F2F;
      font-size: 1.4rem;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;
    panel.appendChild(title);

    const message = document.createElement("p");
    const playTime = this.formatPlayTime(existingSlot.playTime || 0);
    message.innerHTML = `
      This will permanently delete your save in <strong>Slot ${slot + 1}</strong>:<br>
      <span style="color: #666;">Level ${existingSlot.level || 1} • $${(existingSlot.money || 0).toLocaleString()} • ${playTime}</span>
    `;
    message.style.cssText = `
      margin: 0 0 1.5rem 0;
      color: #333;
      font-size: 1rem;
      line-height: 1.6;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;
    panel.appendChild(message);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: center;
    `;

    const cancelBtn = this.createButton("Cancel", () => {
      AudioManager.getInstance().playButtonPress();
      modal.remove();
    });
    cancelBtn.style.minWidth = "120px";
    cancelBtn.style.padding = "12px 24px";
    buttonContainer.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Overwrite";
    confirmBtn.style.cssText = `
      padding: 12px 24px;
      min-width: 120px;
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      background: #D32F2F;
      color: #FFFFFF;
      border: none;
      border-bottom: 4px solid #B71C1C;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.1s ease;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;
    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.background = "#E53935";
    });
    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.background = "#D32F2F";
    });
    confirmBtn.addEventListener("click", () => {
      AudioManager.getInstance().playButtonPress();
      modal.remove();
      onConfirm();
    });
    buttonContainer.appendChild(confirmBtn);

    panel.appendChild(buttonContainer);
    modal.appendChild(panel);
    document.body.appendChild(modal);
  }

  private createButton(text: string, onClick: () => void, variant: "primary" | "secondary" = "secondary"): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    
    const isPrimary = variant === "primary";
    const bg = isPrimary ? "#4CAF50" : "#F5F5F5";
    const bgHover = isPrimary ? "#5CBF60" : "#FFFFFF";
    const bgActive = isPrimary ? "#3D9140" : "#E8E8E8";
    const border = isPrimary ? "#3D9140" : "#CCCCCC";
    const textColor = isPrimary ? "#FFFFFF" : "#333333";
    const shadow = isPrimary ? "rgba(61, 145, 64, 0.3)" : "rgba(0, 0, 0, 0.1)";
    
    btn.style.cssText = `
      padding: 14px 40px;
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      background: ${bg};
      color: ${textColor};
      border: none;
      border-bottom: 4px solid ${border};
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.1s ease;
      min-width: 250px;
      box-shadow: 0 2px 4px ${shadow};
      position: relative;
      top: 0;
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    `;

    btn.addEventListener("mouseenter", () => {
      btn.style.background = bgHover;
      btn.style.top = "-1px";
      btn.style.boxShadow = `0 4px 8px ${shadow}`;
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = bg;
      btn.style.top = "0";
      btn.style.boxShadow = `0 2px 4px ${shadow}`;
      btn.style.borderBottomWidth = "4px";
    });

    btn.addEventListener("mousedown", () => {
      btn.style.background = bgActive;
      btn.style.top = "4px";
      btn.style.borderBottomWidth = "0px";
      btn.style.boxShadow = `0 0 2px ${shadow}`;
    });

    btn.addEventListener("mouseup", () => {
      btn.style.background = bgHover;
      btn.style.top = "-1px";
      btn.style.borderBottomWidth = "4px";
      btn.style.boxShadow = `0 4px 8px ${shadow}`;
    });

    btn.addEventListener("click", () => {
      AudioManager.getInstance().playButtonPress();
      onClick();
    });
    return btn;
  }

  public async show(): Promise<void> {
    // Create background scene with menu map
    await this.createBackgroundScene();

    // Show UI
    document.body.appendChild(this.container);

    // Start render loop for background
    this.startRenderLoop();
    
    // Start menu music (audio already unlocked by LoadingScreen)
    GameAudio.getInstance().playMenuMusic();
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
    GameAudio.getInstance().stopMenuMusic();
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
