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
      expect(paths.getGameName()).toBe('default');
    });

    it('should have default engine path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.getEnginePath()).toBe('/engine');
    });
  });

  describe('path builders', () => {
    it('should build game root path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game()).toBe('/games/default');
    });

    it('should build game relative path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game('config.json')).toBe('/games/default/config.json');
    });

    it('should strip leading slash from relative path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.game('/config.json')).toBe('/games/default/config.json');
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
      expect(paths.maps()).toBe('/games/default/maps');
      expect(paths.maps('level1.map')).toBe('/games/default/maps/level1.map');
    });

    it('should build textures path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.textures()).toBe('/games/default/textures');
      expect(paths.textures('wall.jpg')).toBe('/games/default/textures/wall.jpg');
    });

    it('should build prefabs path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.prefabs()).toBe('/games/default/prefabs');
      expect(paths.prefabs('pot.map')).toBe('/games/default/prefabs/pot.map');
    });

    it('should build data path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.data()).toBe('/games/default/data');
      expect(paths.data('strains.json')).toBe('/games/default/data/strains.json');
    });

    it('should build music path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.music()).toBe('/games/default/music');
      expect(paths.music('theme.mp3')).toBe('/games/default/music/theme.mp3');
    });

    it('should build fonts path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.fonts()).toBe('/games/default/fonts');
      expect(paths.fonts('Nunito/Nunito-Bold.ttf')).toBe('/games/default/fonts/Nunito/Nunito-Bold.ttf');
    });
  });

  describe('config file paths', () => {
    it('should return config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.configPath()).toBe('/games/default/config.json');
    });

    it('should return engine-settings.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.engineSettingsPath()).toBe('/games/default/engine-settings.json');
    });

    it('should return ui-config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.uiConfigPath()).toBe('/games/default/data/ui-config.json');
    });

    it('should return hud-config.json path', () => {
      const paths = GamePaths.getInstance();
      expect(paths.hudConfigPath()).toBe('/games/default/data/hud-config.json');
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
      expect(paths.game()).toBe('/games/example');
      expect(paths.maps()).toBe('/games/example/maps');
      expect(paths.configPath()).toBe('/games/example/config.json');
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

    it('should throw if engine.json not found', async () => {
      // Mock fetch to fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      const paths = GamePaths.getInstance();
      await expect(paths.init()).rejects.toThrow('Missing engine.json');
    });
  });

  describe('getDebugInfo', () => {
    it('should return formatted debug info', () => {
      const paths = GamePaths.getInstance();
      const info = paths.getDebugInfo();
      
      expect(info).toContain('GamePaths');
      expect(info).toContain('Game: default');
      expect(info).toContain('Engine: /engine');
      expect(info).toContain('config: /games/default/config.json');
    });
  });
});
