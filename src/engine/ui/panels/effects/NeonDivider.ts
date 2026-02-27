/**
 * NeonDivider — Angled SVG line with gradient neon glow
 *
 * Creates an SVG element with a cyan-to-magenta gradient line,
 * used as the frame border between blur zones and the solid center.
 */

/**
 * Create a neon divider SVG for top or bottom of the panel.
 * 
 * Top: line angles slightly downward left-to-right
 * Bottom: mirrored (angles slightly upward left-to-right)
 */
export function createNeonDivider(position: 'top' | 'bottom'): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `game-panel__divider game-panel__divider--${position === 'top' ? 'top' : 'bot'}`;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 1920 20');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '20px';
    svg.style.overflow = 'visible';
    svg.style.position = 'absolute';

    if (position === 'top') {
        svg.style.top = '-8px';
    } else {
        svg.style.bottom = '-8px';
    }

    // Gradient definition
    const defs = document.createElementNS(svgNS, 'defs');
    const grad = document.createElementNS(svgNS, 'linearGradient');
    grad.id = `neon-divider-grad-${position}`;
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '0%');

    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', 'hsl(180, 100%, 50%)');
    stop1.setAttribute('stop-opacity', '0.8');

    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '50%');
    stop2.setAttribute('stop-color', 'hsl(320, 100%, 60%)');
    stop2.setAttribute('stop-opacity', '0.6');

    const stop3 = document.createElementNS(svgNS, 'stop');
    stop3.setAttribute('offset', '100%');
    stop3.setAttribute('stop-color', 'hsl(45, 100%, 55%)');
    stop3.setAttribute('stop-opacity', '0.5');

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    grad.appendChild(stop3);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // The angled line
    const line = document.createElementNS(svgNS, 'line');
    if (position === 'top') {
        // Slight downward angle: top-left to bottom-right
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '6');
        line.setAttribute('x2', '1920');
        line.setAttribute('y2', '14');
    } else {
        // Mirrored: bottom-left to top-right
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '14');
        line.setAttribute('x2', '1920');
        line.setAttribute('y2', '6');
    }
    line.setAttribute('stroke', `url(#${grad.id})`);
    line.setAttribute('stroke-width', '2');

    svg.appendChild(line);
    wrapper.appendChild(svg);

    return wrapper;
}
