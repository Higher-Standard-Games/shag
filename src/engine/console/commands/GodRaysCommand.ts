/**
 * GodRaysCommand — spawn Babylon 9 volumetric light scattering (god rays) to
 * demo/tune the SunGodRays path (docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md).
 * Delegates to GodRaysController, the single owner of the one active VLS pass.
 *
 *   godrays              sun shafts tracking the SkyLightSystem sun (sky excluded)
 *   godrays sun          same as above (explicit)
 *   godrays here         a fixed god-ray emitter 300 units ahead of the camera
 *   godrays off          remove the current god rays
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Command, type CommandDef } from "../Command";

export default class GodRaysCommand extends Command {
  readonly definition: CommandDef = {
    name: "godrays",
    description: "Spawn Babylon 9 volumetric god rays (sun shafts or a fixed emitter)",
    usage: "godrays [sun|here|off]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    const camera = CameraSystem.getInstance().getCamera();
    const scene = camera?.getScene();
    if (!camera || !scene) return "No active scene";

    const { GodRaysController } = await import("../../lighting/GodRaysController");
    const controller = GodRaysController.getInstance();

    if (args[0] === "off" || args[0] === "clear") {
      controller.disable();
      return "god rays removed";
    }

    if (args[0] === "here") {
      // Fixed emitter a few metres ahead of the view (a lamp/portal stand-in).
      const forward = camera.getDirection(Vector3.Forward()).normalize();
      const anchor = camera.position.add(forward.scale(300));
      controller.enableAnchored(scene, camera, anchor);
      return "spawned a fixed god-ray emitter ahead of camera (`godrays off` to remove)";
    }

    controller.enableSun(scene, camera);
    return "spawned sun god rays tracking the sky sun (`godrays off` to remove)";
  }
}
