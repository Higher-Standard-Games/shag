/**
 * PopupSystem - Generic popup/modal system for the engine
 * 
 * Usage:
 *   PopupSystem.show({
 *     id: "seed_selection",
 *     title: "Select a Seed",
 *     content: "<div>...</div>",
 *     buttons: [{ label: "Cancel", action: "close" }],
 *     onButton: (action) => { ... }
 *   });
 *   PopupSystem.close("seed_selection");
 *   PopupSystem.closeAll();
 */

import { EventBus } from "./EventBus";

export interface PopupButton {
  label: string;
  action: string;
  style?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export interface PopupConfig {
  id: string;
  title?: string;
  content: string | HTMLElement;
  buttons?: PopupButton[];
  onButton?: (action: string) => void;
  onClose?: () => void;
  closeOnOverlay?: boolean; // Default: true
  closeOnEscape?: boolean; // Default: true
  width?: string; // CSS width (default: "400px")
  className?: string; // Additional CSS class
  position?: "center" | "top" | "bottom"; // Default: "center"
}

interface ActivePopup {
  config: PopupConfig;
  element: HTMLElement;
  overlay: HTMLElement;
}

export class PopupSystem {
  private static popups: Map<string, ActivePopup> = new Map();
  private static styleInjected: boolean = false;

  /**
   * Show a popup
   */
  public static show(config: PopupConfig): void {
    // Close existing popup with same ID
    if (this.popups.has(config.id)) {
      this.close(config.id);
    }

    this.injectStyles();

    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = "popup-overlay";
    overlay.dataset.popupId = config.id;

    if (config.closeOnOverlay !== false) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          this.close(config.id);
        }
      });
    }

    // Create popup container
    const popup = document.createElement("div");
    popup.className = `popup-container ${config.className || ""}`;
    popup.style.width = config.width || "400px";
    
    if (config.position === "top") {
      popup.style.marginTop = "80px";
      popup.style.marginBottom = "auto";
    } else if (config.position === "bottom") {
      popup.style.marginTop = "auto";
      popup.style.marginBottom = "80px";
    }

    // Build popup HTML
    let html = "";

    if (config.title) {
      html += `
        <div class="popup-header">
          <h3 class="popup-title">${config.title}</h3>
          <button class="popup-close" data-action="close">&times;</button>
        </div>
      `;
    }

    html += `<div class="popup-content"></div>`;

    if (config.buttons && config.buttons.length > 0) {
      html += `<div class="popup-buttons">`;
      for (const btn of config.buttons) {
        const styleClass = btn.style || "secondary";
        const disabled = btn.disabled ? "disabled" : "";
        html += `<button class="popup-btn popup-btn-${styleClass}" data-action="${btn.action}" ${disabled}>${btn.label}</button>`;
      }
      html += `</div>`;
    }

    popup.innerHTML = html;

    // Set content
    const contentEl = popup.querySelector(".popup-content")!;
    if (typeof config.content === "string") {
      contentEl.innerHTML = config.content;
    } else {
      contentEl.appendChild(config.content);
    }

    // Add button handlers
    popup.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = (btn as HTMLElement).dataset.action!;
        if (action === "close") {
          this.close(config.id);
        } else if (config.onButton) {
          config.onButton(action);
        }
      });
    });

    // Add to DOM
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Handle escape key
    if (config.closeOnEscape !== false) {
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          this.close(config.id);
          document.removeEventListener("keydown", escHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
    }

    // Store reference
    this.popups.set(config.id, { config, element: popup, overlay });

    // Emit event
    EventBus.emit("popup:opened", { id: config.id });

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add("popup-visible");
    });
  }

  /**
   * Close a specific popup
   */
  public static close(id: string): void {
    const popup = this.popups.get(id);
    if (!popup) return;

    popup.overlay.classList.remove("popup-visible");
    
    // Wait for animation
    setTimeout(() => {
      popup.overlay.remove();
      this.popups.delete(id);
      
      if (popup.config.onClose) {
        popup.config.onClose();
      }
      
      EventBus.emit("popup:closed", { id });
    }, 200);
  }

  /**
   * Close all popups
   */
  public static closeAll(): void {
    for (const id of this.popups.keys()) {
      this.close(id);
    }
  }

  /**
   * Check if a popup is open
   */
  public static isOpen(id: string): boolean {
    return this.popups.has(id);
  }

  /**
   * Update popup content
   */
  public static updateContent(id: string, content: string | HTMLElement): void {
    const popup = this.popups.get(id);
    if (!popup) return;

    const contentEl = popup.element.querySelector(".popup-content");
    if (!contentEl) return;

    if (typeof content === "string") {
      contentEl.innerHTML = content;
    } else {
      contentEl.innerHTML = "";
      contentEl.appendChild(content);
    }
  }

  /**
   * Get popup element for direct manipulation
   */
  public static getElement(id: string): HTMLElement | null {
    return this.popups.get(id)?.element || null;
  }

  private static injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      .popup-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .popup-overlay.popup-visible {
        opacity: 1;
      }

      .popup-container {
        background: #FAFAFA;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1);
        border: 1px solid #E0E0E0;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: scale(0.9) translateY(20px);
        transition: transform 0.2s ease;
        font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      }

      .popup-visible .popup-container {
        transform: scale(1) translateY(0);
      }

      .popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 22px;
        border-bottom: 1px solid #E0E0E0;
        background: #FFFFFF;
      }

      .popup-title {
        margin: 0;
        font-size: 20px;
        font-weight: 800;
        color: #333333;
      }

      .popup-close {
        background: #E8E8E8;
        border: none;
        color: #666666;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.15s ease;
      }

      .popup-close:hover {
        background: #DDDDDD;
        color: #333333;
      }

      .popup-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
        color: #333333;
        background: #FFFFFF;
      }

      .popup-buttons {
        display: flex;
        gap: 12px;
        padding: 16px 22px;
        border-top: 1px solid #E0E0E0;
        background: #F5F5F5;
        justify-content: flex-end;
      }

      .popup-btn {
        padding: 12px 24px;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.1s ease;
        border: none;
        font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
        position: relative;
        top: 0;
      }

      .popup-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .popup-btn-primary {
        background: #4CAF50;
        border-bottom: 3px solid #388E3C;
        color: #fff;
      }

      .popup-btn-primary:hover:not(:disabled) {
        background: #5CBF60;
        top: -1px;
      }

      .popup-btn-primary:active:not(:disabled) {
        top: 2px;
        border-bottom-width: 1px;
      }

      .popup-btn-secondary {
        background: #E0E0E0;
        border-bottom: 3px solid #BDBDBD;
        color: #666666;
      }

      .popup-btn-secondary:hover:not(:disabled) {
        background: #EEEEEE;
        top: -1px;
      }

      .popup-btn-danger {
        background: #F44336;
        border-bottom: 3px solid #D32F2F;
        color: #fff;
      }

      .popup-btn-danger:hover:not(:disabled) {
        background: #EF5350;
        top: -1px;
      }
    `;
    document.head.appendChild(style);
  }
}
