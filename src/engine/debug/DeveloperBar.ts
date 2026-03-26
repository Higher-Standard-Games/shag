/**
 * DeveloperBar - Full-width bottom status bar for developer mode
 *
 * Activated by `developer 1`. Shows:
 * - Left 50%: Static stats in green (FPS, PING, SPEED, POS)
 * - Right 50%: Latest console.log message in orange (live-updating)
 */

export class DeveloperBar {
  private static instance: DeveloperBar | null = null;

  private container: HTMLDivElement | null = null;
  private statsEl: HTMLSpanElement | null = null;
  private logEl: HTMLSpanElement | null = null;

  private visible = false;

  // Stats values
  private fps = 0;
  private ping = -1; // -1 = not connected
  private speed = 0;
  private posX = 0;
  private posY = 0;
  private posZ = 0;

  // Throttle stats update to 4Hz
  private lastStatsUpdate = 0;
  private static readonly STATS_INTERVAL = 250; // ms

  private constructor() {}

  static getInstance(): DeveloperBar {
    if (!DeveloperBar.instance) {
      DeveloperBar.instance = new DeveloperBar();
    }
    return DeveloperBar.instance;
  }

  /**
   * Show the developer bar
   */
  show(): void {
    if (this.visible) return;
    this.visible = true;

    if (!this.container) {
      this.createDOM();
    }
    this.container!.style.display = "flex";
  }

  /**
   * Hide the developer bar
   */
  hide(): void {
    if (!this.visible) return;
    this.visible = false;

    if (this.container) {
      this.container.style.display = "none";
    }
  }

  /**
   * Check if bar is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update stats (called from game loop). Throttled to 4Hz internally.
   */
  setStats(fps: number, ping: number, speed: number, pos: { x: number; y: number; z: number }): void {
    this.fps = fps;
    this.ping = ping;
    this.speed = speed;
    this.posX = pos.x;
    this.posY = pos.y;
    this.posZ = pos.z;

    if (!this.visible || !this.statsEl) return;

    const now = performance.now();
    if (now - this.lastStatsUpdate < DeveloperBar.STATS_INTERVAL) return;
    this.lastStatsUpdate = now;

    const pingStr = this.ping >= 0 ? `${this.ping}ms` : "--";
    this.statsEl.textContent =
      `FPS: ${this.fps.toFixed(0).padStart(3)}  ` +
      `PING: ${pingStr.padStart(5)}  ` +
      `SPEED: ${this.speed.toFixed(0).padStart(4)} u/s  ` +
      `POS: ${this.posX.toFixed(0)}, ${this.posY.toFixed(0)}, ${this.posZ.toFixed(0)}`;
  }

  /**
   * Set the latest log message (shown in orange). Called on every console.log.
   */
  setLastLog(message: string): void {
    if (!this.visible || !this.logEl) return;
    // Strip HTML tags and truncate
    const clean = message.replace(/<[^>]*>/g, "").replace(/\n/g, " ");
    const truncated = clean.length > 120 ? clean.substring(0, 117) + "..." : clean;
    this.logEl.textContent = truncated;
  }

  /**
   * Dispose and clean up DOM
   */
  dispose(): void {
    this.container?.remove();
    this.container = null;
    this.statsEl = null;
    this.logEl = null;
    this.visible = false;
    DeveloperBar.instance = null;
  }

  // ============================================================================
  // DOM
  // ============================================================================

  private createDOM(): void {
    this.container = document.createElement("div");
    this.container.id = "developer-bar";
    this.container.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 24px;
      background: #000;
      display: flex;
      align-items: center;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      z-index: 99999;
      pointer-events: none;
      user-select: none;
      padding: 0 8px;
      box-sizing: border-box;
      border-top: 1px solid #222;
    `;

    // Stats section (left 50%)
    this.statsEl = document.createElement("span");
    this.statsEl.style.cssText = `
      flex: 0 0 50%;
      color: #0f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: 0.5px;
    `;
    this.statsEl.textContent = "FPS: ---  PING: --  SPEED: --- u/s  POS: 0, 0, 0";

    // Live log section (right 50%)
    this.logEl = document.createElement("span");
    this.logEl.style.cssText = `
      flex: 0 0 50%;
      color: #f90;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: right;
      opacity: 0.9;
    `;
    this.logEl.textContent = "";

    this.container.appendChild(this.statsEl);
    this.container.appendChild(this.logEl);
    document.body.appendChild(this.container);
  }
}
