import type { AudioBus } from "@babylonjs/core/AudioV2/abstractAudio/audioBus";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import type { StaticSoundBuffer } from "@babylonjs/core/AudioV2/abstractAudio/staticSoundBuffer";
import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

export interface SfxPlayOptions {
  /** Per-play gain multiplied by the global SFX bus volume. */
  volume?: number;
  /** Maximum simultaneous instances for cached non-spatial sounds. */
  maxInstances?: number;
}

export interface SpatialSfxPlayOptions extends SfxPlayOptions {
  minDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
}

/** A looping sound until `stop()`, as for a map's ambient speaker. */
export interface SfxLoop {
  stop(): void;
}

const SOUND_EXTENSIONS = [".ogg", ".wav", ".mp3"] as const;
const MAX_ACTIVE_SPATIAL_SOUNDS = 48;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function hasAudioExtension(path: string): boolean {
  return /\.(ogg|wav|mp3)$/i.test(path);
}

function isDirectUrl(path: string): boolean {
  return /^(blob:|data:|https?:\/\/|\/)/i.test(path);
}

/**
 * Small Babylon Audio V2 backend for short decoded sound effects.
 *
 * Gameplay owns sound selection and event policy. This engine service owns only
 * browser unlock, the SFX bus, PK3-backed decoded buffers, spatial playback and
 * bounded source lifetime.
 */
export class AudioV2Sfx {
  private engine: AudioEngineV2 | null = null;
  private sfxBus: AudioBus | null = null;
  private scene: Scene | null = null;
  private listenerNode: object | null = null;
  private initPromise: Promise<boolean> | null = null;
  private disposed = false;
  private generation = 0;
  private volume = 0.7;

  private readonly bufferPromises = new Map<string, Promise<StaticSoundBuffer | null>>();
  private readonly soundPromises = new Map<string, Promise<StaticSound | null>>();
  private readonly packageLoads = new Map<string, Promise<void>>();
  private readonly activeSpatialSounds: StaticSound[] = [];
  /** Looping sounds with the volume each was started at, kept until stopped. */
  private readonly loops = new Map<StaticSound, number>();
  private loopsMuted = false;
  private readonly warnedMissing = new Set<string>();

  async init(scene?: Scene): Promise<void> {
    if (scene) this.scene = scene;
    await this.ensureInitialized();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.sfxBus) this.sfxBus.volume = this.volume;
  }

  async unlock(): Promise<void> {
    if (!(await this.ensureInitialized()) || !this.engine) return;
    await this.engine.unlockAsync();
  }

  async preload(paths: readonly string[]): Promise<void> {
    if (!(await this.ensureInitialized())) return;
    await Promise.all(paths.map((path) => this.getBuffer(path)));
  }

  async play2D(path: string, options: SfxPlayOptions = {}): Promise<boolean> {
    if (!(await this.ensureInitialized()) || !this.engine || !this.sfxBus) return false;

    const key = normalizePath(path);
    let soundPromise = this.soundPromises.get(key);
    if (!soundPromise) {
      const generation = this.generation;
      soundPromise = this.getBuffer(path).then(async (buffer) => {
        if (!buffer || generation !== this.generation || !this.engine || !this.sfxBus) return null;
        return this.engine.createSoundAsync(`sfx:${key}`, buffer, {
          outBus: this.sfxBus,
          maxInstances: options.maxInstances ?? 8,
        });
      });
      this.soundPromises.set(key, soundPromise);
    }

    const sound = await soundPromise;
    if (!sound || this.disposed) return false;
    sound.play({ volume: Math.max(0, options.volume ?? 1) });
    return true;
  }

  async play3D(path: string, position: Vector3, options: SpatialSfxPlayOptions = {}): Promise<boolean> {
    if (!(await this.ensureInitialized()) || !this.engine || !this.sfxBus) return false;
    this.syncListener();

    const generation = this.generation;
    const buffer = await this.getBuffer(path);
    if (!buffer || generation !== this.generation || !this.engine || !this.sfxBus) return false;

    const sound = await this.engine.createSoundAsync(`spatial:${normalizePath(path)}`, buffer, {
      outBus: this.sfxBus,
      maxInstances: 1,
      spatialEnabled: true,
      spatialPosition: position,
      spatialDistanceModel: "linear",
      spatialMinDistance: options.minDistance ?? 96,
      spatialMaxDistance: options.maxDistance ?? 2400,
      spatialRolloffFactor: options.rolloffFactor ?? 1,
    });

    if (generation !== this.generation || this.disposed) {
      sound.dispose();
      return false;
    }

    this.activeSpatialSounds.push(sound);
    while (this.activeSpatialSounds.length > MAX_ACTIVE_SPATIAL_SOUNDS) {
      this.activeSpatialSounds.shift()?.dispose();
    }

    sound.onEndedObservable.addOnce(() => this.releaseSpatialSound(sound));
    sound.play({ volume: Math.max(0, options.volume ?? 1) });
    return true;
  }

  /**
   * Loop `path` at an engine-world position until the returned handle stops it,
   * or play it everywhere at once when `position` is null. Resolves to null when
   * the sound cannot play (no audio, missing file); a handle stopped before the
   * sound has loaded never starts it.
   */
  async playLoop3D(
    path: string,
    position: Vector3 | null,
    options: SpatialSfxPlayOptions = {},
  ): Promise<SfxLoop | null> {
    if (!(await this.ensureInitialized()) || !this.engine || !this.sfxBus) return null;
    this.syncListener();

    const generation = this.generation;
    const buffer = await this.getBuffer(path);
    if (!buffer || generation !== this.generation || !this.engine || !this.sfxBus) return null;

    const volume = Math.max(0, options.volume ?? 1);
    const sound = await this.engine.createSoundAsync(`loop:${normalizePath(path)}`, buffer, {
      outBus: this.sfxBus,
      loop: true,
      maxInstances: 1,
      ...(position
        ? {
            spatialEnabled: true,
            spatialPosition: position,
            spatialDistanceModel: "linear" as const,
            spatialMinDistance: options.minDistance ?? 96,
            spatialMaxDistance: options.maxDistance ?? 2400,
            spatialRolloffFactor: options.rolloffFactor ?? 1,
          }
        : {}),
    });
    if (generation !== this.generation || this.disposed) {
      sound.dispose();
      return null;
    }

    this.loops.set(sound, volume);
    sound.play({ volume: this.loopsMuted ? 0 : volume });
    return {
      stop: () => {
        if (!this.loops.delete(sound)) return;
        sound.stop();
        sound.dispose();
      },
    };
  }

  /** Silence or restore every running loop without stopping them; SFX off mutes them. */
  setLoopsMuted(muted: boolean): void {
    this.loopsMuted = muted;
    for (const [sound, volume] of this.loops) sound.volume = muted ? 0 : volume;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;

    for (const sound of this.activeSpatialSounds.splice(0)) sound.dispose();
    for (const sound of this.loops.keys()) sound.dispose();
    this.loops.clear();
    this.soundPromises.clear();
    this.bufferPromises.clear();
    this.packageLoads.clear();
    this.warnedMissing.clear();
    this.listenerNode = null;
    this.sfxBus = null;
    this.engine?.dispose();
    this.engine = null;
    this.initPromise = null;
    this.scene = null;
  }

  private async ensureInitialized(): Promise<boolean> {
    if (this.disposed || this.engine) return !this.disposed && !!this.engine;
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return false;

    if (!this.initPromise) {
      const generation = this.generation;
      this.initPromise = (async () => {
        try {
          const engine = await CreateAudioEngineAsync({
            disableDefaultUI: true,
            resumeOnInteraction: true,
            listenerEnabled: true,
          });
          if (generation !== this.generation || this.disposed) {
            engine.dispose();
            return false;
          }
          const bus = await engine.createBusAsync("sfx", { volume: this.volume });
          if (generation !== this.generation || this.disposed) {
            bus.dispose();
            engine.dispose();
            return false;
          }
          this.engine = engine;
          this.sfxBus = bus;
          this.syncListener();
          console.log("[AudioManager] Babylon Audio V2 SFX backend ready");
          return true;
        } catch (error) {
          console.warn("[AudioManager] Babylon Audio V2 unavailable:", error);
          this.initPromise = null;
          return false;
        }
      })();
    }
    return this.initPromise;
  }

  private syncListener(): void {
    if (!this.engine) return;
    const scene = this.scene ?? EngineStore.LastCreatedScene;
    const camera = scene?.activeCamera ?? null;
    if (!camera || camera === this.listenerNode) return;
    this.engine.listener.attach(camera);
    this.listenerNode = camera;
  }

  private async getBuffer(path: string): Promise<StaticSoundBuffer | null> {
    const key = normalizePath(path);
    const existing = this.bufferPromises.get(key);
    if (existing) return existing;

    const loading = this.loadBuffer(path).then((buffer) => {
      // Missing assets may become available after another PK3 is indexed/loaded.
      if (!buffer) this.bufferPromises.delete(key);
      return buffer;
    });
    this.bufferPromises.set(key, loading);
    return loading;
  }

  private async loadBuffer(path: string): Promise<StaticSoundBuffer | null> {
    if (!this.engine) return null;
    try {
      if (isDirectUrl(path)) return await this.engine.createSoundBufferAsync(path);

      const candidates = hasAudioExtension(path)
        ? [normalizePath(path)]
        : SOUND_EXTENSIONS.map((extension) => `${normalizePath(path)}${extension}`);
      const loader = PK3Loader.getInstance();

      for (const candidate of candidates) {
        if (!loader.hasFile(candidate)) {
          const packageName = PK3Index.getInstance().findFile(candidate);
          if (packageName) await this.loadPackage(packageName);
        }
        const bytes = await loader.getFile(candidate);
        if (bytes) return await this.engine.createSoundBufferAsync(bytes);
      }
    } catch (error) {
      console.warn(`[AudioManager] Failed to decode SFX '${path}':`, error);
      return null;
    }

    const key = normalizePath(path);
    if (!this.warnedMissing.has(key)) {
      this.warnedMissing.add(key);
      console.warn(`[AudioManager] SFX not found in PK3 index: ${path}`);
    }
    return null;
  }

  private async loadPackage(packageName: string): Promise<void> {
    let promise = this.packageLoads.get(packageName);
    if (!promise) {
      promise = PK3Loader.getInstance()
        .loadPK3(packageName)
        .catch((error) => {
          this.packageLoads.delete(packageName);
          throw error;
        });
      this.packageLoads.set(packageName, promise);
    }
    await promise;
  }

  private releaseSpatialSound(sound: StaticSound): void {
    const index = this.activeSpatialSounds.indexOf(sound);
    if (index >= 0) this.activeSpatialSounds.splice(index, 1);
    sound.dispose();
  }
}
