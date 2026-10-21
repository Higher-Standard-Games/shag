/**
 * MatchLobbyView — Pre-match lobby component
 *
 * Renders inside the Matchmaking tab content area when a player
 * clicks "FIND MATCH". Shows map vote, player slots, share URL,
 * and READY/LEAVE buttons.
 *
 * The room state and actions come from the lobby server.
 */

import type { LobbyClient } from "../../../lobby/LobbyClient";
import type { MatchLobbyInfo, TeamNames } from "../../../lobby/types";
import { logRejection } from "../../core/AsyncErrors";
import { rememberMapTitle } from "../MapTitles";
import { ConnectingOverlay } from "./ConnectingOverlay";
import { createRaisedKey, setRaisedKeyText } from "./RaisedKey";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface MatchLobbyPlayer {
  /**
   * Lobby player id, which is what every server broadcast addresses.
   *
   * Ready updates key on this, because the server addresses players by id.
   */
  id: string;
  name: string;
  team: "alpha" | "bravo" | "ffa";
  ready: boolean;
  isLocal: boolean;
  /** A bot's level, shown on its seat. */
  botLevel?: string;
}

export interface MatchLobbyMapOption {
  name: string;
  displayName: string;
  votes: number;
  votedByLocal: boolean;
}

export interface MatchLobbyConfig {
  /** Names for the two sides, when the lobby server supplies them. */
  teamNames?: TeamNames;
  gametype: string;
  gametypeLabel: string;
  maxPlayers: number;
  /** Players needed to start: the server's, or `maxPlayers` from an older one. */
  minPlayers: number;
  hasTeams: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// MATCH LOBBY VIEW
// ═══════════════════════════════════════════════════════════════════

export class MatchLobbyView {
  public readonly root: HTMLElement;

  private config: MatchLobbyConfig;
  private lobbyId: string;
  /** Bots can be added only in a private lobby (the lobby server enforces it). */
  private readonly privateLobby: boolean;
  private readonly shareUrl: string;
  private maps: MatchLobbyMapOption[];
  private players: MatchLobbyPlayer[];
  private localReady = false;
  private onLeaveCallback: (() => void) | null = null;
  private lobbyClient: LobbyClient;
  private unsubscribers: (() => void)[] = [];
  private inviteBotBtn: HTMLButtonElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private recoverBtn: HTMLButtonElement | null = null;
  private activeMatchId: string | null = null;
  private switchBtn: HTMLButtonElement | null = null;
  private shuffleBtn: HTMLButtonElement | null = null;
  private inviteBotPending = false;
  private phase: "waiting" | "starting" = "waiting";
  /** True when the room's match was already running as this player walked in. */
  private matchInProgress = false;
  private roomError: string | null = null;
  private timers = new Set<number>();
  private clockTimer: number | null = null;
  private readonly openedAt = Date.now();
  private disposed = false;
  private readonly localPlayerId: string | null;

  constructor(gametype: string, lobbyClient: LobbyClient, lobbyInfo: MatchLobbyInfo, localPlayerId?: string) {
    this.lobbyClient = lobbyClient;
    this.localPlayerId = localPlayerId ?? null;
    this.config = {
      teamNames: lobbyInfo.config.teamNames,
      gametype: lobbyInfo.gametype,
      gametypeLabel: gametype === "duel" ? "DUEL 1v1" : gametype === "snd" ? "S&D" : gametype.toUpperCase(),
      maxPlayers: lobbyInfo.config.maxPlayers,
      minPlayers: Math.min(lobbyInfo.config.minPlayers ?? lobbyInfo.config.maxPlayers, lobbyInfo.config.maxPlayers),
      hasTeams: lobbyInfo.config.hasTeams,
    };
    this.lobbyId = lobbyInfo.id;
    this.privateLobby = lobbyInfo.visibility === "private";
    this.activeMatchId = lobbyInfo.activeMatchId ?? null;
    if (this.activeMatchId) {
      this.phase = "starting";
      this.matchInProgress = true;
    }
    // Older public-room servers advertised a placeholder domain; only private
    // rooms need the server's bearer-token link.
    this.shareUrl =
      lobbyInfo.visibility === "private" ? lobbyInfo.shareUrl : `/?lobby=${encodeURIComponent(lobbyInfo.id)}`;
    this.maps = lobbyInfo.maps.map((m) => ({
      name: m.name,
      displayName: m.displayName,
      votes: m.votes,
      votedByLocal: false,
    }));
    for (const map of lobbyInfo.maps) rememberMapTitle(map.name, map.displayName);
    this.players = lobbyInfo.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team as "alpha" | "bravo" | "ffa",
      ready: p.ready,
      isLocal: p.id === this.localPlayerId,
      ...(p.botLevel ? { botLevel: p.botLevel } : {}),
    }));
    this.localReady = this.players.find((p) => p.isLocal)?.ready ?? false;

    this.root = this.build();
    this.wireLobbyEvents();
  }

  private wireLobbyEvents(): void {
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
        const player = this.players.find((p) => p.id === msg.playerId);
        if (player) {
          player.ready = msg.ready;
          if (player.isLocal) this.localReady = msg.ready;
          this.refreshPlayerSlots();
          this.refreshHeader();
        }
      }),
    );

    // Player joined
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:player_joined", (msg) => {
        const arrival: MatchLobbyPlayer = {
          id: msg.player.id,
          name: msg.player.name,
          team: msg.player.team as "alpha" | "bravo" | "ffa",
          ready: msg.player.ready,
          isLocal: msg.player.id === this.localPlayerId,
          ...(msg.player.botLevel ? { botLevel: msg.player.botLevel } : {}),
        };
        // One seat per id: a join for someone the roster already has replaces
        // them rather than seating them twice.
        const seated = this.players.findIndex((p) => p.id === arrival.id);
        if (seated >= 0) this.players[seated] = arrival;
        else this.players.push(arrival);
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
        this.players = this.players.filter((p) => p.id !== msg.playerId);
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
          setRaisedKeyText(this.inviteBotBtn, "+ Add bot", "No bots available");
          this.inviteBotBtn.disabled = true;
          this.schedule(() => this.updateInviteBotState(), 2500);
        }
      }),
    );

    // All ready → connect
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:all_ready", () => {
        this.roomError = null;
        this.phase = "starting";
        for (const p of this.players) p.ready = true;
        this.refreshPlayerSlots();
        this.refreshStatus();
        this.refreshMapVotes();
        this.updateInviteBotState();
        this.refreshSwitchKey();
        if (this.shuffleBtn) this.shuffleBtn.disabled = true;
      }),
    );

    // A completed match returns this same room to the ready-up screen.
    this.unsubscribers.push(
      this.lobbyClient.on("match:ended", () => {
        this.roomError = null;
        this.activeMatchId = null;
        this.matchInProgress = false;
        if (this.recoverBtn) this.recoverBtn.hidden = true;
        this.phase = "waiting";
        this.localReady = false;
        for (const player of this.players) player.ready = false;
        for (const map of this.maps) {
          map.votes = 0;
          map.votedByLocal = false;
        }
        this.refreshPlayerSlots();
        this.refreshMapVotes();
        this.refreshStatus();
        this.updateInviteBotState();
        this.refreshSwitchKey();
        if (this.shuffleBtn) this.shuffleBtn.disabled = false;
      }),
    );

    this.unsubscribers.push(
      this.lobbyClient.on("lobby:error", (msg) => {
        this.roomError = msg.error;
        this.phase = this.activeMatchId ? "starting" : "waiting";
        this.refreshStatus();
        this.refreshMapVotes();
        this.updateInviteBotState();
        this.refreshSwitchKey();
        if (this.shuffleBtn) this.shuffleBtn.disabled = this.phase === "starting";
      }),
    );

    this.unsubscribers.push(
      this.lobbyClient.on("lobby:connect", (msg) => {
        this.roomError = null;
        this.activeMatchId = msg.matchId ?? null;
        if (this.recoverBtn) this.recoverBtn.hidden = !this.activeMatchId;
        this.phase = "starting";
        this.refreshStatus();
        this.refreshMapVotes();
        this.updateInviteBotState();
        this.refreshSwitchKey();
        if (this.shuffleBtn) this.shuffleBtn.disabled = true;
        // Remember which lobby this match came from — the post-game
        // RETURN TO LOBBY button navigates back to it via ?lobby=<id>
        // (docs/research/single_game_server_lobby.md).
        try {
          sessionStorage.setItem("shag.return_lobby", this.lobbyId);
          // The side you picked here, for the game server to honour on join.
          // Without it `sendJoinGame()` asks for nothing and the server
          // auto-balances, so choosing a team in the lobby did nothing at all.
          const localTeam = this.players.find((p) => p.isLocal)?.team;
          if (localTeam && localTeam !== "ffa") sessionStorage.setItem("shag.lobby_team", localTeam);
          else sessionStorage.removeItem("shag.lobby_team");
        } catch {
          /* storage unavailable — return falls back to a plain reload */
        }
        const overlay = new ConnectingOverlay();
        const matchId = msg.matchId;
        overlay
          .show(
            msg.serverUrl,
            false,
            msg.admissionTicket,
            matchId ? async () => (await this.lobbyClient.requestSeatReissue(matchId)).admissionTicket : undefined,
          )
          .catch(logRejection("MatchLobbyView"));
      }),
    );

    // Teams shuffled
    this.unsubscribers.push(
      this.lobbyClient.on("lobby:teams_shuffled", (msg) => {
        // By id. Matching on name is the same mistake the ready handler made:
        // names are display text, they can collide between bots, and the server
        // addresses players by id everywhere else.
        for (const sp of msg.players) {
          const p = this.players.find((pp) => pp.id === sp.id);
          if (p) p.team = sp.team;
        }
        this.refreshPlayerSlots();
        this.refreshHeader();
        this.refreshSwitchKey();
        if (this.shuffleBtn) {
          this.shuffleBtn.disabled = false;
          setRaisedKeyText(this.shuffleBtn, "⤨ Shuffle", "Mix the teams");
        }
      }),
    );
  }

  onLeave(cb: () => void): void {
    this.onLeaveCallback = cb;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    if (this.clockTimer !== null) window.clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  private schedule(callback: () => void, delay: number): void {
    if (this.disposed) return;
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════

  private build(): HTMLElement {
    const container = document.createElement("div");
    container.className = "match-lobby";
    // Who is here and which map: the part that scrolls when the screen is too short
    const body = document.createElement("div");
    body.className = "match-lobby__body";
    body.append(this.buildRoster(), this.buildVote());
    container.append(this.buildTopBar(), this.buildStatus(), body, this.buildActions());
    this.startClock();
    return container;
  }

  /** Which room this is, and how to bring people into it. */
  private buildTopBar(): HTMLElement {
    const top = document.createElement("header");
    top.className = "match-lobby__top";

    const who = document.createElement("div");
    who.className = "match-lobby__room";
    const chip = document.createElement("span");
    chip.className = "match-lobby__mode-chip";
    chip.textContent = this.config.gametypeLabel;
    const meta = document.createElement("span");
    meta.className = "match-lobby__meta";
    meta.append(this.shape(), document.createElement("br"));
    const room = document.createElement("b");
    room.textContent = this.lobbyId;
    meta.append("Lobby ", room);
    who.append(chip, meta);

    top.append(who, this.buildInvite());
    return top;
  }

  /** "1 vs 1", "Up to 5 vs 5 · starts at 2", "Free for all · 8 players". */
  private shape(): string {
    const { maxPlayers, minPlayers, hasTeams } = this.config;
    if (maxPlayers === 2) return "1 vs 1";
    const starts = minPlayers < maxPlayers ? ` · starts at ${minPlayers}` : "";
    if (hasTeams) {
      const side = Math.ceil(maxPlayers / 2);
      return `${minPlayers < maxPlayers ? "Up to " : ""}${side} vs ${side}${starts}`;
    }
    return `Free for all · ${minPlayers < maxPlayers ? "up to " : ""}${maxPlayers} players${starts}`;
  }

  /**
   * Enough people to start: the server's minimum, and in a team mode someone on
   * each side, since the server will not launch a match with an empty side.
   */
  private enoughToStart(): boolean {
    if (this.players.length < this.config.minPlayers) return false;
    if (!this.config.hasTeams) return true;
    const teams = new Set(this.players.map((p) => p.team));
    return teams.has("alpha") && teams.has("bravo");
  }

  private buildInvite(): HTMLElement {
    const invite = document.createElement("div");
    invite.className = "match-lobby__invite";
    const label = document.createElement("span");
    label.className = "match-lobby__invite-label";
    label.textContent = "Invite";

    // Real, working invite link — the ?lobby= deep link LobbyPanel auto-joins
    // on boot (works on any host, no SPA path-fallback required).
    const inviteUrl = new URL(this.shareUrl || `/?lobby=${encodeURIComponent(this.lobbyId)}`, window.location.origin);
    const url = document.createElement("span");
    url.className = "match-lobby__invite-url";
    url.textContent = `${inviteUrl.host}${inviteUrl.pathname}${inviteUrl.search}`;

    const copy = createRaisedKey({ label: "Copy", variants: ["sm", "cream", "inline"] });
    copy.addEventListener("click", async () => {
      let said = "Copied ✓";
      try {
        await navigator.clipboard.writeText(inviteUrl.href);
      } catch {
        said = "Copy blocked";
      }
      if (this.disposed) return;
      setRaisedKeyText(copy, said);
      this.schedule(() => setRaisedKeyText(copy, "Copy"), 2000);
    });

    invite.append(label, url, copy);
    return invite;
  }

  // ── Status ──

  private buildStatus(): HTMLElement {
    const status = document.createElement("section");
    status.className = "match-lobby__status";
    status.setAttribute("aria-live", "polite");

    const radar = document.createElement("div");
    radar.className = "match-lobby__radar";
    radar.setAttribute("aria-hidden", "true");
    for (const part of [
      "ring",
      "ring match-lobby__radar-ring--inner",
      "sweep",
      "blip",
      "blip match-lobby__radar-blip--late",
    ]) {
      const [name, extra] = part.split(" ");
      const piece = document.createElement("span");
      piece.className = `match-lobby__radar-${name}${extra ? ` ${extra}` : ""}`;
      radar.appendChild(piece);
    }
    const core = document.createElement("span");
    core.className = "match-lobby__radar-core";
    radar.appendChild(core);

    const copy = document.createElement("div");
    const kicker = document.createElement("span");
    kicker.className = "match-lobby__status-kicker";
    kicker.textContent = "Match lobby";
    const head = document.createElement("h2");
    head.className = "match-lobby__status-head";
    const sub = document.createElement("p");
    sub.className = "match-lobby__status-sub";
    copy.append(kicker, head, sub);

    const tally = document.createElement("div");
    tally.className = "match-lobby__status-count";
    const count = document.createElement("div");
    count.className = "match-lobby__count";
    const clock = document.createElement("div");
    clock.className = "match-lobby__clock";
    tally.append(count, clock);

    const bar = document.createElement("div");
    bar.className = "match-lobby__status-bar";
    const fill = document.createElement("span");
    fill.className = "match-lobby__status-fill";
    bar.appendChild(fill);

    status.append(radar, copy, tally, bar);
    this.refreshStatus(status);
    return status;
  }

  /** Seconds in the room, so the wait is visibly real rather than staged. */
  private startClock(): void {
    const tick = () => {
      if (this.disposed) return;
      const clock = this.root?.querySelector<HTMLElement>(".match-lobby__clock");
      if (clock) {
        const seconds = Math.floor((Date.now() - this.openedAt) / 1000);
        clock.textContent = this.matchInProgress
          ? "In match"
          : this.phase === "starting"
            ? "Starting"
            : `Waiting ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      }
      this.clockTimer = window.setTimeout(tick, 1000);
    };
    tick();
  }

  private refreshStatus(status = this.root?.querySelector<HTMLElement>(".match-lobby__status")): void {
    if (!status) return;
    const full = this.players.length >= this.config.maxPlayers;
    const enough = this.enoughToStart();
    status.dataset.phase = this.phase === "starting" ? "starting" : enough ? "ready" : "searching";
    status.dataset.error = String(this.roomError !== null);
    // The bar's stripes move only while the room is waiting on something other
    // than you: a player to join, the rest to ready up, the server to start.
    // When it is your move, they stand still.
    status.dataset.waiting = String(
      !this.roomError && !this.matchInProgress && (this.phase === "starting" || !enough || this.localReady),
    );

    const readyCount = this.players.filter((p) => p.ready).length;
    const waiting = this.players.length - readyCount;
    const open = this.config.maxPlayers - this.players.length;
    const kicker = status.querySelector<HTMLElement>(".match-lobby__status-kicker");
    const head = status.querySelector<HTMLElement>(".match-lobby__status-head");
    const sub = status.querySelector<HTMLElement>(".match-lobby__status-sub");
    const count = status.querySelector<HTMLElement>(".match-lobby__count");
    const fill = status.querySelector<HTMLElement>(".match-lobby__status-fill");
    const core = status.querySelector<HTMLElement>(".match-lobby__radar-core");

    if (kicker) {
      kicker.textContent =
        this.roomError || this.matchInProgress || this.phase === "starting" || !enough
          ? "Match lobby"
          : full
            ? "Lobby full"
            : "Enough to start";
    }
    if (head) {
      head.textContent = this.roomError
        ? "Room action failed"
        : this.matchInProgress
          ? "Match in progress"
          : this.phase === "starting"
            ? "Match starting"
            : !enough
              ? this.config.maxPlayers === 2
                ? "Searching for an opponent"
                : "Waiting for players"
              : this.localReady
                ? "You're ready"
                : full
                  ? "Ready up"
                  : "Ready when you are";
    }
    if (sub) {
      sub.textContent =
        this.roomError ??
        (this.matchInProgress
          ? "This room's match is still running. Rejoin your seat, or wait here for it to end."
          : this.phase === "starting"
            ? "Everyone is ready. Connecting when the game server is available."
            : !enough
              ? this.config.hasTeams && this.players.length >= this.config.minPlayers
                ? this.privateLobby
                  ? "Each side needs a player. Switch sides, or add a bot."
                  : "Each side needs a player. Switch sides, or wait for someone to join."
                : this.privateLobby
                  ? "Share the invite, or add a bot to play right now."
                  : "Share the room's link; it starts as soon as someone joins."
              : this.localReady
                ? `${waiting} player${waiting === 1 ? "" : "s"} still to ready up.`
                : full
                  ? `${readyCount} / ${this.players.length} ready · starts the moment everyone is`
                  : `${readyCount} / ${this.players.length} ready · ${open} seat${open === 1 ? "" : "s"} stay open until it starts`);
      if (this.roomError) sub.setAttribute("role", "alert");
      else sub.removeAttribute("role");
    }
    if (count) {
      count.replaceChildren(document.createTextNode(String(this.players.length)));
      const of = document.createElement("span");
      of.className = "match-lobby__count-of";
      of.textContent = `/${this.config.maxPlayers}`;
      count.appendChild(of);
    }
    if (fill) fill.style.width = `${Math.min(100, (this.players.length / this.config.maxPlayers) * 100)}%`;
    // How many more before it can start; once it can, a call to ready up
    if (core) core.textContent = enough ? "!" : String(Math.max(1, this.config.minPlayers - this.players.length));
    this.refreshReadyKey();
  }

  // ── Roster ──

  private buildRoster(): HTMLElement {
    const roster = document.createElement("section");
    roster.className = "match-lobby__roster";
    roster.setAttribute("aria-label", "Players");
    this.fillRoster(roster);
    return roster;
  }

  private fillRoster(roster = this.root?.querySelector<HTMLElement>(".match-lobby__roster")): void {
    if (!roster) return;
    roster.classList.remove("match-lobby__roster--vs", "match-lobby__roster--ffa", "match-lobby__roster--teams");

    // Two seats face each other across the VS, whether or not the server calls them teams
    if (this.config.maxPlayers === 2) {
      roster.classList.add("match-lobby__roster--vs");
      const mine = this.players.find((p) => p.isLocal) ?? this.players[0];
      const other = this.players.find((p) => p !== mine);
      roster.replaceChildren(this.buildSeat(mine, "you", 0), this.buildVs(), this.buildSeat(other, "them", 1));
      return;
    }

    if (this.config.hasTeams) {
      roster.classList.add("match-lobby__roster--teams");
      // Display names match the in-game teams (esc menu): alpha = Soba, bravo =
      // Udon. Colour is by ALLEGIANCE though — your column is the ally colour
      // and theirs the enemy colour, the same pair the models wear in the map,
      // so a side has one meaning from the lobby through to the firefight.
      const localTeam = this.players.find((p) => p.isLocal)?.team;
      const side = (team: string) => (localTeam && team === localTeam ? "you" : "them");
      const perTeam = Math.ceil(this.config.maxPlayers / 2);
      roster.replaceChildren(
        this.buildTeam(this.teamName("alpha"), "alpha", side("alpha"), perTeam),
        this.buildVs(),
        this.buildTeam(this.teamName("bravo"), "bravo", side("bravo"), perTeam),
      );
      return;
    }

    roster.classList.add("match-lobby__roster--ffa");
    roster.replaceChildren(
      ...Array.from({ length: this.config.maxPlayers }, (_, i) =>
        this.buildSeat(this.players[i], this.players[i]?.isLocal ? "you" : "them", i),
      ),
    );
  }

  private buildTeam(title: string, team: string, side: "you" | "them", seats: number): HTMLElement {
    const column = document.createElement("div");
    column.className = `match-lobby__team match-lobby__team--${side}`;

    const head = document.createElement("div");
    head.className = "match-lobby__team-head";
    const name = document.createElement("span");
    name.textContent = title;
    head.appendChild(name);
    if (side === "you") {
      const mine = document.createElement("span");
      mine.className = "match-lobby__team-mine";
      mine.textContent = "Your side";
      head.appendChild(mine);
    }
    const tally = document.createElement("span");
    tally.className = "match-lobby__team-count";
    const players = this.players.filter((p) => p.team === team);
    tally.textContent = `${players.length}/${seats}`;
    head.appendChild(tally);

    column.appendChild(head);
    for (let i = 0; i < seats; i++) column.appendChild(this.buildSeat(players[i], side, i));
    return column;
  }

  private buildVs(): HTMLElement {
    const vs = document.createElement("div");
    vs.className = "match-lobby__vs";
    vs.textContent = "VS";
    return vs;
  }

  private buildSeat(player: MatchLobbyPlayer | undefined, side: "you" | "them", index: number): HTMLElement {
    const seat = document.createElement("div");
    seat.className = `match-lobby__seat match-lobby__seat--${side}`;
    seat.style.setProperty("--seat", String(index));

    const avatar = document.createElement("span");
    avatar.className = "match-lobby__seat-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "match-lobby__seat-name";
    const state = document.createElement("span");
    state.className = "match-lobby__seat-state";

    if (player) {
      if (player.isLocal) seat.classList.add("match-lobby__seat--local");
      if (player.ready && !this.matchInProgress) seat.classList.add("match-lobby__seat--ready");
      avatar.textContent = player.name.slice(0, 1).toUpperCase();
      name.textContent = player.name;
      // Ready flags belong to the next match; the one being played says so
      state.textContent = this.matchInProgress ? "In match" : player.ready ? "✓ Ready" : "Not ready";
      seat.append(avatar, name);
      if (player.isLocal) {
        const you = document.createElement("span");
        you.className = "match-lobby__seat-tag";
        you.textContent = "You";
        seat.appendChild(you);
      }
      if (player.botLevel) {
        const level = document.createElement("span");
        level.className = "match-lobby__seat-tag match-lobby__seat-tag--bot";
        level.textContent = `Bot · ${player.botLevel[0].toUpperCase()}${player.botLevel.slice(1)}`;
        seat.appendChild(level);
      }
      seat.appendChild(state);
      return seat;
    }

    seat.classList.add("match-lobby__seat--open");
    avatar.textContent = "?";
    name.textContent =
      this.phase === "starting" ? "Empty seat" : this.config.maxPlayers === 2 ? "Waiting for a player" : "Open";
    seat.append(avatar, name, state);
    return seat;
  }

  // ── Map vote ──

  private buildVote(): HTMLElement {
    const vote = document.createElement("section");
    vote.className = "match-lobby__vote";

    const head = document.createElement("div");
    head.className = "match-lobby__vote-head";
    const title = document.createElement("h2");
    title.className = "match-lobby__vote-title";
    title.textContent = "Vote map";
    const hint = document.createElement("span");
    hint.className = "match-lobby__vote-hint";
    hint.textContent = "Most votes wins · ties are random";
    head.append(title, hint);

    const maps = document.createElement("div");
    maps.className = "match-lobby__maps";
    vote.append(head, maps);
    this.fillMaps(maps);
    return vote;
  }

  private fillMaps(maps = this.root?.querySelector<HTMLElement>(".match-lobby__maps")): void {
    if (!maps) return;
    const most = Math.max(0, ...this.maps.map((m) => m.votes));
    maps.replaceChildren(
      ...this.maps.map((map) => {
        const shot = document.createElement("span");
        shot.className = "match-lobby__map-shot";
        const image = document.createElement("span");
        image.className = "match-lobby__map-img";
        // A map with no levelshot installed keeps the gradient underneath
        image.style.setProperty("--map-shot", `url("/data/levelshots/${map.name}.jpg")`);
        const flags = document.createElement("span");
        flags.className = "match-lobby__map-flags";
        if (map.votedByLocal) {
          const yours = document.createElement("span");
          yours.className = "match-lobby__flag match-lobby__flag--yours";
          yours.textContent = "Your vote";
          flags.appendChild(yours);
        }
        if (map.votes > 0 && map.votes === most && this.maps.filter((m) => m.votes === most).length === 1) {
          const leading = document.createElement("span");
          leading.className = "match-lobby__flag match-lobby__flag--leading";
          leading.textContent = "Leading";
          flags.appendChild(leading);
        }
        const votes = document.createElement("span");
        votes.className = "match-lobby__map-votes";
        if (map.votes > 0) {
          votes.textContent = String(map.votes);
          const word = document.createElement("small");
          word.textContent = map.votes === 1 ? "vote" : "votes";
          votes.appendChild(word);
        }
        shot.append(image, flags, votes);

        const info = document.createElement("span");
        info.className = "match-lobby__map-info";
        const name = document.createElement("span");
        name.className = "match-lobby__map-name";
        name.textContent = map.displayName;
        const id = document.createElement("span");
        id.className = "match-lobby__map-id";
        id.textContent = map.name;
        info.append(name, id);

        const card = createRaisedKey({ variants: ["map"], content: [shot, info] });
        card.dataset.map = map.name;
        card.disabled = this.phase === "starting";
        card.setAttribute("aria-label", `Vote for ${map.displayName}`);
        card.setAttribute("aria-pressed", String(map.votedByLocal));
        card.addEventListener("click", () => this.selectMapVote(map));
        return card;
      }),
      ...Array.from({ length: Math.max(0, 3 - this.maps.length) }, () => this.buildEmptyMapSlot()),
    );
  }

  private buildEmptyMapSlot(): HTMLButtonElement {
    const shot = document.createElement("span");
    shot.className = "match-lobby__map-shot match-lobby__map-shot--empty";
    shot.textContent = "—";
    shot.setAttribute("aria-hidden", "true");
    const info = document.createElement("span");
    info.className = "match-lobby__map-info";
    const name = document.createElement("span");
    name.className = "match-lobby__map-name";
    name.textContent = "Unavailable";
    info.appendChild(name);
    const card = createRaisedKey({ variants: ["map", "map-empty"], content: [shot, info] });
    card.disabled = true;
    card.setAttribute("aria-label", "No map available in this slot");
    return card;
  }

  private selectMapVote(map: MatchLobbyMapOption): void {
    if (this.phase === "starting") return;
    // The server supports changing a vote, but not removing it.
    if (map.votedByLocal) return;
    for (const option of this.maps) option.votedByLocal = option === map;
    this.lobbyClient.voteMap(this.lobbyId, map.name);
    this.fillMaps();
  }

  private refreshMapVotes(): void {
    this.fillMaps();
  }

  private refreshPlayerSlots(): void {
    this.fillRoster();
  }

  private refreshHeader(): void {
    this.refreshStatus();
  }

  // ── Actions ──

  private buildActions(): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "match-lobby__actions";

    const leave = createRaisedKey({ label: "← Leave", hint: "Back to play", variants: ["act", "cream", "leave"] });
    leave.addEventListener("click", () => {
      this.destroy();
      this.onLeaveCallback?.();
    });
    actions.appendChild(leave);

    // Add a bot (server feature — needs a live lobby connection). Pressable
    // repeatedly: it re-enables as each bot joins, which is what a 5v5 mode
    // needs when you are testing alone. The lobby balances teams on join, so
    // each bot lands on whichever side is short.
    this.inviteBotBtn = createRaisedKey({ label: "+ Add bot", hint: "Fill a seat", variants: ["act", "cream"] });
    this.inviteBotBtn.addEventListener("click", () => this.requestBot());
    if (this.privateLobby) {
      actions.appendChild(this.inviteBotBtn);
    } else {
      // Shown, but off: a public room is for people. The wrapper carries the
      // explanation, because a browser shows no title over a disabled button.
      const wrap = document.createElement("span");
      wrap.className = "match-lobby-view__bot-gate";
      wrap.title = "Start a private lobby to add bots";
      wrap.appendChild(this.inviteBotBtn);
      actions.appendChild(wrap);
    }
    this.updateInviteBotState();

    // Two seats are two players facing each other: which side is whose changes
    // nothing, so there is nothing to switch or shuffle
    if (this.config.hasTeams && this.config.maxPlayers > 2) {
      // Switch sides. Separate from shuffle, which is random and needs a
      // majority — this affects only you, so it needs neither, and it is the
      // only way to choose which half of a round mode you play.
      this.switchBtn = createRaisedKey({ label: "⇄ Switch", variants: ["act", "cream"] });
      this.switchBtn.addEventListener("click", () => this.lobbyClient.switchTeam(this.lobbyId));
      actions.appendChild(this.switchBtn);
      this.refreshSwitchKey();

      this.shuffleBtn = createRaisedKey({ label: "⤨ Shuffle", hint: "Mix the teams", variants: ["act", "cream"] });
      this.shuffleBtn.addEventListener("click", () => {
        this.lobbyClient.voteShuffle(this.lobbyId);
        if (!this.shuffleBtn) return;
        setRaisedKeyText(this.shuffleBtn, "⤨ Shuffle", "Vote sent");
        this.shuffleBtn.disabled = true;
      });
      actions.appendChild(this.shuffleBtn);
      this.shuffleBtn.disabled = this.phase === "starting";
    }

    this.recoverBtn = createRaisedKey({ label: "Rejoin match", hint: "Unplayed seat", variants: ["act", "cream"] });
    this.recoverBtn.classList.add("match-lobby__recover");
    this.recoverBtn.hidden = !this.activeMatchId;
    this.recoverBtn.addEventListener("click", () => void this.recoverSeat());
    actions.appendChild(this.recoverBtn);

    this.readyBtn = createRaisedKey({ label: "Ready", variants: ["ready"] });
    this.readyBtn.addEventListener("click", () => this.setReady(!this.localReady));
    actions.appendChild(this.readyBtn);
    this.refreshReadyKey();

    return actions;
  }

  private async recoverSeat(): Promise<void> {
    if (!this.activeMatchId || !this.recoverBtn?.isConnected || !this.lobbyClient.connected) return;
    this.recoverBtn.disabled = true;
    setRaisedKeyText(this.recoverBtn, "Rejoin match", "Checking seat…");
    try {
      const { serverUrl, admissionTicket } = await this.lobbyClient.requestSeatReissue(this.activeMatchId);
      if (this.disposed) return;
      await new ConnectingOverlay().show(serverUrl, false, admissionTicket);
    } catch {
      if (!this.disposed) setRaisedKeyText(this.recoverBtn, "Rejoin match", "Unavailable yet or seat already used");
    } finally {
      if (!this.disposed && this.recoverBtn) this.recoverBtn.disabled = false;
    }
  }

  private setReady(ready: boolean): void {
    this.roomError = null;
    this.localReady = ready;
    const localPlayer = this.players.find((p) => p.isLocal);
    if (localPlayer) localPlayer.ready = ready;
    this.fillRoster();
    this.refreshStatus();
    this.lobbyClient.setReady(this.lobbyId, ready);
  }

  private refreshReadyKey(): void {
    const key = this.readyBtn;
    if (!key) return;
    const enough = this.enoughToStart();
    const readyCount = this.players.filter((p) => p.ready).length;
    key.setAttribute("aria-pressed", String(this.localReady));
    key.disabled = this.phase === "starting";
    // Only breathe once the room could start and is waiting on you
    key.classList.toggle("match-lobby__ready--calling", enough && !this.localReady && this.phase !== "starting");
    setRaisedKeyText(
      key,
      this.localReady ? "Ready!" : "Ready",
      this.matchInProgress
        ? "Match running"
        : this.phase === "starting"
          ? "Starting"
          : enough
            ? `${readyCount} / ${this.players.length} ready`
            : this.localReady
              ? "Waiting for the rest"
              : "Click when set",
    );
  }

  private refreshSwitchKey(): void {
    if (!this.switchBtn) return;
    this.switchBtn.disabled = this.phase === "starting";
    const localTeam = this.players.find((p) => p.isLocal)?.team;
    setRaisedKeyText(this.switchBtn, "⇄ Switch", `To ${this.teamName(localTeam === "alpha" ? "bravo" : "alpha")}`);
  }

  /**
   * What this room calls a side. The server may name them; the fallback is the
   * pairing the game itself uses (alpha is Soba, bravo is Udon).
   */
  private teamName(team: "alpha" | "bravo"): string {
    const named = this.config.teamNames?.[team];
    return named ?? (team === "alpha" ? "Team Soba" : "Team Udon");
  }

  /** Ask the server to spawn an AI bot opponent into this lobby. */
  private requestBot(): void {
    if (this.phase === "starting") return;
    if (this.inviteBotPending) return;
    if (this.players.length >= this.config.maxPlayers) return;

    this.inviteBotPending = true;
    this.lobbyClient.inviteBot(this.lobbyId);

    if (this.inviteBotBtn) {
      setRaisedKeyText(this.inviteBotBtn, "+ Add bot", "Summoning…");
      this.inviteBotBtn.disabled = true;
    }

    // Safety: clear the pending state if the server never answers.
    this.schedule(() => {
      if (this.inviteBotPending) {
        this.inviteBotPending = false;
        this.updateInviteBotState();
      }
    }, 9000);
  }

  /** Enable/disable the invite-bot button: private lobbies only, by capacity and pending state. */
  private updateInviteBotState(): void {
    const btn = this.inviteBotBtn;
    if (!btn) return;

    if (!this.privateLobby) {
      btn.disabled = true;
      setRaisedKeyText(btn, "+ Add bot", "Private lobbies only");
      return;
    }

    if (this.inviteBotPending || this.phase === "starting") {
      btn.disabled = true;
      return;
    }

    const open = this.config.maxPlayers - this.players.length;
    btn.disabled = open <= 0;
    setRaisedKeyText(btn, "+ Add bot", open <= 0 ? "Room is full" : `${open} seat${open === 1 ? "" : "s"} open`);
  }
}
