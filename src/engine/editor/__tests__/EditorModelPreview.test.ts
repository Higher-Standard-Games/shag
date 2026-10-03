// @vitest-environment jsdom

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSession } from "../EditorSession";

vi.mock("@babylonjs/core/Loading/sceneLoader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader")>()),
  ImportMeshAsync: vi.fn(async () => ({ meshes: [], transformNodes: [] })),
}));

const originalContext = HTMLCanvasElement.prototype.getContext;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalCapture = HTMLCanvasElement.prototype.setPointerCapture;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalContext;
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  HTMLCanvasElement.prototype.setPointerCapture = originalCapture;
  localStorage.clear();
  document.body.replaceChildren();
  vi.mocked(ImportMeshAsync).mockClear();
});

describe("model preview lifecycle", () => {
  it("keeps the loaded preview through selection and moves it without another import", async () => {
    HTMLCanvasElement.prototype.getContext = (() => ({
      scale: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
    const session = new EditorSession(engine, canvas, vi.fn());
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string, x: number) =>
      xy.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 118 }));
    const picker = session.root.querySelector<HTMLSelectElement>("[data-entity-class]")!;
    picker.value = "misc_model";
    picker.dispatchEvent(new Event("change"));
    pointer("pointerdown", 264);
    pointer("pointerup", 264);
    const form = session.root.querySelector<HTMLFormElement>("[data-entity-form]")!;
    form.querySelector<HTMLInputElement>('[name="key:model"]')!.value = "models/props/crate.glb";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session["modelPreviews"].size).toBe(1));
    const id = session.document.snapshot().entities[0].id;
    const preview = session["modelPreviews"].get(id)!;
    expect(ImportMeshAsync).toHaveBeenCalledTimes(1);
    session.root.querySelector<HTMLButtonElement>('[data-action="select"]')!.click();
    pointer("pointerdown", 264);
    pointer("pointerup", 264);
    expect(session["modelPreviews"].get(id)).toBe(preview);
    pointer("pointerdown", 264);
    pointer("pointermove", 280);
    pointer("pointerup", 280);
    expect(session.document.snapshot().entities[0].origin.x).toBe(80);
    expect(preview.position.x).toBe(80);
    expect(ImportMeshAsync).toHaveBeenCalledTimes(1);
    session.dispose();
    engine.dispose();
  });
});
