import type { AudioBus } from "@babylonjs/core/AudioV2/abstractAudio/audioBus";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import type { StaticSoundBuffer } from "@babylonjs/core/AudioV2/abstractAudio/staticSoundBuffer";
import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { waitForAsync } from "../core/AsyncWait";
import { devLog } from "../core/DevLog";
import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";

/**
 * The mix a sound belongs to, each with its own volume under the effects
 * volume, as Warsow's: hit confirmations and the announcer can then stay
 * clear of everything else.
 */
export type SfxChannel = "effects" | "players" | "hits" | "announcer";
export const SFX_CHANNELS: readonly SfxChannel[] = ["effects", "players", "hits", "announcer"];

export interface SfxPlayOptions {
  /** Per-play gain multiplied by the channel's and the effects volume. */
  volume?: number;
  /** Maximum simultaneous instances for cached non-spatial sounds. */
  maxInstances?: number;
  /** Effects when absent. */
  channel?: SfxChannel;
}

/**
 * How fast a sound fades with distance, Quake's attenuation classes. On the
 * inverse curve below, a Normal sound is at half volume 250 units away and an
 * eighth at 1000; None plays at full volume everywhere.
 */
export const Attenuation = {
  None: 0,
  Distant: 0.5,
  Normal: 1,
  Idle: 2.5,
  Static: 5,
  Whisper: 10,
} as const;

export interface SpatialSfxPlayOptions extends SfxPlayOptions {
  /** An `Attenuation` class, or a map's own value; Normal when absent. */
  attenuation?: number;
  /**
   * One sound at a time per slot, as Quake's entity channels: a new sound in
   * a player's pain slot cuts the last instead of playing over it.
   */
  slot?: string;
}

/** A looping sound until `stop()`, as for a map's ambient speaker. */
export interface SfxLoop {
  stop(): void;
}

const SOUND_EXTENSIONS = [".ogg", ".wav", ".mp3"] as const;
const MAX_ACTIVE_SPATIAL_SOUNDS = 48;
/**
 * gain = REFERENCE / (REFERENCE + attenuation * (distance - REFERENCE)), full
 * volume inside REFERENCE: WebAudio's inverse model with the attenuation as its
 * rolloff. The far distance only matters to a linear model; it is kept at the
 * one the curve was tuned with.
 */
const REFERENCE_DISTANCE = 125;
const FAR_DISTANCE = 8000;

function spatialOptions(position: Vector3, options: SpatialSfxPlayOptions) {
  return {
    spatialEnabled: true,
    spatialPosition: position,
    spatialDistanceModel: "inverse" as const,
    spatialMinDistance: REFERENCE_DISTANCE,
    spatialMaxDistance: FAR_DISTANCE,
    spatialRolloffFactor: Math.max(0, options.attenuation ?? Attenuation.Normal),
  };
}

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
  private readonly channelBuses = new Map<SfxChannel, AudioBus>();
  private readonly channelVolumes: Record<SfxChannel, number> = { effects: 1, players: 1, hits: 1, announcer: 1 };
  private scene: Scene | null = null;
  private listenerNode: object | null = null;
  private listenerScene: Scene | null = null;
  private listenerObserver: Observer<Scene> | null = null;
  private initPromise: Promise<boolean> | null = null;
  private disposed = false;
  private generation = 0;
  private volume = 1;
  private muted = false;
  private playbackEpoch = 0;

  private readonly bufferPromises = new Map<string, Promise<StaticSoundBuffer | null>>();
  private readonly soundPromises = new Map<string, Promise<StaticSound | null>>();
  /** Playing 3D one-shots, with when each ends (ms, `performance.now`). */
  private readonly activeSpatialSounds: Array<{ sound: StaticSound; endsAt: number; slot?: string }> = [];
  /** Looping sounds with the volume each was started at, kept until stopped. */
  private readonly loops = new Map<StaticSound, number>();
  private loopsMuted = false;
  private readonly warnedMissing = new Set<string>();

  async init(scene?: Scene): Promise<void> {
    if (scene) this.scene = scene;
    await this.ensureInitialized();
    this.followView();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.sfxBus) this.sfxBus.volume = this.muted ? 0 : this.volume;
  }

  /** Temporary silence preserves the mix; pending one-shots cannot play afterward. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.playbackEpoch++;
    if (this.sfxBus) this.sfxBus.volume = muted ? 0 : this.volume;
  }

  setChannelVolume(channel: SfxChannel, volume: number): void {
    this.channelVolumes[channel] = Math.max(0, Math.min(1, volume));
    const bus = this.channelBuses.get(channel);
    if (bus) bus.volume = this.channelVolumes[channel];
  }

  private busFor(channel: SfxChannel | undefined): AudioBus | null {
    return this.channelBuses.get(channel ?? "effects") ?? this.sfxBus;
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
    if (this.muted) return false;
    const epoch = this.playbackEpoch;
    if (!(await this.ensureInitialized()) || !this.engine || !this.sfxBus) return false;

    // A sound's bus is fixed when it is made, so each channel has its own
    const channel = options.channel ?? "effects";
    const key = `${channel}:${normalizePath(path)}`;
    let soundPromise = this.soundPromises.get(key);
    if (!soundPromise) {
      const generation = this.generation;
      soundPromise = this.getBuffer(path).then(async (buffer) => {
        const outBus = this.busFor(channel);
        if (!buffer || generation !== this.generation || !this.engine || !outBus) return null;
        return this.engine.createSoundAsync(`sfx:${key}`, buffer, {
          outBus,
          maxInstances: options.maxInstances ?? 8,
        });
      });
      this.soundPromises.set(key, soundPromise);
    }

    const sound = await soundPromise;
    if (!sound || this.disposed || this.muted || epoch !== this.playbackEpoch) return false;
    sound.play({ volume: Math.max(0, options.volume ?? 1) });
    return true;
  }

  async play3D(path: string, position: Vector3, options: SpatialSfxPlayOptions = {}): Promise<boolean> {
    if (this.muted) return false;
    const epoch = this.playbackEpoch;
    if (!(await this.ensureInitialized()) || !this.engine || !this.sfxBus) return false;
    this.syncListener();

    const generation = this.generation;
    const buffer = await this.getBuffer(path);
    if (!buffer || generation !== this.generation || !this.engine || !this.sfxBus) return false;

    const sound = await this.engine.createSoundAsync(`spatial:${normalizePath(path)}`, buffer, {
      outBus: this.busFor(options.channel) ?? this.sfxBus,
      maxInstances: 1,
      ...spatialOptions(position, options),
    });

    if (generation !== this.generation || this.disposed || this.muted || epoch !== this.playbackEpoch) {
      sound.dispose();
      return false;
    }

    if (options.slot) {
      const previous = this.activeSpatialSounds.find((active) => active.slot === options.slot);
      if (previous) this.releaseSpatialSound(previous.sound);
    }
    this.activeSpatialSounds.push({ sound, endsAt: performance.now() + buffer.duration * 1000, slot: options.slot });
    // Over the cap, cut the sound nearest its end: a footstep's last moment
    // before an explosion's long tail.
    while (this.activeSpatialSounds.length > MAX_ACTIVE_SPATIAL_SOUNDS) {
      const nearestEnd = this.activeSpatialSounds.reduce((a, b) => (b.endsAt < a.endsAt ? b : a));
      this.releaseSpatialSound(nearestEnd.sound);
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
      outBus: this.busFor(options.channel) ?? this.sfxBus,
      loop: true,
      maxInstances: 1,
      ...(position ? spatialOptions(position, options) : {}),
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

    for (const { sound } of this.activeSpatialSounds.splice(0)) sound.dispose();
    for (const sound of this.loops.keys()) sound.dispose();
    this.loops.clear();
    this.soundPromises.clear();
    this.bufferPromises.clear();
    this.warnedMissing.clear();
    this.stopFollowingView();
    this.listenerNode = null;
    for (const channelBus of this.channelBuses.values()) channelBus.dispose();
    this.channelBuses.clear();
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
          const bus = await engine.createBusAsync("sfx", { volume: this.muted ? 0 : this.volume });
          if (generation !== this.generation || this.disposed) {
            bus.dispose();
            engine.dispose();
            return false;
          }
          for (const channel of SFX_CHANNELS) {
            const channelBus = await engine.createBusAsync(`sfx-${channel}`, {
              volume: this.channelVolumes[channel],
              outBus: bus,
            });
            this.channelBuses.set(channel, channelBus);
          }
          if (generation !== this.generation || this.disposed) {
            for (const channelBus of this.channelBuses.values()) channelBus.dispose();
            this.channelBuses.clear();
            bus.dispose();
            engine.dispose();
            return false;
          }
          this.engine = engine;
          this.sfxBus = bus;
          bus.volume = this.muted ? 0 : this.volume;
          this.followView();
          this.syncListener();
          devLog("[AudioManager] Babylon Audio V2 SFX backend ready");
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

  /**
   * Keep the listener on the view every frame. Attaching only when a sound
   * played left it on a camera that had since been replaced — a respawn,
   * spectating, a demo — so the next sounds were placed against where that
   * camera last stood.
   */
  private followView(): void {
    const scene = this.scene ?? EngineStore.LastCreatedScene;
    if (!scene || scene === this.listenerScene) return;
    this.stopFollowingView();
    this.listenerScene = scene;
    this.listenerObserver = scene.onBeforeRenderObservable.add(() => this.syncListener());
  }

  private stopFollowingView(): void {
    if (this.listenerScene && this.listenerObserver)
      this.listenerScene.onBeforeRenderObservable.remove(this.listenerObserver);
    this.listenerScene = null;
    this.listenerObserver = null;
  }

  /** The eye: the first of several cameras (the weapon draws second), or the one. */
  private syncListener(): void {
    if (!this.engine) return;
    const scene = this.listenerScene ?? this.scene ?? EngineStore.LastCreatedScene;
    const camera = (scene?.activeCameras?.length ? scene.activeCameras[0] : scene?.activeCamera) ?? null;
    if (!camera || (camera === this.listenerNode && this.engine.listener.isAttached)) return;
    this.engine.listener.attach(camera);
    this.listenerNode = camera;
  }

  private async getBuffer(path: string): Promise<StaticSoundBuffer | null> {
    const key = normalizePath(path);
    const existing = this.bufferPromises.get(key);
    if (existing) return existing;

    const generation = this.generation;
    let active = true;
    const work = this.loadBuffer(path).then((buffer) => {
      if (!active || generation !== this.generation || this.disposed) {
        return null;
      }
      return buffer;
    });
    const loading = waitForAsync(work, undefined, 30000, `sound ${key}`)
      .catch((error: unknown) => {
        console.warn(`[AudioManager] Sound preparation failed: ${key}`, error);
        return null;
      })
      .then((buffer) => {
        active = false;
        // Missing assets may become available after another PK3 is indexed/loaded.
        if (!buffer && this.bufferPromises.get(key) === loading) this.bufferPromises.delete(key);
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
    await PK3Loader.getInstance().ensurePK3(packageName);
  }

  private releaseSpatialSound(sound: StaticSound): void {
    const index = this.activeSpatialSounds.findIndex((active) => active.sound === sound);
    if (index < 0) return;
    this.activeSpatialSounds.splice(index, 1);
    sound.dispose();
  }
}
