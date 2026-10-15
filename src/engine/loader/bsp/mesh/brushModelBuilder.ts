import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../../../lighting/DynamicLightSafety";
import { RenderVars } from "../../../rendering/RenderVars";
import { configureBspBakedLighting } from "../BspBakedLightingPlugin";
import { bspLightingProfile, scaleBspLighting } from "../BspLightingProfile";
import type { BspFile } from "../BspLoader";
import { createBspLightmapTexture } from "./lightmaps";
import { getVertexLightmapCoord } from "./vertices";

/**
 * Build a mesh for a specific brush model (inline model like *5, *6, etc.).
 * Used for func_door, func_button, func_rotating, etc.
 *
 * Creates children per texture/lightmap pair: UV2 addresses one specific page.
 */
export async function buildBrushModel(
  bsp: BspFile,
  modelIndex: number,
  scene: Scene,
  name: string,
): Promise<Mesh | null> {
  if (modelIndex < 0 || modelIndex >= bsp.models.length) {
    console.warn(`[BspMeshBuilder] Invalid model index: ${modelIndex}`);
    return null;
  }

  const model = bsp.models[modelIndex];
  if (model.numFaces === 0) {
    console.warn(`[BspMeshBuilder] Model ${modelIndex} has no faces`);
    return null;
  }

  const textureGroups = new Map<
    string,
    {
      textureIndex: number;
      textureName: string;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      indices: number[];
      vertexOffset: number;
      lightmapIndex: number;
    }
  >();

  for (let i = model.firstFace; i < model.firstFace + model.numFaces; i++) {
    const face = bsp.faces[i];
    if (!face || face.numVertices < 3) continue;

    if (face.faceType !== 1 && face.faceType !== 3) continue;

    const lightmapIndex = face.lightmapIndex >= 0 ? face.lightmapIndex : -1;
    const groupKey = `${face.textureIndex}_${lightmapIndex}`;
    let group = textureGroups.get(groupKey);
    if (!group) {
      const textureName = bsp.textures[face.textureIndex]?.name || "";
      group = {
        textureIndex: face.textureIndex,
        textureName,
        positions: [],
        normals: [],
        uvs: [],
        uv2s: [],
        indices: [],
        vertexOffset: 0,
        lightmapIndex,
      };
      textureGroups.set(groupKey, group);
    }

    const vertexOffset = group.vertexOffset;

    for (let v = 0; v < face.numVertices; v++) {
      const vertex = bsp.vertices[face.firstVertex + v];
      if (!vertex) continue;

      group.positions.push(vertex.position[0], vertex.position[2], vertex.position[1]);
      group.normals.push(vertex.normal[0], vertex.normal[2], vertex.normal[1]);
      group.uvs.push(vertex.texCoord[0], vertex.texCoord[1]);
      const lmCoord = getVertexLightmapCoord(vertex);
      group.uv2s.push(lmCoord[0], lmCoord[1]);
    }

    for (let m = 0; m < face.numMeshVerts; m += 3) {
      const i0 = bsp.meshVerts[face.firstMeshVert + m] + vertexOffset;
      const i1 = bsp.meshVerts[face.firstMeshVert + m + 1] + vertexOffset;
      const i2 = bsp.meshVerts[face.firstMeshVert + m + 2] + vertexOffset;
      group.indices.push(i0, i2, i1);
    }

    group.vertexOffset += face.numVertices;
  }

  if (textureGroups.size === 0) {
    console.warn(`[BspMeshBuilder] Model ${modelIndex} produced no geometry`);
    return null;
  }

  const parentMesh = new Mesh(name, scene);

  const centerX = (model.mins[0] + model.maxs[0]) / 2;
  const centerY = (model.mins[2] + model.maxs[2]) / 2;
  const centerZ = (model.mins[1] + model.maxs[1]) / 2;

  const { PK3TextureLoader } = await import("../../pk3/PK3TextureLoader");
  const texLoader = PK3TextureLoader.getInstance();

  let totalVertices = 0;
  let totalTriangles = 0;

  for (const group of textureGroups.values()) {
    if (group.indices.length === 0) continue;

    const texIndex = group.textureIndex;
    const childName = `${name}_tex${texIndex}_lm${group.lightmapIndex}`;
    const childMesh = new Mesh(childName, scene);

    const vertexData = new VertexData();
    vertexData.positions = group.positions;
    vertexData.normals = group.normals;
    vertexData.uvs = group.uvs;
    if (group.uv2s.length > 0) {
      vertexData.uvs2 = group.uv2s;
    }
    vertexData.indices = group.indices;
    vertexData.applyToMesh(childMesh);

    const texFlags = bsp.textures[texIndex];
    childMesh.metadata = {
      lightmapIndex: group.lightmapIndex,
      textureName: group.textureName,
      textureIndex: texIndex,
      contentFlags: texFlags?.contentFlags ?? 0,
      surfaceFlags: texFlags?.surfaceFlags ?? 0,
    };

    const mat = new StandardMaterial(`${childName}_mat`, scene);
    mat.backFaceCulling = true;
    applySafeMaxSimultaneousLights(mat);

    if (group.textureName && !group.textureName.toLowerCase().includes("common/")) {
      const texName = group.textureName;
      const { Q3ShaderRegistry } = await import("../../shader/Q3ShaderRegistry");
      const shaderRegistry = Q3ShaderRegistry.getInstance();

      const pathsToTry: string[] = [];
      const shader = shaderRegistry.getShader(texName);
      // `nofog` keeps world fog off this surface
      if (shader?.noFog) childMesh.applyFog = false;
      if (shader && shader.stages.length > 0) {
        const firstStage = shader.stages[0];
        if (firstStage.map && firstStage.map !== "$lightmap" && firstStage.map !== "$whiteimage") {
          pathsToTry.push(firstStage.map);
        }
      }

      pathsToTry.push(texName);

      const allPaths: string[] = [];
      for (const p of pathsToTry) {
        allPaths.push(p);
        if (!p.toLowerCase().startsWith("textures/") && !p.toLowerCase().startsWith("models/")) {
          allPaths.push(`textures/${p}`);
        }
      }

      const extensions = [".jpg", ".png", ".tga", ".ktx"];
      let texture: Texture | null = null;

      for (const basePath of allPaths) {
        if (texture) break;
        const cleanPath = basePath.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
        for (const ext of extensions) {
          texture = await texLoader.loadTexture(`${cleanPath}${ext}`);
          if (texture) break;
        }
      }

      if (texture) {
        mat.diffuseTexture = texture;
        if (group.lightmapIndex >= 0 && group.lightmapIndex < bsp.lightmaps.length) {
          const lmData = bsp.lightmaps[group.lightmapIndex];
          if (lmData && lmData.length > 0) {
            const lmSize = bsp.lightmapSize;
            const fbsp = bsp.header?.isFBSP === true;
            const lmTex = createBspLightmapTexture(lmData, lmSize, scene, `${childName}_lightmap`, fbsp);
            mat.lightmapTexture = lmTex;
            mat.useLightmapAsShadowmap = true;
            mat.lightmapTexture.coordinatesIndex = 1;
            if (fbsp) {
              let profile = bspLightingProfile(bsp);
              const scale = RenderVars.getInstance().get("r_lightmapscale");
              if (scale !== undefined && Number.isFinite(scale) && scale > 0)
                profile = scaleBspLighting(profile, profile.gain * scale);
              const direction =
                profile.deluxe && (RenderVars.getInstance().get("r_deluxe") ?? 1) >= 0.5
                  ? createBspLightmapTexture(
                      bsp.lightmaps[group.lightmapIndex + 1],
                      lmSize,
                      scene,
                      `${childName}_direction`,
                      true,
                      true,
                    )
                  : null;
              configureBspBakedLighting(mat, childMesh, profile, direction);
            }
          }
        }
        mat.emissiveColor = bsp.header?.isFBSP ? Color3.Black() : new Color3(0.15, 0.15, 0.15);
      } else {
        mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
        mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
      }
    } else {
      mat.diffuseColor = new Color3(0.6, 0.6, 0.6);
      mat.emissiveColor = new Color3(0.3, 0.3, 0.3);
    }

    childMesh.material = mat;
    childMesh.parent = parentMesh;

    totalVertices += group.positions.length / 3;
    totalTriangles += group.indices.length / 3;
  }

  parentMesh.setPivotPoint(new Vector3(centerX, centerY, centerZ));

  parentMesh.metadata = {
    brushModelIndex: modelIndex,
    modelBounds: {
      min: new Vector3(model.mins[0], model.mins[2], model.mins[1]),
      max: new Vector3(model.maxs[0], model.maxs[2], model.maxs[1]),
    },
  };

  console.log(
    `[BspMeshBuilder] Built brush model *${modelIndex}: ${totalVertices} vertices, ${totalTriangles} triangles, ${textureGroups.size} textures`,
  );

  return parentMesh;
}
