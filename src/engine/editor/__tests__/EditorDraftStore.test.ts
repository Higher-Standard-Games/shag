import { describe, expect, it } from "vitest";
import { EditorDocument } from "../EditorDocument";
import { EditorDraftStore, type EditorViewState } from "../EditorDraftStore";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const view: EditorViewState = {
  schemaVersion: 1,
  grid: 32,
  zoom: 2,
  tool: "select",
  selectedId: "box-1",
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
});
