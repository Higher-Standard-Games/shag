/**
 * FloatingParticles — CSS-only ambient particle system
 *
 * Spawns small colored shapes (dots, shards, sparkles) that float, drift,
 * and fade through the panel. All animation is pure CSS — zero JS per frame.
 *
 * Colors: cyan, magenta, gold (from Washiki palette)
 * Shapes: dot (circle), shard (tall rectangle), sparkle (rotated square)
 */

const COLORS = ['cyan', 'magenta', 'gold'] as const;
const SHAPES = ['dot', 'shard', 'sparkle'] as const;

export interface ParticleOptions {
    count?: number;
}

/**
 * Spawn floating particles into a container element.
 * Returns array of created elements for later cleanup.
 */
export function spawnParticles(container: HTMLElement, options: ParticleOptions = {}): HTMLElement[] {
    const count = options.count ?? 22;
    const particles: HTMLElement[] = [];

    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        const color = COLORS[i % COLORS.length];
        const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];

        el.className = `game-panel__particle game-panel__particle--${shape} game-panel__particle--${color}`;

        // Random size
        const size = shape === 'shard'
            ? Math.random() * 6 + 3    // shards: 3-9px
            : Math.random() * 4 + 2;    // dots/sparkles: 2-6px

        const height = shape === 'shard' ? size * 2.5 : size;

        // Random position across the full container
        const x = Math.random() * 100;
        const y = Math.random() * 100;

        // Random animation timing
        const duration = Math.random() * 8 + 6;         // 6-14s
        const delay = Math.random() * 6;                   // 0-6s stagger
        const fadeDuration = Math.random() * 6 + 5;  // 5-11s

        el.style.cssText = `
      left: ${x}%;
      top: ${y}%;
      width: ${size}px;
      height: ${height}px;
      animation-duration: ${duration}s, ${fadeDuration}s;
      animation-delay: ${delay}s, ${delay}s;
    `;

        // Shards get a random rotation
        if (shape === 'shard') {
            el.style.transform = `rotate(${Math.random() * 360}deg)`;
        }

        container.appendChild(el);
        particles.push(el);
    }

    return particles;
}

/**
 * Remove all particles from a container.
 */
export function clearParticles(particles: HTMLElement[]): void {
    for (const el of particles) {
        el.remove();
    }
    particles.length = 0;
}
