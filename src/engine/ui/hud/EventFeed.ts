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
const FONT_BODY = "'Rajdhani', sans-serif";

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
    this.container.style.cssText = `
            position: fixed;
            top: 60px;
            left: 20px;
            width: 400px;
            pointer-events: none;
            z-index: 1040;
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: ${FONT_BODY};
            font-size: 16px;
        `;
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
    const weaponText = weaponId ? ` [${weaponId}]` : "";
    const html =
      `<span style="color:#00e5ff">${this.esc(killerName)}</span>` +
      `<span style="color:#aaa">${weaponText} fragged </span>` +
      `<span style="color:#ff5555">${this.esc(victimName)}</span>`;
    this.push(html);
  }

  /**
   * Add a streak/award message to the feed.
   */
  addAward(playerName: string, awardType: string, _value: number): void {
    const messages: Record<string, string> = {
      first_blood: `<span style="color:#ff2222">${this.esc(playerName)}</span> <span style="color:#ff6666">drew First Blood!</span>`,
      on_fire: `<span style="color:#ffaa00">${this.esc(playerName)}</span> <span style="color:#ffcc44">is On Fire! 🔥</span>`,
      raging: `<span style="color:#ff4400">${this.esc(playerName)}</span> <span style="color:#ff6633">is Raging!</span>`,
      unstoppable: `<span style="color:#ff0044">${this.esc(playerName)}</span> <span style="color:#ff3366">is Unstoppable! ⚡</span>`,
    };

    const html =
      messages[awardType] ||
      `<span style="color:#00ccff">${this.esc(playerName)}</span> <span style="color:#88ddff">earned ${this.esc(awardType)}!</span>`;
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

    // Create DOM element
    const el = document.createElement("div");
    el.innerHTML = html;
    el.style.cssText = `
            padding: 3px 8px;
            background: rgba(0, 0, 0, 0.5);
            border-left: 2px solid rgba(0, 229, 255, 0.4);
            border-radius: 2px;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
            opacity: 0;
            transform: translateX(-20px);
            transition: opacity 0.2s ease-out, transform 0.2s ease-out;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
    msg.element = el;
    this.container.appendChild(el);

    // Slide in (next frame for transition to trigger)
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(0)";
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
        // Fading out
        const fadeProgress = (age - MESSAGE_LIFETIME) / MESSAGE_FADE_TIME;
        if (msg.element) {
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
