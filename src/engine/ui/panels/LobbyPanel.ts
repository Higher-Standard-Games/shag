/**
 * LobbyPanel — Main Lobby UI
 *
 * Full-viewport lobby screen shown on startup. Features:
 * - Game mode cards (DUEL 1v1, TEAM 2v2, FFA) with map backgrounds
 * - Social sidebar (players, live matches, chat)
 * - Settings button
 * - Queue state management (mock for Phase 1)
 *
 * Uses the Washiki neon color system (cyan/magenta/gold) from GamePanel.
 */

import { UIStyles } from '../UIStyles';
import lobbyCSSRaw from './styles/LobbyPanel.css?raw';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface GameMode {
    id: string;
    title: string;
    subtitle: string;
    icon: string;
    color: string;       // HSL hue for accent
    glowColor: string;   // Full HSLA for glow effects
    borderColor: string;  // Full HSLA for borders
    gradient: string;     // Bottom gradient for card overlay
}

interface MockPlayer {
    name: string;
    status: 'online' | 'searching' | 'ingame';
    mode?: string;
}

interface MockMatch {
    type: string;
    player1: string;
    player2: string;
    map: string;
    score: string;
    time: string;
}

// ═══════════════════════════════════════════════════════════════════
// GAME MODE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

const GAME_MODES: GameMode[] = [
    {
        id: 'duel',
        title: 'DUEL',
        subtitle: '1 vs 1',
        icon: '⚔️',
        color: '180',
        glowColor: 'hsla(180, 100%, 50%, 0.4)',
        borderColor: 'hsla(180, 100%, 50%, 0.35)',
        gradient: `linear-gradient(
            to top,
            hsla(185, 80%, 8%, 0.97) 0%,
            hsla(185, 60%, 10%, 0.7) 25%,
            hsla(185, 40%, 8%, 0.3) 55%,
            transparent 100%
        )`,
    },
    {
        id: 'team',
        title: 'TEAM',
        subtitle: '2 vs 2',
        icon: '🛡️',
        color: '320',
        glowColor: 'hsla(320, 100%, 60%, 0.35)',
        borderColor: 'hsla(320, 100%, 55%, 0.35)',
        gradient: `linear-gradient(
            to top,
            hsla(320, 60%, 8%, 0.97) 0%,
            hsla(320, 40%, 10%, 0.7) 25%,
            hsla(320, 30%, 8%, 0.3) 55%,
            transparent 100%
        )`,
    },
    {
        id: 'ffa',
        title: 'FFA',
        subtitle: 'FREE FOR ALL',
        icon: '💥',
        color: '45',
        glowColor: 'hsla(45, 100%, 55%, 0.35)',
        borderColor: 'hsla(45, 100%, 50%, 0.35)',
        gradient: `linear-gradient(
            to top,
            hsla(40, 60%, 6%, 0.97) 0%,
            hsla(40, 40%, 8%, 0.7) 25%,
            hsla(40, 30%, 6%, 0.3) 55%,
            transparent 100%
        )`,
    },
];

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA (Phase 1 — no backend)
// ═══════════════════════════════════════════════════════════════════

const MOCK_PLAYERS: MockPlayer[] = [
    { name: 'zeroQL', status: 'searching', mode: 'DUEL' },
    { name: 'washoi_dev', status: 'online' },
    { name: 'rocketJump99', status: 'ingame' },
    { name: 'fragmaster', status: 'searching', mode: 'FFA' },
    { name: 'neon_ghost', status: 'online' },
    { name: 'plasma_rush', status: 'ingame' },
    { name: 'strafejmp', status: 'online' },
];

const MOCK_MATCHES: MockMatch[] = [
    { type: 'DUEL', player1: 'rocketJump99', player2: 'speedrunner', map: 'wdm7', score: '5 – 3', time: '2:41' },
    { type: '2v2', player1: 'Team Alpha', player2: 'Team Bravo', map: 'wdm2', score: '12 – 8', time: '1:12' },
];

const MOCK_CHAT = [
    { name: 'zeroQL', msg: 'anyone up for a duel?' },
    { name: 'washoi_dev', msg: 'gg last game, that rocket was insane' },
    { name: 'fragmaster', msg: 'queueing FFA, join up!' },
    { name: '', msg: 'plasma_rush joined the lobby', system: true },
    { name: 'neon_ghost', msg: 'new map when? 🗺️' },
];

// ═══════════════════════════════════════════════════════════════════
// LOBBY PANEL CLASS
// ═══════════════════════════════════════════════════════════════════

export class LobbyPanel {
    private root: HTMLElement | null = null;
    private queueState: Map<string, boolean> = new Map();
    private queueTimers: Map<string, number> = new Map();
    private queueIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private onSettingsClick: (() => void) | null = null;
    private onPlayClick: ((mode: string) => void) | null = null;

    constructor() {
        // Inject CSS once
        UIStyles.injectCSS('lobby-panel', lobbyCSSRaw);
    }

    /**
     * Show the lobby UI
     */
    show(): void {
        if (this.root) return;

        this.root = document.createElement('div');
        this.root.className = 'lobby';
        this.root.id = 'lobby-panel';

        this.root.innerHTML = `
            ${this.buildTopBar()}
            <div class="lobby__body">
                ${this.buildParticles()}
                <div class="lobby__scan"></div>
                ${this.buildModeCards()}
                ${this.buildSidebar()}
            </div>
            ${this.buildBottomBar()}
        `;

        document.body.appendChild(this.root);
        this.attachEventListeners();

        console.log('[Lobby] Shown');
    }

    /**
     * Hide the lobby with fade-out animation
     */
    hide(): void {
        if (!this.root) return;

        // Clear all queue intervals
        this.queueIntervals.forEach(interval => clearInterval(interval));
        this.queueIntervals.clear();

        this.root.classList.add('lobby--closing');
        this.root.addEventListener('animationend', () => {
            this.root?.remove();
            this.root = null;
        }, { once: true });

        console.log('[Lobby] Hidden');
    }

    /**
     * Check if lobby is visible
     */
    isVisible(): boolean {
        return this.root !== null;
    }

    /**
     * Register settings button callback
     */
    setOnSettings(callback: () => void): void {
        this.onSettingsClick = callback;
    }

    /**
     * Register play/queue callback (receives mode ID)
     */
    setOnPlay(callback: (mode: string) => void): void {
        this.onPlayClick = callback;
    }

    // ═══════════════════════════════════════════════════════════════════
    // BUILD METHODS
    // ═══════════════════════════════════════════════════════════════════

    private buildTopBar(): string {
        return `
            <div class="lobby__topbar">
                <div class="lobby__logo">
                    SHAG
                    <span class="lobby__logo-sub">ARENA FPS</span>
                </div>
                <div class="lobby__topbar-right">
                    <span class="lobby__version">v0.9.8</span>
                    <button class="lobby__settings-btn" id="lobby-settings-btn">
                        ⚙ SETTINGS
                    </button>
                </div>
            </div>
        `;
    }

    private buildModeCards(): string {
        const cards = GAME_MODES.map(mode => `
            <div class="lobby__mode-card" data-mode="${mode.id}" style="
                --card-hue: ${mode.color};
                --card-glow: ${mode.glowColor};
            ">
                <div class="lobby__mode-bg" style="
                    background-image: url('/placeholder-${mode.id}.jpg');
                    background-color: hsl(${mode.color}, 25%, 8%);
                "></div>
                <div class="lobby__mode-overlay" style="background: ${mode.gradient}"></div>
                <div class="lobby__mode-content">
                    <div class="lobby__mode-icon">${mode.icon}</div>
                    <div class="lobby__mode-title" style="
                        color: hsl(${mode.color}, 100%, 80%);
                        text-shadow: 0 0 20px ${mode.glowColor}, 0 0 40px hsla(${mode.color}, 100%, 50%, 0.15);
                    ">${mode.title}</div>
                    <div class="lobby__mode-subtitle">${mode.subtitle}</div>
                    <div class="lobby__mode-queue-count">${Math.floor(Math.random() * 5)} IN QUEUE</div>
                    <button class="lobby__find-btn" id="lobby-find-${mode.id}" style="
                        border-color: hsla(${mode.color}, 100%, 50%, 0.3);
                        color: hsl(${mode.color}, 100%, 65%);
                        background: hsla(${mode.color}, 100%, 50%, 0.06);
                    ">
                        FIND MATCH
                    </button>
                </div>
            </div>
        `).join('');

        return `<div class="lobby__modes">${cards}</div>`;
    }

    private buildSidebar(): string {
        const players = MOCK_PLAYERS.map(p => `
            <div class="lobby__player">
                <div class="lobby__player-dot lobby__player-dot--${p.status}"></div>
                <span class="lobby__player-name">${p.name}</span>
                ${p.status === 'searching'
                ? `<span class="lobby__player-status">🔍 ${p.mode}</span>`
                : p.status === 'ingame'
                    ? `<span class="lobby__player-status">🎮 IN MATCH</span>`
                    : ''
            }
            </div>
        `).join('');

        const matches = MOCK_MATCHES.map(m => `
            <div class="lobby__match">
                <div class="lobby__match-header">
                    <span class="lobby__match-type">🔴 ${m.type}</span>
                    <span class="lobby__match-time">${m.time}</span>
                </div>
                <div class="lobby__match-players">${m.player1} vs ${m.player2}</div>
                <div class="lobby__match-footer">
                    <span class="lobby__match-map">${m.map}</span>
                    <span class="lobby__match-score">${m.score}</span>
                    <button class="lobby__watch-btn">WATCH</button>
                </div>
            </div>
        `).join('');

        const chatMsgs = MOCK_CHAT.map(c =>
            c.system
                ? `<div class="lobby__chat-msg lobby__chat-msg--system">${c.msg}</div>`
                : `<div class="lobby__chat-msg"><span class="lobby__chat-msg-name">${c.name}</span>${c.msg}</div>`
        ).join('');

        return `
            <div class="lobby__sidebar">
                <div class="lobby__section-title">PLAYERS ONLINE</div>
                <div class="lobby__players">${players}</div>

                <div class="lobby__section-title">LIVE MATCHES</div>
                <div class="lobby__matches">${matches}</div>

                <div class="lobby__chat">
                    <div class="lobby__section-title">CHAT</div>
                    <div class="lobby__chat-messages">${chatMsgs}</div>
                    <div class="lobby__chat-input-wrap">
                        <input type="text" class="lobby__chat-input" placeholder="Type a message..." spellcheck="false" autocomplete="off" />
                    </div>
                </div>
            </div>
        `;
    }

    private buildBottomBar(): string {
        return `
            <div class="lobby__bottombar">
                <div class="lobby__status-left">
                    <span class="lobby__status-dot">CONNECTED</span>
                    <span>${MOCK_PLAYERS.length} ONLINE</span>
                </div>
                <span>SHAG ENGINE v0.9.8 · WASHOI.NET</span>
            </div>
        `;
    }

    private buildParticles(): string {
        const particles: string[] = [];
        const colors = [
            'hsla(180, 100%, 50%, 0.4)',   // cyan
            'hsla(320, 100%, 60%, 0.35)',   // magenta
            'hsla(45, 100%, 55%, 0.35)',    // gold
        ];

        for (let i = 0; i < 20; i++) {
            const color = colors[i % 3];
            const size = 1 + Math.random() * 3;
            const left = Math.random() * 100;
            const top = Math.random() * 100;
            const duration = 6 + Math.random() * 10;
            const delay = Math.random() * 8;

            particles.push(`
                <div class="lobby__particle" style="
                    width: ${size}px;
                    height: ${size}px;
                    background: ${color};
                    box-shadow: 0 0 ${size * 2}px ${color};
                    left: ${left}%;
                    top: ${top}%;
                    animation-duration: ${duration}s, ${duration * 0.8}s;
                    animation-delay: ${delay}s, ${delay}s;
                "></div>
            `);
        }

        return `<div class="lobby__particles">${particles.join('')}</div>`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // EVENT HANDLING
    // ═══════════════════════════════════════════════════════════════════

    private attachEventListeners(): void {
        if (!this.root) return;

        // Settings button
        const settingsBtn = this.root.querySelector('#lobby-settings-btn');
        settingsBtn?.addEventListener('click', () => {
            this.onSettingsClick?.();
        });

        // Find Match buttons
        GAME_MODES.forEach(mode => {
            const btn = this.root?.querySelector(`#lobby-find-${mode.id}`) as HTMLButtonElement | null;
            btn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleQueue(mode.id, btn, mode);
            });

            // Card click = same as find match
            const card = this.root?.querySelector(`[data-mode="${mode.id}"]`);
            card?.addEventListener('click', () => {
                if (btn) this.toggleQueue(mode.id, btn, mode);
            });
        });

        // Chat input — prevent game controls when typing
        const chatInput = this.root.querySelector('.lobby__chat-input') as HTMLInputElement | null;
        chatInput?.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && chatInput.value.trim()) {
                console.log(`[Lobby] Chat: "${chatInput.value}"`);
                chatInput.value = '';
            }
        });
    }

    private toggleQueue(modeId: string, btn: HTMLButtonElement, mode: GameMode): void {
        const isQueued = this.queueState.get(modeId) || false;

        if (isQueued) {
            // Cancel queue
            this.queueState.set(modeId, false);
            const interval = this.queueIntervals.get(modeId);
            if (interval) clearInterval(interval);
            this.queueIntervals.delete(modeId);
            this.queueTimers.delete(modeId);

            btn.textContent = 'FIND MATCH';
            btn.classList.remove('lobby__find-btn--searching');
            btn.style.borderColor = `hsla(${mode.color}, 100%, 50%, 0.3)`;
            btn.style.color = `hsl(${mode.color}, 100%, 65%)`;
            btn.style.background = `hsla(${mode.color}, 100%, 50%, 0.06)`;
        } else {
            // Start queue
            this.queueState.set(modeId, true);
            this.queueTimers.set(modeId, 0);

            btn.classList.add('lobby__find-btn--searching');
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.style.background = '';

            const interval = setInterval(() => {
                const elapsed = (this.queueTimers.get(modeId) || 0) + 1;
                this.queueTimers.set(modeId, elapsed);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                btn.textContent = `SEARCHING... ${mins}:${secs.toString().padStart(2, '0')}`;
            }, 1000);
            this.queueIntervals.set(modeId, interval);

            btn.textContent = `SEARCHING... 0:00`;

            this.onPlayClick?.(modeId);
        }
    }
}
