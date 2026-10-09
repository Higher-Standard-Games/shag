import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { updateUnlitTrailRibbon } from "../weapon/EffectGeometry";

describe("fixed-layout unlit effect geometry", () => {
  it("matches Babylon's curved ribbon positions and bounds while preserving buffers and clean shader attributes", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const paths = (offset: number) => [
        [new Vector3(0, offset, 0), new Vector3(1, offset + 2, 3), new Vector3(3, offset, 5)],
        [new Vector3(0, offset + 1, 0), new Vector3(1, offset + 3, 3), new Vector3(3, offset + 1, 5)],
      ];
      const expected = MeshBuilder.CreateRibbon(
        "reference",
        { pathArray: paths(0), updatable: true, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      const actual = MeshBuilder.CreateRibbon(
        "streamed",
        { pathArray: paths(0), updatable: true, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      const buffer = actual.getVertexBuffer(VertexBuffer.PositionKind);
      const indices = [...actual.getIndices()!];
      const attributes = vi.spyOn(actual, "_markSubMeshesAsAttributesDirty");
      const referenceAttributes = vi.spyOn(expected, "_markSubMeshesAsAttributesDirty");
      for (const offset of [4, -10, 40]) {
        const [a, b] = paths(offset);
        MeshBuilder.CreateRibbon("reference", { pathArray: [a, b], instance: expected });
        updateUnlitTrailRibbon(actual, a, b);
        expect([...actual.getVerticesData(VertexBuffer.PositionKind)!]).toEqual([
          ...expected.getVerticesData(VertexBuffer.PositionKind)!,
        ]);
        expect(actual.getBoundingInfo().boundingBox.minimum.asArray()).toEqual(
          expected.getBoundingInfo().boundingBox.minimum.asArray(),
        );
        expect(actual.getBoundingInfo().boundingBox.maximum.asArray()).toEqual(
          expected.getBoundingInfo().boundingBox.maximum.asArray(),
        );
        expect(actual.getVertexBuffer(VertexBuffer.PositionKind)).toBe(buffer);
        expect([...actual.getIndices()!]).toEqual(indices);
      }
      expect(attributes).not.toHaveBeenCalled();
      expect(referenceAttributes).toHaveBeenCalled();
      expect(() => updateUnlitTrailRibbon(actual, paths(0)[0].slice(1), paths(0)[1])).toThrow("topology changed");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
