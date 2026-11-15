// @vitest-environment jsdom
/**
 * Switching playlists (the campaign page's music over the menus'): the one
 * left fades out and pauses where it is, and switching back carries it on from
 * there without loading its track again. The newest request wins over one
 * still loading.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../AudioManager";
import { Cvar } from "../core/Cvar";

type Inside = {
  readPlaylist: (url: string) => Promise<unknown>;
  playCurrentTrack: () => Promise<void>;
  currentMusic: unknown;
};

const MENU = "data/menu.playlist.json";
const CAMPAIGN = "data/campaign.playlist.json";

/** A stand-in track: where it is, and whether it plays. */
function track() {
  return {
    volume: 0.5,
    currentTime: 42,
    paused: false,
    loop: false,
    src: "blob:x",
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
  };
}

let audio: AudioManager;
let inside: Inside;
const tracks: Record<string, ReturnType<typeof track>> = {};

beforeEach(() => {
  vi.useFakeTimers();
  Cvar.init();
  AudioManager.resetInstance();
  audio = AudioManager.getInstance();
  inside = audio as unknown as Inside;
  vi.spyOn(inside, "readPlaylist").mockImplementation(async (url) => ({
    name: url,
    loop: true,
    tracks: [{ file: `${url}.mp3` }],
  }));
  // Starting a playlist from its top makes a track of its own
  vi.spyOn(inside, "playCurrentTrack").mockImplementation(async () => {
    const name = audio.getCurrentPlaylistName() ?? "";
    tracks[name] = track();
    inside.currentMusic = tracks[name];
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("switching playlists", () => {
  it("pauses the one left where it is, and carries it on from there on the way back", async () => {
    await audio.switchPlaylist(MENU);
    const menu = tracks[MENU];
    expect(audio.getCurrentPlaylistName()).toBe(MENU);

    await audio.switchPlaylist(CAMPAIGN);
    expect(audio.getCurrentPlaylistName()).toBe(CAMPAIGN);
    vi.advanceTimersByTime(3000); // the fade out
    expect(menu.pause).toHaveBeenCalled();
    expect(menu.src).toBe("blob:x"); // paused, not stopped

    const starts = vi.mocked(inside.playCurrentTrack).mock.calls.length;
    await audio.switchPlaylist(MENU);
    // The same track again, from where it paused: nothing loaded
    expect(vi.mocked(inside.playCurrentTrack).mock.calls.length).toBe(starts);
    expect(inside.currentMusic).toBe(menu);
    expect(menu.play).toHaveBeenCalled();
    expect(menu.currentTime).toBe(42);
    vi.advanceTimersByTime(3000);
    expect(tracks[CAMPAIGN].pause).toHaveBeenCalled();
  });

  it("does not pause a track switched back to while it was still fading out", async () => {
    await audio.switchPlaylist(MENU);
    const menu = tracks[MENU];
    await audio.switchPlaylist(CAMPAIGN);
    vi.advanceTimersByTime(100); // part way out
    await audio.switchPlaylist(MENU);
    menu.pause.mockClear();
    vi.advanceTimersByTime(3000);
    expect(menu.pause).not.toHaveBeenCalled();
  });

  it("lets the newest request win over a playlist still loading", async () => {
    let release: (value: unknown) => void = () => {};
    vi.mocked(inside.readPlaylist).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const slow = audio.loadPlaylist(MENU);
    await audio.switchPlaylist(CAMPAIGN);
    release({ name: MENU, tracks: [{ file: "menu.mp3" }] });
    await slow;
    expect(audio.getCurrentPlaylistName()).toBe(CAMPAIGN);
  });
});
