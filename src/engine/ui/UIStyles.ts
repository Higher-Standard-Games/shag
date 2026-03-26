/**
 * UIStyles - CSS injection system
 *
 * Provides utilities for injecting CSS into the document.
 * Components can use this to load their own CSS files or inline styles.
 *
 * Usage:
 *   // Inject base styles once on app init
 *   UIStyles.injectBase();
 *
 *   // Components inject their own styles
 *   UIStyles.injectCSS("quest-panel", questPanelCSS);
 *
 *   // Or import from .css file (requires bundler support)
 *   import styles from "./QuestPanel.css?raw";
 *   UIStyles.injectCSS("quest-panel", styles);
 */

export class UIStyles {
  private static injectedIds = new Set<string>();
  private static mobileStyleElement: HTMLStyleElement | null = null;
  private static mobileCSS: string = "";

  /**
   * Inject CSS with a unique ID. Safe to call multiple times -
   * styles with the same ID are only injected once.
   * Mobile overrides are automatically re-appended to maintain priority.
   */
  public static injectCSS(id: string, css: string): void {
    if (UIStyles.injectedIds.has(id)) return;

    const style = document.createElement("style");
    style.id = `ui-styles-${id}`;
    style.textContent = css;
    document.head.appendChild(style);
    UIStyles.injectedIds.add(id);

    // Re-append mobile styles to ensure they come last (highest priority)
    UIStyles.reapplyMobileStyles();
  }

  /**
   * Set mobile/responsive CSS overrides. These are always injected LAST
   * to ensure they override component styles.
   */
  public static setMobileCSS(css: string): void {
    UIStyles.mobileCSS = css;
    UIStyles.reapplyMobileStyles();
  }

  /**
   * Re-append mobile styles to end of head (ensures highest priority)
   */
  private static reapplyMobileStyles(): void {
    if (!UIStyles.mobileCSS) return;

    // Remove existing mobile style element
    if (UIStyles.mobileStyleElement) {
      UIStyles.mobileStyleElement.remove();
    }

    // Create and append at end of head
    UIStyles.mobileStyleElement = document.createElement("style");
    UIStyles.mobileStyleElement.id = "ui-styles-mobile-overrides";
    UIStyles.mobileStyleElement.textContent = UIStyles.mobileCSS;
    document.head.appendChild(UIStyles.mobileStyleElement);

    console.log(`[UIStyles] Mobile CSS reapplied (${UIStyles.mobileCSS.length} chars), now last in head`);
  }

  /**
   * Remove injected styles by ID
   */
  public static removeCSS(id: string): void {
    const style = document.getElementById(`ui-styles-${id}`);
    if (style) {
      style.remove();
      UIStyles.injectedIds.delete(id);
    }
  }

  /**
   * Check if styles with given ID are already injected
   */
  public static hasCSS(id: string): boolean {
    return UIStyles.injectedIds.has(id);
  }

  /**
   * Inject all base/shared UI styles. Call once on app init.
   */
  public static injectBase(): void {
    if (UIStyles.injectedIds.has("base")) return;

    const allStyles = [
      UIStyles.getBaseStyles(),
      UIStyles.getConsoleStyles(),
      UIStyles.getAnimations(),
      UIStyles.getTypography(),
      UIStyles.getButtons(),
      UIStyles.getDialogs(),
      UIStyles.getPanels(),
      UIStyles.getCards(),
      UIStyles.getForms(),
      UIStyles.getPauseMenu(),
      UIStyles.getLoadingScreen(),
      UIStyles.getEffects(),
      UIStyles.getUtilities(),
    ].join("\n\n");

    UIStyles.injectCSS("base", allStyles);
    console.log("[UIStyles] Base styles injected");
  }

  // ==================== Base Styles ====================

  private static getBaseStyles(): string {
    return `
/* ==================== Base / Reset ==================== */
.ui-base {
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  box-sizing: border-box;
}

.ui-base *, .ui-base *::before, .ui-base *::after {
  box-sizing: inherit;
}
`;
  }

  // ==================== Console Styles (SHAG Palette) ====================

  /**
   * Console color scheme using SHAG logo palette.
   * Games can override by calling UIStyles.setConsoleColors() before init.
   */
  private static consoleColors = {
    // Primary accent (teal from SHAG logo)
    primary: "#2EC4B6",
    primaryDim: "rgba(46, 196, 182, 0.4)",
    primaryGlow: "rgba(46, 196, 182, 0.6)",

    // SHAG palette for variety
    orange: "#E85D04",
    yellow: "#FAC748",
    teal: "#2EC4B6",
    magenta: "#E040FB",
    green: "#4ADE80",

    // Semantic colors
    error: "#ff6b6b",
    warn: "#FAC748",
    info: "#54a0ff",
    success: "#4ADE80",

    // Text
    text: "#c8c8c8",
    textBright: "#e8e8e8",
    textDim: "rgba(255, 255, 255, 0.4)",

    // Background
    bg: "rgba(10, 12, 16, 0.95)",
    bgHeader: "rgba(46, 196, 182, 0.15)",
    bgInput: "rgba(0, 0, 0, 0.3)",
  };

  /**
   * Allow games to customize console colors before UIStyles.injectBase()
   */
  public static setConsoleColors(colors: Partial<typeof UIStyles.consoleColors>): void {
    UIStyles.consoleColors = { ...UIStyles.consoleColors, ...colors };
  }

  /**
   * Get current console colors (for programmatic access)
   */
  public static getConsoleColors(): typeof UIStyles.consoleColors {
    return { ...UIStyles.consoleColors };
  }

  private static getConsoleStyles(): string {
    const c = UIStyles.consoleColors;
    return `
/* ==================== Console Color Variables ==================== */
:root {
  /* Console primary accent */
  --console-primary: ${c.primary};
  --console-primary-dim: ${c.primaryDim};
  --console-primary-glow: ${c.primaryGlow};
  
  /* SHAG palette */
  --console-orange: ${c.orange};
  --console-yellow: ${c.yellow};
  --console-teal: ${c.teal};
  --console-magenta: ${c.magenta};
  --console-green: ${c.green};
  
  /* Semantic */
  --console-error: ${c.error};
  --console-warn: ${c.warn};
  --console-info: ${c.info};
  --console-success: ${c.success};
  
  /* Text */
  --console-text: ${c.text};
  --console-text-bright: ${c.textBright};
  --console-text-dim: ${c.textDim};
  
  /* Backgrounds */
  --console-bg: ${c.bg};
  --console-bg-header: ${c.bgHeader};
  --console-bg-input: ${c.bgInput};
}
`;
  }

  // ==================== Animations ====================

  private static getAnimations(): string {
    return `
/* ==================== Animations ==================== */
@keyframes ui-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ui-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes ui-slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes ui-slide-down {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes ui-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes ui-scale-in-centered {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes ui-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}

@keyframes ui-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.ui-animate-fade-in { animation: ui-fade-in 0.2s ease-out; }
.ui-animate-slide-up { animation: ui-slide-up 0.25s ease-out; }
.ui-animate-slide-down { animation: ui-slide-down 0.25s ease-out; }
.ui-animate-scale-in { animation: ui-scale-in 0.2s ease-out; }
.ui-animate-scale-in-centered { animation: ui-scale-in-centered 0.2s ease-out; }
`;
  }

  // ==================== Typography ====================

  private static getTypography(): string {
    return `
/* ==================== Typography ==================== */
.ui-text {
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  color: #333333;
  line-height: 1.5;
}

.ui-text--light { color: #666666; }
.ui-text--muted { color: #999999; }
.ui-text--success { color: #166534; }
.ui-text--warning { color: #92400E; }
.ui-text--error { color: #DC2626; }

.ui-text--xs { font-size: 0.75rem; }
.ui-text--sm { font-size: 0.875rem; }
.ui-text--md { font-size: 1rem; }
.ui-text--lg { font-size: 1.125rem; }
.ui-text--xl { font-size: 1.25rem; }
.ui-text--2xl { font-size: 1.5rem; }

.ui-text--bold { font-weight: 700; }
.ui-text--extrabold { font-weight: 800; }

.ui-heading {
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  font-weight: 800;
  color: #333333;
  letter-spacing: -0.02em;
  margin: 0;
}

.ui-heading--sm { font-size: 1rem; }
.ui-heading--md { font-size: 1.25rem; }
.ui-heading--lg { font-size: 1.5rem; }
.ui-heading--xl { font-size: 2rem; }
`;
  }

  // ==================== Buttons ====================

  private static getButtons(): string {
    return `
/* ==================== Buttons ==================== */
.ui-btn {
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  font-weight: 600;
  font-size: 1rem;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.ui-btn:active {
  transform: translateY(2px);
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Primary Button - Green */
.ui-btn--primary {
  background: linear-gradient(180deg, #4ADE80 0%, #22C55E 100%);
  color: #FFFFFF;
  box-shadow: 
    0 4px 0 #16A34A,
    0 6px 12px rgba(34, 197, 94, 0.3);
}

.ui-btn--primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #5EE892 0%, #2DD468 100%);
}

.ui-btn--primary:active:not(:disabled) {
  box-shadow: 
    0 2px 0 #16A34A,
    0 3px 6px rgba(34, 197, 94, 0.3);
}

/* Secondary Button - Gray */
.ui-btn--secondary {
  background: linear-gradient(180deg, #F5F5F5 0%, #E8E8E8 100%);
  color: #333333;
  box-shadow: 
    0 4px 0 #CCCCCC,
    0 6px 12px rgba(0, 0, 0, 0.1);
}

.ui-btn--secondary:hover:not(:disabled) {
  background: linear-gradient(180deg, #FFFFFF 0%, #F0F0F0 100%);
}

.ui-btn--secondary:active:not(:disabled) {
  box-shadow: 
    0 2px 0 #CCCCCC,
    0 3px 6px rgba(0, 0, 0, 0.1);
}

/* Danger Button - Red */
.ui-btn--danger {
  background: linear-gradient(180deg, #F87171 0%, #EF4444 100%);
  color: #FFFFFF;
  box-shadow: 
    0 4px 0 #DC2626,
    0 6px 12px rgba(239, 68, 68, 0.3);
}

.ui-btn--danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #FCA5A5 0%, #F87171 100%);
}

.ui-btn--danger:active:not(:disabled) {
  box-shadow: 
    0 2px 0 #DC2626,
    0 3px 6px rgba(239, 68, 68, 0.3);
}

/* Button Sizes */
.ui-btn--sm {
  font-size: 0.875rem;
  padding: 8px 16px;
  border-radius: 8px;
}

.ui-btn--lg {
  font-size: 1.125rem;
  padding: 16px 32px;
  border-radius: 12px;
}

.ui-btn--full {
  width: 100%;
}

/* Icon Button */
.ui-btn--icon {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 10px;
}

.ui-btn--icon.ui-btn--sm {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}
`;
  }

  // ==================== Dialogs ====================

  private static getDialogs(): string {
    return `
/* ==================== Dialogs ==================== */
.ui-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 900;
  animation: ui-fade-in 0.2s ease-out;
}

.ui-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #FAFAFA;
  border: 1px solid #E0E0E0;
  border-radius: 12px;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.15),
    0 4px 16px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ui-scale-in-centered 0.25s ease-out;
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
}

.ui-dialog--sm { width: 400px; max-width: 95vw; }
.ui-dialog--md { width: 550px; max-width: 95vw; }
.ui-dialog--lg { width: 700px; max-width: 95vw; }
.ui-dialog--xl { width: 900px; max-width: 95vw; }

.ui-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: #F5F5F5;
  border-bottom: 1px solid #E0E0E0;
}

.ui-dialog__title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
  color: #333333;
  letter-spacing: -0.02em;
}

.ui-dialog__close {
  width: 32px;
  height: 32px;
  border: none;
  background: #E8E8E8;
  border-radius: 6px;
  color: #666666;
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.ui-dialog__close:hover {
  background: #FFDDDD;
  color: #D32F2F;
}

.ui-dialog__body {
  padding: 20px;
  overflow-y: auto;
  color: #333333;
  line-height: 1.6;
}

.ui-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  background: #F5F5F5;
  border-top: 1px solid #E0E0E0;
}
`;
  }

  // ==================== Panels ====================

  private static getPanels(): string {
    return `
/* ==================== Panels ==================== */
.ui-panel {
  background: #FAFAFA;
  border: 1px solid #E0E0E0;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
}

.ui-panel__header {
  padding: 16px 20px;
  border-bottom: 1px solid #E0E0E0;
}

.ui-panel__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  color: #333333;
  letter-spacing: -0.02em;
}

.ui-panel__body {
  padding: 16px 20px;
}

.ui-panel__footer {
  padding: 12px 20px;
  border-top: 1px solid #E0E0E0;
  background: #F5F5F5;
}

/* Side Panel */
.ui-side-panel {
  position: fixed;
  top: 80px;
  width: 320px;
  max-height: calc(100vh - 220px);
  background: #FAFAFA;
  border: 1px solid #E0E0E0;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  z-index: 100;
}

.ui-side-panel--left { left: 16px; }
.ui-side-panel--right { right: 16px; }
`;
  }

  // ==================== Cards ====================

  private static getCards(): string {
    return `
/* ==================== Cards ==================== */
.ui-card {
  background: #FFFFFF;
  border: 1px solid #E0E0E0;
  border-radius: 10px;
  padding: 16px;
  transition: all 0.15s ease;
}

.ui-card--interactive {
  cursor: pointer;
}

.ui-card--interactive:hover {
  border-color: #BDBDBD;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ui-card--selected {
  background: #E8F5E9;
  border-color: #4CAF50;
}

.ui-card--success {
  background: #F0FDF4;
  border-color: #86EFAC;
}

.ui-card--warning {
  background: #FFFBEB;
  border-color: #FCD34D;
}

.ui-card--error {
  background: #FEF2F2;
  border-color: #FECACA;
}

/* List Item Card */
.ui-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #FFFFFF;
  border: 2px solid #E0E0E0;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.ui-list-item:hover {
  border-color: #BDBDBD;
}

.ui-list-item--selected {
  background: #E8F5E9;
  border-color: #4CAF50;
}

.ui-list-item__icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.ui-list-item__content {
  flex: 1;
  min-width: 0;
}

.ui-list-item__title {
  font-weight: 600;
  color: #333333;
}

.ui-list-item__subtitle {
  font-size: 0.85rem;
  color: #666666;
}

.ui-list-item__check {
  color: #4CAF50;
  font-size: 1.2rem;
}
`;
  }

  // ==================== Forms ====================

  private static getForms(): string {
    return `
/* ==================== Forms ==================== */
.ui-input {
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  font-size: 1rem;
  padding: 12px 16px;
  border: 2px solid #E0E0E0;
  border-radius: 8px;
  background: #FFFFFF;
  color: #333333;
  width: 100%;
  transition: all 0.15s ease;
}

.ui-input:focus {
  outline: none;
  border-color: #4CAF50;
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.2);
}

.ui-input::placeholder {
  color: #999999;
}

/* Slider */
.ui-slider {
  -webkit-appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: #E0E0E0;
  outline: none;
}

.ui-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #4CAF50;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: all 0.15s ease;
}

.ui-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

/* Toggle */
.ui-toggle {
  position: relative;
  width: 52px;
  height: 28px;
  background: #E0E0E0;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ui-toggle--active {
  background: #4CAF50;
}

.ui-toggle__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  background: #FFFFFF;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.ui-toggle--active .ui-toggle__knob {
  left: 26px;
}

/* Label */
.ui-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: #333333;
  margin-bottom: 8px;
}

.ui-label--inline {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 0;
}
`;
  }

  // ==================== Pause Menu ====================

  private static getPauseMenu(): string {
    return `
/* ==================== Pause Menu ==================== */
.ui-pause-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  animation: ui-scale-in-centered 0.2s ease;
}

.ui-pause-title {
  color: #fff;
  font-size: 2.5rem;
  font-weight: 300;
  letter-spacing: 0.3em;
  margin: 0 0 24px 0;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
}

@keyframes ui-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

.ui-pause-panel--hiding {
  animation: ui-fade-out 0.2s ease forwards;
}
`;
  }

  // ==================== Loading Screen ====================

  private static getLoadingScreen(): string {
    return `
/* ==================== Loading Screen ==================== */
.ui-loading-screen {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000000;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  font-family: var(--w-font-body, 'Rajdhani', sans-serif);
  color: #fff;
}

.ui-loading-screen--hiding {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.ui-loading-logo {
  width: 280px;
  height: auto;
  margin-bottom: 40px;
}

.ui-loading-progress {
  width: 300px;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.ui-loading-progress__fill {
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #1a5a2a, #2d8a3e);
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(45, 138, 62, 0.5);
}

.ui-loading-branding {
  position: absolute;
  bottom: 16px;
  right: 16px;
  text-align: right;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  line-height: 1.4;
}

.ui-loading-branding__name {
  font-weight: 600;
  font-size: 12px;
}

.ui-loading-branding__tagline {
  font-size: 10px;
  font-style: italic;
}

.ui-loading-branding__version {
  font-size: 10px;
  margin-top: 4px;
}

/* Status text - bottom left corner */
.ui-loading-status {
  position: absolute;
  bottom: 16px;
  left: 16px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-family: 'Consolas', 'Monaco', monospace;
  text-transform: lowercase;
  transition: opacity 0.5s ease;
}

.ui-loading-status--ready {
  color: rgba(74, 222, 128, 0.6);
}

.ui-loading-status--fade {
  opacity: 0;
}

/* Ready state (tap to start) */
.ui-loading-screen--ready {
  cursor: pointer;
}

.ui-loading-glow-container {
  position: absolute;
  bottom: -5%;
  left: 50%;
  transform: translateX(-50%);
  width: 150%;
  height: 25%;
  pointer-events: none;
}

.ui-loading-glow-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
}

.ui-loading-glow-layer--active {
  opacity: 1;
}

/* Smoke effect container */
.ui-loading-smoke-container {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  z-index: 1;
}

/* Individual smoke puff */
.ui-loading-smoke-puff {
  position: absolute;
  bottom: -20%;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0;
  animation: ui-smoke-rise 8s ease-out infinite;
  transition: background 2s ease-in-out;
}

/* Smoke rise animation - drifts up, rotates, fades */
@keyframes ui-smoke-rise {
  0% {
    transform: translateY(0) translateX(0) rotate(0deg) scale(0.5);
    opacity: 0;
  }
  5% {
    opacity: 0.5;
  }
  30% {
    opacity: 0.35;
  }
  50% {
    opacity: 0;
  }
  100% {
    transform: translateY(-70vh) translateX(var(--drift-x, 50px)) rotate(var(--rotation, 180deg)) scale(1.8);
    opacity: 0;
  }
}

.ui-loading-ripple-container {
  position: relative;
  width: 80px;
  height: 80px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
}

.ui-loading-center-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  animation: ui-loading-center-pulse 2s ease-in-out infinite;
  z-index: 2;
  transition: background 0.5s ease, box-shadow 0.5s ease;
}

.ui-loading-ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border-style: solid;
  border-width: 3px;
  animation: ui-loading-ripple-wave 2.4s ease-out infinite;
  opacity: 0;
}

@keyframes ui-loading-ripple-wave {
  0% {
    width: 20px;
    height: 20px;
    opacity: 0.8;
    border-width: 3px;
  }
  100% {
    width: 120px;
    height: 120px;
    opacity: 0;
    border-width: 1px;
  }
}

@keyframes ui-loading-center-pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 20px rgba(37, 182, 120, 0.6);
  }
  50% {
    transform: scale(1.2);
    box-shadow: 0 0 30px rgba(99, 211, 199, 0.8), 0 0 50px rgba(37, 182, 120, 0.4);
  }
}
`;
  }

  // ==================== Effects ====================

  private static getEffects(): string {
    return `
/* ==================== Effects ==================== */
.ui-thunder-flash {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: linear-gradient(180deg, rgba(200, 210, 255, 0.3) 0%, rgba(180, 190, 230, 0.1) 100%);
  opacity: 0;
  pointer-events: none;
  z-index: 9999;
  transition: opacity 0.08s ease-out;
}

.ui-screen-transition {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  opacity: 0;
  pointer-events: none;
  z-index: 100;
  transition: opacity 0.2s ease-in-out;
}

.ui-debug-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 99999;
}

.ui-debug-info {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.8);
  color: #0f0;
  font-family: monospace;
  font-size: 12px;
  padding: 10px;
  border-radius: 4px;
  white-space: pre;
}

.ui-debug-safe-area {
  position: absolute;
  left: 0;
  width: 100%;
  background: rgba(255, 0, 0, 0.3);
  pointer-events: none;
}

.ui-debug-safe-area--top {
  top: 0;
}

.ui-debug-safe-area--bottom {
  bottom: 0;
}
`;
  }

  // ==================== Utilities ====================

  private static getUtilities(): string {
    return `
/* ==================== Utilities ==================== */
/* Note: These use UIScale CSS variables when available, with fallbacks */

/* Flex */
.ui-flex { display: flex; }
.ui-flex--col { flex-direction: column; }
.ui-flex--center { align-items: center; justify-content: center; }
.ui-flex--between { justify-content: space-between; }
.ui-flex--wrap { flex-wrap: wrap; }
.ui-flex--1 { flex: 1; }

.ui-gap-xs { gap: var(--ui-space-xs, 4px); }
.ui-gap-sm { gap: var(--ui-space-sm, 8px); }
.ui-gap-md { gap: var(--ui-space-md, 12px); }
.ui-gap-lg { gap: var(--ui-space-lg, 16px); }
.ui-gap-xl { gap: var(--ui-space-xl, 24px); }

/* Spacing */
.ui-p-sm { padding: var(--ui-space-sm, 8px); }
.ui-p-md { padding: var(--ui-space-md, 12px); }
.ui-p-lg { padding: var(--ui-space-lg, 16px); }
.ui-p-xl { padding: var(--ui-space-xl, 24px); }

.ui-m-0 { margin: 0; }
.ui-mb-sm { margin-bottom: var(--ui-space-sm, 8px); }
.ui-mb-md { margin-bottom: var(--ui-space-md, 12px); }
.ui-mb-lg { margin-bottom: var(--ui-space-lg, 16px); }

/* Text alignment */
.ui-text-left { text-align: left; }
.ui-text-center { text-align: center; }
.ui-text-right { text-align: right; }

/* Overflow */
.ui-overflow-auto { overflow: auto; }
.ui-overflow-hidden { overflow: hidden; }
.ui-overflow-y-auto { overflow-y: auto; }

/* Visibility */
.ui-hidden { display: none !important; }
.ui-invisible { visibility: hidden; }

/* Progress Bar */
.ui-progress {
  height: 8px;
  background: #E0E0E0;
  border-radius: 4px;
  overflow: hidden;
}

.ui-progress__bar {
  height: 100%;
  background: #4CAF50;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.ui-progress__bar--warning { background: #F59E0B; }
.ui-progress__bar--error { background: #EF4444; }

/* Badge */
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 12px;
  background: #E0E0E0;
  color: #666666;
}

.ui-badge--success { background: #D1FAE5; color: #065F46; }
.ui-badge--warning { background: #FEF3C7; color: #92400E; }
.ui-badge--error { background: #FEE2E2; color: #991B1B; }
.ui-badge--info { background: #DBEAFE; color: #1E40AF; }

/* Divider */
.ui-divider {
  height: 1px;
  background: #E0E0E0;
  margin: 16px 0;
}

/* Pill (like day indicator) */
.ui-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #FAFAFA;
  border: 1px solid #E0E0E0;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #333333;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* Scrollbar styling */
.ui-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.ui-scrollbar::-webkit-scrollbar-track {
  background: #F5F5F5;
  border-radius: 4px;
}

.ui-scrollbar::-webkit-scrollbar-thumb {
  background: #BDBDBD;
  border-radius: 4px;
}

.ui-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #9E9E9E;
}

/* Empty state */
.ui-empty {
  text-align: center;
  padding: 32px 16px;
  color: #666666;
}

.ui-empty__icon {
  font-size: 3rem;
  margin-bottom: 12px;
  opacity: 0.5;
}

.ui-empty__text {
  font-size: 0.95rem;
}
`;
  }
}
