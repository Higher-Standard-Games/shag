/**
 * v0.9.23 pk3 dependency probe: what a client has loaded when it preloads the
 * projectile models after joining a map.
 *
 * Run from the repository root, naming the maps one session joins in order:
 *   npx vite-node docs/research/v0.9.23-pk3-dependency-probe.ts -- wdm2 acidwdm2
 *
 * Indexes every pk3 without loading any, then walks MapLoader's own dependency
 * phases for each map, loading what each phase asks for. For every join it
 * reports what each phase loaded, whether data0_21pure.pk3 — the only pk3 with
 * the projectile models and their shader scripts — was loaded before the shader
 * scripts were read, and how the projectile models and shaders resolve when
 * projectiles are preloaded after the join.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@babylonjs/core/Misc/logger";
import { BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import type { BspFile } from "../../src/engine/loader/bsp/BspLoader";
import { MapLoader } from "../../src/engine/loader/map/MapLoader";
import { PK3Index } from "../../src/engine/loader/pk3/PK3Index";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { Q3ShaderRegistry } from "../../src/engine/loader/shader/Q3ShaderRegistry";
import { initializeEntityDefs } from "../../src/shared/entities";
import { EntityRegistry } from "../../src/shared/entities/EntityRegistry";
import type { ProjectileDef } from "../../src/shared/entities/ProjectileDef";

Logger.LogLevels = 0;
const quiet = { log: console.log, warn: console.warn };
const print = (...args: unknown[]) => quiet.log(...args);

const DIRS = ["public/data", "public/data/basewsw"];
const PROJECTILE_PK3 = "data0_21pure.pk3";
const PROJECTILES = ["rocket", "grenade", "plasma_bolt", "blade_blast"];
/** One additive glow surface per projectile, from scripts/models.shader in data0_21pure.pk3. */
const GLOW_SHADERS = [
  "models/objects/projectile/rlauncher/rocket_strong",
  "models/objects/projectile/glauncher/grenadegradstrong.tga",
  "models/objects/projectile/plasmagun/plnew",
  "models/objects/projectile/gunblade/proj_gunblade",
];

type Ingestable = { processPK3ArrayBuffer(filename: string, buf: ArrayBuffer): Promise<void> };
type Phases = {
  resolveMapDependencies(bsp: BspFile): Promise<Set<string>>;
  resolveEntityModelDependencies(bsp: BspFile): Set<string>;
  resolveSkyDependencies(bsp: BspFile): Promise<Set<string>>;
};

function readArrayBuffer(full: string): ArrayBuffer {
  const buf = fs.readFileSync(full);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const fullPaths = new Map<string, string>();
const loaded = () => new Set(PK3Loader.getInstance().getPackageInfo().map((p) => p.filename));

/** Load the named pk3s MapLoader asked for that are not loaded yet; returns those loaded now. */
async function loadAll(pk3s: Iterable<string>): Promise<string[]> {
  const now: string[] = [];
  for (const pk3 of pk3s) {
    if (loaded().has(pk3)) continue;
    const full = fullPaths.get(pk3);
    if (!full) continue;
    await (PK3Loader.getInstance() as unknown as Ingestable).processPK3ArrayBuffer(pk3, readArrayBuffer(full));
    now.push(pk3);
  }
  return now;
}

async function main() {
  const maps = process.argv.slice(2).filter((arg) => arg !== "--" && !arg.startsWith("--"));
  if (maps.length === 0) maps.push("wdm2", "acidwdm2");
  console.log = () => {};
  console.warn = () => {};

  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pk3")).sort()) {
      if (fullPaths.has(file)) continue;
      const full = path.join(dir, file);
      fullPaths.set(file, full);
      await PK3Index.getInstance().indexPK3ArrayBuffer(file, readArrayBuffer(full), full);
    }
  }
  print(`indexed ${fullPaths.size} pk3s; ${PROJECTILE_PK3} holds the projectile models and shaders`);

  initializeEntityDefs();
  const phases = MapLoader.getInstance() as unknown as Phases;
  const shaders = Q3ShaderRegistry.getInstance();
  const index = PK3Index.getInstance();

  for (const map of maps) {
    print(`\n== join ${map}`);
    const mapPk3 = index.findMap(map);
    if (!mapPk3) {
      print("   map not in index");
      continue;
    }
    print(`   1  map pk3: ${(await loadAll([mapPk3])).join(", ") || "(already loaded)"}`);
    const bsp = await BspLoader.loadFromPK3(PK3Loader.getInstance(), `maps/${map}.bsp`);
    if (!bsp) {
      print("   BSP failed to load");
      continue;
    }
    print(`   3  textures: ${(await loadAll(await phases.resolveMapDependencies(bsp))).join(", ") || "-"}`);
    print(`   3b models: ${(await loadAll(phases.resolveEntityModelDependencies(bsp))).join(", ") || "-"}`);
    print(`      override: ${(await loadAll(["z_weapons.pk3"])).join(", ") || "-"}`);
    const projectilePk3AtShaders = loaded().has(PROJECTILE_PK3);
    await shaders.loadShaders();
    print(`   4  shader scripts read; ${PROJECTILE_PK3} loaded by then: ${projectilePk3AtShaders}`);
    print(`   4b sky: ${(await loadAll(await phases.resolveSkyDependencies(bsp))).join(", ") || "-"}`);

    // After the join, Game.completeJoinGame preloads the projectile models.
    print(`   join done; ${PROJECTILE_PK3} loaded: ${loaded().has(PROJECTILE_PK3)}`);
    for (const id of PROJECTILES) {
      const def = EntityRegistry.getInstance().get<ProjectileDef>(id);
      if (def?.modelPath) print(`      ${id} model found: ${PK3Loader.getInstance().hasFile(def.modelPath)}`);
    }
    for (const name of GLOW_SHADERS) {
      const props = shaders.resolveMaterialProps(name);
      print(
        `      ${name.split("/").pop()}: shader defined=${!!shaders.getShader(name)}` +
          ` resolves as alphaMode=${props.alphaMode ?? "-"} transparent=${props.isTransparent ?? false}`,
      );
    }
  }
}

main()
  .catch((error) => {
    quiet.warn(error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100));
