import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { selectFeaturedDemos } from "../FeaturedDemos";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import type { DemoInfo } from "../types";

const NOW = Date.UTC(2026, 8, 21, 12);
const DAY = 24 * 60 * 60 * 1000;

function demo(filename: string, overrides: Partial<DemoInfo> = {}): DemoInfo {
  return {
    filename,
    map: "wdm2",
    mapDisplayName: "Proving Grounds",
    gametype: "duel",
    players: ["One", "Two"],
    durationMs: 150_000,
    date: NOW - DAY,
    sizeMB: 1,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("featured demo selection", () => {
  it("selects only recent substantial multiplayer recordings, newest first", () => {
    const picks = selectFeaturedDemos(
      [
        demo("old", { date: NOW - 7 * DAY - 1 }),
        demo("short", { durationMs: 119_999 }),
        demo("solo", { players: ["One"] }),
        demo("duplicate-name", { players: ["One", "one"] }),
        demo("future", { date: NOW + 1 }),
        demo("private", { private: true, date: NOW }),
        demo("earlier", { date: NOW - 2 * DAY }),
        demo("latest", { date: NOW - DAY }),
        demo("latest", { date: NOW - DAY }),
      ],
      { limit: 10 },
      NOW,
    );
    expect(picks.map((pick) => pick.demo.filename)).toEqual(["latest", "earlier"]);
    expect(picks.map((pick) => pick.rank)).toEqual([1, 2]);
    expect(picks[0].reason).toBe("Recent multiplayer recording");
  });

  it("normalizes deathmatch to FFA and bounds a mode/map selection", () => {
    const archive = [
      demo("ffa", { gametype: "deathmatch", map: "wdm7", date: NOW - DAY }),
      demo("duel", { gametype: "duel", map: "wdm2", date: NOW - 2 * DAY }),
      demo("more-ffa", { gametype: "ffa", map: "wdm7", date: NOW - 3 * DAY }),
    ];
    expect(selectFeaturedDemos(archive, { gametype: "ffa", map: "wdm7", limit: 1 }, NOW)).toMatchObject([
      { demo: { filename: "ffa" }, rank: 1 },
    ]);
    expect(selectFeaturedDemos(archive, { gametype: "amphi", limit: 10 }, NOW)).toEqual([]);
  });

  it("serves a bounded authenticated page and rejects malformed queries", () => {
    const lobby = new LobbyServer();
    const sent: Array<Record<string, unknown>> = [];
    const player = {
      id: "p_1",
      authenticated: true,
      ws: { readyState: WebSocket.OPEN, send: (raw: string) => sent.push(JSON.parse(raw)) },
    };
    const internal = lobby as unknown as {
      _demoCache: DemoInfo[];
      handleMessage: (connected: typeof player, message: object) => void;
    };
    internal._demoCache = [demo("featured", { date: Date.now() - 60_000 })];
    internal.handleMessage(player, { type: "featured:get", requestId: "one", gametype: "duel", limit: 5 });
    expect(sent.at(-1)).toMatchObject({
      type: "featured:page",
      requestId: "one",
      selection: "recent_multiplayer_week",
      entries: [{ demo: { filename: "featured" }, rank: 1 }],
    });
    internal.handleMessage(player, { type: "featured:get", requestId: "bad", limit: 11 });
    expect(sent.at(-1)).toEqual({ type: "featured:error", requestId: "bad", reason: "invalid_query" });
    internal.handleMessage({ ...player, authenticated: false }, { type: "featured:get", requestId: "no", limit: 1 });
    expect(sent.at(-1)).toMatchObject({ type: "lobby:error" });
  });

  it("advertises and serves featured picks over an authenticated lobby socket", async () => {
    // The fixture cache below replaces the scan. Scanning this machine's demo
    // folder would only make the test as slow as that folder is large.
    vi.spyOn(LobbyServer.prototype as unknown as { _scanDemos(): void }, "_scanDemos").mockImplementation(() => {});
    const lobby = new LobbyServer(0, new GameServerSpawner());
    await lobby.start();
    const internal = lobby as unknown as { _demoCache: DemoInfo[]; wss: { address(): { port: number } } };
    internal._demoCache = [demo("server-pick", { date: Date.now() - 60_000 })];
    const socket = new WebSocket(`ws://127.0.0.1:${internal.wss.address().port}`);
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      await once(socket, "open");
      socket.send(JSON.stringify({ type: "auth" }));
      await expect
        .poll(() => messages.find((message) => message.type === "welcome"), { timeout: 5000 })
        .toMatchObject({ features: { featuredDemos: true } });
      socket.send(JSON.stringify({ type: "featured:get", requestId: "wire", limit: 5 }));
      await expect
        .poll(() => messages.find((message) => message.type === "featured:page"), { timeout: 5000 })
        .toMatchObject({ requestId: "wire", entries: [{ demo: { filename: "server-pick" } }] });
    } finally {
      socket.close();
      await lobby.stop();
    }
  });
});
