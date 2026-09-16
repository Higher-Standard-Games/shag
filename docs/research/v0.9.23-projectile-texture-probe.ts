/**
 * v0.9.23 projectile texture probe: how the projectile models find their textures.
 *
 * Run from the repository root:
 *   npx vite-node docs/research/v0.9.23-projectile-texture-probe.ts
 *
 * For each projectile model, every surface's shader name and the texture path
 * MD3Loader derives from it: resolved before the shader scripts load, after
 * loading them into the same registry, and after loading them into a cleared
 * one. Then whether the pk3s hold that texture and a KTX2 sidecar exists, and
 * what createMeshes binds once its texture loads settle. The KTX2 manifest is
 * fetched by URL, which Node cannot do, so bound textures come from the pk3s.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Logger } from "@babylonjs/core/Misc/logger";
import { Scene } from "@babylonjs/core/scene";
import { getMD3Loader } from "../../src/engine/loader/model/MD3Loader";
import { ingestPk3Dir } from "../../src/engine/loader/pk3/NodePk3";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { PK3TextureLoader } from "../../src/engine/loader/pk3/PK3TextureLoader";
import { Q3ShaderRegistry } from "../../src/engine/loader/shader/Q3ShaderRegistry";
import { initializeEntityDefs } from "../../src/shared/entities";
import { EntityRegistry } from "../../src/shared/entities/EntityRegistry";
import type { ProjectileDef } from "../../src/shared/entities/ProjectileDef";

Logger.LogLevels = 0;
const quiet = { log: console.log, warn: console.warn };
const print = (...args: unknown[]) => quiet.log(...args);

const PROJECTILES = ["rocket", "grenade", "plasma_bolt", "blade_blast"];

async function main() {
  console.log = () => {};
  console.warn = () => {};

  const pk3s = (await ingestPk3Dir("public/data")) + (await ingestPk3Dir("public/data/basewsw"));
  const manifestPath = path.resolve("public/data/ktx2cache/manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { textures: Record<string, unknown> }).textures
    : {};
  print(`pk3s ingested: ${pk3s}, KTX2 manifest entries: ${Object.keys(manifest).length}`);

  initializeEntityDefs();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  getMD3Loader().init(scene);
  PK3TextureLoader.getInstance().init(engine as never, scene);
  const pk3 = PK3Loader.getInstance();
  const shaders = Q3ShaderRegistry.getInstance();

  const models = new Map<string, { def: ProjectileDef; shaderNames: string[] }>();
  for (const id of PROJECTILES) {
    const def = EntityRegistry.getInstance().get<ProjectileDef>(id);
    if (!def?.modelPath) continue;
    const data = await pk3.getFile(def.modelPath);
    if (!data) {
      print(`\n${id}: ${def.modelPath} NOT IN PK3S`);
      continue;
    }
    const parsed = getMD3Loader().parseMD3(data);
    const shaderNames = parsed.surfaces.map((s) => s.shaders[0]?.name.replace(/\\/g, "/") ?? "(no shader)");
    models.set(id, { def, shaderNames });
  }

  const texturePath = (shaderName: string) => shaders.resolveMaterialProps(shaderName).diffuseTexture || shaderName;
  const before = new Map<string, string>();
  for (const { shaderNames } of models.values()) {
    for (const name of shaderNames) before.set(name, texturePath(name));
  }
  const loaded = await shaders.loadShaders();
  const after = new Map<string, string>();
  for (const { shaderNames } of models.values()) {
    for (const name of shaderNames) after.set(name, texturePath(name));
  }
  shaders.clear();
  await shaders.loadShaders();
  print(`shaders loaded: ${loaded}`);

  for (const [id, { def, shaderNames }] of models) {
    print(`\n${id}: ${def.modelPath}${def.texturePaths ? ` texturePaths=${def.texturePaths.join(",")}` : ""}`);
    for (const name of shaderNames) {
      const props = shaders.resolveMaterialProps(name);
      const fresh = props.diffuseTexture || name;
      const stripped = fresh.replace(/\.(ktx|tga|png|jpg|jpeg)$/i, "");
      const inPk3 = [fresh, `${stripped}.tga`, `${stripped}.png`, `${stripped}.jpg`, `${stripped}.ktx`].filter((p) =>
        pk3.hasFile(p),
      );
      print(`   surface shader ${name}`);
      print(
        `     texture before shaders=${before.get(name)} after=${after.get(name)} cleared+loaded=${fresh}` +
          ` shaderDefined=${!!shaders.getShader(name)} transparent=${props.isTransparent ?? false} alphaMode=${props.alphaMode ?? "-"}`,
      );
      print(`     in pk3s: ${inPk3.join(", ") || "NONE"}; KTX2 sidecar: ${stripped.toLowerCase() in manifest}`);
    }

    const data = await pk3.getFile(def.modelPath!);
    const result = getMD3Loader().createMeshes(getMD3Loader().parseMD3(data!), `probe_${id}`);
    await Promise.all((result as unknown as { textureLoadPromises?: Promise<void>[] }).textureLoadPromises ?? []);
    for (const mesh of result?.meshes ?? []) {
      const mat = mesh.material as StandardMaterial | null;
      const tex = mat?.diffuseTexture;
      print(
        `   bound ${mesh.name}: material=${mat?.name ?? "NONE"} diffuse=${tex?.name ?? "NONE"} ready=${tex?.isReady() ?? "-"}` +
          ` emissive=${mat?.emissiveTexture?.name ?? "-"} alpha=${mat?.alpha} verts=${mesh.getTotalVertices()}`,
      );
    }
  }

  engine.dispose();
}

main()
  .catch((error) => {
    quiet.warn(error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100));
