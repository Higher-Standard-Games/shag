import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../api/Operations";
import { EditorDocument, validateDocument } from "../EditorDocument";
import {
  deleteSelection,
  duplicateSelection,
  expandSelection,
  groupSelection,
  moveSelection,
  ungroupSelection,
} from "../EditorSelection";
import { writeMap } from "../MapWriter";
import { describeDocument } from "../server/AgentPipeline";
import { queryDocument } from "../server/DocumentInspection";

function fixture() {
  const doc = emptyDocument("groupqa");
  doc.brushes = [
    { id: "a", min: { x: 0, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 }, shader: "common/caulk" },
    { id: "b", min: { x: 128, y: 0, z: 0 }, max: { x: 192, y: 64, z: 64 }, shader: "common/caulk" },
  ];
  doc.patches = [
    {
      id: "p",
      shader: "common/caulk",
      width: 3,
      height: 3,
      controlPoints: Array.from({ length: 3 }, (_, row) =>
        Array.from({ length: 3 }, (_, col) => ({ x: col * 16, y: row * 16, z: 80, u: col / 2, v: row / 2 })),
      ),
    },
  ];
  doc.entities = [{ id: "e", classname: "light", origin: { x: 96, y: 32, z: 128 }, keys: { light: "100" } }];
  return doc;
}
describe("editor object selections", () => {
  it("duplicates individual patches through the typed API without altering source UVs", () => {
    const doc = fixture();
    const copied = applyOperations(doc, [{ op: "object.duplicate", ids: ["p"], delta: { x: 8, y: 0, z: 0 } }]).doc;
    expect(copied.patches).toHaveLength(2);
    expect(copied.patches![1].controlPoints[0][0]).toEqual({ x: 8, y: 0, z: 80, u: 0, v: 0 });
    expect(copied.patches![0]).toEqual(doc.patches![0]);
  });
  it("saves flat mixed groups without changing compiler source or brush ownership", () => {
    const doc = fixture(),
      before = writeMap(doc);
    doc.brushEntities = [{ id: "door", classname: "func_door", keys: {}, brushIds: ["a", "b"] }];
    const ownedSource = writeMap(doc);
    groupSelection(doc, ["a", "p", "e"], "assembly", "Assembly");
    validateDocument(doc);
    expect(writeMap(doc)).toBe(ownedSource);
    expect(before).not.toBe(ownedSource);
    expect(expandSelection(doc, ["a"], true)).toEqual(["a", "p", "e"]);
    expect(expandSelection(doc, ["a"])).toEqual(["a"]);
    expect(queryDocument(doc, { kinds: ["editorGroup"] }).objects[0]).toMatchObject({
      data: { id: "assembly" },
      bounds: { max: { z: 128 } },
    });
    expect(describeDocument(doc, true).editorGroups).toEqual(doc.editorGroups);
  });
  it("moves mixed members only once when a group and one member overlap", () => {
    const doc = fixture();
    groupSelection(doc, ["a", "p", "e"], "g");
    moveSelection(doc, ["g", "a"], { x: 16, y: -8, z: 4 });
    validateDocument(doc);
    expect(doc.brushes[0].min).toEqual({ x: 16, y: -8, z: 4 });
    expect(doc.brushes[1].min.x).toBe(128);
    expect(doc.patches![0].controlPoints[0][0]).toEqual({ x: 16, y: -8, z: 84, u: 0, v: 0 });
    expect(doc.entities[0].origin).toEqual({ x: 112, y: 24, z: 132 });
  });
  it("duplicates groups and complete compiler owners independently, preserving originals", () => {
    const doc = fixture();
    doc.brushEntities = [{ id: "door", classname: "func_door", keys: { speed: "100" }, brushIds: ["a", "b"] }];
    groupSelection(doc, ["a", "b", "p", "e"], "g");
    const original = structuredClone(doc);
    const copies = duplicateSelection(doc, ["g"], { x: 16, y: 0, z: 0 }, (id) => `copy-${id}`);
    validateDocument(doc);
    expect(copies).toHaveLength(4);
    expect(doc.brushEntities).toHaveLength(2);
    expect(doc.brushEntities![0]).toEqual(original.brushEntities![0]);
    expect(doc.brushEntities![1]).toMatchObject({ id: "copy-door", brushIds: ["copy-a", "copy-b"] });
    expect(doc.editorGroups![1].objectIds).toEqual(["copy-a", "copy-b", "copy-p", "copy-e"]);
    expect(doc.patches![1].controlPoints[0][0]).toMatchObject({ x: 16, u: 0, v: 0 });
  });
  it("joins partial compiler owners only when requested and ungroups without deleting geometry", () => {
    const doc = fixture();
    doc.brushEntities = [{ id: "door", classname: "func_door", keys: {}, brushIds: ["a", "b"] }];
    duplicateSelection(doc, ["a"], { x: 16, y: 0, z: 0 }, (id) => `copy-${id}`);
    expect(doc.brushEntities![0].brushIds).toEqual(["a", "b", "copy-a"]);
    groupSelection(doc, ["a", "b"], "g");
    ungroupSelection(doc, ["a"]);
    expect(doc.editorGroups).toEqual([]);
    expect(doc.brushes).toHaveLength(3);
  });
  it("prunes deleted members, drops singleton groups, and restores groups through undo", () => {
    const doc = fixture();
    groupSelection(doc, ["a", "b", "p"], "g");
    const document = new EditorDocument(doc);
    document.transact((draft) => deleteSelection(draft, ["a"]));
    expect(document.snapshot().editorGroups![0].objectIds).toEqual(["b", "p"]);
    document.transact((draft) => deleteSelection(draft, ["g"]));
    expect(document.snapshot().editorGroups).toEqual([]);
    expect(document.snapshot().brushes).toHaveLength(0);
    document.undo();
    expect(document.snapshot().editorGroups).toHaveLength(1);
    document.undo();
    expect(document.snapshot().editorGroups![0].objectIds).toHaveLength(3);
  });
  it("rejects malformed groups atomically and merges existing groups without nesting", () => {
    const doc = fixture(),
      before = structuredClone(doc);
    expect(() => applyOperations(doc, [{ op: "editorGroup.create", id: "bad", objectIds: ["a", "missing"] }])).toThrow(
      /no object/,
    );
    expect(doc).toEqual(before);
    groupSelection(doc, ["a", "b"], "one");
    groupSelection(doc, ["p", "e"], "two");
    groupSelection(doc, ["a", "p"], "both");
    validateDocument(doc);
    expect(doc.editorGroups).toHaveLength(1);
    expect(doc.editorGroups![0].objectIds).toHaveLength(4);
    doc.editorGroups!.push({ id: "duplicate", name: "Bad", objectIds: ["a", "e"] });
    expect(() => validateDocument(doc)).toThrow(/already grouped/);
  });
  it("exposes group creation, move, duplicate, ungroup and deletion through typed operations", () => {
    const doc = applyOperations(fixture(), [
      { op: "editorGroup.create", id: "g", objectIds: ["a", "b", "p", "e"] },
      { op: "object.move", ids: ["g", "a"], delta: { x: 8, y: 0, z: 0 } },
      { op: "object.duplicate", ids: ["g"], delta: { x: 16, y: 0, z: 0 } },
    ]).doc;
    expect(doc.brushes[0].min.x).toBe(8);
    expect(doc.patches).toHaveLength(2);
    expect(doc.editorGroups).toHaveLength(2);
    const ungrouped = applyOperations(doc, [{ op: "editorGroup.ungroup", ids: ["g-copy"] }]).doc;
    expect(ungrouped.editorGroups).toHaveLength(1);
    const deleted = applyOperations(ungrouped, [{ op: "object.delete", ids: ["g"] }]).doc;
    expect(deleted.brushes).toHaveLength(2);
    expect(deleted.editorGroups).toEqual([]);
  });
  it("keeps carved pieces in their editor group", () => {
    const doc = fixture();
    groupSelection(doc, ["a", "b"], "g");
    const carved = applyOperations(doc, [
      { op: "brush.carve", min: { x: 16, y: 16, z: -8 }, max: { x: 48, y: 48, z: 72 } },
    ]).doc;
    expect(carved.editorGroups![0].objectIds).toEqual(carved.brushes.map((b) => b.id));
    validateDocument(carved);
  });
});
