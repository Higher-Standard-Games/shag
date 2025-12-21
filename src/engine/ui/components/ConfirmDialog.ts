/**
 * ConfirmDialog - Reusable confirmation dialog
 * 
 * Mobile-friendly replacement for browser confirm().
 * Uses Overlay and Button components for consistent styling.
 */

import { UIManager } from "../UIManager";
import { Overlay } from "./Overlay";
import { createButtonRow, type ButtonVariant } from "./Button";

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

  /**
   * Show a confirmation dialog
   */
  public static show(options: ConfirmOptions): void {
    // Hide any existing confirm dialog
    this.hide();

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
    this.panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(to bottom, rgba(40, 40, 40, 0.98), rgba(25, 25, 25, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 32px 40px;
      max-width: 400px;
      width: 90%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      z-index: ${UIManager.getInstance().getZIndex("CONFIRM") + 1};
      animation: uiScaleIn 0.2s ease;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    // Title
    const titleEl = document.createElement("h3");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      color: #fff;
      font-size: 1.5rem;
      font-weight: 400;
      margin: 0 0 12px 0;
    `;
    this.panel.appendChild(titleEl);

    // Message
    const messageEl = document.createElement("p");
    messageEl.textContent = message;
    messageEl.style.cssText = `
      color: #aaa;
      font-size: 1rem;
      margin: 0 0 24px 0;
      line-height: 1.5;
    `;
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
