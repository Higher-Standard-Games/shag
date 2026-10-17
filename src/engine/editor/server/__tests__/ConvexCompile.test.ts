import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { expect, it } from "vitest";
import { BspLoader } from "../../../loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../../loader/pk3/NodePk3";
import { SweepCollisionBackend } from "../../../physics/SweepCollisionBackend";
import { applyOperations, emptyDocument } from "../../api/Operations";
import { dot, planeTextureAxes } from "../../ConvexBrush";
import { writeMap } from "../../MapWriter";
import { CompileJobs } from "../CompileJobs";
import { resolveCompilerConfig } from "../CompilerConfig";
import { MapStore } from "../MapStore";

it("compiles rotated solids and prisms with correct collision and arbitrary-plane texture UVs", async () => {
  const compiler = await resolveCompilerConfig();
  if (!compiler.available) return;
  const root = await mkdtemp(path.join(tmpdir(), "shagged-convex-"));
  try {
    const footprint = Array.from({ length: 8 }, (_, i) => ({
      x: -160 + 32 * Math.cos((i * Math.PI) / 4),
      y: 32 * Math.sin((i * Math.PI) / 4),
    }));
    const doc = applyOperations(emptyDocument("convexprobe"), [
      { op: "gen.room", id: "room", min: { x: -256, y: -256, z: 0 }, max: { x: 256, y: 256, z: 192 } },
      { op: "entity.place", classname: "info_player_deathmatch", origin: { x: 0, y: -160, z: 48 } },
      {
        op: "box.create",
        id: "bridge",
        min: { x: -128, y: -16, z: 32 },
        max: { x: 128, y: 16, z: 48 },
        alignment: "natural",
        textureSizes: { "blx/blx_grid": [512, 256] },
        detail: true,
      },
      { op: "brush.rotate", id: "bridge", axis: "z", degrees: 45 },
      { op: "gen.prism", id: "platform", footprint, bottom: 0, top: 64 },
    ]).doc;
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    const saved = await store.save("convexprobe", writeMap(doc), 0, doc);
    const data = path.join(root, "data");
    const jobs = new CompileJobs(store, compiler, path.join(root, "jobs"), undefined, data);
    const requested = await jobs.request("convexprobe", saved.revision, "fast");
    const completed = await jobs.wait(requested.id);
    expect(completed?.state, completed?.logs.join("\n")).toBe("playable");
    const bsp = BspLoader.load((await resolveMapBspViaIndex([data], "convexprobe"))!);
    const collision = new SweepCollisionBackend();
    await collision.init(bsp);
    const down = (x: number, y: number) =>
      collision.trace(new Vector3(x, 120, y), new Vector3(x, 16, y), { radius: 0, height: 0 });
    expect(down(50, 50).fraction).toBeLessThan(1);
    expect(down(50, 50).endPos.y).toBeCloseTo(48, 0);
    expect(down(90, -90).fraction).toBe(1);
    expect(down(-160, 0).endPos.y).toBeCloseTo(64, 0);
    const diagonal = bsp.faces.find(
      (face) => Math.abs(Math.abs(face.normal[0]) - Math.SQRT1_2) < 1e-3 && Math.abs(face.normal[2]) < 1e-3,
    );
    expect(diagonal).toBeDefined();
    const normal = { x: diagonal!.normal[0], y: diagonal!.normal[1], z: diagonal!.normal[2] };
    const axes = planeTextureAxes(normal);
    const vertices = bsp.vertices.slice(diagonal!.firstVertex, diagonal!.firstVertex + diagonal!.numVertices);
    const a = vertices[0];
    for (const b of vertices.slice(1)) {
      const delta = {
        x: b.position[0] - a.position[0],
        y: b.position[1] - a.position[1],
        z: b.position[2] - a.position[2],
      };
      expect(b.texCoord[0] - a.texCoord[0]).toBeCloseTo(dot(delta, axes.u) / 256, 4);
      expect(b.texCoord[1] - a.texCoord[1]).toBeCloseTo(dot(delta, axes.v) / 128, 4);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
