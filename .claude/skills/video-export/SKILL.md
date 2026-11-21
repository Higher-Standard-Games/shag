---
name: video-export
description: Render a SHAG demo to an MP4 without a person at the keyboard - a highlight reel (1, 2 or 3 minutes) or a full match through one player's eyes with the game HUD, with or without an OST song - by driving the real video export page in headless Edge, and fetch the demo from a production lobby first if needed. Use this whenever the user asks to "dump", "export", "render" or "make a video/movie" of a demo or match, for highlight movies with a soundtrack, for a full-match video "from my perspective", or to grab a demo from EU or US production.
---

# Video export, unattended

The export page (`?videoexport=1`, `client/video/ExportPage.ts`) is what players
use from **Export video**. `scripts/export-video.mjs` drives that same page in
headless Edge: it loads the demo, sets the options a player would set, presses
**Generate video**, waits, and copies the finished MP4 out of the browser. The
movie is therefore exactly what a player would download. The game manual's
[Video export](../../../src/games/fps/docs/manual/multiplayer/demos.md#video-export)
section is the reference for what each option does.

## 1. Get the demo

Exports read the demo from `public/data/demos/` (git-ignored).

**From production.** Demos are on the hosts, not served over HTTP; use SSH
(the owner's key works non-interactively). EU is `root@washoi.net`, US is
`root@us.washoi.net`. Live recordings are in `/srv/washoi/assets/data/demos/`;
`/srv/washoi/backups/demos-pre-*` hold older releases' demos.

```bash
ssh root@washoi.net 'ls -lt /srv/washoi/assets/data/demos/*.shagdemo | head'
scp root@washoi.net:/srv/washoi/assets/data/demos/<file>.shagdemo public/data/demos/
```

File names are `<map>_<mode>_<YYYYMMDD>_<HHMMSS>.shagdemo` in the host's time
(UTC). Match a lobby card ("FFA · 5", the map, "10m ago") by mode, map and
time; the size gives the length away too (a 10-minute 5-player FFA is about
10 MB). Only read on the hosts: never write or delete there for an export.

## 2. Start a private server

```bash
node C:/Users/sundf/Desktop/wash/shag/.claude/skills/browser-probe/scripts/private-vite.mjs 3100   # background
```

It serves the checked-out code as it was when it started. For a video the
owner will share, render from the released code (`main`), or say which branch
it came from.

## 3. Render

```bash
S=.claude/skills/video-export/scripts/export-video.mjs
# 1-minute highlights over a song's last minute
node $S --demo <file>.shagdemo --kind reel --minutes 1 --song boss_fight --start last:60 --out C:/Users/sundf/Videos/Washoi/<name>.mp4
# 3-minute highlights over a song from its start
node $S --demo <file>.shagdemo --kind reel --minutes 3 --song noodlesoup --out ...
# Full match through one player's eyes, with the HUD; the song first, then the game's playlist
node $S --demo <file>.shagdemo --kind match --follow sundflux --song boss_fight --out ...
```

- `--song` matches part of the song's file name or title, case-insensitively
  (`boss_fight`, `noodlesoup`). The songs are the OST and campaign packages'
  MP3s (`washoi_soundtrack.pk3`, `washoi_campaign_soundtrack.pk3`).
- `--start` takes seconds or `m:ss(.mmm)`; `last:60` starts the song 60 seconds
  before its end and logs the song's length.
- **A highlight movie is not its target length.** The reel picks whole scenes,
  so a "1 minute" movie can run 50 seconds, and the music stops with the
  picture. To end on the song's ending, render once, read the movie's duration
  from the log's `mp4:` line, and render again with `--start` = song length −
  movie duration (a different start moves the beat cuts by a fraction of a
  second, so the length barely changes). Example: Boss Fight is 3:33.56 and a
  50.45 s movie fits from `2:43.0`.
- `--follow` matches the start of a player's name in the recording's roster.
- Run one export at a time: each holds a headless Edge (about 1-2 GB while
  rendering) and the GPU.

Run it in the background and watch its log; it prints the status line as it
changes (preparing the song, the reel timeline, rendering, mixing), the MP4's
duration and tracks at the end, and any page errors.

## How long it takes

- A highlight movie renders twice (a 320x180 timing pass, then 1080p): a
  50-second movie took 2 minutes on the owner's machine, copy included.
- A 3-minute target (a 2:39 movie) took 6 minutes.
- A full match took 25 minutes for a 10-minute FFA (36,300 frames at about
  28 a second, then 42 pieces of audio mix and a one-minute copy of the
  876 MB file). The Edge renderer process sat near 7 GB throughout while the
  JS heap stayed near 830 MB; free memory went down to about 800 MB on the
  owner's 16 GB machine with the desktop browsers open, so close what you can
  before a long one.
- The script's own time limit is 4 hours for a match and 1 hour for a reel
  (`--limit <ms>` to change it).

## Things that go wrong

- **The tab dies some 22,000 frames into a full match** (about six minutes
  of match) when nothing forces a garbage collection: each HUD frame leaves
  about 2 MB of garbage, and the export page never idles long enough for the
  browser to collect it. The script calls `HeapProfiler.collectGarbage` every
  10 seconds and logs the page's heap with each status line. If you drive the
  page some other way, do the same. A dead tab shows as status lines with no
  text and only Edge's browser and GPU processes left (no `--type=renderer`);
  the script stops after three unanswered polls.
- **Out of memory.** A browser left over from an earlier probe, or a big
  desktop browser, can starve the export. Check `tasklist | grep -c msedge`
  for strays from probes and free memory before starting; the export fails
  with a lost graphics context or the machine swaps.
- **"Audio listener traversal diverged"** means the two passes disagreed on
  the camera path; that is a bug in the code, not in the setup. Note the demo
  and the time and report it rather than retrying in a loop.
- **The copy out of the browser** goes through CDP in 4 MiB chunks; a full
  match is 0.5-1 GB and takes a minute or two to copy.
- **Two known log lines are harmless:** "Mediabunny was loaded twice" comes
  from the script's own check of the finished file (it imports the library a
  second time to read the duration), and "hit spatter shader warm-up failed;
  it compiles on first use" is a preload the export scene skips.
- **A demo too short** for the length fails at once: a reel needs at least 3, 6
  or 9 minutes of recording for 1, 2 or 3 minutes; a full match 10 seconds to
  20 minutes.

## Report

Give each MP4's path, duration, size and the options used (demo, kind, length
or followed player, song and start), the code it was rendered from, and any
errors the log printed.
