/**
 * SettingsPanel - Settings UI with volume controls
 * 
 * Can be shown from MainMenu or in-game pause menu.
 * Persists settings to localStorage.
 * 
 * Uses unified UI components: Overlay, Button
 */

import { AudioManager } from "../../engine/AudioManager";
import { PostProcessingManager } from "../../engine/effects/PostProcessingManager";
import { Overlay, createButton, UIManager } from "../../engine/ui";
import { UITheme, type ThemeMode } from "../../engine/ui/UITheme";
import { UIStyles } from "../../engine/ui/UIStyles";
import settingsPanelCSS from "./styles/SettingsPanel.css?raw";

const SETTINGS_STORAGE_KEY = "ganjawars_settings";

export interface GameSettings {
  musicVolume: number;  // 0-1
  sfxVolume: number;    // 0-1 (for future use)
  musicEnabled: boolean;
  sfxEnabled: boolean;
  highPerformanceRendering: boolean;  // true = uncapped FPS, false = 30fps battery saver
  // Graphics settings
  bloomEnabled: boolean;
  vignetteEnabled: boolean;
  ssaoEnabled: boolean;
}

export class SettingsPanel {
  private static instance: SettingsPanel;
  private overlay: Overlay | null = null;
  private panel: HTMLDivElement | null = null;
  private settings: GameSettings;
  private onClose?: () => void;

  private constructor() {
    this.settings = this.loadSettings();
    this.applySettings();
    UIStyles.injectCSS("settings-panel", settingsPanelCSS);
  }

  public static getInstance(): SettingsPanel {
    if (!SettingsPanel.instance) {
      SettingsPanel.instance = new SettingsPanel();
    }
    return SettingsPanel.instance;
  }

  /**
   * Load settings from localStorage or use defaults
   */
  private loadSettings(): GameSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        return { ...this.getDefaults(), ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
    return this.getDefaults();
  }

  /**
   * Detect if running on mobile device
   */
  private isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
  }

  private getDefaults(): GameSettings {
    // High performance ON by default for desktop, OFF for mobile (battery saver)
    const isMobile = this.isMobileDevice();
    return {
      musicVolume: 0.5,
      sfxVolume: 0.5,
      musicEnabled: true,
      sfxEnabled: true,
      highPerformanceRendering: !isMobile,  // Desktop: on, Mobile: off
      // Graphics defaults
      bloomEnabled: true,
      vignetteEnabled: true,
      ssaoEnabled: false,  // Off by default (performance heavy)
    };
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Failed to save settings:", e);
    }
  }

  /**
   * Apply current settings to audio and graphics systems
   */
  private applySettings(): void {
    const audio = AudioManager.getInstance();
    audio.setMusicVolume(this.settings.musicVolume);
    audio.setMusicEnabled(this.settings.musicEnabled);
    
    // Apply graphics settings (only if PostProcessingManager is initialized)
    const pp = PostProcessingManager.getInstance();
    if (pp.isInitialized()) {
      pp.setBloomEnabled(this.settings.bloomEnabled);
      pp.setVignetteEnabled(this.settings.vignetteEnabled);
      pp.setSSAOEnabled(this.settings.ssaoEnabled);
    }
  }

  /**
   * Get current settings
   */
  public getSettings(): GameSettings {
    return { ...this.settings };
  }

  /**
   * Show the settings panel
   */
  public show(onClose?: () => void): void {
    this.onClose = onClose;

    // Clean up existing
    this.hide();

    // Create overlay using unified component
    this.overlay = new Overlay(
      {
        id: "settings",
        opacity: 0.85,
        blur: 0,
        zIndex: UIManager.getInstance().getZIndex("SETTINGS"),
        closeOnClick: false,
        animate: true,
      },
      () => this.hide()
    );
    this.overlay.show();

    // Create panel
    this.panel = document.createElement("div");
    this.panel.id = "settings-panel";
    this.panel.style.zIndex = String(UIManager.getInstance().getZIndex("SETTINGS") + 1);

    // Title
    const title = document.createElement("h2");
    title.className = "settings-title";
    title.textContent = "Settings";
    this.panel.appendChild(title);

    // Settings content
    const content = document.createElement("div");
    content.className = "settings-content";

    // Music Volume slider
    content.appendChild(this.createVolumeSlider(
      "Music Volume",
      "🎵",
      this.settings.musicVolume,
      (value) => {
        this.settings.musicVolume = value;
        this.applySettings();
        this.saveSettings();
      }
    ));

    // Music enabled toggle
    content.appendChild(this.createToggle(
      "Music Enabled",
      this.settings.musicEnabled,
      (enabled) => {
        this.settings.musicEnabled = enabled;
        this.applySettings();
        this.saveSettings();
      }
    ));

    // SFX Volume slider (for future use)
    content.appendChild(this.createVolumeSlider(
      "Sound Effects",
      "🔊",
      this.settings.sfxVolume,
      (value) => {
        this.settings.sfxVolume = value;
        this.saveSettings();
      }
    ));

    // Separator
    const separator = document.createElement("div");
    separator.className = "settings-separator";
    content.appendChild(separator);

    // High Performance Rendering toggle
    content.appendChild(this.createToggleWithDescription(
      "High Performance",
      "⚡",
      this.settings.highPerformanceRendering,
      this.isMobileDevice() 
        ? "Uncapped FPS (uses more battery)" 
        : "Uncapped FPS (smoother gameplay)",
      (enabled) => {
        this.settings.highPerformanceRendering = enabled;
        this.saveSettings();
        // Notify any listeners about the change
        window.dispatchEvent(new CustomEvent("performanceSettingChanged", { 
          detail: { highPerformance: enabled } 
        }));
      }
    ));

    // Graphics section separator
    const graphicsSeparator = document.createElement("div");
    graphicsSeparator.className = "settings-separator";
    content.appendChild(graphicsSeparator);

    const graphicsLabel = document.createElement("div");
    graphicsLabel.className = "settings-section-label";
    graphicsLabel.textContent = "Graphics";
    content.appendChild(graphicsLabel);

    // Bloom toggle
    content.appendChild(this.createToggleWithDescription(
      "Bloom",
      "✨",
      this.settings.bloomEnabled,
      "Glow effect on bright objects",
      (enabled) => {
        this.settings.bloomEnabled = enabled;
        this.saveSettings();
        this.applySettings();
      }
    ));

    // Vignette toggle
    content.appendChild(this.createToggleWithDescription(
      "Vignette",
      "🎬",
      this.settings.vignetteEnabled,
      "Darkened screen edges",
      (enabled) => {
        this.settings.vignetteEnabled = enabled;
        this.saveSettings();
        this.applySettings();
      }
    ));

    // SSAO toggle
    content.appendChild(this.createToggleWithDescription(
      "Ambient Occlusion",
      "🌑",
      this.settings.ssaoEnabled,
      "Soft shadows (impacts performance)",
      (enabled) => {
        this.settings.ssaoEnabled = enabled;
        this.saveSettings();
        this.applySettings();
      }
    ));

    // Theme toggle (Light/Dark mode) - hidden for now, needs CSS variable integration
    // content.appendChild(this.createThemeToggle());

    this.panel.appendChild(content);

    // Back button using unified component
    const backBtnContainer = document.createElement("div");
    backBtnContainer.className = "settings-back-container";
    const backBtn = createButton({
      text: "Back",
      variant: "secondary",
      size: "medium",
      fullWidth: true,
      onClick: () => this.hide(),
    });
    backBtnContainer.appendChild(backBtn);
    this.panel.appendChild(backBtnContainer);

    document.body.appendChild(this.panel);
  }

  /**
   * Hide the settings panel
   */
  public hide(): void {
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

    this.onClose?.();
  }

  /**
   * Create a volume slider control
   */
  private createVolumeSlider(
    label: string,
    icon: string,
    initialValue: number,
    onChange: (value: number) => void
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "settings-slider-container";

    // Label row
    const labelRow = document.createElement("div");
    labelRow.className = "settings-slider-label";

    const labelText = document.createElement("span");
    labelText.className = "settings-slider-label-text";
    labelText.innerHTML = `${icon} ${label}`;
    labelRow.appendChild(labelText);

    const valueText = document.createElement("span");
    valueText.className = "settings-slider-value";
    valueText.textContent = `${Math.round(initialValue * 100)}%`;
    labelRow.appendChild(valueText);

    container.appendChild(labelRow);

    // Slider
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(initialValue * 100));
    slider.className = "settings-slider";

    slider.addEventListener("input", () => {
      const value = parseInt(slider.value) / 100;
      valueText.textContent = `${slider.value}%`;
      onChange(value);
    });

    container.appendChild(slider);

    return container;
  }

  /**
   * Create a toggle switch control
   */
  private createToggle(
    label: string,
    initialValue: boolean,
    onChange: (enabled: boolean) => void
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "settings-toggle-container";

    const labelText = document.createElement("span");
    labelText.className = "settings-toggle-label";
    labelText.textContent = label;
    container.appendChild(labelText);

    // Toggle switch
    const toggle = document.createElement("div");
    toggle.className = `settings-toggle${initialValue ? " active" : ""}`;

    const knob = document.createElement("div");
    knob.className = "settings-toggle-knob";
    toggle.appendChild(knob);

    let enabled = initialValue;
    toggle.addEventListener("click", () => {
      enabled = !enabled;
      toggle.classList.toggle("active", enabled);
      onChange(enabled);
    });

    container.appendChild(toggle);

    return container;
  }

  /**
   * Create a toggle switch with icon and description
   */
  private createToggleWithDescription(
    label: string,
    icon: string,
    initialValue: boolean,
    description: string,
    onChange: (enabled: boolean) => void
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "settings-toggle-container settings-toggle-with-desc";

    const leftSide = document.createElement("div");
    leftSide.className = "settings-toggle-left";

    const labelText = document.createElement("span");
    labelText.className = "settings-toggle-label";
    labelText.innerHTML = `${icon} ${label}`;
    leftSide.appendChild(labelText);

    const descText = document.createElement("span");
    descText.className = "settings-toggle-description";
    descText.textContent = description;
    leftSide.appendChild(descText);

    container.appendChild(leftSide);

    // Toggle switch
    const toggle = document.createElement("div");
    toggle.className = `settings-toggle${initialValue ? " active" : ""}`;

    const knob = document.createElement("div");
    knob.className = "settings-toggle-knob";
    toggle.appendChild(knob);

    let enabled = initialValue;
    toggle.addEventListener("click", () => {
      enabled = !enabled;
      toggle.classList.toggle("active", enabled);
      onChange(enabled);
    });

    container.appendChild(toggle);

    return container;
  }

  /**
   * Create a theme toggle (Light/Dark mode)
   * @todo Re-enable when CSS files use CSS variables for theming
   */
  // @ts-ignore - Kept for future dark mode implementation
  private createThemeToggle(): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "settings-theme-container";

    const labelContainer = document.createElement("div");
    labelContainer.className = "settings-theme-label";
    
    const icon = document.createElement("span");
    icon.className = "settings-theme-icon";
    icon.textContent = "🎨";
    labelContainer.appendChild(icon);

    const labelText = document.createElement("span");
    labelText.className = "settings-theme-text";
    labelText.textContent = "Theme";
    labelContainer.appendChild(labelText);
    container.appendChild(labelContainer);

    // Theme selector buttons
    const buttonGroup = document.createElement("div");
    buttonGroup.className = "settings-theme-buttons";

    const currentMode = UITheme.getInstance().getMode();

    const createModeButton = (mode: ThemeMode, label: string, emoji: string) => {
      const btn = document.createElement("button");
      const isActive = currentMode === mode;
      btn.className = `settings-theme-btn${isActive ? " active" : ""}`;
      btn.innerHTML = `${emoji} ${label}`;
      
      btn.addEventListener("click", () => {
        UITheme.getInstance().setMode(mode);
        // Refresh the settings panel to reflect new theme
        this.hide();
        setTimeout(() => this.show(this.onClose), 100);
      });

      return btn;
    };

    buttonGroup.appendChild(createModeButton("light", "Light", "☀️"));
    buttonGroup.appendChild(createModeButton("dark", "Dark", "🌙"));
    container.appendChild(buttonGroup);

    return container;
  }
}
