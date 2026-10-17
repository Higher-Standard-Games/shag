import { describe, expect, it } from "vitest";
import { type EditorDocumentData, validateDocument } from "../../EditorDocument";
import { writeMap } from "../../MapWriter";
import { describeDocument } from "../AgentPipeline";
import { documentSnapshot, queryDocument } from "../DocumentInspection";

const doc: EditorDocumentData = {
  schemaVersion: 2,
  draftId: "inspection-fixture",
  revision: 7,
  mapName: "inspection",
  worldKeys: { ambient: "10", fog: "1500 0.15 0.1 0.22 256" },
  brushes: [
    {
      id: "wall",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 64, y: 64, z: 64 },
      shader: "common/caulk",
      detail: true,
      faces: { "+X": { shader: "metal/panel", shift: [12, 4], scale: [-0.5, 0.5], rotation: 45, size: [256, 128] } },
    },
  ],
  patches: [
    {
      id: "curve",
      shader: "metal/pipe",
      width: 3,
      height: 3,
      controlPoints: [0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => ({ x: 128 + col * 8, y: row * 8, z: 80, u: col / 2, v: row / 2 })),
      ),
    },
  ],
  entities: [
    { id: "spawn", classname: "info_player_deathmatch", origin: { x: 16, y: 16, z: 24 }, keys: { angle: "90" } },
    { id: "outside", classname: "light", origin: { x: 300, y: 300, z: 100 }, keys: { light: "300" } },
  ],
  brushEntities: [
    { id: "trim-group", classname: "func_group", brushIds: ["wall"], keys: { chamfer_convexwidth: "2" } },
  ],
};

describe("complete document inspection", () => {
  it("returns a detached, source-equivalent snapshot including every authoring field", () => {
    validateDocument(doc);
    const snapshot = documentSnapshot(doc).document;
    expect(snapshot).toEqual(doc);
    expect(writeMap(snapshot)).toBe(writeMap(doc));
    const info = describeDocument(doc, true);
    expect(info.brushes).toEqual(doc.brushes);
    expect(info.patches).toEqual(doc.patches);
    expect(info.brushEntities).toEqual(doc.brushEntities);
    snapshot.brushes[0].faces!["+X"]!.shift[0] = 999;
    snapshot.patches![0].controlPoints[0][0].x = 999;
    snapshot.worldKeys!.ambient = "99";
    expect(doc.brushes[0].faces!["+X"]!.shift[0]).toBe(12);
    expect(doc.patches![0].controlPoints[0][0].x).toBe(128);
    expect(doc.worldKeys!.ambient).toBe("10");
  });

  it("queries conservative spatial bounds with ownership and stable pagination", () => {
    const region = { min: { x: 0, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 } };
    const local = queryDocument(doc, { bounds: region, relation: "contained" });
    expect(local.objects.map((object) => object.data.id)).toEqual(["wall", "trim-group", "spawn"]);
    expect(local.objects[0].ownerId).toBe("trim-group");
    const first = queryDocument(doc, { limit: 2 });
    const second = queryDocument(doc, { limit: 2, offset: first.nextOffset! });
    const third = queryDocument(doc, { limit: 2, offset: second.nextOffset! });
    expect(new Set([...first.objects, ...second.objects, ...third.objects].map((object) => object.data.id)).size).toBe(
      5,
    );
    expect(third.nextOffset).toBeNull();
    const patch = queryDocument(doc, { ids: ["curve"] });
    expect(patch.objects[0].bounds).toEqual({ min: { x: 128, y: 0, z: 80 }, max: { x: 144, y: 16, z: 80 } });
    const touching = { min: { x: 64, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 } };
    expect(queryDocument(doc, { bounds: touching, kinds: ["brush"] }).total).toBe(1);
    expect(queryDocument(doc, { bounds: touching, kinds: ["brush"], relation: "contained" }).total).toBe(0);
  });

  it("rejects invalid ranges and query bounds without changing the source", () => {
    const before = writeMap(doc);
    expect(() => queryDocument(doc, { limit: 0 })).toThrow("limit");
    expect(() => queryDocument(doc, { offset: -1 })).toThrow("offset");
    expect(() => queryDocument(doc, { bounds: { min: { x: 2, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } } })).toThrow(
      "bounds",
    );
    expect(writeMap(doc)).toBe(before);
  });
});
