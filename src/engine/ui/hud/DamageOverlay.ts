/**
 * DamageOverlay — fullscreen directional damage feedback
 *
 * When the local player takes damage, a red vignette flashes and the screen
 * edge facing the damage source glows strongest. Each layer is a static CSS
 * gradient painted once; a hit only animates layer opacity, which the browser
 * runs on its compositor. Nothing is drawn per frame, so a hit costs no main
 * thread time while the flash fades.
 *
 * Usage:
 *   DamageOverlay.getInstance().show(damage, angleRad)
 */

const FLASH_DURATION_MIN = 0.35; // seconds for low damage flash
const FLASH_DURATION_MAX = 1.4; // seconds for high damage flash
const VIGNETTE_MAX_ALPHA = 0.7; // max opacity of the red vignette
const EDGE_MAX_ALPHA = 0.85; // max opacity of the edge facing the damage
const EDGE_MIN_INTENSITY = 0.3; // a graze still shows its direction
const EDGE_DEPTH = "28%"; // how far an edge glow reaches into the screen
const HIGH_DAMAGE = 50; // damage ≥ this gets max effect
// Opacity follows 1 - t², the ease-in quad
const FADE_EASING = "cubic-bezier(0.11, 0, 0.5, 0)";

interface Layer {
  el: HTMLDivElement;
  peak: number; // opacity at the start of the running fade
  start: number; // performance.now() when the fade started
  duration: number; // ms
  animation: Animation | null;
}

/** Edge glows in screen-space angle order: 0 = right, PI/2 = bottom. */
const EDGES: ReadonlyArray<{ angle: number; style: Partial<CSSStyleDeclaration> }> = [
  {
    angle: 0,
    style: { top: "0", bottom: "0", right: "0", width: EDGE_DEPTH, background: gradient("to left") },
  },
  {
    angle: Math.PI / 2,
    style: { left: "0", right: "0", bottom: "0", height: EDGE_DEPTH, background: gradient("to top") },
  },
  {
    angle: Math.PI,
    style: { top: "0", bottom: "0", left: "0", width: EDGE_DEPTH, background: gradient("to right") },
  },
  {
    angle: -Math.PI / 2,
    style: { left: "0", right: "0", top: "0", height: EDGE_DEPTH, background: gradient("to bottom") },
  },
];

function gradient(direction: string): string {
  return `linear-gradient(${direction}, rgba(170, 10, 15, 1), rgba(160, 0, 0, 0.35) 45%, rgba(140, 0, 0, 0))`;
}

export class DamageOverlay {
  private static instance: DamageOverlay | null = null;

  private root: HTMLDivElement;
  private vignette: Layer;
  private edges: Layer[];

  static getInstance(): DamageOverlay {
    if (!DamageOverlay.instance) {
      DamageOverlay.instance = new DamageOverlay();
    }
    return DamageOverlay.instance;
  }

  private constructor() {
    this.root = document.createElement("div");
    this.root.id = "damage-overlay";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "900",
      overflow: "hidden",
    });
    this.vignette = this.addLayer({
      inset: "0",
      background:
        "radial-gradient(ellipse at center, rgba(180, 0, 0, 0) 40%, rgba(160, 0, 0, 0.3) 70%, rgba(140, 0, 0, 1) 100%)",
    });
    this.edges = EDGES.map((edge) => this.addLayer(edge.style));
    document.body.appendChild(this.root);
  }

  private addLayer(style: Partial<CSSStyleDeclaration>): Layer {
    const el = document.createElement("div");
    // Opacity 0 and not animating: the browser leaves the layer out of the frame
    Object.assign(el.style, { position: "absolute", opacity: "0" }, style);
    this.root.appendChild(el);
    return { el, peak: 0, start: 0, duration: 0, animation: null };
  }

  /**
   * Show damage from a direction.
   * @param damage - Amount of damage taken (scales intensity + duration)
   * @param angleRad - Direction in screen-space radians (0=right, PI/2=bottom)
   */
  show(damage: number, angleRad: number): void {
    const intensity = Math.min(Math.max(damage, 0) / HIGH_DAMAGE, 1.0);
    // Small hits fade fast, big hits linger
    const duration = (FLASH_DURATION_MIN + (FLASH_DURATION_MAX - FLASH_DURATION_MIN) * intensity) * 1000;
    const now = performance.now();

    this.flash(this.vignette, VIGNETTE_MAX_ALPHA * intensity, duration, now);
    const edgeIntensity = EDGE_MIN_INTENSITY + (1 - EDGE_MIN_INTENSITY) * intensity;
    for (let i = 0; i < EDGES.length; i++) {
      // 1 on the edge facing the damage, falling to 0 at right angles to it
      const facing = Math.max(0, Math.cos(angleRad - EDGES[i].angle));
      this.flash(this.edges[i], EDGE_MAX_ALPHA * edgeIntensity * facing, duration, now);
    }
  }

  /** Add `alpha` to what the layer still shows and fade from there. */
  private flash(layer: Layer, alpha: number, duration: number, now: number): void {
    if (alpha <= 0.01) return;
    const remaining = Math.max(0, layer.start + layer.duration - now);
    const progress = layer.duration > 0 ? Math.min(1, (now - layer.start) / layer.duration) : 1;
    const current = layer.peak * (1 - progress * progress);

    layer.peak = Math.min(1, current + alpha);
    layer.start = now;
    layer.duration = Math.max(duration, remaining);
    layer.animation?.cancel();
    layer.animation =
      typeof layer.el.animate === "function"
        ? layer.el.animate([{ opacity: layer.peak }, { opacity: 0 }], {
            duration: layer.duration,
            easing: FADE_EASING,
          })
        : null;
  }

  destroy(): void {
    for (const layer of [this.vignette, ...this.edges]) layer.animation?.cancel();
    this.root.remove();
    DamageOverlay.instance = null;
  }
}
