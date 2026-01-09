/**
 * BspCommand - BSP map loading and inspection
 * 
 * Provides console commands for:
 * - Loading BSP maps
 * - Inspecting BSP data (entities, textures, faces, etc.)
 * - Rendering BSP geometry
 * - Applying textures and lightmaps
 * - Sky and fog control
 */

import { Command, CommandDef } from '../Command';

export class BspCommand extends Command {
  readonly definition: CommandDef = {
    name: 'bsp',
    description: 'BSP map loading and inspection',
    usage: 'bsp <subcommand> [args]',
  };

  async execute(args: string[]): Promise<string> {
    const { BspManager } = await import('../../loader/bsp/BspManager');
    const manager = BspManager.getInstance();

    const subcommand = args[0]?.toLowerCase();

    // Get scene from camera system
    const { CameraSystem } = await import('../../camera/CameraSystem');
    const cameraSystem = CameraSystem.getInstance();
    const scene = cameraSystem.getCamera()?.getScene();

    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: bsp load <mapname>\nExample: bsp load wdm11';
        }

        try {
          const summary = await manager.load(mapName);
          return `Loaded: maps/${mapName}.bsp\n${summary}\n\nUse "bsp info" for details, "bsp render" to display`;
        } catch (e) {
          return `${e}`;
        }
      }

      case 'info':
        return manager.getInfo();

      case 'faces':
        return manager.getFaceStats();

      case 'entities': {
        const filter = args[1]?.toLowerCase();
        const showDetails = args[2] === 'details' || args[2] === 'd';
        return manager.getEntities(filter, showDetails);
      }

      case 'textures': {
        const filter = args[1]?.toLowerCase();
        return manager.getTextures(filter);
      }

      case 'worldspawn':
        return manager.getWorldspawn();

      case 'clusters':
        return manager.getClusterInfo();

      case 'lightmaps':
        return manager.getLightmapInfo();

      case 'required': {
        if (!manager.isLoaded()) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const { getBspUsedTextures } = await import('../../loader');
        const { PK3Index } = await import('../../loader');

        const bsp = manager.getBsp()!;
        const usedTextures = getBspUsedTextures(bsp);
        const index = PK3Index.getInstance();

        if (!index.hasIndex()) {
          return [
            `=== Used Textures (${usedTextures.length}) ===`,
            usedTextures.slice(0, 20).join('\n'),
            usedTextures.length > 20 ? `... and ${usedTextures.length - 20} more` : '',
            '',
            'Note: Run "pk3 index build" first to see which PK3s are needed.',
          ].filter(Boolean).join('\n');
        }

        // Find which PK3s are needed
        const requiredPK3s = index.findPK3sForTextures(usedTextures);
        const notFound: string[] = [];

        for (const tex of usedTextures) {
          const pk3 = index.findFile(`textures/${tex}.tga`) ||
            index.findFile(`textures/${tex}.jpg`) ||
            index.findFile(`textures/${tex}.ktx`) ||
            index.findFile(`${tex}.tga`) ||
            index.findFile(`${tex}.jpg`) ||
            index.findFile(`${tex}.ktx`);
          if (!pk3) {
            notFound.push(tex);
          }
        }

        const lines = [
          `=== BSP Required Resources ===`,
          `Used textures: ${usedTextures.length}`,
          `Required PK3s: ${requiredPK3s.size}`,
        ];

        if (requiredPK3s.size > 0) {
          lines.push('', 'PK3s to load:');
          for (const pk3 of requiredPK3s) {
            lines.push(`  ${pk3}`);
          }
        }

        if (notFound.length > 0) {
          lines.push('', `Not found in index: ${notFound.length}`);
          lines.push(...notFound.slice(0, 10).map(t => `  ${t}`));
          if (notFound.length > 10) {
            lines.push(`  ... and ${notFound.length - 10} more`);
          }
        }

        return lines.join('\n');
      }

      case 'loadrequired':
      case 'preload': {
        if (!manager.isLoaded()) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const { getBspUsedTextures: getTextures } = await import('../../loader');
        const { PK3Index, PK3Loader } = await import('../../loader');

        const bsp = manager.getBsp()!;
        const usedTextures = getTextures(bsp);
        const index = PK3Index.getInstance();

        if (!index.hasIndex()) {
          return 'No index built. Run "pk3 path game/basewsw/" then "pk3 index build" first.';
        }

        // Find which PK3s are needed
        const requiredPK3s = index.findPK3sForTextures(usedTextures);

        if (requiredPK3s.size === 0) {
          return 'No additional PK3s needed (or textures not found in index)';
        }

        // Check which are already loaded
        const pk3Loader = PK3Loader.getInstance();
        const loadedPackages = pk3Loader.getPackageInfo().map(p => p.filename);
        const toLoad = Array.from(requiredPK3s).filter(pk3 => !loadedPackages.includes(pk3));

        if (toLoad.length === 0) {
          return `All ${requiredPK3s.size} required PK3s already loaded`;
        }

        const lines = [`Loading ${toLoad.length} required PK3s...`];
        let loaded = 0;
        let failed = 0;

        for (const pk3 of toLoad) {
          try {
            const fullPath = index.getPK3Path(pk3);
            if (fullPath) {
              await pk3Loader.loadPK3FromUrl(fullPath);
            } else {
              await pk3Loader.loadPK3(pk3);
            }
            loaded++;
            lines.push(`  ✓ ${pk3}`);
          } catch (e) {
            failed++;
            const errMsg = e instanceof Error ? e.message : String(e);
            lines.push(`  ✗ ${pk3}: ${errMsg}`);
          }
        }

        lines.push('');
        lines.push(`Loaded: ${loaded}, Failed: ${failed}`);

        if (loaded > 0) {
          lines.push('');
          lines.push('Tip: Run "shader load" to load shaders from these PK3s');
        }

        return lines.join('\n');
      }

      case 'render': {
        if (!manager.isLoaded()) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        if (!scene) {
          return 'No scene available';
        }

        // Parse optional face type filter
        let faceTypes: number[] | undefined;
        if (args[1]) {
          const typeArg = args[1].toLowerCase();
          if (typeArg === 'poly' || typeArg === 'polygon') {
            faceTypes = [1];
          } else if (typeArg === 'patch') {
            faceTypes = [2];
          } else if (typeArg === 'mesh') {
            faceTypes = [3];
          } else if (typeArg === 'all') {
            faceTypes = undefined;
          } else {
            faceTypes = args.slice(1).map(Number).filter(n => n >= 1 && n <= 4);
            if (faceTypes.length === 0) faceTypes = undefined;
          }
        }

        try {
          const result = manager.render(scene, { faceTypes, filterTextures: true });

          // Initialize collision system
          let collisionInfo = '';
          try {
            const { getCollisionManager } = await import('../../physics');
            const cm = getCollisionManager();
            await cm.init(manager.getBsp()!, scene as never);
            const stats = cm.getStats();
            collisionInfo = `\nCollision: ${cm.getBackendType()} (${((stats?.backendStats as any)?.collisionPlanes ?? 0)} planes)`;
          } catch (e) {
            console.warn('[bsp render] Failed to init collision:', e);
          }

          return result + collisionInfo;
        } catch (e) {
          return `${e}`;
        }
      }

      case 'clear': {
        if (manager.isRendered()) {
          manager.clearRender();
          return 'BSP geometry cleared';
        }
        return 'No BSP geometry to clear';
      }

      case 'applytextures':
      case 'loadtextures': {
        if (!manager.isRendered()) {
          return 'No BSP rendered. Use "bsp load <map>" then "bsp render" first.';
        }

        if (!scene) {
          return 'Scene not available';
        }

        try {
          const count = await manager.applyTextures(scene, (loaded, total, name) => {
            console.log(`[BSP] Loading texture ${loaded}/${total}: ${name}`);
          });
          return `Applied ${count} textures to BSP`;
        } catch (e) {
          return `Failed to apply textures: ${e}`;
        }
      }

      case 'applylightmaps':
      case 'lightmap': {
        if (!manager.isRendered()) {
          return 'No BSP rendered. Use "bsp render" first.';
        }

        const mode = args[1]?.toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
        const intensityArg = args[mode === 'mobile' ? 2 : 1];
        const intensity = intensityArg ? parseFloat(intensityArg) : 1.5;

        try {
          const count = manager.applyLightmaps(mode, isNaN(intensity) ? 1.5 : intensity);
          return `Applied ${count} lightmaps (mode: ${mode}, intensity: ${intensity.toFixed(1)})`;
        } catch (e) {
          return `Failed to apply lightmaps: ${e}`;
        }
      }

      case 'sky': {
        const skySubcommand = args[1]?.toLowerCase();

        if (!skySubcommand || skySubcommand === 'info') {
          return manager.getSkyInfo();
        }

        if (skySubcommand === 'apply') {
          if (!manager.isRendered() || !scene) {
            return 'No BSP rendered. Use "bsp render" first.';
          }

          const result = await manager.applySkybox(scene);
          return result.success ? 'Skybox created successfully.' : `Failed to create skybox: ${result.error}`;
        }

        if (skySubcommand === 'toggle') {
          if (!scene) {
            return 'No scene available.';
          }

          const skybox = scene.getMeshByName('skybox');
          if (!skybox) {
            return 'No skybox found. Use "bsp sky apply" first.';
          }

          skybox.isVisible = !skybox.isVisible;
          return `Skybox visibility: ${skybox.isVisible ? 'ON' : 'OFF'}`;
        }

        if (skySubcommand === 'remove') {
          if (!scene) {
            return 'No scene available.';
          }

          const skybox = scene.getMeshByName('skybox');
          if (!skybox) {
            return 'No skybox found.';
          }

          skybox.dispose();
          return 'Skybox removed.';
        }

        if (skySubcommand === 'debug') {
          if (!scene) {
            return 'No scene available.';
          }

          const existingSkybox = scene.getMeshByName('skybox');
          if (existingSkybox) {
            existingSkybox.dispose();
          }

          const { SkyboxLoader } = await import('../../loader');
          const skyboxLoader = SkyboxLoader.getInstance();
          skyboxLoader.init(scene);
          const result = skyboxLoader.createDebugSkybox();

          if (result.success) {
            return [
              'Debug skybox created with colored/labeled faces.',
              'Look around to verify face positions:',
              '  RT (red) = RIGHT (+X)',
              '  LF (blue) = LEFT (-X)',
              '  FT (yellow) = FRONT (+Z in Babylon)',
              '  BK (green) = BACK (-Z in Babylon)',
              '  UP (magenta) = UP (+Y in Babylon)',
              '  DN (cyan) = DOWN (-Y in Babylon)',
            ].join('\n');
          } else {
            return `Failed to create debug skybox: ${result.error}`;
          }
        }

        return 'Sky subcommands: info, apply, toggle, remove, debug';
      }

      case 'fog': {
        const fogSubcommand = args[1]?.toLowerCase();

        if (!fogSubcommand || fogSubcommand === 'info') {
          return manager.getFogInfo();
        }

        if (fogSubcommand === 'apply') {
          if (!manager.isRendered() || !scene) {
            return 'No BSP rendered. Use "bsp render" first.';
          }

          const result = await manager.applyFogVolumes(scene);
          return result.success
            ? `Created ${result.count} fog volume mesh(es).`
            : `No fog volumes created: ${result.error || 'No fog volumes found in BSP'}`;
        }

        if (fogSubcommand === 'clear') {
          manager.clearFogVolumes();
          return 'Fog volumes cleared.';
        }

        return 'Fog subcommands: info, apply, clear';
      }

      case 'door': {
        const { getDoorController, getDoorNames } = await import('../../loader/bsp/BspEntityHandlers');
        const doorSubcmd = args[1]?.toLowerCase();
        const doorName = args[2];

        if (doorSubcmd === 'list') {
          const names = getDoorNames();
          if (names.length === 0) {
            return 'No doors registered. Load a BSP map with func_door entities.';
          }
          return `Doors (${names.length}):\n  ${names.join('\n  ')}`;
        }

        if (doorSubcmd === 'open' && doorName) {
          const controller = getDoorController(doorName);
          if (!controller) return `Door "${doorName}" not found`;
          controller.open();
          return `Opening door: ${doorName}`;
        }

        if (doorSubcmd === 'close' && doorName) {
          const controller = getDoorController(doorName);
          if (!controller) return `Door "${doorName}" not found`;
          controller.close();
          return `Closing door: ${doorName}`;
        }

        if (doorSubcmd === 'toggle' && doorName) {
          const controller = getDoorController(doorName);
          if (!controller) return `Door "${doorName}" not found`;
          controller.toggle();
          return `Toggling door: ${doorName}`;
        }

        return [
          'Door Commands:',
          '  bsp door list              - List all doors',
          '  bsp door open <name>       - Open a door',
          '  bsp door close <name>      - Close a door',
          '  bsp door toggle <name>     - Toggle a door',
        ].join('\n');
      }

      case 'collision':
      case 'trace': {
        if (!manager.isLoaded()) {
          return 'No BSP loaded';
        }

        const bsp = manager.getBsp()!;
        const { BspCollision } = await import('../../physics');
        const collision = new BspCollision(bsp);

        const traceSubcmd = args[1]?.toLowerCase();

        if (traceSubcmd === 'point') {
          if (!scene?.activeCamera) return 'No active camera';
          const cam = scene.activeCamera;
          const pos = cam.position;

          const contents = collision.pointContents(pos);
          const inSolid = (contents & 0x1) !== 0;
          const inWater = (contents & 0x20) !== 0;
          const inPlayerClip = (contents & 0x10000) !== 0;

          return [
            `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
            `Contents: 0x${contents.toString(16)}`,
            `  Solid: ${inSolid}`,
            `  Water: ${inWater}`,
            `  PlayerClip: ${inPlayerClip}`,
          ].join('\n');
        }

        return 'Collision subcommands: point';
      }

      case 'unload':
        manager.unload();
        return 'BSP unloaded';

      default:
        return [
          'BSP Commands:',
          '  load <map>      - Load BSP map',
          '  info            - Show BSP info',
          '  faces           - Show face type counts',
          '  entities [filter] [details] - List entities',
          '  textures [filter] - List textures',
          '  worldspawn      - Show worldspawn properties',
          '  clusters        - Show PVS cluster info',
          '  lightmaps       - Show lightmap info',
          '  required        - Show required PK3s',
          '  loadrequired    - Load required PK3s',
          '  render [type]   - Render BSP geometry',
          '  clear           - Clear rendered geometry',
          '  applytextures   - Apply textures',
          '  applylightmaps  - Apply lightmaps',
          '  sky <cmd>       - Sky commands (info/apply/toggle/remove/debug)',
          '  fog <cmd>       - Fog commands (info/apply/clear)',
          '  door <cmd>      - Door commands (list/open/close/toggle)',
          '  collision <cmd> - Collision commands (point)',
          '  unload          - Unload BSP',
        ].join('\n');
    }
  }
}

export default BspCommand;
