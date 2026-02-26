# Music System & Playlist Architecture

## Overview

The SHAG engine requires a robust, state-aware music system capable of managing playlists, smoothly transitioning between tracks, and responding to game state changes (Menu -> Game -> Endgame).

Music tracks are distributed within `public/data/washoi_soundtrack.pk3`. We need a unified `AudioManager` that can stream these tracks via the `PK3Loader`, read playlist definitions, and handle automatic playback states.

## Playlist Format

We will define playlists using a simple JSON format (`.playlist.json`). This allows easy parsing and extensibility.

Example `menu.playlist.json`:

```json
{
  "name": "Main Menu Theme",
  "loop": true,
  "shuffle": false,
  "tracks": [
    { "file": "Washiki_Washoi.mp3", "title": "Washiki Washoi" }
  ]
}
```

### Proposed Playlists for Washoi Soundtrack

Given the 5 tracks in `washoi_soundtrack.pk3`, we propose the following playlist distribution:

1. **`menu.playlist.json`**
   - `Washiki_Washoi.mp3`
2. **`game.playlist.json`** (shuffle: true)
   - `Riot_Gun_Pellets_Ruined_My_Noodles.mp3`
   - `Washoi_and_Ramen.mp3`
   - `Ramen_Will_Be_Ours_Washoi!.mp3`
3. **`endgame.playlist.json`**
   - `Endgame_Udon.mp3`

## Architecture & Modifications

### 1. `AudioManager` Enhancements

The `AudioManager` already has a foundational playlist structure, but it needs to be adapted to work seamlessly with the `PK3Loader`.

- **Blob URL Streaming**: Tracks inside a `.pk3` need to be extracted using `PK3Loader.getInstance().getFileAsURL(filename, 'audio/mpeg')` to be playable by the HTML `Audio` element.
- **Playlist Loading**: Instead of `fetch()`, `loadPlaylist()` should extract the JSON definition directly from the `.pk3` via `PK3Loader.getInstance().getFile(path)`.
- **Crossfading / Transitions**: When switching between playlists (e.g., from Menu to Game), the `AudioManager` must cleanly fade out the old playlist before fading in the new one without overlapping.

### 2. Game State Integration

The lifecycle of the music system should mirror the player's session:

- **Initialization**: Upon loading the engine and unlocking the audio context, `AudioManager.startPlaylist('menu')` is triggered.
- **Match Joined**: When `NetworkGameHost.connect()` succeeds or the local player enters the `playing` state, the engine triggers `AudioManager.startPlaylist('game')`.
- **Match Finished**: When the `MatchPhase` transitions to `PostGame` (scoreboard screen), the engine triggers `AudioManager.startPlaylist('endgame')`.
- **Disconnect**: Returning to the main menu resumes the `menu` playlist.

### 3. Loading Sequence

To ensure music works out-of-the-box, the `washoi_soundtrack.pk3` must be loaded early in the pipeline. We will add it to the initial engine package mounts in `AssetLoader.ts` or `Engine.ts` so it is available before the UI requests the `menu` playlist.
