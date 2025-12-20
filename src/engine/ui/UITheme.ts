/**
 * UITheme - Centralized UI styling (Engine Component)
 * 
 * Provides consistent colors, fonts, and styles across all UI components.
 * Game can customize by calling UITheme.setTheme() before UI init.
 */

export interface UIThemeConfig {
  // Colors
  primaryColor: string;
  secondaryColor: string;
  successColor: string;
  warningColor: string;
  errorColor: string;
  
  // Backgrounds
  panelBackground: string;
  panelBackgroundSolid: string;
  modalBackground: string;
  buttonBackground: string;
  
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  
  // Borders
  borderColor: string;
  borderRadius: string;
  
  // Fonts
  fontFamily: string;
  fontFamilyHeading: string;
  
  // Shadows
  shadowLight: string;
  shadowMedium: string;
  shadowHeavy: string;
}

const DEFAULT_THEME: UIThemeConfig = {
  // Colors
  primaryColor: "#4CAF50",
  secondaryColor: "#2196F3",
  successColor: "#4CAF50",
  warningColor: "#FFC107",
  errorColor: "#F44336",
  
  // Backgrounds - unified dark gradient
  panelBackground: "linear-gradient(to bottom, rgba(30, 30, 30, 0.95), rgba(20, 20, 20, 0.98))",
  panelBackgroundSolid: "rgba(25, 25, 25, 0.95)",
  modalBackground: "linear-gradient(to bottom, rgba(35, 35, 35, 0.98), rgba(25, 25, 25, 0.99))",
  buttonBackground: "rgba(255, 255, 255, 0.1)",
  
  // Text
  textPrimary: "#ffffff",
  textSecondary: "#cccccc",
  textMuted: "#888888",
  
  // Borders
  borderColor: "rgba(255, 255, 255, 0.1)",
  borderRadius: "12px",
  
  // Fonts - will be set after loading custom font
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  fontFamilyHeading: "'Segoe UI', system-ui, -apple-system, sans-serif",
  
  // Shadows
  shadowLight: "0 2px 8px rgba(0, 0, 0, 0.2)",
  shadowMedium: "0 4px 16px rgba(0, 0, 0, 0.3)",
  shadowHeavy: "0 8px 32px rgba(0, 0, 0, 0.5)",
};

export class UITheme {
  private static instance: UITheme;
  private theme: UIThemeConfig = { ...DEFAULT_THEME };
  private styleElement: HTMLStyleElement | null = null;

  private constructor() {}

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
  public async loadFont(fontName: string, fontUrl: string, weight: string = "400"): Promise<void> {
    const font = new FontFace(fontName, `url(${fontUrl})`, {
      weight,
      style: "normal",
    });

    try {
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
      console.log(`Font loaded: ${fontName}`);
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
   * Update theme configuration
   */
  public setTheme(config: Partial<UIThemeConfig>): void {
    this.theme = { ...this.theme, ...config };
    this.injectStyles();
  }

  /**
   * Get current theme
   */
  public getTheme(): Readonly<UIThemeConfig> {
    return this.theme;
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
        --ui-primary: ${this.theme.primaryColor};
        --ui-secondary: ${this.theme.secondaryColor};
        --ui-success: ${this.theme.successColor};
        --ui-warning: ${this.theme.warningColor};
        --ui-error: ${this.theme.errorColor};
        
        --ui-panel-bg: ${this.theme.panelBackground};
        --ui-panel-bg-solid: ${this.theme.panelBackgroundSolid};
        --ui-modal-bg: ${this.theme.modalBackground};
        --ui-button-bg: ${this.theme.buttonBackground};
        
        --ui-text-primary: ${this.theme.textPrimary};
        --ui-text-secondary: ${this.theme.textSecondary};
        --ui-text-muted: ${this.theme.textMuted};
        
        --ui-border-color: ${this.theme.borderColor};
        --ui-border-radius: ${this.theme.borderRadius};
        
        --ui-font: ${this.theme.fontFamily};
        --ui-font-heading: ${this.theme.fontFamilyHeading};
        
        --ui-shadow-light: ${this.theme.shadowLight};
        --ui-shadow-medium: ${this.theme.shadowMedium};
        --ui-shadow-heavy: ${this.theme.shadowHeavy};
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
        background: var(--ui-panel-bg-solid) !important;
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
      background: ${this.theme.panelBackground};
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
      background: ${this.theme.modalBackground};
      border: 1px solid ${this.theme.borderColor};
      border-radius: ${this.theme.borderRadius};
      box-shadow: ${this.theme.shadowHeavy};
      font-family: ${this.theme.fontFamily};
      color: ${this.theme.textPrimary};
    `;
  }

  /**
   * Get CSS for buttons
   */
  public getButtonStyle(variant: "default" | "primary" | "success" | "warning" | "error" = "default"): string {
    const colors: Record<string, string> = {
      default: this.theme.buttonBackground,
      primary: this.theme.primaryColor,
      success: this.theme.successColor,
      warning: this.theme.warningColor,
      error: this.theme.errorColor,
    };

    return `
      background: ${colors[variant]};
      border: none;
      border-radius: 8px;
      color: ${this.theme.textPrimary};
      font-family: ${this.theme.fontFamily};
      cursor: pointer;
      transition: all 0.2s;
    `;
  }
}
