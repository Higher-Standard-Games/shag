/**
 * Lobby fair play: bans refuse logins with a reason and an appeal route, a
 * ranked restriction keeps an account out of public rooms and the queue but
 * not private rooms, and players can report each other for review.
 *
 * Fake-ws harness as in LobbyAuth.test.ts: no port is bound, sent JSON is captured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { FairPlayStore } from "../FairPlayStore";
import { BANNED_CLOSE_CODE, LobbyServer } from "../LobbyServer";
import type { GametypeInfo } from "../types";

const duel: GametypeInfo = {
  id: "duel",
  name: "Duel",
  description: "1v1",
  maxPlayers: 2,
  hasTeams: true,
  mapPool: ["wdm2"],
};

type Message = Record<string, unknown>;
let nextId = 1;
const servers: LobbyServer[] = [];

// biome-ignore lint/suspicious/noExplicitAny: reaches private handlers
function makeServer(): { server: any; fairPlay: FairPlayStore } {
  const fairPlay = new FairPlayStore(":memory:");
  const spawner = { onServerExit: undefined, spawn: vi.fn(), shutdownAll: vi.fn() };
  const server = new LobbyServer(0, spawner as never, { fairPlay, appealContact: "write to appeals" });
  (server as unknown as { gametypes: GametypeInfo[] }).gametypes = [duel];
  servers.push(server);
  return { server, fairPlay };
}

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function connect(server: any, address = "198.51.100.7"): { player: any; sent: Message[] } {
  const sent: Message[] = [];
  const player = {
    id: `fp_${nextId++}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)), close: vi.fn() },
    name: "",
    status: "online",
    lobbyId: null,
    authenticated: false,
    address,
    isBot: false,
    accountId: null,
  };
  server.players.set(player.id, player);
  return { player, sent };
}

const ofType = (sent: Message[], type: string) => sent.filter((m) => m.type === type);

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function logIn(server: any, address?: string) {
  const conn = connect(server, address);
  server.handleAuth(conn.player, { type: "auth" });
  const key = ofType(conn.sent, "welcome")[0]?.key as string;
  return { ...conn, key, accountId: conn.player.accountId as number };
}

afterEach(() => {
  for (const server of servers) (server as unknown as { accounts: { close: () => void } }).accounts.close();
  servers.length = 0;
  vi.restoreAllMocks();
});

describe("lobby fair play", () => {
  it("refuses a banned account's login with the reason, the end and the appeal route", () => {
    const { server, fairPlay } = makeServer();
    const first = logIn(server);
    fairPlay.addSanction(first.accountId, "ban", "Aimbot (reviewed demo)", 7 * 86_400_000, "test");
    const again = connect(server);
    server.handleAuth(again.player, { type: "auth", key: first.key });
    const refusal = ofType(again.sent, "auth:error")[0];
    expect(refusal).toMatchObject({ code: "banned", reason: "Aimbot (reviewed demo)", appeal: "write to appeals" });
    expect(refusal.until).toEqual(expect.any(Number));
    expect(again.player.authenticated).toBe(false);
    expect(again.player.ws.close).toHaveBeenCalledWith(BANNED_CLOSE_CODE, "Banned");
  });

  it("lets a lifted ban's account back in", () => {
    const { server, fairPlay } = makeServer();
    const first = logIn(server);
    const ban = fairPlay.addSanction(first.accountId, "ban", "Mistake", null, "test");
    fairPlay.liftSanction(ban.id);
    const again = connect(server);
    server.handleAuth(again.player, { type: "auth", key: first.key });
    expect(ofType(again.sent, "welcome")).toHaveLength(1);
  });

  it("refuses new accounts from a banned address", () => {
    const { server, fairPlay } = makeServer();
    fairPlay.banAddress("203.0.113.9", "Ban evasion", 86_400_000);
    const conn = connect(server, "203.0.113.9");
    server.handleAuth(conn.player, { type: "auth" });
    expect(ofType(conn.sent, "auth:error")[0]).toMatchObject({ code: "banned", reason: "Ban evasion" });
    expect(ofType(conn.sent, "welcome")).toHaveLength(0);
  });

  it("closes a connected account once it is banned", () => {
    const { server, fairPlay } = makeServer();
    const player = logIn(server);
    fairPlay.addSanction(player.accountId, "ban", "Wallhack", null, "test");
    server.enforceBans();
    expect(ofType(player.sent, "auth:error")[0]).toMatchObject({ code: "banned", reason: "Wallhack" });
    expect(player.player.ws.close).toHaveBeenCalledWith(BANNED_CLOSE_CODE, "Banned");
  });

  it("keeps a restricted account out of public rooms and the queue, not private rooms", () => {
    const { server, fairPlay } = makeServer();
    const player = logIn(server);
    fairPlay.addSanction(player.accountId, "ranked", "Boosting", null, "test");
    server.handleMessage(player.player, { type: "lobby:create", gametype: "duel", visibility: "public" });
    server.handleMessage(player.player, { type: "queue:join", gametype: "duel" });
    const errors = ofType(player.sent, "lobby:error").map((m) => String(m.error));
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toContain("Boosting");
    expect(player.player.lobbyId).toBeNull();
    server.handleMessage(player.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    expect(ofType(player.sent, "lobby:created")).toHaveLength(1);
  });

  it("keeps a report about an online player for review, once", () => {
    const { server, fairPlay } = makeServer();
    const reporter = logIn(server);
    const reported = logIn(server, "198.51.100.8");
    const report = {
      type: "report:player",
      requestId: "r1",
      playerId: reported.player.id,
      reason: "snaps through walls",
    };
    server.handleMessage(reporter.player, report);
    server.handleMessage(reporter.player, { ...report, requestId: "r2" });
    expect(ofType(reporter.sent, "report:result")).toEqual([
      { type: "report:result", requestId: "r1", ok: true },
      { type: "report:result", requestId: "r2", ok: false, code: "duplicate" },
    ]);
    expect(fairPlay.openReports()).toMatchObject([
      { reporterId: reporter.accountId, reportedId: reported.accountId, reason: "snaps through walls" },
    ]);
  });

  it("refuses a report about nobody or about oneself", () => {
    const { server } = makeServer();
    const reporter = logIn(server);
    server.handleMessage(reporter.player, { type: "report:player", requestId: "a", playerId: "nobody" });
    server.handleMessage(reporter.player, { type: "report:player", requestId: "b", accountId: reporter.accountId });
    expect(ofType(reporter.sent, "report:result").map((m) => m.code)).toEqual(["unknown_player", "invalid"]);
  });
});
