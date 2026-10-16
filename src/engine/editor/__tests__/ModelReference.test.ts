import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument, type PointEntity } from "../EditorDocument";
import { EDITOR_POINT_CLASSES, entityClass } from "../EntityCatalog";
import { writeMap } from "../MapWriter";
import { indexedModelPaths, modelReferenceIssue, validModelPath } from "../ModelReference";

const prop = (model: string): PointEntity => ({
  id: "crate",
  classname: "misc_model",
  origin: { x: 128, y: 64, z: 32 },
  keys: { model, angle: "90", modelscale: "1.5" },
});

describe("misc_model references", () => {
  it("offers the compiler class and writes a parseable reference without embedding mesh data", () => {
    expect(EDITOR_POINT_CLASSES.map((def) => def.classname)).toContain("misc_model");
    expect(entityClass("misc_model").keys.map((key) => key.name)).toEqual(["model", "angle", "modelscale"]);
    const document = new EditorDocument();
    document.transact((data) => data.entities.push(prop("models/mapobjects/crate/crate.md3")));
    const source = writeMap(document.snapshot());
    expect(source).toContain('"model" "models/mapobjects/crate/crate.md3"');
    expect(source).toContain('"modelscale" "1.5"');
    expect(source).not.toContain('"scale"');
    expect(MapParser.parse(source)[1].properties).toMatchObject({
      model: "models/mapobjects/crate/crate.md3",
      angle: "90",
      modelscale: "1.5",
    });
  });

  it("rejects empty, unsafe, and invalid model references at export", () => {
    for (const path of [
      "",
      "/models/prop.md3",
      "models/../secret.md3",
      "models/prop\\x.md3",
      "https://host/prop.glb",
    ]) {
      expect(validModelPath(path)).toBe(false);
      const document = new EditorDocument();
      document.transact((data) => data.entities.push(prop(path)));
      expect(() => writeMap(document.snapshot())).toThrow(/misc_model/);
    }
    expect(
      modelReferenceIssue({ ...prop("models/prop.md3"), keys: { model: "models/prop.md3", modelscale: "0" } }),
    ).toContain("modelscale");
  });

  it("exports compiler-native ASE props and preserves their placement keys", () => {
    const document = new EditorDocument();
    document.transact((data) => data.entities.push(prop("models/mapobjects/wdm5/wdm5_WallLamp1.ase")));
    expect(MapParser.parse(writeMap(document.snapshot()))[1].properties).toMatchObject({
      model: "models/mapobjects/wdm5/wdm5_WallLamp1.ase",
      angle: "90",
      modelscale: "1.5",
    });
    expect(validModelPath("models/../outside.ase")).toBe(false);
  });

  it("lists mounted model paths once and keeps loose paths enterable by hand", () => {
    const index = {
      findByPattern: () => [
        { file: "models/props/crate.md3", pk3: "a.pk3" },
        { file: "models/props/crate.md3", pk3: "b.pk3" },
        { file: "models/props/chair.glb", pk3: "a.pk3" },
        { file: "models/props/lamp.ase", pk3: "a.pk3" },
        { file: "models/../bad.md3", pk3: "a.pk3" },
      ],
    };
    expect(indexedModelPaths(index as never)).toEqual([
      "models/props/chair.glb",
      "models/props/crate.md3",
      "models/props/lamp.ase",
    ]);
  });
});
