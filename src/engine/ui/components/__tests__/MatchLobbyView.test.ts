// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchLobbyInfo } from "../../../../lobby/types";
import { MatchLobbyView } from "../MatchLobbyView";

class FakeLobbyClient {
  private handlers = new Map<string, Array<(message: never) => void>>();

  on(type: string, handler: (message: never) => void): () => void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
    return () =>
      this.handlers.set(
        type,
        (this.handlers.get(type) ?? []).filter((entry) => entry !== handler),
      );
  }

  emit(type: string, message: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(message as never);
  }

  voteMap = vi.fn();
  setReady = vi.fn();
  voteShuffle = vi.fn();
  switchTeam = vi.fn();
  inviteBot = vi.fn();
}

const lobby: MatchLobbyInfo = {
  id: "snd-room",
  gametype: "snd",
  maps: [{ name: "wbomb1", displayName: "Bomb", votes: 0 }],
  players: [
    { id: "host", name: "Host", team: "alpha", ready: false },
    { id: "joiner", name: "Joiner", team: "bravo", ready: false },
  ],
  shareUrl: "https://example.invalid/lobby/snd-room",
  config: { maxPlayers: 2, hasTeams: true },
};

describe("MatchLobbyView roster identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = "";
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  });

  it("marks the actual browser player local and persists that player side", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "joiner");
    document.body.appendChild(view.root);

    const localSlot = view.root.querySelector(".match-lobby__seat--local");
    expect(localSlot?.textContent).toContain("Joiner");

    client.emit("lobby:connect", { serverUrl: "ws://localhost:7777" });
    expect(sessionStorage.getItem("shag.lobby_team")).toBe("bravo");
    view.destroy();
  });

  it("shows a rejoin action for an original seat returning to a running match", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, { ...lobby, activeMatchId: "m_1" }, "host");
    document.body.appendChild(view.root);
    const rejoin = [...view.root.querySelectorAll<HTMLButtonElement>(".match-lobby__actions button")].find((button) =>
      button.textContent?.includes("Rejoin match"),
    );
    expect(rejoin?.hidden).toBe(false);
    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Match in progress");
    client.emit("match:ended", { matchId: "m_1" });
    expect(rejoin?.hidden).toBe(true);
    view.destroy();
  });

  it("removes a departed player by the id carried by the server event", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    document.body.appendChild(view.root);

    client.emit("lobby:player_left", { playerId: "joiner" });

    expect(view.root.textContent).toContain("Host");
    expect(view.root.textContent).not.toContain("Joiner");
    view.destroy();
  });

  it("keeps ready, vote and rematch status tied to lobby messages", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    document.body.appendChild(view.root);

    const map = view.root.querySelector<HTMLButtonElement>("[data-map='wbomb1']");
    map?.click();
    map?.click();
    expect(client.voteMap).toHaveBeenCalledTimes(1); // No server unvote action exists.
    expect(view.root.querySelector("[data-map='wbomb1']")?.getAttribute("aria-pressed")).toBe("true");

    view.root.querySelector<HTMLButtonElement>(".raised-key--ready")?.click();
    expect(client.setReady).toHaveBeenCalledWith("snd-room", true);
    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("You're ready");

    client.emit("lobby:all_ready", {});
    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Match starting");
    client.emit("match:ended", { matchId: "match-1" });
    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Ready up");
    expect(view.root.querySelector("[data-map='wbomb1']")?.getAttribute("aria-pressed")).toBe("false");
    expect(view.root.querySelector(".raised-key--ready .raised-key__label")?.textContent).toBe("Ready");

    view.destroy();
    client.emit("lobby:player_left", { playerId: "joiner" });
    expect(view.root.textContent).toContain("Joiner");
  });

  it("shows a failed server start in the room and re-enables retry controls", () => {
    const client = new FakeLobbyClient();
    const bombRoom = { ...lobby, config: { ...lobby.config, maxPlayers: 10 } };
    const view = new MatchLobbyView("snd", client as never, bombRoom, "host");
    document.body.appendChild(view.root);

    client.emit("lobby:all_ready", {});
    expect(view.root.querySelector<HTMLButtonElement>(".raised-key--ready")?.disabled).toBe(true);
    expect(view.root.querySelector<HTMLButtonElement>("[data-map='wbomb1']")?.disabled).toBe(true);

    client.emit("lobby:error", { error: "Failed to start game server: Server start timed out" });
    const status = view.root.querySelector<HTMLElement>(".match-lobby__status");
    const detail = status?.querySelector<HTMLElement>(".match-lobby__status-sub");
    expect(status?.dataset.error).toBe("true");
    expect(status?.querySelector(".match-lobby__status-head")?.textContent).toBe("Room action failed");
    expect(detail?.textContent).toContain("Server start timed out");
    expect(detail?.getAttribute("role")).toBe("alert");
    expect(view.root.querySelector<HTMLButtonElement>(".raised-key--ready")?.disabled).toBe(false);
    expect(view.root.querySelector<HTMLButtonElement>("[data-map='wbomb1']")?.disabled).toBe(false);
    const switchSide = [...view.root.querySelectorAll<HTMLButtonElement>(".match-lobby__actions button")].find(
      (button) => button.textContent?.includes("Switch"),
    );
    expect(switchSide?.disabled).toBe(false);

    view.root.querySelector<HTMLButtonElement>(".raised-key--ready")?.click();
    expect(status?.dataset.error).toBe("false");
    expect(detail?.getAttribute("role")).toBeNull();
    view.destroy();
  });

  it("can start before it is full once each side has someone, and says so", () => {
    const client = new FakeLobbyClient();
    const bombRoom = {
      ...lobby,
      visibility: "private" as const,
      shareUrl: "/?lobby=snd-room&invite=secret-token",
      config: { maxPlayers: 10, minPlayers: 2, hasTeams: true },
    };
    const view = new MatchLobbyView("snd", client as never, bombRoom, "host");
    document.body.appendChild(view.root);
    const text = (selector: string) => view.root.querySelector(selector)?.textContent;

    expect(text(".match-lobby__meta")).toContain("Up to 5 vs 5 · starts at 2");
    expect(text(".match-lobby__status-kicker")).toBe("Enough to start");
    expect(text(".match-lobby__status-head")).toBe("Ready when you are");
    expect(text(".match-lobby__status-sub")).toBe("0 / 2 ready · 8 seats stay open until it starts");
    expect(text(".raised-key--ready .raised-key__hint")).toBe("0 / 2 ready");
    expect(text(".match-lobby__actions")).toContain("8 seats open");

    // With one side empty the server will not start it, whatever the count
    client.emit("lobby:player_left", { playerId: "joiner" });
    client.emit("lobby:player_joined", { player: { id: "other", name: "Other", team: "alpha", ready: true } });
    expect(text(".match-lobby__status-head")).toBe("Waiting for players");
    expect(text(".match-lobby__status-sub")).toBe("Each side needs a player. Switch sides, or add a bot.");
    view.destroy();
  });

  it("offers no side to switch or shuffle when two players face each other", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("duel", client as never, lobby, "host");
    document.body.appendChild(view.root);

    const keys = [...view.root.querySelectorAll(".match-lobby__actions button")].map((key) => key.textContent ?? "");
    expect(keys.some((text) => text.includes("Switch") || text.includes("Shuffle"))).toBe(false);
    expect(keys.some((text) => text.includes("Add bot"))).toBe(true);
    view.destroy();
  });

  it("seats a player once, however often the server announces them", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    document.body.appendChild(view.root);

    const seated = () =>
      [...view.root.querySelectorAll(".match-lobby__seat-name")].map((el) => el.textContent).filter(Boolean);
    client.emit("lobby:player_joined", { player: { id: "joiner", name: "Joiner", team: "bravo", ready: true } });

    expect(seated().filter((name) => name === "Joiner")).toHaveLength(1);
    expect(view.root.querySelectorAll(".match-lobby__seat--ready")).toHaveLength(1);
    view.destroy();
  });

  it("calls the sides what the lobby server calls them", () => {
    const client = new FakeLobbyClient();
    const named = {
      ...lobby,
      config: { ...lobby.config, maxPlayers: 10, teamNames: { alpha: "Blue Crew", bravo: "Pink Crew" } },
    };
    const view = new MatchLobbyView("snd", client as never, named, "host");
    document.body.appendChild(view.root);

    const heads = [...view.root.querySelectorAll(".match-lobby__team-head")].map((el) => el.textContent ?? "");
    expect(heads.some((text) => text.includes("Blue Crew"))).toBe(true);
    expect(heads.some((text) => text.includes("Pink Crew"))).toBe(true);
    // The host is on alpha, so switching offers the other side by name
    const switchKey = [...view.root.querySelectorAll(".raised-key--act")].find((key) =>
      key.textContent?.includes("Switch"),
    );
    expect(switchKey?.textContent).toContain("Pink Crew");
    view.destroy();
  });

  it("falls back to the game's own pairing when the server names no sides", () => {
    const client = new FakeLobbyClient();
    const unnamed = { ...lobby, config: { ...lobby.config, maxPlayers: 10 } };
    const view = new MatchLobbyView("snd", client as never, unnamed, "host");
    document.body.appendChild(view.root);

    const heads = [...view.root.querySelectorAll(".match-lobby__team-head")].map((el) => el.textContent ?? "");
    expect(heads.some((text) => text.includes("Team Soba"))).toBe(true);
    expect(heads.some((text) => text.includes("Team Udon"))).toBe(true);
    view.destroy();
  });

  it("renders server labels as text", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView(
      "snd",
      client as never,
      {
        ...lobby,
        id: "<img src=x>",
        maps: [{ name: "wdm2", displayName: "<img src=x>", votes: 0 }],
      },
      "host",
    );

    expect(view.root.querySelector("img")).toBeNull();
    expect(view.root.querySelector(".match-lobby__meta b")?.textContent).toContain("<img src=x>");
    view.destroy();
  });

  it("copies the server-provided private invite with its token", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView(
      "snd",
      client as never,
      { ...lobby, visibility: "private", shareUrl: "/?lobby=snd-room&invite=secret-token" },
      "host",
    );
    const copy = view.root.querySelector<HTMLButtonElement>(".match-lobby__invite button");
    copy?.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?lobby=snd-room&invite=secret-token`),
    );
    expect(view.root.querySelector(".match-lobby__invite-url")?.textContent).toContain("invite=secret-token");
    view.destroy();
  });
  it("says a room whose match is running is in progress, not starting", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView(
      "snd",
      client as never,
      {
        ...lobby,
        activeMatchId: "m_running",
        players: [
          { id: "host", name: "Host", team: "alpha", ready: true },
          { id: "joiner", name: "Joiner", team: "bravo", ready: true },
        ],
      },
      "joiner",
    );

    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Match in progress");
    expect(view.root.querySelector(".match-lobby__status-sub")?.textContent).toContain("Rejoin your seat");
    // A ready flag from the match being played says nothing about the next one
    expect([...view.root.querySelectorAll(".match-lobby__seat-state")].map((s) => s.textContent)).toEqual([
      "In match",
      "In match",
    ]);
    view.destroy();
  });

  it("returns to the ready-up screen when that match ends", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, { ...lobby, activeMatchId: "m_running" }, "joiner");
    client.emit("match:ended", { type: "match:ended", matchId: "m_running", exitCode: 0 });

    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Ready up");
    expect([...view.root.querySelectorAll(".match-lobby__seat-state")].map((s) => s.textContent)).toEqual([
      "Not ready",
      "Not ready",
    ]);
    view.destroy();
  });
});

describe("MatchLobbyView status stripes", () => {
  const waiting = (view: MatchLobbyView) =>
    view.root.querySelector<HTMLElement>(".match-lobby__status")?.dataset.waiting;

  it("move while the room waits for a player to join", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, { ...lobby, players: [lobby.players[0]] }, "host");
    expect(waiting(view)).toBe("true");
    view.destroy();
  });

  it("stand still when the room is waiting on you, and move once you are ready", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    expect(waiting(view)).toBe("false");

    view.root.querySelector<HTMLButtonElement>(".raised-key--ready")?.click();
    expect(waiting(view)).toBe("true");
    view.destroy();
  });

  it("move while the server starts, and stop for a match already running", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    client.emit("lobby:all_ready", {});
    expect(waiting(view)).toBe("true");
    view.destroy();

    const running = new MatchLobbyView("snd", client as never, { ...lobby, activeMatchId: "m_1" }, "host");
    expect(waiting(running)).toBe("false");
    running.destroy();
  });
});

describe("MatchLobbyView layout", () => {
  const partsOf = (element: Element | null) => [...(element?.children ?? [])].map((child) => child.classList[0]);

  it("keeps the roster and the map vote in one body, between the status and the actions", () => {
    const view = new MatchLobbyView("snd", new FakeLobbyClient() as never, lobby, "host");
    expect(partsOf(view.root)).toEqual([
      "match-lobby__top",
      "match-lobby__status",
      "match-lobby__body",
      "match-lobby__actions",
    ]);
    expect(partsOf(view.root.querySelector(".match-lobby__body"))).toEqual([
      "match-lobby__roster",
      "match-lobby__vote",
    ]);
    view.destroy();
  });

  it("ends the action row with Rejoin and Ready, the pair the row pushes to the right", () => {
    const view = new MatchLobbyView("snd", new FakeLobbyClient() as never, { ...lobby, activeMatchId: "m_1" }, "host");
    const keys = [...(view.root.querySelector(".match-lobby__actions")?.children ?? [])];
    const [rejoin, ready] = keys.slice(-2);
    expect(rejoin.classList.contains("match-lobby__recover")).toBe(true);
    expect(ready.classList.contains("raised-key--ready")).toBe(true);
    // Every key is a button; in a public room the bot key sits in the span
    // that explains why it is off
    expect(keys.every((key) => key.tagName === "BUTTON" || key.querySelector(":scope > button"))).toBe(true);
    view.destroy();
  });
});

describe("MatchLobbyView bots", () => {
  it("offers bots in a private lobby", () => {
    const client = new FakeLobbyClient();
    // One seat open, so a bot has somewhere to sit
    const room = {
      ...lobby,
      players: [lobby.players[0]],
      visibility: "private" as const,
      shareUrl: "/?lobby=r&invite=t",
    };
    const view = new MatchLobbyView("duel", client as never, room, "host");
    const bot = [...view.root.querySelectorAll<HTMLButtonElement>(".match-lobby__actions button")].find((b) =>
      b.textContent?.includes("Add bot"),
    );
    expect(bot?.disabled).toBe(false);
    view.destroy();
  });

  it("shows the bot key off in a public lobby, and says where bots can be added", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("duel", client as never, { ...lobby, visibility: "public" as const }, "host");
    const gate = view.root.querySelector<HTMLElement>(".match-lobby-view__bot-gate");
    const bot = gate?.querySelector("button");
    expect(bot?.disabled).toBe(true);
    expect(bot?.textContent).toContain("Private lobbies only");
    expect(gate?.title).toBe("Start a private lobby to add bots");
    view.destroy();
  });
});
