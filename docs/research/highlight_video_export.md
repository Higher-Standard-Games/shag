# Highlight video export

Date: 2026-10-22. Status: standalone browser proof passed; Washoi exporter not implemented.

## Investigation result

**Yes: Full HD60 MP4 export with synchronized audio is technically feasible on
this development machine.** A standalone WebGL2 → Canvas 2D → WebCodecs/MP4
prototype produced and decoded every frame, including during deliberate stalls.
The prototype also tested basic HUD/title composition, offline stereo panning,
variable-speed audio automation, cancellation/restart and incremental output.
Reproducible scripts are in [highlight-video-export-poc](./highlight-video-export-poc/README.md).

The remaining substantial work is inside Washoi: giving one owner control of
all playback/render clocks, exposing sound cues for an offline mix, and sharing
HUD/reel presentation data. The browser encoder/container is no longer the main
unknown. The prototype uses synthetic graphics/audio, not a game recording;
it establishes a viable pipeline, not completed gameplay acceptance.

## Decision and intended result

An integrated exporter for saved-demo highlights is feasible. Build it inside
the existing FPS demo/reel flow, initially available in the development client
behind `developer 1`. The intended result is a downloadable YouTube-ready MP4,
with game audio, at a selected resolution and a constant 60 FPS. Export may take
longer than the resulting video. This is offline rendering of a recording, not
capture of a running multiplayer match.

The recommended first complete version supports:

- A marked interval from a normal demo, plus an already generated cinematic reel.
- Full HD 1920×1080 at 60 FPS, landscape 16:9, SDR.
- H.264 video and AAC stereo audio in an MP4 container, after capability checks.
- Game SFX; optional selected music, disabled by default.
- Clean cinematic picture or a deliberately specified export HUD.
- Reel title/shot cards and fades when the chosen reel contains them.
- Progress, cancellation, and a local save. No account upload or YouTube publishing.

Start with a supported desktop Chromium browser on Windows. Other browsers,
full WebGPU game export, desktop/mobile packages and higher resolutions need separate acceptance.
Do not describe the feature as supported everywhere merely because an API exists.

YouTube recommends MP4/H.264 and documents audio/frame-rate requirements in its
[upload encoding guidance](https://support.google.com/youtube/answer/1722171).
The proposed export default is 20 Mbps video, configurable later; this is our
initial quality choice, not a claimed YouTube requirement. Output is compressed,
not lossless.

## Client-side save and progress

Export runs on the player's computer: the browser renders, mixes, encodes and
saves the MP4. A server may supply the original demo/assets, but no server-side
video renderer, video upload or server output directory is required. The local
`.cache/` paths in the proof below are research-runner artifacts, not the planned
player-facing save location.

On supported desktop Chrome/Edge, a user click opens `showSaveFilePicker()` with
a suggested MP4 filename. The user chooses the destination, then the exporter
opens a writable stream and feeds the muxer's positional writes into it. The
browser authorizes access to that selected file; the website cannot silently
choose an arbitrary disk path. Use HTTPS (localhost for development) and feature
detection. See the
[File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Open the picker directly from a user gesture, before asynchronous asset loading.
A developer console command can prepare/open the export dialog, with an explicit
Export/Choose file button to supply that gesture. If the API is unavailable,
offer a bounded-size Blob download after rendering, using the browser's download
destination behavior. The existing proof tests a simulated positional sink;
real picker permissions, writable close/abort and storage failures remain to test.
Show success only after mux finalization and the destination stream has closed.
On cancellation/error, abort unfinished output and report failure/cancellation;
verify overwrite behavior without deleting a pre-existing destination file.

Provide a client export dialog throughout the job, including the developer path:

| Phase | Progress display |
| --- | --- |
| Preparing | Asset/audio preparation status; indeterminate until measurable work totals are known |
| Rendering | Completed frames / total frames and percentage, e.g. 1,800 / 3,600 (50%); estimated time remaining after a useful sample |
| Finishing | Finalizing MP4 and saving; do not display a completed export just because all frames were submitted |
| Complete | Saved filename, dimensions/FPS and confirmation; fallback download needs a distinct ready-to-download state |
| Cancel/error | Clear outcome and recovery action, with render/input/audio state restored |

The frame count uses the frozen output timeline, including title holds and speed
changes. Encoder or disk waits change elapsed/estimated time, not that timeline.
Show Cancel during active work and keep the UI responsive while waiting. Progress,
controls, errors and the browser cursor stay in DOM outside the export compositor,
so they cannot be burned into the video. This UI is proposed; it is not implemented
by the standalone proof.

## What Gemini's snippet does and does not establish

`canvas.captureStream(60)` with `MediaRecorder` is convenient real-time recording.
It does not guarantee 60 newly rendered frames each second under load. Even
manual `requestFrame()` calls do not supply the independently timestamped movie
timeline required here. See the
[canvas capture API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream).

Use WebCodecs to submit explicit frames and timestamps, applying backpressure
instead of skipping export frames. WebCodecs encodes chunks; a separate muxer
must package video and audio into an MP4. Codec support must be checked for the
actual settings. See the [WebCodecs specification](https://www.w3.org/TR/webcodecs/)
and [encoding guide](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API).

This changes the meaning of a slow frame: an explosion can delay export without
creating a corresponding stutter in the saved video. It does not prevent
missing assets, incorrect animation clocks or bad audio scheduling. Those are
separate correctness requirements.

## Verified foundations and gaps in this checkout

Paths below are source observations, not proposed new APIs.

| Existing source | Useful foundation | Export gap |
| --- | --- | --- |
| `src/games/fps/client/DemoService.ts` | `loadAndPlayNormal(viewer, { manual: true })`, `updatePlaybackFrame(deltaMs, applyCamera?)`, model readiness, shared presentation wiring | Manual mode also omits HUD/music; cinematic startup has no equivalent manual option. Separate clock ownership from overlay/audio policy |
| `src/games/fps/client/DemoViewer.ts` | Tick-based playhead, frame delivery, seeking, interpolation lookahead | Ordinary playback bounds catch-up after stalls. Export must advance in bounded fixed steps and verify no recorded events were skipped |
| `src/games/fps/client/CinematicDemoPlayer.ts` | Builds the reel, camera paths, speed easing, title hold, shot transitions, `getVeil()` | Freeze the selected reel and derive an output timeline including holds, speed changes, replays and transitions |
| `src/games/fps/client/TimedemoService.ts` | Temporarily fixes render dimensions with `engine.setSize`, disables camera input, drives manual playback before scene animation, restores state | The benchmark still passes measured wall time into playback; it is not an offline video exporter |
| `src/main.ts` | Main render loop updates the player and renders the scene | Export needs exclusive frame ownership; leaving this loop and demo RAF running would double-step presentation |
| `src/engine/loader/shader/ShaderAnimationSystem.ts` | Authored shader animation is centralized | Its update reads `performance.now()`; fixed demo steps alone do not fix world material animation |
| `src/games/fps/client/hud/widgets/VitalsBlock.ts`, `DemoViewerHUD.ts` | HUD and reel graphics already exist | They are DOM/CSS, outside the game canvas |
| `src/games/fps/client/HUDState.ts`, `ReelCards.ts` | Presentation data and reel copy can be reused | Need an explicit export overlay model rather than scraping rendered text |
| `src/engine/AudioManager.ts` | Central sound entry points and volume settings | Music uses HTML audio elements, separate from SFX; there is no exposed combined recording mix |
| `src/engine/audio/AudioV2Sfx.ts` | Babylon Audio V2 channel buses, decoded buffers, spatial listener following | Browser real-time output and `performance.now()` source lifetimes are unsuitable as an offline sound timeline |
| `src/engine/ui/UIScale.ts` | 1920×1080 reference layout | Live UI scaling depends on the window; export graphics must depend on output dimensions |
| `src/engine/core/Cvar.ts` | Developer gating | Production browser builds lock developer mode off, so the first gated command will work in development, not as a production hidden switch |

Babylon's installed `AudioV2/webAudio/webAudioEngine.d.ts` accepts an
`AudioContext`, not an `OfflineAudioContext`. Do not assume its current engine
can simply be handed an offline context. A small offline audio backend using
shared decoded assets is the safer starting proposal.

Existing manuals relevant to implementation: `docs/manual/guides/timedemo.md`,
`shader-system.md`, `console-system.md`, `camera-system.md`, and the FPS manual's
`multiplayer/demos.md` and `tools/demo-cinematic.md`.

## Resolution and file presets

These are proposed presets; none are implemented.

| Preset | Encoded dimensions | Frame rate | Rollout |
| --- | --- | --- | --- |
| Full HD | 1920×1080 | 60 | First complete version/default |
| HD | 1280×720 | 60 | Useful low-cost prototype and fallback after validation |
| 1440p | 2560×1440 | 60 | After encoder/GPU/memory acceptance |
| 4K | 3840×2160 | 60 | Later; not an initial promise |

The output size is the actual render/composition buffer size, not a CSS resize
or an upscale of a smaller screenshot. A small browser window can preview the
same 1920×1080 export scaled down. Explicitly control hardware scaling, aspect
ratio and resize handling; device pixel ratio must not accidentally multiply
the encoded dimensions. Validate the dimensions in the resulting file.

Use the chosen 16:9 aspect to calculate the camera projection, retaining the
player's intended FOV or the reel's authored shot FOV. Draw overlays in export
coordinates. Browser resizing must not resize the export mid-job. Save and
restore the prior dimensions, scaling, cameras and resize ownership on every
terminal path. A separate isolated export canvas/context is an option if the
first prototype shows that temporarily owning the live renderer is too fragile;
it entails loading and managing another scene and must be measured.

For MP4, probe the exact H.264 profile, dimensions, bitrate and AAC configuration
before loading a lengthy reel. The research prototype uses Mediabunny 1.62.1;
it is a tested candidate, not an installed game dependency. Its
[sources](https://mediabunny.dev/guide/media-sources) wrap WebCodecs and its
[output API](https://mediabunny.dev/guide/writing-media-files) muxes MP4 and
supports memory/stream targets. The cached package declares MPL-2.0; retain
its notices and review its license before integrating it. Handle
encoder configuration metadata, frame reordering, keyframes and audio priming
through that adapter. Do not hand-write a partial MP4 writer.

If the required codecs are unavailable, report that before export starts.
WebM can be a separately labelled fallback after testing. A local FFmpeg
backend is another possible developer tool, not an assumed installed dependency
or an automatic download. Do not silently change formats or omit sound.

## Frame ownership and the export timeline

Introduce an export session owned by the FPS module. Reuse the demo systems;
do not create a second game or change the server/demo protocol for video export.
Game-specific orchestration belongs in `src/games/fps`. Any generic renderer
hook must receive its driver through application composition or a registry;
engine code must not import the exporter from FPS.

Proposed session states:

```text
idle → preparing → rendering/encoding → finalizing → complete
                         ↘ cancel/error → cleanup
```

1. Freeze the export recipe: demo identity/hash, selected interval or saved
   reel plan, camera target/paths, speed schedule, visual settings, seed, overlay
   mode, dimensions/FPS and audio choices. Prevent playback controls changing
   the job. Export is unavailable during a live match; do not unexpectedly
   disconnect a player to begin one.
2. Load map/models/fonts/audio; prepare the materials and effects used by the
   clip. Run an unrecorded warmup/pre-roll. Wait for readiness without advancing
   the movie clock, with bounded timeouts and missing-asset errors.
3. Own the render update: suspend ordinary player/demo RAF advancement and
   automatic physics/animation steps that export will drive. Preserve and
   restore their owners. Never capture by repeatedly seeking straight to each
   frame: seek policy intentionally suppresses one-shot effects.
4. Advance sequentially using the fixed output clock. A normal interval maps
   output time to recorded time directly; a reel maps it through the frozen
   shot/speed schedule. Step transient effects and physics with bounded
   substeps. Pre-roll reconstructs things already alive at the interval start.
5. Update camera, listener, effects and export overlay state; render all world
   and weapon cameras and final postprocessing. Copy the completed picture into
   the composition surface immediately after rendering, respecting backend
   completion. Do not capture only the first camera or an intermediate target.
6. Draw export graphics, encode the frame, then wait for encoder capacity as
   necessary. Close every `VideoFrame` and temporary bitmap. Waiting for GPU,
   encoding, disk or UI work never advances movie time.
7. Encode/mux scheduled audio alongside video, finalize and save. Do not await
   adding a whole audio track before supplying video: the muxer's inter-track
   backpressure can wait for the other track. The prototype starts audio feeding
   and attaches its error handler before the video loop, then joins both tracks.
   Cleanup runs for success, failure and cancellation.

For output frame `i`, derive its timestamp from `round(i * 1_000_000 / fps)`;
derive duration from adjacent timestamps rather than repeatedly adding a
rounded microsecond duration. All audio uses the same output origin. Agree on
an exact end policy and final padding so muxed audio/video durations align.
In the tested six-second file the video has exactly 360 frames but native MP4
duration is 6.016 seconds, with 768 padded audio samples. Cue alignment is still
correct. Proposed initial policy: permit at most one 48 kHz AAC frame of final
padding (1024 samples, about 21.3 ms), retain the final picture through that tail,
and keep clip selection/progress on the video timeline. Exact container trimming
needs a separate edit-list/encoder-delay test; shifting all audio cues by the
tail duration would introduce an error.

The reel's output duration is not just its recorded tick span: include title
holds, cut/replay rules, eased speed changes and the chosen ending card. Freeze
or bake that mapping and test it against interactive playback. A reel's UI
duration estimate should not be treated as proof of exact export length.

Audit every time-dependent render path: Babylon skeletal/particle animation,
camera smoothing/bob/recoil, shader scrolling, water, lights, weapon effects,
ragdolls/gibs, damage numbers and CSS transitions. A few demo systems already
use playback clocks, but that is not evidence that the whole scene does.
Seed visual/audio random choices per job where repeatability matters; do not
promise bit-identical physics or encodes across browsers/GPUs.

## HUD and reel graphics: recommended solution

The world, player models, gun and Babylon postprocessing are in the game
render. Much of the information laid over them is HTML. Capturing that canvas
will omit health/ammo, timer, kill feed, damage overlays and the HTML reel
cards/veils. Hiding playback controls does not move the remaining DOM into video.

Split presentation into four layers:

| Layer | Export policy |
| --- | --- |
| World, gun, postprocessing | Always render through the normal scene cameras |
| Gameplay HUD | Explicit export mode: clean or supported HUD |
| Reel graphics: title, shot cards, black/white veil, ending | Preserve when present in the selected reel, independently of gameplay HUD mode |
| Controls, console, progress, tooltips, browser cursor | Never burn into the output |

**Recommended browser solution:** compose the finished game canvas and an
export overlay into a separate fixed-size Canvas 2D surface. Implement a small
export renderer fed by presentation data: health/armor/ammo, weapon slots,
crosshair, timer, player name, kill feed and reel card/veil data. Extract shared
formatting, colours, assets, typography and layout constants; do not maintain
unrelated copies of game rules. Avoid drawing an extra crosshair or label if
the scene already renders it.

For the first complete version, make clean cinematic output the default and
include reel graphics. Add the gameplay HUD only once its promised elements
are faithfully reproduced. Expose incomplete HUD support as such in developer
prototypes; do not call a minimal text overlay the full existing HUD.

Overlay animation runs on output timestamps, not `setTimeout`, CSS wall time or
the DOM control strip's idle timer. Await fonts and icon assets. Use screenshot
comparisons at fixed times/resolutions for layout, alignment, fades and number
formatting. `HUDState` is mutable shared state: snapshot it per frame rather
than letting an async encoder read it later.

Other approaches and why they are not the default:

- DOM-to-image libraries/SVG `foreignObject`: useful for still comparisons,
  but not an assumed faithful CSS/filters/fonts/video capture pipeline at 60
  output frames per second. They need a concrete browser proof before adoption.
- Developer CDP page screenshots plus a local encoder: can capture existing
  DOM and scene together, provided clocks/layout/capture boundaries are owned.
  It is a reasonable fallback prototype for exact HUD appearance, but requires
  a local runner and substantial image I/O; it is not the in-browser export UI.
- Tab/screen capture: can capture composited DOM, but brings real-time timing
  and a source-selection prompt. It does not meet the offline-export objective.
- Replacing the entire live HUD with Babylon GUI/canvas: unnecessarily large
  scope for this feature. Keep the live UI unless later work independently
  justifies that migration.

First prototype must verify the Canvas 2D composition copy on the chosen WebGL2
backend, including colour/alpha and full-screen effects. WebGPU needs its own
copy/readback/completion test. Do not globally enable persistent drawing buffers
or accept a slow synchronous readback on every live frame just to support export.
The standalone copy now passes with `preserveDrawingBuffer: false`, and a basic
WebGPU clear/copy passes. Washoi's actual multi-camera/postprocessing output,
colour handling and capture point remain acceptance work.

## Audio: schedule the movie, not the speakers

The recorder snippet's `masterGainNode` does not exist as a single capture point
in SHAG. SFX uses private Babylon Audio V2 buses; music uses HTML audio elements.
Adding only the SFX stream would miss music. More fundamentally, a real-time
audio stream would continue while an offline video frame waits for rendering.

Recommended offline design:

1. Introduce an injectable audio sink behind existing sound entry points. Live
   play keeps the current backend. Export records resolved cues without playing
   them into the user's speakers. Do not redirect or mutate a live match's mix.
2. Resolve randomness and sound selection once. Record asset/buffer identity,
   output start time, offset, gain/channel, pitch/rate, loop start/stop and source
   position, plus the camera/listener trajectory needed for spatialization.
   Include movement, gunfire, impacts, hits, announcer and ambient loops, not
   just snapshot `weapon_fire` events.
3. Collect cues during the same fixed-step playback that produces video, so
   camera cuts and slow motion share its timeline. Decode assets before use;
   network completion time must not become a sound's start timestamp. Use
   pre-roll/loop state to include sounds active at the selection boundary.
4. Mix against an offline audio timeline, initially stereo 48 kHz. An
   [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)
   renders a scheduled graph into samples independently of speaker playback.
   Reuse attenuation/channel policy, but explicitly implement or adapt the
   offline source/listener automation instead of assuming Babylon accepts this
   context. Check stereo panning and camera changes against the live mix.
5. Encode the resulting samples to AAC, preserving timestamps and encoder
   metadata, then mux them with the video. Bound memory for decoded audio and
   PCM; longer jobs may need chunked mixing with overlap for tails/filters.

There is an ordering issue to resolve in implementation: game cues are learned
while advancing the demo, whereas the simple offline mixer wants the complete
schedule. For the first bounded-length version, prototype a preparation traversal
that collects resolved cues and listener/camera paths, then reset/pre-roll and
render the frozen recipe with the offline mix available. Suppress live sound in
both traversals; freeze seeds/choices and verify that both traversals agree at
cuts and boundaries. This avoids retaining raw video frames or indefinitely
buffering the video while waiting for audio. Incremental mixing with a safe
event watermark and effect tails is an alternative for longer jobs, with more
complexity. The standalone test uses known cues; it does not prove the game's
two-pass reconstruction.

Define these editorial policies before audio acceptance:

- At cuts, stop shot-local loops and fade outgoing tails briefly; retain only
  cues intended for the next shot. A replay intentionally repeats its audio.
- At constant slow motion, the initial policy may lower pitch with playback
  rate. For eased speed changes, use the same time mapping for trigger times
  and rate automation; scheduling each event by division by one speed is wrong.
  Pitch-preserving time stretch is later work.
- Music follows output time, not the demo's slowed time. Use one explicitly
  selected track/start offset for repeatable export; do not inherit a shuffled
  HTML playlist. Game-only sound is the default; uploading licensed music is
  the user's separate choice.
- Mute live music during export and restore its prior state afterward. Missing
  required sounds or unsupported audio encoding produce a clear error, not an
  unexpectedly silent success. A silent developer prototype must say so.

## Proposed implementation boundaries and rollout

Proposed names below do not exist yet.

| Work | Proposed location |
| --- | --- |
| Job recipe, state machine, clock/reel schedule | `src/games/fps/client/video/HighlightVideoExporter.ts` and adjacent pure timeline modules |
| Fixed-size overlay/compositor | `src/games/fps/client/video/ExportOverlay.ts` |
| Audio cue sink and offline mixer | `src/games/fps/client/video/ExportAudio.ts`, with a narrow generic sink hook in engine audio |
| WebCodecs/muxer/sink adapters | `src/games/fps/client/video/` initially; move only proven reusable pieces into engine code |
| Developer entry | `src/games/fps/console/commands/VideoExportCommand.ts` with `developer: true` |
| Reel/interval controls | Existing demo UI after the developer path proves correct |

Illustrative proposed console interface, **not runnable today**:

```text
developer 1
videoexport clip --from 00:42 --to 01:02 --preset fullhd --hud clean
videoexport reel --preset fullhd --hud clean
videoexport cancel
```

Recipe validation should reject ambiguous time ranges, invalid camera subjects,
empty reels, unsupported profiles and unavailable files before rendering. The
console command and later UI should call the same job API. Consider a first
version clip-length cap of 60 seconds, disclosed before starting; raise it after
memory/output tests rather than promising arbitrary recording lengths.

Implementation phases with exit criteria:

1. **Game integration spike:** the standalone feasibility proof below is done;
   next export ten seconds of an existing demo at 720p60 with
   explicit timestamps to a playable MP4. Silent and HUD-free is acceptable only
   for this spike. Deliberately stall rendering; verify 600 submitted/decoded
   frames, exact dimensions and expected duration, not just a working download.
2. **Frame ownership and 1080p:** add pre-roll/readiness, all render clocks,
   camera/weapon correctness, resize isolation, bounded encoding queues,
   cancellation and restoration. Compare screenshots with normal playback.
3. **Graphics and audio proofs:** export title/veil/ending graphics; test a
   faithful HUD sample. Produce a synchronous gunshot/flash clip with spatial
   audio. Prove that an injected rendering stall introduces neither sound drift
   nor a long silence. These are necessary gates before calling it useful for
   YouTube highlights.
4. **Complete developer feature:** clips plus frozen cinematic reels, game SFX,
   clean/full supported HUD modes, progress/cancel/save and capability messages.
   Freeze scope around Full HD60; no new server protocol or gameplay changes.
5. **Player UI and wider support:** an Export action beside playback/reel controls,
   tested extra presets and browsers. Decide production access separately from
   the developer-gated prototype. 1440p/4K and vertical Shorts are later additions.

Use encoder queues and incremental output. At 1080p, one RGBA image is about
8.3 MB; 60 seconds of uncompressed 60 FPS frames would be about 30 GB. Never
retain all raw frames. At the proposed 20 Mbps video rate, a minute is roughly
150 MB before audio/container overhead. Streaming to a user-selected file is
preferable where supported; a Blob download needs a conservative size limit.
The prototype proves regular MP4 can write incrementally through a positional
`StreamTarget` with slow writes. Its streaming test explicitly sets
`fastStart: false`, placing metadata at the end. Do not select an in-memory
fast-start mode and assume streaming alone bounds memory. For an initial saved
file, metadata at the end is acceptable after finalization; validate seeking.
Reserved front metadata needs packet-count bounds; fragmented MP4 is a separate
compatibility choice. The test emulates file writes in a small fixed store,
not a browser file picker or long-duration memory measurement.
File-picker interaction must happen while user activation is available, before
long asynchronous preparation, or provide an explicit final Save action.

Pause cleanly or abort on a hidden tab, device loss, scene replacement, missing
asset, storage failure or navigation. Cancellation must interrupt preparation,
encoder waits and output writes. Restore dimensions, input, cameras, render
owners, audio and overlays in `finally`, close GPU/media resources, and remove
job listeners/timers. Do not leave a truncated MP4 labelled as a completed video.

## Acceptance and verification plan

Headless checks precede browser tests:

- Pure timeline tests: frame/timestamp boundaries, clip end, shot cuts, title
  hold, variable speed integration, replay events and overlay timing.
- Mock encoder/muxer tests: backpressure, failure, cancellation, correct frame
  cleanup and finalization; fake audio sink tests for cue ordering/loop lifetime.
- Regression checks for demo seeks, normal playback, cinematics, viewmodel and
  stopped/failed export returning input/render/audio ownership.
- Existing required gates: `npm run typecheck`, `npm run test:run`,
  `npm run gate:biome`, `npm run build`.
- Renderer/audio-clock edits require the renderer regression set:
  `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`, and indexed headless BSP loading.
  The installed map is `washoi_dm2`; the older `wdm2` command in AGENTS.md is
  known to refer to an absent package in this asset set. Record actual results.
- Update affected manuals/changelog when implementation lands, with
  `npm run docs:build` and `npm run docs:fps:build` for game-manual edits.

Real-browser acceptance must inspect the saved file, not just encoder callbacks:

| Case | Required observation |
| --- | --- |
| 10-second Full HD60 clip | 1920×1080, 600 decoded frames, correct stream duration/rate, playable MP4 with sound |
| Injected 100–250 ms render/encode stalls | Export takes longer; output timestamps/frame count remain correct and audio stays aligned |
| 15/30/60 FPS preview machine, different window sizes and DPR | Same selected export dimensions/timeline; no CSS-sized HUD or accidental 4K buffers |
| Explosion, gunfire, beam, gib/ragdoll, moving shader/water | Effects advance by movie time, with correct first-person gun and postprocessing |
| Gameplay HUD and reel cards/fades | Correct output layout/timing; no progress dialog, console or transport strip in the file |
| Shot boundary, slow motion, title hold, replay | Intended camera/graphics and synchronized audio; no stale loop from the previous shot |
| Cancel, missing asset, encoder/disk failure, repeated exports | No leak, stuck audio, doubled render loop, persistent resize or corrupted-success download |
| Decode after muxing | Seeking, initial A/V sync, final tail, keyframes and MP4 metadata work in an independent player |

Use a short flashing frame plus scheduled click as a measurable sync fixture.
Check sync at start, middle, cuts and end; a suggested initial tolerance is one
60 FPS frame (16.7 ms), with codec priming accounted for. Inspect gunshot/impact
samples separately from that synthetic test. Verify colour range/BT.709 handling,
HUD sharpness and audio clipping, then perform an actual private YouTube upload
manually if the user chooses. Uploading is outside exporter development.

## Measured standalone proof, 2026-10-22

Environment: headless Microsoft Edge 155 on Windows, WebGL2 through ANGLE/D3D11,
NVIDIA GeForce RTX 4070 SUPER. Localhost secure context. Mediabunny 1.62.1 is
downloaded with a pinned SHA-512 into ignored `.cache/`, without changing
`package.json`, lockfiles or `node_modules`. Native support checks passed for
H.264 `avc1.64002a`, 1920×1080/60, 20 Mbps, and AAC `mp4a.40.2`, stereo 48 kHz,
192 kbps. These are tested settings, not a universal support guarantee.
The repository's CDP driver enables GPU/WebGPU and ignores the GPU blocklist;
the small WebGPU result does not establish support with ordinary launch flags.

Each completed case renders six seconds/360 unique pictures. Every picture has
a binary frame ID; the verifier demuxes the MP4, decodes with `VideoDecoder`,
reads the IDs, checks timestamps to 2 µs and checks the moving WebGL object after
the intro veil. A second path uses native `<video>` metadata and seeks to three
flash frames. Native `decodeAudioData` decodes the MP4's AAC for cue/pan checks.
This is stronger than counting frames submitted to an encoder. FFmpeg/ffprobe
were unavailable in PATH; external desktop players and YouTube were not tested.

| Experiment | Observed result | What it establishes |
| --- | --- | --- |
| Baseline Full HD60 | 360 IDs in order, 1920×1080, correct timestamps; encode/mux 0.946 s | Explicit-frame MP4 pipeline works on this machine |
| Deliberate stalls | 15 ms wait per frame plus twelve 250 ms waits; encode/mux 8.980 s; same 360 IDs/timestamps | Slow processing does not force dropped movie frames |
| Resolution vs preview | 640×360 CSS preview; file and decoded pictures 1920×1080 | Preset dimensions can be independent of preview window size |
| Synthetic HUD/reel graphics | Canvas HUD, title and intro veil compose with the WebGL picture; DOM control strip excluded | Separate export graphics are viable; this is not the full game HUD |
| Offline stereo audio through AAC | Flashes at 1/3/5 s; decoded cue onset errors 0.52–0.60 ms; left/right cue energy ratio about 18:1 | Offline mixing, spatial panning and muxed A/V sync work for this fixture |
| Slow motion/ramp audio | Speed 1×, then 0.5×, then a linear 0.5→1.5× ramp; native audio automation matches integrated cue times within 0.85 ms | Variable-speed sound can follow the same integrated timeline; pitch preservation not tested |
| MP4 seeking/end | Native seeks at 1.001/3.001/5.001 s find the flashes; duration 6.016 s | Native playback/seek works; final AAC padding needs an explicit policy |
| Incremental regular MP4 | 12 positional writes, nine before finalization; max chunk 64 KiB, max one in flight; 10 ms delayed writes; all decode checks pass | Stream output respects asynchronous writes without requiring one final whole-file write |
| Cancellation/restart | Cancel at 40 submitted frames produces no finalized buffer; next export passes all checks | Basic encoder/muxer cancellation and repeat use work |
| SVG `foreignObject` | Inline styled HTML rasterizes without taint | A small HTML example works; full game CSS/fonts/filters fidelity and per-frame cost remain unproven |
| WebGPU copy | Offscreen 320×180 clear copies to 2D with expected RGBA [51,204,76,255] | Basic browser backend copy works; no Babylon/WebGPU game encode was tested |

The baseline/stalled files are each 658,350 bytes. This simple scene compresses
well under the configured variable bitrate; it predicts neither game clip size
nor visual quality under combat. Timings above cover rendering/encoding/muxing, excluding
verification and offline audio preparation. The offline six-second mix took
roughly 4–6 ms; that is not a benchmark for Washoi's real sound graph.

Generated local evidence (ignored, regenerated by the runner):

- `.cache/highlight-video-export-poc/results/report.json`: capabilities,
  measured cases, empty browser warning/error and HTTP-failure lists.
- `baseline.mp4`, `stalled.mp4`, `streamed.mp4`, `after-cancel.mp4` in that directory.
- `*-composed.png`, `*-decoded.png`, `page-with-excluded-controls.png` and
  `foreign-object.png` for composition/native-seek and DOM-boundary inspection.

## Remaining game-specific work and validation

| Issue | Concrete next proof |
| --- | --- |
| Fixed clock ownership | Render one real clip with fast and deliberately slow export; compare shader, camera, weapon and effect state at the same output frame |
| Demo/reel reconstruction | Verify pre-roll, normal demo event delivery, title holds, cuts, replays and eased speed mapping without repeated per-frame seeks |
| Actual HUD fidelity | Share presentation data/assets and compare selected fixed-size game/export HUD frames; define exactly which elements are supported |
| Game audio completeness | Collect real cues/loops/listener paths, test two-pass reconstruction, attenuation and cut tails; compare gunshot/flash sync after AAC |
| Final render copy/colour | Capture all cameras and final postprocessing at 1080p; verify SDR/range/alpha and avoid viewport resize interference |
| Memory and output failures | Measure a combat-heavy 60 s job; exercise real file picker, disk failure, codec failure and device loss; enforce limits |
| Restoration | Cancel/fail a real export and verify renderer/input/audio ownership, original resolution and ordinary demo playback recover |

No Washoi runtime feature, console command, protocol or production setting was
changed. Authored files: this document and `highlight-video-export-poc/`'s
`README.md`, `setup.mjs`, `server.mjs`, `index.html`, `probe.mjs`, `run.mjs`,
`timeline.mjs`, `timeline.test.mjs`. Existing unrelated edits are untouched.

Reproduction and validation commands:

```powershell
node docs/research/highlight-video-export-poc/setup.mjs
node --test docs/research/highlight-video-export-poc/timeline.test.mjs
node docs/research/highlight-video-export-poc/run.mjs
npm.cmd run docs:build
git diff --check
```

The pure Node timeline tests passed (2/2) before the final browser run. The browser
runner passed every case, including native seeking, cancellation and streaming.
`npm.cmd run docs:build` passed (6.29 s; log at
`.cache/highlight-video-export-poc/docs-build.log`). `git diff --check` passed;
the new untracked research files were separately checked for trailing whitespace
and relative Markdown links. `node --check` passed for each of the six `.mjs`
files. The research documents are outside VitePress's published page/link graph.
Renderer/network/game regression gates are reserved for implementation: this
task adds standalone research scripts only.
