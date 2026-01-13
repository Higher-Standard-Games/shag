/**
 * SpawnModelCommand - Spawn and manipulate 3D models for testing
 *
 * Developer-only command for previewing models in the game environment.
 * Also serves as a reference implementation for game scripting.
 */

import { Command, CommandDef } from '../Command';
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ModelLoadResult } from '../../loader/model/ModelLoader';

interface SpawnedModel {
  result: ModelLoadResult;
  path: string;
  spawnIndex: number;
}

export default class SpawnModelCommand extends Command {
  readonly definition: CommandDef = {
    name: 'spawnmodel',
    aliases: ['sm'],
    description: 'Spawn and manipulate 3D models for testing',
    usage: 'spawnmodel <model> [scale=100] [x y z] [angle]',
    developer: true,
  };

  private spawnedModels: SpawnedModel[] = [];
  private nextIndex = 0;

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'list': return this.listModels();
      case 'clear': return this.clearSpawned();
      case 'info': return this.showInfo(args.slice(1));
      case 'anim': return this.controlAnimation(args.slice(1));
      case 'rotate': return this.rotateModel(args.slice(1));
      case 'move': return this.moveModel(args.slice(1));
      case 'scale': return this.scaleModel(args.slice(1));
      case 'remove': return this.removeModel(args.slice(1));
      default: return this.spawnModel(args);
    }
  }

  // ============================================================================
  // Core Spawn
  // ============================================================================

  private async spawnModel(args: string[]): Promise<string> {
    if (args.length === 0) {
      return 'Usage: spawnmodel <model> [scale=100] [x y z] [angle]';
    }

    const modelName = args[0];
    // Default scale 100 to match glTF meters to BSP/Quake units
    const scale = parseFloat(args[1]) || 100;

    // Validate scale (allow up to 1000 for very small models)
    const clampedScale = Math.max(0.01, Math.min(1000, scale));

    // Get position - either from args or camera
    let position: Vector3;
    if (args.length >= 5) {
      const x = parseFloat(args[2]);
      const y = parseFloat(args[3]);
      const z = parseFloat(args[4]);
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        return 'Position must be 3 numbers: x y z';
      }
      position = new Vector3(x, y, z);
    } else {
      const spawnPos = await this.getSpawnPosition();
      if (!spawnPos) {
        return 'No active camera for position calculation';
      }
      position = spawnPos;
    }

    // Get angle
    const angle = args.length >= 6 ? parseFloat(args[5]) || 0 : 0;

    // Resolve model path
    const modelPath = await this.resolveModelPath(modelName);
    if (!modelPath) {
      return `Model not found: ${modelName}. Use 'spawnmodel list' to see available models.`;
    }

    // Load the model
    const { ModelLoader } = await import('../../loader/model/ModelLoader');
    const loader = ModelLoader.getInstance();

    // Re-initialize ModelLoader if scene was disposed/changed
    if (!loader.isInitialized()) {
      try {
        const { CameraSystem } = await import('../../camera/CameraSystem');
        const scene = CameraSystem.getInstance().getCamera()?.getScene();
        if (scene && !scene.isDisposed) {
          loader.init(scene);
        } else {
          return 'ModelLoader not available (no active scene)';
        }
      } catch {
        return 'ModelLoader not available';
      }
    }

    const result = await loader.loadModel(modelPath, {
      position,
      scale: clampedScale,
      angle,
      hasCollision: false,
      receiveShadows: true,
      castShadows: false,
    });

    if (!result) {
      return `Failed to load model: ${modelPath}`;
    }

    // Track spawned model
    const spawnIndex = this.nextIndex++;
    this.spawnedModels.push({
      result,
      path: modelPath,
      spawnIndex,
    });

    const animInfo = result.animationGroups.length > 0
      ? ` (${result.animationGroups.length} animations)`
      : '';

    return `Spawned #${spawnIndex}: ${modelPath} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}) scale=${clampedScale}${animInfo}`;
  }

  private async getSpawnPosition(): Promise<Vector3 | null> {
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      const camera = CameraSystem.getInstance().getCamera();
      if (!camera) return null;

      const forward = camera.getDirection(Vector3.Forward());
      // BSP/Quake units are roughly 1 unit = 1 inch, so 200 units ≈ 5 meters
      const spawnDistance = 200;
      const pos = camera.position.add(forward.scale(spawnDistance));
      // Drop to ground level (Y=0) or slightly above
      pos.y = Math.max(0, pos.y - 50);
      return pos;
    } catch {
      return null;
    }
  }

  private async resolveModelPath(modelName: string): Promise<string | null> {
    const { GamePaths } = await import('../../core/GamePaths');
    const paths = GamePaths.getInstance();

    // If it has a path separator, use as-is
    if (modelName.includes('/')) {
      return paths.game(modelName);
    }

    // Try with extensions
    const extensions = ['.glb', '.gltf', ''];
    const locations = [
      (name: string) => paths.game(name),
      (name: string) => paths.game(`models/${name}`),
    ];

    for (const getPath of locations) {
      for (const ext of extensions) {
        const fullName = modelName.endsWith('.glb') || modelName.endsWith('.gltf')
          ? modelName
          : modelName + ext;
        const path = getPath(fullName);
        // We can't easily check if file exists client-side, so just return first attempt
        if (ext === '.glb' || modelName.includes('.')) {
          return path;
        }
      }
    }

    // Default: try .glb extension in game root
    return paths.game(modelName + '.glb');
  }

  // ============================================================================
  // Subcommands
  // ============================================================================

  private async listModels(): Promise<string> {
    const lines: string[] = ['Spawned models:'];

    if (this.spawnedModels.length === 0) {
      lines.push('  (none)');
    } else {
      for (const spawned of this.spawnedModels) {
        const pos = spawned.result.root.position;
        const animCount = spawned.result.animationGroups.length;
        const animStr = animCount > 0 ? ` [${animCount} anims]` : '';
        lines.push(`  #${spawned.spawnIndex}: ${spawned.path} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})${animStr}`);
      }
    }

    return lines.join('\n');
  }

  private clearSpawned(): string {
    const count = this.spawnedModels.length;

    for (const spawned of this.spawnedModels) {
      spawned.result.root.dispose();
    }

    this.spawnedModels = [];
    return `Cleared ${count} spawned models`;
  }

  private showInfo(args: string[]): string {
    if (args.length === 0) {
      return 'Usage: spawnmodel info <index>';
    }

    const index = parseInt(args[0]);
    const spawned = this.spawnedModels.find(s => s.spawnIndex === index);

    if (!spawned) {
      return `No spawned model at index ${index}`;
    }

    const { result, path } = spawned;
    const pos = result.root.position;
    const rot = (result.root.rotation.y * 180 / Math.PI).toFixed(1);
    const scale = result.root.scaling.x.toFixed(2);

    const lines: string[] = [
      `Spawned model #${index}: ${path}`,
      `  Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
      `  Rotation: ${rot} degrees`,
      `  Scale: ${scale}`,
      `  Meshes: ${result.meshes.length}`,
    ];

    if (result.animationGroups.length > 0) {
      lines.push(`  Animations:`);
      for (let i = 0; i < result.animationGroups.length; i++) {
        const anim = result.animationGroups[i];
        const playing = anim.isPlaying ? ' (playing)' : '';
        lines.push(`    [${i}] "${anim.name}"${playing}`);
      }
    }

    return lines.join('\n');
  }

  private async controlAnimation(args: string[]): Promise<string> {
    if (args.length < 2) {
      return 'Usage: spawnmodel anim <index> <animation|stop> [loop|once]';
    }

    const index = parseInt(args[0]);
    const spawned = this.spawnedModels.find(s => s.spawnIndex === index);

    if (!spawned) {
      return `No spawned model at index ${index}`;
    }

    const { ModelLoader } = await import('../../loader/model/ModelLoader');
    const loader = ModelLoader.getInstance();

    const animName = args[1];
    const mode = args[2]?.toLowerCase();

    // Handle "stop" command
    if (animName.toLowerCase() === 'stop') {
      loader.stopAnimation(spawned.result);
      return `Stopped all animations on #${index}`;
    }

    // Check if animation exists
    const animNames = loader.getAnimationNames(spawned.result);
    if (!animNames.includes(animName) && isNaN(parseInt(animName))) {
      return `Animation '${animName}' not found. Available: ${animNames.join(', ')}`;
    }

    // Handle stop for specific animation
    if (mode === 'stop') {
      loader.stopAnimation(spawned.result, animName);
      return `Stopped animation '${animName}' on #${index}`;
    }

    // Play animation
    const loop = mode !== 'once';
    const anim = loader.playAnimation(spawned.result, animName, { loop });

    if (!anim) {
      return `Failed to play animation '${animName}'`;
    }

    return `Playing '${animName}' on #${index} (${loop ? 'looping' : 'once'})`;
  }

  private rotateModel(args: string[]): string {
    if (args.length < 2) {
      return 'Usage: spawnmodel rotate <index> <angle>';
    }

    const index = parseInt(args[0]);
    const spawned = this.spawnedModels.find(s => s.spawnIndex === index);

    if (!spawned) {
      return `No spawned model at index ${index}`;
    }

    const angleStr = args[1];
    let angle: number;

    if (angleStr.startsWith('+') || angleStr.startsWith('-')) {
      // Relative rotation
      const delta = parseFloat(angleStr);
      const currentDeg = spawned.result.root.rotation.y * 180 / Math.PI;
      angle = currentDeg + delta;
    } else {
      // Absolute rotation
      angle = parseFloat(angleStr);
    }

    if (isNaN(angle)) {
      return 'Invalid angle';
    }

    spawned.result.root.rotation.y = angle * Math.PI / 180;
    return `Rotated #${index} to ${angle.toFixed(1)} degrees`;
  }

  private moveModel(args: string[]): string {
    if (args.length < 4) {
      return 'Usage: spawnmodel move <index> <x> <y> <z>';
    }

    const index = parseInt(args[0]);
    const spawned = this.spawnedModels.find(s => s.spawnIndex === index);

    if (!spawned) {
      return `No spawned model at index ${index}`;
    }

    const pos = spawned.result.root.position;
    const xStr = args[1], yStr = args[2], zStr = args[3];

    const parseCoord = (str: string, current: number): number => {
      if (str.startsWith('+') || str.startsWith('-')) {
        return current + parseFloat(str);
      }
      return parseFloat(str);
    };

    const x = parseCoord(xStr, pos.x);
    const y = parseCoord(yStr, pos.y);
    const z = parseCoord(zStr, pos.z);

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return 'Invalid coordinates';
    }

    spawned.result.root.position.set(x, y, z);
    return `Moved #${index} to (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
  }

  private scaleModel(args: string[]): string {
    if (args.length < 2) {
      return 'Usage: spawnmodel scale <index> <scale>';
    }

    const index = parseInt(args[0]);
    const spawned = this.spawnedModels.find(s => s.spawnIndex === index);

    if (!spawned) {
      return `No spawned model at index ${index}`;
    }

    const scale = parseFloat(args[1]);
    if (isNaN(scale) || scale < 0.01 || scale > 1000) {
      return 'Scale must be a number between 0.01 and 1000';
    }

    spawned.result.root.scaling.setAll(scale);
    return `Scaled #${index} to ${scale}`;
  }

  private removeModel(args: string[]): string {
    if (args.length === 0) {
      return 'Usage: spawnmodel remove <index>';
    }

    const index = parseInt(args[0]);
    const spawnedIndex = this.spawnedModels.findIndex(s => s.spawnIndex === index);

    if (spawnedIndex === -1) {
      return `No spawned model at index ${index}`;
    }

    const spawned = this.spawnedModels[spawnedIndex];
    spawned.result.root.dispose();
    this.spawnedModels.splice(spawnedIndex, 1);

    return `Removed spawned model #${index}`;
  }

  // ============================================================================
  // Autocomplete
  // ============================================================================

  getCompletions(_input: string, args: string[]): string[] {
    const subcommands = ['list', 'clear', 'info', 'anim', 'rotate', 'move', 'scale', 'remove'];

    if (args.length === 0) {
      return subcommands;
    }

    const sub = args[0].toLowerCase();

    // For anim subcommand, suggest animation names
    if (sub === 'anim' && args.length === 3) {
      const index = parseInt(args[1]);
      const spawned = this.spawnedModels.find(s => s.spawnIndex === index);
      if (spawned) {
        return spawned.result.animationGroups.map(a => a.name);
      }
    }

    // For anim mode
    if (sub === 'anim' && args.length === 4) {
      return ['loop', 'once', 'stop'];
    }

    return [];
  }
}
