import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";

const box = (id: string) => ({
  id,
  min: { x: -64, y: -32, z: 0 },
  max: { x: 64, y: 32, z: 16 },
  shader: "blx/blx_grid",
});

describe("SHAGGED document and source export", () => {
  it("commits a gesture once and restores content through undo/redo with new revisions", () => {
    const document = new EditorDocument();
    document.transact((draft) => {
      draft.brushes.push(box("a"));
    });
    expect(document.snapshot().brushes).toHaveLength(1);
    const firstRevision = document.snapshot().revision;
    document.undo();
    expect(document.snapshot().brushes).toHaveLength(0);
    expect(document.snapshot().revision).toBeGreaterThan(firstRevision);
    document.redo();
    expect(document.snapshot().brushes).toHaveLength(1);
  });

  it("rejects collapsed brushes without altering the saved snapshot", () => {
    const document = new EditorDocument();
    expect(() =>
      document.transact((draft) => {
        draft.brushes.push({ ...box("bad"), max: { x: -64, y: 32, z: 16 } });
      }),
    ).toThrow();
    expect(document.snapshot().brushes).toHaveLength(0);
    expect(document.snapshot().revision).toBe(0);
  });

  it("writes deterministic brushDef source that the raw parser recognizes", () => {
    const document = new EditorDocument();
    document.transact((draft) => {
      draft.brushes.push(box("z"), box("a"));
    });
    const snapshot = document.snapshot();
    const source = writeMap(snapshot);
    expect(source).toBe(writeMap({ ...snapshot, brushes: [...snapshot.brushes].reverse(), revision: 999 }));
    expect(source).toContain("brushDef");
    const parsed = MapParser.parse(source);
    expect(parsed[0].classname).toBe("worldspawn");
    expect(parsed[0].brushes).toHaveLength(2);
    expect(parsed[0].brushes[0].planes).toHaveLength(6);
  });
});
