/**
 * SceneCommand - Scene information and debugging
 */

import { Command, CommandDef } from '../Command';

export default class SceneCommand extends Command {
  readonly definition: CommandDef = {
    name: 'scene',
    description: 'Scene information and debugging',
    usage: 'scene [subcommand]',
    developer: true,
    subcommands: [
      { name: 'info', description: 'Show scene statistics' },
      { name: 'meshes', description: 'List all meshes' },
      { name: 'materials', description: 'List all materials' },
      { name: 'lights', description: 'List all lights' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    // Get scene from camera system
    let scene;
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return 'Scene not available';
    }

    if (!scene) {
      return 'No active scene';
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'meshes': {
        const meshes = scene.meshes;
        const lines = [`${meshes.length} meshes:`];
        const sorted = [...meshes].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        for (const mesh of sorted.slice(0, 50)) {
          const tris = mesh.getTotalVertices ? Math.floor(mesh.getTotalVertices() / 3) : 0;
          lines.push(`  ${mesh.name || '(unnamed)'} - ${tris} tris`);
        }
        if (meshes.length > 50) {
          lines.push(`  ... and ${meshes.length - 50} more`);
        }
        return lines.join('\n');
      }

      case 'materials': {
        const materials = scene.materials;
        const lines = [`${materials.length} materials:`];
        for (const mat of materials.slice(0, 30)) {
          lines.push(`  ${mat.name || '(unnamed)'} - ${mat.getClassName()}`);
        }
        if (materials.length > 30) {
          lines.push(`  ... and ${materials.length - 30} more`);
        }
        return lines.join('\n');
      }

      case 'lights': {
        const lights = scene.lights;
        const lines = [`${lights.length} lights:`];
        for (const light of lights) {
          lines.push(`  ${light.name || '(unnamed)'} - ${light.getClassName()}`);
        }
        return lines.join('\n');
      }

      case 'info':
      default: {
        const meshCount = scene.meshes.length;
        const matCount = scene.materials.length;
        const texCount = scene.textures.length;
        const lightCount = scene.lights.length;
        const activeMeshes = scene.getActiveMeshes().length;
        
        return `Scene Statistics:\n` +
          `  Meshes: ${meshCount} (${activeMeshes} active)\n` +
          `  Materials: ${matCount}\n` +
          `  Textures: ${texCount}\n` +
          `  Lights: ${lightCount}\n` +
          `  FPS: ${scene.getEngine().getFps().toFixed(1)}`;
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['info', 'meshes', 'materials', 'lights'];
    }
    return [];
  }
}
