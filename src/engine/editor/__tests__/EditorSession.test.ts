// @vitest-environment jsdom

import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSession } from "../EditorSession";

// The texture drawer's data sources: a fixed two-entry catalog and instant thumbnails.
vi.mock("../TextureCatalogLoader", () => ({
  loadTextureCatalog: async () =>
    ["blx/blx_white_stripe", "boqu/floor"].map((name) => ({
      name,
      folder: name.split("/")[0],
      image: `textures/${name}.tga`,
      hasShader: false,
      tags: [],
      compiler: false,
      sky: false,
      transparent: false,
      nolightmap: false,
      fog: false,
      solidColor: false,
      missing: false,
    })),
}));
vi.mock("../TextureThumbnailsBrowser", () => ({
  createBrowserThumbnails: () => ({
    request: async (path: string) =>
      path.includes("stripe")
        ? { url: "blob:stripe", width: 128, height: 32 }
        : { url: "blob:floor", width: 256, height: 256 },
    cancel: () => {},
    dispose: () => {},
  }),
}));

// The textured preview's image source: every file reads and decodes to a 2×2 image.
vi.mock("../PreviewTextures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../PreviewTextures")>()),
  browserPreviewDeps: async () => ({
    readFile: async () => new ArrayBuffer(4),
    decode: async () => ({ pixels: new Uint8Array(16), width: 2, height: 2 }),
  }),
}));

import { naturalFace } from "../FaceUv";
import { writeMap } from "../MapWriter";
import { createRoomTemplate } from "../RoomTemplate";
import { serverMapName } from "../ServerMapOpen";
import type { ShaggedApi } from "../ShaggedApi";
import { shaderBatches } from "../TexturedPreview";

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
  it("groups toolbar actions and keeps menu actions usable", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    expect(
      [...session.root.querySelectorAll(".shagged__toolgroup")].map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Map actions", "Edit actions", "Placement tools", "View actions", "Build actions"]);
    const menu = session.root.querySelector<HTMLDetailsElement>(".shagged__toolgroup .shagged__menu")!;
    expect(session.root.querySelector(".shagged__toolbar strong")?.textContent).toBe("SHAGGED");
    expect(menu.querySelector("[data-map-title]")?.textContent).toBe("Untitled");
    expect(menu.querySelector('[data-action="save"]')).toBeTruthy();
    expect(session.root.querySelectorAll("[data-draft-name]")).toHaveLength(1);
    menu.open = true;
    menu.querySelector<HTMLButtonElement>('[data-action="room"]')!.click();
    expect(menu.open).toBe(false);
    expect(session.document.snapshot().brushes.length).toBeGreaterThan(0);
    expect(menu.querySelector("[data-map-title]")?.textContent).toBe("Room Template");
    const name = menu.querySelector<HTMLInputElement>("[data-draft-name]")!;
    name.value = "Practice room";
    name.dispatchEvent(new Event("change"));
    expect(menu.querySelector("[data-map-title]")?.textContent).toBe("Practice room");
    menu.open = true;
    menu.querySelector("summary")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.open).toBe(false);
    expect(session.root.querySelector('[data-action="compile-status"]')?.textContent).toContain("Status:");
    session.dispose();
    engine.dispose();
  });

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

  it("places a model prop, edits compiler keys, and reports an incomplete reference", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const picker = session.root.querySelector<HTMLSelectElement>("[data-entity-class]")!;
    picker.value = "misc_model";
    picker.dispatchEvent(new Event("change"));
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string) =>
      xy.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 264, clientY: 118 }));
    pointer("pointerdown");
    pointer("pointerup");
    expect(session.document.snapshot().entities[0]).toMatchObject({
      classname: "misc_model",
      origin: { x: 64, y: 32, z: 0 },
      keys: { model: "", modelscale: "1" },
    });
    expect(session.root.querySelector(".shagged__warning")!.textContent).toContain("models/...");
    const form = session.root.querySelector<HTMLFormElement>("[data-entity-form]")!;
    expect(form.querySelector<HTMLInputElement>('[name="key:model"]')!.getAttribute("list")).toBe(
      "shagged-model-paths",
    );
    form.querySelector<HTMLInputElement>('[name="key:model"]')!.value = "models/mapobjects/crate/crate.md3";
    form.querySelector<HTMLInputElement>('[name="key:angle"]')!.value = "90";
    form.querySelector<HTMLInputElement>('[name="key:modelscale"]')!.value = "2";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(writeMap(session.document.snapshot())).toContain('"modelscale" "2"');
    expect(session.root.querySelector(".shagged__warning")!.textContent).toContain("preview for this format");
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

  it("applies a texture from the browser to the selected brush and to brushes drawn after", async () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const xy = session.root.querySelector<HTMLCanvasElement>('[data-plane="xy"]')!;
    const pointer = (type: string, x: number, y: number) =>
      xy.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.root.querySelector("[data-current-texture]")!.textContent).toBe("blx/blx_grid");

    pointer("pointerdown", 200, 150);
    pointer("pointerup", 264, 86);
    const first = session.document.snapshot().brushes[0];
    expect(first.faces).toBeUndefined(); // drawn before any pick: fixed legacy alignment

    const open = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true });
    session.root.dispatchEvent(open);
    // the shortcut focuses the drawer's search box, so its own "t" must not be typed there
    expect(open.defaultPrevented).toBe(true);
    await flush();
    await flush();
    const drawer = session.root.querySelector<HTMLElement>(".shagged-tex")!;
    expect(drawer.hidden).toBe(false);
    // typing "t" to search from the grid neither closes the drawer nor reaches other shortcuts
    drawer
      .querySelector(".shagged-tex__grid")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(drawer.hidden).toBe(false);
    const stripe = [...drawer.querySelectorAll<HTMLElement>(".shagged-tex__tile")].find((tile) =>
      tile.title.startsWith("blx/blx_white_stripe"),
    )!;
    stripe.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flush();

    const painted = session.document.snapshot().brushes[0];
    expect(painted.shader).toBe("blx/blx_white_stripe");
    expect(Object.keys(painted.faces!).sort()).toEqual(["+X", "+Y", "+Z", "-X", "-Y", "-Z"]);
    expect(painted.faces!["+Z"]).toEqual({
      shader: "blx/blx_white_stripe",
      shift: [0, 0],
      scale: [0.5, 0.5],
      rotation: 0,
      size: [128, 32],
    });
    // 128×32 at 0.5 units per texel: 1/64 across, 1/16 down
    expect(writeMap(session.document.snapshot())).toContain("( ( 0.015625 0 0 ) ( 0 0.0625 0 ) ) blx/blx_white_stripe");
    expect(session.root.querySelector("[data-current-texture]")!.textContent).toBe("blx/blx_white_stripe");
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain(
      "Applied blx/blx_white_stripe (128×32)",
    );
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(session.document.snapshot().brushes[0].shader).toBe("blx/blx_grid"); // one undo step

    // A brush drawn now gets the current texture with natural alignment.
    drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawer.hidden).toBe(true);
    pointer("pointerdown", 200, 214);
    pointer("pointerup", 264, 182);
    const drawn = session.document.snapshot().brushes.at(-1)!;
    expect(drawn.shader).toBe("blx/blx_white_stripe");
    expect(drawn.faces!["-X"]?.size).toEqual([128, 32]);
    session.dispose();
    expect(session.root.querySelector(".shagged-tex")).toBeNull();
    engine.dispose();
  });

  it("picks faces in 3D and from the face net, textures just those faces, and samples a face", async () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    // A wide, flat slab under the default camera: a ray through the view centre hits its top face.
    session.document.transact((data) =>
      data.brushes.push({
        id: "slab",
        min: { x: -256, y: -256, z: -16 },
        max: { x: 256, y: 256, z: 16 },
        shader: "blx/blx_grid",
      }),
    );
    // Undo then redo goes through the editor's own change path, which rebuilds the 3D meshes;
    // a grid change first redraws, which enables the Undo button.
    session.root.querySelector("[data-grid]")!.dispatchEvent(new Event("change"));
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    session.render();
    const click = (modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => {
      for (const type of ["pointerdown", "pointerup"]) {
        canvas.dispatchEvent(
          new MouseEvent(type, { bubbles: true, button: 0, clientX: 200, clientY: 150, ...modifiers }),
        );
      }
    };
    const status = () => session.root.querySelector(".shagged__status")!.textContent!;
    const net = () =>
      [...session.root.querySelectorAll<HTMLButtonElement>("[data-face-net] button")]
        .filter((b) => b.classList.contains("active"))
        .map((b) => b.dataset.face);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    click({ ctrlKey: true, shiftKey: true });
    expect(status()).toContain("Faces +Z selected");
    expect(net()).toEqual(["+Z"]);
    expect(engine.scenes[0].getMeshByName("shagged-face-+Z")).not.toBeNull();
    // the face net reaches faces the camera can't see
    session.root.querySelector<HTMLButtonElement>('[data-face-net] button[data-face="-X"]')!.click();
    expect(net().sort()).toEqual(["+Z", "-X"].sort());

    session.root.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    await flush();
    await flush();
    const stripe = [...session.root.querySelectorAll<HTMLElement>(".shagged-tex__tile")].find((tile) =>
      tile.title.startsWith("blx/blx_white_stripe"),
    )!;
    stripe.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flush();
    const slab = session.document.snapshot().brushes[0];
    expect(slab.shader).toBe("blx/blx_grid"); // only the picked faces change
    expect(Object.keys(slab.faces!).sort()).toEqual(["+Z", "-X"].sort());
    expect(slab.faces!["+Z"]).toMatchObject({ shader: "blx/blx_white_stripe", size: [128, 32], scale: [0.5, 0.5] });
    expect(status()).toContain("to 2 faces");

    // A face that already has an alignment keeps it when only its texture changes.
    session.document.transact((data) => {
      data.brushes[0].faces!["+Z"]!.rotation = 45;
    });
    const floor = [...session.root.querySelectorAll<HTMLElement>(".shagged-tex__tile")].find((tile) =>
      tile.title.startsWith("boqu/floor"),
    )!;
    floor.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flush();
    expect(session.document.snapshot().brushes[0].faces!["+Z"]).toMatchObject({
      shader: "boqu/floor",
      rotation: 45,
      size: [256, 256],
    });

    // Alt+click samples the face's texture as the current texture, without touching the selection.
    click({ altKey: true });
    expect(session.root.querySelector("[data-current-texture]")!.textContent).toBe("boqu/floor");
    expect(status()).toContain("Sampled boqu/floor from face +Z");
    expect(net().sort()).toEqual(["+Z", "-X"].sort());

    // A plain click selects the brush and clears the faces.
    click();
    expect(net()).toEqual([]);
    expect(engine.scenes[0].getMeshByName("shagged-face-+Z")).toBeNull();
    session.dispose();
    engine.dispose();
  });

  it("aligns the selected faces from the inspector panel as one undo step, and wraps a texture around", () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    session.document.transact((data) =>
      data.brushes.push({
        id: "slab",
        min: { x: -256, y: -256, z: -16 },
        max: { x: 256, y: 256, z: 16 },
        shader: "blx/blx_grid",
        faces: { "+Z": naturalFace("boqu/floor", [256, 256]), "+X": naturalFace("blx/blx_white_stripe", [128, 32]) },
      }),
    );
    session.root.querySelector("[data-grid]")!.dispatchEvent(new Event("change"));
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    session.render();
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0, clientX: 200, clientY: 150, ctrlKey: true, shiftKey: true }),
      );
    }
    session.root.querySelector<HTMLButtonElement>('[data-face-net] button[data-face="+X"]')!.click();
    const faces = () => session.document.snapshot().brushes[0].faces!;
    const status = () => session.root.querySelector(".shagged__status")!.textContent!;
    const panel = (selector: string) =>
      session.root.querySelector<HTMLButtonElement>(`[data-face-alignment] ${selector}`)!;

    panel('[data-uv-nudge="shift-u:1"]').click();
    expect(faces()["+Z"]!.shift).toEqual([8, 0]);
    expect(faces()["+X"]!.shift).toEqual([8, 0]);
    expect(status()).toContain("Shift U +8 on 2 faces");
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(faces()["+Z"]!.shift).toEqual([0, 0]);
    expect(faces()["+X"]!.shift).toEqual([0, 0]);

    // the panel survives undo with the faces still selected, and wraps from the first one picked
    expect(panel('[data-uv-op="wrap"]').textContent).toBe("Wrap from +Z");
    panel('[data-uv-op="wrap"]').click();
    expect(faces()["+X"]).toMatchObject({ shader: "boqu/floor", size: [256, 256] });
    expect(faces()["+Z"]).toEqual(naturalFace("boqu/floor", [256, 256]));

    // a face still on the brush's fixed alignment locks the panel
    session.root.querySelector<HTMLButtonElement>('[data-face-net] button[data-face="-Y"]')!.click();
    expect(panel('[data-uv-op="fit"]').disabled).toBe(true);
    expect(session.root.querySelector("[data-face-alignment]")!.textContent).toContain(
      "Face -Y uses the brush's fixed alignment",
    );
    session.dispose();
    engine.dispose();
  });

  it("switches the 3D view to a textured preview whose UVs are the faces' ST, and back", async () => {
    const engine = new NullEngine();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const session = new EditorSession(engine, canvas, vi.fn());
    const rotated = {
      ...naturalFace("boqu/floor", [256, 256] as [number, number]),
      rotation: 30,
      shift: [5, 9] as [number, number],
    };
    session.document.transact((data) =>
      data.brushes.push({
        id: "slab",
        min: { x: -256, y: -256, z: -16 },
        max: { x: 256, y: 256, z: 16 },
        shader: "blx/blx_grid",
        faces: { "+Z": rotated },
      }),
    );
    session.root.querySelector("[data-grid]")!.dispatchEvent(new Event("change"));
    session.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    session.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    const scene = engine.scenes[0];
    const toggle = session.root.querySelector<HTMLButtonElement>('[data-action="view-mode"]')!;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    expect(toggle.textContent).toBe("Solid");
    expect(scene.getMeshByName("shagged-textured-boqu/floor")).toBeNull();

    toggle.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(toggle.textContent).toBe("Textured");
    const floor = scene.getMeshByName("shagged-textured-boqu/floor")!;
    const grid = scene.getMeshByName("shagged-textured-blx/blx_grid")!;
    const expected = shaderBatches(session.document.snapshot().brushes);
    const uvs = (mesh: typeof floor) => [...(mesh.getVerticesData("uv") ?? [])];
    expect(uvs(floor)).toEqual(expected[0].uvs);
    expect(uvs(grid)).toHaveLength(5 * 4 * 2);
    expect(floor.isPickable).toBe(false);
    // the brush box stays as the pick and selection layer, see-through until selected
    expect(scene.getMeshByName("slab")!.material!.alpha).toBe(0);

    // picking still works through the textured faces
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0, clientX: 200, clientY: 150, ctrlKey: true, shiftKey: true }),
      );
    }
    expect(session.root.querySelector(".shagged__status")!.textContent).toContain("Faces +Z selected");
    // the picked face's own overlay marks it, light enough to see its texture
    expect(scene.getMeshByName("slab")!.material!.alpha).toBe(0);
    expect(scene.getMeshByName("shagged-face-+Z")!.material!.alpha).toBe(0.18);

    toggle.click();
    await flush();
    expect(toggle.textContent).toBe("Solid");
    expect(scene.getMeshByName("shagged-textured-boqu/floor")).toBeNull();
    expect(scene.getMeshByName("slab")!.material!.alpha).toBe(0.82);
    // switching with a face selected restyles its overlay too
    expect(scene.getMeshByName("shagged-face-+Z")!.material!.alpha).toBe(0.6);
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
