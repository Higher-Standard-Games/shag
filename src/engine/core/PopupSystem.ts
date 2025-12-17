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
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(74, 144, 226, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.1);
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: scale(0.9) translateY(20px);
        transition: transform 0.2s ease;
      }

      .popup-visible .popup-container {
        transform: scale(1) translateY(0);
      }

      .popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
      }

      .popup-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #fff;
      }

      .popup-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.15s ease;
      }

      .popup-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }

      .popup-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
        color: rgba(255, 255, 255, 0.9);
      }

      .popup-buttons {
        display: flex;
        gap: 12px;
        padding: 16px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        justify-content: flex-end;
      }

      .popup-btn {
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
      }

      .popup-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .popup-btn-primary {
        background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
        color: #fff;
      }

      .popup-btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, #5a9ff2 0%, #4589cd 100%);
        transform: translateY(-1px);
      }

      .popup-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .popup-btn-secondary:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }

      .popup-btn-danger {
        background: linear-gradient(135deg, #e24a4a 0%, #bd3535 100%);
        color: #fff;
      }

      .popup-btn-danger:hover:not(:disabled) {
        background: linear-gradient(135deg, #f25a5a 0%, #cd4545 100%);
      }
    `;
    document.head.appendChild(style);
  }
}
