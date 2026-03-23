/**
 * DamageOverlay — Fullscreen Canvas2D directional damage feedback
 *
 * When the local player takes damage, renders:
 *   1. Red vignette gradient on screen edges, weighted toward damage direction
 *   2. Randomly rotated semi-transparent red triangles scattered along borders,
 *      biased toward the damage source (~60% on that edge)
 *
 * Self-animating via requestAnimationFrame — no external update() caller needed.
 *
 * Usage:
 *   DamageOverlay.getInstance().show(damage, angleRad)
 */

// ============================================================================
// Constants
// ============================================================================

const FLASH_DURATION_MIN = 0.35;    // seconds for low damage flash
const FLASH_DURATION_MAX = 1.4;     // seconds for high damage flash
const VIGNETTE_MAX_ALPHA = 0.7;     // max opacity of the red vignette
const TRIANGLE_COUNT_MIN = 28;      // min triangles per hit
const TRIANGLE_COUNT_MAX = 60;      // max triangles per hit (high damage)
const TRIANGLE_SIZE_MIN = 12;       // px — small scattered shards
const TRIANGLE_SIZE_MAX = 50;       // px — big bloody chunks
const BIG_TRIANGLE_SIZE = 70;       // px — extra-large blood splashes on high hits
const BIG_TRIANGLE_CHANCE = 0.15;   // 15% chance per triangle to be oversized
const TRIANGLE_ALPHA_MIN = 0.35;
const TRIANGLE_ALPHA_MAX = 0.95;
const BORDER_DEPTH = 0.28;          // how far triangles extend from edge (fraction of screen)
const MAX_ACTIVE_FLASHES = 6;       // cap simultaneous damage events
const HIGH_DAMAGE = 50;             // damage ≥ this gets max effect

// ============================================================================
// Data types
// ============================================================================

interface Triangle {
    edge: number;       // 0=top, 1=right, 2=bottom, 3=left
    edgePos: number;    // normalized position along edge (0-1)
    depthPos: number;   // normalized depth into border (0-1)
    rotation: number;   // radians
    size: number;       // px
    alpha: number;      // base alpha (0-1)
    redChannel: number; // 180-240
}

interface DamageFlash {
    angle: number;       // radians, where damage came from
    intensity: number;   // 0-1
    timeLeft: number;    // countdown (seconds)
    duration: number;    // total duration for this flash
    triangles: Triangle[];
}

// ============================================================================
// DamageOverlay Singleton
// ============================================================================

export class DamageOverlay {
    private static instance: DamageOverlay | null = null;

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private flashes: DamageFlash[] = [];
    private _rafId: number = 0;
    private _lastTime: number = 0;
    private _animating = false;

    static getInstance(): DamageOverlay {
        if (!DamageOverlay.instance) {
            DamageOverlay.instance = new DamageOverlay();
        }
        return DamageOverlay.instance;
    }

    private constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'damage-overlay';
        Object.assign(this.canvas.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '900',
        });
        this.ctx = this.canvas.getContext('2d')!;
        document.body.appendChild(this.canvas);
    }

    // ========================================================================
    // API
    // ========================================================================

    /**
     * Show damage from a direction.
     * @param damage - Amount of damage taken (scales intensity + duration)
     * @param angleRad - Direction in screen-space radians (0=right, PI/2=bottom)
     */
    show(damage: number, angleRad: number): void {
        const intensity = Math.min(damage / HIGH_DAMAGE, 1.0);

        // Duration scales with damage: small hits fade fast, big hits linger
        const duration = FLASH_DURATION_MIN + (FLASH_DURATION_MAX - FLASH_DURATION_MIN) * intensity;

        const count = Math.round(
            TRIANGLE_COUNT_MIN + (TRIANGLE_COUNT_MAX - TRIANGLE_COUNT_MIN) * intensity
        );
        const triangles = this.generateTriangles(count, angleRad, intensity);

        if (this.flashes.length >= MAX_ACTIVE_FLASHES) {
            this.flashes.shift();
        }

        this.flashes.push({
            angle: angleRad,
            intensity,
            timeLeft: duration,
            duration,
            triangles,
        });

        // Start self-animation loop if not already running
        if (!this._animating) {
            this._lastTime = performance.now();
            this._animating = true;
            this._rafId = requestAnimationFrame(this._tick);
        }
    }

    /**
     * External update (optional — overlay is self-animating, but Game.ts can
     * also call this for frame-perfect sync). No-op if nothing active.
     */
    update(_dt: number): void {
        // Self-animating now handles everything via rAF.
        // This method exists for compatibility but is intentionally empty.
    }

    destroy(): void {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._animating = false;
        this.canvas.remove();
        this.flashes = [];
        DamageOverlay.instance = null;
    }

    // ========================================================================
    // Self-Animation Loop
    // ========================================================================

    private _tick = (now: number): void => {
        const dt = Math.min((now - this._lastTime) / 1000, 0.1); // cap at 100ms
        this._lastTime = now;

        // Resize canvas to match screen
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
            this.canvas.width = w * dpr;
            this.canvas.height = h * dpr;
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // Decay flashes
        for (const flash of this.flashes) {
            flash.timeLeft -= dt;
        }
        this.flashes = this.flashes.filter(f => f.timeLeft > 0);

        // Stop animation loop when no flashes remain
        if (this.flashes.length === 0) {
            this.ctx.clearRect(0, 0, w, h);
            this._animating = false;
            return;
        }

        // Clear and redraw
        this.ctx.clearRect(0, 0, w, h);

        for (const flash of this.flashes) {
            const progress = 1.0 - flash.timeLeft / flash.duration;
            // EaseOut curve: starts at 1.0, decays to 0.0
            const fade = 1.0 - progress * progress;

            this.drawVignette(w, h, flash, fade);
            this.drawTriangles(w, h, flash, fade);
        }

        // Continue loop
        this._rafId = requestAnimationFrame(this._tick);
    };

    // ========================================================================
    // Triangle Generation
    // ========================================================================

    private generateTriangles(count: number, angleRad: number, intensity: number): Triangle[] {
        const triangles: Triangle[] = [];
        const edgeWeights = this.getEdgeWeights(angleRad);

        for (let i = 0; i < count; i++) {
            const edge = this.pickWeightedEdge(edgeWeights);

            // High-damage hits spawn some oversized "blood splash" triangles
            const isBig = intensity > 0.5 && Math.random() < BIG_TRIANGLE_CHANCE;
            const size = isBig
                ? BIG_TRIANGLE_SIZE * (0.7 + Math.random() * 0.3)
                : TRIANGLE_SIZE_MIN + Math.random() * (TRIANGLE_SIZE_MAX - TRIANGLE_SIZE_MIN);

            triangles.push({
                edge,
                edgePos: Math.random(),
                depthPos: Math.random(),
                rotation: Math.random() * Math.PI * 2,
                size,
                alpha: TRIANGLE_ALPHA_MIN + Math.random() * (TRIANGLE_ALPHA_MAX - TRIANGLE_ALPHA_MIN) * intensity,
                redChannel: 140 + Math.floor(Math.random() * 80),  // darker reds for bloodier look
            });
        }

        return triangles;
    }

    private getEdgeWeights(angleRad: number): [number, number, number, number] {
        const dx = Math.cos(angleRad);
        const dy = Math.sin(angleRad);
        const base = 0.08;
        const right = base + Math.max(0, dx) * 0.5;
        const left = base + Math.max(0, -dx) * 0.5;
        const bottom = base + Math.max(0, dy) * 0.5;
        const top = base + Math.max(0, -dy) * 0.5;
        const total = top + right + bottom + left;
        return [top / total, right / total, bottom / total, left / total];
    }

    private pickWeightedEdge(weights: [number, number, number, number]): number {
        const r = Math.random();
        let cumulative = 0;
        for (let i = 0; i < 4; i++) {
            cumulative += weights[i];
            if (r <= cumulative) return i;
        }
        return 3;
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    private drawVignette(w: number, h: number, flash: DamageFlash, fade: number): void {
        const ctx = this.ctx;
        const alpha = VIGNETTE_MAX_ALPHA * flash.intensity * fade;

        const cx = w / 2;
        const cy = h / 2;
        const innerRadius = Math.min(w, h) * 0.3;
        const outerRadius = Math.max(w, h) * 0.75;

        const grad = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
        grad.addColorStop(0, `rgba(180, 0, 0, 0)`);
        grad.addColorStop(0.5, `rgba(160, 0, 0, ${alpha * 0.3})`);
        grad.addColorStop(1, `rgba(140, 0, 0, ${alpha})`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Directional bloom on damage-facing edge
        const dx = Math.cos(flash.angle);
        const dy = Math.sin(flash.angle);
        const bloomX = cx + dx * w * 0.4;
        const bloomY = cy + dy * h * 0.4;
        const bloomRadius = Math.max(w, h) * 0.5;

        const bloomGrad = ctx.createRadialGradient(bloomX, bloomY, 0, bloomX, bloomY, bloomRadius);
        bloomGrad.addColorStop(0, `rgba(200, 20, 20, ${alpha * 0.6})`);
        bloomGrad.addColorStop(0.4, `rgba(180, 10, 10, ${alpha * 0.2})`);
        bloomGrad.addColorStop(1, `rgba(140, 0, 0, 0)`);

        ctx.fillStyle = bloomGrad;
        ctx.fillRect(0, 0, w, h);
    }

    private drawTriangles(w: number, h: number, flash: DamageFlash, fade: number): void {
        const ctx = this.ctx;
        const borderW = w * BORDER_DEPTH;
        const borderH = h * BORDER_DEPTH;

        for (const tri of flash.triangles) {
            let x: number, y: number;

            switch (tri.edge) {
                case 0: // top
                    x = tri.edgePos * w;
                    y = tri.depthPos * borderH;
                    break;
                case 1: // right
                    x = w - tri.depthPos * borderW;
                    y = tri.edgePos * h;
                    break;
                case 2: // bottom
                    x = tri.edgePos * w;
                    y = h - tri.depthPos * borderH;
                    break;
                case 3: // left
                default:
                    x = tri.depthPos * borderW;
                    y = tri.edgePos * h;
                    break;
            }

            const alpha = tri.alpha * fade;
            const s = tri.size;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(tri.rotation);
            ctx.globalAlpha = alpha;

            ctx.beginPath();
            ctx.moveTo(0, -s * 0.6);
            ctx.lineTo(-s * 0.5, s * 0.4);
            ctx.lineTo(s * 0.5, s * 0.4);
            ctx.closePath();

            ctx.fillStyle = `rgb(${tri.redChannel}, 15, 20)`;
            ctx.fill();

            ctx.restore();
        }

        ctx.globalAlpha = 1.0;
    }
}
