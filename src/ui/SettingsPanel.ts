/**
 * SettingsPanel - Settings UI with volume controls
 * 
 * Can be shown from MainMenu or in-game pause menu.
 * Persists settings to localStorage.
 * 
 * Uses unified UI components: Overlay, Button
 */

import { AudioManager } from "../engine/AudioManager";
import { Overlay, createButton, UIManager } from "../engine/ui";
import { UITheme, type ThemeMode } from "../engine/ui/UITheme";

const SETTINGS_STORAGE_KEY = "ganjawars_settings";

export interface GameSettings {
  musicVolume: number;  // 0-1
  sfxVolume: number;    // 0-1 (for future use)
  musicEnabled: boolean;
  sfxEnabled: boolean;
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

  private getDefaults(): GameSettings {
    return {
      musicVolume: 0.5,
      sfxVolume: 0.5,
      musicEnabled: true,
      sfxEnabled: true,
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
   * Apply current settings to audio systems
   */
  private applySettings(): void {
    const audio = AudioManager.getInstance();
    audio.setMusicVolume(this.settings.musicVolume);
    audio.setMusicEnabled(this.settings.musicEnabled);
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

    // Create panel - Light theme
    this.panel = document.createElement("div");
    this.panel.id = "settings-panel";
    this.panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #FAFAFA;
      border: 1px solid #E0E0E0;
      border-radius: 16px;
      padding: 32px 48px;
      min-width: 400px;
      max-width: 500px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1);
      z-index: ${UIManager.getInstance().getZIndex("SETTINGS") + 1};
      animation: uiScaleIn 0.2s ease;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    // Title
    const title = document.createElement("h2");
    title.textContent = "Settings";
    title.style.cssText = `
      color: #333333;
      font-size: 2rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-align: center;
      margin: 0 0 32px 0;
    `;
    this.panel.appendChild(title);

    // Settings content
    const content = document.createElement("div");
    content.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 24px;
    `;

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

    // Theme toggle (Light/Dark mode)
    content.appendChild(this.createThemeToggle());

    this.panel.appendChild(content);

    // Back button using unified component
    const backBtnContainer = document.createElement("div");
    backBtnContainer.style.cssText = `margin-top: 32px; width: 100%;`;
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
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    // Label row
    const labelRow = document.createElement("div");
    labelRow.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;

    const labelText = document.createElement("span");
    labelText.innerHTML = `${icon} ${label}`;
    labelText.style.cssText = `
      color: #333333;
      font-size: 14px;
    `;
    labelRow.appendChild(labelText);

    const valueText = document.createElement("span");
    valueText.textContent = `${Math.round(initialValue * 100)}%`;
    valueText.style.cssText = `
      color: #666666;
      font-size: 14px;
      min-width: 40px;
      text-align: right;
    `;
    labelRow.appendChild(valueText);

    container.appendChild(labelRow);

    // Slider
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(initialValue * 100));
    slider.style.cssText = `
      width: 100%;
      height: 8px;
      -webkit-appearance: none;
      appearance: none;
      background: #E0E0E0;
      border-radius: 4px;
      outline: none;
      cursor: pointer;
    `;

    // Custom slider thumb styling
    const styleId = "settings-slider-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #settings-panel input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #4CAF50, #2E7D32);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          transition: transform 0.1s ease;
        }
        #settings-panel input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        #settings-panel input[type="range"]::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #4CAF50, #2E7D32);
          border-radius: 50%;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
      `;
      document.head.appendChild(style);
    }

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
    container.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
    `;

    const labelText = document.createElement("span");
    labelText.textContent = label;
    labelText.style.cssText = `
      color: #333333;
      font-size: 14px;
    `;
    container.appendChild(labelText);

    // Toggle switch
    const toggle = document.createElement("div");
    toggle.style.cssText = `
      width: 48px;
      height: 24px;
      background: ${initialValue ? "#4CAF50" : "#CCCCCC"};
      border-radius: 12px;
      cursor: pointer;
      position: relative;
      transition: background 0.2s ease;
    `;

    const knob = document.createElement("div");
    knob.style.cssText = `
      width: 20px;
      height: 20px;
      background: #fff;
      border-radius: 50%;
      position: absolute;
      top: 2px;
      left: ${initialValue ? "26px" : "2px"};
      transition: left 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    `;
    toggle.appendChild(knob);

    let enabled = initialValue;
    toggle.addEventListener("click", () => {
      enabled = !enabled;
      toggle.style.background = enabled ? "#4CAF50" : "#CCCCCC";
      knob.style.left = enabled ? "26px" : "2px";
      onChange(enabled);
    });

    container.appendChild(toggle);

    return container;
  }

  /**
   * Create a theme toggle (Light/Dark mode)
   */
  private createThemeToggle(): HTMLDivElement {
    const container = document.createElement("div");
    container.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-top: 1px solid #E0E0E0;
      margin-top: 8px;
    `;

    const labelContainer = document.createElement("div");
    labelContainer.style.cssText = `display: flex; align-items: center; gap: 8px;`;
    
    const icon = document.createElement("span");
    icon.textContent = "🎨";
    icon.style.fontSize = "18px";
    labelContainer.appendChild(icon);

    const labelText = document.createElement("span");
    labelText.textContent = "Theme";
    labelText.style.cssText = `
      color: #333333;
      font-size: 14px;
      font-weight: 500;
    `;
    labelContainer.appendChild(labelText);
    container.appendChild(labelContainer);

    // Theme selector buttons
    const buttonGroup = document.createElement("div");
    buttonGroup.style.cssText = `
      display: flex;
      gap: 4px;
      background: #E8E8E8;
      border-radius: 8px;
      padding: 3px;
    `;

    const currentMode = UITheme.getInstance().getMode();

    const createModeButton = (mode: ThemeMode, label: string, emoji: string) => {
      const btn = document.createElement("button");
      const isActive = currentMode === mode;
      btn.innerHTML = `${emoji} ${label}`;
      btn.style.cssText = `
        padding: 6px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        background: ${isActive ? "#FFFFFF" : "transparent"};
        color: ${isActive ? "#333333" : "#666666"};
        box-shadow: ${isActive ? "0 1px 3px rgba(0, 0, 0, 0.1)" : "none"};
      `;
      
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
