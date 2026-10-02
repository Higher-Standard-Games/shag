import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import type { IDecodedData, IKTX2DecoderOptions } from "@babylonjs/core/Materials/Textures/ktx2decoderTypes";
import { _KTXTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";
import { registerTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/textureLoaderManager";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";

// A separate registry key keeps ordinary Babylon KTX/glTF loads independent.
// Retain it on InternalTexture as well: device restoration uses that extension.
export const KTX2_SIDECAR_EXTENSION = ".shagktx2";

class SidecarContainer extends KhronosTextureContainer2 {
  protected override _createTexture(
    data: IDecodedData,
    texture: InternalTexture,
    options?: IKTX2DecoderOptions & IDecodedData,
  ): void {
    super._createTexture(data, texture, options);
    // Babylon 9.17 leaves raw RGBA/R/RG textures at the LAST mip's dimensions.
    // Restore the decoded base extent before the engine's load callback runs.
    texture.width = data.mipmaps[0].width;
    texture.height = data.mipmaps[0].height;
    texture._extension = KTX2_SIDECAR_EXTENSION;
  }
}

export class KTX2SidecarLoader extends _KTXTextureLoader {
  override loadData(
    data: ArrayBufferView,
    texture: InternalTexture,
    callback: Parameters<_KTXTextureLoader["loadData"]>[2],
    options?: IKTX2DecoderOptions & IDecodedData,
  ): void {
    if (!KhronosTextureContainer2.IsValid(data)) {
      callback(0, 0, false, false, () => {}, true);
      return;
    }
    // Sidecars contain the converter's top-to-bottom rows, like our TGA raw
    // textures. Compressed uploads cannot flip; raw uploads must match them.
    // This also avoids Babylon 9.17 WebGPU's cached mip-0 invert-Y bind group
    // being reused for every raw mip, replacing distant mips with base crops.
    texture.invertY = false;
    const container = new SidecarContainer(texture.getEngine());
    void container._uploadAsync(data, texture, options).then(
      () => callback(texture.width, texture.height, texture.generateMipMaps, true, () => {}, false),
      (error: unknown) => {
        console.warn("[KTX2] Sidecar upload failed", error);
        callback(0, 0, false, false, () => {}, true);
      },
    );
  }
}

let registered = false;
export function registerKTX2SidecarLoader(): void {
  if (registered) return;
  registerTextureLoader(KTX2_SIDECAR_EXTENSION, () => new KTX2SidecarLoader());
  registered = true;
}
