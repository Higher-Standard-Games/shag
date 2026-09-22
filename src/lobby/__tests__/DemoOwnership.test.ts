import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { GameState } from "../../engine/network/core/GameState";
import { DemoRecorder } from "../../games/fps/server/DemoRecorder";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import type { DemoInfo } from "../types";

it("publishes demo ownership only when ticketed accounts match a durable result", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-demo-owner-"));
  const demoDir = path.join(dir, "demos");
  const accounts = PlayerStore.open(dir);
  const results = MatchResultStore.open(dir);
  try {
    const first = accounts.create().account;
    const second = accounts.create().account;
    const bystander = accounts.create().account;
    const saved = new DemoRecorder({
      map: "wdm2",
      gametype: "deathmatch",
      matchId: "verified-match",
      tickRate: 125,
      snapshotRate: 63,
      outputDir: demoDir,
      minDurationMs: 0,
    });
    saved.addPlayer("1", first.name, "", first.id);
    saved.addPlayer("2", second.name, "", second.id);
    const state = new GameState();
    state.tick = 1;
    saved.recordFrame(state);
    const savedPath = await saved.stop();
    results.record({
      matchId: "verified-match",
      gametype: "ffa",
      map: "wdm2",
      endedAt: Date.now(),
      participants: [
        { accountId: first.id, outcome: "draw", score: 0 },
        { accountId: second.id, outcome: "draw", score: 0 },
      ],
    });

    const namesOnly = new DemoRecorder({
      map: "wdm7",
      gametype: "deathmatch",
      matchId: "unverified-match",
      tickRate: 125,
      snapshotRate: 63,
      outputDir: demoDir,
      minDurationMs: 0,
    });
    namesOnly.addPlayer("1", first.name);
    namesOnly.addPlayer("2", second.name);
    namesOnly.recordFrame(state);
    await namesOnly.stop();

    const lobby = new LobbyServer(0, new GameServerSpawner(), { players: accounts, results });
    const scanner = lobby as unknown as {
      DEMO_DIR: string;
      _scanDemos(): void;
      _demoCache: DemoInfo[];
      _demoOwnership: Map<string, Set<number>>;
      handleDemosList(player: object, limit: number, scope: string): void;
      handleFeaturedGet(player: object, query: object): void;
    };
    scanner.DEMO_DIR = demoDir;
    scanner._scanDemos();
    expect(scanner._demoOwnership.get(path.basename(savedPath))).toEqual(new Set([first.id, second.id]));
    expect(scanner._demoOwnership.size).toBe(1);
    expect(scanner._demoCache.find((demo) => demo.filename === path.basename(savedPath))).not.toHaveProperty(
      "verifiedAccountIds",
    );

    const pages: Array<{ scope: string; demos: DemoInfo[] }> = [];
    const reader = (accountId: number) => ({
      id: `reader-${accountId}`,
      accountId,
      ws: { readyState: 1, send: (raw: string) => pages.push(JSON.parse(raw)) },
    });
    scanner.handleDemosList(reader(first.id), 64, "yours");
    expect(pages.at(-1)).toMatchObject({ scope: "yours", demos: [{ filename: path.basename(savedPath) }] });
    expect(pages.at(-1)?.demos[0]).not.toHaveProperty("verifiedAccountIds");
    scanner.handleDemosList(reader(bystander.id), 64, "yours");
    expect(pages.at(-1)).toMatchObject({ scope: "yours", demos: [] });
    scanner.handleDemosList(reader(bystander.id), 64, "latest");
    expect(pages.at(-1)?.demos).toHaveLength(2);

    const verified = scanner._demoCache.find((demo) => demo.filename === path.basename(savedPath));
    if (!verified) throw new Error("Expected the verified recording in the scan");
    verified.durationMs = 90_000;
    verified.date = Date.now() - 1_000;
    scanner.handleFeaturedGet(reader(first.id), { type: "featured:get", requestId: "ranked", limit: 5 });
    expect(pages.at(-1)).toMatchObject({
      type: "featured:page",
      selection: "ranked_month_week",
      entries: [{ demo: { filename: path.basename(savedPath) }, reason: "Features a 30-day top 10 player" }],
    });
  } finally {
    results.close();
    accounts.close();
    const target = path.resolve(dir);
    const tempRoot = path.resolve(os.tmpdir());
    if (target.startsWith(`${tempRoot}${path.sep}`) && path.basename(target).startsWith("shag-demo-owner-")) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});
