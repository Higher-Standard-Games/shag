/**
 * Sky portals read as Warfork reads them, the portal camera's place under a
 * scale, how each material pass takes world fog, and the fog's scale inside a
 * portal pass.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorldFog } from "../../loader/bsp/WorldFog";
import { fogPassKind, isSkyMesh } from "../AtmosphericFogPlugin";
import { parseSkyPortal, skyPortalCameraOrigin } from "../SkyPortal";
import { WorldFogController } from "../WorldFogController";

describe("parseSkyPortal", () => {
  it("reads wdm1's plain portal", () => {
    const portal = parseSkyPortal([
      { classname: "worldspawn", properties: {} },
      { classname: "misc_skyportal", properties: { origin: "3328 3328 3296" } },
    ]);
    expect(portal).toEqual({ origin: [3328, 3328, 3296], fov: 0, scale: 0, noEnts: false, rotationSpeed: [0, 0, 0] });
  });

  it("reads fov, scale, noents and angles as rotation speeds, and the props_ name", () => {
    expect(
      parseSkyPortal([
        {
          classname: "props_skyportal",
          properties: { origin: "0 0 0", fov: "90", scale: "16", noents: "1", angles: "0 10 0" },
        },
      ]),
    ).toEqual({ origin: [0, 0, 0], fov: 90, scale: 16, noEnts: true, rotationSpeed: [0, 10, 0] });
  });

  it("has no portal without the entity or its origin", () => {
    expect(parseSkyPortal([{ classname: "worldspawn", properties: {} }])).toBeNull();
    expect(parseSkyPortal([{ classname: "misc_skyportal", properties: {} }])).toBeNull();
  });
});

describe("skyPortalCameraOrigin", () => {
  const portal = new Vector3(100, 200, 300);
  const centre = new Vector3(0, 0, 0);

  it("stays at the portal without a scale", () => {
    expect(skyPortalCameraOrigin(portal, 0, centre, new Vector3(500, 0, 0)).asArray()).toEqual([100, 200, 300]);
  });

  it("moves by the player's offset from the world centre over the scale", () => {
    expect(skyPortalCameraOrigin(portal, 16, centre, new Vector3(1600, 0, -320)).asArray()).toEqual([200, 200, 280]);
  });
});

describe("fog passes", () => {
  const scene = new Scene(new NullEngine());
  const mesh = new Mesh("bsp_tex_1", scene);
  const material = (alphaMode: number, alpha = 0.5) => {
    const m = new StandardMaterial("m", scene);
    m.alpha = alpha;
    m.alphaMode = alphaMode;
    return m;
  };

  it("mixes opaque surfaces whatever their alpha mode", () => {
    expect(fogPassKind(material(Constants.ALPHA_ADD, 1), mesh)).toBe("mix");
  });

  it("fades additive blends to black and filters toward white", () => {
    expect(fogPassKind(material(Constants.ALPHA_ADD), mesh)).toBe("additive");
    expect(fogPassKind(material(Constants.ALPHA_ONEONE), mesh)).toBe("additive");
    expect(fogPassKind(material(Constants.ALPHA_MULTIPLY), mesh)).toBe("filter");
    expect(fogPassKind(material(Constants.ALPHA_COMBINE), mesh)).toBe("mix");
  });

  it("knows the sky meshes", () => {
    expect(isSkyMesh(new Mesh("skybox", scene))).toBe(true);
    expect(isSkyMesh(new Mesh("skybox_cloud_2", scene))).toBe(true);
    expect(isSkyMesh(mesh)).toBe(false);
  });
});

describe("portal fog scale", () => {
  afterEach(() => WorldFogController.getInstance().setMap(null, null));

  it("scales start and heights by the portal scale and divides density by it, for the pass only", () => {
    const controller = WorldFogController.getInstance();
    const scene = new Scene(new NullEngine());
    controller.setMap(scene, parseWorldFog({ fog: "10000 1 1 1 700", fog_height: "0 256" }));
    controller.setPortalScale(1 / 16);
    expect(controller.getActive()?.minDist).toBeCloseTo(700 / 16);
    expect(controller.getActive()?.density).toBeCloseTo((3 / 10000) * 16);
    expect(controller.getActive()?.height).toEqual({ clear: 0, full: 16 });
    expect(scene.fogStart).toBeCloseTo(700 / 16);
    controller.setPortalScale(0);
    expect(controller.getActive()?.minDist).toBe(700);
    expect(scene.fogStart).toBe(700);
  });
});
