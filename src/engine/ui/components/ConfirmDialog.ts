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
/** How the dialog showing settles: once, by its buttons, Escape, or a newer dialog. */
let settle: ((answer: "confirm" | "cancel" | "dismiss") => void) | null = null;
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
  // Take down any existing confirm dialog, answering nothing for it
  settle?.("dismiss");
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

  // Each dialog settles once: its buttons and Escape each take it down with
  // the one callback that belongs to them; a newer dialog takes it down silently
  let settled = false;
  settle = (answer) => {
    if (settled) return;
    settled = true;
    settle = null;
    ConfirmDialog.hide();
    if (answer === "confirm") onConfirm();
    else if (answer === "cancel") onCancel?.();
  };
  const answer = settle;

  // Create overlay (don't close on click for confirm dialogs). Its close is
  // Escape (or this dialog being hidden), which cancels.
  overlay = new Overlay(
    {
      id: "confirm-dialog",
      opacity: 0.8,
      blur: 0,
      zIndex: UIManager.getInstance().getZIndex("CONFIRM"),
      closeOnClick: false,
      animate: true,
    },
    () => answer("cancel"),
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
      onClick: () => answer("cancel"),
    },
    {
      text: confirmText,
      variant: confirmVariant,
      onClick: () => answer("confirm"),
    },
  ]);
  panel.appendChild(buttonRow);

  document.body.appendChild(panel);
}

/**
 * Hide the confirmation dialog
 */
function hide(): void {
  // This panel goes, never a newer one shown before the fade is over
  const leaving = panel;
  panel = null;
  if (leaving) {
    leaving.style.animation = "uiFadeOut 0.15s ease";
    setTimeout(() => leaving.remove(), 150);
  }

  const closing = overlay;
  overlay = null;
  // Hidden from outside, the dialog is cancelled (its overlay's close answers)
  closing?.hide();
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
