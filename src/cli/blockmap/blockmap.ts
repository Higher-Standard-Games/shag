/**
 * blockmap: compile a box map (JSON, see MapSpec.ts `BlockMap`) to a Quake 3
 * IBSP that SHAG loads, with baked lightmaps, light grid and collision.
 *
 *   blockmap build <map.json> [out.bsp]   compile; out defaults to <name>.bsp
 *   blockmap info <map.json>              count boxes, lights and textures
 *
 * Run from the SHAG root: `npm run blockmap -- build my.json`. Paths resolve
 * against the current directory. `examples/tiny.json` is a two-box example.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileBlockMap } from "./BspWriter";
import type { BlockMap } from "./MapSpec";

function usage(): never {
  throw new Error("Usage: blockmap build <map.json> [out.bsp] | blockmap info <map.json>");
}

async function readMap(file: string): Promise<BlockMap> {
  const map = JSON.parse(await readFile(file, "utf8")) as BlockMap;
  if (!map.name || !Array.isArray(map.boxes) || !map.lighting) throw new Error(`${file} is not a block map`);
  map.entities ??= [];
  map.luxelSize ??= 8;
  map.gridSize ??= [64, 64, 64];
  map.textureScale ??= 64;
  map.title ??= map.name;
  return map;
}

async function main(): Promise<void> {
  const [command, input, output] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!command || !input) usage();
  const map = await readMap(input);
  if (command === "info") {
    const textures = new Set(map.boxes.flatMap((box) => [box.textures.top, box.textures.side, box.textures.bottom]));
    textures.delete(undefined);
    console.log(
      `${map.name}: ${map.boxes.length} boxes, ${map.shapes?.length ?? 0} shapes, ${map.lighting.points.length} lights, ${textures.size} textures, ` +
        `${map.entities.length} entities`,
    );
    return;
  }
  if (command !== "build") usage();
  const started = performance.now();
  const bsp = compileBlockMap(map);
  const out = output ?? path.join(path.dirname(input), `${map.name}.bsp`);
  await writeFile(out, bsp.bytes);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  console.log(
    `[blockmap] ${out}: ${bsp.stats.faces} faces, ${bsp.stats.lightmaps} lightmaps, ` +
      `${bsp.stats.lightVols} light grid points, ${seconds} s`,
  );
}

main().catch((error) => {
  console.error(`[blockmap] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
