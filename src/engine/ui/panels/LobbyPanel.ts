/**
 * LobbyPanel — Main Lobby UI (extends GamePanel)
 *
 * Full-viewport lobby screen shown on startup, using the same immersive
 * GamePanel system as Settings and Pause menus. Features:
 * - Blur zones, neon dividers, kanji watermarks, particles, scanline (from GamePanel)
 * - Game mode cards (DUEL 1v1, TEAM 2v2, FFA) with unique color accents
 * - Social sidebar (players, live matches, chat)
 * - Queue state management (mock for Phase 1)
 */

import { GamePanel } from './GamePanel';
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
    hue: string;       // HSL hue number
    glowColor: string;  // HSLA for glow effects
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
        hue: '180',
        glowColor: 'hsla(180, 100%, 50%, 0.4)',
    },
    {
        id: 'team',
        title: 'TEAM',
        subtitle: '2 vs 2',
        icon: '🛡️',
        hue: '320',
        glowColor: 'hsla(320, 100%, 60%, 0.35)',
    },
    {
        id: 'ffa',
        title: 'FFA',
        subtitle: 'FREE FOR ALL',
        icon: '💥',
        hue: '45',
        glowColor: 'hsla(45, 100%, 55%, 0.35)',
    },
];

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA
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
// LOBBY PANEL CLASS (extends GamePanel)
// ═══════════════════════════════════════════════════════════════════

export class LobbyPanel extends GamePanel {
    private queueState: Map<string, boolean> = new Map();
    private queueTimers: Map<string, number> = new Map();
    private queueIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private _onPlayClick: ((mode: string) => void) | null = null;

    constructor() {
        super('PLAY');

        // Inject lobby-specific CSS
        UIStyles.injectCSS('lobby-panel', lobbyCSSRaw);

        // Footer: Settings button + version
        const settingsBtn = this.createButton('⚙ Settings', '', () => {
            this.openSettings();
        });
        const consoleBtn = this.createButton('Console ~', '', () => {
            // Will be wired up externally
        });
        this.footerArea.appendChild(consoleBtn);
        this.footerArea.appendChild(settingsBtn);

        // Build the lobby layout and put it in the scrollable content area
        const lobbyContent = this.buildLobbyContent();
        this.setContent(lobbyContent);
    }

    /**
     * Show the lobby (delegates to GamePanel.open)
     */
    show(): void {
        this.open();
    }

    /**
     * Hide the lobby (delegates to GamePanel.close)
     */
    hide(): void {
        // Clear all queue intervals
        this.queueIntervals.forEach(interval => clearInterval(interval));
        this.queueIntervals.clear();
        this.close();
    }

    /**
     * Check if lobby is visible
     */
    isVisible(): boolean {
        return this.isOpen();
    }

    /**
     * Register settings button callback
     */
    setOnSettings(callback: () => void): void {
        this._onSettingsClick = callback;
    }

    /**
     * Register play/queue callback
     */
    setOnPlay(callback: (mode: string) => void): void {
        this._onPlayClick = callback;
    }

    private _onSettingsClick: (() => void) | null = null;

    private openSettings(): void {
        this._onSettingsClick?.();
    }

    // ═══════════════════════════════════════════════════════════════════
    // BUILD METHODS
    // ═══════════════════════════════════════════════════════════════════

    private buildLobbyContent(): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'lobby__layout';

        // === Left: Game mode cards ===
        const modesSection = document.createElement('div');
        modesSection.className = 'lobby__modes';

        for (const mode of GAME_MODES) {
            modesSection.appendChild(this.buildModeCard(mode));
        }
        wrapper.appendChild(modesSection);

        // === Right: Social sidebar ===
        const sidebar = document.createElement('div');
        sidebar.className = 'lobby__sidebar';

        // Players
        sidebar.appendChild(this.buildSectionTitle('PLAYERS ONLINE'));
        sidebar.appendChild(this.buildPlayerList());

        // Live Matches
        sidebar.appendChild(this.buildSectionTitle('LIVE MATCHES'));
        sidebar.appendChild(this.buildMatchList());

        // Chat
        sidebar.appendChild(this.buildChat());

        wrapper.appendChild(sidebar);

        // Bottom info bar inside the panel
        const infoBar = document.createElement('div');
        infoBar.className = 'lobby__infobar';
        infoBar.innerHTML = `
            <span class="lobby__status-dot">CONNECTED</span>
            <span>${MOCK_PLAYERS.length} ONLINE</span>
        `;
        wrapper.appendChild(infoBar);

        return wrapper;
    }

    private buildModeCard(mode: GameMode): HTMLElement {
        const card = document.createElement('div');
        card.className = 'lobby__mode-card';
        card.dataset.mode = mode.id;

        // Background placeholder (colored)
        const bg = document.createElement('div');
        bg.className = 'lobby__mode-bg';
        bg.style.backgroundColor = `hsl(${mode.hue}, 25%, 8%)`;
        card.appendChild(bg);

        // Gradient overlay
        const overlay = document.createElement('div');
        overlay.className = 'lobby__mode-overlay';
        card.appendChild(overlay);

        // Content at bottom
        const content = document.createElement('div');
        content.className = 'lobby__mode-content';

        const icon = document.createElement('div');
        icon.className = 'lobby__mode-icon';
        icon.textContent = mode.icon;
        content.appendChild(icon);

        const title = document.createElement('div');
        title.className = 'lobby__mode-title';
        title.textContent = mode.title;
        title.style.color = `hsl(${mode.hue}, 100%, 80%)`;
        title.style.textShadow = `0 0 20px ${mode.glowColor}, 0 0 40px hsla(${mode.hue}, 100%, 50%, 0.15)`;
        content.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'lobby__mode-subtitle';
        subtitle.textContent = mode.subtitle;
        content.appendChild(subtitle);

        const queueCount = document.createElement('div');
        queueCount.className = 'lobby__mode-queue-count';
        queueCount.textContent = `${Math.floor(Math.random() * 5)} IN QUEUE`;
        content.appendChild(queueCount);

        const btn = document.createElement('button');
        btn.className = 'lobby__find-btn';
        btn.id = `lobby-find-${mode.id}`;
        btn.textContent = 'FIND MATCH';
        btn.style.borderColor = `hsla(${mode.hue}, 100%, 50%, 0.3)`;
        btn.style.color = `hsl(${mode.hue}, 100%, 65%)`;
        btn.style.background = `hsla(${mode.hue}, 100%, 50%, 0.06)`;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleQueue(mode.id, btn, mode);
        });
        content.appendChild(btn);

        card.appendChild(content);

        // Card click = find match
        card.addEventListener('click', () => {
            this.toggleQueue(mode.id, btn, mode);
        });

        return card;
    }

    private buildSectionTitle(text: string): HTMLElement {
        const el = document.createElement('div');
        el.className = 'lobby__section-title';
        el.textContent = text;
        return el;
    }

    private buildPlayerList(): HTMLElement {
        const list = document.createElement('div');
        list.className = 'lobby__players';

        for (const p of MOCK_PLAYERS) {
            const row = document.createElement('div');
            row.className = 'lobby__player';

            const dot = document.createElement('div');
            dot.className = `lobby__player-dot lobby__player-dot--${p.status}`;
            row.appendChild(dot);

            const name = document.createElement('span');
            name.className = 'lobby__player-name';
            name.textContent = p.name;
            row.appendChild(name);

            if (p.status === 'searching') {
                const status = document.createElement('span');
                status.className = 'lobby__player-status';
                status.textContent = `🔍 ${p.mode}`;
                row.appendChild(status);
            } else if (p.status === 'ingame') {
                const status = document.createElement('span');
                status.className = 'lobby__player-status';
                status.textContent = '🎮 IN MATCH';
                row.appendChild(status);
            }

            list.appendChild(row);
        }

        return list;
    }

    private buildMatchList(): HTMLElement {
        const list = document.createElement('div');
        list.className = 'lobby__matches';

        for (const m of MOCK_MATCHES) {
            const match = document.createElement('div');
            match.className = 'lobby__match';

            match.innerHTML = `
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
            `;

            list.appendChild(match);
        }

        return list;
    }

    private buildChat(): HTMLElement {
        const chat = document.createElement('div');
        chat.className = 'lobby__chat';

        chat.appendChild(this.buildSectionTitle('CHAT'));

        const messages = document.createElement('div');
        messages.className = 'lobby__chat-messages';

        for (const c of MOCK_CHAT) {
            const msg = document.createElement('div');
            if ((c as any).system) {
                msg.className = 'lobby__chat-msg lobby__chat-msg--system';
                msg.textContent = c.msg;
            } else {
                msg.className = 'lobby__chat-msg';
                msg.innerHTML = `<span class="lobby__chat-msg-name">${c.name}</span>${c.msg}`;
            }
            messages.appendChild(msg);
        }
        chat.appendChild(messages);

        const inputWrap = document.createElement('div');
        inputWrap.className = 'lobby__chat-input-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'lobby__chat-input';
        input.placeholder = 'Type a message...';
        input.spellcheck = false;
        input.autocomplete = 'off';

        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Don't trigger game controls
            if (e.key === 'Enter' && input.value.trim()) {
                console.log(`[Lobby] Chat: "${input.value}"`);
                input.value = '';
            }
        });

        inputWrap.appendChild(input);
        chat.appendChild(inputWrap);

        return chat;
    }

    // ═══════════════════════════════════════════════════════════════════
    // QUEUE TOGGLE
    // ═══════════════════════════════════════════════════════════════════

    private toggleQueue(modeId: string, btn: HTMLButtonElement, mode: GameMode): void {
        const isQueued = this.queueState.get(modeId) || false;

        if (isQueued) {
            this.queueState.set(modeId, false);
            const interval = this.queueIntervals.get(modeId);
            if (interval) clearInterval(interval);
            this.queueIntervals.delete(modeId);
            this.queueTimers.delete(modeId);

            btn.textContent = 'FIND MATCH';
            btn.classList.remove('lobby__find-btn--searching');
            btn.style.borderColor = `hsla(${mode.hue}, 100%, 50%, 0.3)`;
            btn.style.color = `hsl(${mode.hue}, 100%, 65%)`;
            btn.style.background = `hsla(${mode.hue}, 100%, 50%, 0.06)`;
        } else {
            this.queueState.set(modeId, true);
            this.queueTimers.set(modeId, 0);

            btn.classList.add('lobby__find-btn--searching');
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.style.background = '';
            btn.textContent = 'SEARCHING... 0:00';

            const interval = setInterval(() => {
                const elapsed = (this.queueTimers.get(modeId) || 0) + 1;
                this.queueTimers.set(modeId, elapsed);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                btn.textContent = `SEARCHING... ${mins}:${secs.toString().padStart(2, '0')}`;
            }, 1000);
            this.queueIntervals.set(modeId, interval);

            this._onPlayClick?.(modeId);
        }
    }
}
