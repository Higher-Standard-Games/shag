/**
 * LobbyPanel — Main Lobby UI (extends GamePanel)
 *
 * 3-column layout inside GamePanel:
 *   LEFT:   Players Online + Live Matches
 *   CENTER: Game mode cards (compact vertical stack)
 *   RIGHT:  Chat (full spacious column)
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
    { id: 'duel', title: 'DUEL', subtitle: '1v1 — Ranked', hue: '180', queued: 4 },
    { id: 'team', title: 'TEAM', subtitle: '2v2 — Team Deathmatch', hue: '320', queued: 1 },
    { id: 'ffa', title: 'FFA', subtitle: 'Free For All', hue: '45', queued: 0 },
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
];

const MOCK_MATCHES = [
    { type: 'DUEL', p1: 'rocketJump99', p2: 'speedrunner', map: 'wdm7', score: '5 – 3', time: '2:41' },
    { type: '2v2', p1: 'Team Alpha', p2: 'Team Bravo', map: 'wdm2', score: '12 – 8', time: '1:12' },
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

        // Footer buttons
        const consoleBtn = this.createButton('Console ~', '');
        const settingsBtn = this.createButton('⚙ Settings', '', () => this._onSettingsClick?.());
        this.footerArea.appendChild(consoleBtn);
        this.footerArea.appendChild(settingsBtn);

        // Build lobby content
        this.setContent(this.buildLayout());
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
    // LAYOUT
    // ═══════════════════════════════════════════════════════════════════

    private buildLayout(): HTMLElement {
        const layout = document.createElement('div');
        layout.className = 'lobby__layout';

        // LEFT: Players + Matches
        layout.appendChild(this.buildLeftColumn());
        // CENTER: Game modes
        layout.appendChild(this.buildCenterColumn());
        // RIGHT: Chat
        layout.appendChild(this.buildRightColumn());

        return layout;
    }

    // ── Left Column: Players & Matches ──────────────────────────────

    private buildLeftColumn(): HTMLElement {
        const col = document.createElement('div');
        col.className = 'lobby__col lobby__col--left';

        // Players
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
                const st = document.createElement('span');
                st.className = 'lobby__player-badge lobby__player-badge--search';
                st.textContent = (p as any).mode || '?';
                row.appendChild(st);
            } else if (p.status === 'ingame') {
                const st = document.createElement('span');
                st.className = 'lobby__player-badge lobby__player-badge--ingame';
                st.textContent = 'IN MATCH';
                row.appendChild(st);
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

            const mapEl = document.createElement('span');
            mapEl.className = 'lobby__match-map';
            mapEl.textContent = m.map;
            footer.appendChild(mapEl);

            const score = document.createElement('span');
            score.className = 'lobby__match-score';
            score.textContent = m.score;
            footer.appendChild(score);

            const watchBtn = document.createElement('button');
            watchBtn.className = 'lobby__watch-btn';
            watchBtn.textContent = 'WATCH';
            footer.appendChild(watchBtn);

            match.appendChild(footer);
            list.appendChild(match);
        }

        return list;
    }

    // ── Center Column: Game Modes ───────────────────────────────────

    private buildCenterColumn(): HTMLElement {
        const col = document.createElement('div');
        col.className = 'lobby__col lobby__col--center';

        col.appendChild(this.sectionTitle('QUEUE FOR MATCH'));

        const cards = document.createElement('div');
        cards.className = 'lobby__mode-cards';

        for (const mode of GAME_MODES) {
            cards.appendChild(this.buildModeCard(mode));
        }

        col.appendChild(cards);

        // Status hint
        const hint = document.createElement('div');
        hint.className = 'lobby__hint';
        hint.textContent = 'SELECT A MODE TO FIND A MATCH';
        col.appendChild(hint);

        return col;
    }

    private buildModeCard(mode: GameMode): HTMLElement {
        const card = document.createElement('div');
        card.className = 'lobby__mode-card';
        card.dataset.mode = mode.id;
        card.style.setProperty('--card-hue', mode.hue);

        // Accent line left
        const accent = document.createElement('div');
        accent.className = 'lobby__mode-accent';
        card.appendChild(accent);

        // Text section
        const text = document.createElement('div');
        text.className = 'lobby__mode-text';

        const title = document.createElement('div');
        title.className = 'lobby__mode-title';
        title.textContent = mode.title;
        text.appendChild(title);

        const sub = document.createElement('div');
        sub.className = 'lobby__mode-sub';
        sub.textContent = mode.subtitle;
        text.appendChild(sub);

        card.appendChild(text);

        // Queue count
        const queueEl = document.createElement('div');
        queueEl.className = 'lobby__mode-queue';
        queueEl.textContent = mode.queued > 0 ? `${mode.queued} in queue` : 'No queue';
        if (mode.queued > 0) queueEl.classList.add('lobby__mode-queue--active');
        card.appendChild(queueEl);

        // Find Match button
        const btn = document.createElement('button');
        btn.className = 'lobby__find-btn';
        btn.id = `lobby-find-${mode.id}`;
        btn.textContent = 'FIND MATCH';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleQueue(mode.id, btn, mode);
        });
        card.appendChild(btn);

        // Card click
        card.addEventListener('click', () => this.toggleQueue(mode.id, btn, mode));

        return card;
    }

    // ── Right Column: Chat ──────────────────────────────────────────

    private buildRightColumn(): HTMLElement {
        const col = document.createElement('div');
        col.className = 'lobby__col lobby__col--right';

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

        // Input
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

    // ── Helpers ─────────────────────────────────────────────────────

    private sectionTitle(text: string, badge?: string): HTMLElement {
        const el = document.createElement('div');
        el.className = 'lobby__section-title';

        const label = document.createTextNode(text);
        el.appendChild(label);

        if (badge) {
            const b = document.createElement('span');
            b.className = 'lobby__section-badge';
            b.textContent = badge;
            el.appendChild(b);
        }

        return el;
    }

    // ── Queue Logic ─────────────────────────────────────────────────

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
