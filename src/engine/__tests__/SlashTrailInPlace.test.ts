import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { WeaponSlash } from "../weapon/WeaponSlash";

type Trail = { tipPoints: Vector3[]; handlePoints: Vector3[]; mesh: Mesh | null; capacity: number };

// A blade swing used to build and throw away a ribbon mesh every frame. It now
// keeps one mesh and rewrites it, and what it draws must be what a freshly
// built ribbon of the same points would draw.
it("rewrites one swing ribbon in place, drawing what a rebuilt one would", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const slash = new WeaponSlash();
  const camera = new FreeCamera("eye", new Vector3(10, 40, -5), scene);
  const time = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    slash.trigger();
    const trails = (slash as unknown as { trails: Trail[] }).trails;
    let mesh: Mesh | null = null;
    let created = 0;
    for (let frame = 0; frame < 90; frame++) {
      time.mockReturnValue(frame * 3);
      camera.rotation.y = frame * 0.02;
      camera.rotation.x = Math.sin(frame * 0.1) * 0.2;
      slash.updateTrail(scene, camera);
      const trail = trails.find((t) => t.mesh);
      if (trail?.mesh && trail.mesh !== mesh) {
        mesh = trail.mesh;
        created++;
      }
      if (!trail?.mesh || frame % 7 !== 0) continue;

      const count = trail.tipPoints.length;
      const fresh = MeshBuilder.CreateRibbon(
        "fresh",
        { pathArray: [trail.tipPoints, trail.handlePoints], sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      const got = {
        pos: trail.mesh.getVerticesData(VertexBuffer.PositionKind)!,
        uv: trail.mesh.getVerticesData(VertexBuffer.UVKind)!,
      };
      const want = {
        pos: fresh.getVerticesData(VertexBuffer.PositionKind)!,
        uv: fresh.getVerticesData(VertexBuffer.UVKind)!,
      };
      // Same vertex for vertex where both have it: path p point j, front and back.
      for (let side = 0; side < 2; side++) {
        for (let p = 0; p < 2; p++) {
          for (let j = 0; j < count; j++) {
            const g = side * trail.capacity * 2 + p * trail.capacity + j;
            const w = side * count * 2 + p * count + j;
            for (let k = 0; k < 3; k++) expect(got.pos[g * 3 + k]).toBeCloseTo(want.pos[w * 3 + k], 4);
            for (let k = 0; k < 2; k++) expect(got.uv[g * 2 + k]).toBeCloseTo(want.uv[w * 2 + k], 5);
          }
        }
      }
      // The trail's bounds cover what it draws, so it is not culled mid-swing.
      const box = trail.mesh.getBoundingInfo().boundingBox;
      const freshBox = fresh.getBoundingInfo().boundingBox;
      expect(box.minimum.asArray()).toEqual(freshBox.minimum.asArray().map((v) => expect.closeTo(v, 4)));
      expect(box.maximum.asArray()).toEqual(freshBox.maximum.asArray().map((v) => expect.closeTo(v, 4)));
      fresh.dispose();
    }
    // 90 points: built at 64 and grown once, not once a frame.
    expect(trails.some((t) => t.tipPoints.length > 64)).toBe(true);
    expect(created).toBe(2);
  } finally {
    time.mockRestore();
    slash.dispose();
    scene.dispose();
    engine.dispose();
  }
});
