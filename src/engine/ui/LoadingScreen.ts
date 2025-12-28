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

      // Animated background glow at bottom - crossfades between logo colors
      // Use two overlapping glow layers for smooth opacity-based crossfade
      const glowContainer = document.createElement("div");
      glowContainer.style.cssText = `
        position: absolute;
        bottom: -5%;
        left: 50%;
        transform: translateX(-50%);
        width: 150%;
        height: 25%;
        pointer-events: none;
      `;
      
      const createGlowLayer = (color: typeof LOGO_PALETTE[0]) => {
        const r = parseInt(color.bg.slice(1, 3), 16);
        const g = parseInt(color.bg.slice(3, 5), 16);
        const b = parseInt(color.bg.slice(5, 7), 16);
        const layer = document.createElement("div");
        layer.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: radial-gradient(ellipse 50% 100% at 50% 100%, rgba(${r}, ${g}, ${b}, 0.5) 0%, rgba(${r}, ${g}, ${b}, 0.2) 40%, transparent 70%);
          opacity: 0;
          transition: opacity 1.5s ease-in-out;
        `;
        return layer;
      };
      
      // Create glow layers for each color
      const glowLayers = LOGO_PALETTE.map(color => createGlowLayer(color));
      glowLayers.forEach(layer => glowContainer.appendChild(layer));
      this.container.appendChild(glowContainer);
      
      // Start with first color visible
      let currentGlowIndex = 0;
      glowLayers[0].style.opacity = '1';
      
      // Crossfade between colors
      const glowInterval = setInterval(() => {
        const prevIndex = currentGlowIndex;
        currentGlowIndex = (currentGlowIndex + 1) % LOGO_PALETTE.length;
        glowLayers[prevIndex].style.opacity = '0';
        glowLayers[currentGlowIndex].style.opacity = '1';
      }, 2500);

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

      // Central pulsing dot with color rotation (uses logo palette)
      const centerDot = document.createElement("div");
      centerDot.style.cssText = `
        width: 32px;
        height: 32px;
        background: ${LOGO_PALETTE[0].bg};
        border-radius: 50%;
        box-shadow: 0 0 20px ${LOGO_PALETTE[0].glow};
        animation: centerPulse 2s ease-in-out infinite;
        z-index: 2;
        transition: background 0.5s ease, box-shadow 0.5s ease;
      `;
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
        clearInterval(glowInterval);
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
