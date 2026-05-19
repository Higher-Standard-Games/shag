/**
 * ScreenshotCommand - Take a screenshot
 */

import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";
// Side-effect: registers CreateScreenshot on Tools
import "@babylonjs/core/Misc/screenshotTools";

export default class ScreenshotCommand extends Command {
  readonly definition: CommandDef = {
    name: "screenshot",
    aliases: ["ss"],
    description: "Take a screenshot",
    usage: "screenshot [filename]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    // Get scene
    let scene: Scene | null | undefined;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene) {
      return "No active scene";
    }

    const { Tools } = await import("@babylonjs/core/Misc/tools");
    const engine = scene.getEngine();

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = args[0] || `screenshot_${timestamp}`;

    // Take screenshot
    Tools.CreateScreenshot(
      engine,
      scene.activeCamera!,
      { width: engine.getRenderWidth(), height: engine.getRenderHeight() },
      (data) => {
        // Create download link
        const link = document.createElement("a");
        link.href = data;
        link.download = `${filename}.png`;
        link.click();
      },
    );

    return `Screenshot saved as ${filename}.png`;
  }
}
