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

import { WorldIndicatorSystem } from "../engine/core/WorldIndicatorSystem";
import { LampSystem } from "../game/LampSystem";

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

    const style = document.createElement("style");
    style.textContent = `
      #lamp-info-panel {
        position: fixed;
        bottom: 100px;
        right: 20px;
        width: 260px;
        background: rgba(0, 0, 0, 0.9);
        border-radius: 12px;
        color: white;
        overflow: hidden;
        z-index: 200;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 200, 50, 0.3);
      }

      .lamp-info-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        background: linear-gradient(135deg, rgba(255, 200, 50, 0.3), rgba(255, 150, 0, 0.2));
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .lamp-name {
        font-weight: bold;
        font-size: 16px;
      }

      .lamp-info-close {
        background: none;
        border: none;
        color: white;
        font-size: 22px;
        cursor: pointer;
        opacity: 0.7;
        line-height: 1;
      }

      .lamp-info-close:hover {
        opacity: 1;
      }

      .lamp-info-body {
        padding: 15px;
      }

      .lamp-power-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .lamp-power-btn {
        padding: 6px 20px;
        border: none;
        border-radius: 15px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .lamp-power-btn.on {
        background: linear-gradient(135deg, #4CAF50, #45a049);
        color: white;
      }

      .lamp-power-btn.off {
        background: rgba(255, 255, 255, 0.2);
        color: #aaa;
      }

      .lamp-power-btn:hover {
        transform: scale(1.05);
      }

      .lamp-stat {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        font-size: 14px;
      }

      .lamp-stat span:first-child {
        width: 70px;
      }

      .lamp-stat input[type="range"] {
        flex: 1;
        height: 6px;
        -webkit-appearance: none;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        cursor: pointer;
      }

      .lamp-stat input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, #ffc107, #ff9800);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .lamp-intensity-value {
        width: 40px;
        text-align: right;
        font-weight: bold;
        color: #ffc107;
      }

      .lamp-spectrum-value {
        width: 80px;
        text-align: right;
        font-size: 12px;
        color: #aaa;
      }

      .lamp-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        font-size: 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }

      .lamp-coverage {
        color: #4CAF50;
        font-weight: bold;
      }

      .lamp-power-cost {
        color: #ffc107;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }
}
