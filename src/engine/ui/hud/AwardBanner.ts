/**
 * AwardBanner — Center-screen personal award display
 *
 * Shows large text awards when the local player earns them.
 * DOM-based to match the game's WashikiTheme CSS variables.
 * Uses the same Orbitron display font as the warmup text.
 *
 * Awards fade in, hold, then fade out.
 * Multiple awards queue sequentially.
 */

// ============================================================================
// Constants
// ============================================================================

const AWARD_HOLD_TIME = 2000; // ms visible
const AWARD_FADE_IN = 150; // ms to fade in
const AWARD_FADE_OUT = 500; // ms to fade out

// ============================================================================
// Award styling per type
// ============================================================================

interface AwardStyle {
  text: (playerName: string, targetName: string) => string;
  color: string;
  glow: string;
}

const AWARD_STYLES: Record<string, AwardStyle> = {
  frag: {
    text: (_p, target) => `You fragged ${target}!`,
    color: "var(--w-gold, #e5ac00)",
    glow: "var(--w-glow-gold, 0 0 20px rgba(255,170,0,0.6))",
  },
  first_blood: {
    text: () => "FIRST BLOOD",
    color: "#ff2222",
    glow: "0 0 20px rgba(255, 0, 0, 0.6), 0 0 60px rgba(255, 0, 0, 0.3)",
  },
  on_fire: {
    text: () => "ON FIRE!",
    color: "#ffaa00",
    glow: "0 0 20px rgba(255,170,0,0.5), 0 0 60px rgba(255,170,0,0.3)",
  },
  raging: {
    text: () => "RAGING!",
    color: "#ff4400",
    glow: "0 0 20px rgba(255,68,0,0.6), 0 0 60px rgba(255,68,0,0.3)",
  },
  unstoppable: {
    text: () => "UNSTOPPABLE!",
    color: "#ff0044",
    glow: "0 0 20px rgba(255,0,68,0.7), 0 0 60px rgba(255,0,68,0.3)",
  },
};

const DEFAULT_STYLE: AwardStyle = {
  text: () => "",
  color: "#00ccff",
  glow: "0 0 20px rgba(0,204,255,0.4)",
};

// ============================================================================
// Queued Award Entry
// ============================================================================

interface QueuedAward {
  text: string;
  color: string;
  glow: string;
}

// ============================================================================
// AwardBanner Singleton
// ============================================================================

export class AwardBanner {
  private static _instance: AwardBanner | null = null;

  private container: HTMLDivElement;
  private textEl: HTMLDivElement;
  private queue: QueuedAward[] = [];
  private showing = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    // Container: positioned between crosshair and warmup text area
    this.container = document.createElement("div");
    this.container.id = "award-banner";
    this.container.style.cssText = `
            position: fixed;
            top: 35%;
            left: 50%;
            transform: translateX(-50%);
            pointer-events: none;
            z-index: 1050;
            text-align: center;
            opacity: 0;
            transition: opacity ${AWARD_FADE_IN}ms ease-out;
        `;

    this.textEl = document.createElement("div");
    this.textEl.style.cssText = `
            font-family: var(--w-font-display, 'Orbitron', monospace);
            font-size: calc(28px * var(--ui-scale, 1));
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            white-space: nowrap;
        `;

    this.container.appendChild(this.textEl);
    document.body.appendChild(this.container);
  }

  static getInstance(): AwardBanner {
    if (!AwardBanner._instance) {
      AwardBanner._instance = new AwardBanner();
    }
    return AwardBanner._instance;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  show(awardType: string, playerName: string, targetName: string, customText?: string): void {
    const style = AWARD_STYLES[awardType] || DEFAULT_STYLE;
    const text = customText || style.text(playerName, targetName);

    this.queue.push({ text, color: style.color, glow: style.glow });

    // Cap queue
    if (this.queue.length > 5) {
      this.queue.shift();
    }

    if (!this.showing) {
      this.showNext();
    }
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private showNext(): void {
    if (this.queue.length === 0) {
      this.showing = false;
      return;
    }

    this.showing = true;
    const award = this.queue.shift()!;

    // Apply style
    this.textEl.textContent = award.text;
    this.textEl.style.color = award.color;
    this.textEl.style.textShadow = award.glow;

    // Fade in
    this.container.style.opacity = "1";

    // Schedule fade out
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.container.style.transition = `opacity ${AWARD_FADE_OUT}ms ease-in`;
      this.container.style.opacity = "0";

      // After fade-out, show next or stop
      setTimeout(() => {
        this.container.style.transition = `opacity ${AWARD_FADE_IN}ms ease-out`;
        this.showNext();
      }, AWARD_FADE_OUT);
    }, AWARD_HOLD_TIME);
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.queue = [];
    this.showing = false;
    this.container.remove();
    AwardBanner._instance = null;
  }
}
