// @vitest-environment jsdom

import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSession } from "../EditorSession";

const context = {
  scale: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
};
const originalContext = HTMLCanvasElement.prototype.getContext;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalCapture = HTMLCanvasElement.prototype.setPointerCapture;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalContext;
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  HTMLCanvasElement.prototype.setPointerCapture = originalCapture;
  localStorage.clear();
  document.body.innerHTML = "";
});

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.getBoundingClientRect = (() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  })) as typeof HTMLElement.prototype.getBoundingClientRect;
});

describe("editor DOM shell", () => {
  it("creates a room from the toolbar and recovers its draft and view", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const first = new EditorSession(engine, canvas, vi.fn());
    const camera = engine.scenes[0].activeCamera as ArcRotateCamera;
    expect(camera.movement.input.getEntry("pointer", "rotate", { button: 2 })?.button).toBe(2);
    first.root.querySelector<HTMLButtonElement>('[data-action="room"]')!.click();
    expect(first.document.snapshot().brushes).toHaveLength(6);
    expect(first.document.snapshot().testSpawn?.z).toBe(48);
    first.render();
    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    expect(first.root.querySelector("[data-brush-form]")).toBeTruthy();
    const id = first.draftId;
    expect(
      localStorage.getItem("shagged:active-draft:v1"),
      first.root.querySelector(".shagged__status")?.textContent,
    ).toBe(id);
    first.dispose();
    const restored = new EditorSession(engine, canvas, vi.fn());
    expect(restored.draftId).toBe(id);
    expect(restored.document.snapshot().brushes).toHaveLength(6);
    restored.root.querySelector<HTMLButtonElement>('[data-action="select"]')!.click();
    restored.root
      .querySelector<HTMLCanvasElement>('[data-plane="xy"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    const form = restored.root.querySelector<HTMLFormElement>("[data-brush-form]")!;
    expect(form).toBeTruthy();
    const selectedId = restored.root.querySelector("[data-brush-id]")!.textContent!;
    const original = restored.document.snapshot().brushes.find((brush) => brush.id.startsWith(selectedId))!;
    form.querySelector<HTMLInputElement>('[name="max-z"]')!.value = String(original.max.z + 16);
    form.querySelector<HTMLInputElement>('[name="shader"]')!.value = "blx/blx_dark";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const edited = restored.document.snapshot().brushes.find((brush) => brush.id === original.id)!;
    expect(edited.max.z).toBe(original.max.z + 16);
    expect(edited.shader).toBe("blx/blx_dark");
    restored.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(restored.document.snapshot().brushes.find((brush) => brush.id === original.id)).toEqual(original);

    restored.root.querySelector<HTMLButtonElement>('[data-action="new"]')!.click();
    restored.root.querySelector<HTMLButtonElement>('[data-action="brush"]')!.click();
    const work = restored.root.querySelector<HTMLInputElement>("[data-workplane]")!;
    work.value = "128";
    work.dispatchEvent(new Event("change"));
    const xy = restored.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    context.strokeRect.mockClear();
    xy.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    xy.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    expect(restored.document.snapshot().brushes).toHaveLength(0);
    expect(context.strokeRect).toHaveBeenCalledTimes(3);
    const ghost = engine.scenes[0].getMeshByName("shagged-gesture-preview");
    expect(ghost?.position.y).toBe(136);
    xy.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    expect(restored.document.snapshot().brushes[0].min.z).toBe(128);
    expect(restored.document.snapshot().brushes[0].max.z).toBe(144);
    expect(engine.scenes[0].getMeshByName("shagged-gesture-preview")).toBeNull();
    const newId = restored.draftId;
    const name = restored.root.querySelector<HTMLInputElement>("[data-draft-name]")!;
    name.value = "Practice room";
    name.dispatchEvent(new Event("change"));
    restored.root.querySelector<HTMLButtonElement>('[data-action="drafts"]')!.click();
    const chooser = restored.root.querySelector<HTMLElement>(".shagged__drafts")!;
    expect(chooser.hidden).toBe(false);
    restored.root.querySelector<HTMLButtonElement>(`[data-draft-id="${id}"]`)!.click();
    expect(restored.draftId).toBe(id);
    expect(restored.document.snapshot().brushes).toHaveLength(6);
    expect(name.value).toBe("Room Template");
    expect(work.value).toBe("0");
    expect(chooser.hidden).toBe(true);
    restored.root.querySelector<HTMLButtonElement>('[data-action="drafts"]')!.click();
    restored.root.querySelector<HTMLButtonElement>(`[data-draft-id="${newId}"]`)!.click();
    expect(restored.draftId).toBe(newId);
    expect(restored.document.snapshot().brushes[0].min.z).toBe(128);
    expect(name.value).toBe("Practice room");
    expect(work.value).toBe("128");
    restored.dispose();
    engine.dispose();
  });

  it("pans, draws at the new center, frames, and restores navigation without changing map history", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let session = new EditorSession(engine, canvas, vi.fn());
    const pane = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string, x: number, y: number, button = 0) =>
      pane.dispatchEvent(new MouseEvent(type, { bubbles: true, button, clientX: x, clientY: y }));
    pointer("pointerdown", 200, 150, 1);
    pointer("pointermove", 264, 182, 1);
    pointer("pointerup", 264, 182, 1);
    expect(session.document.canUndo).toBe(false);
    pointer("pointerdown", 200, 150);
    pointer("pointerup", 264, 86);
    expect(session.document.snapshot().brushes[0]).toMatchObject({
      min: { x: -64, y: 32, z: 0 },
      max: { x: 0, y: 96, z: 16 },
    });
    const data = session.document.snapshot();
    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    const camera = engine.scenes[0].activeCamera as ArcRotateCamera;
    expect(camera.target.asArray()).toEqual([-32, 8, 64]);
    expect(session.document.snapshot()).toEqual(data);
    const saved = JSON.parse(localStorage.getItem(`shagged:view:v1:${session.draftId}`)!);
    expect(saved.viewCenter).toEqual({ x: -32, y: 64, z: 8 });
    const id = session.draftId;
    session.dispose();
    session = new EditorSession(engine, canvas, vi.fn());
    session.save();
    expect(JSON.parse(localStorage.getItem(`shagged:view:v1:${id}`)!)).toMatchObject({
      viewCenter: saved.viewCenter,
      zoom: saved.zoom,
    });
    session.dispose();
    engine.dispose();
  });

  it("steps grid size with [ and ], cancels a drag with Escape, then closes the drafts popover", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const grid = session.root.querySelector<HTMLSelectElement>("[data-grid]")!;
    const key = (k: string) => session.root.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

    expect(grid.value).toBe("16");
    key("[");
    expect(grid.value).toBe("8");
    key("[");
    expect(grid.value).toBe("8"); // already the smallest option
    key("]");
    key("]");
    expect(grid.value).toBe("32");

    const pane = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    pane.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    expect(engine.scenes[0].getMeshByName("shagged-gesture-preview")).not.toBeNull();
    key("Escape");
    expect(engine.scenes[0].getMeshByName("shagged-gesture-preview")).toBeNull();
    pane.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    expect(session.document.snapshot().brushes).toHaveLength(0); // the cancelled drag committed nothing

    session.root.querySelector<HTMLButtonElement>('[data-action="drafts"]')!.click();
    const drafts = session.root.querySelector<HTMLElement>(".shagged__drafts")!;
    expect(drafts.hidden).toBe(false);
    key("Escape");
    expect(drafts.hidden).toBe(true);

    session.dispose();
    engine.dispose();
  });

  it("separates Save (Ctrl+S) from Export (Ctrl+Shift+S)", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    // jsdom has no Blob URL implementation at all, so these are defined fresh
    // rather than spied on, and removed afterward instead of restored.
    const createObjectURL = vi.fn().mockReturnValue("blob:shagged-test");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain("saved locally");

    session.root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);

    // Removed rather than restored: jsdom never had these, this test added them.
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    anchorClick.mockRestore();
    session.dispose();
    engine.dispose();
  });
});
