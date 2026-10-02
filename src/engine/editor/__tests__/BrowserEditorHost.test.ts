import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { BrowserEditorHost } from "../BrowserEditorHost";

afterEach(() => {
  created.length = 0;
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
});
