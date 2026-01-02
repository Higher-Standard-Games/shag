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
import { Vector3 } from 'babylonjs';
import { PK3Loader } from '../loader/PK3Loader';
import { parseKTX1 } from '../loader/KTX1Loader';

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
    
    switch (subcommand) {
      case 'fps':
        // Toggle FPS display - would need to wire to actual system
        return 'FPS display toggled (not yet implemented)';
        
      case 'wireframe':
        return 'Wireframe mode toggled (not yet implemented)';
        
      case 'bounds':
        return 'Bounding boxes toggled (not yet implemented)';
        
      case 'lights':
        return 'Light gizmos toggled (not yet implemented)';
        
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
            default:
              return `Unknown controller: ${type}. Available: isometric, fps, sidescroll, follow`;
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
  
  registry.register('map', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: map load <mapname>';
        }
        return `Loading map: ${mapName} (wire to GameScene)`;
      }
      
      case 'reload':
        return 'Reloading current map (wire to GameScene)';
        
      case 'list':
        return 'Available maps: (wire to AssetLoader)';
        
      default:
        return 'Subcommands: load, reload, list';
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
        
      default:
        return 'PK3 Commands:\n  load <file.pk3> - Load a PK3 package\n  list [pattern] - List files (* wildcard)\n  dir [path] - List directory contents\n  info - Show loaded packages\n  test <filepath> - Test loading a file\n  unload - Unload all packages';
    }
  });

}
