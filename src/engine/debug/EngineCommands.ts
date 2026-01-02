/**
 * EngineCommands - Register engine-level debug commands
 * 
 * Connects console commands to actual engine systems.
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
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
import { PK3Loader } from '../loader/PK3Loader';
import { parseKTX1 } from '../loader/KTX1Loader';
import { PK3TextureLoader } from '../loader/PK3TextureLoader';
import { BspLoader, type BspFile } from '../loader/BspLoader';
import { BspMeshBuilder, type BspMeshBuildResult } from '../loader/BspMeshBuilder';
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
        }).catch(() => {});
        
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
    const loadMap = (window as any).loadMap;
    
    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: map load <mapname>';
        }
        if (!loadMap) {
          return 'Map loading not available (game not started?)';
        }
        try {
          await loadMap(mapName);
          return `Loaded map: ${mapName}`;
        } catch (e) {
          return `Failed to load map: ${e}`;
        }
      }
      
      case 'reload': {
        const currentMap = (window as any).currentMap;
        if (!loadMap || !currentMap) {
          return 'Map reload not available';
        }
        await loadMap(currentMap);
        return `Reloaded map: ${currentMap}`;
      }
        
      case 'list':
        return 'Available maps: test, texture_test, farm (check public/game/maps/)';
        
      default:
        return 'Subcommands: load <mapname>, reload, list';
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
        
      default:
        return 'PK3 Commands:\n  load <file.pk3> - Load a PK3 package\n  list [pattern] - List files (* wildcard)\n  dir [path] - List directory contents\n  info - Show loaded packages\n  test <filepath> - Test loading a file\n  texture <path> - Load texture with companions\n  sets [dir] - Find texture sets in directory\n  cache - Show texture cache\n  unload - Unload all packages';
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
          '',
          'Use "bsp info" for details, "bsp render" to display',
        ].join('\n');
      }

      case 'info': {
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const bsp = loadedBsp;
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
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const counts = { polygon: 0, patch: 0, mesh: 0, billboard: 0 };
        for (const face of loadedBsp.faces) {
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
          `Total: ${loadedBsp.faces.length}`,
        ].join('\n');
      }

      case 'entities': {
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const filter = args[1]?.toLowerCase();

        // Count entity types
        const entityTypes: Record<string, number> = {};
        for (const ent of loadedBsp.entities) {
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
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const limit = parseInt(args[1]) || 30;
        const textures = loadedBsp.textures.slice(0, limit);

        const lines = [`=== Textures (${limit} of ${loadedBsp.textures.length}) ===`];
        textures.forEach((tex, i) => {
          lines.push(`  ${i}: ${tex.name}`);
        });

        if (loadedBsp.textures.length > limit) {
          lines.push(`  ... and ${loadedBsp.textures.length - limit} more`);
        }

        return lines.join('\n');
      }

      case 'worldspawn': {
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const worldspawn = loadedBsp.entities.find(e => e.classname === 'worldspawn');
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
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const vis = loadedBsp.visData;
        if (!vis) {
          return 'No visibility data in this BSP';
        }

        // Count leafs per cluster
        const clusterLeafs: Record<number, number> = {};
        for (const leaf of loadedBsp.leafs) {
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
          `Leafs outside world: ${loadedBsp.leafs.filter(l => l.cluster < 0).length}`,
        ].join('\n');
      }

      case 'lightmaps': {
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
        }

        const count = loadedBsp.lightmaps.length;
        const size = loadedBsp.lightmapSize;
        const bytesEach = size * size * 3;
        const totalMB = (count * bytesEach / 1024 / 1024).toFixed(2);

        // Count faces using lightmaps
        const lmFaces = loadedBsp.faces.filter(f => f.lightmapIndex >= 0).length;

        return [
          `=== Lightmap Info ===`,
          `Count: ${count}`,
          `Size: ${size}x${size} (${loadedBsp.header.isFBSP ? 'FBSP' : 'IBSP'})`,
          `Format: RGB (3 bytes/pixel)`,
          `Total size: ${totalMB} MB`,
          `Faces using lightmaps: ${lmFaces}`,
        ].join('\n');
      }

      case 'render': {
        if (!loadedBsp) {
          return 'No BSP loaded. Use "bsp load <mapname>" first.';
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
          bspRenderResult = BspMeshBuilder.build(loadedBsp, scene, {
            faceTypes,
            filterTextures: true,
          });

          // Position camera to view the map
          const world = loadedBsp.models[0];
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

      default:
        return [
          'BSP Commands (Quake3/Warsow FBSP):',
          '  bsp load <mapname>  - Load BSP from PK3',
          '  bsp info            - Show BSP statistics',
          '  bsp entities [filter] - List entity types',
          '  bsp textures [limit]  - List textures',
          '  bsp faces           - Show face type breakdown',
          '  bsp worldspawn      - Show worldspawn properties',
          '  bsp clusters        - Show PVS cluster info',
          '  bsp lightmaps       - Show lightmap info',
          '  bsp render [type]   - Render BSP (poly/patch/mesh/all)',
          '  bsp clear           - Clear rendered geometry',
        ].join('\n');
    }
  });

}
