/**
 * Point entities in the SHAGGED document: the class catalog read from the
 * Washoi entities.def, the version 1 → 2 draft migration, validation of what
 * a .map value can hold, and deterministic export.
 */

import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument, type EditorDocumentDataV1, type PointEntity } from "../EditorDocument";
import { entityClass, POINT_ENTITY_CLASSES, parseEntityDefs } from "../EntityCatalog";
import { writeMap } from "../MapWriter";

const spawn = (id: string, keys: Record<string, string> = {}): PointEntity => ({
  id,
  classname: "info_player_deathmatch",
  origin: { x: 0, y: 0, z: 24 },
  keys,
});

describe("entity catalog", () => {
  it("offers the gameplay point classes from the Washoi definitions, with their keys", () => {
    const names = POINT_ENTITY_CLASSES.map((entity) => entity.classname);
    expect(names).toContain("info_player_deathmatch");
    expect(names).toContain("light");
    expect(names).toContain("weapon_rocketlauncher");
    expect(names).toContain("item_armor_ra");
    expect(names).toContain("target_position");

    const light = entityClass("light");
    expect(light.section).toBe("LIGHTS");
    expect(light.mins).toEqual({ x: -16, y: -16, z: -16 });
    expect(light.maxs).toEqual({ x: 16, y: 16, z: 32 });
    expect(light.keys.find((key) => key.name === "light")).toEqual({
      name: "light",
      label: "Intensity",
      defaultValue: "300",
    });
    // origin is an editor field, not a free key
    expect(light.keys.some((key) => key.name === "origin")).toBe(false);
  });

  it("leaves out brush classes and the compiler-only and raw-.map-only sections", () => {
    const names = POINT_ENTITY_CLASSES.map((entity) => entity.classname);
    for (const excluded of ["worldspawn", "trigger_teleport", "func_door", "func_group", "misc_model", "info_npc"]) {
      expect(names).not.toContain(excluded);
    }
  });

  it("parses a definition block's colour, box, section and defaults", () => {
    const [parsed] = parseEntityDefs(
      [
        "// -----------------------------------------------------------------------------",
        "//  TEST SECTION  (point entities)",
        "// -----------------------------------------------------------------------------",
        "/*QUAKED thing (1 .5 0) (-8 -8 0) (8 8 16) ?",
        "  -------- KEYS --------",
        "  origin:",
        "  speed: Speed (default: 40)",
        "  speed: Duplicate line is ignored",
        "*/",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      classname: "thing",
      section: "TEST SECTION",
      color: [1, 0.5, 0],
      mins: { x: -8, y: -8, z: 0 },
      maxs: { x: 8, y: 8, z: 16 },
      keys: [{ name: "speed", label: "Speed", defaultValue: "40" }],
    });
  });

  it("gives an unknown classname a neutral marker instead of failing", () => {
    expect(entityClass("mod_custom_thing")).toMatchObject({ classname: "mod_custom_thing", section: "Other" });
  });
});

describe("document entities", () => {
  it("migrates a version 1 draft's test spawn into a spawn entity", () => {
    const v1: EditorDocumentDataV1 = {
      schemaVersion: 1,
      draftId: "draft-1",
      revision: 7,
      brushes: [],
      testSpawn: { x: 1, y: 2, z: 48 },
    };
    const data = new EditorDocument(v1).snapshot();
    expect(data.schemaVersion).toBe(2);
    expect(data.revision).toBe(7);
    expect(data.entities).toEqual([
      { id: "test-spawn", classname: "info_player_deathmatch", origin: { x: 1, y: 2, z: 48 }, keys: {} },
    ]);
    expect("testSpawn" in data).toBe(false);
  });

  it("rejects a value a .map cannot hold, a reserved key, and an ID shared with a brush", () => {
    const document = new EditorDocument();
    const reject = (entity: PointEntity) =>
      expect(() => document.transact((data) => data.entities.push(entity))).toThrow();
    reject(spawn("quote", { message: 'say "hi"' }));
    reject(spawn("newline", { message: "two\nlines" }));
    reject(spawn("reserved", { origin: "0 0 0" }));
    reject(spawn("badkey", { "bad key": "1" }));
    reject({ ...spawn("world"), classname: "worldspawn" });
    document.transact((data) =>
      data.brushes.push({ id: "shared", min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 8, z: 8 }, shader: "blx/blx_grid" }),
    );
    reject(spawn("shared"));
    expect(document.snapshot().entities).toHaveLength(0);
  });

  it("keeps keys the catalog doesn't know", () => {
    const document = new EditorDocument();
    document.transact((data) => data.entities.push(spawn("a", { angle: "90", _mod_flag: "on" })));
    expect(document.snapshot().entities[0].keys).toEqual({ angle: "90", _mod_flag: "on" });
  });
});

describe("entity export", () => {
  it("writes classname, origin, then keys in name order, entities in ID order", () => {
    const document = new EditorDocument();
    document.transact((data) => {
      data.entities.push(
        { id: "b", classname: "light", origin: { x: 0, y: 0, z: 128 }, keys: { light: "300", _color: "1 0.5 0" } },
        spawn("a", { angle: "90" }),
      );
    });
    const snapshot = document.snapshot();
    const source = writeMap(snapshot);
    expect(source).toBe(writeMap({ ...snapshot, entities: [...snapshot.entities].reverse() }));
    expect(source).toContain(
      [
        "{",
        '"classname" "info_player_deathmatch"',
        '"origin" "0 0 24"',
        '"angle" "90"',
        "}",
        "{",
        '"classname" "light"',
        '"origin" "0 0 128"',
        '"_color" "1 0.5 0"',
        '"light" "300"',
        "}",
      ].join("\n"),
    );
    const parsed = MapParser.parse(source);
    expect(parsed.map((entity) => entity.classname)).toEqual(["worldspawn", "info_player_deathmatch", "light"]);
    expect(parsed[2].properties.light).toBe("300");
  });
});
