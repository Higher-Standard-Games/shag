/**
 * EngineCommands - Register engine-level debug commands
 * 
 * Connects console commands to actual engine systems.
 */

import { ConsoleCommandRegistry } from './ConsoleCommandRegistry';
import { AudioManager } from '../AudioManager';
import { GameClock } from '../../game/GameClock';
import { UIScale } from '../ui/UIScale';

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
  // Camera Commands (placeholder - needs CameraSystem reference)
  // ============================================================================
  
  registry.register('camera', (args) => {
    const subcommand = args[0]?.toLowerCase();
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
      
      case 'info': {
        const mode = getCameraMode?.() || 'unknown';
        const height = getCameraHeight?.() || 'unknown';
        return `Mode: ${mode}\nHeight: ${height}`;
      }
        
      default:
        return 'Subcommands: mode <type>, height <n>, info';
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
          return uiScale.getDebugInfo();
        }
        if (value === 'auto') {
          uiScale.forceScale(null);
          return 'UI scale reset to automatic';
        }
        const scale = parseFloat(value);
        if (isNaN(scale) || scale <= 0) {
          return 'Usage: ui scale <number|auto>';
        }
        uiScale.forceScale(scale);
        return `UI scale forced to: ${scale}`;
      }
      
      case 'mode': {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          return `Current mode: ${uiScale.getScaleFactors().scale}\nModes: fit, fill, width, height`;
        }
        if (!['fit', 'fill', 'width', 'height'].includes(mode)) {
          return 'Invalid mode. Use: fit, fill, width, height';
        }
        uiScale.setScaleMode(mode as 'fit' | 'fill' | 'width' | 'height');
        return `UI scale mode set to: ${mode}`;
      }
      
      case 'debug':
        uiScale.toggleDebug();
        return 'UI debug overlay toggled';
      
      case 'info':
        return uiScale.getDebugInfo();
        
      default:
        return 'Subcommands: scale [value|auto], mode [fit|fill|width|height], debug, info';
    }
  });

}
