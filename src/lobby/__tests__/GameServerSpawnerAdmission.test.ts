import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { resultReport } from "../../engine/server/network/__tests__/_resultReport";
import { type MatchResultReport, signMatchResult } from "../../engine/server/network/MatchResultReport";
import { GameServerSpawner } from "../GameServerSpawner";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ on: vi.fn() })),
}));

describe("GameServerSpawner admission handoff", () => {
  it("passes only ticket hashes to the child and keeps tickets for private delivery", async () => {
    const spawner = new GameServerSpawner(18777);
    vi.spyOn(spawner as never, "waitForReady").mockResolvedValue(undefined);
    const server = await spawner.spawn({
      map: "wdm2",
      gametype: "duel",
      private: true,
      admissionSeats: [
        { lobbyPlayerId: "human", accountId: 7, name: "Player", team: "alpha", isBot: false },
        { lobbyPlayerId: "bot", accountId: null, name: "Bot", team: "bravo", isBot: true },
      ],
    });

    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2];
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain("--private-match");
    const rawManifest = options?.env?.SHAG_MATCH_ADMISSION;
    expect(rawManifest).toBeTruthy();
    const manifest = JSON.parse(rawManifest as string);
    expect(manifest.matchId).toBe(server.matchId);
    expect(manifest.grants).toEqual([
      expect.objectContaining({ accountId: 7, name: "Player", team: "alpha", isBot: false }),
      expect.objectContaining({
        accountId: 7,
        name: "Player",
        team: "alpha",
        isBot: false,
        notBefore: expect.any(Number),
      }),
      expect.objectContaining({ accountId: null, name: "Bot", team: "bravo", isBot: true }),
    ]);
    expect(server.admissionTickets?.size).toBe(2);
    expect(rawManifest).not.toContain(server.admissionTickets?.get("human"));
    expect(rawManifest).not.toContain(server.admissionTickets?.get("bot"));
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).not.toContain(rawManifest);
    expect(spawner.reissueUnclaimedSeat(server.matchId, 8, manifest.expiresAt + 1)).toBeNull();
    expect(spawner.reissueUnclaimedSeat(server.matchId, 7, manifest.expiresAt - 1)).toBeNull();
    const recovered = spawner.reissueUnclaimedSeat(server.matchId, 7, manifest.expiresAt + 1);
    expect(recovered?.serverUrl).toBe(server.url);
    expect(rawManifest).not.toContain(recovered?.admissionTicket);
    expect(spawner.reissueUnclaimedSeat(server.matchId, 7, manifest.expiresAt + 2)).toBeNull();
  });

  it("leaves a standalone dev spawn ungated", async () => {
    const spawner = new GameServerSpawner(18778);
    vi.spyOn(spawner as never, "waitForReady").mockResolvedValue(undefined);
    const server = await spawner.spawn({ map: "wdm2", gametype: "duel" });
    expect(server.admissionTickets).toBeUndefined();
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).not.toContain("--private-match");
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env?.SHAG_MATCH_ADMISSION).toBeUndefined();
  });

  it("forwards only authenticated final lines from its active child", async () => {
    const child = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    Object.assign(child, { stdout, stderr: new EventEmitter() });
    vi.mocked(spawn).mockImplementationOnce(() => child);
    const spawner = new GameServerSpawner(18779);
    const results = vi.fn();
    spawner.onServerResult = results;
    const rejected = vi.fn();
    spawner.onServerResultRejected = rejected;
    const started = spawner.spawn({
      map: "wamphi1",
      gametype: "amphi",
      admissionSeats: [
        { lobbyPlayerId: "one", accountId: 11, name: "One", team: "udon", isBot: false },
        { lobbyPlayerId: "two", accountId: 12, name: "Two", team: "soba", isBot: false },
      ],
    });
    stdout.emit("data", Buffer.from("[Server] Ready for connections\n"));
    const server = await started;
    const env = vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env;
    const manifest = JSON.parse(env!.SHAG_MATCH_ADMISSION!);
    const report = resultReport(
      {
        matchId: server.matchId,
        gametype: "amphi",
        map: "wamphi1",
        endedAt: Date.now(),
        participants: manifest.grants
          .filter((g: { notBefore?: number }) => !g.notBefore)
          .map((g: { tokenHash: string; accountId: number }, i: number) => ({
            tokenHash: g.tokenHash,
            accountId: g.accountId,
            outcome: i ? "loss" : "win",
            score: i ? 0 : 3,
          })),
      },
      manifest,
    );
    const line = signMatchResult(report, env!.SHAG_MATCH_RESULT_SECRET!);
    stdout.emit("data", Buffer.from(`${line.slice(0, 25)}`));
    stdout.emit("data", Buffer.from(`${line.slice(25)}\n`));
    expect(results).toHaveBeenCalledExactlyOnceWith(report);
    stdout.emit(
      "data",
      Buffer.from(`${signMatchResult({ ...report, map: "fake" }, env!.SHAG_MATCH_RESULT_SECRET!)}\n`),
    );
    expect(results).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledExactlyOnceWith(server.matchId);
  });

  it("hands out a drop-in ticket only after the child holds its seat, and counts the late player", async () => {
    const child = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    const written: string[] = [];
    const stdin = { writable: true, write: vi.fn((line: string) => written.push(line)) };
    Object.assign(child, { stdout, stderr: new EventEmitter(), stdin });
    vi.mocked(spawn).mockImplementationOnce(() => child);
    const spawner = new GameServerSpawner(18780);
    const results = vi.fn();
    spawner.onServerResult = results;
    const started = spawner.spawn({
      map: "wdm2",
      gametype: "ffa",
      admissionSeats: [{ lobbyPlayerId: "one", accountId: 11, name: "One", team: "ffa", isBot: false }],
    });
    stdout.emit("data", Buffer.from("[Server] Ready for connections\n"));
    const server = await started;
    const env = vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env;

    let settled = false;
    const pending = spawner
      .admitDropIn(server.matchId, { accountId: 30, name: "Late", team: "ffa", isBot: false })
      .then((seat) => {
        settled = true;
        return seat;
      });
    expect(written).toHaveLength(1);
    const [command, payload] = written[0].trim().split(" ");
    expect(command).toBe("admit");
    const grants = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    await Promise.resolve();
    expect(settled).toBe(false);

    stdout.emit("data", Buffer.from(`SHAG_ADMITTED ${grants[0].seatId}\n`));
    const seat = await pending;
    expect(seat?.serverUrl).toBe(server.url);
    expect(written[0]).not.toContain(seat?.admissionTicket);

    // The late player's result verifies against the seat they were given.
    const report: MatchResultReport = resultReport(
      {
        matchId: server.matchId,
        gametype: "ffa",
        map: "wdm2",
        endedAt: Date.now(),
        participants: [
          {
            tokenHash: JSON.parse(env!.SHAG_MATCH_ADMISSION!).grants[0].tokenHash,
            accountId: 11,
            outcome: "loss",
            score: 1,
          },
          { tokenHash: grants[0].tokenHash, accountId: 30, outcome: "win", score: 5 },
        ],
      },
      {
        ...JSON.parse(env!.SHAG_MATCH_ADMISSION!),
        grants: [...JSON.parse(env!.SHAG_MATCH_ADMISSION!).grants, ...grants],
      },
    );
    stdout.emit("data", Buffer.from(`${signMatchResult(report, env!.SHAG_MATCH_RESULT_SECRET!)}\n`));
    expect(results).toHaveBeenCalledExactlyOnceWith(report);
  });

  it("gives no ticket when the child never confirms the seat", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as ChildProcess;
      const stdout = new EventEmitter();
      Object.assign(child, { stdout, stderr: new EventEmitter(), stdin: { writable: true, write: vi.fn() } });
      vi.mocked(spawn).mockImplementationOnce(() => child);
      const spawner = new GameServerSpawner(18781);
      const started = spawner.spawn({
        map: "wdm2",
        gametype: "ffa",
        admissionSeats: [{ lobbyPlayerId: "one", accountId: 11, name: "One", team: "ffa", isBot: false }],
      });
      stdout.emit("data", Buffer.from("[Server] Ready for connections\n"));
      const server = await started;
      const pending = spawner.admitDropIn(server.matchId, { accountId: 30, name: "Late", team: "ffa", isBot: false });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await pending).toBeNull();
      expect(
        await spawner.admitDropIn("no-such-match", { accountId: 31, name: "X", team: "ffa", isBot: false }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
