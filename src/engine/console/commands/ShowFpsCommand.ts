/**
 * ShowFpsCommand - Toggle FPS display
 */

import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

export default class ShowFpsCommand extends Command {
  readonly definition: CommandDef = {
    name: "show_fps",
    aliases: ["fps"],
    description: "Toggle FPS display",
    usage: "show_fps [0|1]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    // Get scene from camera system
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

    const engine = scene.getEngine();
    const value = args[0];

    // Check current state
    const currentState = !!(window as any)._showFpsElement;

    if (value === undefined) {
      return `show_fps is ${currentState ? "1 (on)" : "0 (off)"}`;
    }

    const enable = value === "1" || value === "on" || value === "true";
    const disable = value === "0" || value === "off" || value === "false";

    if (!enable && !disable) {
      return "Usage: show_fps [0|1|on|off]";
    }

    if (enable && !currentState) {
      // Create FPS display
      const fpsEl = document.createElement("div");
      fpsEl.id = "fps-display";
      fpsEl.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        background: rgba(0,0,0,0.7);
        color: #0f0;
        padding: 4px 8px;
        font-family: monospace;
        font-size: 14px;
        z-index: 9999;
        border-radius: 4px;
      `;
      document.body.appendChild(fpsEl);
      (window as any)._showFpsElement = fpsEl;

      // Update loop
      const updateFps = () => {
        if ((window as any)._showFpsElement) {
          fpsEl.textContent = `${engine.getFps().toFixed(0)} FPS`;
          requestAnimationFrame(updateFps);
        }
      };
      updateFps();

      return "FPS display enabled";
    } else if (disable && currentState) {
      // Remove FPS display
      const el = (window as any)._showFpsElement;
      if (el) {
        el.remove();
        (window as any)._showFpsElement = null;
      }
      return "FPS display disabled";
    }

    return `show_fps is ${currentState ? "1 (on)" : "0 (off)"}`;
  }
}
