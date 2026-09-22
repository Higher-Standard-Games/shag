/** Installed-map integration: lobby room -> child -> ticketed game -> ranking read. */
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { MessageType } from "../../engine/network/protocol/BinaryProtocol";
import { MessageCodec } from "../../engine/network/protocol/MessageCodec";
import { ProtocolTestClient } from "../../games/fps/server/__tests__/_protocolTestClient";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import type { GametypeInfo, MatchLobbyInfo } from "../types";

async function unusedPort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

class LobbyPeer {
  private readonly messages: Array<Record<string, unknown>> = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => this.messages.push(JSON.parse(raw.toString())));
  }

  static async connect(port: number): Promise<LobbyPeer> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const peer = new LobbyPeer(socket);
    await once(socket, "open");
    return peer;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  async waitFor(type: string, predicate: (message: Record<string, unknown>) => boolean = () => true, timeout = 5000) {
    return vi.waitFor(
      () => {
        const message = this.messages.find((candidate) => candidate.type === type && predicate(candidate));
        if (!message) throw new Error(`Waiting for ${type}; saw ${this.messages.map((item) => item.type).join(", ")}`);
        return message;
      },
      { timeout, interval: 50 },
    );
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, "close");
    this.socket.close();
    await closed;
  }
}

const hasInstalledWdm2 = fs.existsSync(path.join(process.cwd(), "public", "data", "map_wdm2.pk3"));

describe("installed-map room to ranking", () => {
  it.skipIf(!hasInstalledWdm2)(
    "launches wdm2 from a real lobby room and serves its result to both accounts",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-room-ranking-"));
      const target = path.resolve(dir);
      const root = path.resolve(os.tmpdir());
      if (!target.startsWith(`${root}${path.sep}`) || !path.basename(target).startsWith("shag-room-ranking-"))
        throw new Error(`Unsafe cleanup target: ${target}`);
      const accounts = PlayerStore.open(dir);
      const results = MatchResultStore.open(dir);
      const members = [accounts.create(), accounts.create()];
      const spawner = new GameServerSpawner(await unusedPort());
      const lobby = new LobbyServer(0, spawner, { players: accounts, results });
      const peers: LobbyPeer[] = [];
      const gameClients: ProtocolTestClient[] = [];
      const priorTime = process.env.SHAG_TIMELIMIT;
      const priorWarmup = process.env.SHAG_WARMUP;
      try {
        process.env.SHAG_TIMELIMIT = "1s";
        process.env.SHAG_WARMUP = "10s";
        await lobby.start();
        // Keep the real room/server path but make this installed-map smoke two-seat and deterministic.
        const internal = lobby as unknown as { gametypes: GametypeInfo[]; wss: { address(): { port: number } } };
        const ffa = internal.gametypes.find((mode) => mode.id === "ffa")!;
        expect(ffa.mapPool).toContain("wdm2");
        ffa.mapPool = ["wdm2"];
        ffa.maxPlayers = 2;
        const lobbyPort = internal.wss.address().port;
        for (const member of members) {
          const peer = await LobbyPeer.connect(lobbyPort);
          peers.push(peer);
          peer.send({ type: "auth", key: member.key });
          expect(await peer.waitFor("welcome")).toMatchObject({ identity: { id: String(member.account.id) } });
        }
        const [first, second] = peers;
        first.send({ type: "lobby:create", gametype: "ffa" });
        const room = (await first.waitFor("lobby:created")).lobby as MatchLobbyInfo;
        expect(room.maps).toMatchObject([{ name: "wdm2" }]);
        second.send({ type: "lobby:join", lobbyId: room.id });
        expect(await second.waitFor("lobby:created")).toMatchObject({ lobby: { id: room.id } });
        first.send({ type: "lobby:ready", lobbyId: room.id, ready: true });
        second.send({ type: "lobby:ready", lobbyId: room.id, ready: true });
        const [firstConnect, secondConnect] = await Promise.all([
          first.waitFor("lobby:connect", () => true, 45_000),
          second.waitFor("lobby:connect", () => true, 45_000),
        ]);
        expect(firstConnect).toMatchObject({ map: "wdm2", gametype: "ffa" });
        expect(secondConnect).toMatchObject({ matchId: firstConnect.matchId, serverUrl: firstConnect.serverUrl });
        expect(firstConnect.admissionTicket).not.toBe(secondConnect.admissionTicket);
        for (const [handoff, name] of [
          [firstConnect, "One"],
          [secondConnect, "Two"],
        ] as const) {
          const port = Number(new URL(String(handoff.serverUrl)).port);
          const client = await ProtocolTestClient.connect(port);
          gameClients.push(client);
          client.send(MessageCodec.encodeJoin(name, false, String(handoff.admissionTicket)));
          await client.waitForType(MessageType.JoinAccept);
          client.send(MessageCodec.encodeJoinGame("ffa"));
        }
        for (const client of gameClients) client.send(MessageCodec.encodeReady());
        await vi.waitFor(
          () => {
            expect(results.leaderboard({ gametype: "ffa", period: "all", offset: 0, limit: 10 }).total).toBe(2);
          },
          { timeout: 30_000, interval: 100 },
        );
        for (const [index, peer] of peers.entries()) {
          peer.send({
            type: "leaderboard:get",
            requestId: `rank_${index}`,
            gametype: "ffa",
            period: "all",
            offset: 0,
            limit: 10,
          });
          const page = await peer.waitFor("leaderboard:page", (message) => message.requestId === `rank_${index}`);
          expect(page).toMatchObject({ total: 2, localPlayerRank: 1 });
          expect((page.entries as Array<{ playerId: string; draws: number }>).map((entry) => entry.playerId)).toEqual(
            members.map((member) => String(member.account.id)),
          );
          expect((page.entries as Array<{ draws: number }>).every((entry) => entry.draws === 1)).toBe(true);
        }
        // The dedicated server gives human clients a two-minute PostGame grace.
        // Leaving after the verified result exercises the normal empty-server return promptly.
        await Promise.all(gameClients.map((client) => client.close()));
        gameClients.length = 0;
        expect(
          await first.waitFor("match:ended", (message) => message.matchId === firstConnect.matchId, 20_000),
        ).toMatchObject({ matchId: firstConnect.matchId });
      } finally {
        if (priorTime === undefined) delete process.env.SHAG_TIMELIMIT;
        else process.env.SHAG_TIMELIMIT = priorTime;
        if (priorWarmup === undefined) delete process.env.SHAG_WARMUP;
        else process.env.SHAG_WARMUP = priorWarmup;
        await Promise.all(gameClients.map((client) => client.close()));
        await Promise.all(peers.map((peer) => peer.close()));
        await lobby.stop();
        results.close();
        accounts.close();
        fs.rmSync(target, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
