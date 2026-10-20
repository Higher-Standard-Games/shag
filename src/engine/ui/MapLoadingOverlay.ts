/**
 * MapLoadingOverlay - In-game loading screen for map transitions
 *
 * Owns WHEN the screen is up: it shows on `loading:start`, stays down past
 * `loading:complete` while anything holds it, and fades out after a minimum
 * display time. WHAT is on it is a `MapLoadingView`. The default view is the
 * engine's own:
 * - Animated smoke background (shared LoadingAnimation)
 * - Engine/game logo
 * - Console-style loading messages
 * - Engine branding
 *
 * Listens to EventBus loading events - completely decoupled from MapLoader.
 *
 * Usage:
 *   // Enable during game init (subscribes to EventBus)
 *   MapLoadingOverlay.enable();
 *
 *   // Optional: Configure the default view's appearance
 *   MapLoadingOverlay.configure({
 *     showLogo: true,
 *     logoUrl: 'games/mygame/logo.png',
 *   });
 *
 *   // Or give the screen a look of the game's own, on the same timing
 *   MapLoadingOverlay.configure({ view: () => new MyLoadingView() });
 *
 *   // Disable if using custom loading UI
 *   MapLoadingOverlay.disable();
 */

import { devLog } from "../core/DevLog";
import { EngineVersion } from "../core/EngineVersion";
import { EventBus } from "../core/EventBus";
import {
  LOADING_EVENTS,
  type LoadingCompleteEvent,
  type LoadingProgressEvent,
  type LoadingStartEvent,
} from "../core/LoadingEvents";
import { LoadingAnimation } from "./LoadingAnimation";
import { type PaletteColor, SHAG_PALETTE } from "./LoadingPalettes";
import { UIStyles } from "./UIStyles";

/** Overlay states */
type OverlayState = "idle" | "showing" | "loading" | "completing" | "fading";

/**
 * What a loading screen shows. The overlay decides when it is up and when it
 * fades; a view only draws what the load is doing.
 */
export interface MapLoadingView {
  /** Build the screen inside the overlay's container, for the map starting. */
  mount(container: HTMLElement, map: LoadingStartEvent): void;
  /** Another map started before this screen came down. */
  restart(map: LoadingStartEvent): void;
  progress(event: LoadingProgressEvent): void;
  /** The map finished; `waitingFor` names the holds still keeping the screen up. */
  complete(event: LoadingCompleteEvent, waitingFor: string[]): void;
  /** Nothing holds the screen any more: it fades next. */
  ready(): void;
  destroy(): void;
}

/** Configuration options */
export interface MapLoadingOverlayConfig {
  /** Minimum time overlay is visible before fade can start (ms) */
  minDisplayMs: number;
  /** Hold time after complete before fade starts (ms) */
  completeHoldMs: number;
  /** Fade-out animation duration (ms) */
  fadeDurationMs: number;
  /** Show engine/game logo */
  showLogo: boolean;
  /** Custom logo URL (null = engine logo) */
  logoUrl: string | null;
  /** Show console-style messages */
  showMessages: boolean;
  /** Maximum visible messages */
  messageCount: number;
  /** Show engine branding in corner */
  showBranding: boolean;
  /** Enable smoke animation */
  animationEnabled: boolean;
  /** Custom animation color palette */
  animationColors: PaletteColor[] | null;
  /** Loading types to respond to */
  loadingTypes: string[];
  /** Safety net: force-release a hold its owner never released (ms) */
  holdTimeoutMs: number;
  /** A failed load keeps its error on screen at least this long (ms) */
  failureHoldMs: number;
  /** Builds the screen for each load (null = the engine's own view) */
  view: (() => MapLoadingView) | null;
}

const DEFAULT_CONFIG: MapLoadingOverlayConfig = {
  minDisplayMs: 800,
  completeHoldMs: 500,
  fadeDurationMs: 500,
  showLogo: true,
  logoUrl: null,
  showMessages: true,
  messageCount: 6,
  showBranding: true,
  animationEnabled: true,
  animationColors: null,
  loadingTypes: ["map"],
  holdTimeoutMs: 20000,
  failureHoldMs: 2500,
  view: null,
};

export class MapLoadingOverlay {
  private static instance: MapLoadingOverlay;

  // State
  private state: OverlayState = "idle";
  private showTime: number = 0;
  private config: MapLoadingOverlayConfig = { ...DEFAULT_CONFIG };
  private enabled: boolean = false;

  // DOM elements
  private container: HTMLDivElement | null = null;
  private view: MapLoadingView | null = null;
  private failed = false;

  // Holds keeping the curtain down past `loading:complete`
  private holds: Set<string> = new Set();
  private holdTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // EventBus subscriptions
  private unsubscribers: (() => void)[] = [];

  // Timers
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    // Ensure styles are injected
    UIStyles.injectBase();
    this.injectStyles();
  }

  static getInstance(): MapLoadingOverlay {
    if (!MapLoadingOverlay.instance) {
      MapLoadingOverlay.instance = new MapLoadingOverlay();
    }
    return MapLoadingOverlay.instance;
  }

  /**
   * Configure the overlay appearance
   */
  static configure(config: Partial<MapLoadingOverlayConfig>): void {
    const instance = MapLoadingOverlay.getInstance();
    instance.config = { ...instance.config, ...config };
  }

  /**
   * Enable the overlay (subscribe to EventBus)
   */
  static enable(): void {
    const instance = MapLoadingOverlay.getInstance();
    if (instance.enabled) return;

    // No-op in headless mode
    if (typeof document === "undefined") {
      devLog("[MapLoadingOverlay] Headless mode - disabled");
      return;
    }

    instance.enabled = true;

    // Subscribe to loading events
    instance.unsubscribers.push(
      EventBus.on(LOADING_EVENTS.START, (event: LoadingStartEvent) => {
        if (instance.config.loadingTypes.includes(event.type)) {
          instance.onLoadingStart(event);
        }
      }),
    );

    instance.unsubscribers.push(
      EventBus.on(LOADING_EVENTS.PROGRESS, (event: LoadingProgressEvent) => {
        if (instance.config.loadingTypes.includes(event.type)) {
          instance.onLoadingProgress(event);
        }
      }),
    );

    instance.unsubscribers.push(
      EventBus.on(LOADING_EVENTS.COMPLETE, (event: LoadingCompleteEvent) => {
        if (instance.config.loadingTypes.includes(event.type)) {
          instance.onLoadingComplete(event);
        }
      }),
    );

    devLog("[MapLoadingOverlay] Enabled");
  }

  /**
   * Disable the overlay (unsubscribe from EventBus)
   */
  static disable(): void {
    const instance = MapLoadingOverlay.getInstance();
    if (!instance.enabled) return;

    instance.enabled = false;

    // Unsubscribe from all events
    for (const unsub of instance.unsubscribers) {
      unsub();
    }
    instance.unsubscribers = [];

    // Drop any outstanding holds with their safety timers — a disabled overlay
    // has nothing left to hold up, and a surviving timer would fire against it.
    instance.holds.clear();
    for (const timer of instance.holdTimers.values()) clearTimeout(timer);
    instance.holdTimers.clear();

    // Hide if currently showing
    if (instance.state !== "idle") {
      instance.hide();
    }

    devLog("[MapLoadingOverlay] Disabled");
  }

  /**
   * Check if overlay is enabled
   */
  static isEnabled(): boolean {
    return MapLoadingOverlay.getInstance().enabled;
  }

  /** Whether the loading screen covers the game; false once it starts fading out. */
  static isShowing(): boolean {
    const state = MapLoadingOverlay.instance?.state ?? "idle";
    return state !== "idle" && state !== "fading";
  }

  // ==================== Event Handlers ====================

  private onLoadingStart(event: LoadingStartEvent): void {
    // If already showing (rapid map switches), reset instead of re-creating
    if (this.state !== "idle") {
      this.showTime = Date.now();
      this.failed = false;
      this.view?.restart(event);
      return;
    }

    this.show(event);
  }

  private onLoadingProgress(event: LoadingProgressEvent): void {
    if (this.state === "idle" || this.state === "fading") return;
    this.view?.progress(event);
  }

  private onLoadingComplete(event: LoadingCompleteEvent): void {
    if (this.state === "idle" || this.state === "fading") return;

    this.state = "completing";
    this.failed = !event.success;

    // The MAP is loaded, which is not the same as the GAME being ready to show.
    // Anything still holding keeps the curtain down — see `hold()`.
    this.view?.complete(event, [...this.holds]);
    if (this.holds.size > 0) return;

    this.scheduleFadeOut();
  }

  /**
   * Fade after the minimum display time, or after a brief hold if already past
   * it; a failure stays up long enough to read.
   */
  private scheduleFadeOut(): void {
    this.view?.ready();
    const elapsed = Date.now() - this.showTime;
    const remaining = this.config.minDisplayMs - elapsed;
    const delay = this.failed
      ? Math.max(remaining, this.config.failureHoldMs)
      : remaining > 0
        ? remaining
        : this.config.completeHoldMs;

    this.fadeTimer = setTimeout(() => {
      this.startFadeOut();
    }, delay);
  }

  // ==================== Holds ====================

  /**
   * Keep the loading screen up past `loading:complete`.
   *
   * The map finishing is not the moment the game is ready to be looked at. The
   * FPS client still has to decode its audio banks, build the collision world,
   * extract trigger volumes and warm its viewmodel — seconds of work that used
   * to happen with the curtain already up, so the player watched the world
   * assemble itself.
   *
   * Every hold MUST be released from a `finally`. A hold that leaks would strand
   * someone on a loading screen forever, which is worse than the flicker this
   * exists to fix — so a leaked hold is also force-released after
   * `holdTimeoutMs` rather than trusted.
   */
  static hold(name: string): void {
    MapLoadingOverlay.getInstance().addHold(name);
  }

  static release(name: string): void {
    MapLoadingOverlay.getInstance().removeHold(name);
  }

  private addHold(name: string): void {
    this.holds.add(name);
    const existing = this.holdTimers.get(name);
    if (existing) clearTimeout(existing);
    this.holdTimers.set(
      name,
      setTimeout(() => {
        console.warn(`[MapLoadingOverlay] hold "${name}" was never released — forcing it after timeout`);
        this.removeHold(name);
      }, this.config.holdTimeoutMs),
    );
  }

  private removeHold(name: string): void {
    if (!this.holds.delete(name)) return;
    const timer = this.holdTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.holdTimers.delete(name);
    }
    // The map may have completed while this was still held; that completion was
    // parked rather than dropped, so run it now the last holder is done.
    if (this.holds.size === 0 && this.state === "completing" && this.fadeTimer === null) {
      this.scheduleFadeOut();
    }
  }

  // ==================== UI Methods ====================

  private show(event: LoadingStartEvent): void {
    this.state = "showing";
    this.showTime = Date.now();
    this.failed = false;

    // Create container
    this.container = document.createElement("div");
    this.container.className = "ui-map-loading-overlay";

    this.view = this.config.view ? this.config.view() : new EngineLoadingView(this.config);
    this.view.mount(this.container, event);

    // Add to DOM with fade-in
    document.body.appendChild(this.container);

    // Transition to loading state after fade-in. The frame can come late (a
    // backgrounded tab runs none) and the load may have completed by then, so
    // only a screen that is still showing moves on.
    requestAnimationFrame(() => {
      this.container?.classList.add("ui-map-loading-overlay--visible");
      if (this.state === "showing") this.state = "loading";
    });
  }

  private startFadeOut(): void {
    if (this.state === "fading" || this.state === "idle") return;

    this.state = "fading";
    this.container?.classList.add("ui-map-loading-overlay--fading");

    // Remove after animation; the world is then on screen.
    setTimeout(() => {
      this.hide();
      EventBus.emit(LOADING_EVENTS.HIDDEN);
    }, this.config.fadeDurationMs);
  }

  private hide(): void {
    // Clear timer
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    this.view?.destroy();
    this.view = null;

    // Remove from DOM
    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    this.state = "idle";
  }

  /**
   * Inject CSS styles for the overlay
   */
  private injectStyles(): void {
    const css = `
/* ==================== Map Loading Overlay ==================== */
.ui-map-loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--map-loading-bg, #000000);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 999;
  opacity: 0;
  transition: opacity var(--map-loading-fade-in-duration, 200ms) ease-out;
}

.ui-map-loading-overlay--visible,
.ui-map-loading-overlay--instant {
  opacity: 1;
}

/* A view taking over from a screen already up appears in place */
.ui-map-loading-overlay--instant {
  transition: none;
}

.ui-map-loading-overlay--fading {
  opacity: 0;
  transition: opacity var(--map-loading-fade-out-duration, 500ms) ease-out;
}

.ui-map-loading-overlay__logo {
  width: var(--map-loading-logo-size, 200px);
  height: auto;
  margin-bottom: var(--map-loading-logo-margin, 32px);
  z-index: 2;
}

.ui-map-loading-overlay__messages {
  position: absolute;
  bottom: 16px;
  left: 16px;
  font-family: var(--map-loading-font, 'Share Tech Mono', 'Consolas', monospace);
  font-size: var(--map-loading-text-size, 11px);
  color: var(--map-loading-text-color, rgba(255, 255, 255, 0.4));
  text-transform: lowercase;
  z-index: 2;
}

.ui-map-loading-overlay__message {
  margin-bottom: var(--map-loading-message-gap, 4px);
}

.ui-map-loading-overlay__branding {
  position: absolute;
  bottom: 16px;
  right: 16px;
  text-align: right;
  font-family: var(--map-loading-font, 'Share Tech Mono', 'Consolas', monospace);
  font-size: var(--map-loading-branding-size, 11px);
  color: var(--map-loading-branding-color, rgba(255, 255, 255, 0.3));
  z-index: 2;
}

.ui-map-loading-overlay__branding-name {
  font-weight: 600;
  font-size: 12px;
}

.ui-map-loading-overlay__branding-version {
  font-size: 10px;
  margin-top: 2px;
}
`;

    UIStyles.injectCSS("map-loading-overlay", css);
  }

  /**
   * Dispose the overlay system
   */
  dispose(): void {
    MapLoadingOverlay.disable();
    this.hide();
  }
}

/**
 * The engine's own loading screen: smoke, the logo, the loader's messages in
 * console style and the engine's name and version.
 */
class EngineLoadingView implements MapLoadingView {
  private messageArea: HTMLDivElement | null = null;
  private messages: string[] = [];
  private smokeAnimation: LoadingAnimation | null = null;

  constructor(private readonly config: MapLoadingOverlayConfig) {}

  mount(container: HTMLElement, map: LoadingStartEvent): void {
    // Smoke animation
    if (this.config.animationEnabled) {
      this.smokeAnimation = new LoadingAnimation();
      this.smokeAnimation.create(container, {
        colors: this.config.animationColors ?? SHAG_PALETTE,
        puffCount: 30,
      });
    }

    // Logo
    if (this.config.showLogo) {
      const logo = document.createElement("img");
      logo.src = this.config.logoUrl ?? "engine.png";
      logo.alt = "Loading";
      logo.className = "ui-map-loading-overlay__logo";
      container.appendChild(logo);
    }

    // Message area
    if (this.config.showMessages) {
      this.messageArea = document.createElement("div");
      this.messageArea.className = "ui-map-loading-overlay__messages";
      container.appendChild(this.messageArea);
    }

    // Branding
    if (this.config.showBranding) {
      const branding = document.createElement("div");
      branding.className = "ui-map-loading-overlay__branding";
      branding.innerHTML = `
        <div class="ui-map-loading-overlay__branding-name">${EngineVersion.getInstance().getEngineName()}</div>
        <div class="ui-map-loading-overlay__branding-version">${EngineVersion.getInstance().getVersionString()}</div>
      `;
      container.appendChild(branding);
    }

    this.restart(map);
  }

  restart(map: LoadingStartEvent): void {
    this.messages = [];
    this.addMessage(`loading ${map.meta?.displayName || map.id}...`);
  }

  progress(event: LoadingProgressEvent): void {
    const message = event.detail ? `${event.phase}: ${event.detail}` : event.phase;
    this.addMessage(message.toLowerCase());
  }

  complete(event: LoadingCompleteEvent, waitingFor: string[]): void {
    if (event.success) {
      this.addMessage(`complete (${event.duration}ms)`);
    } else {
      this.addMessage(`error: ${event.error || "unknown error"}`);
    }
    if (waitingFor.length > 0) this.addMessage(`waiting for ${waitingFor.join(", ")}`);
  }

  ready(): void {}

  destroy(): void {
    this.smokeAnimation?.destroy();
    this.smokeAnimation = null;
    this.messageArea = null;
    this.messages = [];
  }

  private addMessage(message: string): void {
    this.messages.push(message);

    // Trim to max count
    while (this.messages.length > this.config.messageCount) {
      this.messages.shift();
    }

    // Update UI
    if (this.messageArea) {
      this.messageArea.innerHTML = this.messages
        .map((m) => `<div class="ui-map-loading-overlay__message">${m}</div>`)
        .join("");
    }
  }
}
