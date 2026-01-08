import { AssetLoader } from "./AssetLoader";
import { Cvar } from "./core/Cvar";

// Playlist types
export interface PlaylistTrack {
  file: string;
  title?: string;
}

export interface Playlist {
  name?: string;
  loop?: boolean;
  shuffle?: boolean;
  tracks: PlaylistTrack[];
}

export class AudioManager {
  private static instance: AudioManager;

  private currentMusic: HTMLAudioElement | null = null;
  private fadingOutMusic: HTMLAudioElement | null = null;
  private musicVolume = 0.5;
  private musicEnabled = true;
  private fadeInterval: number | null = null;

  // Playlist state
  private currentPlaylist: Playlist | null = null;
  private currentTrackIndex = 0;
  private playlistName: string | null = null;
  private isPlayingPlaylist = false;

  private constructor() {}

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public init(): void {
    const config = AssetLoader.getInstance().getConfig();
    if (config) {
      this.musicVolume = config.settings.defaultVolume;
      this.musicEnabled = config.settings.musicEnabled;
    }
  }

  /**
   * Register audio cvars for console control.
   * Call after ConsoleCommandRegistry is initialized.
   */
  public registerCvars(): void {
    Cvar.register('s_volume', this.musicVolume, {
      type: 'float',
      min: 0,
      max: 1,
      description: 'Music volume (0-1)',
      onChange: (v) => this.setMusicVolume(v as number),
    });

    Cvar.register('s_musicenabled', this.musicEnabled, {
      type: 'bool',
      description: 'Music enabled (0/1)',
      onChange: (v) => this.setMusicEnabled(v as boolean),
    });

    Cvar.register('s_sfxvolume', this.sfxVolume, {
      type: 'float',
      min: 0,
      max: 1,
      description: 'Sound effects volume (0-1)',
      onChange: (v) => this.setSfxVolume(v as number),
    });

    Cvar.register('s_sfxenabled', this.sfxEnabled, {
      type: 'bool',
      description: 'Sound effects enabled (0/1)',
      onChange: (v) => this.setSfxEnabled(v as boolean),
    });

    console.log('[AudioManager] Registered 4 cvars');
  }

  /**
   * Unlock browser audio context after user interaction.
   * Must be called from a user gesture (click/tap) to satisfy browser policies.
   */
  public unlockAudio(): void {
    // Create and play a silent audio to unlock the audio context
    const silentAudio = new Audio();
    silentAudio.volume = 0;
    silentAudio.play().catch(() => {
      // Ignore errors - this is just to unlock the context
    });
    console.log('[AudioManager] Audio context unlocked');
  }

  public playMusic(key: string, loop = true, fadeIn = true): void {
    console.log(`[AudioManager] playMusic called: key=${key}, enabled=${this.musicEnabled}, volume=${this.musicVolume}`);
    
    if (!this.musicEnabled) {
      console.log("[AudioManager] Music disabled, skipping");
      return;
    }

    const audio = AssetLoader.getInstance().getAudio(key);
    if (!audio) {
      console.warn(`[AudioManager] Audio not found: ${key}`);
      return;
    }
    
    console.log(`[AudioManager] Audio found, preparing to play`);


    // Stop current music
    this.stopMusic(fadeIn);

    // Clone the audio element so we can play it multiple times
    this.currentMusic = audio.cloneNode(true) as HTMLAudioElement;
    this.currentMusic.loop = loop;
    this.currentMusic.volume = fadeIn ? 0 : this.musicVolume;

    this.currentMusic.play().catch((e) => {
      console.warn("Audio autoplay blocked:", e);
    });

    if (fadeIn) {
      this.fadeInMusic();
    }
  }

  public stopMusic(fadeOut = true): void {
    // Also stop any music that's currently fading out
    if (this.fadingOutMusic) {
      this.fadingOutMusic.pause();
      this.fadingOutMusic = null;
    }
    
    if (!this.currentMusic) return;

    if (fadeOut) {
      this.fadeOutMusic();
    } else {
      this.currentMusic.pause();
      this.currentMusic = null;
    }
  }

  private fadeInMusic(): void {
    if (!this.currentMusic) return;

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    let volume = 0;
    this.fadeInterval = window.setInterval(() => {
      if (!this.currentMusic) {
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        return;
      }

      volume += 0.02;
      if (volume >= this.musicVolume) {
        this.currentMusic.volume = this.musicVolume;
        if (this.fadeInterval) clearInterval(this.fadeInterval);
      } else {
        this.currentMusic.volume = volume;
      }
    }, 50);
  }

  private fadeOutMusic(): void {
    if (!this.currentMusic && !this.fadingOutMusic) return;

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    // Stop any previously fading music immediately
    if (this.fadingOutMusic) {
      this.fadingOutMusic.pause();
      this.fadingOutMusic = null;
    }

    const musicToFade = this.currentMusic;
    this.currentMusic = null;
    
    if (!musicToFade) return;
    
    // Track the fading music so we can stop it if needed
    this.fadingOutMusic = musicToFade;

    this.fadeInterval = window.setInterval(() => {
      if (musicToFade.volume > 0.02) {
        musicToFade.volume -= 0.02;
      } else {
        musicToFade.pause();
        this.fadingOutMusic = null;
        if (this.fadeInterval) clearInterval(this.fadeInterval);
      }
    }, 50);
  }

  public setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.currentMusic) {
      this.currentMusic.volume = this.musicVolume;
    }
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.stopMusic(false);
    }
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  // ==================== Sound Effects ====================

  private sfxVolume = 0.7;
  private sfxEnabled = true;

  /**
   * Play a sound effect (one-shot, no looping)
   */
  public playSfx(key: string, volumeMultiplier = 1.0): void {
    if (!this.sfxEnabled) return;

    const audio = AssetLoader.getInstance().getAudio(key);
    if (!audio) {
      console.warn(`[AudioManager] SFX not found: ${key}`);
      return;
    }

    // Clone so we can play multiple instances
    const sfx = audio.cloneNode(true) as HTMLAudioElement;
    sfx.volume = this.sfxVolume * volumeMultiplier;
    sfx.play().catch((e) => {
      console.warn("SFX play blocked:", e);
    });
  }

  /**
   * Play general UI click sound (for taps, selections, etc.)
   */
  public playClick(): void {
    this.playSfx("ui_click", 0.5);
  }

  /**
   * Play 3D button press sound (deeper, more tactile)
   */
  public playButtonPress(): void {
    this.playSfx("button_press", 0.6);
  }

  public setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  // ==================== Playlist System ====================

  /**
   * Start playing a playlist
   * @param playlist The playlist to play
   * @param name Optional name to identify the playlist (prevents reloading same playlist)
   */
  public startPlaylist(playlist: Playlist, name?: string): void {
    // If same playlist is already playing, don't restart
    if (name && this.playlistName === name && this.isPlayingPlaylist) {
      console.log(`[AudioManager] Playlist "${name}" already playing, skipping reload`);
      return;
    }

    console.log(`[AudioManager] Starting playlist: ${playlist.name || name || "unnamed"} with ${playlist.tracks.length} tracks`);

    // Stop any currently playing music (single track or playlist)
    this.stopMusic(true);

    this.currentPlaylist = playlist;
    this.playlistName = name || null;
    this.currentTrackIndex = 0;
    this.isPlayingPlaylist = true;

    // Shuffle if needed
    if (playlist.shuffle) {
      this.shufflePlaylist();
    }

    this.playCurrentTrack(true);
  }

  /**
   * Load and start a playlist from a URL
   * @param playlistUrl URL to the playlist JSON file
   */
  public async loadPlaylist(playlistUrl: string): Promise<void> {
    try {
      const response = await fetch(playlistUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const playlist = await response.json() as Playlist;
      this.startPlaylist(playlist, playlistUrl);
    } catch (e) {
      console.error(`[AudioManager] Failed to load playlist: ${playlistUrl}`, e);
    }
  }

  /**
   * Stop the current playlist
   */
  public stopPlaylist(fadeOut = true): void {
    this.isPlayingPlaylist = false;
    this.currentPlaylist = null;
    this.playlistName = null;
    this.stopMusic(fadeOut);
  }

  /**
   * Play the current track in the playlist
   */
  private failedTrackAttempts = 0;

  private playCurrentTrack(fadeIn = true): void {
    if (!this.currentPlaylist || !this.isPlayingPlaylist) return;

    const track = this.currentPlaylist.tracks[this.currentTrackIndex];
    if (!track) {
      console.warn(`[AudioManager] No track at index ${this.currentTrackIndex}`);
      return;
    }

    console.log(`[AudioManager] Playing track ${this.currentTrackIndex + 1}/${this.currentPlaylist.tracks.length}: ${track.title || track.file}`);

    // Get audio from AssetLoader using the file name (without extension) as key
    const audioKey = track.file.replace(/\.[^.]+$/, ""); // Remove extension
    const audio = AssetLoader.getInstance().getAudio(audioKey);
    
    if (!audio) {
      console.warn(`[AudioManager] Track audio not found: ${audioKey}, trying next track`);
      this.failedTrackAttempts++;
      // Prevent infinite loop - if we've tried all tracks and none work, stop
      if (this.failedTrackAttempts >= this.currentPlaylist.tracks.length) {
        console.error(`[AudioManager] All tracks failed to load, stopping playlist`);
        this.isPlayingPlaylist = false;
        this.failedTrackAttempts = 0;
        return;
      }
      this.nextTrack();
      return;
    }
    
    // Reset failed attempts on successful load
    this.failedTrackAttempts = 0;

    // Stop current music
    if (this.currentMusic) {
      this.stopMusic(fadeIn);
    }

    // Clone and play
    this.currentMusic = audio.cloneNode(true) as HTMLAudioElement;
    this.currentMusic.loop = false; // We handle looping via playlist
    this.currentMusic.volume = fadeIn ? 0 : this.musicVolume;

    // Listen for track end to play next
    this.currentMusic.addEventListener("ended", () => {
      this.nextTrack();
    });

    this.currentMusic.play().catch((e) => {
      console.warn("[AudioManager] Playlist track autoplay blocked:", e);
    });

    if (fadeIn) {
      this.fadeInMusic();
    }
  }

  /**
   * Advance to the next track in the playlist
   */
  private nextTrack(): void {
    if (!this.currentPlaylist || !this.isPlayingPlaylist) return;

    this.currentTrackIndex++;

    // Check if we've reached the end
    if (this.currentTrackIndex >= this.currentPlaylist.tracks.length) {
      if (this.currentPlaylist.loop !== false) {
        // Loop back to start
        this.currentTrackIndex = 0;
        console.log("[AudioManager] Playlist looping back to start");
      } else {
        // Playlist finished
        console.log("[AudioManager] Playlist finished");
        this.isPlayingPlaylist = false;
        return;
      }
    }

    this.playCurrentTrack(false); // No fade between tracks
  }

  /**
   * Shuffle the current playlist tracks
   */
  private shufflePlaylist(): void {
    if (!this.currentPlaylist) return;

    const tracks = this.currentPlaylist.tracks;
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
  }

  /**
   * Get current playlist info
   */
  public getCurrentPlaylistInfo(): { name: string | null; trackIndex: number; trackCount: number; currentTrack: PlaylistTrack | null } | null {
    if (!this.currentPlaylist) return null;

    return {
      name: this.playlistName,
      trackIndex: this.currentTrackIndex,
      trackCount: this.currentPlaylist.tracks.length,
      currentTrack: this.currentPlaylist.tracks[this.currentTrackIndex] || null,
    };
  }

  /**
   * Check if a playlist is currently playing
   */
  public isPlaylistPlaying(): boolean {
    return this.isPlayingPlaylist;
  }

  /**
   * Get the current playlist name
   */
  public getCurrentPlaylistName(): string | null {
    return this.playlistName;
  }
}
