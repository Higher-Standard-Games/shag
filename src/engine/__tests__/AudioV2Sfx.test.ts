import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buffer = { duration: 1 };
const createdSounds: Array<{
  play: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onEndedObservable: { addOnce: ReturnType<typeof vi.fn> };
}> = [];
const engine = {
  createBusAsync: vi.fn(async () => ({ volume: 0.7, dispose: vi.fn() })),
  createSoundBufferAsync: vi.fn(async () => buffer),
  createSoundAsync: vi.fn(async (_name: string, _source: unknown, _options?: Record<string, unknown>) => {
    const sound = { play: vi.fn(), dispose: vi.fn(), onEndedObservable: { addOnce: vi.fn() } };
    createdSounds.push(sound);
    return sound;
  }),
  unlockAsync: vi.fn(async () => {}),
  dispose: vi.fn(),
  listener: { attach: vi.fn() },
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
import { AudioV2Sfx } from "../audio/AudioV2Sfx";

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
      spatialDistanceModel: "linear",
      spatialMinDistance: 96,
      spatialMaxDistance: 2400,
    });

    audio.dispose();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
});
