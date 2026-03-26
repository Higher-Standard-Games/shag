/**
 * WeaponCommand - Console commands for weapon system
 *
 * Commands:
 * - weapon load <name> [pk3path] - Load a weapon model
 * - weapon pos <x> <y> <z>       - Adjust weapon offset
 * - weapon scale <n>             - Adjust weapon scale
 * - weapon preset <hip|ads|lowered> - Use position preset
 * - weapon clear                 - Remove current weapon
 * - weapon info                  - Show current weapon info
 */

import { getWeaponViewManager } from "../../weapon/WeaponViewManager";
import { Command, type CommandDef } from "../Command";

export default class WeaponCommand extends Command {
  readonly definition: CommandDef = {
    name: "weapon",
    description: "Weapon system commands",
    usage: "weapon <subcommand> [args]",
    subcommands: [
      {
        name: "load",
        description: "Load weapon model",
        args: [
          { name: "name", type: "string", required: true },
          { name: "pk3path", type: "string", required: false },
        ],
      },
      {
        name: "pos",
        description: "Set position offset",
        args: [
          { name: "x", type: "number", required: true },
          { name: "y", type: "number", required: true },
          { name: "z", type: "number", required: true },
        ],
      },
      {
        name: "scale",
        description: "Set weapon scale",
        args: [{ name: "scale", type: "number", required: true }],
      },
      {
        name: "preset",
        description: "Use position preset",
        args: [{ name: "preset", type: "enum", required: true, options: ["hip", "ads", "lowered"] }],
      },
      { name: "clear", description: "Remove current weapon" },
      { name: "info", description: "Show current weapon info" },
      { name: "hide", description: "Hide weapon model" },
      { name: "show", description: "Show weapon model" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "load":
        return this.loadWeapon(args.slice(1));
      case "spawn":
        return this.spawnInWorld(args.slice(1));
      case "pos":
      case "offset":
        return this.setOffset(args.slice(1));
      case "scale":
        return this.setScale(args.slice(1));
      case "preset":
        return this.setPreset(args.slice(1));
      case "clear":
        getWeaponViewManager().clear();
        return "Weapon cleared";
      case "info":
        return this.showInfo();
      case "hide":
        getWeaponViewManager().setVisible(false);
        return "Weapon hidden";
      case "show":
        getWeaponViewManager().setVisible(true);
        return "Weapon visible";
      case "debug":
        getWeaponViewManager().enableDebug(args[1] !== "0");
        return `Debug ${args[1] !== "0" ? "enabled" : "disabled"}`;
      default:
        return this.getHelp();
    }
  }

  /**
   * Spawn weapon in world space for debugging (not attached to camera)
   */
  private async spawnInWorld(args: string[]): Promise<string> {
    const weaponName = args[0] || "plasmagun";
    const pk3Path = "data/data0_21pure.pk3";
    const scale = parseFloat(args[1]) || 1.0;

    try {
      const { PK3Loader } = await import("../../loader/pk3/PK3Loader");
      const { getMD3Loader } = await import("../../loader/model/MD3Loader");
      const { CameraSystem } = await import("../../camera/CameraSystem");
      const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial");
      const { Texture } = await import("@babylonjs/core/Materials/Textures/texture");
      const { Vector3 } = await import("@babylonjs/core/Maths/math.vector");

      const pk3 = PK3Loader.getInstance();
      await pk3.loadPK3FromUrl(pk3Path);

      const modelPath = `models/weapons/${weaponName}/${weaponName}.md3`;
      const texturePath = `models/weapons/${weaponName}/${weaponName}.jpg`;

      const modelBuffer = await pk3.getFile(modelPath);
      if (!modelBuffer) {
        return `Model not found: ${modelPath}`;
      }

      const camera = CameraSystem.getInstance().getCamera();
      const scene = camera?.getScene();
      if (!scene) {
        return "No active scene";
      }

      const md3 = getMD3Loader();
      md3.init(scene);

      const model = md3.parseMD3(modelBuffer);
      const result = md3.createMeshes(model, `world_${weaponName}`);
      if (!result) {
        return "Failed to create meshes";
      }

      // Position in front of camera
      const forward = camera!.getDirection(Vector3.Forward());
      const spawnPos = camera!.position.add(forward.scale(100));
      result.root.position.copyFrom(spawnPos);
      result.root.scaling.setAll(scale);

      // Load texture
      const textureUrl = await pk3.getFileAsURL(texturePath, "image/jpeg");
      if (textureUrl) {
        for (const mesh of result.meshes) {
          const mat = new StandardMaterial(`${weaponName}_world_mat`, scene);
          mat.diffuseTexture = new Texture(textureUrl, scene);
          mat.specularColor.set(0.2, 0.2, 0.2);
          mesh.material = mat;
        }
      }

      return `Spawned ${weaponName} at (${spawnPos.x.toFixed(0)}, ${spawnPos.y.toFixed(0)}, ${spawnPos.z.toFixed(0)}) scale=${scale}`;
    } catch (e) {
      return `Error: ${e}`;
    }
  }

  private async loadWeapon(args: string[]): Promise<string> {
    const weaponName = args[0];
    if (!weaponName) {
      return "Usage: weapon load <name> [pk3path]";
    }

    const pk3Path = args[1] || "data/data0_21pure.pk3";

    const wvm = getWeaponViewManager();
    const success = await wvm.loadWeapon(weaponName, pk3Path);

    if (success) {
      const info = wvm.getWeaponInfo();
      return `Loaded weapon: ${weaponName}\nSurfaces: ${info?.surfaces}, Frames: ${info?.frames}`;
    }

    return `Failed to load weapon: ${weaponName}`;
  }

  private setOffset(args: string[]): string {
    const wvm = getWeaponViewManager();
    const current = wvm.getCurrentPosition();

    if (args.length < 3) {
      return `Current offset: (${current.offset.x.toFixed(3)}, ${current.offset.y.toFixed(3)}, ${current.offset.z.toFixed(3)})
Usage: weapon pos <x> <y> <z>`;
    }

    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);

    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
      return "Invalid coordinates";
    }

    wvm.setOffset(x, y, z);
    return `Weapon offset: (${x}, ${y}, ${z})`;
  }

  private setScale(args: string[]): string {
    const wvm = getWeaponViewManager();
    const current = wvm.getCurrentPosition();

    if (args.length < 1) {
      return `Current scale: ${current.scale}\nUsage: weapon scale <n>`;
    }

    const scale = parseFloat(args[0]);
    if (Number.isNaN(scale) || scale <= 0) {
      return "Invalid scale value";
    }

    wvm.setScale(scale);
    return `Weapon scale: ${scale}`;
  }

  private setPreset(args: string[]): string {
    const preset = args[0]?.toLowerCase();
    if (!preset || !["hip", "ads", "lowered"].includes(preset)) {
      return "Usage: weapon preset <hip|ads|lowered>";
    }

    getWeaponViewManager().setPosition(preset as "hip" | "ads" | "lowered");
    return `Weapon preset: ${preset}`;
  }

  private showInfo(): string {
    const wvm = getWeaponViewManager();
    const info = wvm.getWeaponInfo();
    if (!info) {
      return "No weapon loaded";
    }

    const pos = wvm.getCurrentPosition();
    return `Weapon: ${info.name}
Surfaces: ${info.surfaces}, Frames: ${info.frames}
Offset: (${pos.offset.x.toFixed(3)}, ${pos.offset.y.toFixed(3)}, ${pos.offset.z.toFixed(3)})
Rotation: (${pos.rotation.x.toFixed(3)}, ${pos.rotation.y.toFixed(3)}, ${pos.rotation.z.toFixed(3)})
Scale: ${pos.scale}`;
  }
}
