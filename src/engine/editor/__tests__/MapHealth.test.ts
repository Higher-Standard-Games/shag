import { describe, expect, it } from "vitest";
import type { BoxBrush, BrushEntity, EditorDocumentData, PointEntity } from "../EditorDocument";
import { inspectMapHealth } from "../MapHealth";
import type { TextureEntry } from "../TextureCatalog";

const brush = (id: string, shader = "blx/floor"): BoxBrush => ({
  id,
  min: { x: 0, y: 0, z: 0 },
  max: { x: 64, y: 64, z: 64 },
  shader,
});
const point = (id: string, classname: string, keys: Record<string, string> = {}): PointEntity => ({
  id,
  classname,
  origin: { x: 0, y: 0, z: 32 },
  keys,
});
const document = (entities: PointEntity[] = [], brushEntities: BrushEntity[] = []): EditorDocumentData => ({
  schemaVersion: 2,
  draftId: "health-test",
  revision: 0,
  brushes: [brush("box")],
  entities,
  brushEntities,
});
const texture = (name: string, missing = false): TextureEntry => ({
  name,
  folder: "blx",
  image: missing ? null : `textures/${name}.jpg`,
  hasShader: true,
  tags: [],
  compiler: false,
  sky: false,
  transparent: false,
  nolightmap: false,
  fog: false,
  solidColor: false,
  missing,
});

describe("map health", () => {
  it("warns when no playable spawn exists, accepting generic and team spawn classes", () => {
    expect(inspectMapHealth(document()).some((issue) => issue.code === "no-spawn")).toBe(true);
    for (const classname of ["info_player_start", "info_player_deathmatch", "team_CTF_alphaspawn"]) {
      expect(inspectMapHealth(document([point("spawn", classname)])).some((issue) => issue.code === "no-spawn")).toBe(
        false,
      );
    }
  });

  it("links issues to stable entity IDs without changing the document", () => {
    const data = document(
      [point("spawn", "info_player_start"), point("destination", "target_position", { targetname: "pad" })],
      [{ id: "trigger", classname: "trigger_teleport", keys: { target: "missing" }, brushIds: ["box"] }],
    );
    const original = structuredClone(data);
    expect(inspectMapHealth(data)).toContainEqual({
      code: "unresolved-target",
      severity: "warning",
      message: 'trigger_teleport targets missing "missing".',
      objectId: "trigger",
    });
    expect(data).toEqual(original);
    data.brushEntities![0].keys.target = "pad";
    expect(inspectMapHealth(data).some((issue) => issue.code === "unresolved-target")).toBe(false);
  });

  it("reports required keys and invalid model references, while unknown classes are advisory", () => {
    const data = document([
      point("model", "misc_model", { model: "models/../outside.md3" }),
      point("custom", "mod_custom_entity"),
    ]);
    const issues = inspectMapHealth(data);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-model", objectId: "model", severity: "warning" }),
        expect.objectContaining({ code: "unknown-class", objectId: "custom", severity: "info" }),
      ]),
    );
    data.entities[0].keys = {};
    expect(inspectMapHealth(data)).toContainEqual(expect.objectContaining({ code: "required-key", objectId: "model" }));
  });

  it("diagnoses individual faces against an optional mounted texture catalog", () => {
    const data = document([point("spawn", "info_player_start")]);
    data.brushes[0].faces = {
      "+X": { shader: "blx/missing", shift: [0, 0], scale: [1, 1], rotation: 0, size: [128, 128] },
      "-X": { shader: "blx/broken", shift: [0, 0], scale: [1, 1], rotation: 0, size: [128, 128] },
    };
    expect(inspectMapHealth(data).some((issue) => issue.code === "unknown-shader")).toBe(false);
    const issues = inspectMapHealth(data, [texture("blx/floor"), texture("blx/broken", true)]);
    expect(issues).toContainEqual(expect.objectContaining({ code: "unknown-shader", objectId: "box", face: "+X" }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "missing-shader-image", objectId: "box", face: "-X" }),
    );
    expect(issues.filter((issue) => issue.code === "unknown-shader")).toHaveLength(1);
  });

  it("labels shared target names as advisory because multi-target patterns may be intentional", () => {
    const issues = inspectMapHealth(
      document([
        point("spawn", "info_player_start"),
        point("a", "target_position", { targetname: "shared" }),
        point("b", "target_position", { targetname: "shared" }),
      ]),
    );
    expect(issues.filter((issue) => issue.code === "duplicate-targetname")).toEqual([
      expect.objectContaining({ severity: "info", objectId: "a" }),
      expect.objectContaining({ severity: "info", objectId: "b" }),
    ]);
  });
});
