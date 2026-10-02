// @vitest-environment jsdom

import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("editor DOM shell", () => {
  it("creates a room from the toolbar and recovers its draft and view", () => {
    HTMLCanvasElement.prototype.getContext = (() =>
      context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
    restored.dispose();
    engine.dispose();
  });
});
