import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Culling/ray";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { getRenderingBackend } from "./RenderingEngineFactory";

/** On-demand CPU picking/state snapshot. Does not prove which GPU fragment won. */
export function inspectAimedSurfaces(scene: Scene, camera: Camera) {
  const ray = camera.getForwardRay(10000);
  const hits = (
    scene.multiPickWithRay(
      ray,
      (mesh) =>
        mesh.isPickable &&
        mesh.isEnabled() &&
        mesh.isVisible &&
        mesh.visibility > 0 &&
        (mesh.layerMask & camera.layerMask) !== 0 &&
        !mesh.metadata?.isLightGizmo &&
        !mesh.name.startsWith("collision_") &&
        !mesh.name.startsWith("clipbrush_"),
    ) ?? []
  )
    .filter((hit) => hit.hit && hit.pickedMesh)
    .sort((a, b) => a.distance - b.distance);
  return {
    scope: "renderer-aimed-surfaces",
    backend: getRenderingBackend(scene.getEngine()),
    ktx2Setting: Cvar.get("r_ktx2") ?? null,
    camera: {
      name: camera.name,
      position: ray.origin.asArray(),
      direction: ray.direction.asArray(),
      minZ: camera.minZ,
      maxZ: camera.maxZ,
    },
    hitCount: hits.length,
    surfaces: hits.slice(0, 8).map((hit) => {
      const mesh = hit.pickedMesh!;
      const subMesh = mesh.subMeshes?.[hit.subMeshId];
      // getMaterial() can lazily create scene.defaultMaterial. Inspection must
      // not allocate renderer resources just because a mesh has no material.
      const material =
        mesh.material instanceof MultiMaterial
          ? mesh.material.subMaterials[subMesh?.materialIndex ?? 0]
          : mesh.material;
      return {
        mesh: mesh.name,
        shader: mesh.metadata?.textureName ?? null,
        lightmapPage: mesh.metadata?.lightmapIndex ?? null,
        autosprite: !!mesh.metadata?.autosprite,
        autosprite2: !!mesh.metadata?.autosprite2,
        distance: hit.distance,
        point: hit.pickedPoint?.asArray(),
        face: hit.faceId,
        uv: hit.getTextureCoordinates()?.asArray(),
        uv2: hit.getTextureCoordinates(VertexBuffer.UV2Kind)?.asArray(),
        material: material
          ? {
              name: material.name,
              type: material.getClassName(),
              frozen: material.isFrozen,
              alpha: material.alpha,
              alphaMode: material.alphaMode,
              transparencyMode: material.transparencyMode,
              disableDepthWrite: material.disableDepthWrite,
              depthFunction: material.depthFunction,
              zOffset: material.zOffset,
              zOffsetUnits: material.zOffsetUnits,
              backFaceCulling: material.backFaceCulling,
              textures: [...new Set(material.getActiveTextures())].slice(0, 12).map((texture) => ({
                name: texture.name,
                size: texture.getSize(),
                hasAlpha: texture.hasAlpha,
                coordinatesIndex: texture.coordinatesIndex,
                gammaSpace: texture.gammaSpace,
                format: texture.getInternalTexture()?.format,
                ready: texture.getInternalTexture()?.isReady ?? false,
                ...(texture instanceof Texture
                  ? {
                      // Preserve the actual asset URL so KTX2 sidecars are distinguishable
                      // from source images; blob URLs are only local identifiers.
                      url: texture.url?.startsWith("data:")
                        ? `${texture.url.slice(0, texture.url.indexOf(",") + 1)}[inline data omitted]`
                        : texture.url?.slice(0, 512),
                      invertY: texture.invertY,
                      scale: [texture.uScale, texture.vScale],
                      offset: [texture.uOffset, texture.vOffset],
                      rotation: [texture.uAng, texture.vAng, texture.wAng],
                    }
                  : {}),
              })),
            }
          : null,
      };
    }),
  };
}
