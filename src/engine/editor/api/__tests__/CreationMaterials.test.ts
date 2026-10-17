import { describe, expect, it } from "vitest";
import { FIXED_MATRIX, faceST, faceTexMatrix } from "../../FaceUv";
import { writeMap } from "../../MapWriter";
import { applyOperations, type EditOp, emptyDocument } from "../Operations";

const box: EditOp = {
  op: "box.create",
  id: "wall",
  min: { x: 0, y: 0, z: 0 },
  max: { x: 256, y: 32, z: 128 },
  shader: "bricks/wall",
};
const west = { min: { x: -512, y: -256, z: 0 }, max: { x: -128, y: 256, z: 256 } };
const east = { min: { x: 128, y: -256, z: 0 }, max: { x: 512, y: 256, z: 256 } };

describe("creation texture alignment", () => {
  it("uses image dimensions for natural repeats, stores ordinary faces and preserves legacy calls", () => {
    const legacy = applyOperations(emptyDocument(), [box]).doc;
    const explicit = applyOperations({ ...emptyDocument(), draftId: legacy.draftId }, [
      { ...box, alignment: "legacy" },
    ]).doc;
    expect(writeMap(explicit)).toBe(writeMap(legacy));
    expect(legacy.brushes[0].faces).toBeUndefined();
    const sizes: [number, number] = [512, 256];
    const natural = applyOperations(emptyDocument(), [
      { ...box, alignment: "natural", textureSizes: { "bricks/wall": sizes } },
    ]).doc;
    const face = natural.brushes[0].faces!["-Y"]!;
    expect(faceST("-Y", faceTexMatrix(face), { x: 256, y: 0, z: -128 })).toEqual([1, 1]);
    expect(faceST("-Y", FIXED_MATRIX, { x: 256, y: 0, z: -128 })).toEqual([8, 4]);
    sizes[0] = 1024;
    expect(face.size).toEqual([512, 256]);
  });
  it("aligns different room materials and leaves cut walls' prior alignment intact", () => {
    const base = applyOperations(emptyDocument(), [
      {
        op: "gen.room",
        id: "west",
        ...west,
        shader: "bricks/wall",
        floorShader: "tiles/floor",
        ceilingShader: "common/caulk",
        alignment: "natural",
        textureSizes: { "bricks/wall": [512, 256], "tiles/floor": [256, 256] },
      },
      {
        op: "gen.room",
        id: "east",
        ...east,
        shader: "bricks/wall",
        alignment: "natural",
        textureSizes: { "bricks/wall": [512, 256] },
      },
    ]).doc;
    expect(base.brushes.find((b) => b.id === "west-floor")?.faces?.["+Z"]?.size).toEqual([256, 256]);
    const result = applyOperations(base, [
      {
        op: "gen.connect",
        id: "hall",
        from: west,
        to: east,
        shader: "metal/hall",
        alignment: "natural",
        textureSizes: { "metal/hall": [128, 256] },
      },
    ]).doc;
    for (const brush of result.brushes) {
      if (brush.id.startsWith("hall-")) expect(brush.faces?.["+X"]?.size).toEqual([128, 256]);
      else
        expect(brush.faces).toEqual(
          base.brushes.find((original) => brush.id === original.id || brush.id.startsWith(`${original.id}-`))?.faces,
        );
    }
  });
  it("supports corridor, stair and trigger generators and requires no sizes for tool shaders", () => {
    const ops: EditOp[] = [
      {
        op: "gen.corridor",
        id: "hall",
        from: { x: 0, y: 0, z: 0 },
        to: { x: 256, y: 0, z: 0 },
        shader: "common/caulk",
        alignment: "natural",
      },
      {
        op: "gen.stairs",
        id: "steps",
        from: { x: 0, y: 0, z: 0 },
        to: { x: 128, y: 0, z: 32 },
        shader: "common/caulk",
        alignment: "natural",
      },
      { op: "gen.teleporter", id: "tp", at: { x: 0, y: 0, z: 0 }, to: { x: 500, y: 0, z: 0 }, alignment: "natural" },
      { op: "gen.jumppad", id: "jp", at: { x: 0, y: 0, z: 0 }, to: { x: 200, y: 0, z: 64 }, alignment: "natural" },
    ];
    const doc = applyOperations(emptyDocument(), ops).doc;
    expect(doc.brushes.length).toBeGreaterThan(4);
    expect(
      doc.brushes.every(
        (b) => b.faces?.["+X"] && JSON.stringify(faceTexMatrix(b.faces["+X"]!)) === JSON.stringify(FIXED_MATRIX),
      ),
    ).toBe(true);
  });
  it("rejects unknown sizes and invalid alignment atomically", () => {
    const original = emptyDocument();
    const snapshot = structuredClone(original);
    for (const options of [
      { alignment: "natural" },
      { alignment: "natural", textureSizes: { "bricks/wall": [0, 256] } },
      { alignment: "stretch" },
    ]) {
      expect(() =>
        applyOperations(original, [
          { op: "box.create", id: "first", min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 16 } },
          { ...box, ...options } as EditOp,
        ]),
      ).toThrow(/operation 1|op 1/);
      expect(original).toEqual(snapshot);
    }
  });
});
