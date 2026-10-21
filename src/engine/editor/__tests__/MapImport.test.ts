import { describe, expect, it } from "vitest";
import { MapGenerator } from "../../../tools/MapGenerator";
import { hullWorldVertices, planeTextureAxes, polygonNormal, prismBrush, rotateBrush } from "../ConvexBrush";
import {
  type BoxBrush,
  type EditorDocumentData,
  type FaceKey,
  type FaceMaterial,
  type Vec3q,
  validateDocument,
} from "../EditorDocument";
import { FACE_AXES, FIXED_MATRIX, faceTexMatrix, type TexMatrix } from "../FaceUv";
import { importMapSource } from "../MapImport";
import { matchesMapSource, writeMap } from "../MapWriter";

const SIZES: Record<string, [number, number]> = {
  "blx/blx_dark": [128, 64],
  "blx/blx_light": [256, 256],
  "base_floor/tile": [64, 64],
  "base_floor/ramp": [64, 64],
  "base_wall/metal": [128, 64],
};
const textureSize = (shader: string) => SIZES[shader];
const options = { draftId: "imported", textureSize };

const face = (shader: string, extra: Partial<FaceMaterial> = {}): FaceMaterial => ({
  shader,
  shift: [0, 0],
  scale: [0.5, 0.5],
  rotation: 0,
  size: SIZES[shader],
  ...extra,
});
const box = (id: string, min: Vec3q, max: Vec3q, extra: Partial<BoxBrush> = {}): BoxBrush => ({
  id,
  min,
  max,
  shader: "blx/blx_grid",
  ...extra,
});

function document(): EditorDocumentData {
  return {
    schemaVersion: 2,
    draftId: "original",
    revision: 3,
    worldKeys: { message: "Round trip", _keepLights: "1" },
    brushes: [
      box(
        "a-floor",
        { x: -256, y: -256, z: -16 },
        { x: 256, y: 256, z: 0 },
        {
          faces: {
            "+Z": face("blx/blx_dark", { shift: [16, 8], scale: [0.25, -0.5], rotation: 30 }),
            "-X": face("blx/blx_light", { shift: [3.5, 0], scale: [1, 2], rotation: 300, skew: 15 }),
          },
        },
      ),
      box("b-detail", { x: 0, y: 0, z: 0 }, { x: 32, y: 32, z: 64 }, { detail: true, shader: "blx/blx_light" }),
      box("c-trigger-1", { x: 64, y: 0, z: 0 }, { x: 128, y: 64, z: 96 }, { shader: "common/trigger" }),
      box("c-trigger-2", { x: 128, y: 0, z: 0 }, { x: 160, y: 64, z: 96 }, { shader: "common/trigger" }),
    ],
    patches: [
      {
        id: "d-patch",
        shader: "blx/blx_grid",
        width: 3,
        height: 5,
        controlPoints: Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 3 }, (_, col) => ({
            x: col * 32,
            y: row * 16,
            z: (row * col) % 3,
            u: col / 2,
            v: row / 4,
          })),
        ),
      },
    ],
    entities: [
      { id: "f-spawn", classname: "info_player_deathmatch", origin: { x: 0, y: 0, z: 24 }, keys: { angle: "90" } },
      {
        id: "g-light",
        classname: "light",
        origin: { x: 8, y: -8.5, z: 192 },
        keys: { light: "300", _color: "1 0.5 0" },
      },
    ],
    brushEntities: [
      {
        id: "e-trigger",
        classname: "trigger_multiple",
        keys: { target: "t1", wait: "2" },
        brushIds: ["c-trigger-1", "c-trigger-2"],
      },
    ],
  };
}

/** Planes and alignment of every side, independent of vertex order and IDs. */
function sideSignature(brush: BoxBrush): string[] {
  const vertices = hullWorldVertices(brush);
  return brush
    .hull!.sides.map((side) => {
      const n = polygonNormal(side.vertices.map((i) => vertices[i]));
      const d =
        n.x * vertices[side.vertices[0]].x + n.y * vertices[side.vertices[0]].y + n.z * vertices[side.vertices[0]].z;
      const m: TexMatrix = side.material ? faceTexMatrix(side.material) : FIXED_MATRIX;
      const round = (v: number) => (Math.round(v * 1e4) / 1e4 || 0).toString();
      const offset = (v: number) => round(v - Math.floor(v + 1e-9));
      return [n.x, n.y, n.z, d, m[0][0], m[0][1], m[1][0], m[1][1]]
        .map(round)
        .concat(offset(m[0][2]), offset(m[1][2]), side.material?.shader ?? brush.shader)
        .join(" ");
    })
    .sort();
}
const corners = (brush: BoxBrush): string[] =>
  hullWorldVertices(brush)
    .map((v) => [v.x, v.y, v.z].map((n) => (Math.round(n * 1e5) / 1e5 || 0).toString()).join(" "))
    .sort();

/** Normalised texture coordinate (fraction of a repeat dropped) at a point of a face. */
function st(material: FaceMaterial, axes: { u: Vec3q; v: Vec3q }, p: Vec3q): [number, number] {
  const m = faceTexMatrix(material);
  const u = p.x * axes.u.x + p.y * axes.u.y + p.z * axes.u.z;
  const v = p.x * axes.v.x + p.y * axes.v.y + p.z * axes.v.z;
  return [m[0][0] * u + m[0][1] * v + m[0][2], m[1][0] * u + m[1][1] * v + m[1][2]];
}
const boxAxes = (key: FaceKey) => ({ u: FACE_AXES[key].texX, v: FACE_AXES[key].texY });
const frac = (n: number) => Math.round((n - Math.floor(n)) * 1e9) / 1e9;

describe("SHAGGED .map import", () => {
  it("round-trips boxes, face materials, detail, a patch, point and brush entities and world keys", () => {
    const source = writeMap(document());
    const { data, issues } = importMapSource(source, { ...options, mapName: "round_trip" });
    expect(issues).toEqual([]);
    expect(() => validateDocument(data)).not.toThrow();
    expect(matchesMapSource(data, source)).toBe(true);
    expect(data).toMatchObject({ schemaVersion: 2, draftId: "imported", mapName: "round_trip", revision: 0 });
    expect(data.worldKeys).toEqual(document().worldKeys);
    const floor = data.brushes[0];
    expect(floor.min).toEqual({ x: -256, y: -256, z: -16 });
    expect(floor.hull).toBeUndefined();
    expect(floor.faces).toEqual(document().brushes[0].faces);
    expect(data.brushes[1]).toMatchObject({ detail: true, shader: "blx/blx_light" });
    expect(data.brushes[1].faces).toBeUndefined();
    expect(data.patches![0]).toMatchObject({
      width: 3,
      height: 5,
      controlPoints: document().patches![0].controlPoints,
    });
    expect(data.brushEntities).toEqual([
      {
        id: expect.any(String),
        classname: "trigger_multiple",
        keys: { target: "t1", wait: "2" },
        brushIds: [data.brushes[2].id, data.brushes[3].id],
      },
    ]);
    expect(data.entities.map(({ classname, origin, keys }) => ({ classname, origin, keys }))).toEqual(
      document().entities.map(({ classname, origin, keys }) => ({ classname, origin, keys })),
    );
    const ids = [...data.brushes, ...data.patches!, ...data.entities, ...data.brushEntities!].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect({ ...importMapSource(source, options).data, mapName: "round_trip" }).toEqual(data);
  });

  it("keeps brushDef alignment exact without image sizes, marking the sizes unknown", () => {
    const source = writeMap(document());
    const { data, issues } = importMapSource(source, { draftId: "imported" });
    expect(issues).toEqual([]);
    expect(matchesMapSource(data, source)).toBe(true);
    expect(data.brushes[0].faces!["+Z"]).toMatchObject({ shader: "blx/blx_dark", size: [64, 64], sizeKnown: false });
  });

  it("round-trips convex hulls with side materials", () => {
    const wedge = prismBrush(
      "h-wedge",
      [
        { x: 0, y: 0 },
        { x: 128, y: 0 },
        { x: 0, y: 96 },
      ],
      0,
      64,
      "blx/blx_grid",
    );
    wedge.hull!.sides[2].material = face("blx/blx_dark", { rotation: 45, shift: [8, 0] });
    const pillar = rotateBrush(box("i-pillar", { x: 200, y: 0, z: 0 }, { x: 264, y: 32, z: 128 }), "z", 30);
    const doc: EditorDocumentData = {
      ...document(),
      brushes: [wedge, pillar],
      patches: [],
      entities: [],
      brushEntities: [],
    };
    const source = writeMap(doc);
    const { data, issues } = importMapSource(source, options);
    expect(issues).toEqual([]);
    expect(data.brushes).toHaveLength(2);
    for (const [index, original] of doc.brushes.entries()) {
      const imported = data.brushes[index];
      expect(imported.hull).toBeDefined();
      expect(corners(imported)).toEqual(corners(original));
      expect(sideSignature(imported)).toEqual(sideSignature(original));
    }
    expect(data.brushes[0].hull!.sides.find((side) => side.material)!.material).toMatchObject({
      shader: "blx/blx_dark",
      rotation: 45,
      shift: [8, 0],
      scale: [0.5, 0.5],
      size: [128, 64],
    });
    // Once imported, the source is stable: export and import again reproduce it byte for byte.
    const again = writeMap(data);
    expect(writeMap(importMapSource(again, options).data)).toBe(again);
  });

  it("imports a classic Quake 3 map, converting standard texture alignment as q3map2 does", () => {
    const { data, issues } = importMapSource(CLASSIC, options);
    expect(() => validateDocument(data)).not.toThrow();
    expect(data.worldKeys).toEqual({ message: "Classic test", _blocksize: "0 0 0" });

    const slab = data.brushes[0];
    expect(slab).toMatchObject({ min: { x: 0, y: 0, z: -16 }, max: { x: 256, y: 256, z: 0 }, shader: "common/caulk" });
    expect(slab.detail).toBe(true);
    // Floor, rotated 90°, scale 0.5, shift 16 on a 64² image: s = y/32 + 0.25, t = x/32.
    const top = slab.faces!["+Z"]!;
    expect(top).toMatchObject({ shader: "base_floor/tile", size: [64, 64] });
    expect(top.sizeKnown).toBeUndefined();
    const [s0, t0] = st(top, boxAxes("+Z"), { x: 32, y: 64, z: 0 });
    const [s1, t1] = st(top, boxAxes("+Z"), { x: 40, y: 72, z: 0 });
    expect([frac(s0), frac(t0)]).toEqual([0.25, 0]);
    expect([s1 - s0, t1 - t0].map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0.25, 0.25]);
    // West-wall axes on a 128×64 image at scale 1: s = y/128, t = -z/64.
    const wall = slab.faces!["+X"]!;
    const [ws, wt] = st(wall, boxAxes("+X"), { x: 256, y: 32, z: -8 });
    expect([frac(ws), frac(wt)]).toEqual([0.25, 0.125]);

    const ramp = data.brushes[1];
    expect(ramp.hull?.sides).toHaveLength(5);
    expect(corners(ramp)).toEqual(["0 0 0", "0 64 0", "128 0 0", "128 0 64", "128 64 0", "128 64 64"].sort());
    const vertices = hullWorldVertices(ramp);
    const slope = ramp.hull!.sides.find((side) => side.material?.shader === "base_floor/ramp")!;
    const axes = planeTextureAxes(polygonNormal(slope.vertices.map((i) => vertices[i])));
    // The slope still takes floor axes: s = x/32, t = -y/32.
    const a = st(slope.material!, axes, { x: 64, y: 32, z: 32 });
    const b = st(slope.material!, axes, { x: 100, y: 10, z: 50 });
    expect([frac(a[0]), frac(a[1])]).toEqual([0, 0]);
    expect([b[0] - a[0], b[1] - a[1]].map((n) => Math.round(n * 1e9) / 1e9)).toEqual([1.125, 0.6875]);

    expect(data.patches).toHaveLength(1);
    expect(data.patches![0]).toMatchObject({ shader: "base_trim/pewter", width: 3, height: 3 });
    expect(data.patches![0].controlPoints[0][1]).toEqual({ x: 32, y: 0, z: 32, u: 0.5, v: 0 });

    expect(data.brushEntities).toHaveLength(1);
    expect(data.brushEntities![0]).toMatchObject({ classname: "trigger_multiple", keys: { target: "t1" } });
    expect(data.brushes.find((brush) => brush.id === data.brushEntities![0].brushIds[0])!.shader).toBe(
      "common/trigger",
    );
    expect(data.entities.map((entity) => [entity.classname, entity.origin, entity.keys])).toEqual([
      ["info_player_deathmatch", { x: 32, y: 32, z: 24 }, { angle: "45" }],
      ["light", { x: 128, y: 128, z: 128 }, { light: "400" }],
    ]);
    expect(data.editorGroups).toEqual([{ id: expect.any(String), name: "func_group 1", objectIds: expect.any(Array) }]);
    expect(data.editorGroups![0].objectIds).toHaveLength(2);
    expect(data.brushes).toHaveLength(5);

    expect(issues).toEqual([
      "Skipped 1 brush in Valve 220 format",
      "Skipped 1 brush with no volume or open sides",
      "Skipped 1 patch of a type other than patchDef2",
      "Dropped 1 origin or model key on worldspawn or brush entities",
    ]);
    // Without image sizes classic texels can't be measured: 64×64 is assumed, and said so.
    const unsized = importMapSource(CLASSIC, { draftId: "unsized" });
    expect(unsized.issues.at(-1)).toBe(
      "Assumed 64×64 images for 3 textures with no known size (base_floor/ramp, base_floor/tile, base_wall/metal); pick them again to fix their alignment",
    );
    expect(unsized.data.brushes[0].faces!["+X"]).toMatchObject({ size: [64, 64], sizeKnown: false });
    // The imported map exports and reads back unchanged.
    const source = writeMap(data);
    expect(writeMap(importMapSource(source, options).data)).toBe(source);
  });

  it("skips bad content without throwing, and throws only for text that isn't a .map", () => {
    const truncated = importMapSource(CLASSIC.slice(0, CLASSIC.indexOf("base_wall/metal") + 40), options);
    expect(truncated.data.brushes).toHaveLength(0);
    expect(truncated.issues[0]).toBe("The file ends inside a brush or patch; everything after it was skipped");
    const keys = importMapSource(
      '{\n"classname" "worldspawn"\n"bad key" "1"\n"origin" "0 0 0"\n}\n{\n"classname" "info_null"\n}\n{\n"classname" "9bad"\n"origin" "1 2 3"\n}\n',
      options,
    );
    expect(keys.data.entities).toEqual([
      { id: expect.any(String), classname: "info_null", origin: { x: 0, y: 0, z: 0 }, keys: {} },
    ]);
    expect(keys.issues).toEqual([
      "Skipped 1 entity without a valid classname",
      "Placed 1 point entity with no valid origin at 0 0 0",
      "Dropped 1 key with names or values the editor can't store",
      "Dropped 1 origin or model key on worldspawn or brush entities",
    ]);
    expect(() => importMapSource("hello world", options)).toThrow(/Not a Quake 3 \.map/);
    expect(() => importMapSource("", options)).toThrow(/Not a Quake 3 \.map/);
    expect(() => importMapSource('{"schemaVersion": 2, "brushes": []}', options)).toThrow(/Not a Quake 3 \.map/);
  });

  it("imports a large generated map with few issues", () => {
    const source = new MapGenerator({ seed: 7 }).generate();
    const { data, issues } = importMapSource(source, { draftId: "generated" });
    expect(issues).toEqual([]);
    expect(data.brushes).toHaveLength(source.match(/^brushDef$/gm)!.length);
    expect(data.patches).toHaveLength(source.match(/^patchDef2$/gm)!.length);
    expect(data.brushes.length + data.patches!.length).toBeGreaterThan(100);
    expect(data.entities.length).toBeGreaterThan(0);
  });
});

const CLASSIC = `// Hand-written in GtkRadiant's classic Quake 3 format
// entity 0
{
"classname" "worldspawn"
"message" "Classic test"
"_blocksize" "0 0 0"
"origin" "0 0 0"
// brush 0: a detail floor slab
{
( 0 0 0 ) ( 0 256 0 ) ( 256 0 0 ) base_floor/tile 16 0 90 0.5 0.5 134217728 0 0
( 0 256 -16 ) ( 0 0 -16 ) ( 256 256 -16 ) common/caulk 0 0 0 0.5 0.5 134217728 0 0
( 0 0 0 ) ( 256 0 0 ) ( 0 0 -16 ) common/caulk 0 0 0 0.5 0.5 134217728 0 0
( 256 256 0 ) ( 0 256 0 ) ( 256 256 -16 ) common/caulk 0 0 0 0.5 0.5 134217728 0 0
( 0 256 0 ) ( 0 0 0 ) ( 0 256 -16 ) common/caulk 0 0 0 0.5 0.5 134217728 0 0
( 256 0 0 ) ( 256 256 0 ) ( 256 0 -16 ) base_wall/metal 0 0 0 1 1 134217728 0 0
}
// brush 1: a ramp, five planes, sloped top
{
( 128 0 64 ) ( 0 0 0 ) ( 0 64 0 ) base_floor/ramp 0 0 0 0.5 0.5 0 0 0
( 128 0 64 ) ( 128 64 64 ) ( 128 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 0 0 64 ) ( 128 0 64 ) ( 0 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 128 64 64 ) ( 0 64 64 ) ( 128 64 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 0 64 0 ) ( 0 0 0 ) ( 128 64 0 ) common/caulk 0 0 0 0.5 0.5 0 0 0
}
// brush 2: Valve 220
{
( 0 0 0 ) ( 0 1 0 ) ( 1 0 0 ) base_floor/tile [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 -8 ) ( 1 0 -8 ) ( 0 1 -8 ) base_floor/tile [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
}
// brush 3: zero thickness
{
( 0 0 0 ) ( 0 64 0 ) ( 64 0 0 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
( 0 64 0 ) ( 0 0 0 ) ( 64 64 0 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
( 0 0 0 ) ( 64 0 0 ) ( 0 0 -16 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
( 64 64 0 ) ( 0 64 0 ) ( 64 64 -16 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
( 0 64 0 ) ( 0 0 0 ) ( 0 64 -16 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
( 64 0 0 ) ( 64 64 0 ) ( 64 0 -16 ) base_floor/tile 0 0 0 0.5 0.5 0 0 0
}
// brush 4
{
patchDef2
{
base_trim/pewter
( 3 3 0 0 0 )
(
( ( 0 0 0 0 0 ) ( 0 32 0 0 0.5 ) ( 0 64 0 0 1 ) )
( ( 32 0 32 0.5 0 ) ( 32 32 32 0.5 0.5 ) ( 32 64 32 0.5 1 ) )
( ( 64 0 0 1 0 ) ( 64 32 0 1 0.5 ) ( 64 64 0 1 1 ) )
)
}
}
// brush 5
{
patchDef3
{
base_trim/pewter
( 3 3 2 2 0 0 0 )
(
( ( 0 0 0 0 0 ) ( 0 32 0 0 0.5 ) ( 0 64 0 0 1 ) )
( ( 32 0 32 0.5 0 ) ( 32 32 32 0.5 0.5 ) ( 32 64 32 0.5 1 ) )
( ( 64 0 0 1 0 ) ( 64 32 0 1 0.5 ) ( 64 64 0 1 1 ) )
)
}
}
}
// entity 1
{
"classname" "info_player_deathmatch"
"origin" "32 32 24"
"angle" "45"
}
// entity 2
{
"classname" "trigger_multiple"
"target" "t1"
{
( 0 0 128 ) ( 0 64 128 ) ( 64 0 128 ) common/trigger 0 0 0 0.5 0.5 0 0 0
( 0 64 64 ) ( 0 0 64 ) ( 64 64 64 ) common/trigger 0 0 0 0.5 0.5 0 0 0
( 0 0 128 ) ( 64 0 128 ) ( 0 0 64 ) common/trigger 0 0 0 0.5 0.5 0 0 0
( 64 64 128 ) ( 0 64 128 ) ( 64 64 64 ) common/trigger 0 0 0 0.5 0.5 0 0 0
( 0 64 128 ) ( 0 0 128 ) ( 0 64 64 ) common/trigger 0 0 0 0.5 0.5 0 0 0
( 64 0 128 ) ( 64 64 128 ) ( 64 0 64 ) common/trigger 0 0 0 0.5 0.5 0 0 0
}
}
// entity 3
{
"classname" "func_group"
{
( 0 0 16 ) ( 0 16 16 ) ( 16 0 16 ) base_wall/metal 0 0 0 1 1 0 0 0
( 0 16 0 ) ( 0 0 0 ) ( 16 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 0 0 16 ) ( 16 0 16 ) ( 0 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 16 16 16 ) ( 0 16 16 ) ( 16 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 0 16 16 ) ( 0 0 16 ) ( 0 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 16 0 16 ) ( 16 16 16 ) ( 16 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
}
{
( 32 0 16 ) ( 32 16 16 ) ( 48 0 16 ) base_wall/metal 0 0 0 1 1 0 0 0
( 32 16 0 ) ( 32 0 0 ) ( 48 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 32 0 16 ) ( 48 0 16 ) ( 32 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 48 16 16 ) ( 32 16 16 ) ( 48 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 32 16 16 ) ( 32 0 16 ) ( 32 16 0 ) base_wall/metal 0 0 0 1 1 0 0 0
( 48 0 16 ) ( 48 16 16 ) ( 48 0 0 ) base_wall/metal 0 0 0 1 1 0 0 0
}
}
// entity 4
{
"classname" "light"
"origin" "128 128 128"
"light" "400"
}
`;
