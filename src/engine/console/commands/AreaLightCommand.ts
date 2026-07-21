/**
 * AreaLightCommand — spawn a Babylon 9 textured area light in front of the
 * camera to demo/tune the RectAreaLight path (docs/research/
 * BABYLON9_AREA_VOLUMETRIC_LIGHTS.md). By default it projects a procedurally
 * drawn sci-fi wall panel as the light source; pass an image URL to project any
 * texture.
 *
 *   arealight              spawn the demo panel ahead of the camera
 *   arealight <url>        project a specific image
 *   arealight off          remove the current demo panel
 */

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

let currentPanel: { dispose(): void } | null = null;
let currentSource: { dispose(): void } | null = null;

export default class AreaLightCommand extends Command {
  readonly definition: CommandDef = {
    name: "arealight",
    description: "Spawn a Babylon 9 textured area light ahead of the camera (POC)",
    usage: "arealight [<image-url>|off]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    const { CameraSystem } = await import("../../camera/CameraSystem");
    const camera = CameraSystem.getInstance().getCamera();
    const scene = camera?.getScene();
    if (!camera || !scene) return "No active scene";

    if (args[0] === "off" || args[0] === "clear") {
      this.clear();
      return "area light removed";
    }

    this.clear();

    const { AreaLightPanel } = await import("../../lighting/AreaLightPanel");

    // Place it a few metres ahead, emitting back toward the player's view so the
    // surrounding surfaces catch it.
    const forward = camera.getDirection(Vector3.Forward()).normalize();
    const center = camera.position.add(forward.scale(120));
    const faceDir = forward.scale(-1); // emit toward the camera/room

    let emissionTextureUrl: string | undefined;
    let emissionSource: DynamicTexture | undefined;
    if (args[0]) {
      emissionTextureUrl = args[0];
    } else {
      emissionSource = this.buildDemoPanelTexture(scene);
      currentSource = emissionSource;
    }

    const panel = new AreaLightPanel(scene, {
      name: "console_area_light",
      position: center,
      faceDir,
      width: 64,
      height: 40,
      intensity: 6,
      color: new Color3(1, 1, 1),
      emissionTextureUrl,
      emissionSource,
    });
    currentPanel = panel;

    return emissionSource
      ? "spawned demo area-light panel ahead of camera (`arealight off` to remove)"
      : `spawned area light projecting ${args[0]} (\`arealight off\` to remove)`;
  }

  private clear(): void {
    currentPanel?.dispose();
    currentPanel = null;
    currentSource?.dispose();
    currentSource = null;
  }

  /** Draw a glowing sci-fi wall panel onto a DynamicTexture (the light source). */
  private buildDemoPanelTexture(scene: Scene): DynamicTexture {
    const w = 512;
    const h = 320;
    const tex = new DynamicTexture("area_light_demo", { width: w, height: h }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

    ctx.fillStyle = "#06090d";
    ctx.fillRect(0, 0, w, h);
    // Cyan header bar
    ctx.fillStyle = "#0a2f45";
    ctx.fillRect(24, 24, w - 48, 70);
    ctx.fillStyle = "#5fd7ff";
    ctx.font = "bold 44px monospace";
    ctx.fillText("STORAGE ROOM", 44, 76);
    // Orange sub-row
    ctx.fillStyle = "#3a2408";
    ctx.fillRect(24, 110, w - 48, 60);
    ctx.fillStyle = "#ffb347";
    ctx.font = "bold 38px monospace";
    ctx.fillText("ENGINE ROOM  »»", 44, 154);
    // Warning stripe
    for (let x = 24; x < w - 24; x += 40) {
      ctx.fillStyle = x % 80 === 24 ? "#e8c020" : "#101010";
      ctx.fillRect(x, 200, 40, 24);
    }
    ctx.fillStyle = "#c9d4dc";
    ctx.font = "20px monospace";
    ctx.fillText("SECTOR B-04   ACCESS: OPEN", 44, 268);

    tex.update();
    return tex;
  }
}
