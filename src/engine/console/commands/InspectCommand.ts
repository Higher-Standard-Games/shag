/**
 * InspectCommand - Inspect mesh under cursor
 */

import { Command, CommandDef } from '../Command';

export default class InspectCommand extends Command {
  readonly definition: CommandDef = {
    name: 'inspect',
    description: 'Inspect mesh under cursor',
    usage: 'inspect',
    developer: true,
  };

  async execute(): Promise<string | void> {
    // Get scene and camera
    let scene;
    let camera;
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      camera = CameraSystem.getInstance().getCamera();
      scene = camera?.getScene();
    } catch {
      return 'Scene not available';
    }

    if (!scene || !camera) {
      return 'No active scene/camera';
    }

    // Cast ray from center of screen
    const ray = scene.createPickingRay(
      scene.getEngine().getRenderWidth() / 2,
      scene.getEngine().getRenderHeight() / 2,
      null,
      camera
    );

    const hit = scene.pickWithRay(ray);

    if (!hit?.hit || !hit.pickedMesh) {
      return 'No mesh hit';
    }

    const mesh = hit.pickedMesh;
    const pos = hit.pickedPoint;
    
    const lines = [`Inspecting: ${mesh.name}`];
    lines.push(`  Distance: ${hit.distance.toFixed(2)}`);
    if (pos) {
      lines.push(`  Hit point: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
    }
    lines.push(`  Vertices: ${mesh.getTotalVertices()}`);
    lines.push(`  Material: ${mesh.material?.name || 'none'}`);
    
    if (mesh.metadata) {
      lines.push(`  Metadata: ${JSON.stringify(mesh.metadata).slice(0, 80)}...`);
    }

    return lines.join('\n');
  }
}
