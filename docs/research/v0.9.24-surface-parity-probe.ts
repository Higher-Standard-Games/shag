/** Inspect local map sprite/decal inputs; no GPU output or network required. */
import { BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import { ingestPk3Dir, resolveMapBspViaIndex } from "../../src/engine/loader/pk3/NodePk3";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { Q3ShaderRegistry } from "../../src/engine/loader/shader/Q3ShaderRegistry";
import { parseKTX1 } from "../../src/engine/loader/texture/KTX1Loader";

await ingestPk3Dir("public/data");
const pk3 = PK3Loader.getInstance();
const registry = Q3ShaderRegistry.getInstance();
await registry.loadShaders();
for (const map of process.argv.slice(2).filter(arg => arg !== "--").length
  ? process.argv.slice(2).filter(arg => arg !== "--") : ["wdm2"]) {
  const bytes = await resolveMapBspViaIndex(["public/data", "public/data/basewsw"], map);
  if (!bytes) throw new Error(`Missing local map: ${map}`);
  const bsp = BspLoader.load(bytes);
  for (const texture of bsp.textures) {
    const props = registry.resolveMaterialProps(texture.name);
    if (!props.autosprite && !props.autosprite2 && !props.polygonOffset && props.alphaMode !== "multiply") continue;
    const shader = registry.getShader(texture.name);
    const assets = [];
    for (const stage of shader?.stages ?? []) {
      const base = stage.map?.replace(/\.(ktx|tga|png|jpg|jpeg)$/i, "");
      if (!base || base.startsWith("$")) continue;
      for (const path of new Set([stage.map, ...["tga", "png", "jpg", "ktx"].map(ext => `${base}.${ext}`)])) {
        if (!pk3.hasFile(path)) continue;
        const data = await pk3.getFile(path);
        assets.push({path, format: path.endsWith(".ktx") && data ? parseKTX1(data).formatName : path.split(".").pop()});
      }
    }
    console.log("SURFACE_INPUT", JSON.stringify({map, name: texture.name, sprite: props.autosprite,
      sprite2: props.autosprite2, polygonOffset: props.polygonOffset, alphaMode: props.alphaMode,
      stages: shader?.stages, assets}));
  }
}
