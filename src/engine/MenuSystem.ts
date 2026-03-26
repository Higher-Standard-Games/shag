/**
 * MenuSystem - Centralized menu state management (Engine Component)
 *
 * Handles:
 * - Menu state transitions (main menu, in-game, pause menu)
 * - ESC key to toggle pause menu
 * - Blur/darken overlay effect
 * - Settings callback (game provides its own settings UI)
 *
 * Uses unified UI components: Overlay, Button, ConfirmDialog
 */

import { EventBus } from "./core/EventBus";
import { ConfirmDialog, createButton, Overlay, UIManager, UIStyles } from "./ui";

export type MenuState = "main_menu" | "in_game" | "pause_menu" | "settings";

export interface MenuSystemCallbacks {
  onResume?: () => void;
  onMainMenu?: () => void;
  onQuitGame?: () => void;
  /** Game provides its own settings UI. Called when settings button is pressed. */
  onShowSettings?: (onClose: () => void) => void;
  /** Called when ESC is pressed while in settings state */
  onHideSettings?: () => void;
}

export class MenuSystem {
  private static instance: MenuSystem;
  private state: MenuState = "main_menu";
  private overlay: Overlay | null = null;
  private pausePanel: HTMLDivElement | null = null;
  private callbacks: MenuSystemCallbacks = {};
  private escKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  private constructor() {
    // Ensure UIManager styles are injected
    UIManager.getInstance();
    UIStyles.injectBase();
  }

  public static getInstance(): MenuSystem {
    if (!MenuSystem.instance) {
      MenuSystem.instance = new MenuSystem();
    }
    return MenuSystem.instance;
  }

  /**
   * Check if currently in game (not in main menu)
   */
  public isInGame(): boolean {
    return this.state === "in_game" || this.state === "pause_menu";
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
        // Game's settings panel handles its own close
        this.callbacks.onHideSettings?.();
        if (this.overlay) {
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

    // Note: Game code (MainMenu/GameAudio) handles music transitions
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
    EventBus.emit("game:paused", {});
    this.createPauseOverlay();
  }

  /**
   * Resume the game (hide pause menu)
   */
  public resume(): void {
    this.state = "in_game";
    EventBus.emit("game:resumed", {});
    this.hidePauseOverlay();
    this.callbacks.onResume?.();
  }

  /**
   * Show settings from pause menu
   */
  public showSettings(): void {
    if (!this.callbacks.onShowSettings) {
      console.warn("[MenuSystem] No settings callback provided");
      return;
    }

    this.state = "settings";

    // Hide pause panel but keep overlay
    if (this.pausePanel) {
      this.pausePanel.style.display = "none";
    }

    // Call game's settings UI with a close callback
    this.callbacks.onShowSettings(() => {
      // When settings closes, show pause panel again
      if (this.pausePanel) {
        this.pausePanel.style.display = "flex";
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
    if (this.overlay) return;

    // Create overlay using unified component
    this.overlay = new Overlay(
      {
        id: "pause-menu",
        blur: 8,
        opacity: 0.6,
        zIndex: UIManager.getInstance().getZIndex("PAUSE_MENU"),
        closeOnClick: false,
        animate: true,
      },
      () => this.resume(), // Called if overlay is closed externally
    );
    this.overlay.show();

    // Create pause panel
    this.pausePanel = document.createElement("div");
    this.pausePanel.id = "pause-panel";
    this.pausePanel.className = "ui-pause-panel";
    this.pausePanel.style.zIndex = String(UIManager.getInstance().getZIndex("PAUSE_MENU") + 1);

    // Title
    const title = document.createElement("h2");
    title.textContent = "PAUSED";
    title.className = "ui-pause-title";
    this.pausePanel.appendChild(title);

    // Buttons using unified component
    const resumeBtn = createButton({
      text: "Resume",
      variant: "primary",
      size: "large",
      onClick: () => this.resume(),
    });
    this.pausePanel.appendChild(resumeBtn);

    const settingsBtn = createButton({
      text: "Settings",
      variant: "secondary",
      size: "large",
      onClick: () => this.showSettings(),
    });
    this.pausePanel.appendChild(settingsBtn);

    const mainMenuBtn = createButton({
      text: "Main Menu",
      variant: "secondary",
      size: "large",
      onClick: () => this.confirmMainMenu(),
    });
    this.pausePanel.appendChild(mainMenuBtn);

    document.body.appendChild(this.pausePanel);
  }

  /**
   * Confirm returning to main menu (loses unsaved progress)
   */
  private confirmMainMenu(): void {
    // Use unified ConfirmDialog component
    ConfirmDialog.show({
      title: "Return to Main Menu?",
      message: "Any unsaved progress will be lost.",
      confirmText: "Confirm",
      cancelText: "Cancel",
      confirmVariant: "danger",
      onConfirm: () => this.returnToMainMenu(),
    });
  }

  /**
   * Hide the pause overlay
   */
  private hidePauseOverlay(): void {
    // Hide panel with animation
    if (this.pausePanel) {
      this.pausePanel.classList.add("ui-pause-panel--hiding");
      setTimeout(() => {
        this.pausePanel?.remove();
        this.pausePanel = null;
      }, 200);
    }

    // Hide overlay
    if (this.overlay) {
      this.overlay.hide();
      this.overlay = null;
    }
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
