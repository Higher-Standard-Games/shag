/**
 * ConnectingOverlay — Full-screen "GAME STARTING" overlay.
 *
 * Shown when all players are ready and the match server is starting.
 * Displays a connecting animation, then triggers the actual server connection.
 */
import { FPSGameManager } from '../../../games/fps/FPSGameManager';

// Import CSS
import './styles/ConnectingOverlay.css';

export class ConnectingOverlay {
    private el: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private serverEl: HTMLElement | null = null;
    private dotInterval: number | null = null;

    /**
     * Show the overlay and begin connecting to the given server URL.
     * The overlay stays visible until the map starts loading (lobby hides it),
     * or an error occurs.
     */
    async show(serverUrl: string = 'ws://localhost:7777'): Promise<void> {
        // Don't double-show
        if (this.el) return;

        this.el = this.build(serverUrl);

        // Wait for fonts (Orbitron) to load before showing overlay
        // to prevent flash of unstyled text (FOUT)
        await document.fonts.ready;

        document.body.appendChild(this.el);

        // Start animated dots
        this.startDots();

        // Small delay for dramatic effect, then connect
        await this.delay(1200);
        this.setStatus('CONNECTING');

        await this.delay(600);

        try {
            const gameManager = FPSGameManager.getInstance();

            // Check if already connected
            if (gameManager.isConnectedToServer()) {
                this.setStatus('ALREADY CONNECTED');
                await this.delay(1000);
                this.hide();
                return;
            }

            await gameManager.initializeNetwork(serverUrl, { autoJoin: true });
            this.setStatus('CONNECTED');

            // The lobby hide + overlay cleanup happens when EventBus fires 'loading:start'
            // which triggers the lobby to hide — we clean up ourselves after a moment
            await this.delay(1500);
            this.hide();
        } catch (error) {
            this.setStatus('CONNECTION FAILED');
            this.showError(String(error));

            // Auto-hide after showing error
            await this.delay(3000);
            this.hide();
        }
    }

    /**
     * Remove the overlay from DOM.
     */
    hide(): void {
        this.stopDots();
        if (this.el) {
            this.el.remove();
            this.el = null;
            this.statusEl = null;
            this.serverEl = null;
        }
    }

    /**
     * Build the overlay DOM.
     */
    private build(serverUrl: string): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'connecting-overlay';

        const content = document.createElement('div');
        content.className = 'connecting-overlay__content';

        // Decorative dots
        const deco = document.createElement('div');
        deco.className = 'connecting-overlay__deco';
        for (let i = 0; i < 5; i++) {
            deco.appendChild(document.createElement('span'));
        }

        // Title
        const title = document.createElement('div');
        title.className = 'connecting-overlay__title';
        title.textContent = 'GAME STARTING';

        // Status line
        const status = document.createElement('div');
        status.className = 'connecting-overlay__status';
        this.statusEl = status;
        status.textContent = 'PREPARING';

        // Dots span (animated)
        const dots = document.createElement('span');
        dots.className = 'connecting-overlay__dots';
        dots.id = 'co-dots';
        status.appendChild(dots);

        // Progress bar
        const bar = document.createElement('div');
        bar.className = 'connecting-overlay__bar';
        const barFill = document.createElement('div');
        barFill.className = 'connecting-overlay__bar-fill';
        bar.appendChild(barFill);

        // Server info
        const server = document.createElement('div');
        server.className = 'connecting-overlay__server';
        server.textContent = serverUrl;
        this.serverEl = server;

        // Second deco
        const deco2 = document.createElement('div');
        deco2.className = 'connecting-overlay__deco';
        for (let i = 0; i < 5; i++) {
            deco2.appendChild(document.createElement('span'));
        }

        content.appendChild(deco);
        content.appendChild(title);
        content.appendChild(status);
        content.appendChild(bar);
        content.appendChild(server);
        content.appendChild(deco2);

        overlay.appendChild(content);
        return overlay;
    }

    private setStatus(text: string): void {
        if (this.statusEl) {
            // Remove old dots span, set text, re-add dots
            const dots = this.statusEl.querySelector('.connecting-overlay__dots');
            this.statusEl.textContent = text;
            if (dots) this.statusEl.appendChild(dots);
        }
    }

    private showError(message: string): void {
        if (!this.el) return;
        const content = this.el.querySelector('.connecting-overlay__content');
        if (!content) return;

        const errorEl = document.createElement('div');
        errorEl.className = 'connecting-overlay__error';
        errorEl.textContent = message;
        content.appendChild(errorEl);
    }

    private startDots(): void {
        let count = 0;
        const dotsEl = document.getElementById('co-dots');
        if (!dotsEl) return;

        this.dotInterval = window.setInterval(() => {
            count = (count + 1) % 4;
            dotsEl.textContent = '.'.repeat(count);
        }, 500);
    }

    private stopDots(): void {
        if (this.dotInterval !== null) {
            clearInterval(this.dotInterval);
            this.dotInterval = null;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
