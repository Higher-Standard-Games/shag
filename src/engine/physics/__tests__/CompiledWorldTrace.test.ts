import * as fs from "node:fs";
import * as path from "node:path";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a build script, without type declarations
import { worldTraceSourceHash } from "../../../../scripts/collision-wasm-source.mjs";
import { BspLoader } from "../../loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../loader/pk3/NodePk3";
import { PK3Loader } from "../../loader/pk3/PK3Loader";
import { SweepCollisionBackend } from "../SweepCollisionBackend";
import { worldTraceInstance } from "../WorldTraceWasm";

const root = path.resolve(__dirname, "../../../..");
const MAP = "washoi_dm2";
const mapPackage = path.join(root, "public/data", `map_${MAP}.pk3`);

describe("the compiled world trace", () => {
  it("is built from the Rust source as it stands (npm run build:collision-wasm)", () => {
    const recorded = fs.readFileSync(path.join(root, "src/engine/physics/WorldTrace.wasm.source"), "utf8").trim();
    expect(recorded).toBe(worldTraceSourceHash(root));
    expect(worldTraceInstance()).not.toBeNull();
  });

  it.skipIf(!fs.existsSync(mapPackage))(
    "answers every trace on a map as the TypeScript world walk does",
    async () => {
      const buffer = await resolveMapBspViaIndex([path.join(root, "public/data")], MAP, PK3Loader.createTransient());
      const plain = new SweepCollisionBackend();
      const compiled = new SweepCollisionBackend();
      await plain.init(BspLoader.loadCollision(buffer!));
      await compiled.init(BspLoader.loadCollision(buffer!));
      expect(compiled.useCompiledWorldTrace(worldTraceInstance()!)).toBe(true);

      // Seeded traces across the map's box: points, a player's hull and a small one
      let seed = 7;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const world = BspLoader.loadCollision(buffer!).models[0];
      const at = () =>
        new Vector3(
          world.mins[0] + random() * (world.maxs[0] - world.mins[0]),
          world.mins[2] + random() * (world.maxs[2] - world.mins[2]),
          world.mins[1] + random() * (world.maxs[1] - world.mins[1]),
        );
      const hulls = [{ radius: 0, height: 0 }, undefined, { radius: 4, height: 8 }];
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        const start = at();
        const end =
          random() < 0.5
            ? at()
            : start.add(new Vector3((random() - 0.5) * 256, (random() - 0.5) * 128, (random() - 0.5) * 256));
        const options = hulls[i % hulls.length];
        const a = plain.trace(start, end, options);
        const b = compiled.trace(start, end, options);
        if (a.fraction < 1) hits++;
        expect([b.fraction, b.endPos, b.normal, b.startSolid, b.allSolid, b.contents, b.hitBrushIndex]).toEqual([
          a.fraction,
          a.endPos,
          a.normal,
          a.startSolid,
          a.allSolid,
          a.contents,
          a.hitBrushIndex,
        ]);
        expect([b.hitTextureName, b.hitSurfaceFlags]).toEqual([a.hitTextureName, a.hitSurfaceFlags]);
      }
      expect(hits).toBeGreaterThan(500);
    },
    60_000,
  );
});
