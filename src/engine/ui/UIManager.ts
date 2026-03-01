/**
 * UIManager - Central UI lifecycle and z-index management (Engine Component)
 * 
 * Responsibilities:
 * - Z-index registry to prevent conflicts
 * - Overlay stack management for ESC key routing
 * - Global UI state tracking
 * 
 * Note: This is separate from src/ui/UIManager.ts which handles game dialogs.
 * This engine-level manager handles core UI infrastructure.
 */

/**
 * Z-index layers - all UI z-index values should come from here
 */
export type ZIndexLayer =
  | "GAME_UI"      // 100 - Side panels, bottom bar, HUD
  | "TOOLTIP"      // 200 - Tooltips, hover info
  | "DROPDOWN"     // 300 - Dropdowns, select menus
  | "MODAL"        // 500 - Modal panels
  | "OVERLAY"      // 800 - Backdrop overlays
  | "DIALOG"       // 900 - Dialogs on top of overlay
  | "PAUSE_MENU"   // 1000 - Pause menu overlay
  | "SETTINGS"     // 1200 - Settings panel
  | "CONFIRM"      // 1500 - Confirmation dialogs (topmost)
  | "LOADING";     // 2000 - Loading screen

const Z_INDEX_MAP: Record<ZIndexLayer, number> = {
  GAME_UI: 100,
  TOOLTIP: 200,
  DROPDOWN: 300,
  MODAL: 500,
  OVERLAY: 800,
  DIALOG: 900,
  PAUSE_MENU: 1000,
  SETTINGS: 1200,
  CONFIRM: 1500,
  LOADING: 2000,
};

interface OverlayEntry {
  id: string;
  onClose: () => void;
}

export class UIManager {
  private static instance: UIManager;
  private overlayStack: OverlayEntry[] = [];
  private stylesInjected: boolean = false;

  private constructor() {
    this.injectStyles();
  }

  public static getInstance(): UIManager {
    if (!UIManager.instance) {
      UIManager.instance = new UIManager();
    }
    return UIManager.instance;
  }

  /**
   * Get z-index for a specific layer
   */
  public getZIndex(layer: ZIndexLayer): number {
    return Z_INDEX_MAP[layer];
  }

  /**
   * Push an overlay onto the stack (for ESC key routing)
   */
  public pushOverlay(id: string, onClose: () => void): void {
    // Remove if already exists (prevent duplicates)
    this.overlayStack = this.overlayStack.filter(o => o.id !== id);
    this.overlayStack.push({ id, onClose });
  }

  /**
   * Pop a specific overlay from the stack
   */
  public popOverlay(id: string): void {
    this.overlayStack = this.overlayStack.filter(o => o.id !== id);
  }

  /**
   * Get the topmost overlay ID
   */
  public getTopOverlay(): string | null {
    if (this.overlayStack.length === 0) return null;
    return this.overlayStack[this.overlayStack.length - 1].id;
  }

  /**
   * Close the topmost overlay (called by ESC key handler)
   */
  public closeTopOverlay(): boolean {
    if (this.overlayStack.length === 0) return false;
    const top = this.overlayStack.pop();
    if (top) {
      top.onClose();
      return true;
    }
    return false;
  }

  /**
   * Check if any overlay is currently open
   */
  public isAnyOverlayOpen(): boolean {
    return this.overlayStack.length > 0;
  }

  /**
   * Close all overlays
   */
  public closeAllOverlays(): void {
    while (this.overlayStack.length > 0) {
      const overlay = this.overlayStack.pop();
      overlay?.onClose();
    }
  }

  /**
   * Inject shared UI animations and styles
   */
  private injectStyles(): void {
    if (this.stylesInjected) return;

    const styleId = "ui-manager-styles";
    if (document.getElementById(styleId)) {
      this.stylesInjected = true;
      return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* Shared UI Animations */
      @keyframes uiFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes uiFadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      
      @keyframes uiSlideInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      @keyframes uiSlideInDown {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      @keyframes uiScaleIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
      
      @keyframes uiScaleInCentered {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      
      @keyframes uiPulse {
        0%, 100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.05); }
      }
      
      /* Overlay base styles */
      .ui-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }
      
      /* Button base styles */
      .ui-button {
        font-family: var(--w-font-body, 'Rajdhani', sans-serif);
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      
      .ui-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .ui-button:hover:not(:disabled) {
        transform: scale(1.02);
      }
      
      .ui-button:active:not(:disabled) {
        transform: scale(0.98);
      }
    `;
    document.head.appendChild(style);
    this.stylesInjected = true;
  }
}
