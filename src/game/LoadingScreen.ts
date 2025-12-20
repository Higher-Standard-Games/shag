import type { LoadProgress } from "../engine/AssetLoader";

export class LoadingScreen {
  private container: HTMLDivElement;
  private progressText: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressFill: HTMLDivElement;

  constructor() {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #0a0a0a;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #fff;
    `;

    // Title
    const title = document.createElement("h1");
    title.textContent = "Loading...";
    title.style.cssText = `
      font-size: 2rem;
      margin-bottom: 2rem;
      font-weight: 300;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    `;
    this.container.appendChild(title);

    // Progress bar container
    this.progressBar = document.createElement("div");
    this.progressBar.style.cssText = `
      width: 300px;
      height: 4px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 1rem;
    `;

    // Progress bar fill
    this.progressFill = document.createElement("div");
    this.progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #4a9eff, #00d4aa);
      transition: width 0.3s ease;
    `;
    this.progressBar.appendChild(this.progressFill);
    this.container.appendChild(this.progressBar);

    // Progress text
    this.progressText = document.createElement("div");
    this.progressText.style.cssText = `
      font-size: 0.875rem;
      color: #888;
    `;
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
