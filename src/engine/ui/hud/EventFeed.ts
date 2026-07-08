/**
 * EventFeed — Top-left scrolling text log for game-wide events
 *
 * Shows kill messages, award announcements, and custom gametype messages.
 * DOM-based for simpler text styling and automatic layout.
 *
 * Messages fade out after a configurable duration.
 * Oldest messages are removed when the feed exceeds the maximum count.
 */

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGES = 6; // max visible messages
const MESSAGE_LIFETIME = 6.0; // seconds before fade starts
const MESSAGE_FADE_TIME = 1.0; // seconds to fade out

// ============================================================================
// Message Types
// ============================================================================

export interface FeedMessage {
  html: string;
  timestamp: number; // performance.now() when added
  element: HTMLDivElement | null; // DOM element (created lazily)
}

// ============================================================================
// EventFeed Singleton
// ============================================================================

export class EventFeed {
  private static _instance: EventFeed | null = null;

  private container: HTMLDivElement;
  private messages: FeedMessage[] = [];
  private animating = false;

  private constructor() {
    this.container = document.createElement("div");
    this.container.id = "event-feed";
    // Styled by WashikiTheme.css (injected by FPSHud before gameplay events fire)
    this.container.className = "fps-event-feed";
    document.body.appendChild(this.container);
  }

  static getInstance(): EventFeed {
    if (!EventFeed._instance) {
      EventFeed._instance = new EventFeed();
    }
    return EventFeed._instance;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Add a kill message to the feed.
   */
  addKill(killerName: string, victimName: string, weaponId?: string): void {
    const weaponText = weaponId ? `<span class="fps-event-weapon">[${this.esc(weaponId)}]</span> ` : "";
    const html =
      `<span class="fps-event-killer">${this.esc(killerName)}</span> ` +
      `${weaponText}<span class="fps-event-action">fragged</span> ` +
      `<span class="fps-event-victim">${this.esc(victimName)}</span>`;
    this.push(html);
  }

  /**
   * Add a streak/award message to the feed.
   */
  addAward(playerName: string, awardType: string, _value: number): void {
    const messages: Record<string, string> = {
      first_blood: `<span class="fps-event-blood">${this.esc(playerName)}</span> <span class="fps-event-action">drew First Blood!</span>`,
      on_fire: `<span class="fps-event-gold">${this.esc(playerName)}</span> <span class="fps-event-action">is On Fire!</span>`,
      raging: `<span class="fps-event-blood">${this.esc(playerName)}</span> <span class="fps-event-action">is Raging!</span>`,
      unstoppable: `<span class="fps-event-magenta">${this.esc(playerName)}</span> <span class="fps-event-action">is Unstoppable!</span>`,
    };

    const html =
      messages[awardType] ||
      `<span class="fps-event-killer">${this.esc(playerName)}</span> <span class="fps-event-action">earned ${this.esc(awardType)}!</span>`;
    this.push(html);
  }

  /**
   * Add a custom text message to the feed.
   */
  addCustom(html: string): void {
    this.push(html);
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private push(html: string): void {
    const msg: FeedMessage = {
      html,
      timestamp: performance.now(),
      element: null,
    };

    // Create DOM element (styled by WashikiTheme.css)
    const el = document.createElement("div");
    el.innerHTML = html;
    el.className = "fps-event-entry";
    msg.element = el;
    this.container.appendChild(el);

    // Stamp in (next frame for transition to trigger)
    requestAnimationFrame(() => {
      el.classList.add("fps-event-entry--in");
    });

    this.messages.push(msg);

    // Trim old messages
    while (this.messages.length > MAX_MESSAGES) {
      const old = this.messages.shift();
      old?.element?.remove();
    }

    // Start cleanup timer if not running
    if (!this.animating) {
      this.animating = true;
      requestAnimationFrame((t) => this.animate(t));
    }
  }

  // ========================================================================
  // Animation (fade out old messages)
  // ========================================================================

  private animate(now: number): void {
    let anyActive = false;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const age = (now - msg.timestamp) / 1000;

      if (age > MESSAGE_LIFETIME + MESSAGE_FADE_TIME) {
        // Remove
        msg.element?.remove();
        this.messages.splice(i, 1);
      } else if (age > MESSAGE_LIFETIME) {
        // Fading out — disable the entry transition so per-frame opacity
        // writes apply immediately instead of lagging behind it
        const fadeProgress = (age - MESSAGE_LIFETIME) / MESSAGE_FADE_TIME;
        if (msg.element) {
          msg.element.style.transition = "none";
          msg.element.style.opacity = String(1 - fadeProgress);
        }
        anyActive = true;
      } else {
        anyActive = true;
      }
    }

    if (anyActive || this.messages.length > 0) {
      requestAnimationFrame((t) => this.animate(t));
    } else {
      this.animating = false;
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /** HTML-escape text to prevent injection */
  private esc(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.messages = [];
    this.animating = false;
    this.container.remove();
    EventFeed._instance = null;
  }
}
