/**
 * ShaderCommand - Q3/Warsow shader management and debugging
 * 
 * Wraps Q3ShaderRegistry for shader loading, inspection, and debugging.
 */

import { Command, CommandDef } from '../Command';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

// Aim debug state
let aimObserver: any = null;
let aimLastMesh: AbstractMesh | null = null;

export class ShaderCommand extends Command {
  readonly definition: CommandDef = {
    name: 'shader',
    description: 'Q3/Warsow shader management',
    usage: 'shader <subcommand> [args]',
  };

  async execute(args: string[]): Promise<string> {
    const { Q3ShaderRegistry } = await import('../../loader');
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'load': {
        const count = await shaderRegistry.loadShaders();
        return `Loaded ${count} shaders from PK3`;
      }

      case 'count':
        return `Shaders loaded: ${shaderRegistry.getShaderCount()}`;

      case 'list': {
        const filter = args[1]?.toLowerCase();
        let names = shaderRegistry.getShaderNames();

        if (filter) {
          names = names.filter(n => n.includes(filter));
        }

        if (names.length === 0) {
          return filter ? `No shaders matching "${filter}"` : 'No shaders loaded (use "shader load")';
        }

        const display = names.slice(0, 30);
        return display.length < names.length
          ? `${display.join('\n')}\n... and ${names.length - display.length} more`
          : display.join('\n');
      }

      case 'info': {
        const textureName = args[1];
        
        if (!textureName) {
          // Inspect aimed mesh
          const { CameraSystem } = await import('../../camera/CameraSystem');
          const cameraSystem = CameraSystem.getInstance();
          const camera = cameraSystem.getCamera();
          const scene = camera?.getScene();
          
          if (!scene || !camera) return 'No scene/camera available';
          
          const mesh = this.getAimedMesh(scene, camera);
          if (!mesh) return 'No mesh hit under crosshair';
          
          return this.buildMeshShaderInfo(mesh);
        }

        shaderRegistry.debugShader(textureName);
        const shader = shaderRegistry.getShader(textureName);
        if (!shader) {
          return `No shader defined for: ${textureName}`;
        }

        const lines = [
          `Shader: ${shader.name}`,
          `Cull: ${shader.cull}`,
          `Surface parms: ${Array.from(shader.surfaceParms).join(', ') || 'none'}`,
          `Stages: ${shader.stages.length}`,
        ];

        shader.stages.forEach((stage, i) => {
          lines.push(`  Stage ${i}: map=${stage.map}`);
          if (stage.blendFunc) {
            lines.push(`    blendFunc: ${stage.blendFunc.join(', ')}`);
          }
          if (stage.alphaFunc) {
            lines.push(`    alphaFunc: ${stage.alphaFunc}`);
          }
        });

        return lines.join('\n');
      }

      case 'aim': {
        const { CameraSystem } = await import('../../camera/CameraSystem');
        const cameraSystem = CameraSystem.getInstance();
        const camera = cameraSystem.getCamera();
        const scene = camera?.getScene();
        
        if (!scene || !camera) return 'No scene/camera available';

        const value = args[1]?.toLowerCase();
        if (value === undefined) {
          return `shader aim = ${(window as any)._shaderAimEnabled ? '1' : '0'}`;
        }

        const enable = value === '1' || value === 'true' || value === 'on';
        (window as any)._shaderAimEnabled = enable;

        if (!enable) {
          this.disableAimHighlight(scene);
          return 'Shader aim highlight: OFF';
        }

        this.enableAimHighlight(scene, camera);
        return 'Shader aim highlight: ON';
      }

      case 'resolve': {
        const textureName = args[1];
        if (!textureName) {
          return 'Usage: shader resolve <texture_path>';
        }

        const props = shaderRegistry.resolveMaterialProps(textureName);
        return [
          `Resolved material for: ${textureName}`,
          `  alphaMode: ${props.alphaMode}`,
          `  backFaceCulling: ${props.backFaceCulling}`,
          `  depthWrite: ${props.depthWrite}`,
          `  isTransparent: ${props.isTransparent}`,
          `  useLightmap: ${props.useLightmap}`,
          `  polygonOffset: ${props.polygonOffset}`,
          props.alphaCutoff !== undefined ? `  alphaCutoff: ${props.alphaCutoff}` : '',
          props.diffuseTexture ? `  diffuseTexture: ${props.diffuseTexture}` : '',
        ].filter(Boolean).join('\n');
      }

      case 'pattern': {
        const textureName = args[1];
        if (!textureName) {
          return 'Usage: shader pattern <texture_path>';
        }

        const shader = shaderRegistry.getShader(textureName);
        if (!shader) {
          return `No shader defined for: ${textureName}`;
        }

        const { debugShaderPattern } = await import('../../loader/shader/Q3ShaderMaterialFactory');
        return debugShaderPattern(shader);
      }

      case 'deps': {
        const textureName = args[1];
        if (!textureName) {
          return 'Usage: shader deps <texture_path>\nShows which PK3s contain the shader and its textures.';
        }

        const { PK3Index, PK3Loader } = await import('../../loader');
        const pk3Index = PK3Index.getInstance();
        const pk3Loader = PK3Loader.getInstance();

        const lines: string[] = [`Dependency check for: ${textureName}`];

        const shaderPk3 = pk3Index.findShader(textureName);
        lines.push(`\nShader definition: ${shaderPk3 || 'NOT INDEXED'}`);

        const shader = shaderRegistry.getShader(textureName);
        lines.push(`Shader loaded: ${shader ? 'YES' : 'NO'}`);

        if (shader) {
          lines.push(`\nStages (${shader.stages.length}):`);
          for (let i = 0; i < shader.stages.length; i++) {
            const stage = shader.stages[i];
            if (stage.map && !stage.map.startsWith('$')) {
              const texPk3 = pk3Index.findFile(stage.map) ||
                pk3Index.findFile(`${stage.map}.tga`) ||
                pk3Index.findFile(`${stage.map}.jpg`);
              const loaded = pk3Loader.hasFile(stage.map) ||
                pk3Loader.hasFile(`${stage.map}.tga`) ||
                pk3Loader.hasFile(`${stage.map}.jpg`);
              lines.push(`  [${i}] ${stage.map}`);
              lines.push(`      PK3: ${texPk3 || 'NOT INDEXED'}`);
              lines.push(`      Loaded: ${loaded ? 'YES' : 'NO'}`);
              if (stage.blendFunc) {
                lines.push(`      Blend: ${stage.blendFunc.join(' ')}`);
              }
            } else if (stage.map) {
              lines.push(`  [${i}] ${stage.map} (special)`);
            }
          }

          if (shader.surfaceParms.size > 0) {
            lines.push(`\nSurfaceParms: ${Array.from(shader.surfaceParms).join(', ')}`);
          }
        }

        return lines.join('\n');
      }

      default:
        return [
          'Shader Commands:',
          '  shader load              - Load shaders from PK3',
          '  shader count             - Show loaded shader count',
          '  shader list [filter]     - List shaders',
          '  shader info [name]       - Show shader info (or aimed surface)',
          '  shader aim <0|1>         - Toggle aim highlight',
          '  shader resolve <name>    - Resolve material properties',
          '  shader pattern <name>    - Debug shader pattern',
          '  shader deps <name>       - Show shader dependencies',
        ].join('\n');
    }
  }

  private getAimedMesh(scene: Scene, camera: any): AbstractMesh | null {
    const { Ray } = require('@babylonjs/core/Culling/ray');
    const { Vector3 } = require('@babylonjs/core/Maths/math.vector');
    
    const ray = camera?.getForwardRay 
      ? camera.getForwardRay(10000) 
      : new Ray(camera.position, camera.getDirection(new Vector3(0, 0, 1)), 10000);
    
    const pick = scene.pickWithRay(ray, (m: AbstractMesh) => {
      if (!m) return false;
      if (m.isPickable === false) return false;
      if ((m as any).metadata?.isLightGizmo) return false;
      if (m.name?.startsWith('collision_')) return false;
      if (m.name?.startsWith('clipbrush_')) return false;
      return true;
    });
    
    return pick?.hit ? (pick.pickedMesh as AbstractMesh | null) : null;
  }

  private buildMeshShaderInfo(mesh: AbstractMesh): string {
    const mat = mesh.material as any;
    const lines = [
      `=== Aimed Surface ===`,
      `Mesh: ${mesh.name}`,
      `Material: ${mat?.name || '(none)'}`,
    ];

    if (mat) {
      if (mat.diffuseTexture?.name) {
        lines.push(`Diffuse: ${mat.diffuseTexture.name}`);
      }
      if (mat.bumpTexture?.name) {
        lines.push(`Normal: ${mat.bumpTexture.name}`);
      }
      if (mat.specularTexture?.name) {
        lines.push(`Specular: ${mat.specularTexture.name}`);
      }
      lines.push(`Alpha mode: ${mat.alphaMode ?? 'default'}`);
      lines.push(`Back-face culling: ${mat.backFaceCulling ?? true}`);
    }

    return lines.join('\n');
  }

  private enableAimHighlight(scene: Scene, camera: any): void {
    const { Color4 } = require('@babylonjs/core/Maths/math.color');
    
    if (!aimObserver) {
      aimObserver = scene.onBeforeRenderObservable.add(() => {
        try {
          if (!(window as any)._shaderAimEnabled) return;
          
          const mesh = this.getAimedMesh(scene, camera);
          if (mesh === aimLastMesh) return;
          
          if (aimLastMesh) {
            try { aimLastMesh.disableEdgesRendering(); } catch { /* ignore */ }
          }
          
          aimLastMesh = mesh;
          
          if (mesh) {
            try {
              mesh.enableEdgesRendering();
              (mesh as any).edgesWidth = 6;
              (mesh as any).edgesColor = new Color4(1, 1, 1, 1);
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      });
    }
  }

  private disableAimHighlight(scene: Scene): void {
    if (aimObserver) {
      scene.onBeforeRenderObservable.remove(aimObserver);
      aimObserver = null;
    }
    if (aimLastMesh) {
      try { aimLastMesh.disableEdgesRendering(); } catch { /* ignore */ }
      aimLastMesh = null;
    }
  }
}

export default ShaderCommand;
