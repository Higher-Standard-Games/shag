// @vitest-environment jsdom
/**
 * A track's end moves its playlist on only while it is the one playing: a
 * track put aside by a playlist switch, still fading out, may reach its end
 * and must not skip the music that replaced it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLoader } from "../AssetLoader";
import { AudioManager } from "../AudioManager";
import { Cvar } from "../core/Cvar";

type Inside = {
  readPlaylist: (url: string) => Promise<unknown>;
  currentMusic: HTMLAudioElement | null;
  currentTrackIndex: number;
};

const MENU = "data/menu.playlist.json";
const CAMPAIGN = "data/campaign.playlist.json";

beforeEach(() => {
  vi.useFakeTimers();
  Cvar.init();
  AudioManager.resetInstance();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // Every track is preloaded: a fresh audio element of its own
  vi.spyOn(AssetLoader.getInstance(), "getAudio").mockImplementation((key: string) => {
    const element = new Audio();
    element.dataset.track = key;
    return element;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a track's end", () => {
  it("leaves the new playlist alone when the track put aside ends during its fade", async () => {
    const audio = AudioManager.getInstance();
    const inside = audio as unknown as Inside;
    vi.spyOn(inside, "readPlaylist").mockImplementation(async (url) => ({
      name: url,
      loop: true,
      tracks: [{ file: `${url}-1.mp3` }, { file: `${url}-2.mp3` }],
    }));
    await audio.switchPlaylist(MENU);
    await vi.advanceTimersByTimeAsync(0);
    const menuTrack = inside.currentMusic!;
    expect(menuTrack).not.toBeNull();

    await audio.switchPlaylist(CAMPAIGN);
    await vi.advanceTimersByTimeAsync(0);
    const campaignTrack = inside.currentMusic;
    expect(campaignTrack).not.toBe(menuTrack);

    // The menu's track runs out while it fades
    menuTrack.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(0);
    expect(inside.currentTrackIndex).toBe(0);
    expect(inside.currentMusic).toBe(campaignTrack);

    // The campaign's own track still moves its playlist on
    campaignTrack!.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(0);
    expect(inside.currentTrackIndex).toBe(1);
  });
});
