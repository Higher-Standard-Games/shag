/**
 * AreaLightPanel / area-light plumbing (NullEngine). Verifies the Babylon-9
 * textured-area-light wiring that can't be visually checked headlessly:
 *  - the RectAreaLight side-effect registers the type (typeID 4), so the light
 *    is real and added to the scene (the outline/physics side-effect class);
 *  - the light is oriented via its anchor and disposes cleanly;
 *  - our CDN→vendored asset redirect is applied (so LTC data loads offline).
 * The actual lit result + emission-texture projection is browser-validated.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Tools } from "@babylonjs/core/Misc/tools";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BABYLON_ASSET_BASE_URL, localizeBabylonAssetUrls } from "../AreaLightAssets";
import { AreaLightPanel } from "../AreaLightPanel";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("AreaLightAssets", () => {
  it("redirects Babylon's asset base to our vendored mirror", () => {
    Tools.AssetBaseUrl = ""; // reset
    localizeBabylonAssetUrls();
    expect(Tools.AssetBaseUrl).toBe(BABYLON_ASSET_BASE_URL);

    // The LTC binary the CDN would serve now resolves to our public/ mirror.
    const cdn = "https://assets.babylonjs.com/core/areaLights/areaLightsLTC.bin";
    expect(Tools.GetAssetUrl(cdn)).toBe(`${BABYLON_ASSET_BASE_URL}/areaLights/areaLightsLTC.bin`);
  });
});

describe("AreaLightPanel", () => {
  it("creates a registered RectAreaLight in the scene (side-effect wired)", () => {
    const panel = new AreaLightPanel(scene, {
      name: "test_panel",
      position: new Vector3(0, 50, 100),
      faceDir: new Vector3(0, 0, -1),
      width: 40,
      height: 20,
      intensity: 3,
      color: new Color3(0.2, 0.6, 1),
    });

    // RectAreaLight registered → real light type (getTypeID 4), added to scene.
    expect(panel.light.getClassName()).toBe("RectAreaLight");
    expect(panel.light.getTypeID()).toBe(4);
    expect(scene.lights).toContain(panel.light);
    expect(panel.light.width).toBe(40);
    expect(panel.light.height).toBe(20);
    expect(panel.light.intensity).toBe(3);
    // Redirect applied as a side effect of construction.
    expect(Tools.AssetBaseUrl).toBe(BABYLON_ASSET_BASE_URL);

    panel.dispose();
    expect(scene.lights).not.toContain(panel.light);
  });

  it("re-poses without error and disposes idempotently", () => {
    const panel = new AreaLightPanel(scene, {
      name: "p2",
      position: new Vector3(0, 0, 0),
      width: 10,
      height: 10,
    });
    expect(() => panel.setPose(new Vector3(5, 5, 5), new Vector3(1, 0, 0))).not.toThrow();
    panel.dispose();
    expect(() => panel.dispose()).not.toThrow();
  });
});
