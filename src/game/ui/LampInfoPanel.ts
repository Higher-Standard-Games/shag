/**
 * LampInfoPanel - UI panel for controlling grow light settings
 * 
 * Shows when clicking on a lamp:
 * - Intensity slider (affects growth speed)
 * - Spectrum slider (warm/cool - affects quality)
 * - Power toggle
 * - Coverage info (plants affected)
 * - Power cost display
 */

import { WorldIndicatorSystem } from "../../engine/core/WorldIndicatorSystem";
import { LampSystem } from "../LampSystem";
import { UIStyles } from "../../engine/ui/UIStyles";
import lampInfoPanelCSS from "./styles/LampInfoPanel.css?raw";

const SELECTION_INDICATOR_ID = "lamp_selection";

export class LampInfoPanel {
  private static instance: LampInfoPanel;
  private container: HTMLElement | null = null;
  private currentLampId: string | null = null;
  private panelOpenedAt: number = 0;
  private styleInjected: boolean = false;

  private constructor() {}

  public static getInstance(): LampInfoPanel {
    if (!LampInfoPanel.instance) {
      LampInfoPanel.instance = new LampInfoPanel();
    }
    return LampInfoPanel.instance;
  }

  public init(): void {
    this.injectStyles();
    this.createPanel();
    this.setupClickOutside();
  }

  private createPanel(): void {
    this.container = document.createElement("div");
    this.container.id = "lamp-info-panel";
    this.container.style.display = "none";
    this.container.innerHTML = `
      <div class="lamp-info-header">
        <span class="lamp-name">💡 Grow Light</span>
        <button class="lamp-info-close">×</button>
      </div>
      <div class="lamp-info-body">
        <div class="lamp-power-row">
          <span>Power:</span>
          <button class="lamp-power-btn on">ON</button>
        </div>
        <div class="lamp-stat">
          <span>Intensity:</span>
          <input type="range" class="lamp-intensity-slider" min="0" max="100" value="75">
          <span class="lamp-intensity-value">75%</span>
        </div>
        <div class="lamp-stat">
          <span>Spectrum:</span>
          <input type="range" class="lamp-spectrum-slider" min="0" max="100" value="50">
          <span class="lamp-spectrum-value">Balanced</span>
        </div>
        <div class="lamp-info-row">
          <span>🌱 Coverage:</span>
          <span class="lamp-coverage">0 plants</span>
        </div>
        <div class="lamp-info-row">
          <span>⚡ Power Cost:</span>
          <span class="lamp-power-cost">$0/day</span>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);

    // Setup event listeners
    this.container.querySelector(".lamp-info-close")?.addEventListener("click", () => {
      this.hide();
    });

    this.container.querySelector(".lamp-power-btn")?.addEventListener("click", () => {
      if (this.currentLampId) {
        LampSystem.getInstance().togglePower(this.currentLampId);
        this.refresh();
      }
    });

    this.container.querySelector(".lamp-intensity-slider")?.addEventListener("input", (e) => {
      if (this.currentLampId) {
        const value = parseInt((e.target as HTMLInputElement).value);
        LampSystem.getInstance().setIntensity(this.currentLampId, value);
        this.refresh();
      }
    });

    this.container.querySelector(".lamp-spectrum-slider")?.addEventListener("input", (e) => {
      if (this.currentLampId) {
        const value = parseInt((e.target as HTMLInputElement).value);
        LampSystem.getInstance().setSpectrum(this.currentLampId, value);
        this.refresh();
      }
    });
  }

  private setupClickOutside(): void {
    document.addEventListener("click", (e) => {
      if (!this.container || this.container.style.display === "none") return;
      
      // Don't close if panel was just opened
      if (Date.now() - this.panelOpenedAt < 300) return;
      
      const target = e.target as HTMLElement;
      const isInsidePanel = this.container.contains(target);
      const isOnIndicator = target.closest(".world-indicator");
      const isOnCanvas = target.tagName === "CANVAS";
      
      if (!isInsidePanel && !isOnIndicator && isOnCanvas) {
        this.hide();
      }
    });
  }

  public show(lampObjectId: string, position: { x: number; y: number; z: number }): void {
    if (!this.container) return;

    this.currentLampId = lampObjectId;
    this.panelOpenedAt = Date.now();
    this.container.style.display = "block";

    // Show selection indicator
    this.showSelectionIndicator(position);

    // Refresh display
    this.refresh();
  }

  public hide(): void {
    if (!this.container) return;

    this.container.style.display = "none";
    this.currentLampId = null;
    this.hideSelectionIndicator();
  }

  public isVisible(): boolean {
    return this.container?.style.display !== "none";
  }

  private refresh(): void {
    if (!this.container || !this.currentLampId) return;

    const info = LampSystem.getInstance().getLampDisplayInfo(this.currentLampId);
    if (!info) return;

    // Update name
    const nameEl = this.container.querySelector(".lamp-name");
    if (nameEl) nameEl.textContent = `💡 ${info.name}`;

    // Update power button
    const powerBtn = this.container.querySelector(".lamp-power-btn");
    if (powerBtn) {
      powerBtn.textContent = info.isOn ? "ON" : "OFF";
      powerBtn.className = `lamp-power-btn ${info.isOn ? "on" : "off"}`;
    }

    // Update intensity
    const intensitySlider = this.container.querySelector(".lamp-intensity-slider") as HTMLInputElement;
    const intensityValue = this.container.querySelector(".lamp-intensity-value");
    if (intensitySlider) intensitySlider.value = info.intensity.toString();
    if (intensityValue) intensityValue.textContent = `${info.intensity}%`;

    // Update spectrum
    const spectrumSlider = this.container.querySelector(".lamp-spectrum-slider") as HTMLInputElement;
    const spectrumValue = this.container.querySelector(".lamp-spectrum-value");
    if (spectrumSlider) spectrumSlider.value = info.spectrum.toString();
    if (spectrumValue) spectrumValue.textContent = info.spectrumLabel;

    // Update coverage
    const coverageEl = this.container.querySelector(".lamp-coverage");
    if (coverageEl) {
      coverageEl.textContent = `${info.coverageCount} plant${info.coverageCount !== 1 ? "s" : ""}`;
    }

    // Update power cost
    const costEl = this.container.querySelector(".lamp-power-cost");
    if (costEl) {
      costEl.textContent = info.isOn ? `$${info.powerCost}/day` : "$0/day";
    }
  }

  private showSelectionIndicator(position: { x: number; y: number; z: number }): void {
    const worldIndicator = WorldIndicatorSystem.getInstance();
    if (!worldIndicator.isInitialized()) return;

    worldIndicator.removeIndicator(SELECTION_INDICATOR_ID);

    worldIndicator.addIndicator({
      id: SELECTION_INDICATOR_ID,
      worldPosition: position,
      config: {
        icon: "🔘",
        animation: "pulse",
        offsetY: 50,
      },
    });
  }

  private hideSelectionIndicator(): void {
    WorldIndicatorSystem.getInstance().removeIndicator(SELECTION_INDICATOR_ID);
  }

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;
    UIStyles.injectCSS("lamp-info-panel", lampInfoPanelCSS);
  }
}
