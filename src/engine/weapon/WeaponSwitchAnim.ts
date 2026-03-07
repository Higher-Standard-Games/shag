/**
 * WeaponSwitchAnim — Weapon switch slide-down/swap/slide-up animation
 *
 * State machine: idle → down → load → up → idle
 * Used by WeaponViewManager.
 */

export interface SwitchAnimOffsets {
    yOffset: number;
    roll: number;
    xOffset: number;
    zOffset: number;
}

export class WeaponSwitchAnim {
    // Animation timing
    private static readonly DOWN_DURATION = 120;
    private static readonly UP_DURATION = 140;
    private static readonly Y_DROP = -45;
    private static readonly ROLL = Math.PI / 6;

    private phase: 'idle' | 'down' | 'load' | 'up' = 'idle';
    private startTime: number = 0;
    private pendingWeaponId: string | null = null;
    private pendingPk3Path?: string;

    /** Start or restart a weapon switch */
    start(weaponId: string, pk3Path?: string): boolean {
        // If already switching to the same weapon, ignore
        if (this.phase !== 'idle' && this.pendingWeaponId === weaponId) {
            return false;
        }
        this.phase = 'down';
        this.startTime = performance.now();
        this.pendingWeaponId = weaponId;
        this.pendingPk3Path = pk3Path;
        return true;
    }

    /**
     * Process state transitions each frame.
     * @param loadWeapon - callback to load the weapon when down phase completes
     */
    update(loadWeapon: (id: string, pk3?: string) => Promise<void>): void {
        if (this.phase === 'idle') return;

        const now = performance.now();
        const elapsed = now - this.startTime;

        if (this.phase === 'down') {
            if (elapsed >= WeaponSwitchAnim.DOWN_DURATION) {
                this.phase = 'load';
                this.startTime = now;

                if (this.pendingWeaponId) {
                    const pendingId = this.pendingWeaponId;
                    loadWeapon(pendingId, this.pendingPk3Path).then(() => {
                        if (this.pendingWeaponId === pendingId && this.phase === 'load') {
                            this.phase = 'up';
                            this.startTime = performance.now();
                        }
                    });
                }
            }
        } else if (this.phase === 'load') {
            // Max wait 200ms before slide-up anyway
            if (elapsed >= 200) {
                this.phase = 'up';
                this.startTime = now;
            }
        } else if (this.phase === 'up') {
            if (elapsed >= WeaponSwitchAnim.UP_DURATION) {
                this.phase = 'idle';
                this.pendingWeaponId = null;
            }
        }
    }

    /** Calculate visual offsets for current phase */
    getOffsets(): SwitchAnimOffsets {
        if (this.phase === 'idle') {
            return { yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 };
        }

        const elapsed = performance.now() - this.startTime;

        if (this.phase === 'down') {
            const t = Math.min(1.0, elapsed / WeaponSwitchAnim.DOWN_DURATION);
            const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
            return {
                yOffset: eased * WeaponSwitchAnim.Y_DROP,
                roll: eased * WeaponSwitchAnim.ROLL,
                xOffset: 0, zOffset: 0,
            };
        }

        if (this.phase === 'load') {
            return {
                yOffset: WeaponSwitchAnim.Y_DROP,
                roll: WeaponSwitchAnim.ROLL,
                xOffset: 0, zOffset: 0,
            };
        }

        if (this.phase === 'up') {
            const t = Math.min(1.0, elapsed / WeaponSwitchAnim.UP_DURATION);
            const eased = 1 - Math.pow(1 - t, 3);
            return {
                yOffset: WeaponSwitchAnim.Y_DROP * (1 - eased),
                roll: WeaponSwitchAnim.ROLL * (1 - eased),
                xOffset: 0, zOffset: 0,
            };
        }

        return { yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 };
    }

    /** True if a switch animation is in progress */
    get isSwitching(): boolean {
        return this.phase !== 'idle';
    }
}
