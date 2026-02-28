/**
 * LobbyPanel — Main Lobby UI (extends GamePanel)
 *
 * Layout:
 *   LEFT:   Full-height game mode cards (with background colors, inviting)
 *   CENTER: Players Online + Live Matches
 *   RIGHT:  Lobby Chat
 *
 * Uses GamePanel tabs for future expansion (MATCHMAKING / CUSTOM / PRACTICE)
 */

import { GamePanel } from './GamePanel';
import { UIStyles } from '../UIStyles';
import lobbyCSSRaw from './styles/LobbyPanel.css?raw';

// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

interface GameMode {
    id: string;
    title: string;
    subtitle: string;
    hue: string;
    queued: number;
}

const GAME_MODES: GameMode[] = [
    { id: 'duel', title: 'DUEL', subtitle: '1 vs 1', hue: '180', queued: 4 },
    { id: 'team', title: 'TEAM', subtitle: '2 vs 2', hue: '320', queued: 1 },
    { id: 'ffa', title: 'FFA', subtitle: 'FREE FOR ALL', hue: '45', queued: 0 },
];

const MOCK_PLAYERS = [
    { name: 'zeroQL', status: 'searching' as const, mode: 'DUEL' },
    { name: 'washoi_dev', status: 'online' as const },
    { name: 'rocketJump99', status: 'ingame' as const },
    { name: 'fragmaster', status: 'searching' as const, mode: 'FFA' },
    { name: 'neon_ghost', status: 'online' as const },
    { name: 'plasma_rush', status: 'ingame' as const },
    { name: 'strafejmp', status: 'online' as const },
    { name: 'q3_veteran', status: 'online' as const },
    { name: 'cpma_wizard', status: 'searching' as const, mode: 'DUEL' },
    { name: 'rail_queen', status: 'ingame' as const },
    { name: 'shaft_master', status: 'online' as const },
    { name: 'bunny_hop', status: 'online' as const },
    { name: 'lg_demon', status: 'ingame' as const },
    { name: 'warsow_fan', status: 'searching' as const, mode: 'TEAM' },
    { name: 'arena_noob', status: 'online' as const },
    { name: 'rocket_queen', status: 'online' as const },
];

const MOCK_MATCHES = [
    { type: 'DUEL', p1: 'rocketJump99', p2: 'speedrunner', map: 'wdm7', score: '5 – 3', time: '2:41' },
    { type: '2v2', p1: 'Team Alpha', p2: 'Team Bravo', map: 'wdm2', score: '12 – 8', time: '1:12' },
    { type: 'DUEL', p1: 'rail_queen', p2: 'lg_demon', map: 'wdm5', score: '7 – 6', time: '4:30' },
    { type: 'FFA', p1: '6 players', p2: '', map: 'wdm1', score: '', time: '0:45' },
    { type: 'DUEL', p1: 'cpma_wizard', p2: 'warsow_fan', map: 'wdm3', score: '2 – 0', time: '0:22' },
];

const MOCK_CHAT = [
    { name: 'zeroQL', msg: 'anyone up for a duel?' },
    { name: 'washoi_dev', msg: 'gg last game, that rocket was insane' },
    { name: 'fragmaster', msg: 'queueing FFA, join up!' },
    { name: '', msg: 'plasma_rush joined the lobby', system: true },
    { name: 'neon_ghost', msg: 'new map when?' },
    { name: 'q3_veteran', msg: 'this engine is sick' },
    { name: '', msg: 'rocketJump99 started a match', system: true },
    { name: 'washoi_dev', msg: 'nice movement tech in this build' },
    { name: 'strafejmp', msg: 'that crouchslide is smooth now' },
];

// ═══════════════════════════════════════════════════════════════════
// LOBBY PANEL
// ═══════════════════════════════════════════════════════════════════

export class LobbyPanel extends GamePanel {
    private queueState: Map<string, boolean> = new Map();
    private queueTimers: Map<string, number> = new Map();
    private queueIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private _onPlayClick: ((mode: string) => void) | null = null;
    private _onSettingsClick: (() => void) | null = null;

    constructor() {
        super('PLAY');
        UIStyles.injectCSS('lobby-panel', lobbyCSSRaw);

        // Single tab (no Custom Game for now)
        this.addTab('matchmaking', 'Matchmaking', this.buildMatchmakingTab());
        this.switchTab('matchmaking');

        // Add Console & Settings buttons inline with tab row
        const headerBtns = document.createElement('div');
        headerBtns.className = 'lobby__header-actions';

        const consoleBtn = this.createButton('Console ~', '');
        const settingsBtn = this.createButton('⚙ Settings', '', () => this._onSettingsClick?.());
        headerBtns.appendChild(consoleBtn);
        headerBtns.appendChild(settingsBtn);

        this.tabBar.appendChild(headerBtns);

        // Hide the footer since buttons are in the header now
        this.footerArea.style.display = 'none';
    }

    show(): void { this.open(); }
    hide(): void {
        this.queueIntervals.forEach(i => clearInterval(i));
        this.queueIntervals.clear();
        this.close();
    }
    isVisible(): boolean { return this.isOpen(); }
    setOnSettings(cb: () => void): void { this._onSettingsClick = cb; }
    setOnPlay(cb: (mode: string) => void): void { this._onPlayClick = cb; }

    // ═══════════════════════════════════════════════════════════════════
    // TAB BUILDERS
    // ═══════════════════════════════════════════════════════════════════

    private buildMatchmakingTab(): HTMLElement {
        const layout = document.createElement('div');
        layout.className = 'lobby__layout';

        // LEFT: Full-height game mode cards
        layout.appendChild(this.buildModeCards());
        // CENTER: Players + Matches
        layout.appendChild(this.buildSocialColumn());
        // RIGHT: Chat
        layout.appendChild(this.buildChatColumn());

        return layout;
    }

    // ═══════════════════════════════════════════════════════════════════
    // LEFT: GAME MODE CARDS (full-height)
    // ═══════════════════════════════════════════════════════════════════

    private buildModeCards(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'lobby__modes';

        for (const mode of GAME_MODES) {
            container.appendChild(this.buildModeCard(mode));
        }

        return container;
    }

    private buildModeCard(mode: GameMode): HTMLElement {
        const card = document.createElement('div');
        card.className = 'lobby__mode-card';
        card.dataset.mode = mode.id;
        card.style.setProperty('--card-hue', mode.hue);

        // Background (colored, will show map screenshots later)
        const bg = document.createElement('div');
        bg.className = 'lobby__mode-bg';
        card.appendChild(bg);

        // Gradient overlay
        const overlay = document.createElement('div');
        overlay.className = 'lobby__mode-overlay';
        card.appendChild(overlay);

        // Content at bottom
        const content = document.createElement('div');
        content.className = 'lobby__mode-content';

        const title = document.createElement('div');
        title.className = 'lobby__mode-title';
        title.textContent = mode.title;
        content.appendChild(title);

        const sub = document.createElement('div');
        sub.className = 'lobby__mode-sub';
        sub.textContent = mode.subtitle;
        content.appendChild(sub);

        const queueEl = document.createElement('div');
        queueEl.className = 'lobby__mode-queue';
        queueEl.textContent = mode.queued > 0 ? `${mode.queued} IN QUEUE` : 'NO QUEUE';
        if (mode.queued > 0) queueEl.classList.add('lobby__mode-queue--active');
        content.appendChild(queueEl);

        const btn = document.createElement('button');
        btn.className = 'lobby__find-btn';
        btn.id = `lobby-find-${mode.id}`;
        btn.textContent = 'FIND MATCH';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleQueue(mode.id, btn, mode);
        });
        content.appendChild(btn);

        card.appendChild(content);

        // Card click = find match
        card.addEventListener('click', () => this.toggleQueue(mode.id, btn, mode));

        return card;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CENTER: SOCIAL (Players + Matches)
    // ═══════════════════════════════════════════════════════════════════

    private buildSocialColumn(): HTMLElement {
        const col = document.createElement('div');
        col.className = 'lobby__col lobby__col--social';

        // Players Online
        col.appendChild(this.sectionTitle('PLAYERS ONLINE', `${MOCK_PLAYERS.length}`));
        col.appendChild(this.buildPlayerList());

        // Divider
        const divider = document.createElement('div');
        divider.className = 'lobby__divider';
        col.appendChild(divider);

        // Live Matches
        col.appendChild(this.sectionTitle('LIVE MATCHES'));
        col.appendChild(this.buildMatchList());

        return col;
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
                const badge = document.createElement('span');
                badge.className = 'lobby__player-badge lobby__player-badge--search';
                badge.textContent = (p as any).mode || '?';
                row.appendChild(badge);
            } else if (p.status === 'ingame') {
                const badge = document.createElement('span');
                badge.className = 'lobby__player-badge lobby__player-badge--ingame';
                badge.textContent = 'IN MATCH';
                row.appendChild(badge);
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

            const header = document.createElement('div');
            header.className = 'lobby__match-header';
            header.innerHTML = `
                <span class="lobby__match-live">● LIVE</span>
                <span class="lobby__match-type">${m.type}</span>
                <span class="lobby__match-time">${m.time}</span>
            `;
            match.appendChild(header);

            const players = document.createElement('div');
            players.className = 'lobby__match-players';
            players.textContent = `${m.p1} vs ${m.p2}`;
            match.appendChild(players);

            const footer = document.createElement('div');
            footer.className = 'lobby__match-footer';
            footer.innerHTML = `
                <span class="lobby__match-map">${m.map}</span>
                <span class="lobby__match-score">${m.score}</span>
            `;

            const watchBtn = document.createElement('button');
            watchBtn.className = 'lobby__watch-btn';
            watchBtn.textContent = 'WATCH';
            footer.appendChild(watchBtn);

            match.appendChild(footer);
            list.appendChild(match);
        }

        return list;
    }

    // ═══════════════════════════════════════════════════════════════════
    // RIGHT: CHAT
    // ═══════════════════════════════════════════════════════════════════

    private buildChatColumn(): HTMLElement {
        const col = document.createElement('div');
        col.className = 'lobby__col lobby__col--chat';

        col.appendChild(this.sectionTitle('LOBBY CHAT'));

        const messages = document.createElement('div');
        messages.className = 'lobby__chat-messages';

        for (const c of MOCK_CHAT) {
            const msg = document.createElement('div');
            if ((c as any).system) {
                msg.className = 'lobby__chat-msg lobby__chat-msg--system';
                msg.textContent = c.msg;
            } else {
                msg.className = 'lobby__chat-msg';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'lobby__chat-name';
                nameSpan.textContent = c.name;
                msg.appendChild(nameSpan);
                msg.appendChild(document.createTextNode(c.msg));
            }
            messages.appendChild(msg);
        }
        col.appendChild(messages);

        const inputWrap = document.createElement('div');
        inputWrap.className = 'lobby__chat-input-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'lobby__chat-input';
        input.placeholder = 'Type a message...';
        input.spellcheck = false;
        input.autocomplete = 'off';

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && input.value.trim()) {
                console.log(`[Lobby] Chat: "${input.value}"`);
                input.value = '';
            }
        });

        inputWrap.appendChild(input);
        col.appendChild(inputWrap);

        return col;
    }

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════

    private sectionTitle(text: string, badge?: string): HTMLElement {
        const el = document.createElement('div');
        el.className = 'lobby__section-title';
        el.appendChild(document.createTextNode(text));
        if (badge) {
            const b = document.createElement('span');
            b.className = 'lobby__section-badge';
            b.textContent = badge;
            el.appendChild(b);
        }
        return el;
    }

    private toggleQueue(modeId: string, btn: HTMLButtonElement, mode: GameMode): void {
        const isQueued = this.queueState.get(modeId) || false;
        const card = btn.closest('.lobby__mode-card') as HTMLElement | null;

        if (isQueued) {
            this.queueState.set(modeId, false);
            const interval = this.queueIntervals.get(modeId);
            if (interval) clearInterval(interval);
            this.queueIntervals.delete(modeId);
            this.queueTimers.delete(modeId);

            btn.textContent = 'FIND MATCH';
            btn.classList.remove('lobby__find-btn--searching');
            card?.classList.remove('lobby__mode-card--searching');
        } else {
            this.queueState.set(modeId, true);
            this.queueTimers.set(modeId, 0);

            btn.classList.add('lobby__find-btn--searching');
            card?.classList.add('lobby__mode-card--searching');
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
