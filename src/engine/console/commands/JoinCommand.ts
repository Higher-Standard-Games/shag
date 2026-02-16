/**
 * JoinCommand - Quick join game from spectator mode
 * 
 * Spawns at random spawnpoint and enables FPS mode.
 * Does NOT require developer mode.
 */

import { Command, CommandDef } from '../Command';

export default class JoinCommand extends Command {
  readonly definition: CommandDef = {
    name: 'join',
    description: 'Join game - spawn at random spawnpoint and enter FPS mode',
    usage: 'join',
    developer: false,  // Available to everyone!
  };

  async execute(_args: string[]): Promise<string | void> {
    // Check if we're in network mode
    let isNetworkMode = false;
    try {
      const { FPSGameManager } = await import('../../../games/fps/FPSGameManager');
      const gameManager = FPSGameManager.getInstance();
      isNetworkMode = gameManager.isConnectedToServer();
    } catch {
      // Not in network mode
    }

    // Get required systems
    let cameraSystem;
    let mapLoader;
    let FPSController;
    let FreeflyController;

    try {
      const cameraModule = await import('../../camera/CameraSystem');
      const mapModule = await import('../../loader/map/MapLoader');
      const fpsModule = await import('../../camera/controllers/FPSController');
      const freeflyModule = await import('../../camera/controllers/FreeflyController');

      cameraSystem = cameraModule.CameraSystem.getInstance();
      mapLoader = mapModule.MapLoader.getInstance();
      FPSController = fpsModule.FPSController;
      FreeflyController = freeflyModule.FreeflyController;
    } catch {
      return 'Required systems not available';
    }

    const camera = cameraSystem.getCamera();
    if (!camera) {
      return 'No active camera';
    }

    // In network mode, skip local position setting - server is authoritative
    // Just make sure FPS controller is active
    if (!isNetworkMode) {
      const bsp = mapLoader.getCurrentBsp();
      if (!bsp) {
        return 'No map loaded - use "map <mapname>" first';
      }

      // Find spawn points
      const spawns = bsp.entities.filter((e: { classname: string }) =>
        e.classname === 'info_player_deathmatch' ||
        e.classname === 'info_player_start' ||
        e.classname === 'info_player_team1' ||
        e.classname === 'info_player_team2'
      );

      if (spawns.length === 0) {
        return 'No spawn points found in map';
      }

      // Pick random spawn point
      const randomIndex = Math.floor(Math.random() * spawns.length);
      const spawn = spawns[randomIndex];

      if (!spawn.properties?.origin) {
        return 'Spawn point has no origin';
      }

      // Parse origin and teleport
      const parts = spawn.properties.origin.split(' ').map(Number);
      // Quake coords: origin is x, y, z but Y is up in Babylon
      // Add player eye height (48 units) to spawn above ground
      const spawnX = parts[0];
      const spawnY = parts[2] + 48;  // Eye level
      const spawnZ = parts[1];

      camera.position.set(spawnX, spawnY, spawnZ);
    }

    // Register controllers if needed
    if (!cameraSystem.getController('fps')) {
      cameraSystem.registerController('fps', new FPSController());
    }
    if (!cameraSystem.getController('freefly')) {
      cameraSystem.registerController('freefly', new FreeflyController());
    }

    // Switch to FPS mode (spectator 0)
    cameraSystem.setController('fps');

    // Initialize weapon view manager
    try {
      const weaponModule = await import('../../weapon/WeaponViewManager');
      const projectileModule = await import('../../weapon/ProjectileManager');
      const entityModule = await import('../../../shared/entities');
      const { FreeCamera } = await import('@babylonjs/core/Cameras/freeCamera');
      const scene = camera.getScene();
      if (scene && camera instanceof FreeCamera) {
        // Initialize entity definitions (registers all weapon defs etc)
        entityModule.initializeEntityDefs();

        const wvm = weaponModule.getWeaponViewManager();
        wvm.init(scene, camera);

        // Load weapon by ID (looks up in entity registry)
        wvm.loadWeapon('plasmagun', 'data/data0_21pure.pk3')
          .then(async success => {
            if (success) {
              console.log('[Join] Weapon loaded from entity registry');
              // Preload all projectile models for instant spawning
              const projMgr = projectileModule.getProjectileManager();
              await Promise.all([
                projMgr.preloadModel('plasma_bolt'),
                projMgr.preloadModel('grenade'),
                projMgr.preloadModel('rocket'),
                projMgr.preloadModel('gunblade_blast'),
              ]);
            }
          });
      }
    } catch (e) {
      console.warn('[Join] Failed to init weapon view:', e);
    }

    if (isNetworkMode) {
      return 'Joined game (network mode) - click to capture mouse, WASD to move. Position from server.';
    }
    return `Joined at spawn - click to capture mouse, WASD to move`;
  }
}
