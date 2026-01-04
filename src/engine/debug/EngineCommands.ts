/**
 * EngineCommands - Register engine-level debug commands
 *
 * Connects console commands to actual engine systems.
 *
 * NOTE: Uses lazy imports for DOM-dependent modules to support headless mode.
 * Commands that require DOM will return "Not available in headless mode" when
 * running without a browser environment.
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
import { Vector3 } from 'babylonjs';
import {
  PK3Loader,
  parseKTX1,
  PK3TextureLoader,
  BspLoader,
  type BspFile,
  BspMeshBuilder,
  type BspMeshBuildResult
} from '../loader';
import { Mesh, StandardMaterial, Color3, Scene, Engine, FreeCamera, HemisphericLight, Color4 } from 'babylonjs';

// Camera controllers (used directly, not as singletons)
import { IsometricController } from '../camera/controllers/IsometricController';
import { FPSController } from '../camera/controllers/FPSController';
import { SideScrollController } from '../camera/controllers/SideScrollController';
import { FollowController } from '../camera/controllers/FollowController';
import { FreeflyController } from '../camera/controllers/FreeflyController';

// Other direct imports
import { GamePaths } from '../core/GamePaths';
import { HUD, HUDManager } from '../ui/hud/HUDManager';

// ============================================================================
// Lazy imports for DOM-dependent modules (enables headless mode)
// ============================================================================

// Cache for lazy-loaded singletons
let _audioManager: typeof import('../AudioManager').AudioManager | null = null;
let _cameraSystem: typeof import('../camera/CameraSystem').CameraSystem | null = null;
let _debugConsole: typeof import('./DebugConsole').DebugConsole | null = null;
let _gameClock: typeof import('../../game/GameClock').GameClock | null = null;
let _uiScale: typeof import('../ui/UIScale').UIScale | null = null;
let _hud: typeof import('../ui/hud/HUDManager').HUDManager | null = null;
let _menuSystem: typeof import('../MenuSystem').MenuSystem | null = null;

async function getAudioManager() {
  if (!_audioManager) {
    const mod = await import('../AudioManager');
    _audioManager = mod.AudioManager;
  }
  return _audioManager.getInstance();
}

async function getCameraSystem() {
  if (!_cameraSystem) {
    const mod = await import('../camera/CameraSystem');
    _cameraSystem = mod.CameraSystem;
  }
  return _cameraSystem.getInstance();
}

async function getDebugConsole() {
  if (!_debugConsole) {
    const mod = await import('./DebugConsole');
    _debugConsole = mod.DebugConsole;
  }
  return _debugConsole.getInstance();
}

async function getGameClock() {
  if (!_gameClock) {
    const mod = await import('../../game/GameClock');
    _gameClock = mod.GameClock;
  }
  return _gameClock.getInstance();
}

async function getUIScale() {
  if (!_uiScale) {
    const mod = await import('../ui/UIScale');
    _uiScale = mod.UIScale;
  }
  return _uiScale.getInstance();
}

async function getHUD() {
  if (!_hud) {
    const mod = await import('../ui/hud/HUDManager');
    _hud = mod.HUDManager;
  }
  return _hud.getInstance();
}

async function getMenuSystem() {
  if (!_menuSystem) {
    const mod = await import('../MenuSystem');
    _menuSystem = mod.MenuSystem;
  }
  return _menuSystem.getInstance();
}

// Helper to get scene from camera system (returns null in headless)
async function getScene(): Promise<Scene | null> {
  try {
    const cameraSystem = await getCameraSystem();
    return cameraSystem.getCamera()?.getScene() || null;
  } catch {
    return null;
  }
}

// Helper for commands that require DOM
function notAvailableInHeadless(): string {
  return '[Headless] This command requires a browser environment';
}

export function registerEngineCommands(): void {
  const registry = ConsoleCommandRegistry.getInstance();

  // ============================================================================
  // Audio Commands
  // ============================================================================

  registry.register('audio', async (args) => {
    try {
      const audio = await getAudioManager();
      const subcommand = args[0]?.toLowerCase();

      switch (subcommand) {
        case 'volume': {
          const vol = parseFloat(args[1]);
          if (isNaN(vol) || vol < 0 || vol > 1) {
            return 'Usage: audio volume <0-1>';
          }
          audio.setMusicVolume(vol);
          return `Music volume set to ${vol}`;
        }

        case 'mute':
          audio.setMusicEnabled(false);
          return 'Audio muted';

        case 'unmute':
          audio.setMusicEnabled(true);
          return 'Audio unmuted';

        case 'play': {
          const track = args[1];
          if (!track) {
            return 'Usage: audio play <trackname>';
          }
          audio.playMusic(track);
          return `Playing: ${track}`;
        }

        case 'stop':
          audio.stopMusic();
          return 'Music stopped';

        default:
          return 'Subcommands: volume, mute, unmute, play, stop';
      }
    } catch {
      return notAvailableInHeadless();
    }
  });

  // ============================================================================
  // Time Commands
  // ============================================================================

  registry.register('time', async (args) => {
    const clock = await getGameClock();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'set': {
        const hour = parseFloat(args[1]);
        if (isNaN(hour) || hour < 0 || hour > 24) {
          return 'Usage: time set <0-24>';
        }
        clock.setTime(hour);
        return `Time set to ${hour}:00`;
      }

      case 'speed':
        return 'Time speed not yet implemented';

      case 'pause':
        clock.pause();
        return 'Time paused';

      case 'resume':
        clock.resume();
        return 'Time resumed';

      default:
        return `Current time: ${clock.formatTime()}, Day ${clock.getCurrentDay()}`;
    }
  });

  // ============================================================================
  // FPS Display Command (show_fps 0/1)
  // ============================================================================

  registry.register('show_fps', async (args) => {
    const cameraSystem = await getCameraSystem();
    const scene = cameraSystem.getCamera()?.getScene();

    if (!scene) return 'No scene available';

    const engine = scene.getEngine();
    const value = args[0];

    // Parse argument: 0 = off, 1 = on, no arg = show current state
    if (value === undefined) {
      const isOn = !!(window as any)._showFpsElement;
      return `show_fps is ${isOn ? '1 (on)' : '0 (off)'}`;
    }

    const shouldShow = value === '1' || value.toLowerCase() === 'on' || value.toLowerCase() === 'true';
    const shouldHide = value === '0' || value.toLowerCase() === 'off' || value.toLowerCase() === 'false';

    if (!shouldShow && !shouldHide) {
      return 'Usage: show_fps <0|1>';
    }

    // Remove existing element if present
    if ((window as any)._showFpsElement) {
      document.body.removeChild((window as any)._showFpsElement);
      (window as any)._showFpsElement = null;
      (window as any)._showFpsAnimFrame = null;
    }

    if (shouldHide) {
      return 'FPS display: OFF';
    }

    // Create FPS display element (top-left corner)
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.75);
      color: #00ff00;
      padding: 8px 12px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      z-index: 9999;
      border-radius: 4px;
      min-width: 120px;
      line-height: 1.4;
      pointer-events: none;
    `.replace(/\s+/g, ' ').trim();

    document.body.appendChild(div);
    (window as any)._showFpsElement = div;

    // Track frame times for more detailed metrics
    let frameCount = 0;
    let lastTime = performance.now();
    let minFps = Infinity;
    let maxFps = 0;

    const update = () => {
      if (!(window as any)._showFpsElement) return;

      const now = performance.now();
      const deltaTime = now - lastTime;
      frameCount++;

      // Update display every 500ms for stability
      if (deltaTime >= 500) {
        const fps = engine.getFps();

        minFps = Math.min(minFps, fps);
        maxFps = Math.max(maxFps, fps);

        // Reset min/max every 5 seconds
        if (deltaTime >= 5000) {
          minFps = fps;
          maxFps = fps;
        }

        const drawCalls = engine._drawCalls?.current ?? 0;
        const triangles = scene.getActiveIndices() / 3;
        const meshes = scene.getActiveMeshes().length;

        div.innerHTML = `
          <div style="color:#0f0;font-weight:bold;">FPS: ${fps.toFixed(0)}</div>
          <div style="color:#888;font-size:10px;">min: ${minFps.toFixed(0)} / max: ${maxFps.toFixed(0)}</div>
          <div style="color:#aaa;font-size:10px;margin-top:4px;">
            Draw calls: ${drawCalls}<br>
            Triangles: ${(triangles / 1000).toFixed(1)}K<br>
            Meshes: ${meshes}
          </div>
        `.trim();

        frameCount = 0;
        lastTime = now;
      }

      (window as any)._showFpsAnimFrame = requestAnimationFrame(update);
    };

    update();
    return 'FPS display: ON';
  });

  // ============================================================================
  // Freefly Speed Command
  // ============================================================================

  registry.register('freefly_speed', async (args) => {
    const value = args[0];

    // No argument - show current speed
    if (value === undefined) {
      const currentSpeed = FreeflyController.getDefaultSpeed();
      return `freefly_speed = ${currentSpeed}`;
    }

    // Parse speed value
    const speed = parseFloat(value);
    if (isNaN(speed) || speed <= 0) {
      return 'Usage: freefly_speed <speed>\nExample: freefly_speed 500';
    }

    // Set the default speed
    FreeflyController.setDefaultSpeed(speed);

    // Also update current controller if it's freefly
    const cameraSystem = await getCameraSystem();
    const controller = cameraSystem.getActiveController();
    if (controller?.type === 'freefly') {
      controller.configure({ speed });
    }

    return `freefly_speed = ${speed}`;
  });

  // ============================================================================
  // Freefly Collision Command
  // ============================================================================

  registry.register('freefly_collision', async (args) => {
    const value = args[0]?.toLowerCase();

    // Show collision backend info
    const { getCollisionManager } = await import('../physics');
    const cm = getCollisionManager();
    const isInit = cm.isInitialized();
    const stats = isInit ? cm.getStats() : null;
    const planeCount = (stats?.backendStats as any)?.collisionPlanes || 0;

    // No argument - show current state
    if (value === undefined) {
      const enabled = FreeflyController.isCollisionEnabled();
      const status = isInit 
        ? `Backend: ${cm.getBackendType()} (${planeCount} planes)` 
        : 'WARNING: Collision not initialized (load a map first)';
      return `freefly_collision = ${enabled ? '1' : '0'}\n${status}`;
    }

    // Parse value
    const enabled = value === '1' || value === 'true' || value === 'on';
    FreeflyController.setCollisionEnabled(enabled);

    const backendInfo = isInit 
      ? `Backend: ${cm.getBackendType()} (${planeCount} planes)` 
      : 'WARNING: Collision not initialized (load a map first)';

    return `freefly_collision = ${enabled ? '1' : '0'}\n${backendInfo}`;
  });

  // ============================================================================
  // Debug Commands
  // ============================================================================

  registry.register('debug', async (args) => {
    const subcommand = args[0]?.toLowerCase();

    const cameraSystem = await getCameraSystem();
    const scene = cameraSystem.getCamera()?.getScene();

    switch (subcommand) {
      case 'fps': {
        if (!scene) return 'No scene available';
        const engine = scene.getEngine();
        // Toggle FPS display using engine's built-in performance monitor
        if ((window as any)._fpsElement) {
          document.body.removeChild((window as any)._fpsElement);
          (window as any)._fpsElement = null;
          return 'FPS display hidden';
        } else {
          const div = document.createElement('div');
          div.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);color:#0f0;padding:8px 12px;font-family:monospace;font-size:14px;z-index:9999;border-radius:4px;';
          document.body.appendChild(div);
          (window as any)._fpsElement = div;
          const update = () => {
            if ((window as any)._fpsElement) {
              div.textContent = `FPS: ${engine.getFps().toFixed(0)}`;
              requestAnimationFrame(update);
            }
          };
          update();
          return 'FPS display shown';
        }
      }

      case 'wireframe': {
        if (!scene) return 'No scene available';
        // Toggle wireframe on all materials
        let wireframeState = !(window as any)._wireframeMode;
        (window as any)._wireframeMode = wireframeState;

        for (const material of scene.materials) {
          if (material && 'wireframe' in material) {
            (material as any).wireframe = wireframeState;
          }
        }
        return `Wireframe mode: ${wireframeState ? 'ON' : 'OFF'}`;
      }

      case 'bounds': {
        if (!scene) return 'No scene available';
        let showBounds = !(window as any)._showBounds;
        (window as any)._showBounds = showBounds;

        for (const mesh of scene.meshes) {
          mesh.showBoundingBox = showBounds;
        }
        return `Bounding boxes: ${showBounds ? 'ON' : 'OFF'}`;
      }

      case 'lights': {
        if (!scene) return 'No scene available';
        let showLights = !(window as any)._showLights;
        (window as any)._showLights = showLights;

        // Create/toggle light gizmos
        if (showLights) {
          let count = 0;
          for (const light of scene.lights) {
            if ('position' in light) {
              const sphere = Mesh.CreateSphere(`lightGizmo_${count}`, 8, 10, scene);
              sphere.position = (light as any).position.clone();
              const mat = new StandardMaterial(`lightGizmoMat_${count}`, scene);
              mat.emissiveColor = new Color3(1, 1, 0);
              mat.disableLighting = true;
              sphere.material = mat;
              sphere.metadata = { isLightGizmo: true };
              count++;
            }
          }
          return `Light gizmos: ON (${count} lights)`;
        } else {
          // Remove light gizmos
          const toRemove = scene.meshes.filter(m => m.metadata?.isLightGizmo);
          for (const mesh of toRemove) {
            mesh.dispose();
          }
          return 'Light gizmos: OFF';
        }
      }

      default:
        return 'Subcommands: fps, wireframe, bounds, lights';
    }
  });

  // ============================================================================
  // Weather Commands
  // ============================================================================

  registry.register('weather', async (args) => {
    // Weather API is exposed on window.weather by GameScene
    const weather = (window as any).weather;

    if (!weather) {
      return 'Weather system not available (game not started)';
    }

    const subcommand = args[0]?.toLowerCase();
    const intensity = parseFloat(args[1]) || 0.5;

    switch (subcommand) {
      case 'rain':
        weather.rain(true);
        if (args[1]) weather.rainIntensity(intensity);
        return `Rain started (intensity: ${intensity})`;

      case 'snow':
        weather.snow(true);
        if (args[1]) weather.snowIntensity(intensity);
        return `Snow started (intensity: ${intensity})`;

      case 'clear':
        weather.rain(false);
        weather.snow(false);
        weather.fog(false);
        return 'Weather cleared';

      case 'fog': {
        const density = parseFloat(args[1]) || 0.02;
        weather.fog(true);
        weather.fogDensity(density);
        return `Fog set (density: ${density})`;
      }

      case 'thunder':
        weather.thunder();
        return 'Thunder triggered';

      case 'status': {
        const raining = weather.isRaining?.();
        const snowing = weather.isSnowing?.();
        const foggy = weather.isFoggy?.();
        const windy = weather.isWindy?.();
        return `Weather: ${raining ? 'raining' : snowing ? 'snowing' : 'clear'}${foggy ? ', foggy' : ''}${windy ? ', windy' : ''}`;
      }

      default:
        return 'Subcommands: rain [intensity], snow [intensity], clear, fog [density], thunder, wind, debris, status';
    }
  });

  // ============================================================================
  // Wind Commands
  // ============================================================================

  registry.register('wind', async (args) => {
    const weather = (window as any).weather;

    if (!weather) {
      return 'Weather system not available (game not started)';
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'on':
        weather.wind(true);
        return 'Wind started';

      case 'off':
        weather.wind(false);
        return 'Wind stopped';

      case 'strength': {
        const strength = parseFloat(args[1]);
        if (isNaN(strength)) {
          return 'Usage: wind strength <0-1>';
        }
        weather.windStrength(strength);
        return `Wind strength: ${strength}`;
      }

      case 'angle': {
        const angle = parseFloat(args[1]);
        if (isNaN(angle)) {
          return 'Usage: wind angle <radians>';
        }
        weather.windAngle(angle);
        return `Wind angle: ${angle} rad`;
      }

      case 'gust':
        weather.gust();
        return 'Gust triggered';

      case 'calm':
        weather.calmBreeze();
        return 'Calm breeze preset';

      case 'moderate':
        weather.moderateWind();
        return 'Moderate wind preset';

      case 'storm':
        weather.stormWind();
        return 'Storm wind preset';

      default:
        return 'Subcommands: on, off, strength <0-1>, angle <rad>, gust, calm, moderate, storm';
    }
  });

  // ============================================================================
  // Debris Commands
  // ============================================================================

  registry.register('debris', async (args) => {
    const weather = (window as any).weather;

    if (!weather) {
      return 'Weather system not available (game not started)';
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'leaves':
        weather.debris('leaves');
        return 'Leaves debris started';

      case 'trash':
        weather.debris('trash');
        return 'Trash debris started';

      case 'dust':
        weather.debris('dust');
        return 'Dust debris started';

      case 'mixed':
        weather.debris('mixed');
        return 'Mixed debris started';

      case 'off':
        weather.debris(false);
        return 'Debris stopped';

      case 'density': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris density <0-1>';
        weather.debrisDensity(v);
        return `Debris density: ${v}`;
      }

      case 'size': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris size <number>';
        weather.debrisSize(v);
        return `Debris size: ${v}`;
      }

      case 'speed': {
        const min = parseFloat(args[1]);
        const max = parseFloat(args[2]) || min * 2;
        if (isNaN(min)) return 'Usage: debris speed <min> [max]';
        weather.debrisSpeed(min, max);
        return `Debris speed: ${min}-${max}`;
      }

      case 'gravity': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris gravity <number>';
        weather.debrisGravity(v);
        return `Debris gravity: ${v}`;
      }

      case 'spin': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris spin <number>';
        weather.debrisSpin(v);
        return `Debris spin: ${v}`;
      }

      case 'lifetime': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris lifetime <seconds>';
        weather.debrisLifetime(v);
        return `Debris lifetime: ${v}s`;
      }

      case 'windforce': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris windforce <number>';
        weather.debrisWindForce(v);
        return `Debris windforce: ${v}`;
      }

      case 'turbulence': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris turbulence <0-1>';
        weather.debrisTurbulence(v);
        return `Debris turbulence: ${v}`;
      }

      case 'spread': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris spread <number>';
        weather.debrisSpread(v);
        return `Debris spread: ${v}`;
      }

      case 'height': {
        const v = parseFloat(args[1]);
        if (isNaN(v)) return 'Usage: debris height <number>';
        weather.debrisHeight(v);
        return `Debris height: ${v}`;
      }

      case 'settings':
        return JSON.stringify(weather.settings()?.debris, null, 2);

      default:
        return 'Subcommands: leaves, trash, dust, mixed, off, density, size, speed, gravity, spin, lifetime, windforce, turbulence, spread, height, settings';
    }
  });

  // ============================================================================
  // Camera Commands - Full CameraSystem integration
  // ============================================================================

  registry.register('camera', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const setCameraMode = (window as any).setCameraMode;
    const getCameraMode = (window as any).getCameraMode;
    const setCameraHeight = (window as any).setCameraHeight;
    const getCameraHeight = (window as any).getCameraHeight;

    switch (subcommand) {
      case 'mode': {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          const current = getCameraMode?.() || 'unknown';
          return `Current mode: ${current}\nUsage: camera mode <perspective|orthographic|fake_ortho>`;
        }
        if (!['perspective', 'orthographic', 'fake_ortho'].includes(mode)) {
          return 'Invalid mode. Use: perspective, orthographic, fake_ortho';
        }
        if (setCameraMode) {
          setCameraMode(mode);
          return `Camera mode set to: ${mode}`;
        }
        return 'Camera system not available';
      }

      case 'height': {
        const height = parseFloat(args[1]);
        if (isNaN(height)) {
          const current = getCameraHeight?.() || 'unknown';
          return `Current height: ${current}\nUsage: camera height <number>`;
        }
        if (setCameraHeight) {
          setCameraHeight(height);
          return `Camera height set to: ${height}`;
        }
        return 'Camera system not available';
      }

      case 'target': {
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          const target = cameraSystem.getTarget();
          return `Current target: ${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}\nUsage: camera target <x> <y> <z>`;
        }
        cameraSystem.setTarget(new Vector3(x, y, z));
        return `Camera target set to: ${x}, ${y}, ${z}`;
      }

      case 'controller': {
        const type = args[1]?.toLowerCase();
        if (!type) {
          const active = cameraSystem.getActiveController();
          return `Active controller: ${active?.type || 'none'}\nUsage: camera controller <isometric|fps|sidescroll>`;
        }

        // Register controller if not already registered
        if (!cameraSystem.getController(type)) {
          switch (type) {
            case 'isometric':
              cameraSystem.registerController(type, new IsometricController());
              break;
            case 'fps':
              cameraSystem.registerController(type, new FPSController());
              break;
            case 'sidescroll':
              cameraSystem.registerController(type, new SideScrollController());
              break;
            case 'follow':
              cameraSystem.registerController(type, new FollowController());
              break;
            case 'freefly':
              cameraSystem.registerController(type, new FreeflyController());
              break;
            default:
              return `Unknown controller: ${type}. Available: isometric, fps, sidescroll, follow, freefly`;
          }
        }

        if (cameraSystem.setController(type)) {
          return `Switched to controller: ${type}`;
        }
        return `Failed to switch to controller: ${type}`;
      }

      case 'controllers': {
        const types = cameraSystem.getControllerTypes();
        const active = cameraSystem.getActiveController()?.type;
        if (types.length === 0) {
          return 'No controllers registered';
        }
        return `Registered controllers:\n${types.map(t => `  ${t}${t === active ? ' (active)' : ''}`).join('\n')}`;
      }

      case 'info': {
        const mode = getCameraMode?.() || 'unknown';
        const height = getCameraHeight?.() || 'unknown';
        const target = cameraSystem.getTarget();
        const controller = cameraSystem.getActiveController();
        const cam = cameraSystem.getArcRotateCamera();

        const lines = [
          `Mode: ${mode}`,
          `Height: ${height}`,
          `Target: ${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}`,
          `Controller: ${controller?.type || 'none'}`,
        ];

        if (cam) {
          lines.push(`Alpha: ${cam.alpha.toFixed(4)} rad`);
          lines.push(`Beta: ${cam.beta.toFixed(4)} rad`);
          lines.push(`Radius: ${cam.radius.toFixed(1)}`);
          if (cam.fov) lines.push(`FOV: ${cam.fov.toFixed(3)}`);
        }

        return lines.join('\n');
      }

      case 'preset': {
        const presetName = args[1];
        if (!presetName) {
          return 'Usage: camera preset <name>\nUse "camera presets" to list available presets';
        }
        if (cameraSystem.applyPreset(presetName)) {
          return `Applied preset: ${presetName}`;
        }
        return `Preset not found: ${presetName}`;
      }

      case 'presets': {
        const presets = cameraSystem.getPresetNames();
        if (presets.length === 0) {
          return 'No presets available';
        }
        return `Available presets:\n  ${presets.join('\n  ')}`;
      }

      case 'reset': {
        // Reset to default isometric view
        const cam = cameraSystem.getArcRotateCamera();
        if (cam) {
          cam.alpha = -Math.PI / 4;
          cam.beta = Math.PI / 4;
          cameraSystem.setHeight(800);
          return 'Camera reset to default isometric view';
        }
        return 'Camera not available';
      }

      case 'fov': {
        const fovValue = parseFloat(args[1]);
        const scene = cameraSystem.getCamera()?.getScene();
        const activeCam = scene?.activeCamera;
        if (!activeCam) return 'No active camera';

        if (isNaN(fovValue)) {
          return `Current FOV: ${activeCam.fov?.toFixed(3) || 'N/A'} radians\nUsage: camera fov <radians>\nTypical values: 0.4 (narrow) to 1.5 (wide)`;
        }
        activeCam.fov = fovValue;
        // Also update controller config if it's FPS
        const controller = cameraSystem.getActiveController();
        if (controller?.type === 'fps') {
          controller.configure({ fov: fovValue });
        }
        return `FOV set to: ${fovValue} radians`;
      }

      case 'pos':
      case 'teleport': {
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        // Use scene's active camera since controller may have created a new one
        const scene = cameraSystem.getCamera()?.getScene();
        const activeCam = scene?.activeCamera;
        if (!activeCam) return 'No active camera';

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          const pos = activeCam.position;
          return `Camera position: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}\nUsage: camera pos <x> <y> <z>`;
        }
        activeCam.position.set(x, y, z);
        return `Camera teleported to: ${x}, ${y}, ${z}`;
      }

      default:
        return 'Subcommands: mode, height, target, fov, pos, controller, controllers, info, preset, presets, reset';
    }
  });

  // ============================================================================
  // Map Commands (placeholder)
  // ============================================================================

  // ============================================================================
  // Export Commands - Export current settings to JSON for engine-settings.json
  // ============================================================================

  registry.register('export', async (args) => {
    const subcommand = args[0]?.toLowerCase();

    // Get current settings from window globals
    const camera = (window as any).camera;
    const fx = (window as any).fx;

    const getCameraSettings = () => {
      if (!camera) return null;
      const cam = camera.get?.();
      if (!cam) return null;
      return {
        mode: camera.getMode?.() || "fake_ortho",
        height: camera.getHeight?.() || Math.round(cam.radius || 800),
        alpha: parseFloat(cam.alpha?.toFixed(6) || "-0.785398"),
        beta: parseFloat(cam.beta?.toFixed(6) || "0.785398"),
        fov: parseFloat(cam.fov?.toFixed(3) || "0.4"),
        smoothing: 0.15
      };
    };

    const getFxSettings = () => {
      if (!fx) return null;
      const settings = fx.settings?.();
      if (!settings) return null;
      return {
        bloom: {
          enabled: settings.bloom?.enabled ?? true,
          intensity: settings.bloom?.intensity ?? 0.3
        },
        vignette: {
          enabled: settings.vignette?.enabled ?? true,
          weight: settings.vignette?.weight ?? 0.3
        },
        ssao: {
          enabled: settings.ssao?.enabled ?? false,
          intensity: settings.ssao?.intensity ?? 0.5
        },
        chromaticAberration: {
          enabled: settings.chromaticAberration?.enabled ?? false
        }
      };
    };

    const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        console.log('[Export] Copied to clipboard!');
      }).catch(() => {
        console.log('[Export] Could not copy to clipboard - see output above');
      });
    };

    switch (subcommand) {
      case 'camera': {
        const cameraSettings = getCameraSettings();
        if (!cameraSettings) return 'Camera not available';
        const json = JSON.stringify({ camera: cameraSettings }, null, 2);
        console.log(json);
        copyToClipboard(json);
        return 'Camera settings exported (copied to clipboard)';
      }

      case 'fx': {
        const fxSettings = getFxSettings();
        if (!fxSettings) return 'Post-processing not available';
        const json = JSON.stringify({ postProcessing: fxSettings }, null, 2);
        console.log(json);
        copyToClipboard(json);
        return 'Post-processing settings exported (copied to clipboard)';
      }

      case 'all': {
        const allSettings: Record<string, unknown> = {};

        const cameraSettings = getCameraSettings();
        if (cameraSettings) allSettings.camera = cameraSettings;

        const fxSettings = getFxSettings();
        if (fxSettings) allSettings.postProcessing = fxSettings;

        // Add lighting defaults
        allSettings.lighting = {
          sunIntensity: 0.6,
          moonIntensity: 0.12,
          ambientIntensity: 0.25,
          enableShadows: true
        };

        // Add time defaults
        allSettings.time = {
          dayLengthSeconds: 180,
          startHour: 8,
          startDay: 1
        };

        const json = JSON.stringify(allSettings, null, 2);
        console.log(json);
        copyToClipboard(json);
        return 'All settings exported (copied to clipboard) - paste into public/game/engine-settings.json';
      }

      case 'show': {
        const allSettings: Record<string, unknown> = {};
        const cameraSettings = getCameraSettings();
        if (cameraSettings) allSettings.camera = cameraSettings;
        const fxSettings = getFxSettings();
        if (fxSettings) allSettings.postProcessing = fxSettings;
        return JSON.stringify(allSettings, null, 2);
      }

      case 'map': {
        // Export current settings as worldspawn entity values for NetRadiant
        const cam = camera?.get?.();
        const weatherApi = (window as any).weather;

        const lines: string[] = [
          '// ============================================',
          '// Worldspawn entity values for NetRadiant',
          '// Copy these into your map\'s worldspawn entity',
          '// ============================================',
          '',
          '// Camera settings',
          `"camera_mode" "${camera?.getMode?.() || 'fake_ortho'}"`,
          `"camera_height" "${camera?.getHeight?.() || 800}"`,
        ];

        // Add camera angles if non-default
        if (cam) {
          const alpha = cam.alpha?.toFixed(4);
          const beta = cam.beta?.toFixed(4);
          if (alpha && Math.abs(parseFloat(alpha) + 0.7854) > 0.01) {
            lines.push(`"camera_alpha" "${alpha}"`);
          }
          if (beta && Math.abs(parseFloat(beta) - 0.7854) > 0.01) {
            lines.push(`"camera_beta" "${beta}"`);
          }
        }

        lines.push('');
        lines.push('// Lighting settings (optional overrides)');
        lines.push('"sun_intensity" "0.6"');
        lines.push('"moon_intensity" "0.12"');
        lines.push('"ambient_intensity" "0.25"');
        lines.push('"shadows" "1"');

        lines.push('');
        lines.push('// Time settings (optional)');
        lines.push('"day_length" "180"');
        lines.push('"start_hour" "8"');

        lines.push('');
        lines.push('// Weather defaults (optional)');
        if (weatherApi?.isRaining?.()) {
          lines.push('"weather" "rain"');
          lines.push('"weather_intensity" "0.5"');
        } else if (weatherApi?.isSnowing?.()) {
          lines.push('"weather" "snow"');
          lines.push('"weather_intensity" "0.5"');
        }
        if (weatherApi?.isFoggy?.()) {
          lines.push('"fog" "1"');
          lines.push('"fog_density" "0.02"');
        }

        lines.push('');
        lines.push('// Map flags');
        lines.push('// "indoor" "1"  // Uncomment to disable rain/snow');
        lines.push('// "playlist" "playlists/ambient.json"  // Music playlist');

        const output = lines.join('\n');
        console.log(output);

        navigator.clipboard.writeText(output).then(() => {
          console.log('[Export] Copied to clipboard!');
        }).catch(() => { });

        return 'Map worldspawn values exported (copied to clipboard) - paste into NetRadiant entity editor';
      }

      default:
        return 'Subcommands: camera, fx, all, map, show';
    }
  });

  // ============================================================================
  // Map Commands (placeholder)
  // ============================================================================

  registry.register('map', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const scene = cameraSystem.getCamera()?.getScene();

    // Import MapLoader dynamically
    const { MapLoader } = await import('../loader/map/MapLoader');
    const mapLoader = MapLoader.getInstance();

    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: map load <mapname>\nExample: map load wdm1';
        }

        if (!scene) {
          // Try to create empty scene first
          await registry.execute('scene empty');
          if (!cameraSystem.getCamera()?.getScene()) {
            return 'No scene available. Run "scene empty" first.';
          }
        }

        const activeScene = cameraSystem.getCamera()?.getScene();
        if (!activeScene) {
          return 'No scene available';
        }

        const result = await mapLoader.loadMap(mapName, activeScene, (progress) => {
          console.log(`[Map] ${progress.phase}${progress.detail ? ': ' + progress.detail : ''}`);
        });

        if (result.success) {
          // Auto-enable PVS culling for BSP maps
          let pvsStatus = '';
          if (result.mapType === 'bsp' && result.meshResult?.clusterInfo?.hasPVS) {
            const pvsResult = await registry.execute('pvs on');
            pvsStatus = pvsResult ? `  PVS: enabled` : '';
          }

          return [
            `Loaded map: ${mapName} (${result.mapType})`,
            result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : '',
            result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : '',
            pvsStatus,
          ].filter(Boolean).join('\n');
        } else {
          return `Failed to load map: ${result.error}`;
        }
      }

      case 'reload': {
        const currentMap = mapLoader.getCurrentMap();
        if (!currentMap) {
          return 'No map currently loaded';
        }
        const activeScene = cameraSystem.getCamera()?.getScene();
        if (!activeScene) {
          return 'No scene available';
        }
        const result = await mapLoader.loadMap(currentMap, activeScene);
        return result.success
          ? `Reloaded map: ${currentMap}`
          : `Failed to reload: ${result.error}`;
      }

      case 'list': {
        const { PK3Index } = await import('../loader/pk3/PK3Index');
        const pk3Index = PK3Index.getInstance();

        if (!pk3Index.hasIndex()) {
          return 'No PK3 index. Run "pk3 index build" first to discover maps.';
        }

        const maps = mapLoader.getAvailableMaps();
        if (maps.length === 0) {
          return 'No maps found in index.';
        }

        const lines = [`Available maps (${maps.length}):`];
        const displayMaps = maps.slice(0, 30);
        for (const map of displayMaps) {
          lines.push(`  ${map.name} (${map.pk3})`);
        }
        if (maps.length > 30) {
          lines.push(`  ... and ${maps.length - 30} more`);
        }
        return lines.join('\n');
      }

      case 'current': {
        const current = mapLoader.getCurrentMap();
        return current ? `Current map: ${current}` : 'No map loaded';
      }

      case 'unload': {
        mapLoader.disposeCurrentMap();
        return 'Map unloaded';
      }

      default: {
        // If no subcommand but has argument, treat as map name (shortcut)
        if (subcommand && !['load', 'reload', 'list', 'current', 'unload'].includes(subcommand)) {
          const mapName = subcommand;
          const activeScene = cameraSystem.getCamera()?.getScene();

          if (!activeScene) {
            // Try to create empty scene first
            await registry.execute('scene empty');
          }

          const finalScene = cameraSystem.getCamera()?.getScene();
          if (!finalScene) {
            return 'No scene available. Run "scene empty" first.';
          }

          const result = await mapLoader.loadMap(mapName, finalScene, (progress) => {
            console.log(`[Map] ${progress.phase}${progress.detail ? ': ' + progress.detail : ''}`);
          });

          if (result.success) {
            // Auto-enable PVS culling for BSP maps
            let pvsStatus = '';
            if (result.mapType === 'bsp' && result.meshResult?.clusterInfo?.hasPVS) {
              const pvsResult = await registry.execute('pvs on');
              pvsStatus = pvsResult ? `  PVS: enabled` : '';
            }

            return [
              `Loaded map: ${mapName}`,
              result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : '',
              result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : '',
              pvsStatus,
            ].filter(Boolean).join('\n');
          } else {
            return `Failed to load map: ${result.error}`;
          }
        }

        return [
          'Map Commands:',
          '  map <name>      - Load a map (BSP from PK3)',
          '  map load <name> - Same as above',
          '  map list        - List available maps',
          '  map current     - Show current map',
          '  map reload      - Reload current map',
          '  map unload      - Unload current map',
        ].join('\n');
      }
    }
  });

  // ============================================================================
  // UI Scale Commands
  // ============================================================================

  registry.register('ui', async (args) => {
    const uiScale = await getUIScale();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'scale': {
        const value = args[1];
        if (!value) {
          return `Current scale: ${uiScale.getScale().toFixed(3)}`;
        }
        if (value === 'auto') {
          uiScale.forceScale(null);
          return `UI scale reset to automatic (now: ${uiScale.getScale().toFixed(3)})`;
        }
        const scale = parseFloat(value);
        if (isNaN(scale) || scale <= 0) {
          return `Usage: ui scale <number|auto>\nCurrent: ${uiScale.getScale().toFixed(3)}`;
        }
        uiScale.forceScale(scale);
        return `UI scale: ${uiScale.getScale().toFixed(3)}`;
      }

      case 'mode': {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          return `Current mode: fit\nModes: fit, fill, width, height`;
        }
        if (!['fit', 'fill', 'width', 'height'].includes(mode)) {
          return 'Invalid mode. Use: fit, fill, width, height';
        }
        uiScale.setScaleMode(mode as 'fit' | 'fill' | 'width' | 'height');
        return `UI scale mode: ${mode} (scale: ${uiScale.getScale().toFixed(3)})`;
      }

      case 'debug':
        uiScale.toggleDebug();
        return 'UI debug overlay toggled';

      case 'info':
        return uiScale.getDebugInfo();

      default:
        return `Subcommands: scale [value|auto], mode [fit|fill|width|height], debug, info\nCurrent scale: ${uiScale.getScale().toFixed(3)}`;
    }
  });

  // ============================================================================
  // HUD Commands
  // ============================================================================

  registry.register('hud', async (args) => {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'info':
        return HUD.getDebugInfo();

      case 'interval': {
        const ms = parseInt(args[1], 10);
        if (!args[1]) {
          return `Current interval: ${HUD.getInterval()}ms`;
        }
        if (isNaN(ms) || ms < 16) {
          return `Usage: hud interval <ms>\nCurrent: ${HUD.getInterval()}ms\nMinimum: 16ms`;
        }
        HUD.setInterval(ms);
        return `HUD update interval: ${ms}ms`;
      }

      case 'show': {
        const id = args[1];
        if (!id) return 'Usage: hud show <element-id>';
        HUD.show(id);
        return `Showing: ${id}`;
      }

      case 'hide': {
        const id = args[1];
        if (!id) return 'Usage: hud hide <element-id>';
        HUD.hide(id);
        return `Hidden: ${id}`;
      }

      case 'toggle': {
        const id = args[1];
        if (!id) return 'Usage: hud toggle <element-id>';
        HUD.toggle(id);
        return `Toggled: ${id}`;
      }

      case 'refresh':
        HUD.refresh();
        return 'HUD refreshed';

      case 'theme': {
        const theme = args[1];
        if (!theme) {
          return `Current theme: ${HUD.getTheme()}\nAvailable: default, dark`;
        }
        HUD.setTheme(theme);
        return `Theme: ${theme}`;
      }

      case 'collapse': {
        const id = args[1];
        if (!id) {
          HUD.collapseAll();
          return 'All accordions collapsed';
        }
        HUD.collapse(id);
        return `Collapsed: ${id}`;
      }

      case 'expand': {
        const id = args[1];
        if (!id) return 'Usage: hud expand <element-id>';
        HUD.expand(id);
        return `Expanded: ${id}`;
      }

      case 'start':
        HUD.start();
        return 'HUD update loop started';

      case 'stop':
        HUD.stop();
        return 'HUD update loop stopped';

      case 'reset':
        HUD.reset();
        return 'HUD reset to defaults';

      default:
        return `HUD Commands:\n  info - Show HUD status\n  interval <ms> - Set update interval\n  show/hide/toggle <id> - Element visibility\n  refresh - Force refresh\n  theme <name> - Set theme\n  collapse/expand <id> - Accordion control\n  start/stop - Update loop\n  reset - Reset to defaults`;
    }
  });

  // ============================================================================
  // Game Path Commands
  // ============================================================================

  registry.register('game', async (args) => {
    const gamePaths = GamePaths.getInstance();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'info':
        return gamePaths.getDebugInfo();

      case 'load': {
        const name = args[1];
        if (!name) {
          return `Usage: game load <name>\nCurrent game: ${gamePaths.getGameName()}`;
        }
        gamePaths.setGame(name);
        return `Game set to: ${name}\nReload the page to apply changes, or use: game reload`;
      }

      case 'reload':
        // Reload with current game
        window.location.href = `${window.location.pathname}?game=${gamePaths.getGameName()}`;
        return 'Reloading...';

      case 'switch': {
        const name = args[1];
        if (!name) {
          return `Usage: game switch <name>\nThis will reload the page with the new game.`;
        }
        window.location.href = `${window.location.pathname}?game=${name}`;
        return `Switching to game: ${name}...`;
      }

      default:
        return `Game Commands:\n  info - Show current game paths\n  load <name> - Set game (requires reload)\n  switch <name> - Switch game and reload\n  reload - Reload with current game\n\nCurrent game: ${gamePaths.getGameName()}`;
    }
  });

  // ============================================================================
  // PK3 Package Commands
  // ============================================================================

  registry.register('pk3', async (args) => {
    const pk3 = PK3Loader.getInstance();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'load': {
        const filename = args[1];
        if (!filename) {
          return 'Usage: pk3 load <filename.pk3>';
        }
        try {
          await pk3.loadPK3(filename);
          return `Loaded: ${filename}`;
        } catch (e) {
          return `Failed to load ${filename}: ${e}`;
        }
      }

      case 'list': {
        const pattern = args[1];
        const files = pk3.listFiles(pattern);
        if (files.length === 0) {
          return pattern ? `No files matching: ${pattern}` : 'No files loaded';
        }
        const display = files.slice(0, 50);
        const result = display.join('\n');
        return files.length > 50
          ? `${result}\n... and ${files.length - 50} more`
          : result;
      }

      case 'dir': {
        const dir = args[1] || '';
        const items = pk3.listDirectory(dir);
        if (items.length === 0) {
          return `Empty or not found: ${dir}`;
        }
        return items.join('\n');
      }

      case 'info': {
        const packages = pk3.getPackageInfo();
        if (packages.length === 0) {
          return 'No PK3 packages loaded';
        }
        return packages.map(p =>
          `${p.filename} (priority ${p.priority}, ${p.fileCount} files)`
        ).join('\n');
      }

      case 'test': {
        const path = args[1];
        if (!path) {
          return 'Usage: pk3 test <filepath>\nTests loading a file from pk3';
        }

        const data = await pk3.getFile(path);
        if (!data) {
          return `File not found: ${path}`;
        }

        // If it's a KTX file, try to parse it
        if (path.toLowerCase().endsWith('.ktx')) {
          try {
            const ktx = parseKTX1(data);
            return `KTX1 parsed: ${ktx.formatName}, ${ktx.header.pixelWidth}x${ktx.header.pixelHeight}, ${ktx.mipLevels.length} mips, compressed: ${ktx.isCompressed}`;
          } catch (e) {
            return `KTX parse error: ${e}`;
          }
        }

        return `File loaded: ${path} (${data.byteLength} bytes)`;
      }

      case 'unload':
        pk3.unloadAll();
        return 'All PK3 packages unloaded';

      case 'texture': {
        const texPath = args[1];
        if (!texPath) {
          return 'Usage: pk3 texture <path>\nLoads a texture and its companions (_gloss, _norm)';
        }

        const texLoader = PK3TextureLoader.getInstance();
        const cameraSystem = await getCameraSystem();
        const scene = cameraSystem.getCamera()?.getScene();
        const engine = scene?.getEngine() as any;

        if (!engine || !scene) {
          return 'Engine/Scene not available (game not started?)';
        }

        // Initialize if needed
        texLoader.init(engine, scene);

        try {
          const textureSet = await texLoader.loadTextureSet(texPath);
          const parts = [
            `Diffuse: ${textureSet.diffuse ? 'loaded' : 'failed'}`,
            `Gloss: ${textureSet.gloss ? 'loaded' : 'not found'}`,
            `Normal: ${textureSet.normal ? 'loaded' : 'not found'}`,
          ];
          return `Texture set "${textureSet.name}":\n  ${parts.join('\n  ')}`;
        } catch (e) {
          return `Failed to load texture: ${e}`;
        }
      }

      case 'sets': {
        const dir = args[1] || 'textures';
        const texLoader = PK3TextureLoader.getInstance();
        const sets = texLoader.findTextureSets(dir);

        if (sets.length === 0) {
          return `No texture sets found in: ${dir}`;
        }

        const display = sets.slice(0, 20).map(s => {
          const companions = [];
          if (s.gloss) companions.push('gloss');
          if (s.normal) companions.push('norm');
          const companionStr = companions.length > 0 ? ` [+${companions.join(',')}]` : '';
          return `${s.diffuse}${companionStr}`;
        });

        return sets.length > 20
          ? `${display.join('\n')}\n... and ${sets.length - 20} more`
          : display.join('\n');
      }

      case 'cache': {
        const texLoader = PK3TextureLoader.getInstance();
        const info = texLoader.getCacheInfo();
        if (info.count === 0) {
          return 'Texture cache is empty';
        }
        return `Cached textures (${info.count}):\n  ${info.textures.join('\n  ')}`;
      }

      case 'path': {
        const newPath = args[1];
        if (newPath) {
          pk3.addSearchPath(newPath);
          return `Added search path: ${newPath}`;
        }
        const paths = pk3.getSearchPaths();
        return `Search paths:\n  ${paths.join('\n  ')}`;
      }

      case 'index': {
        const { PK3Index } = await import('../loader');
        const index = PK3Index.getInstance();
        const subCmd = args[1]?.toLowerCase();

        switch (subCmd) {
          case 'build': {
            // Sync search paths
            index.setSearchPaths(pk3.getSearchPaths());
            const count = await index.buildIndex((msg) => console.log(`[PK3Index] ${msg}`));
            return `Index built: ${count} files indexed`;
          }

          case 'find': {
            const filePath = args[2];
            if (!filePath) {
              return 'Usage: pk3 index find <filepath>';
            }
            const foundPk3 = index.findFile(filePath);
            return foundPk3
              ? `Found in: ${foundPk3}`
              : `Not found in index: ${filePath}`;
          }

          case 'search': {
            const pattern = args[2];
            if (!pattern) {
              return 'Usage: pk3 index search <pattern>';
            }
            const results = index.findByPattern(pattern);
            if (results.length === 0) {
              return `No matches for: ${pattern}`;
            }
            const display = results.slice(0, 20).map(r => `${r.file} -> ${r.pk3}`);
            return results.length > 20
              ? `${display.join('\n')}\n... and ${results.length - 20} more`
              : display.join('\n');
          }

          case 'clear': {
            index.clear();
            return 'Index cleared';
          }

          case 'stats':
          default: {
            const stats = index.getStats();
            if (!index.hasIndex()) {
              return 'No index built. Use "pk3 index build" to create one.';
            }
            const packages = index.getPackages();
            const mapNames = index.getMapNames();
            return [
              `Index Stats:`,
              `  Files: ${stats.fileCount}`,
              `  Shaders: ${stats.shaderCount}`,
              `  Maps: ${stats.mapCount}`,
              `  Packages: ${stats.packageCount}`,
              `  Checksum: ${stats.checksum}`,
              `  Last updated: ${stats.lastUpdated?.toLocaleString() || 'never'}`,
              '',
              mapNames.length > 0 ? `Maps available: ${mapNames.slice(0, 10).join(', ')}${mapNames.length > 10 ? '...' : ''}` : '',
              '',
              'Indexed packages:',
              ...packages.slice(0, 10).map(p => `  ${p.pk3} (${p.fileCount} files)`),
              packages.length > 10 ? `  ... and ${packages.length - 10} more` : '',
            ].filter(Boolean).join('\n');
          }
        }
      }

      default:
        return [
          'PK3 Commands:',
          '  load <file.pk3> - Load a PK3 package',
          '  list [pattern] - List files (* wildcard)',
          '  dir [path] - List directory contents',
          '  info - Show loaded packages',
          '  path [add] - Show/add search paths',
          '  index [build|find|search|stats|clear] - PK3 index',
          '  test <filepath> - Test loading a file',
          '  texture <path> - Load texture with companions',
          '  sets [dir] - Find texture sets in directory',
          '  cache - Show texture cache',
          '  unload - Unload all packages',
        ].join('\n');
    }
  });

  // ============================================================================
  // Memory Stats Commands
  // ============================================================================

  registry.register('mem', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const scene = cameraSystem.getCamera()?.getScene();
    const engine = scene?.getEngine();

    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    switch (subcommand) {
      case 'textures': {
        if (!scene) return 'Scene not available';

        const textures = scene.textures;
        let totalSize = 0;
        const textureList: string[] = [];

        for (const tex of textures) {
          const size = tex.getSize();
          const width = size.width || 0;
          const height = size.height || 0;
          // Estimate: 4 bytes per pixel (RGBA)
          const estimatedBytes = width * height * 4;
          totalSize += estimatedBytes;

          const name = tex.name || 'unnamed';
          const shortName = name.length > 40 ? '...' + name.slice(-37) : name;
          textureList.push(`${shortName} (${width}x${height})`);
        }

        const lines = [
          `Textures loaded: ${textures.length}`,
          `Estimated VRAM: ${formatBytes(totalSize)}`,
          '',
          'Textures:',
          ...textureList.slice(0, 30).map(t => `  ${t}`),
        ];

        if (textureList.length > 30) {
          lines.push(`  ... and ${textureList.length - 30} more`);
        }

        return lines.join('\n');
      }

      case 'meshes': {
        if (!scene) return 'Scene not available';

        const meshes = scene.meshes;
        let totalVertices = 0;
        let totalFaces = 0;

        for (const mesh of meshes) {
          totalVertices += mesh.getTotalVertices();
          totalFaces += mesh.getTotalIndices() / 3;
        }

        return [
          `Meshes: ${meshes.length}`,
          `Total vertices: ${totalVertices.toLocaleString()}`,
          `Total triangles: ${Math.floor(totalFaces).toLocaleString()}`,
          `Estimated vertex data: ${formatBytes(totalVertices * 32)}`, // position + normal + uv
        ].join('\n');
      }

      case 'engine': {
        if (!engine) return 'Engine not available';

        const caps = engine.getCaps();
        const webglVersion = (engine as any).webGLVersion || 'unknown';
        const lines = [
          `WebGL version: ${webglVersion}`,
          `Max texture size: ${caps.maxTextureSize}`,
          `Max textures: ${caps.maxTexturesImageUnits}`,
          `Max vertex textures: ${caps.maxVertexTextureImageUnits}`,
          `Compressed textures:`,
          `  S3TC (DXT): ${caps.s3tc ? 'Yes' : 'No'}`,
          `  ETC1: ${caps.etc1 ? 'Yes' : 'No'}`,
          `  ETC2: ${caps.etc2 ? 'Yes' : 'No'}`,
          `  ASTC: ${caps.astc ? 'Yes' : 'No'}`,
          `  PVRTC: ${caps.pvrtc ? 'Yes' : 'No'}`,
        ];
        return lines.join('\n');
      }

      case 'js': {
        // Chrome-only memory API
        const perf = (performance as any);
        if (perf.memory) {
          return [
            `JS Heap Used: ${formatBytes(perf.memory.usedJSHeapSize)}`,
            `JS Heap Total: ${formatBytes(perf.memory.totalJSHeapSize)}`,
            `JS Heap Limit: ${formatBytes(perf.memory.jsHeapSizeLimit)}`,
          ].join('\n');
        }
        return 'JS memory info not available (Chrome only)';
      }

      case 'pk3': {
        const pk3 = PK3Loader.getInstance();
        const pk3Tex = PK3TextureLoader.getInstance();
        const packages = pk3.getPackageInfo();
        const cache = pk3Tex.getCacheInfo();

        const totalFiles = packages.reduce((sum, p) => sum + p.fileCount, 0);

        return [
          `PK3 packages loaded: ${packages.length}`,
          `Total files indexed: ${totalFiles}`,
          `PK3 textures cached: ${cache.count}`,
        ].join('\n');
      }

      default: {
        if (!scene || !engine) {
          return 'Memory stats not available (game not started?)';
        }

        // Overview
        const textures = scene.textures.length;
        const meshes = scene.meshes.length;
        const materials = scene.materials.length;

        let textureVRAM = 0;
        for (const tex of scene.textures) {
          const size = tex.getSize();
          textureVRAM += (size.width || 0) * (size.height || 0) * 4;
        }

        let totalVertices = 0;
        for (const mesh of scene.meshes) {
          totalVertices += mesh.getTotalVertices();
        }

        const pk3 = PK3Loader.getInstance();
        const pk3Packages = pk3.getPackageInfo().length;

        const lines = [
          '=== Memory Overview ===',
          `Textures: ${textures} (~${formatBytes(textureVRAM)} VRAM)`,
          `Meshes: ${meshes} (${totalVertices.toLocaleString()} verts)`,
          `Materials: ${materials}`,
          `PK3 packages: ${pk3Packages}`,
          '',
          'Subcommands: textures, meshes, engine, js, pk3',
        ];

        return lines.join('\n');
      }
    }
  });

  // ============================================================================
  // Scene Commands - Create empty scenes for testing
  // ============================================================================

  // Store the empty scene reference
  let emptyScene: Scene | null = null;
  let emptySceneCamera: FreeCamera | null = null;
  let emptySceneEscHandler: ((e: KeyboardEvent) => void) | null = null;

  // Helper to dispose empty scene
  const disposeEmptyScene = async () => {
    if (emptyScene) {
      // Remove ESC handler
      if (emptySceneEscHandler) {
        window.removeEventListener('keydown', emptySceneEscHandler);
        emptySceneEscHandler = null;
      }

      // Stop render loop
      const engine = emptyScene.getEngine();
      engine.stopRenderLoop();

      // Dispose scene
      emptyScene.dispose();
      emptyScene = null;
      emptySceneCamera = null;

      // Return to main menu state and trigger the callback to create new MainMenu
      // Note: enterMainMenu() just sets state, returnToMainMenu() also calls the callback
      const menuSystem = await getMenuSystem();
      menuSystem.returnToMainMenu();

      console.log('[EmptyScene] Disposed - returned to main menu');
      return true;
    }
    return false;
  };

  registry.register('scene', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;

    if (!canvas) {
      return 'No canvas found';
    }

    switch (subcommand) {
      case 'empty': {
        // Get or create engine
        const existingEngine = (window as any).babylonEngine;
        const engine = existingEngine || new Engine(canvas, true);

        if (!existingEngine) {
          (window as any).babylonEngine = engine;
        }

        // Dispose previous empty scene if exists
        if (emptyScene) {
          emptyScene.dispose();
        }

        // Create new empty scene
        emptyScene = new Scene(engine);
        emptyScene.clearColor = new Color4(0.1, 0.1, 0.15, 1); // Dark blue-gray

        // Create camera at origin
        emptySceneCamera = new FreeCamera("emptySceneCamera", new Vector3(0, 100, -500), emptyScene);
        emptySceneCamera.setTarget(Vector3.Zero());
        emptySceneCamera.fov = 1.0;
        emptySceneCamera.minZ = 1;
        emptySceneCamera.maxZ = 50000;
        emptySceneCamera.inputs.clear(); // We'll use freefly controller

        // Add basic lighting
        const light = new HemisphericLight("light", new Vector3(0, 1, 0), emptyScene);
        light.intensity = 1.0;

        // Set as active scene
        engine.stopRenderLoop();
        engine.runRenderLoop(() => {
          if (emptyScene) {
            emptyScene.render();
          }
        });

        // Initialize camera system with this scene
        const cameraSystem = await getCameraSystem();
        cameraSystem.init(emptyScene, canvas);
        cameraSystem.setCamera(emptySceneCamera);

        // Always create fresh freefly controller for empty scene
        // (reusing old controller causes issues with stale state)
        const existingFreefly = cameraSystem.getController('freefly');
        if (existingFreefly) {
          existingFreefly.dispose();
        }
        const freeflyController = new FreeflyController();
        cameraSystem.registerController('freefly', freeflyController);
        cameraSystem.setController('freefly');

        // Enter "in_game" state so ESC shows pause menu, not main menu
        (await getMenuSystem()).enterGame();

        // Properly hide the main menu (stops its render loop and disposes its scene)
        const mainMenu = (window as any).mainMenu;
        if (mainMenu && typeof mainMenu.hide === 'function') {
          mainMenu.hide();
          console.log('[EmptyScene] Called mainMenu.hide()');
        } else {
          // Fallback: just hide the element
          const mainMenuEl = document.getElementById('main-menu');
          if (mainMenuEl) {
            mainMenuEl.style.display = 'none';
          }
        }

        // Add ESC key handler to exit empty scene
        if (emptySceneEscHandler) {
          window.removeEventListener('keydown', emptySceneEscHandler);
        }
        emptySceneEscHandler = async (e: KeyboardEvent) => {
          // Don't dispose if debug console is open (let it handle ESC to close)
          const debugConsole = await getDebugConsole();
          if (debugConsole.getIsOpen()) {
            return; // Let console handle ESC
          }

          if (e.key === 'Escape' && emptyScene) {
            e.preventDefault();
            e.stopPropagation();
            disposeEmptyScene();
          }
        };
        window.addEventListener('keydown', emptySceneEscHandler, { capture: true });

        return [
          'Created empty scene for BSP testing',
          'Camera: freefly mode (LMB forward, RMB backward, freelook)',
          'Press ESC to exit empty scene',
          'Now run: bsp load <mapname> && bsp render',
        ].join('\n');
      }

      case 'dispose': {
        if (disposeEmptyScene()) {
          return 'Empty scene disposed';
        }
        return 'No empty scene to dispose';
      }

      default:
        return [
          'Scene Commands:',
          '  scene empty   - Create empty scene for BSP testing',
          '  scene dispose - Dispose empty scene',
        ].join('\n');
    }
  });

  // ============================================================================
  // BSP Commands - Quake3/Warsow FBSP map loading and debugging
  // ============================================================================

  // State for loaded BSP and rendered meshes
  let loadedBsp: BspFile | null = null;
  let bspRenderResult: BspMeshBuildResult | null = null;

  // PVS culler instance
  let pvsCuller: import('../loader/bsp/PVSCuller').PVSCuller | null = null;

  registry.register('bsp', async (args) => {
    const pk3 = PK3Loader.getInstance();
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const scene = cameraSystem.getCamera()?.getScene();

    // Get effective BSP state (local or from MapLoader)
    const { MapLoader } = await import('../loader/map/MapLoader');
    const mapLoader = MapLoader.getInstance();
    const effectiveBsp = loadedBsp || mapLoader.getCurrentBsp();
    const effectiveResult = bspRenderResult || mapLoader.getCurrentMeshResult();

    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: bsp load <mapname>\nExample: bsp load wdm11';
        }

        // Check if map PK3 is loaded, if not load it
        const pk3Name = `map_${mapName}.pk3`;
        const packages = pk3.getPackageInfo();
        const isLoaded = packages.some(p => p.filename === pk3Name);

        if (!isLoaded) {
          try {
            await pk3.loadPK3(pk3Name);
          } catch (e) {
            return `Failed to load PK3 ${pk3Name}: ${e}`;
          }
        }

        // Load BSP from PK3
        const bspPath = `maps/${mapName}.bsp`;
        const bsp = await BspLoader.loadFromPK3(pk3, bspPath);

        if (!bsp) {
          return `Failed to load BSP: ${bspPath}`;
        }

        loadedBsp = bsp;

        // Don't auto-load shaders here - user should call "shader load" after "bsp loadrequired"
        // to ensure all texture PK3 shaders are available
        const { Q3ShaderRegistry } = await import('../loader');
        const shaderCount = Q3ShaderRegistry.getInstance().getShaderCount();

        // Summary
        const format = bsp.header.isFBSP ? 'FBSP' : 'IBSP';
        return [
          `Loaded: ${bspPath}`,
          `Format: ${format} v${bsp.header.version}`,
          `Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`,
          `Entities: ${bsp.entities.length}`,
          `Faces: ${bsp.faces.length}`,
          `Vertices: ${bsp.vertices.length}`,
          `Lightmaps: ${bsp.lightmaps.length}`,
          `Textures: ${bsp.textures.length}`,
          `Shaders: ${shaderCount}`,
          '',
          'Use "bsp info" for details, "bsp render" to display',
        ].join('\n');
      }

      case 'info': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const bsp = effectiveBsp;
        const format = bsp.header.isFBSP ? 'FBSP' : 'IBSP';

        return [
          `=== BSP Info ===`,
          `Format: ${format} v${bsp.header.version}`,
          `Lightmap size: ${bsp.lightmapSize}x${bsp.lightmapSize}`,
          '',
          `Entities: ${bsp.entities.length}`,
          `Textures: ${bsp.textures.length}`,
          `Planes: ${bsp.planes.length}`,
          `Nodes: ${bsp.nodes.length}`,
          `Leafs: ${bsp.leafs.length}`,
          `Models: ${bsp.models.length}`,
          `Brushes: ${bsp.brushes.length}`,
          `Vertices: ${bsp.vertices.length}`,
          `Faces: ${bsp.faces.length}`,
          `MeshVerts: ${bsp.meshVerts.length}`,
          `Lightmaps: ${bsp.lightmaps.length}`,
          `LightVols: ${bsp.lightVols.length}`,
          `VisData: ${bsp.visData ? `${bsp.visData.numClusters} clusters` : 'none'}`,
        ].join('\n');
      }

      case 'faces': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const counts = { polygon: 0, patch: 0, mesh: 0, billboard: 0 };
        for (const face of effectiveBsp.faces) {
          switch (face.faceType) {
            case 1: counts.polygon++; break;
            case 2: counts.patch++; break;
            case 3: counts.mesh++; break;
            case 4: counts.billboard++; break;
          }
        }

        return [
          `=== Face Types ===`,
          `Polygons (type 1): ${counts.polygon}`,
          `Patches (type 2): ${counts.patch}`,
          `Meshes (type 3): ${counts.mesh}`,
          `Billboards (type 4): ${counts.billboard}`,
          `Total: ${effectiveBsp.faces.length}`,
        ].join('\n');
      }

      case 'entities': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const filter = args[1]?.toLowerCase();
        const showDetails = args[2] === 'details' || args[2] === 'd';

        // If showing details for a specific classname
        if (filter && showDetails) {
          const matching = effectiveBsp.entities.filter(e => 
            e.classname.toLowerCase().includes(filter)
          );
          
          if (matching.length === 0) {
            return `No entities matching "${filter}"`;
          }

          const lines = [`=== Entities matching "${filter}" (${matching.length}) ===`];
          for (const ent of matching.slice(0, 10)) {
            lines.push(`\n[${ent.classname}]`);
            for (const [key, value] of Object.entries(ent.properties)) {
              lines.push(`  ${key}: ${value}`);
            }
          }
          if (matching.length > 10) {
            lines.push(`\n... and ${matching.length - 10} more`);
          }
          return lines.join('\n');
        }

        // Count entity types
        const entityTypes: Record<string, number> = {};
        for (const ent of effectiveBsp.entities) {
          if (filter && !ent.classname.toLowerCase().includes(filter)) continue;
          entityTypes[ent.classname] = (entityTypes[ent.classname] || 0) + 1;
        }

        const sorted = Object.entries(entityTypes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30);

        const lines = [`=== Entity Types${filter ? ` (filter: ${filter})` : ''} ===`];
        for (const [type, count] of sorted) {
          lines.push(`  ${type}: ${count}`);
        }

        const total = Object.values(entityTypes).reduce((a, b) => a + b, 0);
        if (sorted.length < Object.keys(entityTypes).length) {
          lines.push(`  ... and ${Object.keys(entityTypes).length - sorted.length} more types`);
        }
        lines.push(`Total: ${total}`);
        lines.push('');
        lines.push('Use "bsp entities <classname> details" to see properties');

        return lines.join('\n');
      }

      case 'textures': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const filter = args[1]?.toLowerCase();
        let textures = effectiveBsp.textures.map((tex, i) => ({ index: i, name: tex.name }));

        if (filter) {
          textures = textures.filter(t => t.name.toLowerCase().includes(filter));
        }

        const lines = filter
          ? [`=== Textures matching "${filter}" (${textures.length} of ${effectiveBsp.textures.length}) ===`]
          : [`=== All Textures (${effectiveBsp.textures.length}) ===`];

        textures.forEach((tex) => {
          lines.push(`${tex.index}: ${tex.name}`);
        });

        if (textures.length === 0) {
          lines.push(`  No textures found${filter ? ` matching "${filter}"` : ''}`);
        }

        return lines.join('\n');
      }

      case 'required': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const { getBspUsedTextures } = await import('../loader');
        const { PK3Index } = await import('../loader');

        const usedTextures = getBspUsedTextures(effectiveBsp);
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
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const { getBspUsedTextures: getTextures } = await import('../loader');
        const { PK3Index } = await import('../loader');

        const usedTextures = getTextures(effectiveBsp);
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
            // Get full URL path from index
            const fullPath = index.getPK3Path(pk3);
            if (fullPath) {
              await pk3Loader.loadPK3FromUrl(fullPath);
            } else {
              // Fallback to search path
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

      case 'worldspawn': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const worldspawn = effectiveBsp.entities.find(e => e.classname === 'worldspawn');
        if (!worldspawn) {
          return 'No worldspawn entity found';
        }

        const lines = ['=== Worldspawn Properties ==='];
        for (const [key, value] of Object.entries(worldspawn.properties)) {
          if (key !== 'classname') {
            lines.push(`  ${key}: ${value}`);
          }
        }

        return lines.join('\n');
      }

      case 'clusters': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const vis = effectiveBsp.visData;
        if (!vis) {
          return 'No visibility data in this BSP';
        }

        // Count leafs per cluster
        const clusterLeafs: Record<number, number> = {};
        for (const leaf of effectiveBsp.leafs) {
          if (leaf.cluster >= 0) {
            clusterLeafs[leaf.cluster] = (clusterLeafs[leaf.cluster] || 0) + 1;
          }
        }

        return [
          `=== PVS Cluster Info ===`,
          `Total clusters: ${vis.numClusters}`,
          `Bytes per cluster: ${vis.bytesPerCluster}`,
          `PVS data size: ${vis.bitVectors.length} bytes`,
          `Leafs with clusters: ${Object.keys(clusterLeafs).length}`,
          `Leafs outside world: ${effectiveBsp.leafs.filter(l => l.cluster < 0).length}`,
        ].join('\n');
      }

      case 'lightmaps': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        const count = effectiveBsp.lightmaps.length;
        const size = effectiveBsp.lightmapSize;
        const bytesEach = size * size * 3;
        const totalMB = (count * bytesEach / 1024 / 1024).toFixed(2);

        // Count faces using lightmaps
        const lmFaces = effectiveBsp.faces.filter(f => f.lightmapIndex >= 0).length;

        return [
          `=== Lightmap Info ===`,
          `Count: ${count}`,
          `Size: ${size}x${size} (${effectiveBsp.header.isFBSP ? 'FBSP' : 'IBSP'})`,
          `Format: RGB (3 bytes/pixel)`,
          `Total size: ${totalMB} MB`,
          `Faces using lightmaps: ${lmFaces}`,
        ].join('\n');
      }

      case 'render': {
        if (!effectiveBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
        }

        if (!scene) {
          return 'No scene available';
        }

        // Parse optional face type filter: "bsp render poly" or "bsp render 1 3"
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
            // Parse as numbers: "1 2 3"
            faceTypes = args.slice(1).map(Number).filter(n => n >= 1 && n <= 4);
            if (faceTypes.length === 0) faceTypes = undefined;
          }
        }

        // Clear previous render
        if (bspRenderResult) {
          bspRenderResult.worldMesh.dispose();
          for (const tex of bspRenderResult.lightmapTextures) {
            tex.dispose();
          }
          bspRenderResult = null;
        }

        try {
          bspRenderResult = BspMeshBuilder.build(effectiveBsp, scene, {
            faceTypes,
            filterTextures: true,
          });

          // Position camera to view the map
          const world = effectiveBsp.models[0];
          if (world) {
            const centerX = (world.mins[0] + world.maxs[0]) / 2;
            const centerZ = (world.mins[1] + world.maxs[1]) / 2;
            const centerY = (world.mins[2] + world.maxs[2]) / 2;

            const camera = cameraSystem.getCamera() as any;
            if (camera?.target) {
              camera.target = new Vector3(centerX, centerY, centerZ);
            }
          }

          const filterInfo = faceTypes ? ` (types: ${faceTypes.join(',')})` : '';
          
          // Initialize collision system
          let collisionInfo = '';
          try {
            const { getCollisionManager } = await import('../physics');
            const cm = getCollisionManager();
            await cm.init(effectiveBsp, scene as never);
            const stats = cm.getStats();
            collisionInfo = `\nCollision: ${cm.getBackendType()} (${(stats.backendStats as any)?.collisionPlanes || 0} planes)`;
          } catch (e) {
            console.warn('[bsp render] Failed to init collision:', e);
          }
          
          return [
            `=== BSP Rendered${filterInfo} ===`,
            `Vertices: ${bspRenderResult.stats.totalVertices}`,
            `Triangles: ${bspRenderResult.stats.totalTriangles}`,
            `Lightmaps: ${bspRenderResult.lightmapTextures.length}`,
            `Faces: ${bspRenderResult.stats.polygonFaces} poly, ${bspRenderResult.stats.patchFaces} patch, ${bspRenderResult.stats.meshFaces} mesh`,
          ].join('\n') + collisionInfo;
        } catch (e) {
          return `Render failed: ${e}`;
        }
      }

      case 'clear': {
        if (bspRenderResult) {
          bspRenderResult.worldMesh.dispose();
          for (const tex of bspRenderResult.lightmapTextures) {
            tex.dispose();
          }
          bspRenderResult = null;
          return 'BSP geometry cleared';
        }
        return 'No BSP geometry to clear';
      }

      case 'applytextures':
      case 'loadtextures': {
        if (!effectiveBsp || !effectiveResult) {
          return 'No BSP rendered. Use "bsp load <map>" then "bsp render", or "map <name>" first.';
        }

        if (!scene) {
          return 'Scene not available';
        }

        try {
          const count = await BspMeshBuilder.applyTextures(
            effectiveResult,
            effectiveBsp,
            scene,
            (loaded, total, name) => {
              console.log(`[BSP] Loading texture ${loaded}/${total}: ${name}`);
            }
          );
          return `Applied ${count} textures to BSP`;
        } catch (e) {
          return `Failed to apply textures: ${e}`;
        }
      }

      case 'applylightmaps':
      case 'lightmap': {
        if (!effectiveResult) {
          return 'No BSP rendered. Use "bsp render" or "map <name>" first.';
        }

        // Parse options: bsp applylightmaps [mode] [intensity]
        const mode = args[1]?.toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
        const intensityArg = args[mode === 'mobile' ? 2 : 1];
        const intensity = intensityArg ? parseFloat(intensityArg) : 1.5;

        try {
          const count = BspMeshBuilder.applyLightmaps(effectiveResult, {
            mode,
            intensity: isNaN(intensity) ? 1.5 : intensity,
          });
          return `Applied ${count} lightmaps (mode: ${mode}, intensity: ${intensity.toFixed(1)})`;
        } catch (e) {
          return `Failed to apply lightmaps: ${e}`;
        }
      }

      case 'sky': {
        const skySubcommand = args[1]?.toLowerCase();

        if (!skySubcommand || skySubcommand === 'info') {
          // Show sky shader info
          if (!effectiveResult) {
            return 'No BSP rendered. Use "bsp render" or "map <name>" first.';
          }

          const skyShaders = effectiveResult.skyShaders;
          if (skyShaders.length === 0) {
            return 'No sky shaders found in this map.';
          }

          const lines = [`=== Sky Shaders (${skyShaders.length}) ===`];
          for (const sky of skyShaders) {
            lines.push(`  ${sky.textureName}`);
            if (sky.skyParms) {
              lines.push(`    farbox: ${sky.skyParms.farbox || '(none)'}`);
              lines.push(`    cloudHeight: ${sky.skyParms.cloudHeight || 0}`);
              lines.push(`    nearbox: ${sky.skyParms.nearbox || '(none)'}`);
            }
          }
          return lines.join('\n');
        }

        if (skySubcommand === 'apply') {
          if (!effectiveResult || !scene) {
            return 'No BSP rendered. Use "bsp render" or "map <name>" first.';
          }

          try {
            const result = await BspMeshBuilder.applySkybox(effectiveResult, scene);
            if (result.success) {
              return 'Skybox created successfully.';
            } else {
              return `Failed to create skybox: ${result.error}`;
            }
          } catch (e) {
            return `Failed to apply skybox: ${e}`;
          }
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

          // Remove existing skybox first
          const existingSkybox = scene.getMeshByName('skybox');
          if (existingSkybox) {
            existingSkybox.dispose();
          }

          const { SkyboxLoader } = await import('../loader');
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
              'The "TOP" marker shows which edge should be up.',
            ].join('\n');
          } else {
            return `Failed to create debug skybox: ${result.error}`;
          }
        }

        return 'Sky subcommands: info, apply, toggle, remove, debug';
      }

      case 'fog': {
        // Fog volume commands
        const fogSubcommand = args[1]?.toLowerCase();

        if (!fogSubcommand || fogSubcommand === 'info') {
          // Show fog volume info from effects lump
          if (!effectiveBsp) {
            return 'No BSP loaded. Use "bsp load <mapname>" or "map <name>" first.';
          }

          const effects = effectiveBsp.effects;
          if (effects.length === 0) {
            return 'No effects (fog) entries in this BSP.';
          }

          const lines: string[] = ['Effects lump entries:'];
          for (let i = 0; i < Math.min(effects.length, 20); i++) {
            const eff = effects[i];
            lines.push(`  [${i}] "${eff.name}" brush=${eff.brushIndex}`);
          }
          if (effects.length > 20) {
            lines.push(`  ... and ${effects.length - 20} more`);
          }
          return lines.join('\n');
        }

        if (fogSubcommand === 'apply') {
          if (!effectiveResult || !scene) {
            return 'No BSP rendered. Use "bsp render" or "map <name>" first.';
          }

          try {
            const result = await BspMeshBuilder.applyFogVolumes(effectiveResult, scene);
            if (result.success) {
              return `Created ${result.fogMeshes.length} fog volume mesh(es).`;
            } else {
              return `No fog volumes created: ${result.error || 'No fog volumes found in BSP'}`;
            }
          } catch (error) {
            return `Failed to apply fog volumes: ${error}`;
          }
        }

        if (fogSubcommand === 'clear') {
          if (!effectiveResult?.fogVolumes) {
            return 'No fog volumes to clear.';
          }

          for (const mesh of effectiveResult.fogVolumes) {
            if (mesh.material) {
              mesh.material.dispose();
            }
            mesh.dispose();
          }
          effectiveResult.fogVolumes = [];
          return 'Fog volumes cleared.';
        }

        return 'Fog subcommands: info, apply, clear';
      }

      case 'door': {
        // Door control commands
        const { getDoorController, getDoorNames } = await import('../loader/bsp/BspEntityHandlers');
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
        const { MapLoader } = await import('../loader/map/MapLoader');
        const mapLoader = MapLoader.getInstance();
        const traceBsp = loadedBsp || mapLoader.getCurrentBsp();
        if (!traceBsp) return 'No BSP loaded';
        
        const { BspCollision } = await import('../physics');
        const collision = new BspCollision(traceBsp);

        const traceSubcmd = args[1]?.toLowerCase();
        const traceScene = cameraSystem.getCamera()?.getScene();

        if (traceSubcmd === 'point') {
          if (!traceScene?.activeCamera) return 'No active camera';
          const cam = traceScene.activeCamera;
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

        if (traceSubcmd === 'down') {
          if (!traceScene?.activeCamera) return 'No active camera';
          const cam = traceScene.activeCamera;
          const start = cam.position.clone();
          const end = start.clone();
          end.y -= 1000; // Trace 1000 units down

          const result = collision.tracePoint(start, end, true); // debug=true
          const distance = (1 - result.fraction) * 1000;

          return [
            `Trace down from (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`,
            `Fraction: ${result.fraction.toFixed(4)}`,
            `Ground distance: ${distance.toFixed(1)} units`,
            `Hit: ${result.fraction < 1.0 ? 'YES' : 'NO'}`,
            `Start solid: ${result.startSolid}`,
            result.plane ? `Plane normal: (${result.plane.normal[0].toFixed(2)}, ${result.plane.normal[1].toFixed(2)}, ${result.plane.normal[2].toFixed(2)})` : '',
          ].filter(Boolean).join('\n');
        }

        if (traceSubcmd === 'forward') {
          if (!traceScene?.activeCamera) return 'No active camera';
          const cam = traceScene.activeCamera as any;
          const start = cam.position.clone();
          
          // Get forward direction from camera
          const forward = cam.getDirection ? cam.getDirection(new Vector3(0, 0, 1)) : new Vector3(0, 0, 1);
          const end = start.add(forward.scale(1000));

          const result = collision.tracePoint(start, end);
          const distance = result.fraction * 1000;

          return [
            `Trace forward from camera`,
            `Fraction: ${result.fraction.toFixed(4)}`,
            `Distance to wall: ${distance.toFixed(1)} units`,
            `Hit: ${result.fraction < 1.0 ? 'YES' : 'NO'}`,
            result.plane ? `Plane normal: (${result.plane.normal[0].toFixed(2)}, ${result.plane.normal[1].toFixed(2)}, ${result.plane.normal[2].toFixed(2)})` : '',
          ].filter(Boolean).join('\n');
        }

        if (traceSubcmd === 'leaf') {
          // Find which leaf the camera is in and what brushes it contains
          const camPos = traceScene?.activeCamera?.position;
          if (!camPos) return 'No camera';
          
          const q3Pos: [number, number, number] = [camPos.x, camPos.z, camPos.y];
          
          // Traverse BSP tree to find leaf
          let nodeIndex = 0;
          const path: string[] = [];
          
          while (nodeIndex >= 0) {
            const node = traceBsp.nodes[nodeIndex];
            if (!node) break;
            const plane = traceBsp.planes[node.planeIndex];
            if (!plane) break;
            
            const dist = q3Pos[0] * plane.normal[0] + q3Pos[1] * plane.normal[1] + q3Pos[2] * plane.normal[2] - plane.dist;
            const side = dist >= 0 ? 'front' : 'back';
            const nextNode = dist >= 0 ? node.children[0] : node.children[1];
            path.push(`Node ${nodeIndex}: ${side} (d=${dist.toFixed(1)}) → ${nextNode}`);
            nodeIndex = nextNode;
          }
          
          const leafIndex = -(nodeIndex + 1);
          const leaf = traceBsp.leafs[leafIndex];
          
          // Get brushes in this leaf
          const brushInfo: string[] = [];
          if (leaf) {
            for (let i = 0; i < leaf.numLeafBrushes; i++) {
              const brushIdx = traceBsp.leafBrushes[leaf.firstLeafBrush + i];
              const brush = traceBsp.brushes[brushIdx];
              const tex = traceBsp.textures[brush?.shaderIndex];
              brushInfo.push(`  Brush ${brushIdx}: ${brush?.numSides || 0} sides, flags=0x${tex?.contentFlags?.toString(16) || '?'}`);
            }
          }
          
          return [
            `Camera Q3: (${q3Pos[0].toFixed(1)}, ${q3Pos[1].toFixed(1)}, ${q3Pos[2].toFixed(1)})`,
            `Leaf index: ${leafIndex}`,
            `Leaf brushes: ${leaf?.numLeafBrushes || 0}`,
            '',
            'Path (last 5 nodes):',
            ...path.slice(-5),
            '',
            'Brushes in leaf:',
            ...brushInfo.slice(0, 10),
            brushInfo.length === 0 ? '  (none)' : '',
          ].filter(Boolean).join('\n');
        }

        if (traceSubcmd === 'dump') {
          // Dump details of brushes that could be hit from CAMERA position
          const camPos = traceScene?.activeCamera?.position;
          if (!camPos) return 'No camera';
          
          // Convert camera to Q3 coords
          const q3Pos: [number, number, number] = [camPos.x, camPos.z, camPos.y];
          
          // Helper to check if a point is inside brush XY bounds
          const pointInsideBrushXY = (brush: typeof traceBsp.brushes[0], x: number, y: number): boolean => {
            for (let si = 0; si < brush.numSides; si++) {
              const side = traceBsp.brushSides[brush.firstSide + si];
              if (!side) continue;
              const plane = traceBsp.planes[side.planeIndex];
              if (!plane) continue;
              // Only check XY planes (ignore Z)
              if (Math.abs(plane.normal[2]) > 0.1) continue;
              // Check if point is on positive side (outside)
              const dist = plane.normal[0] * x + plane.normal[1] * y - plane.dist;
              if (dist > 0) return false;
            }
            return true;
          };
          
          // Find ALL brushes where camera XY is inside (ignore content flags for now)
          const matchingBrushes: string[] = [];
          for (let bi = 0; bi < traceBsp.brushes.length && matchingBrushes.length < 5; bi++) {
            const brush = traceBsp.brushes[bi];
            const tex = traceBsp.textures[brush.shaderIndex];
            // Don't filter by content flags - show ALL brushes
            
            // Check XY bounds first
            if (!pointInsideBrushXY(brush, q3Pos[0], q3Pos[1])) continue;
            
            // Check for floor plane below camera
            let floorZ = -Infinity;
            for (let si = 0; si < brush.numSides; si++) {
              const side = traceBsp.brushSides[brush.firstSide + si];
              if (!side) continue;
              const plane = traceBsp.planes[side.planeIndex];
              if (!plane) continue;
              if (plane.normal[2] > 0.9 && plane.dist < q3Pos[2]) {
                floorZ = Math.max(floorZ, plane.dist);
              }
            }
            
            if (floorZ > -Infinity) {
              const flags = tex ? `0x${tex.contentFlags.toString(16)}` : 'none';
              const texName = tex?.name || 'unknown';
              matchingBrushes.push(`Brush ${bi}: floor at Z=${floorZ.toFixed(0)}, flags=${flags}, tex=${texName}`);
            }
          }
          
          return [
            `Camera Q3: (${q3Pos[0].toFixed(1)}, ${q3Pos[1].toFixed(1)}, ${q3Pos[2].toFixed(1)})`,
            `Looking for brushes containing camera XY with floor below...`,
            '',
            ...matchingBrushes,
            matchingBrushes.length === 0 ? 'NO BRUSHES FOUND containing camera XY!' : '',
          ].filter(Boolean).join('\n');
        }

        if (traceSubcmd === 'brushes') {
          // Analyze brush data to find floor brushes
          const solidBrushes = traceBsp.brushes.filter(b => {
            const tex = traceBsp.textures[b.shaderIndex];
            return tex && (tex.contentFlags & 0x1); // SOLID
          });
          
          // Find ALL floor plane Z values
          const floorZValues: number[] = [];
          
          for (const brush of solidBrushes) {
            for (let si = 0; si < brush.numSides; si++) {
              const side = traceBsp.brushSides[brush.firstSide + si];
              if (!side) continue;
              const plane = traceBsp.planes[side.planeIndex];
              if (!plane) continue;
              
              // Check for upward-facing plane (floor)
              if (plane.normal[2] > 0.9) { // Z-up normal
                floorZValues.push(plane.dist);
                break;
              }
            }
          }
          
          floorZValues.sort((a, b) => a - b);
          const minZ = floorZValues.length > 0 ? floorZValues[0] : 0;
          const maxZ = floorZValues.length > 0 ? floorZValues[floorZValues.length - 1] : 0;
          
          // Get spawn for comparison
          const spawn = traceBsp.entities.find(e => 
            e.classname === 'info_player_deathmatch' || e.classname === 'info_player_start'
          );
          const spawnOrigin = spawn?.properties.origin?.split(' ').map(Number) || [0, 0, 0];
          
          // Camera position
          const camPos = traceScene?.activeCamera?.position;
          
          // Sample vertex Z values to compare
          const vertexZValues = traceBsp.vertices.slice(0, 1000).map(v => v.position[2]);
          const vertexMinZ = Math.min(...vertexZValues);
          const vertexMaxZ = Math.max(...vertexZValues);
          
          return [
            `Total brushes: ${traceBsp.brushes.length}`,
            `Solid brushes: ${solidBrushes.length}`,
            `Brushes with floor planes: ${floorZValues.length}`,
            '',
            `Floor PLANE Z range (Q3): ${minZ.toFixed(0)} to ${maxZ.toFixed(0)}`,
            `Vertex Z range (Q3): ${vertexMinZ.toFixed(0)} to ${vertexMaxZ.toFixed(0)}`,
            '',
            `Spawn origin (Q3): (${spawnOrigin[0]}, ${spawnOrigin[1]}, ${spawnOrigin[2]})`,
            `  → Babylon: (${spawnOrigin[0]}, ${spawnOrigin[2]}, ${spawnOrigin[1]})`,
            '',
            camPos ? `Camera (Babylon): (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})` : 'No camera',
            camPos ? `  → Q3: (${camPos.x.toFixed(1)}, ${camPos.z.toFixed(1)}, ${camPos.y.toFixed(1)})` : '',
          ].join('\n');
        }

        if (traceSubcmd === 'spawn') {
          // Find a spawn point and trace from there
          const spawn = traceBsp.entities.find(e => 
            e.classname === 'info_player_deathmatch' || 
            e.classname === 'info_player_start'
          );
          
          if (!spawn || !spawn.properties.origin) {
            return 'No spawn point found in BSP';
          }
          
          // Parse Q3 origin (space-separated x y z)
          const parts = spawn.properties.origin.split(' ').map(Number);
          const q3Origin: [number, number, number] = [parts[0], parts[1], parts[2]];
          
          // Trace down 500 units from spawn (in Q3 coords) - more distance
          const q3End: [number, number, number] = [q3Origin[0], q3Origin[1], q3Origin[2] - 500];
          
          const { BspCollision } = await import('../physics');
          const coll = new BspCollision(traceBsp);
          
          // Convert to Babylon for tracePoint (which converts back to Q3)
          const babylonStart = new Vector3(q3Origin[0], q3Origin[2], q3Origin[1]);
          const babylonEnd = new Vector3(q3End[0], q3End[2], q3End[1]);
          
          console.log(`[Spawn Trace] Q3: (${q3Origin[0]}, ${q3Origin[1]}, ${q3Origin[2]}) → (${q3End[0]}, ${q3End[1]}, ${q3End[2]})`);
          console.log(`[Spawn Trace] Babylon: (${babylonStart.x}, ${babylonStart.y}, ${babylonStart.z}) → (${babylonEnd.x}, ${babylonEnd.y}, ${babylonEnd.z})`);
          
          const result = coll.tracePoint(babylonStart, babylonEnd, true); // enable debug
          
          return [
            `Spawn: ${spawn.classname}`,
            `Q3 origin: (${q3Origin[0]}, ${q3Origin[1]}, ${q3Origin[2]})`,
            `Babylon: (${babylonStart.x}, ${babylonStart.y}, ${babylonStart.z})`,
            `Trace down 500 units:`,
            `  Fraction: ${result.fraction.toFixed(4)}`,
            `  Hit: ${result.fraction < 1.0 ? 'YES' : 'NO'}`,
            `  Distance to floor: ${(result.fraction * 500).toFixed(1)} units`,
            `  Start solid: ${result.startSolid}`,
            result.plane ? `  Hit plane normal (Q3): (${result.plane.normal[0].toFixed(2)}, ${result.plane.normal[1].toFixed(2)}, ${result.plane.normal[2].toFixed(2)})` : '',
          ].filter(Boolean).join('\n');
        }

        if (traceSubcmd === 'bounds') {
          // Show BSP world bounds from nodes[0]
          const rootNode = traceBsp.nodes[0];
          if (!rootNode) return 'No root node';
          
          return [
            'BSP World Bounds (Q3 coords):',
            `  Mins: (${rootNode.mins[0]}, ${rootNode.mins[1]}, ${rootNode.mins[2]})`,
            `  Maxs: (${rootNode.maxs[0]}, ${rootNode.maxs[1]}, ${rootNode.maxs[2]})`,
            '',
            'Camera position (Babylon → Q3):',
            traceScene?.activeCamera ? 
              `  Babylon: (${traceScene.activeCamera.position.x.toFixed(1)}, ${traceScene.activeCamera.position.y.toFixed(1)}, ${traceScene.activeCamera.position.z.toFixed(1)})` +
              `\n  Q3: (${traceScene.activeCamera.position.x.toFixed(1)}, ${traceScene.activeCamera.position.z.toFixed(1)}, ${traceScene.activeCamera.position.y.toFixed(1)})` 
              : '  No camera',
          ].join('\n');
        }

        // Headless-friendly trace command with explicit Q3 coordinates
        if (traceSubcmd === 'trace') {
          const x = parseFloat(args[2]);
          const y = parseFloat(args[3]);
          const z = parseFloat(args[4]);
          const distance = parseFloat(args[5]) || 500;
          
          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return 'Usage: bsp collision trace <x> <y> <z> [distance]\n  Traces down from Q3 coordinates (x, y, z) for [distance] units (default 500)';
          }
          
          const { BspCollision } = await import('../physics');
          const coll = new BspCollision(traceBsp);
          
          console.log(`[Trace] Q3: (${x}, ${y}, ${z}) → (${x}, ${y}, ${z - distance})`);
          
          const result = coll.tracePoint(
            new Vector3(x, z, y),  // Convert to Babylon for tracePoint
            new Vector3(x, z - distance, y),
            true  // Enable debug output
          );
          
          return [
            `Trace from Q3 (${x}, ${y}, ${z}) down ${distance} units:`,
            `  Fraction: ${result.fraction.toFixed(4)}`,
            `  Hit: ${result.fraction < 1.0 ? 'YES' : 'NO'}`,
            `  Distance to floor: ${(result.fraction * distance).toFixed(1)} units`,
            `  Start solid: ${result.startSolid}`,
            `  All solid: ${result.allSolid}`,
            result.plane ? `  Hit plane: normal=(${result.plane.normal[0].toFixed(2)}, ${result.plane.normal[1].toFixed(2)}, ${result.plane.normal[2].toFixed(2)}) dist=${result.plane.dist.toFixed(1)}` : '',
          ].filter(Boolean).join('\n');
        }

        // Headless-friendly leaf lookup with explicit Q3 coordinates
        if (traceSubcmd === 'findleaf') {
          const x = parseFloat(args[2]);
          const y = parseFloat(args[3]);
          const z = parseFloat(args[4]);
          
          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return 'Usage: bsp collision findleaf <x> <y> <z>\n  Find BSP leaf containing Q3 coordinates';
          }
          
          const q3Pos: [number, number, number] = [x, y, z];
          
          // Traverse BSP tree to find leaf
          let nodeIndex = 0;
          const path: string[] = [];
          
          while (nodeIndex >= 0) {
            const node = traceBsp.nodes[nodeIndex];
            if (!node) break;
            const plane = traceBsp.planes[node.planeIndex];
            if (!plane) break;
            
            const dist = q3Pos[0] * plane.normal[0] + q3Pos[1] * plane.normal[1] + q3Pos[2] * plane.normal[2] - plane.dist;
            const side = dist >= 0 ? 'front' : 'back';
            const nextNode = dist >= 0 ? node.children[0] : node.children[1];
            path.push(`Node ${nodeIndex}: ${side} (d=${dist.toFixed(1)}) → ${nextNode}`);
            nodeIndex = nextNode;
          }
          
          const leafIndex = -(nodeIndex + 1);
          const leaf = traceBsp.leafs[leafIndex];
          
          // Get brushes in this leaf
          const brushInfo: string[] = [];
          if (leaf) {
            for (let i = 0; i < leaf.numLeafBrushes; i++) {
              const brushIdx = traceBsp.leafBrushes[leaf.firstLeafBrush + i];
              const brush = traceBsp.brushes[brushIdx];
              const tex = traceBsp.textures[brush?.shaderIndex];
              brushInfo.push(`  Brush ${brushIdx}: ${brush?.numSides || 0} sides, flags=0x${tex?.contentFlags?.toString(16) || '?'}`);
            }
          }
          
          return [
            `Q3 Position: (${x}, ${y}, ${z})`,
            `Leaf index: ${leafIndex}`,
            `Leaf brushes: ${leaf?.numLeafBrushes || 0}`,
            `Leaf cluster: ${leaf?.cluster ?? -1}`,
            '',
            'Path (last 5 nodes):',
            ...path.slice(-5),
            '',
            'Brushes in leaf:',
            ...brushInfo.slice(0, 10),
            brushInfo.length === 0 ? '  (none)' : '',
          ].filter(Boolean).join('\n');
        }

        // Headless-friendly brush finder with explicit Q3 coordinates
        if (traceSubcmd === 'findbrush') {
          const x = parseFloat(args[2]);
          const y = parseFloat(args[3]);
          const z = parseFloat(args[4]);
          
          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return 'Usage: bsp collision findbrush <x> <y> <z>\n  Find brushes containing Q3 XY with floor below Z';
          }
          
          // Helper to check if a point is inside brush XY bounds
          const pointInsideBrushXY = (brush: typeof traceBsp.brushes[0], px: number, py: number): boolean => {
            for (let si = 0; si < brush.numSides; si++) {
              const side = traceBsp.brushSides[brush.firstSide + si];
              if (!side) continue;
              const plane = traceBsp.planes[side.planeIndex];
              if (!plane) continue;
              if (Math.abs(plane.normal[2]) > 0.1) continue;
              const dist = plane.normal[0] * px + plane.normal[1] * py - plane.dist;
              if (dist > 0) return false;
            }
            return true;
          };
          
          const matchingBrushes: string[] = [];
          for (let bi = 0; bi < traceBsp.brushes.length && matchingBrushes.length < 10; bi++) {
            const brush = traceBsp.brushes[bi];
            const tex = traceBsp.textures[brush.shaderIndex];
            
            if (!pointInsideBrushXY(brush, x, y)) continue;
            
            let floorZ = -Infinity;
            for (let si = 0; si < brush.numSides; si++) {
              const side = traceBsp.brushSides[brush.firstSide + si];
              if (!side) continue;
              const plane = traceBsp.planes[side.planeIndex];
              if (!plane) continue;
              if (plane.normal[2] > 0.9 && plane.dist < z) {
                floorZ = Math.max(floorZ, plane.dist);
              }
            }
            
            if (floorZ > -Infinity) {
              const flags = tex ? `0x${tex.contentFlags.toString(16)}` : 'none';
              matchingBrushes.push(`Brush ${bi}: floor at Z=${floorZ.toFixed(0)}, flags=${flags}`);
            }
          }
          
          return [
            `Q3 Position: (${x}, ${y}, ${z})`,
            `Looking for brushes containing XY with floor below Z...`,
            '',
            ...matchingBrushes,
            matchingBrushes.length === 0 ? 'NO BRUSHES FOUND' : '',
          ].filter(Boolean).join('\n');
        }

        // Find which leaf contains a specific brush
        if (traceSubcmd === 'brushinleaf') {
          const brushId = parseInt(args[2]);
          if (isNaN(brushId)) {
            return 'Usage: bsp collision brushinleaf <brushId>\n  Find which leaf(s) contain a specific brush';
          }
          
          const leafsWithBrush: string[] = [];
          for (let li = 0; li < traceBsp.leafs.length; li++) {
            const leaf = traceBsp.leafs[li];
            for (let i = 0; i < leaf.numLeafBrushes; i++) {
              const brushIdx = traceBsp.leafBrushes[leaf.firstLeafBrush + i];
              if (brushIdx === brushId) {
                leafsWithBrush.push(`Leaf ${li}: cluster=${leaf.cluster}, brushes=${leaf.numLeafBrushes}`);
                break;
              }
            }
          }
          
          return [
            `Searching for brush ${brushId} in all ${traceBsp.leafs.length} leafs...`,
            '',
            leafsWithBrush.length > 0 ? `Found in ${leafsWithBrush.length} leaf(s):` : 'NOT FOUND in any leaf!',
            ...leafsWithBrush.slice(0, 20),
          ].filter(Boolean).join('\n');
        }

        // Dump all planes of a specific brush
        if (traceSubcmd === 'brushinfo') {
          const brushId = parseInt(args[2]);
          if (isNaN(brushId)) {
            return 'Usage: bsp collision brushinfo <brushId>\n  Show all planes of a specific brush';
          }
          
          const brush = traceBsp.brushes[brushId];
          if (!brush) return `Brush ${brushId} not found`;
          
          const tex = traceBsp.textures[brush.shaderIndex];
          const lines: string[] = [
            `Brush ${brushId}: ${brush.numSides} sides`,
            `  Texture: ${tex?.name || 'unknown'}`,
            `  Content flags: 0x${tex?.contentFlags?.toString(16) || '?'}`,
            '',
            'Planes:'
          ];
          
          for (let si = 0; si < brush.numSides; si++) {
            const side = traceBsp.brushSides[brush.firstSide + si];
            if (!side) continue;
            const plane = traceBsp.planes[side.planeIndex];
            if (!plane) continue;
            const n = plane.normal;
            const type = Math.abs(n[0]) > 0.9 ? 'X' : Math.abs(n[1]) > 0.9 ? 'Y' : Math.abs(n[2]) > 0.9 ? 'Z' : 'angled';
            lines.push(`  ${si}: normal=(${n[0].toFixed(2)}, ${n[1].toFixed(2)}, ${n[2].toFixed(2)}) dist=${plane.dist.toFixed(1)} [${type}]`);
          }
          
          return lines.join('\n');
        }

        // Analyze leafBrushes array
        if (traceSubcmd === 'leafstats') {
          let totalBrushRefs = 0;
          let leafsWithBrushes = 0;
          let maxBrushes = 0;
          const brushesInLeafs = new Set<number>();
          
          for (const leaf of traceBsp.leafs) {
            if (leaf.numLeafBrushes > 0) {
              leafsWithBrushes++;
              totalBrushRefs += leaf.numLeafBrushes;
              maxBrushes = Math.max(maxBrushes, leaf.numLeafBrushes);
              for (let i = 0; i < leaf.numLeafBrushes; i++) {
                brushesInLeafs.add(traceBsp.leafBrushes[leaf.firstLeafBrush + i]);
              }
            }
          }
          
          return [
            'Leaf/Brush Statistics:',
            `  Total leafs: ${traceBsp.leafs.length}`,
            `  Leafs with brushes: ${leafsWithBrushes}`,
            `  Total brush references: ${totalBrushRefs}`,
            `  Unique brushes in leafs: ${brushesInLeafs.size}`,
            `  Total brushes in BSP: ${traceBsp.brushes.length}`,
            `  Max brushes in one leaf: ${maxBrushes}`,
            '',
            `  Brushes NOT in any leaf: ${traceBsp.brushes.length - brushesInLeafs.size}`,
          ].join('\n');
        }

        // Backend management commands
        if (traceSubcmd === 'backend') {
          const { getCollisionManager } = await import('../physics');
          const cm = getCollisionManager();
          const backendArg = args[2]?.toLowerCase();
          
          if (!backendArg || backendArg === 'list') {
            const backends = cm.getAvailableBackends();
            const current = cm.getBackendType();
            return [
              'Available collision backends:',
              ...backends.map(b => `  ${b.type === current ? '>' : ' '} ${b.type}: ${b.name}`),
              '',
              `Current: ${current ?? 'none'}`,
              'Use: bsp collision backend <type> to switch',
            ].join('\n');
          }
          
          if (backendArg === 'clipbrush' || backendArg === 'babylon') {
            if (!cm.isInitialized()) {
              await cm.init(traceBsp, (traceScene as unknown) as undefined, backendArg);
            } else {
              cm.setBackend(backendArg);
            }
            return `Switched to ${cm.getBackendType()} backend`;
          }
          
          return 'Unknown backend. Use: clipbrush, babylon';
        }

        // Test new backend trace
        if (traceSubcmd === 'test') {
          const { getCollisionManager } = await import('../physics');
          const cm = getCollisionManager();
          
          if (!cm.isInitialized()) {
            await cm.init(traceBsp, (traceScene as unknown) as undefined);
          }
          
          // Get spawn point
          const spawn = traceBsp.entities.find(e => 
            e.classname === 'info_player_deathmatch' || e.classname === 'info_player_start'
          );
          const origin = spawn?.properties.origin?.split(' ').map(Number) || [0, 0, 100];
          
          // Convert Q3 to Babylon coords
          const babylonPos = new Vector3(origin[0], origin[2], origin[1]);
          const babylonEnd = babylonPos.add(new Vector3(0, -500, 0));
          
          const result = cm.trace(babylonPos as never, babylonEnd as never, { debug: true });
          const stats = cm.getStats();
          
          return [
            `Backend: ${cm.getBackendType()}`,
            `Spawn: Q3(${origin[0]}, ${origin[1]}, ${origin[2]}) → Babylon(${babylonPos.x.toFixed(0)}, ${babylonPos.y.toFixed(0)}, ${babylonPos.z.toFixed(0)})`,
            '',
            'Trace Result:',
            `  Fraction: ${result.fraction.toFixed(4)}`,
            `  Hit: ${result.fraction < 1.0 ? 'YES' : 'NO'}`,
            `  Distance: ${(result.fraction * 500).toFixed(1)} units`,
            result.normal ? `  Normal: (${result.normal.x.toFixed(2)}, ${result.normal.y.toFixed(2)}, ${result.normal.z.toFixed(2)})` : '',
            '',
            stats ? `Stats: ${stats.traceCount} traces, ${stats.hitCount} hits, ${stats.avgTraceTimeMs.toFixed(3)}ms avg` : '',
          ].filter(Boolean).join('\n');
        }

        // Simulate movement with collision (headless test)
        if (traceSubcmd === 'move') {
          const { getCollisionManager } = await import('../physics');
          const cm = getCollisionManager();
          
          if (!cm.isInitialized()) {
            await cm.init(traceBsp, (traceScene as unknown) as undefined);
          }
          
          // Parse movement direction: bsp collision move <dx> <dy> <dz>
          // In Babylon coords (Y-up)
          const dx = parseFloat(args[2]) || 0;
          const dy = parseFloat(args[3]) || 0;
          const dz = parseFloat(args[4]) || 0;
          
          if (dx === 0 && dy === 0 && dz === 0) {
            return 'Usage: bsp collision move <dx> <dy> <dz>\nExample: bsp collision move 100 0 0 (move 100 units on X axis)';
          }
          
          // Get spawn point as starting position
          const spawn = traceBsp.entities.find(e => 
            e.classname === 'info_player_deathmatch' || e.classname === 'info_player_start'
          );
          const origin = spawn?.properties.origin?.split(' ').map(Number) || [0, 0, 100];
          
          // Convert Q3 to Babylon coords: Q3(x,y,z) -> Babylon(x,z,y)
          const startPos = new Vector3(origin[0], origin[2], origin[1]);
          const movement = new Vector3(dx, dy, dz);
          
          // Simulate Q3-style slide move
          const MAX_BUMPS = 4;
          const OVERCLIP = 1.001;
          let currentPos = startPos.clone();
          let currentMove = movement.clone();
          let timeLeft = 1.0;
          const bumps: string[] = [];
          
          for (let bump = 0; bump < MAX_BUMPS; bump++) {
            if (currentMove.length() < 0.001) break;
            
            const end = currentPos.add(currentMove.scale(timeLeft));
            const result = cm.trace(currentPos as never, end as never);
            
            bumps.push(`Bump ${bump}: frac=${result.fraction.toFixed(3)}, move=(${currentMove.x.toFixed(1)}, ${currentMove.y.toFixed(1)}, ${currentMove.z.toFixed(1)})`);
            
            if (result.fraction > 0) {
              // Move to collision point
              const moveDistance = currentMove.scale(timeLeft * result.fraction * 0.99);
              currentPos = currentPos.add(moveDistance);
            }
            
            if (result.fraction >= 1.0) {
              bumps.push('  → Moved full distance');
              break;
            }
            
            // Clip velocity
            timeLeft -= timeLeft * result.fraction;
            
            if (result.normal && timeLeft > 0.001) {
              const normal = new Vector3(result.normal.x, result.normal.y, result.normal.z);
              const backoff = Vector3.Dot(currentMove, normal) * OVERCLIP;
              currentMove = currentMove.subtract(normal.scale(backoff));
              bumps.push(`  → Hit! Normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}), clipped move=(${currentMove.x.toFixed(1)}, ${currentMove.y.toFixed(1)}, ${currentMove.z.toFixed(1)})`);
              
              if (currentMove.length() < 0.1) {
                bumps.push('  → Movement too small, stopping');
                break;
              }
            } else {
              bumps.push('  → No normal or no time left, stopping');
              break;
            }
          }
          
          const totalMoved = currentPos.subtract(startPos);
          const blocked = totalMoved.length() < movement.length() * 0.5;
          
          return [
            `=== Slide Move Simulation ===`,
            `Start: Babylon(${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`,
            `Requested: (${movement.x.toFixed(1)}, ${movement.y.toFixed(1)}, ${movement.z.toFixed(1)}) = ${movement.length().toFixed(1)} units`,
            `End: Babylon(${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)})`,
            `Actually moved: ${totalMoved.length().toFixed(1)} units`,
            `Blocked: ${blocked ? 'YES' : 'NO'}`,
            '',
            'Trace log:',
            ...bumps,
          ].join('\n');
        }

        return [
          'Collision Commands:',
          '  bsp collision point    - Check contents at camera position',
          '  bsp collision down     - Trace down to find ground',
          '  bsp collision forward  - Trace forward to find wall',
          '  bsp collision spawn    - Trace from spawn point (debug)',
          '  bsp collision bounds   - Show BSP world bounds',
          '  bsp collision move <dx> <dy> <dz> - Simulate movement with collision',
          '',
          'Backend Commands:',
          '  bsp collision backend [type]  - List or switch collision backends',
          '  bsp collision test            - Test current backend from spawn',
          '',
          'Headless Commands (explicit Q3 coords):',
          '  bsp collision trace <x> <y> <z> [dist] - Trace down from Q3 coords',
          '  bsp collision findleaf <x> <y> <z>     - Find leaf at Q3 coords',
          '  bsp collision findbrush <x> <y> <z>    - Find brushes at Q3 XY',
          '  bsp collision brushinleaf <id>         - Find leaf containing brush',
          '  bsp collision brushinfo <id>           - Show brush plane details',
          '  bsp collision leafstats                - Show leaf/brush statistics',
        ].join('\n');
      }

      default:
        return [
          'BSP Commands (Quake3/Warsow FBSP):',
          '  bsp load <mapname>  - Load BSP from PK3',
          '  bsp info            - Show BSP statistics',
          '  bsp entities [filter] - List entity types',
          '  bsp door            - Door control commands',
          '  bsp textures [filter] - List textures (filter optional)',
          '  bsp required        - Show required PK3s for textures',
          '  bsp loadrequired    - Auto-load required PK3s',
          '  bsp faces           - Show face type breakdown',
          '  bsp worldspawn      - Show worldspawn properties',
          '  bsp clusters        - Show PVS cluster info',
          '  bsp lightmaps       - Show lightmap info',
          '  bsp render [type]   - Render BSP (poly/patch/mesh/all)',
          '  bsp applytextures   - Load and apply textures from PK3',
          '  bsp applylightmaps [mobile|desktop] [intensity] - Apply lightmaps',
          '  bsp sky [info|apply|toggle|remove|debug] - Skybox commands',
          '  bsp fog [info|apply|clear] - Fog volume commands',
          '  bsp clear           - Clear rendered geometry',
        ].join('\n');
    }
  });

  // ============================================================================
  // Q3 Shader Commands
  // ============================================================================

  registry.register('shader', async (args) => {
    const { Q3ShaderRegistry } = await import('../loader');
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'load': {
        const count = await shaderRegistry.loadShaders();
        return `Loaded ${count} shaders from PK3`;
      }

      case 'count': {
        return `Shaders loaded: ${shaderRegistry.getShaderCount()}`;
      }

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
          return 'Usage: shader info <texture_path>';
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

        const { debugShaderPattern } = await import('../loader/shader/Q3ShaderMaterialFactory');
        return debugShaderPattern(shader);
      }

      case 'deps': {
        // Debug shader dependencies - which PK3s contain the textures?
        const textureName = args[1];
        if (!textureName) {
          return 'Usage: shader deps <texture_path>\nShows which PK3s contain the shader and its textures.';
        }

        const { PK3Index } = await import('../loader/pk3/PK3Index');
        const { PK3Loader } = await import('../loader/pk3/PK3Loader');
        const pk3Index = PK3Index.getInstance();
        const pk3Loader = PK3Loader.getInstance();

        const lines: string[] = [`Dependency check for: ${textureName}`];

        // Check shader definition
        const shaderPk3 = pk3Index.findShader(textureName);
        lines.push(`\nShader definition: ${shaderPk3 || 'NOT INDEXED'}`);

        // Check if shader is loaded
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

          // Surface params
          if (shader.surfaceParms.size > 0) {
            lines.push(`\nSurfaceParms: ${Array.from(shader.surfaceParms).join(', ')}`);
          }
        }

        // Check texture file directly
        const extensions = ['.tga', '.jpg', '.png', '.ktx'];
        lines.push(`\nTexture file search:`);
        for (const ext of extensions) {
          const path = textureName.includes('.') ? textureName : `${textureName}${ext}`;
          const pk3 = pk3Index.findFile(path) || pk3Index.findFile(`textures/${path}`);
          if (pk3) {
            const loaded = pk3Loader.hasFile(path) || pk3Loader.hasFile(`textures/${path}`);
            lines.push(`  ${path}: ${pk3} (loaded: ${loaded ? 'YES' : 'NO'})`);
          }
        }

        // Show loaded PK3s
        const loadedPk3s = pk3Loader.getPackageInfo().map(p => p.filename);
        lines.push(`\nLoaded PK3s (${loadedPk3s.length}): ${loadedPk3s.slice(0, 10).join(', ')}${loadedPk3s.length > 10 ? '...' : ''}`);

        return lines.join('\n');
      }

      case 'glow': {
        // Adjust glow intensity for all glow overlay materials
        const intensity = parseFloat(args[1]);
        if (isNaN(intensity)) {
          return 'Usage: shader glow <intensity>\nDefault: 1.0, try 0.5-3.0';
        }

        const cameraSystem = await getCameraSystem();
        const scene = cameraSystem.getCamera()?.getScene();
        if (!scene) return 'No scene available';

        const { ShaderMaterial } = await import('babylonjs');
        const { GlowOverlayShaderMaterial } = await import('../loader/shader/GlowOverlayShaderMaterial');

        let count = 0;
        for (const mat of scene.materials) {
          if (mat instanceof ShaderMaterial && mat.name && mat.getEffect()?.getUniform('glowIntensity')) {
            GlowOverlayShaderMaterial.setGlowIntensity(mat, intensity);
            count++;
          }
        }

        // Store for future materials
        (window as any)._glowIntensity = intensity;
        return `Glow intensity set to ${intensity} on ${count} materials`;
      }

      case 'lightmap': {
        // Adjust lightmap intensity for all glow overlay materials
        const intensity = parseFloat(args[1]);
        if (isNaN(intensity)) {
          return 'Usage: shader lightmap <intensity>\nDefault: 2.0, try 1.0-4.0';
        }

        const cameraSystem = await getCameraSystem();
        const scene = cameraSystem.getCamera()?.getScene();
        if (!scene) return 'No scene available';

        const { ShaderMaterial } = await import('babylonjs');
        const { GlowOverlayShaderMaterial } = await import('../loader/shader/GlowOverlayShaderMaterial');

        let count = 0;
        for (const mat of scene.materials) {
          if (mat instanceof ShaderMaterial && mat.name && mat.getEffect()?.getUniform('lightmapIntensity')) {
            GlowOverlayShaderMaterial.setLightmapIntensity(mat, intensity);
            count++;
          }
        }

        // Store for future materials
        (window as any)._lightmapIntensity = intensity;
        return `Lightmap intensity set to ${intensity} on ${count} materials`;
      }

      case 'blendmode': {
        // Toggle glow blend mode: 0=additive, 1=alpha
        const mode = args[1]?.toLowerCase();
        if (mode !== 'add' && mode !== 'alpha') {
          return 'Usage: shader blendmode <add|alpha>\n  add = base*lightmap + glow (additive)\n  alpha = mix(base*lightmap, glow, glow.a) (alpha blend)';
        }

        const cameraSystem = await getCameraSystem();
        const scene = cameraSystem.getCamera()?.getScene();
        if (!scene) return 'No scene available';

        const { ShaderMaterial } = await import('babylonjs');
        const { GlowOverlayShaderMaterial } = await import('../loader/shader/GlowOverlayShaderMaterial');

        const useAlpha = mode === 'alpha';
        let count = 0;
        for (const mat of scene.materials) {
          if (mat instanceof ShaderMaterial && mat.name && mat.getEffect()?.getUniform('glowBlendMode')) {
            GlowOverlayShaderMaterial.setGlowBlendMode(mat, useAlpha);
            count++;
          }
        }

        return `Glow blend mode set to ${mode} on ${count} materials`;
      }

      case 'clear': {
        shaderRegistry.clear();
        return 'Shader registry cleared';
      }

      case 'anim': {
        const { ShaderAnimationSystem } = await import('../loader');
        const animSystem = ShaderAnimationSystem.getInstance();
        const animSubcommand = args[1]?.toLowerCase();

        switch (animSubcommand) {
          case 'status':
          case 'info': {
            const info = animSystem.getInfo();
            if (info.length === 0) {
              return 'No animated materials registered.';
            }
            const lines = [
              `=== Shader Animation System ===`,
              `Enabled: ${animSystem.isEnabled()}`,
              `Time scale: ${animSystem.getTimeScale()}`,
              `Total time: ${animSystem.getTotalTime().toFixed(2)}s`,
              `Animated materials: ${animSystem.getCount()}`,
              '',
            ];
            for (const entry of info) {
              lines.push(`  ${entry.id}`);
              lines.push(`    tcMods: ${entry.tcModCount}, rgbGen: ${entry.hasRgbGen}, alphaGen: ${entry.hasAlphaGen}`);
            }
            return lines.join('\n');
          }

          case 'pause':
            animSystem.setEnabled(false);
            return 'Shader animations paused.';

          case 'resume':
          case 'play':
            animSystem.setEnabled(true);
            return 'Shader animations resumed.';

          case 'toggle':
            animSystem.setEnabled(!animSystem.isEnabled());
            return `Shader animations: ${animSystem.isEnabled() ? 'ON' : 'OFF'}`;

          case 'speed': {
            const speed = parseFloat(args[2]);
            if (isNaN(speed)) {
              return `Current speed: ${animSystem.getTimeScale()}x\nUsage: shader anim speed <multiplier>`;
            }
            animSystem.setTimeScale(speed);
            return `Animation speed set to ${speed}x`;
          }

          case 'clear':
            animSystem.clear();
            return 'Cleared all animated materials.';

          default:
            return [
              'Shader Animation Commands:',
              '  shader anim status  - Show animation system status',
              '  shader anim pause   - Pause all animations',
              '  shader anim resume  - Resume animations',
              '  shader anim toggle  - Toggle animations on/off',
              '  shader anim speed <n> - Set time scale (1.0 = normal)',
              '  shader anim clear   - Clear all registered animations',
            ].join('\n');
        }
      }

      default:
        return [
          'Shader Commands (Q3/Warsow):',
          '  shader load         - Load shaders from PK3',
          '  shader count        - Show loaded shader count',
          '  shader list [filter] - List shader names',
          '  shader info <path>  - Show shader definition',
          '  shader resolve <path> - Show resolved material props',
          '  shader pattern <path> - Analyze shader pattern (glow_overlay, etc.)',
          '  shader deps <path>  - Debug shader/texture dependencies',
          '  shader glow <n>     - Set glow intensity (default 1.0)',
          '  shader lightmap <n> - Set lightmap intensity (default 2.0)',
          '  shader clear        - Clear shader registry',
          '  shader anim [...]   - Animation system commands',
        ].join('\n');
    }
  });

  // ============================================================================
  // PVS Culling Commands
  // ============================================================================

  registry.register('pvs', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const camera = cameraSystem.getCamera();

    // Get effective BSP state (local or from MapLoader)
    const { MapLoader } = await import('../loader/map/MapLoader');
    const { createPVSCuller } = await import('../loader/bsp/PVSCuller');
    const mapLoader = MapLoader.getInstance();
    const effectiveBsp = loadedBsp || mapLoader.getCurrentBsp();
    const effectiveResult = bspRenderResult || mapLoader.getCurrentMeshResult();

    // Initialize or get PVS culler
    if (!pvsCuller && effectiveBsp) {
      pvsCuller = createPVSCuller(effectiveBsp);
      if (pvsCuller && effectiveResult) {
        pvsCuller.registerFromWorldMesh(effectiveResult.worldMesh);
      }
    }

    switch (subcommand) {
      case 'on': {
        if (!pvsCuller) {
          if (!effectiveBsp) {
            return 'No BSP loaded. Load a map first with "map <name>" or "bsp load <name>"';
          }
          pvsCuller = createPVSCuller(effectiveBsp);
          if (pvsCuller && effectiveResult) {
            pvsCuller.registerFromWorldMesh(effectiveResult.worldMesh);
          }
        }

        if (!pvsCuller) {
          return 'PVS data not available in this map';
        }

        pvsCuller.setEnabled(true);

        // Start update loop using Babylon's render observer (more efficient than rAF)
        const scene = camera?.getScene();
        if (scene && !(window as any)._pvsObserver) {
          (window as any)._pvsObserver = scene.onBeforeRenderObservable.add(() => {
            if (pvsCuller && pvsCuller.isEnabled() && camera) {
              pvsCuller.update(camera.position);
            }
          });
        }

        return 'PVS culling: ON';
      }

      case 'off': {
        if (pvsCuller) {
          pvsCuller.setEnabled(false);
        }

        // Stop update loop
        const sceneOff = camera?.getScene();
        if (sceneOff && (window as any)._pvsObserver) {
          sceneOff.onBeforeRenderObservable.remove((window as any)._pvsObserver);
          (window as any)._pvsObserver = null;
        }

        return 'PVS culling: OFF';
      }

      case 'status': {
        if (!pvsCuller) {
          if (!effectiveBsp) {
            return 'No BSP loaded';
          }
          return effectiveBsp.visData
            ? `PVS available: ${effectiveBsp.visData.numClusters} clusters (not initialized)`
            : 'No PVS data in this map';
        }

        // Force an update to get fresh stats
        if (camera) {
          pvsCuller.update(camera.position);
        }

        const stats = pvsCuller.getStats();
        const culledPct = stats.totalMeshes > 0
          ? ((stats.culledMeshes / stats.totalMeshes) * 100).toFixed(1)
          : '0';

        return [
          '=== PVS Culling Status ===',
          `Enabled: ${stats.enabled ? 'YES' : 'NO'}`,
          `Current cluster: ${stats.currentCluster}`,
          `Total clusters: ${stats.totalClusters}`,
          `Visible clusters: ${stats.visibleClusters}`,
          '',
          `Total meshes: ${stats.totalMeshes}`,
          `Visible meshes: ${stats.visibleMeshes}`,
          `Culled meshes: ${stats.culledMeshes} (${culledPct}%)`,
          `Update time: ${stats.lastUpdateTime.toFixed(2)}ms`,
        ].join('\n');
      }

      case 'cluster': {
        if (!effectiveBsp) {
          return 'No BSP loaded';
        }

        if (!camera) {
          return 'No camera available';
        }

        // Find current cluster
        const { findLeafForPoint } = await import('../loader/bsp/BspLoader');
        const q3Pos: [number, number, number] = [camera.position.x, camera.position.z, camera.position.y];
        const leaf = findLeafForPoint(q3Pos, effectiveBsp.nodes, effectiveBsp.leafs, effectiveBsp.planes);

        if (!leaf) {
          return 'Camera position not in BSP tree (outside world?)';
        }

        const visData = effectiveBsp.visData;
        let visibleCount = 0;
        if (visData && leaf.cluster >= 0) {
          for (let i = 0; i < visData.numClusters; i++) {
            const byteIdx = leaf.cluster * visData.bytesPerCluster + Math.floor(i / 8);
            const bitIdx = i % 8;
            if (visData.bitVectors[byteIdx] & (1 << bitIdx)) {
              visibleCount++;
            }
          }
        }

        return [
          `=== Current Cluster Info ===`,
          `Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`,
          `Cluster: ${leaf.cluster}`,
          `Area: ${leaf.area}`,
          `Leaf bounds:`,
          `  min: (${leaf.mins.join(', ')})`,
          `  max: (${leaf.maxs.join(', ')})`,
          `Faces in leaf: ${leaf.numLeafFaces}`,
          `Brushes in leaf: ${leaf.numLeafBrushes}`,
          visData ? `Visible clusters: ${visibleCount} / ${visData.numClusters}` : 'No PVS data',
        ].join('\n');
      }

      case 'debug': {
        // Toggle debug visualization overlay
        if ((window as any)._pvsDebugElement) {
          document.body.removeChild((window as any)._pvsDebugElement);
          (window as any)._pvsDebugElement = null;
          return 'PVS debug overlay: OFF';
        }

        if (!pvsCuller) {
          return 'Initialize PVS first with "pvs on"';
        }

        const div = document.createElement('div');
        div.style.cssText = `
          position: fixed;
          top: 80px;
          left: 10px;
          background: rgba(0, 0, 0, 0.75);
          color: #00ff00;
          padding: 8px 12px;
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: 11px;
          z-index: 9999;
          border-radius: 4px;
          min-width: 140px;
          line-height: 1.4;
          pointer-events: none;
        `.replace(/\s+/g, ' ').trim();

        document.body.appendChild(div);
        (window as any)._pvsDebugElement = div;

        const updateDebug = () => {
          if (!(window as any)._pvsDebugElement || !pvsCuller) return;

          const stats = pvsCuller.getStats();
          const culledPct = stats.totalMeshes > 0
            ? ((stats.culledMeshes / stats.totalMeshes) * 100).toFixed(0)
            : '0';

          div.innerHTML = `
            <div style="color:#ff0;font-weight:bold;">PVS Debug</div>
            <div>Cluster: ${stats.currentCluster}</div>
            <div>Visible: ${stats.visibleClusters}/${stats.totalClusters}</div>
            <div style="color:#0f0;">Meshes: ${stats.visibleMeshes}/${stats.totalMeshes}</div>
            <div style="color:#f88;">Culled: ${stats.culledMeshes} (${culledPct}%)</div>
          `.trim();

          requestAnimationFrame(updateDebug);
        };

        updateDebug();
        return 'PVS debug overlay: ON';
      }

      default:
        return [
          'PVS Culling Commands:',
          '  pvs on      - Enable PVS culling',
          '  pvs off     - Disable PVS culling',
          '  pvs status  - Show detailed statistics',
          '  pvs cluster - Show current cluster info',
          '  pvs debug   - Toggle debug overlay',
        ].join('\n');
    }
  });

  // ============================================================================
  // Global Fog Commands (for testing)
  // ============================================================================

  registry.register('fog', async (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = await getCameraSystem();
    const camera = cameraSystem.getCamera();
    const fogScene = camera?.getScene();

    if (!fogScene) {
      return 'Scene not available';
    }

    switch (subcommand) {
      case 'on': {
        // fog on [r] [g] [b] [density]
        const r = parseFloat(args[1]) || 0.5;
        const g = parseFloat(args[2]) || 0.5;
        const b = parseFloat(args[3]) || 0.6;
        const density = parseFloat(args[4]) || 0.01;

        fogScene.fogMode = 3; // FOGMODE_EXP2
        fogScene.fogColor = new Color3(r, g, b);
        fogScene.fogDensity = density;

        return `Global fog enabled: color=(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}), density=${density}`;
      }

      case 'off': {
        fogScene.fogMode = 0; // FOGMODE_NONE
        return 'Global fog disabled';
      }

      case 'color': {
        const r = parseFloat(args[1]);
        const g = parseFloat(args[2]);
        const b = parseFloat(args[3]);

        if (isNaN(r) || isNaN(g) || isNaN(b)) {
          return 'Usage: fog color <r> <g> <b> (values 0-1)';
        }

        fogScene.fogColor = new Color3(r, g, b);
        return `Fog color set to (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`;
      }

      case 'density': {
        const density = parseFloat(args[1]);

        if (isNaN(density)) {
          return 'Usage: fog density <value> (e.g., 0.01)';
        }

        fogScene.fogDensity = density;
        return `Fog density set to ${density}`;
      }

      case 'linear': {
        // fog linear <start> <end>
        const start = parseFloat(args[1]) || 100;
        const end = parseFloat(args[2]) || 1000;

        fogScene.fogMode = 1; // FOGMODE_LINEAR
        fogScene.fogStart = start;
        fogScene.fogEnd = end;

        return `Linear fog enabled: start=${start}, end=${end}`;
      }

      case 'status': {
        const modes = ['NONE', 'LINEAR', 'EXP', 'EXP2'];
        const mode = modes[fogScene.fogMode] || 'UNKNOWN';
        const color = fogScene.fogColor;

        // Check if CamFog is running
        const camFog = (window as any)._camFog;
        const camFogStatus = camFog?.enabled ? 'ACTIVE (overriding!)' : 'inactive';

        return [
          '=== Global Fog Status ===',
          `Mode: ${mode} (${fogScene.fogMode})`,
          `Color: (${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`,
          `Density: ${fogScene.fogDensity}`,
          `Start: ${fogScene.fogStart}, End: ${fogScene.fogEnd}`,
          `CamFog: ${camFogStatus}`,
        ].join('\n');
      }

      case 'worldspawn': {
        // Apply fog from BSP worldspawn entity
        const { applyWorldspawnFog } = await import('../loader/bsp/BspFogVolume');
        const MapLoader = (await import('../loader/map/MapLoader')).MapLoader;
        const bsp = MapLoader.getInstance().getCurrentBsp();
        
        if (!bsp) {
          return 'No BSP loaded. Use "map <name>" first.';
        }
        
        const applied = applyWorldspawnFog(bsp, fogScene);
        return applied 
          ? 'Worldspawn fog applied' 
          : 'No fog settings found in worldspawn. Add "fog" key to worldspawn entity.';
      }

      case 'cam': {
        // CamFog - camera-based fog when inside fog volumes
        const camSubcmd = args[1]?.toLowerCase();
        const { CamFog } = await import('../loader/bsp/BspFogVolume');
        const MapLoader = (await import('../loader/map/MapLoader')).MapLoader;
        const mapLoader = MapLoader.getInstance();
        const effectiveBsp = mapLoader.getCurrentBsp();
        
        // Get or create CamFog instance
        let camFog = (window as any)._camFog as InstanceType<typeof CamFog> | undefined;
        
        if (camSubcmd === 'on') {
          if (!effectiveBsp) {
            return 'No BSP loaded. Use "map <name>" first.';
          }
          if (!camFog) {
            camFog = new CamFog();
            (window as any)._camFog = camFog;
          }
          camFog.init(effectiveBsp, fogScene);
          camFog.enable();
          return 'CamFog enabled - fog will activate when camera enters fog volumes';
        }
        
        if (camSubcmd === 'off') {
          if (camFog) {
            camFog.disable();
          }
          return 'CamFog disabled';
        }
        
        if (camSubcmd === 'status') {
          if (!camFog) {
            return 'CamFog not initialized. Use "fog cam on" first.';
          }
          return camFog.getStatus();
        }
        
        if (camSubcmd === 'scale') {
          const scale = parseFloat(args[2]);
          if (isNaN(scale)) {
            return `Current fog scale: ${camFog?.fogScale ?? 1.0}\nUsage: fog cam scale <value>`;
          }
          if (!camFog) {
            return 'CamFog not initialized. Use "fog cam on" first.';
          }
          camFog.setScale(scale);
          return `Fog scale set to ${scale}`;
        }
        
        return [
          'CamFog Commands:',
          '  fog cam on          - Enable camera-based fog',
          '  fog cam off         - Disable camera-based fog',
          '  fog cam status      - Show CamFog status',
          '  fog cam scale <n>   - Set fog distance scale (default: 1.0)',
        ].join('\n');
      }

      default:
        return [
          'Fog Commands:',
          '',
          'Global Fog (manual):',
          '  fog on [r] [g] [b] [density] - Enable EXP2 fog',
          '  fog off                      - Disable fog',
          '  fog color <r> <g> <b>        - Set fog color (0-1)',
          '  fog density <value>          - Set fog density',
          '  fog linear <start> <end>     - Enable linear fog',
          '  fog status                   - Show fog settings',
          '',
          'BSP Fog:',
          '  fog worldspawn               - Apply fog from BSP worldspawn entity',
          '  fog cam on/off/status/scale  - Camera-based fog from BSP volumes',
        ].join('\n');
    }
  });

}
