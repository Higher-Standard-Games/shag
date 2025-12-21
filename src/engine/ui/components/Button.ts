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

// Light palette color definitions with 3D effect colors
const COLORS = {
  primary: {
    bg: "#4CAF50",              // Solid green
    bgHover: "#5CBF60",         // Lighter on hover
    bgActive: "#3D9140",        // Darker when pressed
    text: "#ffffff",
    border: "#3D9140",          // Bottom border for 3D effect
    shadow: "rgba(61, 145, 64, 0.4)",
  },
  secondary: {
    bg: "#f5f5f5",              // Light gray
    bgHover: "#ffffff",         // White on hover
    bgActive: "#e0e0e0",        // Darker when pressed
    text: "#333333",
    border: "#cccccc",          // Bottom border for 3D effect
    shadow: "rgba(0, 0, 0, 0.1)",
  },
  danger: {
    bg: "#f44336",              // Red
    bgHover: "#ff5252",         // Lighter on hover
    bgActive: "#d32f2f",        // Darker when pressed
    text: "#ffffff",
    border: "#c62828",          // Bottom border for 3D effect
    shadow: "rgba(198, 40, 40, 0.4)",
  },
  ghost: {
    bg: "transparent",
    bgHover: "rgba(0, 0, 0, 0.05)",
    bgActive: "rgba(0, 0, 0, 0.1)",
    text: "#333333",
    border: "transparent",
    shadow: "transparent",
  },
};

// Size definitions
const SIZES = {
  small: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    minWidth: "100px",
    borderRadius: "8px",
    borderWidth: "3px",
  },
  medium: {
    padding: "12px 32px",
    fontSize: "1rem",
    minWidth: "160px",
    borderRadius: "10px",
    borderWidth: "4px",
  },
  large: {
    padding: "16px 48px",
    fontSize: "1.1rem",
    minWidth: "220px",
    borderRadius: "12px",
    borderWidth: "5px",
  },
};

/**
 * Create a styled 3D button element
 */
export function createButton(config: ButtonConfig): HTMLButtonElement {
  const variant = config.variant || "secondary";
  const size = config.size || "medium";
  const playSound = config.playSound !== false; // default true
  const colors = COLORS[variant];
  const sizeStyles = SIZES[size];

  const btn = document.createElement("button");
  btn.className = `ui-button ui-button-${variant} ui-button-${size}`;
  btn.disabled = config.disabled || false;

  // Set content
  if (config.icon) {
    btn.innerHTML = `<span class="ui-button-icon">${config.icon}</span><span>${config.text}</span>`;
  } else {
    btn.textContent = config.text;
  }

  // Apply 3D button styles
  btn.style.cssText = `
    padding: ${sizeStyles.padding};
    font-size: ${sizeStyles.fontSize};
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: ${colors.bg};
    border: none;
    border-bottom: ${sizeStyles.borderWidth} solid ${colors.border};
    border-radius: ${sizeStyles.borderRadius};
    color: ${colors.text};
    cursor: ${config.disabled ? "not-allowed" : "pointer"};
    transition: all 0.1s ease;
    min-width: ${config.fullWidth ? "100%" : sizeStyles.minWidth};
    opacity: ${config.disabled ? "0.5" : "1"};
    font-family: 'Segoe UI', system-ui, sans-serif;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 2px 4px ${colors.shadow};
    position: relative;
    top: 0;
    user-select: none;
  `;

  // Interactive effects (only if not disabled)
  if (!config.disabled) {
    // Hover - lift up slightly
    btn.addEventListener("mouseenter", () => {
      btn.style.background = colors.bgHover;
      btn.style.top = "-1px";
      btn.style.boxShadow = `0 4px 8px ${colors.shadow}`;
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = colors.bg;
      btn.style.top = "0";
      btn.style.boxShadow = `0 2px 4px ${colors.shadow}`;
      btn.style.borderBottomWidth = sizeStyles.borderWidth;
    });

    // Press down - 3D effect
    btn.addEventListener("mousedown", () => {
      btn.style.background = colors.bgActive;
      btn.style.top = sizeStyles.borderWidth;
      btn.style.borderBottomWidth = "0px";
      btn.style.boxShadow = `0 0 2px ${colors.shadow}`;
    });

    btn.addEventListener("mouseup", () => {
      btn.style.background = colors.bgHover;
      btn.style.top = "-1px";
      btn.style.borderBottomWidth = sizeStyles.borderWidth;
      btn.style.boxShadow = `0 4px 8px ${colors.shadow}`;
    });

    // Click handler with sound
    btn.addEventListener("click", () => {
      if (playSound) {
        AudioManager.getInstance().playClick();
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
  row.style.cssText = `
    display: flex;
    gap: ${gap}px;
    justify-content: center;
    flex-wrap: wrap;
  `;

  for (const config of buttons) {
    row.appendChild(createButton(config));
  }

  return row;
}
