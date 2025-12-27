/**
 * EngineCommands - Register engine-level debug commands
 * 
 * Connects console commands to actual engine systems.
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
import { AudioManager } from '../AudioManager';
import { GameClock } from '../../game/GameClock';

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
        return `Weather: ${raining ? 'raining' : snowing ? 'snowing' : 'clear'}${foggy ? ', foggy' : ''}`;
      }
        
      default:
        return 'Subcommands: rain [intensity], snow [intensity], clear, fog [density], thunder, status';
    }
  });

  // ============================================================================
  // Camera Commands (placeholder - needs CameraSystem reference)
  // ============================================================================
  
  registry.register('camera', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    switch (subcommand) {
      case 'mode': {
        const mode = args[1];
        if (!mode) {
          return 'Usage: camera mode <perspective|orthographic|fake_ortho>';
        }
        return `Camera mode: ${mode} (wire to CameraSystem)`;
      }
      
      case 'height': {
        const height = parseFloat(args[1]);
        if (isNaN(height)) {
          return 'Usage: camera height <number>';
        }
        return `Camera height: ${height} (wire to CameraSystem)`;
      }
      
      case 'pos': {
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          return 'Usage: camera pos <x> <y> <z>';
        }
        return `Camera position: ${x}, ${y}, ${z} (wire to CameraSystem)`;
      }
      
      case 'reset':
        return 'Camera reset (wire to CameraSystem)';
        
      default:
        return 'Subcommands: mode, height, pos, reset';
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
      
      default:
        return 'Subcommands: camera, fx, all, show';
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

}
