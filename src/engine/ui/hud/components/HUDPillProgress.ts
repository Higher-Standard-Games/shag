/**
 * HUDPillProgress - Pill with integrated progress bar
 */

import { HUDElement } from '../HUDElement';
import type { HUDPillProgressConfig } from '../HUDTypes';

export class HUDPillProgress extends HUDElement {
  protected config: HUDPillProgressConfig;
  private iconEl!: HTMLElement;
  private valueEl!: HTMLElement;
  private progressContainer!: HTMLElement;
  private progressFill!: HTMLElement;
  private currentValue: any = null;
  private currentProgress: number = 0;

  constructor(id: string, config: HUDPillProgressConfig) {
    super(id, config as any);
    this.config = config;
  }

  protected createElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hud-pill hud-pill-progress';
    el.id = `hud-${this.id}`;

    // Icon
    this.iconEl = document.createElement('span');
    this.iconEl.className = 'hud-pill-icon';
    this.iconEl.textContent = this.config.icon || '';
    el.appendChild(this.iconEl);

    // Value
    this.valueEl = document.createElement('span');
    this.valueEl.className = 'hud-pill-value';
    el.appendChild(this.valueEl);

    // Progress bar
    this.progressContainer = document.createElement('div');
    this.progressContainer.className = 'hud-pill-progress-bar';
    
    this.progressFill = document.createElement('div');
    this.progressFill.className = 'hud-pill-progress-fill';
    this.progressContainer.appendChild(this.progressFill);
    
    el.appendChild(this.progressContainer);

    // Clickable styling
    if (this.config.clickable) {
      el.classList.add('hud-pill-clickable');
    }

    return el;
  }

  public setValue(value: any): void {
    if (value === this.currentValue) return;
    this.currentValue = value;

    // Format the value
    let displayValue = value;
    if (this.config.format && value != null) {
      displayValue = this.formatValue(value, this.config.format);
    }

    this.valueEl.textContent = String(displayValue ?? '');
  }

  /**
   * Set progress value (0-1)
   */
  public setProgress(progress: number): void {
    this.currentProgress = Math.max(0, Math.min(1, progress));
    this.progressFill.style.width = `${this.currentProgress * 100}%`;
  }

  /**
   * Format a value using printf-style format string
   */
  private formatValue(value: any, format: string): string {
    if (format.includes('%d')) {
      return format.replace('%d', String(Math.floor(Number(value))));
    }
    if (format.includes('%s')) {
      return format.replace('%s', String(value));
    }
    return format.replace('%', String(value));
  }

  /**
   * Set the icon
   */
  public setIcon(icon: string): void {
    this.iconEl.textContent = icon;
  }
}
