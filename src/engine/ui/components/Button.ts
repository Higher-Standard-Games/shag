/**
 * Button - Factory for creating consistently styled buttons
 * 
 * Part of the unified UI system. Use this for all UI buttons to ensure
 * consistent styling across the application.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "small" | "medium" | "large";

export interface ButtonConfig {
  text: string;
  variant?: ButtonVariant;  // default: 'secondary'
  size?: ButtonSize;        // default: 'medium'
  icon?: string;            // Optional icon HTML/emoji
  disabled?: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}

// Color definitions
const COLORS = {
  primary: {
    bg: "rgba(76, 175, 80, 0.3)",
    bgHover: "rgba(76, 175, 80, 0.5)",
    border: "rgba(76, 175, 80, 0.5)",
    borderHover: "rgba(76, 175, 80, 0.7)",
  },
  secondary: {
    bg: "rgba(255, 255, 255, 0.1)",
    bgHover: "rgba(255, 255, 255, 0.2)",
    border: "rgba(255, 255, 255, 0.2)",
    borderHover: "rgba(255, 255, 255, 0.3)",
  },
  danger: {
    bg: "rgba(244, 67, 54, 0.3)",
    bgHover: "rgba(244, 67, 54, 0.5)",
    border: "rgba(244, 67, 54, 0.5)",
    borderHover: "rgba(244, 67, 54, 0.7)",
  },
  ghost: {
    bg: "transparent",
    bgHover: "rgba(255, 255, 255, 0.1)",
    border: "transparent",
    borderHover: "rgba(255, 255, 255, 0.1)",
  },
};

// Size definitions
const SIZES = {
  small: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    minWidth: "80px",
  },
  medium: {
    padding: "12px 32px",
    fontSize: "1rem",
    minWidth: "120px",
  },
  large: {
    padding: "16px 48px",
    fontSize: "1.1rem",
    minWidth: "180px",
  },
};

/**
 * Create a styled button element
 */
export function createButton(config: ButtonConfig): HTMLButtonElement {
  const variant = config.variant || "secondary";
  const size = config.size || "medium";
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

  // Apply styles
  btn.style.cssText = `
    padding: ${sizeStyles.padding};
    font-size: ${sizeStyles.fontSize};
    font-weight: 400;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: ${colors.bg};
    border: 1px solid ${colors.border};
    border-radius: 8px;
    color: #fff;
    cursor: ${config.disabled ? "not-allowed" : "pointer"};
    transition: all 0.2s ease;
    min-width: ${config.fullWidth ? "100%" : sizeStyles.minWidth};
    opacity: ${config.disabled ? "0.5" : "1"};
    font-family: 'Segoe UI', system-ui, sans-serif;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  `;

  // Hover effects (only if not disabled)
  if (!config.disabled) {
    btn.addEventListener("mouseenter", () => {
      btn.style.background = colors.bgHover;
      btn.style.borderColor = colors.borderHover;
      btn.style.transform = "scale(1.02)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = colors.bg;
      btn.style.borderColor = colors.border;
      btn.style.transform = "scale(1)";
    });

    btn.addEventListener("mousedown", () => {
      btn.style.transform = "scale(0.98)";
    });

    btn.addEventListener("mouseup", () => {
      btn.style.transform = "scale(1.02)";
    });

    btn.addEventListener("click", config.onClick);
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
