/**
 * DebugOverlay - Small debug console overlay at bottom-left
 *
 * Shows last N console log lines with fadeout, toggled via console_debug command
 */

interface DebugLine {
  text: string;
  timestamp: number;
  element: HTMLDivElement;
}

export class DebugOverlay {
  private static instance: DebugOverlay | null = null;

  private container: HTMLDivElement | null = null;
  private lines: DebugLine[] = [];
  private enabled: boolean = false;
  private originalConsoleLog: typeof console.log;
  private originalConsoleWarn: typeof console.warn;
  private originalConsoleError: typeof console.error;

  private readonly MAX_LINES = 8;
  private readonly FADEOUT_MS = 10000; // 10 seconds
  private readonly CHECK_INTERVAL_MS = 500;

  private intervalId: number | null = null;

  private constructor() {
    // Store original console methods
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
    this.originalConsoleError = console.error.bind(console);
  }

  static getInstance(): DebugOverlay {
    if (!DebugOverlay.instance) {
      DebugOverlay.instance = new DebugOverlay();
    }
    return DebugOverlay.instance;
  }

  /**
   * Enable/disable the debug overlay
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;

    this.enabled = enabled;

    if (enabled) {
      this.createContainer();
      this.hookConsole();
      this.startFadeoutCheck();
    } else {
      this.unhookConsole();
      this.stopFadeoutCheck();
      this.destroyContainer();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private createContainer(): void {
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "debug-overlay";
    this.container.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      max-width: 600px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.3;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
    `;
    document.body.appendChild(this.container);
  }

  private destroyContainer(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.lines = [];
  }

  private hookConsole(): void {
    console.log = (...args: unknown[]) => {
      this.originalConsoleLog.apply(console, args);
      this.addLine(args.map((a) => this.stringify(a)).join(" "), "#0f0");
    };

    console.warn = (...args: unknown[]) => {
      this.originalConsoleWarn.apply(console, args);
      this.addLine(args.map((a) => this.stringify(a)).join(" "), "#ff0");
    };

    console.error = (...args: unknown[]) => {
      this.originalConsoleError.apply(console, args);
      this.addLine(args.map((a) => this.stringify(a)).join(" "), "#f55");
    };
  }

  private unhookConsole(): void {
    console.log = this.originalConsoleLog;
    console.warn = this.originalConsoleWarn;
    console.error = this.originalConsoleError;
  }

  private stringify(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private addLine(text: string, color: string): void {
    if (!this.container || !this.enabled) return;

    // Create line element
    const element = document.createElement("div");
    element.style.cssText = `
      color: ${color};
      background: rgba(0, 0, 0, 0.7);
      padding: 2px 6px;
      margin-bottom: 2px;
      border-radius: 2px;
      opacity: 1;
      transition: opacity 0.5s ease-out;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      text-shadow: 1px 1px 1px #000;
    `;

    // Truncate long lines
    const maxLen = 100;
    element.textContent = text.length > maxLen ? `${text.substring(0, maxLen)}...` : text;
    element.title = text; // Full text on hover

    // Add to container
    this.container.appendChild(element);

    // Track line
    this.lines.push({
      text,
      timestamp: Date.now(),
      element,
    });

    // Remove excess lines
    while (this.lines.length > this.MAX_LINES) {
      const removed = this.lines.shift();
      removed?.element.remove();
    }
  }

  private startFadeoutCheck(): void {
    if (this.intervalId !== null) return;

    this.intervalId = window.setInterval(() => {
      const now = Date.now();

      for (const line of this.lines) {
        const age = now - line.timestamp;

        if (age > this.FADEOUT_MS) {
          // Start fading
          const fadeProgress = Math.min(1, (age - this.FADEOUT_MS) / 2000); // 2s fade
          line.element.style.opacity = String(1 - fadeProgress);

          // Remove fully faded lines
          if (fadeProgress >= 1) {
            line.element.remove();
          }
        }
      }

      // Clean up removed lines
      this.lines = this.lines.filter((l) => l.element.parentNode !== null);
    }, this.CHECK_INTERVAL_MS);
  }

  private stopFadeoutCheck(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// Export singleton getter
export function getDebugOverlay(): DebugOverlay {
  return DebugOverlay.getInstance();
}
