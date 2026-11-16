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

let overlay: Overlay | null = null;
let panel: HTMLDivElement | null = null;
let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  UIStyles.injectCSS("confirm-dialog", confirmDialogCSS);
}

/**
 * Show a confirmation dialog
 */
function show(options: ConfirmOptions): void {
  // Hide any existing confirm dialog
  ConfirmDialog.hide();
  injectStyles();

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
  overlay = new Overlay(
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
  overlay.show();

  // Create panel
  panel = document.createElement("div");
  panel.className = "ui-confirm-panel";
  panel.style.zIndex = String(UIManager.getInstance().getZIndex("CONFIRM") + 1);

  // Title
  const titleEl = document.createElement("h3");
  titleEl.className = "ui-confirm-title";
  titleEl.textContent = title;
  panel.appendChild(titleEl);

  // Message
  const messageEl = document.createElement("p");
  messageEl.className = "ui-confirm-message";
  messageEl.textContent = message;
  panel.appendChild(messageEl);

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
  panel.appendChild(buttonRow);

  document.body.appendChild(panel);
}

/**
 * Hide the confirmation dialog
 */
function hide(): void {
  if (panel) {
    panel.style.animation = "uiFadeOut 0.15s ease";
    setTimeout(() => {
      panel?.remove();
      panel = null;
    }, 150);
  }

  if (overlay) {
    overlay.hide();
    overlay = null;
  }
}

/**
 * Check if dialog is currently visible
 */
function isVisible(): boolean {
  return panel !== null;
}

export const ConfirmDialog = {
  show,
  hide,
  isVisible,
};
