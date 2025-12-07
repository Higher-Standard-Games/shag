import { AssetLoader } from "./AssetLoader";

export class AudioManager {
  private static instance: AudioManager;

  private currentMusic: HTMLAudioElement | null = null;
  private musicVolume = 0.5;
  private musicEnabled = true;
  private fadeInterval: number | null = null;

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

  public playMusic(key: string, loop = true, fadeIn = true): void {
    if (!this.musicEnabled) return;

    const audio = AssetLoader.getInstance().getAudio(key);
    if (!audio) {
      console.warn(`Audio not found: ${key}`);
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
    if (!this.currentMusic) return;

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    const musicToFade = this.currentMusic;
    this.currentMusic = null;

    this.fadeInterval = window.setInterval(() => {
      if (musicToFade.volume > 0.02) {
        musicToFade.volume -= 0.02;
      } else {
        musicToFade.pause();
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
}
