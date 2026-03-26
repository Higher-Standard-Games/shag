/**
 * PvsCommand - PVS (Potentially Visible Set) culling control
 *
 * Controls BSP visibility culling for performance optimization.
 */

import { Command, type CommandDef } from "../Command";

export class PvsCommand extends Command {
  readonly definition: CommandDef = {
    name: "pvs",
    description: "PVS visibility culling control",
    usage: "pvs <on|off|status|cluster>",
  };

  async execute(args: string[]): Promise<string> {
    const { BspManager } = await import("../../loader/bsp/BspManager");
    const { CameraSystem } = await import("../../camera/CameraSystem");

    const manager = BspManager.getInstance();
    const cameraSystem = CameraSystem.getInstance();
    const camera = cameraSystem.getCamera();
    const scene = camera?.getScene();

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "on": {
        if (!scene || !camera) {
          return "No scene or camera available";
        }
        return manager.enablePVS(scene, camera);
      }

      case "off": {
        if (!scene) {
          return "No scene available";
        }
        return manager.disablePVS(scene);
      }

      case "status":
        return manager.getPVSStatus(camera || undefined);

      case "cluster": {
        if (!camera) {
          return "No camera available";
        }
        return await manager.getCameraClusterInfo(camera);
      }

      default:
        return [
          "PVS Commands:",
          "  pvs on      - Enable PVS culling",
          "  pvs off     - Disable PVS culling",
          "  pvs status  - Show culling statistics",
          "  pvs cluster - Show current cluster info",
        ].join("\n");
    }
  }
}

export default PvsCommand;
