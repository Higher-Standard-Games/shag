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
  // Weather Commands (placeholder - needs WeatherSystem reference)
  // ============================================================================
  
  registry.register('weather', (args) => {
    const subcommand = args[0]?.toLowerCase();
    
    // These would need to be wired to actual weather system
    switch (subcommand) {
      case 'rain':
        return 'Weather: rain (wire to WeatherSystem)';
      case 'snow':
        return 'Weather: snow (wire to WeatherSystem)';
      case 'clear':
        return 'Weather: clear (wire to WeatherSystem)';
      case 'fog':
        return 'Weather: fog (wire to WeatherSystem)';
      default:
        return 'Subcommands: rain, snow, clear, fog';
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
  // Cheat Commands (placeholder)
  // ============================================================================
  
  registry.register('give', (args) => {
    const resource = args[0]?.toLowerCase();
    const amount = parseInt(args[1]) || 1000;
    
    switch (resource) {
      case 'money':
        return `Gave $${amount} (wire to GameState)`;
      case 'xp':
        return `Gave ${amount} XP (wire to GameState)`;
      default:
        return 'Usage: give <money|xp> <amount>';
    }
  });

  registry.register('spawn', (args) => {
    const entity = args[0]?.toLowerCase();
    const type = args[1];
    
    switch (entity) {
      case 'npc':
        return `Spawning NPC: ${type || 'default'} (not implemented)`;
      case 'item':
        return `Spawning item: ${type || 'default'} (not implemented)`;
      default:
        return 'Usage: spawn <npc|item> <type>';
    }
  });
}
