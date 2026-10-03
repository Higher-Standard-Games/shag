import { describe, expect, it } from "vitest";
import { EditorDocument } from "../EditorDocument";
import { EditorDraftStore, type EditorViewState } from "../EditorDraftStore";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "key" | "length"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const view: EditorViewState = {
  schemaVersion: 1,
  grid: 32,
  zoom: 2,
  tool: "select",
  selectedId: "box-1",
  activePlane: "xz",
  workPlanes: { x: 16, y: 128, z: 32 },
  viewCenter: { x: -128, y: 256, z: 64 },
  camera: { alpha: 1, beta: 1.2, radius: 800, target: { x: 16, y: 32, z: 48 } },
};

describe("editor local draft recovery", () => {
  it("restores content and view without incrementing the document revision", () => {
    const store = new EditorDraftStore(memoryStorage());
    const document = new EditorDocument();
    document.transact((data) =>
      data.brushes.push({
        id: "box-1",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 64, y: 64, z: 64 },
        shader: "blx/blx_grid",
      }),
    );
    const saved = document.snapshot();
    store.save(saved, view);
    const restored = store.load();
    expect(restored.document.snapshot()).toEqual(saved);
    expect(restored.view).toEqual(view);
    expect(restored.document.canUndo).toBe(false);
  });

  it("loads an existing content-only draft with default view state", () => {
    const storage = memoryStorage();
    const document = new EditorDocument();
    const data = document.snapshot();
    storage.setItem("shagged:active-draft:v1", data.draftId);
    storage.setItem(`shagged:draft:v1:${data.draftId}`, JSON.stringify(data));
    const restored = new EditorDraftStore(storage).load();
    expect(restored.document.snapshot()).toEqual(data);
    expect(restored.view).toBeNull();
    storage.setItem(`shagged:view:v1:${data.draftId}`, "not json");
    expect(new EditorDraftStore(storage).load().view).toBeNull();
  });

  it("rejects invalid view state and mismatched active draft IDs", () => {
    const storage = memoryStorage();
    const store = new EditorDraftStore(storage);
    const data = new EditorDocument().snapshot();
    expect(() => store.save(data, { ...view, zoom: Number.NaN })).toThrow("Invalid editor view state");
    storage.setItem("shagged:active-draft:v1", "another-id");
    storage.setItem("shagged:draft:v1:another-id", JSON.stringify(data));
    expect(() => store.load()).toThrow("Active draft ID does not match");
  });

  it("keeps a flycam pose and view mode, still accepts an orbit camera, and refuses a bad pose", () => {
    const store = new EditorDraftStore(memoryStorage());
    const data = new EditorDocument().snapshot();
    const fly: EditorViewState = {
      ...view,
      camera: { position: { x: 1, y: 2, z: 3 }, yaw: 270, pitch: -20 },
      viewMode: "wireframe",
    };
    store.save(data, fly);
    expect(store.load().view).toEqual(fly);
    store.save(data, view); // orbit camera from before the flycam
    expect(store.load().view?.camera).toEqual(view.camera);
    expect(() => store.save(data, { ...fly, camera: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 120 } })).toThrow(
      "Invalid editor view state",
    );
    expect(() => store.save(data, { ...fly, viewMode: "xray" as never })).toThrow("Invalid editor view state");
  });

  it("persists curve placement settings and rejects invalid extrusion depth", () => {
    const store = new EditorDraftStore(memoryStorage());
    const data = new EditorDocument().snapshot();
    const curves: EditorViewState = { ...view, tool: "patch", patchShape: "arch", patchDepth: -48, patchReverse: true };
    store.save(data, curves);
    expect(store.load().view).toEqual(curves);
    expect(() => store.save(data, { ...curves, patchDepth: 0 })).toThrow("Invalid editor view state");
    expect(() => store.save(data, { ...curves, patchShape: "tube" as never })).toThrow("Invalid editor view state");
  });

  it("lists named drafts and activates an older valid draft", () => {
    const storage = memoryStorage();
    const store = new EditorDraftStore(storage);
    const first = new EditorDocument().snapshot();
    const second = new EditorDocument().snapshot();
    store.save(first, { ...view, draftName: "First room" });
    store.save(second, { ...view, draftName: "Second room" });
    expect(store.list().map((draft) => [draft.name, draft.active])).toEqual([
      ["Second room", true],
      ["First room", false],
    ]);
    expect(store.get(first.draftId)?.document.snapshot()).toEqual(first);
    expect(store.get("missing")).toBeNull();
    expect(store.load().document.snapshot()).toEqual(second);
    const restored = store.activate(first.draftId);
    expect(restored.document.snapshot()).toEqual(first);
    expect(restored.view?.draftName).toBe("First room");
    expect(store.load().document.snapshot()).toEqual(first);
    expect(() => store.activate("missing")).toThrow("missing from local storage");
    expect(store.load().document.snapshot()).toEqual(first);
    storage.setItem("shagged:draft:v1:damaged", "not json");
    expect(store.list()).toHaveLength(2);
  });
});
