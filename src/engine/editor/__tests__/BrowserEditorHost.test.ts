import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{
  save: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}> = [];
vi.mock("../EditorSession", () => ({
  EditorSession: class {
    readonly draftId = "draft-1";
    readonly revision = 2;
    readonly root = { focus: vi.fn() };
    readonly save = vi.fn();
    readonly dispose = vi.fn();
    readonly render = vi.fn();
    constructor() {
      created.push(this);
    }
  },
}));
const mapLauncher = vi.hoisted(() => ({
  launch: vi.fn(async () => ({ map: "draft_1", gametype: "duel", serverUrl: "ws://localhost:7777" })),
  unload: vi.fn(async () => {}),
}));
vi.mock("../../console/GameplayMapLauncher", () => ({ getGameplayMapLauncher: () => mapLauncher }));
vi.mock("../PublishedMapClient", () => ({
  preparePublishedMap: vi.fn(async () => ({
    mapName: "draft_1",
    package: "map_draft_1_00001.pk3",
    buildId: "job-1",
    bspHash: "hash",
  })),
}));

import { BrowserEditorHost } from "../BrowserEditorHost";
import { PLAYTEST_RETURN_KEY } from "../EditorLauncher";

const stored = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

afterEach(() => {
  created.length = 0;
  stored.clear();
  vi.unstubAllGlobals();
  mapLauncher.launch.mockClear();
  mapLauncher.unload.mockClear();
});
const engine = {} as AbstractEngine;
const canvas = {} as HTMLCanvasElement;

describe("browser editor handoff", () => {
  it("suspends once, renders the editor, and restores once on close", async () => {
    const suspend = vi.fn(() => restore);
    const restore = vi.fn();
    const host = new BrowserEditorHost(engine, canvas, () => true, suspend);
    expect(await host.open()).toEqual({ open: true, draftId: "draft-1", revision: 2 });
    await host.open();
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(host.renderEditor()).toBe(true);
    expect(created[0].render).toHaveBeenCalledTimes(1);
    expect(await host.close()).toEqual({ open: false });
    expect(created[0].save).toHaveBeenCalledTimes(1);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    await host.close();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("refuses to replace an active match before suspending the game", async () => {
    const suspend = vi.fn(() => vi.fn());
    const host = new BrowserEditorHost(engine, canvas, () => false, suspend);
    await expect(host.open()).rejects.toThrow("Finish the active match");
    expect(suspend).not.toHaveBeenCalled();
  });

  it("keeps the editor open if saving before exit fails", async () => {
    const restore = vi.fn();
    const host = new BrowserEditorHost(
      engine,
      canvas,
      () => true,
      () => restore,
    );
    await host.open();
    created[0].save.mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(host.close()).rejects.toThrow("quota");
    expect(host.status().open).toBe(true);
    expect(created[0].dispose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("checkpoints and closes the editor before starting a verified Playtest", async () => {
    const restore = vi.fn();
    const host = new BrowserEditorHost(
      engine,
      canvas,
      () => true,
      () => restore,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ buildId: "job-1" }))),
    );
    await host.open();
    await host.playtest({
      id: "job-1",
      mapName: "draft_1",
      revision: 1,
      state: "playable",
      stage: "done",
      logs: [],
      runtimeMapName: "draft_1",
      packageName: "map_draft_1_00001.pk3",
      bspHash: "hash",
    });
    expect(created[0].save).toHaveBeenCalledTimes(1);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(mapLauncher.launch).toHaveBeenCalledWith("draft_1", "duel");
    expect(sessionStorage.getItem(PLAYTEST_RETURN_KEY)).toBe("draft-1");
    expect(host.status().open).toBe(false);
  });
});
