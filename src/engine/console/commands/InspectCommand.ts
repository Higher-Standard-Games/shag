/**
 * InspectCommand - Inspect mesh under cursor
 */

import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Command, type CommandDef } from "../Command";

function describeTexture(label: string, texture: BaseTexture | null | undefined): string | null {
  if (!texture) return null;
  const anyTexture = texture as BaseTexture & {
    level?: number;
    coordinatesIndex?: number;
    url?: string;
  };
  const name = texture.name || anyTexture.url || "(unnamed)";
  const level = anyTexture.level !== undefined ? ` level=${anyTexture.level}` : "";
  const uv = anyTexture.coordinatesIndex !== undefined ? ` uv=${anyTexture.coordinatesIndex}` : "";
  return `  ${label}: ${name}${level}${uv}`;
}

export default class InspectCommand extends Command {
  readonly definition: CommandDef = {
    name: "inspect",
    description: "Inspect mesh under cursor",
    usage: "inspect",
    developer: true,
  };

  async execute(): Promise<string | undefined> {
    // Get scene and camera
    let scene;
    let camera;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      camera = CameraSystem.getInstance().getCamera();
      scene = camera?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene || !camera) {
      return "No active scene/camera";
    }

    // Cast ray from center of screen
    const ray = scene.createPickingRay(
      scene.getEngine().getRenderWidth() / 2,
      scene.getEngine().getRenderHeight() / 2,
      null,
      camera,
    );

    const hit = scene.pickWithRay(ray);

    if (!hit?.hit || !hit.pickedMesh) {
      return "No mesh hit";
    }

    const mesh = hit.pickedMesh;
    const pos = hit.pickedPoint;

    const lines = [`Inspecting: ${mesh.name}`];
    lines.push(`  Distance: ${hit.distance.toFixed(2)}`);
    if (pos) {
      lines.push(`  Hit point: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
    }
    lines.push(`  Mesh class: ${mesh.getClassName()}`);
    lines.push(`  Vertices: ${mesh.getTotalVertices()}`);
    lines.push(`  Material: ${mesh.material?.name || "none"}`);
    lines.push(`  Material class: ${mesh.material?.getClassName?.() || "none"}`);

    const material = mesh.material;
    if (material instanceof StandardMaterial) {
      lines.push(`  Alpha: ${material.alpha}`);
      lines.push(`  Disable lighting: ${material.disableLighting}`);
      lines.push(`  Specular power: ${material.specularPower}`);
      lines.push(
        `  Specular color: (${material.specularColor.r.toFixed(2)}, ${material.specularColor.g.toFixed(2)}, ${material.specularColor.b.toFixed(2)})`,
      );
      for (const entry of [
        describeTexture("Diffuse", material.diffuseTexture),
        describeTexture("Normal", material.bumpTexture),
        describeTexture("Gloss", material.specularTexture),
        describeTexture("Lightmap", material.lightmapTexture),
        describeTexture("Emissive", material.emissiveTexture),
      ]) {
        if (entry) lines.push(entry);
      }
    } else if (material instanceof PBRMaterial) {
      lines.push(`  Alpha: ${material.alpha}`);
      lines.push(`  Metallic: ${material.metallic}`);
      lines.push(`  Roughness: ${material.roughness}`);
      lines.push(`  MicroSurface: ${material.microSurface}`);
      lines.push(`  Environment intensity: ${material.environmentIntensity}`);
      lines.push(
        `  Reflectivity color: (${material.reflectivityColor.r.toFixed(2)}, ${material.reflectivityColor.g.toFixed(2)}, ${material.reflectivityColor.b.toFixed(2)})`,
      );
      for (const entry of [
        describeTexture("Albedo", material.albedoTexture),
        describeTexture("Normal", material.bumpTexture),
        describeTexture("Reflectivity", material.reflectivityTexture),
        describeTexture("MicroSurface", material.microSurfaceTexture),
        describeTexture("Lightmap", material.lightmapTexture),
        describeTexture("Emissive", material.emissiveTexture),
      ]) {
        if (entry) lines.push(entry);
      }
    }

    if (mesh.metadata) {
      try {
        lines.push(`  Metadata: ${JSON.stringify(mesh.metadata).slice(0, 220)}`);
      } catch {
        lines.push("  Metadata: [unserializable]");
      }
    }

    return lines.join("\n");
  }
}
