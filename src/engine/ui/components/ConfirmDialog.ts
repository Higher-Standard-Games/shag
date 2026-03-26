/**
 * ConfirmDialog - Reusable confirmation dialog
 *
 * Mobile-friendly replacement for browser confirm().
 * Uses Overlay and Button components for consistent styling.
 */

import { UIManager } from "../UIManager";
import { UIStyles } from "../UIStyles";
import { type ButtonVariant, createButtonRow } from "./Button";
import { Overlay } from "./Overlay";
import confirmDialogCSS from "./styles/ConfirmDialog.css?raw";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string; // default: 'Confirm'
  cancelText?: string; // default: 'Cancel'
  confirmVariant?: ButtonVariant; // default: 'danger'
  onConfirm: () => void;
  onCancel?: () => void;
}

export class ConfirmDialog {
  private static overlay: Overlay | null = null;
  private static panel: HTMLDivElement | null = null;
  private static stylesInjected = false;

  private static injectStyles(): void {
    if (ConfirmDialog.stylesInjected) return;
    ConfirmDialog.stylesInjected = true;
    UIStyles.injectCSS("confirm-dialog", confirmDialogCSS);
  }

  /**
   * Show a confirmation dialog
   */
  public static show(options: ConfirmOptions): void {
    // Hide any existing confirm dialog
    ConfirmDialog.hide();
    ConfirmDialog.injectStyles();

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
    ConfirmDialog.overlay = new Overlay(
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
      },
    );
    ConfirmDialog.overlay.show();

    // Create panel
    ConfirmDialog.panel = document.createElement("div");
    ConfirmDialog.panel.className = "ui-confirm-panel";
    ConfirmDialog.panel.style.zIndex = String(UIManager.getInstance().getZIndex("CONFIRM") + 1);

    // Title
    const titleEl = document.createElement("h3");
    titleEl.className = "ui-confirm-title";
    titleEl.textContent = title;
    ConfirmDialog.panel.appendChild(titleEl);

    // Message
    const messageEl = document.createElement("p");
    messageEl.className = "ui-confirm-message";
    messageEl.textContent = message;
    ConfirmDialog.panel.appendChild(messageEl);

    // Buttons
    const buttonRow = createButtonRow([
      {
        text: cancelText,
        variant: "secondary",
        onClick: () => {
          ConfirmDialog.hide();
          onCancel?.();
        },
      },
      {
        text: confirmText,
        variant: confirmVariant,
        onClick: () => {
          ConfirmDialog.hide();
          onConfirm();
        },
      },
    ]);
    ConfirmDialog.panel.appendChild(buttonRow);

    document.body.appendChild(ConfirmDialog.panel);
  }

  /**
   * Hide the confirmation dialog
   */
  public static hide(): void {
    if (ConfirmDialog.panel) {
      ConfirmDialog.panel.style.animation = "uiFadeOut 0.15s ease";
      setTimeout(() => {
        ConfirmDialog.panel?.remove();
        ConfirmDialog.panel = null;
      }, 150);
    }

    if (ConfirmDialog.overlay) {
      ConfirmDialog.overlay.hide();
      ConfirmDialog.overlay = null;
    }
  }

  /**
   * Check if dialog is currently visible
   */
  public static isVisible(): boolean {
    return ConfirmDialog.panel !== null;
  }
}
