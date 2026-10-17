import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../api/Operations";
import { BRUSH_ENTITY_CLASSES, EDITOR_POINT_CLASSES, entityClass } from "../EntityCatalog";
import { inspectMapHealth } from "../MapHealth";
import { writeMap } from "../MapWriter";

describe("compiler entity discovery", () => {
  it("offers compiler classes with the correct placement kind and supported keys", () => {
    expect(BRUSH_ENTITY_CLASSES.find((c) => c.classname === "func_group")?.compilerOnly).toBe(true);
    expect(EDITOR_POINT_CLASSES.some((c) => c.classname === "func_group")).toBe(false);
    expect(entityClass("misc_decal").keys.map((k) => k.name)).toEqual(
      expect.arrayContaining(["angles", "rotate", "distance", "vertexalpha"]),
    );
    expect(entityClass("misc_text_decal").keys.map((k) => k.name)).toContain("font");
    expect(entityClass("misc_model").compilerOnly).toBe(true);
    expect(entityClass("info_player_deathmatch").compilerOnly).toBeUndefined();
  });
  it("exports grouped chamfers and projected decals without unlisted-class warnings", () => {
    const doc = applyOperations(emptyDocument("catalog_test"), [
      { op: "box.create", id: "wall", min: { x: 0, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 } },
      { op: "brushEntity.assign", classname: "func_group", brushIds: ["wall"], keys: { chamfer_convexwidth: "2.2" } },
      {
        op: "entity.place",
        classname: "misc_decal",
        origin: { x: 8, y: 8, z: 80 },
        keys: { shader: "textures/decals/test", angles: "90 0 0", distance: "24" },
      },
      {
        op: "entity.place",
        classname: "misc_text_decal",
        origin: { x: 8, y: 8, z: 80 },
        keys: { text: "SECTOR 7", font: "fonts/sign.font" },
      },
    ]).doc;
    expect(inspectMapHealth(doc).filter((issue) => issue.code === "unknown-class")).toEqual([]);
    const exported = writeMap(doc);
    expect(exported).toContain('"chamfer_convexwidth" "2.2"');
    expect(exported).toContain('"font" "fonts/sign.font"');
    const missing = structuredClone(doc);
    missing.entities[0].keys = {};
    expect(inspectMapHealth(missing).some((issue) => issue.code === "required-key")).toBe(true);
  });
});
