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

    const localSlot = view.root.querySelector(".match-lobby__slot--local");
    expect(localSlot?.textContent).toContain("Joiner");

    client.emit("lobby:connect", { serverUrl: "ws://localhost:7777" });
    expect(sessionStorage.getItem("shag.lobby_team")).toBe("bravo");
  });

  it("removes a departed player by the id carried by the server event", () => {
    const client = new FakeLobbyClient();
    const view = new MatchLobbyView("snd", client as never, lobby, "host");
    document.body.appendChild(view.root);

    client.emit("lobby:player_left", { playerId: "joiner" });

    expect(view.root.textContent).toContain("Host");
    expect(view.root.textContent).not.toContain("Joiner");
  });
});
