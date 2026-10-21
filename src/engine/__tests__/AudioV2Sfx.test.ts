import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let bufferSeconds = 1;
const createdSounds: Array<{
  play: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onEndedObservable: { addOnce: ReturnType<typeof vi.fn> };
}> = [];
const engine = {
  createBusAsync: vi.fn(async (name: string, options?: { volume?: number; outBus?: unknown }) => ({
    name,
    volume: options?.volume ?? 1,
    outBus: options?.outBus,
    dispose: vi.fn(),
  })),
  createSoundBufferAsync: vi.fn(async () => ({ duration: bufferSeconds })),
  createSoundAsync: vi.fn(async (_name: string, _source: unknown, _options?: Record<string, unknown>) => {
    const sound = { play: vi.fn(), dispose: vi.fn(), onEndedObservable: { addOnce: vi.fn() } };
    createdSounds.push(sound);
    return sound;
  }),
  unlockAsync: vi.fn(async () => {}),
  dispose: vi.fn(),
  listener: {
    isAttached: false,
    attach: vi.fn(function (this: { isAttached: boolean }, node: unknown) {
      this.isAttached = !!node;
    }),
  },
};

vi.mock("@babylonjs/core/AudioV2/webAudio/webAudioEngine", () => ({
  CreateAudioEngineAsync: vi.fn(async () => engine),
}));

let packageLoaded = false;
const loader = {
  hasFile: vi.fn(() => packageLoaded),
  loadPK3: vi.fn(async () => {
    packageLoaded = true;
  }),
  getFile: vi.fn(async () => (packageLoaded ? new ArrayBuffer(8) : null)),
};

vi.mock("../loader/pk3/PK3Loader", () => ({
  PK3Loader: { getInstance: () => loader },
}));
vi.mock("../loader/pk3/PK3Index", () => ({
  PK3Index: { getInstance: () => ({ findFile: () => "data0.pk3" }) },
}));

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Attenuation, AudioV2Sfx } from "../audio/AudioV2Sfx";

describe("AudioV2Sfx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdSounds.length = 0;
    packageLoaded = false;
    vi.stubGlobal("window", {});
    vi.stubGlobal("AudioContext", class {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads an indexed PK3 once, shares decoded buffers, and separates 2D from spatial sources", async () => {
    const audio = new AudioV2Sfx();
    await audio.init();
    await audio.preload(["sounds/weapons/rocket_fire_strong.ogg", "sounds/weapons/rocket_fire_strong.ogg"]);

    expect(loader.loadPK3).toHaveBeenCalledTimes(1);
    expect(engine.createSoundBufferAsync).toHaveBeenCalledTimes(1);

    await audio.play2D("sounds/weapons/rocket_fire_strong.ogg");
    await audio.play2D("sounds/weapons/rocket_fire_strong.ogg");
    expect(engine.createSoundAsync).toHaveBeenCalledTimes(1);
    expect(createdSounds[0].play).toHaveBeenCalledTimes(2);

    await audio.play3D("sounds/weapons/rocket_fire_strong.ogg", new Vector3(1, 2, 3));
    await audio.play3D("sounds/weapons/rocket_fire_strong.ogg", new Vector3(4, 5, 6));
    expect(engine.createSoundAsync).toHaveBeenCalledTimes(3);
    expect(engine.createSoundBufferAsync).toHaveBeenCalledTimes(1);

    const spatialOptions = engine.createSoundAsync.mock.calls[1][2];
    expect(spatialOptions).toMatchObject({
      spatialEnabled: true,
      spatialDistanceModel: "inverse",
      spatialMinDistance: 125,
      spatialRolloffFactor: Attenuation.Normal,
    });

    audio.dispose();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it("routes each channel through its own bus into the effects bus", async () => {
    const audio = new AudioV2Sfx();
    await audio.init();
    const buses = await Promise.all(engine.createBusAsync.mock.results.map((r) => r.value));
    const sfx = buses.find((bus) => bus.name === "sfx");
    const hits = buses.find((bus) => bus.name === "sfx-hits");
    expect(hits?.outBus).toBe(sfx);

    await audio.play2D("hit.wav", { channel: "hits" });
    await audio.play3D("step.ogg", new Vector3(), { channel: "players" });
    const outBuses = engine.createSoundAsync.mock.calls.map(
      ([, , options]) => (options!.outBus as { name: string }).name,
    );
    expect(outBuses).toEqual(["sfx-hits", "sfx-players"]);

    audio.setChannelVolume("hits", 0.25);
    expect(hits?.volume).toBe(0.25);
    audio.dispose();
  });

  it("cuts a slot's last sound when the next one starts", async () => {
    const audio = new AudioV2Sfx();
    await audio.init();
    await audio.play3D("pain.ogg", new Vector3(), { slot: "p1:pain" });
    await audio.play3D("pain.ogg", new Vector3(), { slot: "p2:pain" });
    await audio.play3D("death.ogg", new Vector3(), { slot: "p1:pain" });
    expect(createdSounds.map((sound) => sound.dispose.mock.calls.length)).toEqual([1, 0, 0]);
    audio.dispose();
  });

  it("over the cap, cuts the sound nearest its end", async () => {
    const audio = new AudioV2Sfx();
    await audio.init();
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    bufferSeconds = 3;
    await audio.play3D("explosion.ogg", new Vector3());
    bufferSeconds = 0.3;
    for (let i = 1; i <= 48; i++) {
      now.mockReturnValue(i);
      await audio.play3D("step.ogg", new Vector3());
    }
    // The explosion started first but ends last; the first step ends soonest
    expect(createdSounds[0].dispose).not.toHaveBeenCalled();
    expect(createdSounds[1].dispose).toHaveBeenCalledOnce();
    now.mockRestore();
    bufferSeconds = 1;
    audio.dispose();
  });

  it("fades by attenuation class on the inverse curve", async () => {
    const audio = new AudioV2Sfx();
    await audio.init();
    await audio.play3D("a.ogg", new Vector3(), { attenuation: Attenuation.Static });
    await audio.play3D("a.ogg", new Vector3(), { attenuation: Attenuation.None });
    const rolloffs = engine.createSoundAsync.mock.calls.map(([, , options]) => options?.spatialRolloffFactor);
    expect(rolloffs).toEqual([5, 0]);
    audio.dispose();
  });

  it("keeps the listener on the view camera, not the weapon camera drawn after it", async () => {
    const scene = { onBeforeRenderObservable: new Observable(), activeCameras: [] as object[], activeCamera: null };
    const audio = new AudioV2Sfx();
    await audio.init(scene as never);
    const eye = { name: "eye" };
    scene.activeCameras = [eye, { name: "weapon" }];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(engine.listener.attach).toHaveBeenLastCalledWith(eye);

    // A replaced camera is followed on the next frame, with no sound played
    const respawned = { name: "eye after respawn" };
    scene.activeCameras = [respawned];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(engine.listener.attach).toHaveBeenLastCalledWith(respawned);
    audio.dispose();
    expect(scene.onBeforeRenderObservable.hasObservers()).toBe(false);
  });
});
