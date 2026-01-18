
import { Command, CommandDef } from "../Command";
import { CameraSystem } from "../../camera/CameraSystem";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export default class DumpSceneCommand extends Command {
    definition: CommandDef = {
        name: "dump_scene",
        description: "Dump scene meshes to find artifacts",
        usage: "dump_scene [filter]",
        developer: true
    };

    async execute(args: string[]): Promise<string> {
        const filter = args[0] ? args[0].toLowerCase() : "";

        const camera = CameraSystem.getInstance().getCamera();
        const scene = camera?.getScene();

        if (!scene) return "No active scene.";

        const meshes = scene.meshes;
        let output = `Scene Dump (${meshes.length} meshes):\n`;
        let count = 0;

        meshes.forEach(m => {
            const name = m.name.toLowerCase();
            // Filter if provided
            if (filter && !name.includes(filter)) return;

            // Special check for green materials if no filter, as user reports green artifacts
            let isGreen = false;
            if (m.material) {
                let color: Color3 | undefined;
                if (m.material instanceof StandardMaterial) {
                    color = m.material.diffuseColor;
                } else if (m.material instanceof PBRMaterial) {
                    color = m.material.albedoColor;
                }

                if (color && color.g > 0.8 && color.r < 0.5 && color.b < 0.5) {
                    isGreen = true;
                }
            }

            // If filtering, show match. If no filter, show everything but highlight likely suspects
            if (filter || isGreen || name.includes("debug") || name.includes("ring") || name.includes("indicator")) {
                count++;
                output += `[${count}] "${m.name}" (Class: ${m.getClassName()})\n`;
                output += `    Pos: ${m.position.toString()}\n`;
                output += `    Parent: ${m.parent ? m.parent.name : "NONE"}\n`;
                output += `    Material: ${m.material ? m.material.name : "NONE"}`;

                if (isGreen) output += " [POSSIBLE GREEN SOURCE]";
                output += "\n";
            }
        });

        if (count === 0) {
            return `No meshes found matching filter '${filter}' (or common debug terms). Total meshes: ${meshes.length}`;
        }

        return output;
    }
}
