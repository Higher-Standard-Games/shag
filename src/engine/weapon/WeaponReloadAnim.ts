/**
 * WeaponReloadAnim — Reload pump animation state machine
 *
 * Multi-phase animation: tilt → pump-down → pump-up → return
 * Used by WeaponViewManager.
 */

export interface ReloadAnimOffsets {
    roll: number;
    pitch: number;
    xOffset: number;
    yOffset: number;
    zOffset: number;
}

export class WeaponReloadAnim {
    private active: boolean = false;
    private startTime: number = 0;
    private duration: number = 0;

    /** Start reload animation with given duration (seconds) */
    start(duration: number): void {
        this.active = true;
        this.startTime = performance.now() / 1000;
        this.duration = duration;
        console.log(`[WeaponReloadAnim] Starting reload animation (${duration.toFixed(2)}s)`);
    }

    /** Cancel reload animation */
    cancel(): void {
        if (this.active) {
            this.active = false;
            console.log(`[WeaponReloadAnim] Reload animation cancelled`);
        }
    }

    /** True if currently reloading */
    get isReloading(): boolean {
        return this.active;
    }

    /** Get reload progress (0-1) */
    get progress(): number {
        if (!this.active) return 0;
        const now = performance.now() / 1000;
        const elapsed = now - this.startTime;
        return Math.min(1.0, elapsed / this.duration);
    }

    /** Calculate animation offsets */
    getOffsets(): ReloadAnimOffsets {
        if (!this.active) {
            return { roll: 0, pitch: 0, xOffset: 0, yOffset: 0, zOffset: 0 };
        }

        const p = this.progress;

        // Check if reload is complete
        if (p >= 1.0) {
            this.active = false;
            return { roll: 0, pitch: 0, xOffset: 0, yOffset: 0, zOffset: 0 };
        }

        const MAX_ROLL = Math.PI / 4;   // 45 degrees
        const MAX_PITCH = Math.PI / 8;  // 22.5 degrees up
        const DIP_Y = -4;
        const SLIDE_DIST = -9;

        let roll = 0;
        let pitch = 0;
        let xOffset = 0;
        let yOffset = 0;
        let zOffset = 0;

        // 1. Snappy Tilt (0.0 to 0.25)
        let tilt = 0;
        if (p < 0.25) {
            const t = p / 0.25;
            tilt = 1 - Math.pow(1 - t, 3); // ease-out-cubic
        } else if (p > 0.75) {
            const t = (1.0 - p) / 0.25;
            tilt = t * t * (3 - 2 * t); // smooth step
        } else {
            tilt = 1.0;
        }

        roll = tilt * MAX_ROLL;
        pitch = tilt * MAX_PITCH;
        yOffset = tilt * DIP_Y;

        // 2. Pump Action (0.3 to 0.7)
        let pump = 0;
        if (p > 0.3 && p < 0.7) {
            if (p < 0.45) {
                // Slide Back (Ease Out)
                const t = (p - 0.3) / 0.15;
                pump = Math.sin(t * Math.PI / 2) * SLIDE_DIST;
            } else if (p < 0.55) {
                // Hold
                pump = SLIDE_DIST;
            } else {
                // Slam Forward (Linear + Bounce)
                const t = (p - 0.55) / 0.15;
                pump = (1 - t) * SLIDE_DIST;

                // Impact Jitter
                if (t < 0.3) {
                    const shake = (1 - t / 0.3) * 0.5;
                    xOffset += (Math.random() - 0.5) * shake;
                    yOffset += (Math.random() - 0.5) * shake;
                }
            }
        }

        // Apply pump
        yOffset += pump;
        xOffset += pump * -0.5;
        zOffset += pump * 0.2;

        return { roll, pitch, xOffset, yOffset, zOffset };
    }
}
