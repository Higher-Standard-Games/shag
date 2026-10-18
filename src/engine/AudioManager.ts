import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { AssetLoader } from "./AssetLoader";
import { AudioV2Sfx, type SfxChannel, type SfxLoop, type SpatialSfxPlayOptions } from "./audio/AudioV2Sfx";
import { Cvar } from "./core/Cvar";
import { PK3Index } from "./loader/pk3/PK3Index";
import { PK3Loader } from "./loader/pk3/PK3Loader";

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

/** The channel volumes: Warsow's cvars, each a share of `s_sfxvolume`. */
const CHANNEL_CVARS: ReadonlyArray<readonly [string, SfxChannel, string]> = [
  ["cg_volume_effects", "effects", "Weapons, impacts and the world (0-1)"],
  ["cg_volume_players", "players", "Other players' voices and steps (0-1)"],
  ["cg_volume_hitsound", "hits", "Hit and kill confirmation (0-1)"],
  ["cg_volume_announcer", "announcer", "The announcer (0-1)"],
];
const DEFAULT_SFX_VOLUME = 1;

export class AudioManager {
  private static instance: AudioManager;

  /** Clear the cached singleton so ServiceLocator re-inits a fresh one (QA-WO13). */
  static resetInstance(): void {
    AudioManager.instance = null as unknown as AudioManager;
  }

  private currentMusic: HTMLAudioElement | null = null;
  private fadingOutMusic: HTMLAudioElement | null = null;
  private musicVolume = 0.5;
  private musicEnabled = true;

  // Sound effects state
  private sfxVolume = DEFAULT_SFX_VOLUME;
  private sfxEnabled = true;
  private readonly sfxBackend = new AudioV2Sfx();

  private fadeInterval: number | null = null;

  // Playlist state
  private currentPlaylist: Playlist | null = null;
  private currentTrackIndex = 0;
  private playlistName: string | null = null;
  private isPlayingPlaylist = false;

  /** Map of active audio elements to their associated Blob URLs for proper cleanup */
  private audioBlobUrls: Map<HTMLAudioElement, string> = new Map();
  /** Tracking the latest request ID to prevent race conditions in async loading */
  private loadingRequestId = 0;

  private constructor() {
    // Register cvars immediately so they're available even if init() isn't called
    this.registerCvars();
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public async init(scene?: Scene): Promise<void> {
    const config = AssetLoader.getInstance().getConfig();
    if (config) {
      this.musicVolume = config.settings.defaultVolume;
      this.musicEnabled = config.settings.musicEnabled;
    }
    this.sfxBackend.setVolume(this.sfxVolume);
    await this.sfxBackend.init(scene);
    // Cvars are registered in constructor
  }

  /**
   * Register audio cvars for console control.
   * Call after ConsoleCommandRegistry is initialized.
   */
  public registerCvars(): void {
    Cvar.register("s_volume", this.musicVolume, {
      type: "float",
      min: 0,
      max: 1,
      description: "Music volume (0-1)",
      onChange: (v) => this.setMusicVolume(v as number),
    });

    Cvar.register("s_musicenabled", this.musicEnabled, {
      type: "bool",
      description: "Music enabled (0/1)",
      onChange: (v) => this.setMusicEnabled(v as boolean),
    });

    Cvar.register("s_sfxvolume", DEFAULT_SFX_VOLUME, {
      type: "float",
      min: 0,
      max: 1,
      description: "Sound effects volume (0-1)",
      onChange: (v) => this.setSfxVolume(v as number),
    });

    Cvar.register("s_sfxenabled", this.sfxEnabled, {
      type: "bool",
      description: "Sound effects enabled (0/1)",
      onChange: (v) => this.setSfxEnabled(v as boolean),
    });
    this.setSfxVolume(Cvar.getNumber("s_sfxvolume"));

    // Each channel's share of the effects volume, under Warsow's names
    for (const [name, channel, description] of CHANNEL_CVARS) {
      Cvar.register(name, 1, {
        type: "float",
        min: 0,
        max: 1,
        description,
        onChange: (v) => this.sfxBackend.setChannelVolume(channel, v as number),
      });
      this.sfxBackend.setChannelVolume(channel, Cvar.getNumber(name));
    }

    console.log(`[AudioManager] Registered ${4 + CHANNEL_CVARS.length} cvars`);
  }

  /**
   * Unlock browser audio context after user interaction.
   * Must be called from a user gesture (click/tap) to satisfy browser policies.
   */
  public unlockAudio(): void {
    void this.sfxBackend
      .unlock()
      .then(() => console.log("[AudioManager] Audio context unlocked"))
      .catch((error) => console.warn("[AudioManager] Audio unlock failed:", error));
  }

  public playMusic(key: string, loop = true, fadeIn = true): void {
    if (!this.musicEnabled) return;

    const audio = AssetLoader.getInstance().getAudio(key);
    if (!audio) {
      console.warn(`[AudioManager] Audio not found: ${key}`);
      return;
    }

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
      if (this.currentMusic) {
        this.currentMusic.pause();
        this.currentMusic.src = ""; // Clear source

        // Cleanup Blob URL if this element had one
        const blobUrl = this.audioBlobUrls.get(this.currentMusic);
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          this.audioBlobUrls.delete(this.currentMusic);
        }

        this.currentMusic = null;
      }
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
        musicToFade.src = ""; // Clear source

        // Cleanup Blob URL when fade finished
        const blobUrl = this.audioBlobUrls.get(musicToFade);
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          this.audioBlobUrls.delete(musicToFade);
        }

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

  /**
   * Play a sound effect (one-shot, no looping)
   */
  public playSfx(key: string, volumeMultiplier = 1.0): void {
    if (!this.sfxEnabled) return;

    const audio = AssetLoader.getInstance().getAudio(key);
    const source = audio?.src || key;
    void this.sfxBackend.play2D(source, { volume: volumeMultiplier });
  }

  /** Decode a set of short SFX into the Babylon Audio V2 buffer cache. */
  public async preloadSfx(paths: readonly string[]): Promise<void> {
    if (!this.sfxEnabled) return;
    await this.sfxBackend.preload(paths);
  }

  /** Play a listener-relative sound without HTMLAudioElement cloning. */
  public playSfx2D(path: string, volumeMultiplier = 1.0, maxInstances = 8, channel?: SfxChannel): void {
    if (!this.sfxEnabled) return;
    void this.sfxBackend.play2D(path, { volume: volumeMultiplier, maxInstances, channel });
  }

  /** Play a bounded one-shot at an engine-world position. */
  public playSfx3D(
    path: string,
    position: { x: number; y: number; z: number },
    options: SpatialSfxPlayOptions = {},
  ): void {
    if (!this.sfxEnabled) return;
    void this.sfxBackend.play3D(path, new Vector3(position.x, position.y, position.z), options);
  }

  /**
   * Loop a sound at an engine-world position (or everywhere, when `position` is
   * null) until the handle stops it: a map's ambient speakers. Loops keep
   * running while SFX is off, silenced, so turning SFX back on restores them.
   */
  public playLoop3D(
    path: string,
    position: { x: number; y: number; z: number } | null,
    options: SpatialSfxPlayOptions = {},
  ): Promise<SfxLoop | null> {
    const at = position ? new Vector3(position.x, position.y, position.z) : null;
    return this.sfxBackend.playLoop3D(path, at, options);
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
    this.sfxBackend.setVolume(this.sfxVolume);
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    this.sfxBackend.setLoopsMuted(!enabled);
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

    console.log(
      `[AudioManager] Starting playlist: ${playlist.name || name || "unnamed"} with ${playlist.tracks.length} tracks`,
    );

    // Invalidate any in-flight async track loads from the previous playlist.
    // playCurrentTrack checks loadingRequestId after each await; bumping it here
    // ensures old loads abort before they call audio.play().
    this.loadingRequestId++;

    // Stop any currently playing music immediately (no crossfade between playlists)
    this.stopMusic(false);

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
      const pk3 = PK3Loader.getInstance();
      let playlist: Playlist;

      if (pk3.hasFile(playlistUrl)) {
        const buffer = await pk3.getFile(playlistUrl);
        if (!buffer) throw new Error("Failed to read playlist from PK3");
        const text = new TextDecoder().decode(buffer);
        playlist = JSON.parse(text) as Playlist;
        console.log(`[AudioManager] Loaded playlist from PK3: ${playlistUrl}`);
      } else {
        const response = await fetch(playlistUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        playlist = (await response.json()) as Playlist;
        console.log(`[AudioManager] Loaded playlist from URL: ${playlistUrl}`);
      }

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

  private async playCurrentTrack(fadeIn = true): Promise<void> {
    if (!this.currentPlaylist || !this.isPlayingPlaylist) return;

    const track = this.currentPlaylist.tracks[this.currentTrackIndex];
    if (!track) {
      console.warn(`[AudioManager] No track at index ${this.currentTrackIndex}`);
      return;
    }

    console.log(
      `[AudioManager] Playing track ${this.currentTrackIndex + 1}/${this.currentPlaylist.tracks.length}: ${track.title || track.file}`,
    );

    // Stop current music first
    if (this.currentMusic) {
      this.stopMusic(fadeIn);
    }

    // Increment request ID to invalidate any slow-loading previous tracks
    const requestId = ++this.loadingRequestId;

    let audio: HTMLAudioElement | null = null;
    let audioUrl: string | null = null;

    // 1. Try AssetLoader first (for preloaded/conventional files)
    const audioKey = track.file.replace(/\.[^.]+$/, "");
    const preloadedAudio = AssetLoader.getInstance().getAudio(audioKey);

    if (preloadedAudio) {
      audio = preloadedAudio.cloneNode(true) as HTMLAudioElement;
      audioUrl = preloadedAudio.src;
    } else {
      // 2. Try PK3Loader (streaming from package)
      const pk3 = PK3Loader.getInstance();

      // Try exact path, then music/ subdir
      let finalPath = track.file;
      if (!pk3.hasFile(finalPath)) {
        finalPath = `music/${track.file}`;
      }

      // If PK3Loader doesn't have the file, check PK3Index to find and load the right pk3
      if (!pk3.hasFile(finalPath)) {
        const pk3Index = PK3Index.getInstance();
        const pk3Name = pk3Index.findFile(track.file) || pk3Index.findFile(`music/${track.file}`);
        if (pk3Name) {
          console.log(`[AudioManager] Loading PK3 for music: ${pk3Name}`);
          try {
            await pk3.loadPK3(pk3Name);
          } catch (e) {
            console.error(`[AudioManager] Failed to load PK3: ${pk3Name}`, e);
          }
          // Re-resolve the path after loading
          finalPath = track.file;
          if (!pk3.hasFile(finalPath)) {
            finalPath = `music/${track.file}`;
          }
        }
      }

      if (pk3.hasFile(finalPath)) {
        const blobUrl = await pk3.getFileAsURL(finalPath, "audio/mpeg");
        if (blobUrl) {
          audio = new Audio(blobUrl);
          audioUrl = blobUrl;
        }
      }
    }

    // If a newer request was started while we were awaiting PK3, abort this one
    if (requestId !== this.loadingRequestId) {
      console.log(`[AudioManager] Aborting track load for request ${requestId} (now on ${this.loadingRequestId})`);
      if (audioUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      return;
    }

    if (!audio) {
      console.warn(`[AudioManager] Track audio not found: ${track.file}, trying next track`);
      this.failedTrackAttempts++;
      if (this.failedTrackAttempts >= this.currentPlaylist.tracks.length) {
        console.error(`[AudioManager] All tracks failed to load, stopping playlist`);
        this.isPlayingPlaylist = false;
        this.failedTrackAttempts = 0;
        return;
      }
      this.nextTrack();
      return;
    }

    this.failedTrackAttempts = 0;
    if (audioUrl?.startsWith("blob:")) {
      this.audioBlobUrls.set(audio, audioUrl);
    }

    this.currentMusic = audio;
    this.currentMusic.loop = false;
    this.currentMusic.volume = fadeIn ? 0 : this.musicVolume;

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
  public getCurrentPlaylistInfo(): {
    name: string | null;
    trackIndex: number;
    trackCount: number;
    currentTrack: PlaylistTrack | null;
  } | null {
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

  /**
   * Tear down all audio resources: stop the playlist and music without fading,
   * clear the fade interval, and revoke any outstanding Blob URLs. Call on scene
   * teardown / app shutdown. Safe to call more than once.
   */
  public dispose(): void {
    this.stopPlaylist(false);
    this.stopMusic(false);

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    if (this.fadingOutMusic) {
      this.fadingOutMusic.pause();
      this.fadingOutMusic = null;
    }

    // Revoke any Blob URLs that survived stopMusic (e.g. cached sfx elements).
    for (const blobUrl of this.audioBlobUrls.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.audioBlobUrls.clear();
    this.sfxBackend.dispose();
  }
}
