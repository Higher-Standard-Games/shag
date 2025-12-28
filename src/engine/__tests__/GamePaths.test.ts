/**
 * Tests for GamePaths - Configurable game directory system
 * 
 * Note: These tests focus on path building logic which doesn't require browser APIs.
 * The init() method with URL params is tested separately with mocks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GamePaths } from '../core/GamePaths';

// Mock window for node environment
const mockWindow = {
  location: {
    search: '',
    pathname: '/',
    href: 'http://localhost/'
  }
};

// @ts-ignore
global.window = mockWindow;

describe('GamePaths', () => {
  beforeEach(() => {
    // Reset singleton before each test
    GamePaths.resetInstance();
    
    // Reset mock window.location
    mockWindow.location = {
      search: '',
      pathname: '/',
      href: 'http://localhost/'
    };
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = GamePaths.getInstance();
      const instance2 = GamePaths.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('default values', () => {
    it('should have default game name', () => {
      const paths = GamePaths.getInstance();
      expect(paths.getGameName()).toBe('game');
    });

    it('should have default engine path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.getEnginePath()).toBe('/engine');
    });
  });

  describe('path builders', () => {
    it('should build game root path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game()).toBe('/game');
    });

    it('should build game relative path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game('config.json')).toBe('/game/config.json');
    });

    it('should strip leading slash from relative path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game('/config.json')).toBe('/game/config.json');
    });

    it('should build engine root path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.engine()).toBe('/engine');
    });

    it('should build engine relative path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.engine('fonts/Nunito')).toBe('/engine/fonts/Nunito');
    });
  });

  describe('convenience methods', () => {
    it('should build maps path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.maps()).toBe('/game/maps');
      expect(paths.maps('level1.map')).toBe('/game/maps/level1.map');
    });

    it('should build textures path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.textures()).toBe('/game/textures');
      expect(paths.textures('wall.jpg')).toBe('/game/textures/wall.jpg');
    });

    it('should build prefabs path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.prefabs()).toBe('/game/prefabs');
      expect(paths.prefabs('pot.map')).toBe('/game/prefabs/pot.map');
    });

    it('should build data path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.data()).toBe('/game/data');
      expect(paths.data('strains.json')).toBe('/game/data/strains.json');
    });

    it('should build music path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.music()).toBe('/game/music');
      expect(paths.music('theme.mp3')).toBe('/game/music/theme.mp3');
    });

    it('should build fonts path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.fonts()).toBe('/game/fonts');
      expect(paths.fonts('Nunito/Nunito-Bold.ttf')).toBe('/game/fonts/Nunito/Nunito-Bold.ttf');
    });
  });

  describe('config file paths', () => {
    it('should return config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.configPath()).toBe('/game/config.json');
    });

    it('should return engine-settings.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.engineSettingsPath()).toBe('/game/engine-settings.json');
    });

    it('should return ui-config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.uiConfigPath()).toBe('/game/data/ui-config.json');
    });

    it('should return hud-config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.hudConfigPath()).toBe('/game/data/hud-config.json');
    });
  });

  describe('setGame', () => {
    it('should change game name', () => {
      const paths = GamePaths.getInstance();
      paths.setGame('example');
      expect(paths.getGameName()).toBe('example');
    });

    it('should update all paths after game change', () => {
      const paths = GamePaths.getInstance();
      paths.setGame('example');
      expect(paths.game()).toBe('/example');
      expect(paths.maps()).toBe('/example/maps');
      expect(paths.configPath()).toBe('/example/config.json');
    });
  });

  describe('init with URL param', () => {
    it('should use game from URL param', async () => {
      // Set URL param
      mockWindow.location = {
        search: '?game=testgame',
        pathname: '/',
        href: 'http://localhost/?game=testgame'
      };

      const paths = GamePaths.getInstance();
      await paths.init();
      
      expect(paths.getGameName()).toBe('testgame');
    });
  });

  describe('init with engine.json', () => {
    it('should load config from engine.json', async () => {
      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          defaultGame: 'mygame',
          engineAssetsPath: '/custom-engine'
        })
      });

      const paths = GamePaths.getInstance();
      await paths.init();
      
      expect(paths.getGameName()).toBe('mygame');
      expect(paths.getEnginePath()).toBe('/custom-engine');
    });

    it('should use defaults if engine.json not found', async () => {
      // Mock fetch to fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      const paths = GamePaths.getInstance();
      await paths.init();
      
      expect(paths.getGameName()).toBe('game');
      expect(paths.getEnginePath()).toBe('/engine');
    });

    it('should prefer URL param over engine.json', async () => {
      // Set URL param
      mockWindow.location = {
        search: '?game=urlgame',
        pathname: '/',
        href: 'http://localhost/?game=urlgame'
      };

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          defaultGame: 'jsongame',
          engineAssetsPath: '/engine'
        })
      });

      const paths = GamePaths.getInstance();
      await paths.init();
      
      // URL param should win
      expect(paths.getGameName()).toBe('urlgame');
    });
  });

  describe('getDebugInfo', () => {
    it('should return formatted debug info', () => {
      const paths = GamePaths.getInstance();
      const info = paths.getDebugInfo();
      
      expect(info).toContain('GamePaths');
      expect(info).toContain('Game: game');
      expect(info).toContain('Engine: /engine');
      expect(info).toContain('config: /game/config.json');
    });
  });
});
