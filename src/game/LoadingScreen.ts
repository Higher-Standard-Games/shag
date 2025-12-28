import type { LoadProgress } from "../engine/AssetLoader";
import { EngineVersion } from "../engine/core/EngineVersion";

export class LoadingScreen {
  private container: HTMLDivElement;
  private progressText: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressFill: HTMLDivElement;

  constructor() {
    // Create container with radial gradient glow from bottom
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
    logo.src = "engine.svg";
    logo.alt = "Engine";
    logo.style.cssText = `
      width: 280px;
      height: auto;
      margin-bottom: 40px;
    `;
    this.container.appendChild(logo);

    // Progress bar container - below logo
    this.progressBar = document.createElement("div");
    this.progressBar.style.cssText = `
      width: 300px;
      height: 3px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      overflow: hidden;
    `;

    // Progress bar fill - green gradient
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

    // Hidden progress text (keep for API compatibility but don't show)
    this.progressText = document.createElement("div");
    this.progressText.style.cssText = `display: none;`;
    this.container.appendChild(this.progressText);

    // Engine branding - bottom right corner
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

  public hide(): void {
    this.container.style.opacity = "0";
    this.container.style.transition = "opacity 0.5s ease";
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }

  public updateProgress(progress: LoadProgress): void {
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = progress.currentAsset || "Initializing...";
  }
}
