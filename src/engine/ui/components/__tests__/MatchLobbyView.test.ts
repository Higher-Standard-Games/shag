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
    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Ready when you are");
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

    expect(view.root.querySelector(".match-lobby__status-head")?.textContent).toBe("Ready when you are");
    expect([...view.root.querySelectorAll(".match-lobby__seat-state")].map((s) => s.textContent)).toEqual([
      "Not ready",
      "Not ready",
    ]);
    view.destroy();
  });
});
