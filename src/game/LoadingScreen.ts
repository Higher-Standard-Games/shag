import type { LoadProgress } from "../engine/AssetLoader";

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
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #fff;
    `;

    // Engine logo - centered
    const logo = document.createElement("img");
    logo.src = "engine.svg";
    logo.alt = "Engine";
    logo.style.cssText = `
      width: 200px;
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
