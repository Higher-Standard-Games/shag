import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRUSH_ENTITY_CLASSES,
  clearGameEntityCatalog,
  EDITOR_POINT_CLASSES,
  entityClass,
  missingRequiredKeys,
  POINT_ENTITY_CLASSES,
  parseBrushEntityDefs,
  parseEntityDefs,
  registerGameEntityCatalog,
} from "../EntityCatalog";
import { inspectMapHealth } from "../MapHealth";

const definitions = [
  "// -----------------------------------------------------------------------------",
  "//  TEST GAME",
  "/*QUAKED test_point (1 .5 0) (-8 -8 0) (8 8 16) ?",
  "  -------- KEYS --------",
  "  destination: Link -- required",
  "*/",
  "/*QUAKED test_volume (0 1 0) ?",
  "  -------- KEYS --------",
  "  strength: Strength (default: 5)",
  "*/",
].join("\n");

beforeEach(clearGameEntityCatalog);
afterEach(clearGameEntityCatalog);

const install = () =>
  registerGameEntityCatalog({
    pointClasses: parseEntityDefs(definitions),
    brushClasses: parseBrushEntityDefs(definitions),
  });

describe("game entity catalog boundary", () => {
  it("provides compiler classes and neutral unknown markers without a game", () => {
    expect(POINT_ENTITY_CLASSES).toEqual([]);
    expect(EDITOR_POINT_CLASSES.some((entry) => entry.classname === "misc_model")).toBe(true);
    expect(BRUSH_ENTITY_CLASSES.some((entry) => entry.classname === "func_group")).toBe(true);
    expect(entityClass("test_point")).toMatchObject({ section: "Other", keys: [] });
  });

  it("updates retained palettes, lookup and health checks after their modules were imported", () => {
    const retained = EDITOR_POINT_CLASSES;
    install();
    expect(EDITOR_POINT_CLASSES).toBe(retained);
    expect(retained[0].classname).toBe("test_point");
    expect(BRUSH_ENTITY_CLASSES[0].classname).toBe("test_volume");
    expect(missingRequiredKeys("test_point", {})).toEqual(["destination"]);
    const doc = {
      schemaVersion: 2 as const,
      draftId: "catalog",
      revision: 0,
      brushes: [],
      entities: [{ id: "point", classname: "test_point", origin: { x: 0, y: 0, z: 0 }, keys: {} }],
      brushEntities: [{ id: "volume", classname: "test_volume", keys: {}, brushIds: [] }],
    };
    expect(inspectMapHealth(doc).filter((issue) => issue.code === "unknown-class")).toEqual([]);
    expect(inspectMapHealth(doc)).toContainEqual(expect.objectContaining({ code: "required-key", objectId: "point" }));
    clearGameEntityCatalog();
    expect(retained.some((entry) => entry.classname === "test_point")).toBe(false);
    expect(inspectMapHealth(doc).filter((issue) => issue.code === "unknown-class")).toHaveLength(2);
    expect(missingRequiredKeys("test_point", {})).toEqual([]);
  });

  it("replaces registration without duplicates and retains compiler precedence", () => {
    install();
    const first = [...EDITOR_POINT_CLASSES];
    install();
    expect(EDITOR_POINT_CLASSES).toEqual(first);
    registerGameEntityCatalog({
      pointClasses: [{ ...entityClass("test_point"), classname: "misc_model" }],
      brushClasses: [],
    });
    expect(entityClass("test_point").section).toBe("Other");
    expect(entityClass("misc_model").compilerOnly).toBe(true);
    expect(BRUSH_ENTITY_CLASSES.some((entry) => entry.classname === "test_volume")).toBe(false);
  });
});
