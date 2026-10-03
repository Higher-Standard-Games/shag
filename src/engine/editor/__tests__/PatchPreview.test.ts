// @vitest-environment jsdom

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDocument, type PatchSurface } from "../EditorDocument";
import { EditorSession } from "../EditorSession";
import { createPatchPreview, drawPatchLattice, patchBounds, patchLatticeHit } from "../PatchPreview";

const patch = (): PatchSurface => ({
  id: "curve",
  shader: "blx/blx_grid",
  width: 3,
  height: 3,
  controlPoints: [
    [
      { x: -16, y: -16, z: 4, u: 0, v: 0 },
      { x: 0, y: -16, z: 12, u: 0.5, v: 0 },
      { x: 16, y: -16, z: 4, u: 1, v: 0 },
    ],
    [
      { x: -16, y: 0, z: 8, u: 0, v: 0.5 },
      { x: 0, y: 0, z: 20, u: 0.5, v: 0.5 },
      { x: 16, y: 0, z: 8, u: 1, v: 0.5 },
    ],
    [
      { x: -16, y: 16, z: 4, u: 0, v: 1 },
      { x: 0, y: 16, z: 12, u: 0.5, v: 1 },
      { x: 16, y: 16, z: 4, u: 1, v: 1 },
    ],
  ],
});

const originalContext = HTMLCanvasElement.prototype.getContext;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalCapture = HTMLCanvasElement.prototype.setPointerCapture;

beforeEach(() => {
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
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalContext;
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  HTMLCanvasElement.prototype.setPointerCapture = originalCapture;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("editor patch preview", () => {
  it("uses Quake Z-up points for Babylon geometry and selects near the projected lattice", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const shape = patch();
    const mesh = createPatchPreview(shape, scene, false, false);
    expect(mesh.getVerticesData(VertexBuffer.PositionKind)?.slice(0, 3)).toEqual([-16, 4, -16]);
    expect(mesh.metadata.editorPatchId).toBe("curve");
    expect(patchBounds(shape)).toEqual({ min: { x: -16, y: -16, z: 4 }, max: { x: 16, y: 16, z: 20 } });
    expect(patchLatticeHit(shape, "xy", 0, 0, 1)).toBe(true);
    expect(patchLatticeHit(shape, "xy", 8, 8, 1)).toBe(false);
    const moveTo = vi.fn();
    const lineTo = vi.fn();
    const fillRect = vi.fn();
    drawPatchLattice(
      { beginPath: vi.fn(), moveTo, lineTo, stroke: vi.fn(), fillRect } as unknown as CanvasRenderingContext2D,
      shape,
      "xz",
      200,
      150,
      1,
      true,
    );
    expect(moveTo).toHaveBeenCalledWith(184, 146);
    expect(fillRect).toHaveBeenCalledTimes(9);
    scene.dispose();
    engine.dispose();
  });

  it("shows a saved patch in all panes and lets the mapper select and delete it", () => {
    const saved = new EditorDocument();
    saved.transact((draft) => {
      draft.patches ??= [];
      draft.patches.push(patch());
    });
    const data = saved.snapshot();
    localStorage.setItem("shagged:active-draft:v1", data.draftId);
    localStorage.setItem(`shagged:draft:v1:${data.draftId}`, JSON.stringify(data));
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    expect(engine.scenes[0].meshes.some((mesh) => mesh.metadata?.editorPatchId === "curve")).toBe(true);
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    xy.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    xy.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    expect(session.root.querySelector(".shagged__inspector")?.textContent).toContain("Patch");
    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(session.document.snapshot().patches).toEqual([]);
    session.dispose();
    engine.dispose();
  });
});
