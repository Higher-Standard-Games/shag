import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { BspLoader } from "../../../loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../../loader/pk3/NodePk3";
import { applyOperations, emptyDocument } from "../../api/Operations";
import { writeMap } from "../../MapWriter";
import { CompileJobs } from "../CompileJobs";
import { resolveCompilerConfig } from "../CompilerConfig";
import { MapStore } from "../MapStore";

it("retains natural world-to-image repeats in a real compiled BSP", async () => {
  const compiler = await resolveCompilerConfig();
  if (!compiler.available) return;
  const root = await mkdtemp(path.join(tmpdir(), "shagged-natural-"));
  try {
    const doc = applyOperations(emptyDocument("naturaluvprobe"), [
      {
        op: "gen.room",
        id: "room",
        min: { x: -256, y: -256, z: 0 },
        max: { x: 256, y: 256, z: 256 },
        alignment: "natural",
        textureSizes: { "blx/blx_grid": [512, 256] },
      },
      { op: "entity.place", classname: "info_player_deathmatch", origin: { x: 0, y: 0, z: 48 } },
    ]).doc;
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    const saved = await store.save("naturaluvprobe", writeMap(doc), 0, doc);
    const data = path.join(root, "data");
    const jobs = new CompileJobs(store, compiler, path.join(root, "jobs"), undefined, data);
    const requested = await jobs.request("naturaluvprobe", saved.revision, "fast");
    const result = await jobs.wait(requested.id);
    expect(result?.state, result?.logs.join("\n")).toBe("playable");
    const bsp = BspLoader.load((await resolveMapBspViaIndex([data], "naturaluvprobe"))!);
    const wall = bsp.faces.find((face) => face.normal[1] < -0.99 && face.numVertices >= 3);
    expect(wall).toBeDefined();
    const vertices = bsp.vertices.slice(wall!.firstVertex, wall!.firstVertex + wall!.numVertices);
    for (const vertex of vertices.slice(1)) {
      expect(vertex.texCoord[0] - vertices[0].texCoord[0]).toBeCloseTo(
        (vertex.position[0] - vertices[0].position[0]) / 256,
        4,
      );
      expect(vertex.texCoord[1] - vertices[0].texCoord[1]).toBeCloseTo(
        -(vertex.position[2] - vertices[0].position[2]) / 128,
        4,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
