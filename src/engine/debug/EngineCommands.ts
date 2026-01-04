/**
 * EngineCommands - Register engine-level debug commands
 * 
 * Connects console commands to actual engine systems.
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
import { DebugConsole } from './DebugConsole';
import { AudioManager } from '../AudioManager';
import { GameClock } from '../../game/GameClock';
import { UIScale } from '../ui/UIScale';
import { HUD } from '../ui/hud';
import { GamePaths } from '../core/GamePaths';
import { CameraSystem } from '../camera/CameraSystem';
import { IsometricController } from '../camera/controllers/IsometricController';
import { FPSController } from '../camera/controllers/FPSController';
import { SideScrollController } from '../camera/controllers/SideScrollController';
import { FollowController } from '../camera/controllers/FollowController';
import { FreeflyController } from '../camera/controllers/FreeflyController';
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
import { MenuSystem } from '../MenuSystem';

export function registerEngineCommands(): void {
  const registry = ConsoleCommandRegistry.getInstance();

  // ============================================================================
  // Audio Commands
  // ============================================================================

  registry.register('audio', (args) => {
    const audio = AudioManager.getInstance();
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
  });

  // ============================================================================
  // Time Commands
  // ============================================================================

  registry.register('time', (args) => {
    const clock = GameClock.getInstance();
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

  registry.register('show_fps', (args) => {
    const cameraSystem = CameraSystem.getInstance();
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
  // Debug Commands
  // ============================================================================

  registry.register('debug', (args) => {
    const subcommand = args[0]?.toLowerCase();

    const cameraSystem = CameraSystem.getInstance();
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

  registry.register('weather', (args) => {
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

  registry.register('wind', (args) => {
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

  registry.register('debris', (args) => {
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

  registry.register('camera', (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = CameraSystem.getInstance();
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

  registry.register('export', (args) => {
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
    const cameraSystem = CameraSystem.getInstance();
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
          return [
            `Loaded map: ${mapName} (${result.mapType})`,
            result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : '',
            result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : '',
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
            return [
              `Loaded map: ${mapName}`,
              result.meshResult ? `  Vertices: ${result.meshResult.stats.totalVertices}` : '',
              result.meshResult ? `  Triangles: ${result.meshResult.stats.totalTriangles}` : '',
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

  registry.register('ui', (args) => {
    const uiScale = UIScale.getInstance();
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

  registry.register('hud', (args) => {
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

  registry.register('game', (args) => {
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
        const cameraSystem = CameraSystem.getInstance();
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

  registry.register('mem', (args) => {
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = CameraSystem.getInstance();
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
  const disposeEmptyScene = () => {
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
      const menuSystem = MenuSystem.getInstance();
      menuSystem.returnToMainMenu();

      console.log('[EmptyScene] Disposed - returned to main menu');
      return true;
    }
    return false;
  };

  registry.register('scene', (args) => {
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
        const cameraSystem = CameraSystem.getInstance();
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
        MenuSystem.getInstance().enterGame();

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
        emptySceneEscHandler = (e: KeyboardEvent) => {
          // Don't dispose if debug console is open (let it handle ESC to close)
          const debugConsole = DebugConsole.getInstance();
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

  registry.register('bsp', async (args) => {
    const pk3 = PK3Loader.getInstance();
    const subcommand = args[0]?.toLowerCase();
    const cameraSystem = CameraSystem.getInstance();
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
          return [
            `=== BSP Rendered${filterInfo} ===`,
            `Vertices: ${bspRenderResult.stats.totalVertices}`,
            `Triangles: ${bspRenderResult.stats.totalTriangles}`,
            `Lightmaps: ${bspRenderResult.lightmapTextures.length}`,
            `Faces: ${bspRenderResult.stats.polygonFaces} poly, ${bspRenderResult.stats.patchFaces} patch, ${bspRenderResult.stats.meshFaces} mesh`,
          ].join('\n');
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

      default:
        return [
          'BSP Commands (Quake3/Warsow FBSP):',
          '  bsp load <mapname>  - Load BSP from PK3',
          '  bsp info            - Show BSP statistics',
          '  bsp entities [filter] - List entity types',
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

        const cameraSystem = CameraSystem.getInstance();
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

        const cameraSystem = CameraSystem.getInstance();
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

        const cameraSystem = CameraSystem.getInstance();
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

}
