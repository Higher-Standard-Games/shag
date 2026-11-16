import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { MatchResultReport } from "../../engine/server/network/MatchResultReport";
import { parseCampaign } from "../Campaign";
import { LobbyServer } from "../LobbyServer";
import type { CampaignStateMessage, GametypeInfo, MatchLobbyInfo } from "../types";

const amphi: GametypeInfo = {
  id: "amphi",
  name: "AMPHI",
  description: "1v1 rounds",
  maxPlayers: 2,
  hasTeams: true,
  mapPool: ["washoi_amphi2"],
};
const ffa: GametypeInfo = {
  id: "ffa",
  name: "FFA",
  description: "Free For All",
  maxPlayers: 8,
  minPlayers: 4,
  hasTeams: false,
  mapPool: ["washoi_dm1", "washoi_dm2"],
};

const CAMPAIGN = {
  length: 8,
  missions: [
    {
      id: "cartel-contract",
      map: "washoi_amphi2",
      gametype: "amphi",
      bots: [{ name: "Cartel_King", difficulty: "easy" }],
      models: { ally: "robot", enemy: "cartel" },
    },
    {
      id: "street-riot",
      map: "washoi_dm1",
      gametype: "ffa",
      bots: ["Jolt", "Fizz", "Buzz", "Rush"].map((name) => ({ name, difficulty: "easy" })),
      models: { ally: "robot", enemy: "riotkitty" },
    },
  ],
};

type Message = Record<string, unknown>;
interface FakePlayer {
  id: string;
  name: string;
  lobbyId: string | null;
  status: string;
  authenticated: boolean;
  isBot: boolean;
  accountId: number | null;
  ws: { readyState: number; send: (data: string) => void; close: () => void };
}

interface Internals {
  CAMPAIGN_CONFIG_PATH: string;
  loadCampaign(): void;
  players: Map<string, FakePlayer>;
  gametypes: GametypeInfo[];
  campaignCatalog: ReturnType<typeof parseCampaign>;
  campaignMatches: Map<string, unknown>;
  handleMessage(player: FakePlayer, message: Message): void;
  handleAllReady(lobby: unknown): Promise<void>;
  requestBotForLobby(lobby: unknown, difficulty: string, name?: string): Promise<string>;
  recordCampaignResult(report: MatchResultReport): void;
  lobbies: Map<string, { campaign: unknown; maps: Array<{ name: string }> }>;
  accounts: { close(): void };
  campaign: { close(): void; recordClear(account: number, mission: string, ms: number, frags: number): void };
}

let nextId = 1;
const servers: LobbyServer[] = [];

function makeServer() {
  const spawner = { onServerExit: undefined, spawn: vi.fn(), shutdownAll: vi.fn() };
  const server = new LobbyServer(0, spawner as never);
  const internal = server as unknown as Internals;
  internal.gametypes = [amphi, ffa];
  internal.campaignCatalog = parseCampaign(CAMPAIGN, new Map(internal.gametypes.map((g) => [g.id, g])));
  const invited: Array<{ difficulty: string; name?: string }> = [];
  internal.requestBotForLobby = async (_lobby, difficulty, name) => {
    invited.push({ difficulty, name });
    return name ?? "Bot";
  };
  const starts: unknown[] = [];
  internal.handleAllReady = async (lobby) => {
    starts.push(lobby);
  };
  servers.push(server);
  return { server, internal, invited, starts };
}

function connect(internal: Internals, name: string, options: { bot?: boolean } = {}) {
  const sent: Message[] = [];
  const player: FakePlayer = {
    id: `campaign_${nextId++}`,
    name,
    lobbyId: null,
    status: "online",
    authenticated: true,
    isBot: options.bot === true,
    accountId: options.bot ? null : nextId,
    ws: { readyState: WebSocket.OPEN, send: (data) => sent.push(JSON.parse(data)), close: () => {} },
  };
  internal.players.set(player.id, player);
  return { player, sent };
}

function last(sent: Message[], type: string): Message | undefined {
  return sent.filter((message) => message.type === type).at(-1);
}

/** Create a campaign room for `mission` and seat its bots, ready, as the bot server would. */
function openMission(internal: Internals, host: ReturnType<typeof connect>, missionId: string) {
  internal.handleMessage(host.player, { type: "lobby:create", gametype: "x", campaign: missionId });
  return last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo | undefined;
}

function seatBot(internal: Internals, room: MatchLobbyInfo, name: string) {
  const bot = connect(internal, name, { bot: true });
  const inviteToken = new URL(room.shareUrl, "https://example.invalid").searchParams.get("invite");
  internal.handleMessage(bot.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
  internal.handleMessage(bot.player, { type: "lobby:ready", lobbyId: room.id, ready: true });
  return bot;
}

function report(matchId: string, humans: Array<[number, "win" | "loss" | "draw"]>, frags = 7): MatchResultReport {
  const participants = humans.map(([accountId, outcome], i) => ({ tokenHash: `t${i}`, accountId, outcome, score: 1 }));
  return {
    matchId,
    gametype: "amphi",
    map: "washoi_amphi2",
    endedAt: 200_000,
    participants,
    details: {
      version: 2,
      startedAt: 100_000,
      startedAtTick: 0,
      endedAtTick: 100,
      completion: "normal",
      teams: [],
      seats: participants.map((p) => ({
        seatId: p.tokenHash,
        tokenHash: p.tokenHash,
        team: "soba",
        teamsPlayed: ["soba"],
        joinedAtTick: 0,
        leftAtTick: null,
        disconnected: false,
        forfeited: false,
        lateJoin: false,
        placement: 1,
        stats: {
          version: 1,
          score: 1,
          frags,
          teamFrags: 0,
          deaths: 0,
          damageGiven: 0,
          teamDamageGiven: 0,
          plants: 0,
          defuses: 0,
          activeTimeMs: 0,
        },
      })),
    },
  } as MatchResultReport;
}

afterEach(() => {
  for (const server of servers) {
    const internal = server as unknown as Internals;
    internal.accounts.close();
    internal.campaign.close();
  }
  servers.length = 0;
  vi.restoreAllMocks();
});

describe("campaign rooms", () => {
  it("keeps the campaign's bot names from accounts, from the file it reads", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "campaign-")), "campaign.json");
    writeFileSync(file, JSON.stringify(CAMPAIGN));
    const { server, internal } = makeServer();
    internal.CAMPAIGN_CONFIG_PATH = file;
    internal.loadCampaign();
    const name = CAMPAIGN.missions[0].bots[0].name;
    expect(server.isCampaignBotName(name.toUpperCase())).toBe(true);
    expect(server.isCampaignBotName("Player_7")).toBe(false);
  });

  it("sends the campaign with unlock state on request", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    internal.handleMessage(host.player, { type: "campaign:get" });
    const state = last(host.sent, "campaign:state") as unknown as CampaignStateMessage;
    expect(state.length).toBe(8);
    expect(state.missions.map((m) => m.id)).toEqual(["cartel-contract", "street-riot"]);
    expect(state.unlockedThrough).toBe(1);
    expect(state.clears).toEqual([]);
  });

  it("opens a private one-map room for an unlocked mission and invites its bots by name", async () => {
    const { internal, invited } = makeServer();
    const host = connect(internal, "Host");
    const room = openMission(internal, host, "cartel-contract");
    expect(room?.visibility).toBe("private");
    expect(room?.gametype).toBe("amphi");
    expect(room?.maps.map((m) => m.name)).toEqual(["washoi_amphi2"]);
    expect(room?.campaign).toEqual({ missionId: "cartel-contract", models: { ally: "robot", enemy: "cartel" } });
    expect(room?.players[0].team).toBe("alpha");
    await vi.waitFor(() => expect(invited).toEqual([{ difficulty: "easy", name: "Cartel_King" }]));
  });

  it("refuses a locked mission", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    expect(openMission(internal, host, "street-riot")).toBeUndefined();
    expect(last(host.sent, "lobby:error")?.error).toBe("Mission 2 is not unlocked for you yet.");
    expect(host.player.lobbyId).toBeNull();
  });

  it("starts only when every mission bot is seated and the player is ready", () => {
    const { internal, starts } = makeServer();
    internal.campaign.recordClear(0, "cartel-contract", 1000, 1);
    const host = connect(internal, "Host");
    internal.campaign.recordClear(host.player.accountId!, "cartel-contract", 1000, 1);
    const room = openMission(internal, host, "street-riot")!;
    internal.handleMessage(host.player, { type: "lobby:ready", lobbyId: room.id, ready: true });
    for (const name of ["Jolt", "Fizz", "Buzz"]) seatBot(internal, room, name);
    // Four players are enough for FFA, but the mission has four bots
    expect(starts).toHaveLength(0);
    seatBot(internal, room, "Rush");
    expect(starts).toHaveLength(1);
  });

  it("puts enemy bots on the other side, and keeps strangers and extra bots out", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    const room = openMission(internal, host, "cartel-contract")!;
    const stray = seatBot(internal, room, "NotInMission");
    expect(stray.player.lobbyId).toBeNull();
    const king = seatBot(internal, room, "Cartel_King");
    expect(king.player.lobbyId).toBe(room.id);
    expect(last(host.sent, "lobby:player_joined")?.player).toMatchObject({ name: "Cartel_King", team: "bravo" });
  });

  it("refuses humans who have not unlocked the mission, and a mission with no free seat", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    internal.campaign.recordClear(host.player.accountId!, "cartel-contract", 1000, 1);
    const room = openMission(internal, host, "street-riot")!;
    const inviteToken = new URL(room.shareUrl, "https://example.invalid").searchParams.get("invite");
    const friend = connect(internal, "Friend");
    internal.handleMessage(friend.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
    expect(last(friend.sent, "lobby:error")?.error).toBe("Mission 2 is not unlocked for you yet.");
    internal.campaign.recordClear(friend.player.accountId!, "cartel-contract", 1000, 1);
    internal.handleMessage(friend.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
    expect(friend.player.lobbyId).toBe(room.id);

    const duelist = connect(internal, "Duelist");
    const amphiRoom = openMission(internal, duelist, "cartel-contract")!;
    const second = connect(internal, "Second");
    internal.handleMessage(second.player, {
      type: "lobby:join",
      lobbyId: amphiRoom.id,
      inviteToken: new URL(amphiRoom.shareUrl, "https://example.invalid").searchParams.get("invite"),
    });
    expect(last(second.sent, "lobby:error")?.error).toBe("That mission has no seat for another player.");
  });

  it("clears the mission for the humans of a won match and sends the new progress", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    const mission = internal.campaignCatalog.missions[0];
    internal.campaignMatches.set("m1", mission);
    internal.recordCampaignResult(report("m1", [[host.player.accountId!, "win"]], 9));
    const state = last(host.sent, "campaign:state") as unknown as CampaignStateMessage;
    expect(state.unlockedThrough).toBe(2);
    expect(state.clears).toEqual([
      { missionId: "cartel-contract", clearedAt: expect.any(Number), bestTimeMs: 100_000, bestFrags: 9 },
    ]);
  });

  it("clears nothing on a loss, a draw, or a match that was not a campaign match", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    internal.campaignMatches.set("m1", internal.campaignCatalog.missions[0]);
    internal.recordCampaignResult(report("m1", [[host.player.accountId!, "loss"]]));
    internal.recordCampaignResult(report("m1", [[host.player.accountId!, "draw"]]));
    internal.recordCampaignResult(report("other", [[host.player.accountId!, "win"]]));
    expect(last(host.sent, "campaign:state")).toBeUndefined();
  });

  it("ignores map votes, side switches, shuffles and extra bots in a campaign room", async () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    const room = openMission(internal, host, "cartel-contract")!;
    internal.handleMessage(host.player, { type: "lobby:vote_map", lobbyId: room.id, map: "washoi_amphi2" });
    internal.handleMessage(host.player, { type: "lobby:switch_team", lobbyId: room.id });
    internal.handleMessage(host.player, { type: "lobby:vote_shuffle", lobbyId: room.id });
    expect(last(host.sent, "lobby:votes_updated")).toBeUndefined();
    expect(last(host.sent, "lobby:teams_shuffled")).toBeUndefined();
    internal.handleMessage(host.player, { type: "lobby:invite_bot", lobbyId: room.id });
    await vi.waitFor(() =>
      expect(last(host.sent, "lobby:bot_invite_failed")?.error).toBe("The mission brings its own bots."),
    );
  });

  it("lists a campaign demo only in its own players' demos", () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    const other = connect(internal, "Other");
    const demo = (filename: string, campaign?: string) => ({
      filename,
      map: "washoi_amphi2",
      mapDisplayName: "Amphi2",
      gametype: "amphi",
      private: true,
      ...(campaign ? { campaign } : {}),
      players: ["Host", "Cartel_King"],
      durationMs: 600_000,
      date: 1,
      sizeMB: 1,
    });
    const demos = internal as unknown as {
      _demoCache: unknown[];
      _demoOwnership: Map<string, Set<number>>;
    };
    demos._demoCache = [demo("campaign.shagdemo", "cartel-contract"), demo("room.shagdemo")];
    demos._demoOwnership = new Map([
      ["campaign.shagdemo", new Set([host.player.accountId!])],
      ["room.shagdemo", new Set([host.player.accountId!])],
    ]);
    const list = (who: ReturnType<typeof connect>, scope: string) => {
      internal.handleMessage(who.player, { type: "demos:list", scope, limit: 64 });
      const demos = (last(who.sent, "demos:list_response")?.demos ?? []) as Array<{ filename: string }>;
      return demos.map((d) => d.filename);
    };
    expect(list(other, "latest")).toEqual(["room.shagdemo"]);
    expect(list(host, "latest")).toEqual(["room.shagdemo"]);
    expect(list(host, "yours")).toEqual(["campaign.shagdemo", "room.shagdemo"]);
    expect(list(other, "yours")).toEqual([]);
  });

  it("never lets anyone drop into a running campaign match", async () => {
    const { internal } = makeServer();
    const host = connect(internal, "Host");
    const room = openMission(internal, host, "cartel-contract")!;
    const lobby = internal.lobbies.get(room.id) as unknown as {
      state: string;
      activeMatchId: string;
      serverUrl: string;
      players: Map<string, unknown>;
    };
    lobby.state = "playing";
    lobby.activeMatchId = "m1";
    lobby.serverUrl = "ws://localhost:7777";
    lobby.players.clear();
    const friend = connect(internal, "Friend");
    internal.handleMessage(friend.player, {
      type: "lobby:join",
      lobbyId: room.id,
      inviteToken: new URL(room.shareUrl, "https://example.invalid").searchParams.get("invite"),
    });
    await vi.waitFor(() => expect(last(friend.sent, "lobby:error")?.error).toBe("This match is already in progress."));
    expect(friend.player.lobbyId).toBeNull();
  });
});
