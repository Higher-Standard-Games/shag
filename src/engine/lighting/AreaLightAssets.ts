/**
 * AreaLightAssets — localize Babylon's CDN asset base for offline / no-CDN use.
 *
 * Some Babylon 9 runtime features fetch small data files from
 * `https://assets.babylonjs.com/core/...` on first use. The headliner for us is
 * RectAreaLight (textured area lights): its LTC (Linearly-Transformed-Cosines)
 * lookup textures are loaded from `.../core/areaLights/areaLightsLTC.bin` via
 * `Tools.GetAssetUrl`, which the material's area-light path waits on
 * (`scene._ltcTextures.LTC1/LTC2.isReady()`).
 *
 * Our CSP/offline posture forbids CDN fetches (same reason the Havok wasm and
 * the KTX2 transcoder are vendored). `Tools.GetAssetUrl` rewrites any URL under
 * `Tools._DefaultAssetsUrl` (`https://assets.babylonjs.com/core`) to
 * `Tools.AssetBaseUrl` when set — so one assignment redirects every such asset
 * to our vendored mirror under `public/assets/babylon/core/…`. Vendored file:
 * `public/assets/babylon/core/areaLights/areaLightsLTC.bin`.
 */

import { Tools } from "@babylonjs/core/Misc/tools";

/** Served base that mirrors `https://assets.babylonjs.com/core`. */
export const BABYLON_ASSET_BASE_URL = "/assets/babylon/core";

let applied = false;

/**
 * Point Babylon's asset base at our vendored mirror (idempotent). Call once
 * during engine init, before any feature that fetches CDN assets (area lights).
 */
export function localizeBabylonAssetUrls(): void {
  if (applied) return;
  applied = true;
  Tools.AssetBaseUrl = BABYLON_ASSET_BASE_URL;
}
