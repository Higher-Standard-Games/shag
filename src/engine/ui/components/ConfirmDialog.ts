/**
 * ConfirmDialog - Reusable confirmation dialog
 * 
 * Mobile-friendly replacement for browser confirm().
 * Uses Overlay and Button components for consistent styling.
 */

import { UIManager } from "../UIManager";
import { Overlay } from "./Overlay";
import { createButtonRow, type ButtonVariant } from "./Button";
import { UIStyles } from "../UIStyles";
import confirmDialogCSS from "./styles/ConfirmDialog.css?raw";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;        // default: 'Confirm'
  cancelText?: string;         // default: 'Cancel'
  confirmVariant?: ButtonVariant;  // default: 'danger'
  onConfirm: () => void;
  onCancel?: () => void;
}

export class ConfirmDialog {
  private static overlay: Overlay | null = null;
  private static panel: HTMLDivElement | null = null;
  private static stylesInjected = false;

  private static injectStyles(): void {
    if (this.stylesInjected) return;
    this.stylesInjected = true;
    UIStyles.injectCSS("confirm-dialog", confirmDialogCSS);
  }

  /**
   * Show a confirmation dialog
   */
  public static show(options: ConfirmOptions): void {
    // Hide any existing confirm dialog
    this.hide();
    this.injectStyles();

    const {
      title,
      message,
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmVariant = "danger",
      onConfirm,
      onCancel,
    } = options;

    // Create overlay (don't close on click for confirm dialogs)
    this.overlay = new Overlay(
      {
        id: "confirm-dialog",
        opacity: 0.8,
        blur: 0,
        zIndex: UIManager.getInstance().getZIndex("CONFIRM"),
        closeOnClick: false,
        animate: true,
      },
      () => {
        // Called when overlay is closed (e.g., by ESC)
        onCancel?.();
      }
    );
    this.overlay.show();

    // Create panel
    this.panel = document.createElement("div");
    this.panel.className = "ui-confirm-panel";
    this.panel.style.zIndex = String(UIManager.getInstance().getZIndex("CONFIRM") + 1);

    // Title
    const titleEl = document.createElement("h3");
    titleEl.className = "ui-confirm-title";
    titleEl.textContent = title;
    this.panel.appendChild(titleEl);

    // Message
    const messageEl = document.createElement("p");
    messageEl.className = "ui-confirm-message";
    messageEl.textContent = message;
    this.panel.appendChild(messageEl);

    // Buttons
    const buttonRow = createButtonRow([
      {
        text: cancelText,
        variant: "secondary",
        onClick: () => {
          this.hide();
          onCancel?.();
        },
      },
      {
        text: confirmText,
        variant: confirmVariant,
        onClick: () => {
          this.hide();
          onConfirm();
        },
      },
    ]);
    this.panel.appendChild(buttonRow);

    document.body.appendChild(this.panel);
  }

  /**
   * Hide the confirmation dialog
   */
  public static hide(): void {
    if (this.panel) {
      this.panel.style.animation = "uiFadeOut 0.15s ease";
      setTimeout(() => {
        this.panel?.remove();
        this.panel = null;
      }, 150);
    }

    if (this.overlay) {
      this.overlay.hide();
      this.overlay = null;
    }
  }

  /**
   * Check if dialog is currently visible
   */
  public static isVisible(): boolean {
    return this.panel !== null;
  }
}
