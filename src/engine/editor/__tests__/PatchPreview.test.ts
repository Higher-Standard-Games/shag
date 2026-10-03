// @vitest-environment jsdom

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDocument, type PatchSurface } from "../EditorDocument";
import { EditorSession } from "../EditorSession";
import { writeMap } from "../MapWriter";
import { flatPatch } from "../PatchGeometry";
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
    arc: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    fillText: vi.fn(),
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
  it("builds a flat 3×3 grid on each active work plane, including reverse drags", () => {
    const xy = flatPatch("xy", { u: "x", v: "y", hidden: "z" }, [64, 32], [0, -32], 24, "blx/blx_grid")!;
    expect(xy.controlPoints[0][0]).toEqual({ x: 0, y: -32, z: 24, u: 0, v: 0 });
    expect(xy.controlPoints[1][1]).toEqual({ x: 32, y: 0, z: 24, u: 0.5, v: 0.5 });
    expect(xy.controlPoints[2][2]).toEqual({ x: 64, y: 32, z: 24, u: 1, v: 1 });
    const yz = flatPatch("yz", { u: "y", v: "z", hidden: "x" }, [0, 0], [32, 64], -8, "blx/blx_grid")!;
    expect(yz.controlPoints[2][2]).toEqual({ x: -8, y: 32, z: 64, u: 1, v: 1 });
    expect(flatPatch("none", { u: "x", v: "y", hidden: "z" }, [0, 0], [0, 32], 0, "blx/blx_grid")).toBeNull();
  });

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

  it("draws and edits a patch with one undo step each, previews, exports, and restores the tool", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    session.root.querySelector<HTMLButtonElement>('[data-action="patch"]')!.click();
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    xy.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    xy.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    expect(engine.scenes[0].meshes.some((mesh) => mesh.name === "gesture-patch")).toBe(true);
    xy.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    const data = session.document.snapshot();
    expect(data.patches).toHaveLength(1);
    expect(data.brushes).toHaveLength(0);
    expect(data.patches![0].controlPoints[2][2]).toMatchObject({ x: 64, y: 64, z: 0, u: 1, v: 1 });
    expect(writeMap(data)).toContain("patchDef2");
    expect(engine.scenes[0].meshes.some((mesh) => mesh.name === "gesture-patch")).toBe(false);
    expect(session.root.querySelector(".shagged__inspector")?.textContent).toContain("Patch");
    const form = session.root.querySelector<HTMLFormElement>("[data-patch-form]")!;
    form.querySelector<HTMLInputElement>('[name="z"]')!.value = "24";
    form.querySelector<HTMLInputElement>('[name="u"]')!.value = "0.25";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(session.document.snapshot().patches![0].controlPoints[1][1]).toMatchObject({ z: 24, u: 0.25 });
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(session.document.snapshot().patches![0].controlPoints[1][1].z).toBe(0);
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(session.document.snapshot().patches).toEqual([]);
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(session.document.snapshot().patches).toHaveLength(1);
    expect(session.document.snapshot().patches![0].controlPoints[1][1].z).toBe(24);
    session.dispose();
    const restored = new EditorSession(engine, canvas, vi.fn());
    expect(restored.document.snapshot().patches).toHaveLength(1);
    expect(restored.root.querySelector('[data-action="patch"]')?.classList.contains("active")).toBe(true);
    restored.dispose();
    engine.dispose();
  });
});
