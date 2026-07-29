/**
 * MatchLobbyView — Pre-match lobby component
 *
 * Renders inside the Matchmaking tab content area when a player
 * clicks "FIND MATCH". Shows map vote, player slots, share URL,
 * and READY/LEAVE buttons.
 *
 * Phase 1: Pure UI with mock data. Phase 2: Wire to REST+WebSocket.
 */

import type { LobbyClient } from "../../../lobby/LobbyClient";
import type { MatchLobbyInfo } from "../../../lobby/types";
import { ConnectingOverlay } from "./ConnectingOverlay";

// ═══════════════════════════════════════════════════════════════════
// TYPES & MOCK DATA
// ═══════════════════════════════════════════════════════════════════

export interface MatchLobbyPlayer {
  name: string;
  team: "alpha" | "bravo" | "none";
  ready: boolean;
  isLocal: boolean;
}

export interface MatchLobbyMapOption {
  name: string;
  displayName: string;
  votes: number;
  votedByLocal: boolean;
}

export interface MatchLobbyConfig {
  gametype: string;
  gametypeLabel: string;
  maxPlayers: number;
  hasTeams: boolean;
}

const GAMETYPE_CONFIG: Record<string, MatchLobbyConfig> = {
  duel: { gametype: "duel", gametypeLabel: "DUEL 1v1", maxPlayers: 2, hasTeams: true },
  team: { gametype: "team", gametypeLabel: "TEAM 2v2", maxPlayers: 4, hasTeams: true },
  ffa: { gametype: "ffa", gametypeLabel: "FFA", maxPlayers: 8, hasTeams: false },
};

function generateLobbyId(): string {
  return `${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}`;
}

// ═══════════════════════════════════════════════════════════════════
// MATCH LOBBY VIEW
// ═══════════════════════════════════════════════════════════════════

export class MatchLobbyView {
  public readonly root: HTMLElement;

  private config: MatchLobbyConfig;
  private lobbyId: string;
  private maps: MatchLobbyMapOption[];
  private players: MatchLobbyPlayer[];
  private localReady = false;
  private onLeaveCallback: (() => void) | null = null;
  private lobbyClient: LobbyClient | null = null;
  private unsubscribers: (() => void)[] = [];
  private inviteBotBtn: HTMLButtonElement | null = null;
  private inviteBotPending = false;

  constructor(gametype: string, lobbyClient?: LobbyClient, lobbyInfo?: MatchLobbyInfo) {
    this.lobbyClient = lobbyClient || null;

    if (lobbyInfo) {
      // Use real server data
      this.config = {
        gametype: lobbyInfo.gametype,
        gametypeLabel:
          lobbyInfo.config.hasTeams && lobbyInfo.config.maxPlayers === 2
            ? "DUEL 1v1"
            : lobbyInfo.config.hasTeams
              ? `TEAM ${lobbyInfo.config.maxPlayers / 2}v${lobbyInfo.config.maxPlayers / 2}`
              : "FFA",
        maxPlayers: lobbyInfo.config.maxPlayers,
        hasTeams: lobbyInfo.config.hasTeams,
      };
      this.lobbyId = lobbyInfo.id;
      this.maps = lobbyInfo.maps.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        votes: m.votes,
        votedByLocal: false,
      }));
      this.players = lobbyInfo.players.map((p) => ({
        name: p.name,
        team: p.team as "alpha" | "bravo" | "none",
        ready: p.ready,
        isLocal: p.id === lobbyInfo.players[0]?.id, // First player is creator
      }));
    } else {
      // Fallback: mock data (no server connection — map pool comes from server in production)
      this.config = GAMETYPE_CONFIG[gametype] || GAMETYPE_CONFIG.duel;
      this.lobbyId = generateLobbyId();
      this.maps = [];
      this.players = this.generateMockPlayers();
    }

    this.root = this.build();

    // Wire lobby events if connected
    if (this.lobbyClient) {
      this.wireLobbyEvents();
    }
  }

  private wireLobbyEvents(): void {
    if (!this.lobbyClient) return;

    // Vote updates
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:votes_updated", (msg) => {
        for (const map of this.maps) {
          if (msg.votes[map.name] !== undefined) {
            map.votes = msg.votes[map.name];
          }
        }
        this.refreshMapVotes();
      }),
    );

    // Player ready updates
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:player_updated", (msg) => {
        const player = this.players.find((p) => p.name === msg.playerId || p.isLocal);
        if (player && !player.isLocal) {
          player.ready = msg.ready;
          this.refreshPlayerSlots();
        }
      }),
    );

    // Player joined
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:player_joined", (msg) => {
        this.players.push({
          name: msg.player.name,
          team: msg.player.team as "alpha" | "bravo" | "none",
          ready: msg.player.ready,
          isLocal: false,
        });
        this.refreshPlayerSlots();
        this.refreshHeader();
        // A joining player (incl. an invited bot) may have filled the lobby.
        this.inviteBotPending = false;
        this.updateInviteBotState();
      }),
    );

    // Player left
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:player_left", (msg) => {
        this.players = this.players.filter((p) => p.name !== msg.playerId);
        this.refreshPlayerSlots();
        this.refreshHeader();
        this.updateInviteBotState();
      }),
    );

    // Bot invite acknowledged — the bot will arrive via lobby:player_joined.
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:bot_invited", () => {
        // Keep the button disabled until the bot's player_joined lands.
      }),
    );

    // Bot invite failed — re-enable the button and surface the reason.
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:bot_invite_failed", (msg) => {
        console.warn("[MatchLobbyView] Bot invite failed:", msg.error);
        this.inviteBotPending = false;
        this.updateInviteBotState();
        if (this.inviteBotBtn) {
          this.inviteBotBtn.textContent = "🤖 NO BOTS AVAILABLE";
          this.inviteBotBtn.disabled = true;
          window.setTimeout(() => this.updateInviteBotState(), 2500);
        }
      }),
    );

    // All ready → connect
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:all_ready", () => {
        // Show all players as ready
        for (const p of this.players) p.ready = true;
        this.refreshPlayerSlots();
      }),
    );

    this.unsubscribers.push(
      this.lobbyClient.on("lobby:connect", (msg) => {
        // Remember which lobby this match came from — the post-game
        // RETURN TO LOBBY button navigates back to it via ?lobby=<id>
        // (docs/research/single_game_server_lobby.md).
        try {
          sessionStorage.setItem("shag.return_lobby", this.lobbyId);
        } catch {
          /* storage unavailable — return falls back to a plain reload */
        }
        const overlay = new ConnectingOverlay();
        overlay.show(msg.serverUrl);
      }),
    );

    // Teams shuffled
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:teams_shuffled", (msg) => {
        for (const sp of msg.players) {
          const p = this.players.find((pp) => pp.name === sp.name);
          if (p) p.team = sp.team;
        }
        this.refreshPlayerSlots();
      }),
    );
  }

  onLeave(cb: () => void): void {
    this.onLeaveCallback = cb;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════

  private build(): HTMLElement {
    const container = document.createElement("div");
    container.className = "match-lobby";

    // ── Header (static top) ──
    const header = document.createElement("div");
    header.className = "match-lobby__header";
    header.innerHTML = `
            <span class="match-lobby__gametype">${this.config.gametypeLabel}</span>
            <span class="match-lobby__player-count">${this.players.length} / ${this.config.maxPlayers} PLAYERS</span>
        `;
    container.appendChild(header);

    // ── Scrollable content area ──
    const content = document.createElement("div");
    content.className = "match-lobby__content";

    // Map Vote Row
    content.appendChild(this.buildMapVoteRow());

    // Lobby URL (between maps and teams)
    content.appendChild(this.buildUrlBar());

    // Players / Teams
    content.appendChild(this.buildPlayerArea());

    container.appendChild(content);

    // ── Action Buttons (static bottom) ──
    container.appendChild(this.buildActions());

    return container;
  }

  // ── Map Vote ──

  private buildMapVoteRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "match-lobby__maps";

    for (const map of this.maps) {
      const card = document.createElement("div");
      card.className = "match-lobby__map-card";
      if (map.votedByLocal) card.classList.add("match-lobby__map-card--voted");

      // Map image placeholder (gradient based on name hash)
      const img = document.createElement("div");
      img.className = "match-lobby__map-img";
      const hue = this.hashToHue(map.name);
      img.style.background = `linear-gradient(135deg, hsl(${hue}, 40%, 15%) 0%, hsl(${hue + 30}, 50%, 25%) 100%)`;
      card.appendChild(img);

      const label = document.createElement("div");
      label.className = "match-lobby__map-label";
      label.textContent = map.displayName;
      card.appendChild(label);

      const mapId = document.createElement("div");
      mapId.className = "match-lobby__map-id";
      mapId.textContent = map.name;
      card.appendChild(mapId);

      const voteCount = document.createElement("div");
      voteCount.className = "match-lobby__map-votes";
      voteCount.textContent = map.votes > 0 ? `${map.votes} vote${map.votes !== 1 ? "s" : ""}` : "";
      card.appendChild(voteCount);

      const check = document.createElement("div");
      check.className = "match-lobby__map-check";
      check.textContent = "✓";
      card.appendChild(check);

      card.addEventListener("click", () => {
        this.toggleMapVote(map, card, voteCount);
      });

      row.appendChild(card);
    }

    return row;
  }

  private toggleMapVote(map: MatchLobbyMapOption, _card: HTMLElement, _voteEl: HTMLElement): void {
    // Unvote all first
    for (const m of this.maps) {
      if (m.votedByLocal && m !== map) {
        m.votedByLocal = false;
        if (!this.lobbyClient) m.votes = Math.max(0, m.votes - 1);
      }
    }

    // Toggle this map
    map.votedByLocal = !map.votedByLocal;
    if (!this.lobbyClient) {
      map.votes += map.votedByLocal ? 1 : -1;
    }

    // Send to server if connected
    if (this.lobbyClient && map.votedByLocal) {
      this.lobbyClient.voteMap(this.lobbyId, map.name);
    }

    // Update all cards (local visual toggle)
    const cards = this.root.querySelectorAll(".match-lobby__map-card");
    this.maps.forEach((m, i) => {
      cards[i]?.classList.toggle("match-lobby__map-card--voted", m.votedByLocal);
    });

    // If not connected, also update vote counts locally
    if (!this.lobbyClient) {
      this.refreshMapVotes();
    }
  }

  private refreshMapVotes(): void {
    const voteCounts = this.root.querySelectorAll(".match-lobby__map-votes");
    this.maps.forEach((m, i) => {
      if (voteCounts[i]) {
        (voteCounts[i] as HTMLElement).textContent = m.votes > 0 ? `${m.votes} vote${m.votes !== 1 ? "s" : ""}` : "";
      }
    });
  }

  private refreshPlayerSlots(): void {
    // Rebuild player area
    const playerArea = this.root.querySelector(".match-lobby__players, .match-lobby__teams");
    if (playerArea) {
      const newArea = this.buildPlayerArea();
      playerArea.replaceWith(newArea);
    }
  }

  private refreshHeader(): void {
    const countEl = this.root.querySelector(".match-lobby__player-count");
    if (countEl) {
      countEl.textContent = `${this.players.length} / ${this.config.maxPlayers} PLAYERS`;
    }
  }

  // ── Players ──

  private buildPlayerArea(): HTMLElement {
    const area = document.createElement("div");
    area.className = "match-lobby__players";

    if (this.config.hasTeams) {
      area.classList.add("match-lobby__players--teams");

      const alphaTeam = this.players.filter((p) => p.team === "alpha");
      const bravoTeam = this.players.filter((p) => p.team === "bravo");

      // Display names match the in-game teams (esc menu): alpha = Soba (blue),
      // bravo = Udon (pink). Internal team keys stay alpha/bravo (data + colors).
      area.appendChild(this.buildTeamColumn("TEAM SOBA", alphaTeam, "alpha"));
      area.appendChild(this.buildVsDiv());
      area.appendChild(this.buildTeamColumn("TEAM UDON", bravoTeam, "bravo"));
    } else {
      area.classList.add("match-lobby__players--ffa");
      area.appendChild(this.buildPlayerList());
    }

    return area;
  }

  private buildTeamColumn(title: string, players: MatchLobbyPlayer[], team: string): HTMLElement {
    const col = document.createElement("div");
    col.className = `match-lobby__team match-lobby__team--${team}`;

    const header = document.createElement("div");
    header.className = "match-lobby__team-header";
    header.textContent = title;
    col.appendChild(header);

    const slots = document.createElement("div");
    slots.className = "match-lobby__team-slots";

    const maxPerTeam = Math.ceil(this.config.maxPlayers / 2);
    for (let i = 0; i < maxPerTeam; i++) {
      const player = players[i];
      slots.appendChild(this.buildPlayerSlot(player));
    }

    col.appendChild(slots);
    return col;
  }

  private buildVsDiv(): HTMLElement {
    const vs = document.createElement("div");
    vs.className = "match-lobby__vs";
    vs.textContent = "VS";
    return vs;
  }

  private buildPlayerList(): HTMLElement {
    const list = document.createElement("div");
    list.className = "match-lobby__player-list";

    const header = document.createElement("div");
    header.className = "match-lobby__team-header";
    header.textContent = "PLAYERS";
    list.appendChild(header);

    const slots = document.createElement("div");
    slots.className = "match-lobby__team-slots";

    for (let i = 0; i < this.config.maxPlayers; i++) {
      const player = this.players[i];
      slots.appendChild(this.buildPlayerSlot(player));
    }

    list.appendChild(slots);
    return list;
  }

  private buildPlayerSlot(player?: MatchLobbyPlayer): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "match-lobby__slot";

    if (player) {
      slot.classList.add("match-lobby__slot--filled");
      if (player.isLocal) slot.classList.add("match-lobby__slot--local");
      if (player.ready) slot.classList.add("match-lobby__slot--ready");

      const name = document.createElement("span");
      name.className = "match-lobby__slot-name";
      name.textContent = player.name;
      slot.appendChild(name);

      const status = document.createElement("span");
      status.className = "match-lobby__slot-status";
      status.textContent = player.ready ? "✓ READY" : "NOT READY";
      slot.appendChild(status);
    } else {
      slot.classList.add("match-lobby__slot--empty");
      const waiting = document.createElement("span");
      waiting.className = "match-lobby__slot-waiting";
      waiting.textContent = "Waiting for player...";
      slot.appendChild(waiting);
    }

    return slot;
  }

  // ── URL Bar ──

  private buildUrlBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "match-lobby__url-bar";

    const icon = document.createElement("span");
    icon.className = "match-lobby__url-icon";
    icon.textContent = "🔗";
    bar.appendChild(icon);

    // Real, working invite link — the ?lobby= deep link LobbyPanel auto-joins
    // on boot (works on any host, no SPA path-fallback required).
    const inviteUrl = `${window.location.origin}/?lobby=${this.lobbyId}`;
    const url = document.createElement("span");
    url.className = "match-lobby__url-text";
    url.textContent = `${window.location.host}/?lobby=${this.lobbyId}`;
    bar.appendChild(url);

    const copyBtn = document.createElement("button");
    copyBtn.className = "match-lobby__url-copy";
    copyBtn.textContent = "COPY";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(inviteUrl);
      copyBtn.textContent = "COPIED!";
      setTimeout(() => {
        copyBtn.textContent = "COPY";
      }, 2000);
    });
    bar.appendChild(copyBtn);

    return bar;
  }

  // ── Actions ──

  private buildActions(): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "match-lobby__actions";

    const leaveBtn = document.createElement("button");
    leaveBtn.className = "match-lobby__btn match-lobby__btn--leave";
    leaveBtn.textContent = "← LEAVE";
    leaveBtn.addEventListener("click", () => {
      // Cleanup event subscriptions
      for (const unsub of this.unsubscribers) unsub();
      this.unsubscribers = [];
      this.onLeaveCallback?.();
    });
    actions.appendChild(leaveBtn);

    // Add a bot (server feature — needs a live lobby connection). Pressable
    // repeatedly: it re-enables as each bot joins, which is what a 5v5 mode
    // needs when you are testing alone. The lobby balances teams on join, so
    // each bot lands on whichever side is short.
    if (this.lobbyClient) {
      const inviteBtn = document.createElement("button");
      inviteBtn.className = "match-lobby__btn match-lobby__btn--invite-bot";
      inviteBtn.textContent = "🤖 ADD BOT";
      inviteBtn.addEventListener("click", () => this.requestBot());
      actions.appendChild(inviteBtn);
      this.inviteBotBtn = inviteBtn;
      this.updateInviteBotState();
    }

    // Shuffle teams button (team modes only)
    if (this.config.hasTeams) {
      const shuffleBtn = document.createElement("button");
      shuffleBtn.className = "match-lobby__btn match-lobby__btn--shuffle";
      shuffleBtn.textContent = "🔀 SHUFFLE TEAMS";
      shuffleBtn.addEventListener("click", () => {
        if (this.lobbyClient) {
          this.lobbyClient.voteShuffle(this.lobbyId);
        }
        shuffleBtn.textContent = `🔀 VOTED (1/${Math.ceil(this.players.length / 2)})`;
        shuffleBtn.classList.add("match-lobby__btn--voted");
      });
      actions.appendChild(shuffleBtn);
    }

    const readyBtn = document.createElement("button");
    readyBtn.className = "match-lobby__btn match-lobby__btn--ready";
    readyBtn.textContent = "✓ READY";
    readyBtn.addEventListener("click", () => {
      this.localReady = !this.localReady;
      readyBtn.classList.toggle("match-lobby__btn--ready-active", this.localReady);
      readyBtn.textContent = this.localReady ? "✓ READY!" : "✓ READY";

      // Update local player slot
      const localPlayer = this.players.find((p) => p.isLocal);
      if (localPlayer) {
        localPlayer.ready = this.localReady;
        const localSlot = this.root.querySelector(".match-lobby__slot--local");
        localSlot?.classList.toggle("match-lobby__slot--ready", this.localReady);
        const statusEl = localSlot?.querySelector(".match-lobby__slot-status");
        if (statusEl) statusEl.textContent = this.localReady ? "✓ READY" : "NOT READY";
      }

      // Send to lobby server if connected
      if (this.lobbyClient) {
        this.lobbyClient.setReady(this.lobbyId, this.localReady);
      } else {
        // Demo: when local readies up, simulate other players readying after delay
        if (this.localReady) {
          setTimeout(() => this.simulateAllReady(), 1000);
        }
      }
    });
    actions.appendChild(readyBtn);

    return actions;
  }

  /** Ask the server to spawn an AI bot opponent into this lobby. */
  private requestBot(): void {
    if (!this.lobbyClient || this.inviteBotPending) return;
    if (this.players.length >= this.config.maxPlayers) return;

    this.inviteBotPending = true;
    this.lobbyClient.inviteBot(this.lobbyId);

    if (this.inviteBotBtn) {
      this.inviteBotBtn.textContent = "🤖 SUMMONING…";
      this.inviteBotBtn.disabled = true;
    }

    // Safety: clear the pending state if the server never answers.
    window.setTimeout(() => {
      if (this.inviteBotPending) {
        this.inviteBotPending = false;
        this.updateInviteBotState();
      }
    }, 9000);
  }

  /** Enable/disable the invite-bot button based on lobby capacity + pending state. */
  private updateInviteBotState(): void {
    const btn = this.inviteBotBtn;
    if (!btn) return;

    if (this.inviteBotPending) {
      btn.disabled = true;
      return;
    }

    const full = this.players.length >= this.config.maxPlayers;
    btn.disabled = full;
    btn.textContent = full ? "🤖 LOBBY FULL" : "🤖 ADD BOT";
  }

  /**
   * Demo: simulate all players becoming ready, then show connecting overlay.
   */
  private simulateAllReady(): void {
    if (!this.localReady) return; // User unreadied during the delay

    // Set all mock players to ready
    for (const player of this.players) {
      player.ready = true;
    }

    // Update all slot visuals
    const slots = this.root.querySelectorAll(".match-lobby__slot--filled");
    slots.forEach((slot) => {
      slot.classList.add("match-lobby__slot--ready");
      const statusEl = slot.querySelector(".match-lobby__slot-status");
      if (statusEl) statusEl.textContent = "✓ READY";
    });

    // Short pause for visual feedback, then show overlay
    setTimeout(() => {
      if (!this.localReady) return;
      const overlay = new ConnectingOverlay();
      overlay.show("ws://localhost:7777");
    }, 800);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private generateMockPlayers(): MatchLobbyPlayer[] {
    const players: MatchLobbyPlayer[] = [{ name: "washoi_dev", team: "alpha", ready: false, isLocal: true }];

    const mockNames = ["rocketJump99", "fragmaster", "zeroQL"];

    if (this.config.gametype === "duel") {
      players.push({ name: mockNames[0], team: "bravo", ready: true, isLocal: false });
    } else if (this.config.gametype === "team") {
      players.push({ name: mockNames[0], team: "alpha", ready: true, isLocal: false });
      players.push({ name: mockNames[1], team: "bravo", ready: false, isLocal: false });
    } else {
      // FFA — add a few
      players.push({ name: mockNames[0], team: "none", ready: true, isLocal: false });
      players.push({ name: mockNames[1], team: "none", ready: false, isLocal: false });
      players.push({ name: mockNames[2], team: "none", ready: true, isLocal: false });
    }

    return players;
  }

  private hashToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }
}
