/**
 * Button - Factory for creating consistently styled 3D buttons
 * 
 * Part of the unified UI system. Use this for all UI buttons to ensure
 * consistent styling across the application.
 * 
 * Features:
 * - Light palette with 3D pressed effect
 * - Rounded corners for modern look
 * - Click sound effect
 */

import { AudioManager } from "../../AudioManager";
import { UIStyles } from "../UIStyles";
import buttonCSS from "./styles/Button.css?raw";

// Inject button styles once
let buttonStylesInjected = false;
function injectButtonStyles(): void {
  if (buttonStylesInjected) return;
  buttonStylesInjected = true;
  UIStyles.injectCSS("button", buttonCSS);
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "small" | "medium" | "large";

export interface ButtonConfig {
  text: string;
  variant?: ButtonVariant;  // default: 'secondary'
  size?: ButtonSize;        // default: 'medium'
  icon?: string;            // Optional icon HTML/emoji
  disabled?: boolean;
  fullWidth?: boolean;
  playSound?: boolean;      // default: true - play click sound
  onClick: () => void;
}

// Colors and sizes are now defined in Button.css

/**
 * Create a styled 3D button element
 */
export function createButton(config: ButtonConfig): HTMLButtonElement {
  injectButtonStyles();
  
  const variant = config.variant || "secondary";
  const size = config.size || "medium";
  const playSound = config.playSound !== false; // default true

  const btn = document.createElement("button");
  btn.className = `ui-button ui-button-${variant} ui-button-${size}`;
  btn.disabled = config.disabled || false;
  
  if (config.fullWidth) {
    btn.style.width = "100%";
  }

  // Set content
  if (config.icon) {
    btn.innerHTML = `<span class="ui-button-icon">${config.icon}</span><span>${config.text}</span>`;
  } else {
    btn.textContent = config.text;
  }

  // Click handler with sound (only if not disabled)
  if (!config.disabled) {
    btn.addEventListener("click", () => {
      if (playSound) {
        AudioManager.getInstance().playButtonPress();
      }
      config.onClick();
    });
  }

  return btn;
}

/**
 * Create a row of buttons (useful for dialog footers)
 */
export function createButtonRow(
  buttons: ButtonConfig[],
  gap: number = 12
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "ui-button-row";
  if (gap !== 12) {
    row.style.gap = `${gap}px`;
  }

  for (const config of buttons) {
    row.appendChild(createButton(config));
  }

  return row;
}
