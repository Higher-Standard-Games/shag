/** Inspect installed BSP lift faces via the shared PK3 index; no GPU or network. */
import { BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../src/engine/loader/pk3/NodePk3";
import { extractLifts } from "../../src/shared/bsp/LiftSystem";
import { Q3ShaderRegistry } from "../../src/engine/loader/shader/Q3ShaderRegistry";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Scene } from "@babylonjs/core/scene";
import { PK3TextureLoader } from "../../src/engine/loader/pk3/PK3TextureLoader";
import { buildBrushModel } from "../../src/engine/loader/bsp/mesh/brushModelBuilder";

for (const name of ["wdm2", "acidwdm2"]) {
  const bytes = await resolveMapBspViaIndex(["public/data", "public/data/basewsw"], name);
  if (!bytes) continue;
  const bsp = BspLoader.load(bytes);
  await Q3ShaderRegistry.getInstance().loadShaders();
  for (const lift of extractLifts(bsp.entities, bsp.models)) {
    const model = bsp.models[lift.modelIndex];
    const groups = new Map<string, number>();
    for (const face of bsp.faces.slice(model.firstFace, model.firstFace + model.numFaces)) {
      const texture = bsp.textures[face.textureIndex];
      const key = JSON.stringify({texture: texture?.name, flags: texture?.surfaceFlags, lightmap: face.lightmapIndex, type: face.faceType});
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    console.log("LIFT_FACES", JSON.stringify({map: name, model: lift.modelIndex, bounds: [model.mins, model.maxs], groups: [...groups].map(([key, faces]) => ({...JSON.parse(key), faces}))}));
    for (const texture of new Set(bsp.faces.slice(model.firstFace, model.firstFace + model.numFaces).map(face => bsp.textures[face.textureIndex].name))) {
      console.log("LIFT_SHADER", JSON.stringify({texture, shader: Q3ShaderRegistry.getInstance().getShader(texture), resolved: Q3ShaderRegistry.getInstance().resolveMaterialProps(texture)}));
    }
    const engine = new NullEngine();
    Object.defineProperty(engine, "isWebGPU", {value: true});
    const scene = new Scene(engine);
    const textureLoader = PK3TextureLoader.getInstance();
    const originalLoad = textureLoader.loadTexture;
    const placeholder = new Texture(null, scene);
    // Geometry/material bookkeeping only. No image decoding, GPU uploads or pixels.
    textureLoader.loadTexture = async () => placeholder;
    try {
      const mesh = await buildBrushModel(bsp, lift.modelIndex, scene, "lift-probe");
      if (!mesh) throw new Error(`Missing lift mesh for ${name}`);
      mesh.position.set(lift.origin.x, lift.origin.y + lift.start, lift.origin.z);
      mesh.computeWorldMatrix(true);
      for (const child of mesh.getChildMeshes()) child.computeWorldMatrix(true);
      const bounds = mesh.getHierarchyBoundingVectors();
      const children = mesh.getChildMeshes();
      console.log("LIFT_GEOMETRY", JSON.stringify({map: name, model: lift.modelIndex, children: children.length,
        vertices: children.reduce((count, child) => count + child.getTotalVertices(), 0),
        triangles: children.reduce((count, child) => count + child.getTotalIndices() / 3, 0),
        bounds: [bounds.min.asArray(), bounds.max.asArray()],
        allEnabled: children.every(child => child.isEnabled() && child.isVisible),
        allTransformsLive: children.every(child => !child.isWorldMatrixFrozen),
        lightmapPages: children.map(child => child.metadata.lightmapIndex),
      }));
    } finally {
      textureLoader.loadTexture = originalLoad;
      scene.dispose(); engine.dispose();
    }
  }
}
