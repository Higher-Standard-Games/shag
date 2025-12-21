/**
 * MenuSystem - Centralized menu state management (Engine Component)
 * 
 * Handles:
 * - Menu state transitions (main menu, in-game, pause menu)
 * - ESC key to toggle pause menu
 * - Blur/darken overlay effect
 * - Integration with SettingsPanel
 */

import { SettingsPanel } from "../ui/SettingsPanel";

export type MenuState = "main_menu" | "in_game" | "pause_menu" | "settings";

export interface MenuSystemCallbacks {
  onResume?: () => void;
  onMainMenu?: () => void;
  onQuitGame?: () => void;
}

export class MenuSystem {
  private static instance: MenuSystem;
  private state: MenuState = "main_menu";
  private pauseOverlay: HTMLDivElement | null = null;
  private callbacks: MenuSystemCallbacks = {};
  private escKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  private constructor() {}

  public static getInstance(): MenuSystem {
    if (!MenuSystem.instance) {
      MenuSystem.instance = new MenuSystem();
    }
    return MenuSystem.instance;
  }

  /**
   * Initialize the menu system with callbacks
   */
  public init(callbacks: MenuSystemCallbacks): void {
    this.callbacks = callbacks;
    this.setupEscapeKey();
  }

  /**
   * Set up ESC key handler
   */
  private setupEscapeKey(): void {
    if (this.escKeyHandler) {
      document.removeEventListener("keydown", this.escKeyHandler);
    }

    this.escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.handleEscapeKey();
      }
    };

    document.addEventListener("keydown", this.escKeyHandler);
  }

  /**
   * Handle ESC key press
   */
  private handleEscapeKey(): void {
    switch (this.state) {
      case "in_game":
        this.showPauseMenu();
        break;
      case "pause_menu":
        this.resume();
        break;
      case "settings":
        // Settings panel handles its own close, then we go back to pause
        SettingsPanel.getInstance().hide();
        if (this.pauseOverlay) {
          this.state = "pause_menu";
        } else {
          this.state = "in_game";
        }
        break;
      case "main_menu":
        // Do nothing on main menu
        break;
    }
  }

  /**
   * Get current menu state
   */
  public getState(): MenuState {
    return this.state;
  }

  /**
   * Transition to in-game state (called when game starts)
   */
  public enterGame(): void {
    this.state = "in_game";
    this.hidePauseOverlay();
  }

  /**
   * Transition to main menu state
   */
  public enterMainMenu(): void {
    this.state = "main_menu";
    this.hidePauseOverlay();
  }

  /**
   * Show the pause menu overlay
   */
  public showPauseMenu(): void {
    if (this.state !== "in_game") return;

    this.state = "pause_menu";
    this.createPauseOverlay();
  }

  /**
   * Resume the game (hide pause menu)
   */
  public resume(): void {
    this.state = "in_game";
    this.hidePauseOverlay();
    this.callbacks.onResume?.();
  }

  /**
   * Show settings from pause menu
   */
  public showSettings(): void {
    this.state = "settings";
    SettingsPanel.getInstance().show(() => {
      // When settings closes, return to pause menu
      if (this.pauseOverlay) {
        this.state = "pause_menu";
      } else {
        this.state = "in_game";
      }
    });
  }

  /**
   * Return to main menu from pause
   */
  public returnToMainMenu(): void {
    this.hidePauseOverlay();
    this.state = "main_menu";
    this.callbacks.onMainMenu?.();
  }

  /**
   * Create the pause menu overlay with blur effect
   */
  private createPauseOverlay(): void {
    if (this.pauseOverlay) return;

    // Create overlay container
    this.pauseOverlay = document.createElement("div");
    this.pauseOverlay.id = "pause-overlay";
    this.pauseOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      font-family: 'Segoe UI', system-ui, sans-serif;
      animation: fadeIn 0.2s ease;
    `;

    // Add animation keyframes
    this.injectStyles();

    // Menu panel
    const panel = document.createElement("div");
    panel.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    `;

    // Title
    const title = document.createElement("h2");
    title.textContent = "PAUSED";
    title.style.cssText = `
      color: #fff;
      font-size: 2.5rem;
      font-weight: 200;
      letter-spacing: 0.3em;
      margin: 0 0 24px 0;
      text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    panel.appendChild(title);

    // Buttons
    const buttons = [
      { text: "Resume", action: () => this.resume(), primary: true },
      { text: "Settings", action: () => this.showSettings() },
      { text: "Main Menu", action: () => this.confirmMainMenu() },
    ];

    for (const btn of buttons) {
      const button = this.createButton(btn.text, btn.action, btn.primary);
      panel.appendChild(button);
    }

    this.pauseOverlay.appendChild(panel);
    document.body.appendChild(this.pauseOverlay);
  }

  /**
   * Confirm returning to main menu (loses unsaved progress)
   */
  private confirmMainMenu(): void {
    // Simple confirmation - could be a modal in the future
    const confirmed = confirm("Return to main menu? Any unsaved progress will be lost.");
    if (confirmed) {
      this.returnToMainMenu();
    }
  }

  /**
   * Hide the pause overlay
   */
  private hidePauseOverlay(): void {
    if (this.pauseOverlay) {
      this.pauseOverlay.style.animation = "fadeOut 0.2s ease";
      setTimeout(() => {
        this.pauseOverlay?.remove();
        this.pauseOverlay = null;
      }, 200);
    }
  }

  /**
   * Create a styled button
   */
  private createButton(text: string, onClick: () => void, primary = false): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      padding: 14px 48px;
      font-size: 1.1rem;
      font-weight: 400;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      background: ${primary ? "rgba(76, 175, 80, 0.3)" : "rgba(255, 255, 255, 0.1)"};
      border: 1px solid ${primary ? "rgba(76, 175, 80, 0.5)" : "rgba(255, 255, 255, 0.2)"};
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 220px;
    `;

    btn.addEventListener("mouseenter", () => {
      btn.style.background = primary ? "rgba(76, 175, 80, 0.5)" : "rgba(255, 255, 255, 0.2)";
      btn.style.transform = "scale(1.02)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = primary ? "rgba(76, 175, 80, 0.3)" : "rgba(255, 255, 255, 0.1)";
      btn.style.transform = "scale(1)";
    });

    btn.addEventListener("click", onClick);
    return btn;
  }

  /**
   * Inject CSS animations
   */
  private injectStyles(): void {
    const styleId = "menu-system-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Check if game is paused (for UI purposes)
   */
  public isPaused(): boolean {
    return this.state === "pause_menu" || this.state === "settings";
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.escKeyHandler) {
      document.removeEventListener("keydown", this.escKeyHandler);
    }
    this.hidePauseOverlay();
  }
}
