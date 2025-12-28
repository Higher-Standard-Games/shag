/**
 * UITheme - Centralized UI styling (Engine Component)
 * 
 * Provides consistent colors, fonts, and styles across all UI components.
 * Supports light/dark theme switching with CSS variables.
 * Game can customize by calling UITheme.setTheme() before UI init.
 */

import { GamePaths } from '../core/GamePaths';

export type ThemeMode = "light" | "dark";

export interface UIThemeConfig {
  // Colors
  primaryColor: string;
  primaryColorDark: string;    // Darker shade for borders/shadows
  primaryColorLight: string;   // Lighter shade for hover
  secondaryColor: string;
  successColor: string;
  warningColor: string;
  errorColor: string;
  
  // Backgrounds
  panelBg: string;
  panelBgAlt: string;          // Alternate/header background
  cardBg: string;              // Card/item background
  inputBg: string;             // Input field background
  
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;       // Text on primary color buttons
  
  // Borders
  borderColor: string;
  borderColorLight: string;
  borderRadius: string;
  
  // Button 3D effect
  buttonBg: string;
  buttonBgHover: string;
  buttonBgActive: string;
  buttonBorder: string;
  buttonText: string;
  buttonShadow: string;
  
  // Fonts
  fontFamily: string;
  fontFamilyHeading: string;
  
  // Shadows
  shadowLight: string;
  shadowMedium: string;
  shadowHeavy: string;
}

// Light theme (default)
const LIGHT_THEME: UIThemeConfig = {
  // Colors
  primaryColor: "#4CAF50",
  primaryColorDark: "#3D9140",
  primaryColorLight: "#5CBF60",
  secondaryColor: "#2196F3",
  successColor: "#4CAF50",
  warningColor: "#F57C00",
  errorColor: "#D32F2F",
  
  // Backgrounds
  panelBg: "#FAFAFA",
  panelBgAlt: "#F5F5F5",
  cardBg: "#FFFFFF",
  inputBg: "#FFFFFF",
  
  // Text
  textPrimary: "#333333",
  textSecondary: "#666666",
  textMuted: "#888888",
  textOnPrimary: "#FFFFFF",
  
  // Borders
  borderColor: "#E0E0E0",
  borderColorLight: "#E8E8E8",
  borderRadius: "12px",
  
  // Button 3D effect (secondary/default)
  buttonBg: "#F5F5F5",
  buttonBgHover: "#FFFFFF",
  buttonBgActive: "#E8E8E8",
  buttonBorder: "#CCCCCC",
  buttonText: "#333333",
  buttonShadow: "rgba(0, 0, 0, 0.1)",
  
  // Fonts
  fontFamily: "'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif",
  fontFamilyHeading: "'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif",
  
  // Shadows
  shadowLight: "0 2px 4px rgba(0, 0, 0, 0.08)",
  shadowMedium: "0 4px 16px rgba(0, 0, 0, 0.12)",
  shadowHeavy: "0 8px 32px rgba(0, 0, 0, 0.2)",
};

// Dark theme
const DARK_THEME: UIThemeConfig = {
  // Colors
  primaryColor: "#4CAF50",
  primaryColorDark: "#3D9140",
  primaryColorLight: "#5CBF60",
  secondaryColor: "#2196F3",
  successColor: "#4CAF50",
  warningColor: "#FFC107",
  errorColor: "#F44336",
  
  // Backgrounds
  panelBg: "rgba(25, 25, 25, 0.95)",
  panelBgAlt: "rgba(35, 35, 35, 0.95)",
  cardBg: "rgba(40, 40, 40, 0.9)",
  inputBg: "rgba(50, 50, 50, 0.9)",
  
  // Text
  textPrimary: "#FFFFFF",
  textSecondary: "#CCCCCC",
  textMuted: "#888888",
  textOnPrimary: "#FFFFFF",
  
  // Borders
  borderColor: "rgba(255, 255, 255, 0.1)",
  borderColorLight: "rgba(255, 255, 255, 0.05)",
  borderRadius: "12px",
  
  // Button 3D effect (secondary/default)
  buttonBg: "rgba(255, 255, 255, 0.1)",
  buttonBgHover: "rgba(255, 255, 255, 0.15)",
  buttonBgActive: "rgba(255, 255, 255, 0.05)",
  buttonBorder: "rgba(255, 255, 255, 0.2)",
  buttonText: "#FFFFFF",
  buttonShadow: "rgba(0, 0, 0, 0.3)",
  
  // Fonts
  fontFamily: "'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif",
  fontFamilyHeading: "'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif",
  
  // Shadows
  shadowLight: "0 2px 8px rgba(0, 0, 0, 0.3)",
  shadowMedium: "0 4px 16px rgba(0, 0, 0, 0.4)",
  shadowHeavy: "0 8px 32px rgba(0, 0, 0, 0.5)",
};

const STORAGE_KEY = "ui_theme_mode";

export class UITheme {
  private static instance: UITheme;
  private theme: UIThemeConfig;
  private themeMode: ThemeMode = "light";
  private styleElement: HTMLStyleElement | null = null;
  private listeners: Array<(mode: ThemeMode) => void> = [];

  private constructor() {
    // Load saved theme preference
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    this.themeMode = saved === "dark" ? "dark" : "light";
    this.theme = this.themeMode === "dark" ? { ...DARK_THEME } : { ...LIGHT_THEME };
  }

  public static getInstance(): UITheme {
    if (!UITheme.instance) {
      UITheme.instance = new UITheme();
    }
    return UITheme.instance;
  }

  /**
   * Load a custom font from URL
   * Supports WOFF2, WOFF, TTF, OTF formats
   */
  public async loadFont(fontName: string, fontUrl: string, weight: string = "400", silent: boolean = false): Promise<void> {
    const font = new FontFace(fontName, `url(${fontUrl})`, {
      weight,
      style: "normal",
    });

    try {
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
      if (!silent) {
        console.log(`Font loaded: ${fontName}`);
      }
    } catch (error) {
      console.warn(`Failed to load font ${fontName}:`, error);
    }
  }

  /**
   * Set the UI font family (call after loading fonts)
   */
  public setFontFamily(fontFamily: string, headingFont?: string): void {
    this.theme.fontFamily = fontFamily;
    this.theme.fontFamilyHeading = headingFont || fontFamily;
    this.injectStyles();
  }

  /**
   * Update theme configuration (partial override)
   */
  public setTheme(config: Partial<UIThemeConfig>): void {
    this.theme = { ...this.theme, ...config };
    this.injectStyles();
  }

  /**
   * Get current theme config
   */
  public getTheme(): Readonly<UIThemeConfig> {
    return this.theme;
  }

  /**
   * Get current theme mode
   */
  public getMode(): ThemeMode {
    return this.themeMode;
  }

  /**
   * Set theme mode (light/dark)
   */
  public setMode(mode: ThemeMode): void {
    if (mode === this.themeMode) return;
    
    this.themeMode = mode;
    this.theme = mode === "dark" ? { ...DARK_THEME } : { ...LIGHT_THEME };
    
    // Persist preference
    localStorage.setItem(STORAGE_KEY, mode);
    
    // Inject updated styles
    this.injectStyles();
    
    // Notify listeners
    this.listeners.forEach(fn => fn(mode));
    
    console.log(`[UITheme] Switched to ${mode} mode`);
  }

  /**
   * Toggle between light and dark mode
   */
  public toggleMode(): ThemeMode {
    const newMode = this.themeMode === "light" ? "dark" : "light";
    this.setMode(newMode);
    return newMode;
  }

  /**
   * Subscribe to theme mode changes
   */
  public onModeChange(callback: (mode: ThemeMode) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== callback);
    };
  }

  /**
   * Get a specific theme value
   */
  public get<K extends keyof UIThemeConfig>(key: K): UIThemeConfig[K] {
    return this.theme[key];
  }

  /**
   * Initialize and inject global styles
   */
  public init(): void {
    this.injectStyles();
  }

  /**
   * Load Nunito font family with all weights
   */
  public async loadNunitoFont(): Promise<void> {
    const weights = [
      { weight: "300", file: "Nunito-Light.ttf" },
      { weight: "400", file: "Nunito-Regular.ttf" },
      { weight: "500", file: "Nunito-Medium.ttf" },
      { weight: "600", file: "Nunito-SemiBold.ttf" },
      { weight: "700", file: "Nunito-Bold.ttf" },
      { weight: "800", file: "Nunito-ExtraBold.ttf" },
      { weight: "900", file: "Nunito-Black.ttf" },
    ];

    // Try game fonts first, fallback to engine fonts
    const gamePaths = GamePaths.getInstance();
    const loadPromises = weights.map(async ({ weight, file }) => {
      const fontPath = await gamePaths.resolve(`fonts/Nunito/static/${file}`);
      return this.loadFont("Nunito", fontPath, weight, true);
    });

    await Promise.all(loadPromises);
    console.log("[UITheme] Nunito font family loaded (7 weights)");
  }

  /**
   * Inject CSS variables and base styles
   */
  private injectStyles(): void {
    if (this.styleElement) {
      this.styleElement.remove();
    }

    this.styleElement = document.createElement("style");
    this.styleElement.id = "ui-theme-styles";
    this.styleElement.textContent = `
      :root {
        /* Theme mode indicator */
        --ui-mode: ${this.themeMode};
        
        /* Colors */
        --ui-primary: ${this.theme.primaryColor};
        --ui-primary-dark: ${this.theme.primaryColorDark};
        --ui-primary-light: ${this.theme.primaryColorLight};
        --ui-secondary: ${this.theme.secondaryColor};
        --ui-success: ${this.theme.successColor};
        --ui-warning: ${this.theme.warningColor};
        --ui-error: ${this.theme.errorColor};
        
        /* Backgrounds */
        --ui-panel-bg: ${this.theme.panelBg};
        --ui-panel-bg-alt: ${this.theme.panelBgAlt};
        --ui-card-bg: ${this.theme.cardBg};
        --ui-input-bg: ${this.theme.inputBg};
        
        /* Text */
        --ui-text-primary: ${this.theme.textPrimary};
        --ui-text-secondary: ${this.theme.textSecondary};
        --ui-text-muted: ${this.theme.textMuted};
        --ui-text-on-primary: ${this.theme.textOnPrimary};
        
        /* Borders */
        --ui-border-color: ${this.theme.borderColor};
        --ui-border-color-light: ${this.theme.borderColorLight};
        --ui-border-radius: ${this.theme.borderRadius};
        
        /* Button 3D effect */
        --ui-button-bg: ${this.theme.buttonBg};
        --ui-button-bg-hover: ${this.theme.buttonBgHover};
        --ui-button-bg-active: ${this.theme.buttonBgActive};
        --ui-button-border: ${this.theme.buttonBorder};
        --ui-button-text: ${this.theme.buttonText};
        --ui-button-shadow: ${this.theme.buttonShadow};
        
        /* Fonts */
        --ui-font: ${this.theme.fontFamily};
        --ui-font-heading: ${this.theme.fontFamilyHeading};
        
        /* Shadows */
        --ui-shadow-light: ${this.theme.shadowLight};
        --ui-shadow-medium: ${this.theme.shadowMedium};
        --ui-shadow-heavy: ${this.theme.shadowHeavy};
      }

      /* Theme mode class on body */
      body {
        --theme-mode: ${this.themeMode};
      }
      
      body.theme-light { --theme-mode: light; }
      body.theme-dark { --theme-mode: dark; }

      /* Prevent text selection on game UI elements */
      body.game-active {
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
      }

      /* Allow text selection in specific input areas if needed */
      input, textarea {
        -webkit-user-select: text;
        -moz-user-select: text;
        -ms-user-select: text;
        user-select: text;
      }

      /* Base UI styles */
      .ui-panel, .side-panel, .bottom-bar, .modal-panel {
        font-family: var(--ui-font);
        color: var(--ui-text-primary);
      }

      /* Heading styles - use game font */
      .side-panel-title,
      .modal-title,
      .panel-header,
      .ui-heading {
        font-family: var(--ui-font-heading) !important;
        letter-spacing: 0.5px;
      }

      /* World indicator styles - unified */
      .world-indicator {
        font-family: var(--ui-font) !important;
        background: var(--ui-panel-bg) !important;
        border: 1px solid var(--ui-border-color) !important;
        border-radius: var(--ui-border-radius) !important;
        box-shadow: var(--ui-shadow-medium) !important;
      }

      .world-indicator-label {
        font-family: var(--ui-font) !important;
        font-size: 12px !important;
      }
    `;

    document.head.appendChild(this.styleElement);
  }

  /**
   * Get CSS for panel background (for inline styles)
   */
  public getPanelStyle(): string {
    return `
      background: ${this.theme.panelBg};
      border: 1px solid ${this.theme.borderColor};
      border-radius: ${this.theme.borderRadius};
      box-shadow: ${this.theme.shadowMedium};
      font-family: ${this.theme.fontFamily};
      color: ${this.theme.textPrimary};
    `;
  }

  /**
   * Get CSS for modal background
   */
  public getModalStyle(): string {
    return `
      background: ${this.theme.panelBg};
      border: 1px solid ${this.theme.borderColor};
      border-radius: ${this.theme.borderRadius};
      box-shadow: ${this.theme.shadowHeavy};
      font-family: ${this.theme.fontFamily};
      color: ${this.theme.textPrimary};
    `;
  }

  /**
   * Get CSS for 3D buttons
   */
  public getButtonStyle(variant: "secondary" | "primary" = "secondary"): string {
    if (variant === "primary") {
      return `
        background: ${this.theme.primaryColor};
        border: none;
        border-bottom: 4px solid ${this.theme.primaryColorDark};
        border-radius: 8px;
        color: ${this.theme.textOnPrimary};
        font-family: ${this.theme.fontFamily};
        cursor: pointer;
        transition: all 0.1s ease;
        position: relative;
        top: 0;
      `;
    }
    
    return `
      background: ${this.theme.buttonBg};
      border: none;
      border-bottom: 4px solid ${this.theme.buttonBorder};
      border-radius: 8px;
      color: ${this.theme.buttonText};
      font-family: ${this.theme.fontFamily};
      cursor: pointer;
      transition: all 0.1s ease;
      position: relative;
      top: 0;
    `;
  }

  /**
   * Check if currently in dark mode
   */
  public isDark(): boolean {
    return this.themeMode === "dark";
  }

  /**
   * Check if currently in light mode
   */
  public isLight(): boolean {
    return this.themeMode === "light";
  }
}
