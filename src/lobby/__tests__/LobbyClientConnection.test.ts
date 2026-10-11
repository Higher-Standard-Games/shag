/**
 * Connecting, reconnecting and giving up: a client that switches accounts
 * closes one socket and opens another, and no late event from the old socket
 * may speak for the new one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyClient } from "../LobbyClient";

class FakeSocket {
  static OPEN = 1;
  static open: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readyState = 0;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeSocket.open.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  accept(): void {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  FakeSocket.open = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LobbyClient connections", () => {
  it("reports a lost connection as soon as it is closed, not when the socket finishes", () => {
    const client = new LobbyClient();
    const lost: unknown[] = [];
    client.on("_disconnected", (msg) => lost.push(msg));

    void client.connect("ws://lobby.invalid");
    FakeSocket.open[0].accept();
    expect(client.connected).toBe(true);

    client.disconnect();

    expect(client.connected).toBe(false);
    expect(lost).toHaveLength(1);
    expect(FakeSocket.open[0].closed).toBe(true);
  });

  it("ignores a closed socket's late events once another has taken its place", async () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const first = FakeSocket.open[0];
    first.accept();

    client.disconnect();
    const lost: unknown[] = [];
    const messages: unknown[] = [];
    client.on("_disconnected", (msg) => lost.push(msg));
    client.on("welcome", (msg) => messages.push(msg));

    const connecting = client.connect("ws://lobby.invalid");
    const second = FakeSocket.open[1];
    second.accept();
    await connecting;

    // The browser finishes closing the first socket only now
    first.onclose?.({ code: 1006, reason: "late" });
    first.onmessage?.({ data: JSON.stringify({ type: "welcome" }) });

    expect(lost).toHaveLength(0);
    expect(messages).toHaveLength(0);
    expect(client.connected).toBe(true);
  });

  it("gives up on a connection that is never answered", async () => {
    const client = new LobbyClient();
    const connecting = client.connect("ws://lobby.invalid", 5000);
    const expectation = expect(connecting).rejects.toThrow(/did not answer/);

    await vi.advanceTimersByTimeAsync(5001);

    await expectation;
    expect(FakeSocket.open[0].closed).toBe(true);
    expect(client.connected).toBe(false);
  });

  it("correlates leaderboard replies and releases listeners on a disconnect", async () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const query = { gametype: "duel", period: "month" as const, offset: 0, limit: 100 };
    const first = client.requestLeaderboard(query);
    const request = JSON.parse(socket.sent.at(-1)!);
    socket.onmessage?.({ data: JSON.stringify({ type: "leaderboard:page", requestId: "other" }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "leaderboard:page",
        requestId: request.requestId,
        scope: "public",
        entries: [],
        total: 0,
      }),
    });
    await expect(first).resolves.toMatchObject({ requestId: request.requestId, entries: [] });
    const second = client.requestLeaderboard(query);
    const rejected = expect(second).rejects.toThrow("Lobby disconnected");
    client.disconnect();
    await rejected;
  });

  it.each([undefined, "public"])("rejects a private ranking reply with scope %s", async (scope) => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const pending = client.requestLeaderboard({
      gametype: "duel",
      period: "all",
      offset: 0,
      limit: 10,
      scope: "private",
    });
    const request = JSON.parse(socket.sent.at(-1)!);
    const rejected = expect(pending).rejects.toThrow("ranking_scope_mismatch");
    socket.onmessage?.({
      data: JSON.stringify({ type: "leaderboard:page", requestId: request.requestId, scope, entries: [], total: 0 }),
    });
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });

  it("correlates a private seat recovery reply and rejects it on disconnect", async () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const first = client.requestSeatReissue("m_1");
    const request = JSON.parse(socket.sent.at(-1)!);
    expect(request).toMatchObject({ type: "match:seat_reissue", matchId: "m_1" });
    socket.onmessage?.({ data: JSON.stringify({ type: "match:seat_reissued", requestId: "other", matchId: "m_1" }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "match:seat_reissued",
        requestId: request.requestId,
        matchId: "m_1",
        admissionTicket: "private",
      }),
    });
    await expect(first).resolves.toMatchObject({ admissionTicket: "private" });
    const second = client.requestSeatReissue("m_1");
    const rejected = expect(second).rejects.toThrow("Lobby disconnected");
    client.disconnect();
    await rejected;
  });
  it("refuses a records response to a skill request and releases the waiter", async () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const pending = client.requestLeaderboard({
      gametype: "duel",
      period: "all",
      offset: 0,
      limit: 10,
      system: "trueskill",
    });
    const request = JSON.parse(socket.sent.at(-1)!);
    expect(request.system).toBe("trueskill");
    const rejected = expect(pending).rejects.toThrow("ranking_system_mismatch");
    socket.onmessage?.({
      data: JSON.stringify({
        type: "leaderboard:page",
        requestId: request.requestId,
        scope: "public",
        entries: [],
        total: 0,
      }),
    });
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });

  it("correlates featured picks and releases its reply listeners", async () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const first = client.requestFeaturedDemos({ gametype: "duel", limit: 5 });
    const request = JSON.parse(socket.sent.at(-1)!);
    expect(request).toMatchObject({ type: "featured:get", gametype: "duel", limit: 5 });
    socket.onmessage?.({ data: JSON.stringify({ type: "featured:page", requestId: "other", entries: [] }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "featured:page", requestId: request.requestId, entries: [] }) });
    await expect(first).resolves.toMatchObject({ requestId: request.requestId, entries: [] });
    const second = client.requestFeaturedDemos({ limit: 3 });
    const rejected = expect(second).rejects.toThrow("Lobby disconnected");
    client.disconnect();
    await rejected;
  });

  it("still delivers to every listener when one unsubscribes itself on the message", () => {
    const client = new LobbyClient();
    void client.connect("ws://lobby.invalid");
    const socket = FakeSocket.open[0];
    socket.accept();
    const heard: string[] = [];
    // A one-shot waiter registered first, then the room view's own listener:
    // the waiter leaving the list must not make the room view miss the seat.
    client.once("lobby:connect", () => heard.push("waiter"));
    client.on("lobby:connect", () => heard.push("room"));

    socket.onmessage?.({ data: JSON.stringify({ type: "lobby:connect", serverUrl: "ws://game.invalid" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "lobby:connect", serverUrl: "ws://game.invalid" }) });

    expect(heard).toEqual(["waiter", "room", "room"]);
  });
});
