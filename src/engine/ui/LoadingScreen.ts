/**
 * LoadingScreen - Engine-level loading and ready screen
 * 
 * Handles:
 * 1. Asset loading progress display
 * 2. "Tap to start" ready screen (unlocks browser audio)
 * 
 * This is an engine component - game-agnostic.
 */

import type { LoadProgress } from '../AssetLoader';
import { AudioManager } from '../AudioManager';
import { EngineVersion } from '../core/EngineVersion';
import { UIStyles } from './UIStyles';

/**
 * Color palette extracted from the SHAG logo
 * Used for pulsing dot and background glow animations
 */
const LOGO_PALETTE = [
  { bg: '#E85D04', glow: 'rgba(232, 93, 4, 0.6)' },   // Orange (S)
  { bg: '#FAC748', glow: 'rgba(250, 199, 72, 0.6)' }, // Yellow (H)
  { bg: '#2EC4B6', glow: 'rgba(46, 196, 182, 0.6)' }, // Teal (A)
  { bg: '#E040FB', glow: 'rgba(224, 64, 251, 0.6)' }, // Pink/Magenta (G)
  { bg: '#4ADE80', glow: 'rgba(74, 222, 128, 0.6)' }, // Green (glow)
];

export class LoadingScreen {
  private container: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressFill: HTMLDivElement;
  private progressText: HTMLDivElement;

  constructor() {
    // Ensure styles are injected
    UIStyles.injectBase();

    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.className = "ui-loading-screen";

    // Engine logo - centered
    const logo = document.createElement("img");
    logo.src = "engine.png";
    logo.alt = "SHAG Engine";
    logo.className = "ui-loading-logo";
    this.container.appendChild(logo);

    // Progress bar container
    this.progressBar = document.createElement("div");
    this.progressBar.className = "ui-loading-progress";

    // Progress bar fill
    this.progressFill = document.createElement("div");
    this.progressFill.className = "ui-loading-progress__fill";
    this.progressBar.appendChild(this.progressFill);
    this.container.appendChild(this.progressBar);

    // Hidden progress text (API compatibility)
    this.progressText = document.createElement("div");
    this.progressText.style.display = "none";
    this.container.appendChild(this.progressText);

    // Engine branding - bottom right corner
    this.createBranding();
  }

  private createBranding(): void {
    const engineBranding = document.createElement("div");
    engineBranding.className = "ui-loading-branding";
    
    const engineName = document.createElement("div");
    engineName.textContent = EngineVersion.getInstance().getEngineName();
    engineName.className = "ui-loading-branding__name";
    engineBranding.appendChild(engineName);
    
    const tagline = document.createElement("div");
    tagline.textContent = EngineVersion.getInstance().getEngineTagline();
    tagline.className = "ui-loading-branding__tagline";
    engineBranding.appendChild(tagline);
    
    const version = document.createElement("div");
    version.textContent = EngineVersion.getInstance().getVersionString();
    version.className = "ui-loading-branding__version";
    engineBranding.appendChild(version);
    
    this.container.appendChild(engineBranding);
  }

  public show(): void {
    document.body.appendChild(this.container);
  }

  public updateProgress(progress: LoadProgress): void {
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = progress.currentAsset || "Initializing...";
  }

  /**
   * Show "tap to start" overlay and wait for user interaction.
   * This unlocks browser audio context.
   */
  public waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // Hide progress bar, show ready state
      this.progressBar.style.display = 'none';
      this.container.classList.add('ui-loading-screen--ready');

      // Smoke effect - colored puffs rising and fading
      const smokeContainer = document.createElement("div");
      smokeContainer.className = "ui-loading-smoke-container";
      
      const SMOKE_COUNT = 15;
      const smokePuffs: HTMLDivElement[] = [];
      
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const puff = document.createElement("div");
        puff.className = "ui-loading-smoke-puff";
        
        // Random color from palette
        const color = LOGO_PALETTE[i % LOGO_PALETTE.length];
        
        // Random size between 80-200px
        const size = 80 + Math.random() * 120;
        puff.style.width = `${size}px`;
        puff.style.height = `${size}px`;
        
        // Random horizontal position
        puff.style.left = `${Math.random() * 100}%`;
        
        // Random drift direction and rotation
        const driftX = (Math.random() - 0.5) * 150;
        const rotation = (Math.random() - 0.5) * 360;
        puff.style.setProperty('--drift-x', `${driftX}px`);
        puff.style.setProperty('--rotation', `${rotation}deg`);
        
        // Random animation duration (12-20s) and delay - slow and dreamy
        const duration = 12 + Math.random() * 8;
        const delay = Math.random() * 10;
        puff.style.animationDuration = `${duration}s`;
        puff.style.animationDelay = `${delay}s`;
        
        // Set color with radial gradient for soft edges
        puff.style.background = `radial-gradient(circle, ${color.bg} 0%, transparent 70%)`;
        
        smokeContainer.appendChild(puff);
        smokePuffs.push(puff);
      }
      
      this.container.appendChild(smokeContainer);
      
      // Color rotation for smoke puffs
      const smokeColorInterval = setInterval(() => {
        smokePuffs.forEach((puff, i) => {
          const colorIndex = (i + Math.floor(Math.random() * LOGO_PALETTE.length)) % LOGO_PALETTE.length;
          const color = LOGO_PALETTE[colorIndex];
          puff.style.background = `radial-gradient(circle, ${color.bg} 0%, transparent 70%)`;
        });
      }, 3000);

      // Ripple container - universal "tap here" indicator
      const rippleContainer = document.createElement("div");
      rippleContainer.className = "ui-loading-ripple-container";

      // Central pulsing dot with color rotation (uses logo palette)
      const centerDot = document.createElement("div");
      centerDot.className = "ui-loading-center-dot";
      // Dynamic colors must be inline
      centerDot.style.background = LOGO_PALETTE[0].bg;
      centerDot.style.boxShadow = `0 0 20px ${LOGO_PALETTE[0].glow}`;
      rippleContainer.appendChild(centerDot);

      // Random color rotation interval using logo palette
      const colorInterval = setInterval(() => {
        const colorIndex = Math.floor(Math.random() * LOGO_PALETTE.length);
        const color = LOGO_PALETTE[colorIndex];
        centerDot.style.background = color.bg;
        centerDot.style.boxShadow = `0 0 25px ${color.glow}`;
      }, 800 + Math.random() * 400);

      // Create 3 ripple rings with staggered animations (using logo palette)
      const rippleColors = [
        LOGO_PALETTE[0].glow,  // Orange
        LOGO_PALETTE[1].glow,  // Yellow
        LOGO_PALETTE[2].glow,  // Teal
      ];

      for (let i = 0; i < 3; i++) {
        const ripple = document.createElement("div");
        ripple.className = "ui-loading-ripple";
        // Dynamic color and delay must be inline
        ripple.style.borderColor = rippleColors[i];
        ripple.style.animationDelay = `${i * 0.8}s`;
        rippleContainer.appendChild(ripple);
      }

      this.container.appendChild(rippleContainer);

      // On click, unlock audio and resolve
      const handleClick = () => {
        clearInterval(colorInterval);
        clearInterval(smokeColorInterval);
        
        // Unlock browser audio context
        AudioManager.getInstance().unlockAudio();
        
        resolve();
      };

      this.container.addEventListener("click", handleClick, { once: true });
    });
  }

  public hide(): void {
    this.container.classList.add('ui-loading-screen--hiding');
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }
}
