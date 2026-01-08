/**
 * GameAudio - Game-specific audio orchestration
 * 
 * Centralizes all game audio decisions. The engine's AudioManager provides
 * low-level audio primitives; this class provides game-specific semantics.
 */

import { AudioManager } from "../engine/AudioManager";

export class GameAudio {
  private static instance: GameAudio;

  // Audio keys (must match keys in config.json assets.music)
  private static readonly MENU_MUSIC = "menu";
  
  // Playlist path (relative to public/)
  private static readonly GAME_PLAYLIST = "/game/music/playlist.json";

  private constructor() {}

  public static getInstance(): GameAudio {
    if (!GameAudio.instance) {
      GameAudio.instance = new GameAudio();
    }
    return GameAudio.instance;
  }

  /**
   * Play the main menu music
   */
  public playMenuMusic(): void {
    AudioManager.getInstance().playMusic(GameAudio.MENU_MUSIC);
  }

  /**
   * Stop menu music (when transitioning to game)
   */
  public stopMenuMusic(fadeOut = true): void {
    AudioManager.getInstance().stopMusic(fadeOut);
  }

  /**
   * Start the in-game music playlist
   */
  public async startGamePlaylist(): Promise<void> {
    const audio = AudioManager.getInstance();
    
    // Don't restart if already playing
    if (audio.isPlaylistPlaying()) {
      return;
    }
    
    await audio.loadPlaylist(GameAudio.GAME_PLAYLIST);
  }

  /**
   * Load and start a specific playlist (e.g., from map worldspawn)
   */
  public async loadMapPlaylist(playlistPath: string): Promise<void> {
    await AudioManager.getInstance().loadPlaylist(playlistPath);
  }

  /**
   * Check if any playlist is currently playing
   */
  public isPlaylistPlaying(): boolean {
    return AudioManager.getInstance().isPlaylistPlaying();
  }

  /**
   * Stop the current playlist
   */
  public stopPlaylist(fadeOut = true): void {
    AudioManager.getInstance().stopPlaylist(fadeOut);
  }
}
