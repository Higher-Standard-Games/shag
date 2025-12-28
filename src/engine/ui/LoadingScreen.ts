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

export class LoadingScreen {
  private container: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressFill: HTMLDivElement;
  private progressText: HTMLDivElement;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.style.cssText = `
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
      font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
      color: #fff;
    `;

    // Engine logo - centered
    const logo = document.createElement("img");
    logo.src = "engine.png";
    logo.alt = "SHAG Engine";
    logo.style.cssText = `
      width: 280px;
      height: auto;
      margin-bottom: 40px;
    `;
    this.container.appendChild(logo);

    // Progress bar container
    this.progressBar = document.createElement("div");
    this.progressBar.style.cssText = `
      width: 300px;
      height: 3px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      overflow: hidden;
    `;

    // Progress bar fill
    this.progressFill = document.createElement("div");
    this.progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #1a5a2a, #2d8a3e);
      transition: width 0.3s ease;
      box-shadow: 0 0 10px rgba(45, 138, 62, 0.5);
    `;
    this.progressBar.appendChild(this.progressFill);
    this.container.appendChild(this.progressBar);

    // Hidden progress text (API compatibility)
    this.progressText = document.createElement("div");
    this.progressText.style.cssText = `display: none;`;
    this.container.appendChild(this.progressText);

    // Engine branding - bottom right corner
    this.createBranding();
  }

  private createBranding(): void {
    const engineBranding = document.createElement("div");
    engineBranding.style.cssText = `
      position: absolute;
      bottom: 16px;
      right: 16px;
      text-align: right;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.3);
      line-height: 1.4;
    `;
    
    const engineName = document.createElement("div");
    engineName.textContent = EngineVersion.getInstance().getEngineName();
    engineName.style.cssText = `font-weight: 600; font-size: 12px;`;
    engineBranding.appendChild(engineName);
    
    const tagline = document.createElement("div");
    tagline.textContent = EngineVersion.getInstance().getEngineTagline();
    tagline.style.cssText = `font-size: 10px; font-style: italic;`;
    engineBranding.appendChild(tagline);
    
    const version = document.createElement("div");
    version.textContent = EngineVersion.getInstance().getVersionString();
    version.style.cssText = `font-size: 10px; margin-top: 4px;`;
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

      // Add subtle green glow at bottom
      const glow = document.createElement("div");
      glow.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 150%;
        height: 40%;
        background: radial-gradient(ellipse 50% 100% at 50% 100%, rgba(10, 35, 15, 0.8) 0%, rgba(5, 20, 8, 0.4) 40%, transparent 70%);
        pointer-events: none;
      `;
      this.container.appendChild(glow);

      // Make container clickable
      this.container.style.cursor = 'pointer';

      // Ripple container - universal "tap here" indicator
      const rippleContainer = document.createElement("div");
      rippleContainer.style.cssText = `
        position: relative;
        width: 80px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 20px;
      `;

      // Central pulsing dot with color rotation
      const centerDot = document.createElement("div");
      centerDot.style.cssText = `
        width: 32px;
        height: 32px;
        background: rgb(37, 182, 120);
        border-radius: 50%;
        box-shadow: 0 0 20px rgba(37, 182, 120, 0.6);
        animation: centerPulse 2s ease-in-out infinite;
        z-index: 2;
        transition: background 0.5s ease, box-shadow 0.5s ease;
      `;
      rippleContainer.appendChild(centerDot);

      // Color palette for random rotation
      const colorPalette = [
        { bg: 'rgb(37, 182, 120)', glow: 'rgba(37, 182, 120, 0.6)' },
        { bg: 'rgb(99, 211, 199)', glow: 'rgba(99, 211, 199, 0.6)' },
        { bg: 'rgb(134, 233, 216)', glow: 'rgba(134, 233, 216, 0.6)' },
        { bg: 'rgb(254, 200, 49)', glow: 'rgba(254, 200, 49, 0.6)' },
        { bg: 'rgb(60, 197, 196)', glow: 'rgba(60, 197, 196, 0.6)' },
        { bg: 'rgb(254, 167, 39)', glow: 'rgba(254, 167, 39, 0.6)' },
      ];

      // Random color rotation interval
      const colorInterval = setInterval(() => {
        const colorIndex = Math.floor(Math.random() * colorPalette.length);
        const color = colorPalette[colorIndex];
        centerDot.style.background = color.bg;
        centerDot.style.boxShadow = `0 0 25px ${color.glow}`;
      }, 800 + Math.random() * 400);

      // Create 3 ripple rings with staggered animations
      const rippleColors = [
        'rgba(37, 182, 120, 0.6)',
        'rgba(99, 211, 199, 0.5)',
        'rgba(134, 233, 216, 0.4)',
      ];

      for (let i = 0; i < 3; i++) {
        const ripple = document.createElement("div");
        ripple.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 20px;
          height: 20px;
          border: 2px solid ${rippleColors[i]};
          border-radius: 50%;
          animation: rippleWave 2.4s ease-out infinite;
          animation-delay: ${i * 0.8}s;
          opacity: 0;
        `;
        rippleContainer.appendChild(ripple);
      }

      // Add ripple animations
      const style = document.createElement("style");
      style.id = "loading-screen-animations";
      style.textContent = `
        @keyframes rippleWave {
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
        @keyframes centerPulse {
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
      document.head.appendChild(style);

      this.container.appendChild(rippleContainer);

      // On click, unlock audio and resolve
      const handleClick = () => {
        clearInterval(colorInterval);
        style.remove();
        
        // Unlock browser audio context
        AudioManager.getInstance().unlockAudio();
        
        resolve();
      };

      this.container.addEventListener("click", handleClick, { once: true });
    });
  }

  public hide(): void {
    this.container.style.opacity = "0";
    this.container.style.transition = "opacity 0.5s ease";
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }
}
