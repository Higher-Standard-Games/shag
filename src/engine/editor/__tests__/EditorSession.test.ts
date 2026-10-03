// @vitest-environment jsdom

import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSession } from "../EditorSession";
import { writeMap } from "../MapWriter";
import { createRoomTemplate } from "../RoomTemplate";
import { serverMapName } from "../ServerMapOpen";
import type { ShaggedApi } from "../ShaggedApi";

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
  it("opens a server map and keeps divergent local work when opening a server copy", async () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const sidecar = createRoomTemplate();
    const name = serverMapName(sidecar.draftId);
    const map = { name, revision: 4, sourceHash: "hash", source: writeMap(sidecar), sidecar };
    const api = {
      status: vi.fn(async () => ({
        saveAvailable: true,
        compilerAvailable: false,
        playableAvailable: false,
        supportedQualities: [],
        reason: "Compiler unavailable",
      })),
      maps: vi.fn(async () => [{ name, revision: 4, sourceHash: "hash" }]),
      map: vi.fn(async () => map),
    } as unknown as ShaggedApi;
    const session = new EditorSession(engine, canvas, vi.fn(), api);
    await vi.waitFor(() =>
      expect(session.root.querySelector<HTMLButtonElement>('[data-action="server-maps"]')?.disabled).toBe(false),
    );
    session.root.querySelector<HTMLButtonElement>('[data-action="server-maps"]')!.click();
    await vi.waitFor(() => expect(session.root.querySelector(`[data-map-name="${name}"]`)).toBeTruthy());
    session.root.querySelector<HTMLButtonElement>(`[data-map-name="${name}"]`)!.click();
    await vi.waitFor(() => expect(session.draftId).toBe(sidecar.draftId));
    expect(JSON.parse(localStorage.getItem(`shagged:view:v1:${sidecar.draftId}`)!)).toMatchObject({
      serverSave: { revision: 4 },
    });
    session.document.transact((data) => {
      data.brushes[0].max.x += 16;
    });
    session.save();
    const localMax = session.document.snapshot().brushes[0].max.x;
    session.root.querySelector<HTMLButtonElement>('[data-action="server-maps"]')!.click();
    await vi.waitFor(() => expect(session.root.querySelector(`[data-map-name="${name}"]`)).toBeTruthy());
    session.root.querySelector<HTMLButtonElement>(`[data-action="open-server-map"]`)!.click();
    await vi.waitFor(() => expect(session.root.querySelector("[data-server-conflict]")).toBeTruthy());
    expect(session.document.snapshot().brushes[0].max.x).toBe(localMax);
    session.root.querySelector<HTMLButtonElement>('[data-action="server-copy"]')!.click();
    await vi.waitFor(() => expect(session.draftId).not.toBe(sidecar.draftId));
    expect(session.document.snapshot().brushes[0].max.x).toBe(sidecar.brushes[0].max.x);
    expect(JSON.parse(localStorage.getItem(`shagged:draft:v1:${sidecar.draftId}`)!).brushes[0].max.x).toBe(localMax);
    session.dispose();
    engine.dispose();
  });
  it("saves a revision before compiling and keeps a stale server revision from being overwritten", async () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let serverRevision = 0;
    const savedSources: string[] = [];
    const api = {
      status: vi.fn(async () => ({
        saveAvailable: true,
        compilerAvailable: true,
        playableAvailable: false,
        supportedQualities: ["default"],
        reason: null,
      })),
      save: vi.fn(async (_name: string, source: string, expectedRevision: number) => {
        if (expectedRevision !== serverRevision) throw new Error("Map revision conflict");
        savedSources.push(source);
        return { revision: ++serverRevision };
      }),
      mapRevision: vi.fn(async () => serverRevision),
      compile: vi.fn(async () => ({ jobId: "job-1" })),
      job: vi.fn(async () => ({
        id: "job-1",
        mapName: "test",
        revision: serverRevision,
        state: "compiled",
        stage: "complete",
        logs: ["Build complete"],
        runtimeMapName: null,
      })),
    } as unknown as ShaggedApi;
    const session = new EditorSession(engine, canvas, vi.fn(), api);
    await vi.waitFor(() =>
      expect(session.root.querySelector<HTMLButtonElement>('[data-action="server-save"]')?.disabled).toBe(false),
    );
    session.root.querySelector<HTMLButtonElement>('[data-action="room"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="compile"]')!.click();
    await vi.waitFor(() => expect(api.compile).toHaveBeenCalledWith(`draft_${session.draftId.replace(/-/g, "")}`, 1));
    await vi.waitFor(() =>
      expect(session.root.querySelector('[data-action="compile-status"]')?.textContent).toContain("compiled"),
    );
    expect(savedSources).toHaveLength(1);
    expect(savedSources[0]).toContain('"classname" "worldspawn"');
    expect(JSON.parse(localStorage.getItem(`shagged:view:v1:${session.draftId}`)!)).toMatchObject({
      serverSave: { revision: 1, documentRevision: session.revision },
    });
    session.document.transact((data) => {
      data.entities[0].origin.x += 16;
    });
    serverRevision = 2;
    session.root.querySelector<HTMLButtonElement>('[data-action="server-save"]')!.click();
    await vi.waitFor(() =>
      expect(session.root.querySelector(".shagged__status")?.textContent).toContain("Server map is at revision 2"),
    );
    expect(savedSources).toHaveLength(1);
    session.dispose();
    engine.dispose();
  });
  it("creates a room from the toolbar and recovers its draft and view", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const first = new EditorSession(engine, canvas, vi.fn());
    const camera = engine.scenes[0].activeCamera as ArcRotateCamera;
    expect(camera.movement.input.getEntry("pointer", "rotate", { button: 2 })?.button).toBe(2);
    first.root.querySelector<HTMLButtonElement>('[data-action="room"]')!.click();
    expect(first.document.snapshot().brushes).toHaveLength(6);
    expect(first.document.snapshot().entities.find((e) => e.classname === "info_player_deathmatch")?.origin.z).toBe(48);
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
    // World (100, 0): on the floor, clear of the spawn and light at the room's centre.
    restored.root
      .querySelector<HTMLCanvasElement>('[data-plane="xy"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 300, clientY: 150 }));
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

  it("places, moves, edits, duplicates and deletes a point entity", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string, x: number, y: number) =>
      xy.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
    const entities = () => session.document.snapshot().entities;

    // Pick a light in the toolbar, then click world (64, 32) in the top view.
    const picker = session.root.querySelector<HTMLSelectElement>("[data-entity-class]")!;
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toContain("LIGHTS");
    picker.value = "light";
    picker.dispatchEvent(new Event("change"));
    expect(session.root.querySelector('[data-action="entity"]')!.classList.contains("active")).toBe(true);
    pointer("pointerdown", 264, 118);
    pointer("pointerup", 264, 118);
    // The light's box (-16..32 on Z) stands on the work plane at Z=0.
    expect(entities()).toMatchObject([{ classname: "light", origin: { x: 64, y: 32, z: 16 }, keys: {} }]);
    const id = entities()[0].id;
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain("1 entities");

    // Select and drag it 32 units along +X.
    session.root.querySelector<HTMLButtonElement>('[data-action="select"]')!.click();
    pointer("pointerdown", 264, 118);
    pointer("pointermove", 296, 118);
    expect(entities()[0].origin.x).toBe(64); // a preview, not yet a document change
    pointer("pointerup", 296, 118);
    expect(entities()[0].origin).toEqual({ x: 96, y: 32, z: 16 });

    // The inspector lists documented keys, keeps an unknown one, and adds a new one.
    session.document.transact((data) => {
      data.entities[0].keys._mod_flag = "<b>kept</b>";
    });
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    const form = session.root.querySelector<HTMLFormElement>("[data-entity-form]")!;
    const unknown = form.querySelector<HTMLInputElement>('[name="key:_mod_flag"]')!;
    expect(unknown.value).toBe("<b>kept</b>"); // a value, never parsed as markup
    expect(form.querySelector("b")).toBeNull();
    expect(form.querySelector<HTMLInputElement>('[name="key:light"]')!.placeholder).toBe("300");
    form.querySelector<HTMLInputElement>('[name="key:light"]')!.value = "450";
    form.querySelector<HTMLInputElement>('[name="new-key"]')!.value = "targetname";
    form.querySelector<HTMLInputElement>('[name="new-value"]')!.value = "lamp1";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(entities()[0].keys).toEqual({ light: "450", targetname: "lamp1", _mod_flag: "<b>kept</b>" });

    // A value a .map can't hold is refused without changing the entity.
    const again = session.root.querySelector<HTMLFormElement>("[data-entity-form]")!;
    again.querySelector<HTMLInputElement>('[name="key:light"]')!.value = 'say "hi"';
    again.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(entities()[0].keys.light).toBe("450");
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain("Entity edit rejected");

    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    expect(entities()).toHaveLength(2);
    expect(entities()[1]).toMatchObject({ classname: "light", origin: { x: 112, y: 32, z: 16 } });
    expect(entities()[1].keys).toEqual(entities()[0].keys);

    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(entities().map((entity) => entity.id)).toEqual([id]);
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(entities()).toHaveLength(2);
    session.dispose();
    engine.dispose();
  });

  it("turns a brush into a trigger, warns about its required key, grows a door, and prunes on delete", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string, x: number, y: number) =>
      xy.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
    const data = () => session.document.snapshot();
    const submit = () =>
      session.root
        .querySelector<HTMLFormElement>("[data-brush-form]")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const owner = () => session.root.querySelector<HTMLSelectElement>('[name="owner"]')!;

    // Draw a brush, then make it a new trigger_teleport from the inspector.
    pointer("pointerdown", 200, 150);
    pointer("pointerup", 264, 86);
    const brushId = data().brushes[0].id;
    expect(owner().value).toBe("world");
    owner().value = "new:trigger_teleport";
    submit();
    expect(data().brushEntities).toMatchObject([{ classname: "trigger_teleport", keys: {}, brushIds: [brushId] }]);
    expect(data().brushes[0].shader).toBe("common/trigger");
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain("1 entities");

    // The game drops a teleporter without target; the inspector says so until it is set.
    const warning = session.root.querySelector<HTMLElement>("[data-missing]")!;
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain("target");
    expect(session.root.querySelector('[name="key:model"]')).toBeNull();
    session.root.querySelector<HTMLInputElement>('[name="key:target"]')!.value = "dest1";
    submit();
    expect(data().brushEntities![0].keys).toEqual({ target: "dest1" });
    expect(session.root.querySelector<HTMLElement>("[data-missing]")!.hidden).toBe(true);
    expect(writeMap(data())).toContain('"classname" "trigger_teleport"\n"target" "dest1"\n{\nbrushDef');

    // Back to worldspawn: the emptied entity disappears, the trigger texture stays.
    owner().value = "world";
    submit();
    expect(data().brushEntities).toEqual([]);

    // A door: one brush becomes func_door, a duplicate joins it, deleting one keeps the other.
    owner().value = "new:func_door";
    submit();
    expect(data().brushes[0].shader).toBe("common/trigger"); // movers keep the brush's own shader
    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    expect(data().brushes).toHaveLength(2);
    expect(data().brushEntities![0].brushIds).toHaveLength(2);
    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(data().brushEntities![0].brushIds).toEqual([brushId]);

    // Deleting the last brush removes the entity with it.
    session.root.querySelector<HTMLButtonElement>('[data-action="select"]')!.click();
    pointer("pointerdown", 232, 118);
    pointer("pointerup", 232, 118);
    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(data().brushes).toHaveLength(0);
    expect(data().brushEntities).toEqual([]);
    session.dispose();
    engine.dispose();
  });

  it("selects a brush that lies between coarse grid lines", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    session.document.transact((data) =>
      data.brushes.push({
        id: "narrow",
        min: { x: 16, y: 16, z: 0 },
        max: { x: 48, y: 48, z: 16 },
        shader: "blx/blx_grid",
      }),
    );
    session.root.querySelector<HTMLSelectElement>("[data-grid]")!.value = "64";
    session.root.querySelector("[data-grid]")!.dispatchEvent(new Event("change"));
    session.root.querySelector<HTMLButtonElement>('[data-action="select"]')!.click();
    const pane = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    // Pane centre is (200, 150) at zoom 1, so world (32, 32) is client (232, 118).
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 232, clientY: 118 }));
    pane.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 232, clientY: 118 }));
    expect(session.root.querySelector("[data-brush-id]")?.textContent).toBe("narrow");
    session.dispose();
    engine.dispose();
  });

  it("keeps an event's status message and an unsaved inspector edit across a redraw", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const pane = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const status = () => session.root.querySelector(".shagged__status")!.textContent!;
    // A one-cell-thin drag is rejected with a message; the redraw after it must not erase it.
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    pane.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 150 }));
    expect(status()).toContain("Drag at least one grid cell");

    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    pane.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));
    const maxX = session.root.querySelector<HTMLInputElement>('[name="max-x"]')!;
    maxX.value = "512";
    pane.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1, clientX: 200, clientY: 150 }),
    );
    expect(session.root.querySelector<HTMLInputElement>('[name="max-x"]')!.value).toBe("512");
    session.dispose();
    engine.dispose();
  });

  it("shows the hovered Quake coordinate in the status bar, and clears it on pointerleave", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const pane = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const status = () => session.root.querySelector(".shagged__status")!.textContent!;

    expect(status()).not.toContain("cursor");
    pane.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 232, clientY: 118 }));
    expect(status()).toContain("cursor (32, 32, 0)");

    // A hover during an active drag doesn't overwrite it with stale coordinates.
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 150 }));
    pane.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 264, clientY: 86 }));
    expect(status()).not.toContain("cursor");
    pane.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 264, clientY: 86 }));

    pane.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 232, clientY: 118 }));
    expect(status()).toContain("cursor (32, 32, 0)");
    pane.dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
    expect(status()).not.toContain("cursor");

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
    vi.useFakeTimers();
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
    // Export frees its Blob URL a second later. Let that happen now, while the
    // stub still exists, not during whichever test file runs a second from now.
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:shagged-test");
    vi.useRealTimers();

    // Removed rather than restored: jsdom never had these, this test added them.
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    anchorClick.mockRestore();
    session.dispose();
    engine.dispose();
  });
});
