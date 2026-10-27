# Highlight video export

Date: 2026-10-22. Status: standalone browser proof passed; Washoi exporter not implemented.

Planning review: 2026-10-26. Public target narrowed to existing 1/2/3-minute
highlight reels. The review below supersedes the earlier interval/HUD scope;
short intervals remain internal test fixtures only.

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

- An already generated cinematic highlight reel, using the existing 1/2/3-minute choices.
- Full HD 1920×1080 at 60 FPS, landscape 16:9, SDR.
- H.264 video and AAC stereo audio in an MP4 container, after capability checks.
- Game SFX; music selection is deferred from the first public version.
- Clean cinematic picture; full gameplay HUD export is deferred.
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

The preferred public UI, refined on 2026-10-27, is a modal with duration
selection, Generate, progress/cancel and a separate Download action. Generate
writes the encoded result incrementally to bounded browser-managed temporary
storage; Download then chooses a user-visible destination. This adds a temporary
file/quota/copy proof gate. It supersedes choose-destination-before-generation
as the primary UI; direct-to-destination remains a possible explicitly labelled
fallback if temporary storage is unavailable. See the modal contract below.

On supported desktop Chrome/Edge, the Download click opens `showSaveFilePicker()` with
a suggested MP4 filename. The user chooses the destination, then the exporter
opens a writable stream and copies the finalized temporary file into it. In
direct-to-destination mode, the muxer's positional writes go to that stream. The
browser authorizes access to that selected file; the website cannot silently
choose an arbitrary disk path. Use HTTPS (localhost for development) and feature
detection. See the
[File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Open the picker directly from its user gesture, before asynchronous saving work.
For direct-to-destination mode this is before generation/preparation; for the
preferred Generate-then-Download mode it is a fresh click after finalization.
A developer console command can prepare/open the same export dialog. If the API is unavailable,
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
| `src/games/fps/client/main.ts` | Washoi's main render loop updates the player and renders the scene | Export needs exclusive frame ownership; leaving this loop and demo RAF running would double-step presentation |
| `src/engine/loader/shader/ShaderAnimationSystem.ts` | Authored shader animation is centralized | Its update reads `performance.now()`; fixed demo steps alone do not fix world material animation |
| `src/games/fps/client/hud/widgets/VitalsBlock.ts`, `DemoViewerHUD.ts` | HUD and reel graphics already exist | They are DOM/CSS, outside the game canvas |
| `src/games/fps/client/HUDState.ts`, `ReelCards.ts` | Presentation data and reel copy can be reused | Need an explicit export overlay model rather than scraping rendered text |
| `src/engine/AudioManager.ts` | Central sound entry points and volume settings | Music uses HTML audio elements, separate from SFX; there is no exposed combined recording mix |
| `src/engine/audio/AudioV2Sfx.ts` | Babylon Audio V2 channel buses, decoded buffers, spatial listener following | Browser real-time output and `performance.now()` source lifetimes are unsuitable as an offline sound timeline |
| `src/engine/ui/UIScale.ts` | 1920×1080 reference layout | Live UI scaling depends on the window; export graphics must depend on output dimensions |
| `src/engine/core/Cvar.ts` | Developer gating | Production browser builds lock developer mode off, so the first gated command will work in development, not as a production hidden switch |

Babylon 9.31.2's installed `AudioV2/webAudio/webAudioEngine.d.ts` types the
context as `AudioContext`, but its JavaScript explicitly detects
`OfflineAudioContext`, reports it as running for scheduled sound calls, and
avoids calling its absent `close()` method on disposal. Test a separate Babylon
offline engine before deciding to write an independent mixer. This is evidence
of an intended runtime path, not proof that SHAG's wrapper, automatic spatial
updates or sound lifetimes work offline. `AudioV2Sfx` still starts sounds after
asynchronous loading and uses wall time for active-source retirement.

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
   reel. Run an unrecorded warmup/pre-roll. Wait for readiness without advancing
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
- If music is added later, it follows output time, not the demo's slowed time. Use one explicitly
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

Public recipe validation should reject invalid camera subjects, empty reels,
unsupported profiles and unavailable files before rendering. The console
command and later UI should call the same job API. Public input is a frozen
highlight reel; arbitrary intervals are internal fixtures. Accept the existing
1/2/3-minute target choices only after measuring the longest resulting output,
including its finite title/end cards and actual speed schedule. These choices
are selection targets, not evidence of an exact 60/120/180-second file.

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
4. **Complete developer feature:** frozen cinematic reels, game SFX,
   clean picture with reel graphics, progress/cancel/save and capability messages.
   Freeze scope around Full HD60; no new server protocol or gameplay changes.
5. **Player UI and wider support:** an Export action beside highlight/reel controls,
   with complete 1/2/3-minute acceptance on supported desktop browsers. Decide
   production access separately from the developer-gated prototype. Arbitrary
   intervals, full gameplay HUD, music, 1440p/4K and vertical Shorts are later additions.

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
  `npm --prefix src/games/fps run test:simulation`,
  `npm --prefix src/games/fps run test:physics`,
  `npm --prefix src/games/fps run server:tick`,
  `npm --prefix src/games/fps run server:fuzz -- --ticks 1000`, and
  `npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"`.
  Record actual results.
- Update affected manuals/changelog when implementation lands, with
  `npm run docs:build` and `npm --prefix src/games/fps run docs:build` for game-manual edits.

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
| Memory and output failures | Measure complete 1/2/3-minute reels, including the longest actual output; exercise real file picker, disk failure, codec failure and device loss; enforce limits |
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

## Highlights-only plan validation, 2026-10-26

This review changes planning only. It does not add an exporter, change live
playback or establish acceptance for a real-game export.

### Agreed product direction and proposed initial limits

- Client-side export from an existing highlight reel. Servers supply ordinary
  demo/assets only; no GPU render service, video upload or account publication.
- The public target is the existing 1/2/3-minute reel choices. A ten-second
  fixed-POV interval is a developer test, not an extra public trimming feature.
- Proposed initial format: clean 1080p60 SDR H.264/AAC MP4, with game SFX,
  existing reel cards/fades, progress/cancel and local save. Full gameplay HUD,
  chat, music selection and arbitrary recordings are outside the initial scope.
- Initial support is a tested desktop browser/OS/backend combination. A graphics
  backend, codec or browser being selectable is not evidence of export support.
- Normal demo playback and live matches keep their existing behavior. A public
  export cannot take over a live match. Keep the eventual player job API separate
  from the initial developer command's access gate.

### Concrete gaps found in current source

1. **The reel length is not an exact movie schedule.**
   `SequenceBuilder._computeDurationMs` integrates piecewise-constant speed
   keyframes; `CinematicDemoPlayer.update` eases speed on each update.
   `SequenceBuilder.totalDurationMs` adds transition durations, whereas the
   player's total sums segment durations and `getVeil()` overlays transitions
   within shots. Title holding is separate. These are different accounting
   paths, not safe inputs to an encoder's frame count. Build one pure, shared
   reel schedule and verify preview/export mapping against it. Review any
   intentional change to interactive timing separately; do not silently rewrite
   the edit while implementing file export.
2. **The ending is interactive rather than finite.** The player ends and shows
   a card with Replay/Exit controls. Freeze its presentation data and assign a
   finite export hold. A three-second closing hold is a proposal to review;
   retain the authored title hold. Include both in displayed file duration.
3. **A named crossfade is a dip, not a two-scene blend.** `getVeil()` implements
   black-dip opacity for `crossfade`. Preserve that appearance initially; do not
   infer a second simultaneous scene/render target from the transition's name.
4. **Seeking does not reconstruct every transient effect.** At each rewind or
   new shot, reset shot-local state, warm the destination and pre-roll the
   bounded lead-in, then emit the first frame once. Do not emit preparation
   events/audio, duplicate a boundary frag, or retain the previous shot's beam,
   gib, loop or temporal postprocessing history. Ragdoll/gib simulation needs
   repeatable substeps/seeds where possible, not a cross-device identity promise.
5. **Public sound policy is unspecified.** Decide an explicit export mix instead
   of accidentally inheriting the speaker mute state. Proposed: a fixed initial
   SFX/channel mix, no music or chat/UI sounds, preserving the user's settings
   and actual live audio state on exit. Test attenuation, camera changes,
   beam/ambient loops, voice-instance policy and clipping. Slow motion may
   lower pitch initially; pitch-preserving stretching is deferred.

### Job and data-flow contract

```text
selected reel + demo/asset identities + export settings
  -> frozen recipe and exact shot/movie schedule
  -> bounded preparation, assets, camera paths and sound-cue collection
  -> movie frame i -> shot + source playhead + camera/effect state
  -> final scene/weapon/postprocess image + reel graphics
  -> bounded encoder queues + aligned audio -> positional MP4 writes
  -> finalize and close destination -> success
```

The output clock is `i / 60`; source time follows the shot's mapping and may
rewind or slow down. Pre-roll has its own unrecorded traversal. Network, codec,
disk and UI waiting advance none of these clocks. Exactly one owner advances
playback, animations, physics and rendering. Frame-boundary rounding and seek
event suppression must be covered by tests. Render warmup must not accidentally
consume scheduled movie time or leak muted pre-roll cues into the mix.

The recipe identifies demo bytes/version, selected reel, targets/camera paths,
speed curves, graphics settings, random choices, map/package identities and
output/audio policy. Pin the resources needed by the active job so eviction or
another map operation cannot clear them. An ordinary code reload or asset
rollout must not quietly mix versions midway through export. Complete preflight
before writing encoded content; fail with the missing resource's identity when
preparation cannot succeed. A three-minute output does not bound the source
demo's length or indexing/analysis cost: avoid decoding/cloning the entire match
into retained per-frame scene state.

Preferred orchestration after discussion: a dedicated export page/session,
initially for the integration proof. It reuses game composition and playback
code with an export-owned bootstrap, rather than taking over the existing demo
session. Separate document globals give the exporter its own singleton instances,
scene and update owners. This reduces restoration coupling and lets a WebGL2
export run without switching the original page's renderer. It does not remove
the need for narrow clock/audio adapters in the reused systems, and it is not
an operating-system crash or GPU-memory isolation guarantee.

The extra scene exists for the export job only. Measure peak memory while both
pages exist, avoid loading editor/lobby/live networking in the export bootstrap,
and dispose its scene, engine, audio graph and media resources when the job
ends. The completed page may retain a small result UI until closed. Reuse
origin package caches where possible; cached bytes do not imply shared decoded
models or GPU textures. Do not duplicate rendering/gameplay implementations or
write temporary export settings into the user's persistent preferences. Pass a
serializable frozen recipe and verified resource identities, not live scene
objects or ownership of the main viewer's still-needed buffers. Opening and
closing the export page must not join a lobby, replace a match or stop the
original viewer. Account for browser popup/user-activation and independent save
picker gestures in the page flow.

Start with a validated WebGL2 export path; validate actual Babylon/WebGPU
final-picture capture independently before advertising it. Keep generic
clock/render/audio adapters in the engine and Washoi-specific recipes/UI in FPS.

### Three-minute resource and failure budget

At 1920x1080/60, 180 seconds contains 10,800 frames. Retaining their raw RGBA
pixels would take about 89.6 GB. At configured 20 Mbps, video alone is about
450 MB before audio/container overhead; actual variable-bitrate sizes vary.
Float32 stereo 48 kHz PCM is about 69.1 MB before decoded source assets,
offline graph resources or encoding copies. Three minutes is a useful bounded
target, not automatically a small browser job.

- Bound in-flight frames, GPU readbacks/bitmaps, encode queues, decoded audio,
  cue schedules and pending disk writes. Close each owned media resource.
- Prove memory plateaus during a busy three-minute reel and releases after
  success/cancel. A six-second synthetic result cannot establish this.
- Use real positional file writes and bounded MP4 metadata handling. The tested
  `fastStart: false` path is the initial candidate. Its end metadata means an
  interrupted file need not be playable; success requires finalization.
- Treat the real save picker/writable as a separate acceptance gate. Pick the
  destination from its own user gesture before asynchronous saving work. Test close,
  abort, disk-full/write refusal and existing-file preservation. Do not assume
  that wrapping a whole-file memory buffer in a stream solves memory use.
- The old Blob fallback is conditional: do not offer a three-minute in-memory
  download until measured safe. It is acceptable for initial public support to
  require a validated streaming destination, with a clear unsupported message.
- Decide hidden-tab behavior explicitly. Proposed first version: pause at a safe
  frame boundary while hidden, retain movie time and resume only if resources
  remain valid. Browser suspension/device loss may require cancel/restart;
  there is no promised checkpoint/resume across reload or a closed tab.
- Cancel must interrupt preparation, encoder backpressure and file writes, not
  merely set a flag checked at the next rendered frame. Keep a responsive
  progress UI by yielding during CPU-heavy work. A worker encoder/muxer is an
  optional later placement; it does not give the live Babylon scene worker
  ownership automatically.

### Evidence gates before public implementation/rollout

| Gate | Evidence required | State |
| --- | --- | --- |
| Synthetic file pipeline | Frame IDs, stalls, audio sync, incremental output, cancel/restart | Passed in the original PoC on one setup |
| Exact reel schedule | Shared source/movie mapping, speed easing, finite cards, transition and event boundaries | Open; source discrepancies identified |
| Small game-picture proof | Ten real-demo seconds/600 frames at 720p60; normal vs stalled processing produces matching sampled state/images | Open |
| Offline game-audio proof | Evaluate Babylon offline path; gunshot/flash timing, moving listener/source, loops, cuts and slow motion after AAC decode | Open |
| First full scene | Intro, POV replay and ending orbit with correct weapon/beam/ADS/effects, cards and final postprocessing | Open |
| Save and lifetime proof | Actual file picker, slow/failing writes, cancellation in every phase, repeat export and normal-playback recovery | Open |
| Long-form acceptance | Busy 1/2/3-minute reels including finite ending; bounded memory, complete event/frame schedule and sync at start/cuts/end | Open |
| Public support matrix | Ordinary supported browser launches, codec preflight plus a short real encode, tested WebGL2/WebGPU combinations and actionable failures | Open |
| Independent output review | Separate player/decoder checks for colour, seeking, initial AAC priming/end padding, text sharpness and audio clipping | Open |

The two-pass audio proposal is still a design candidate. First prove identical
resolved cue identities/timestamps and camera paths across collection/render
traversals; asynchronous sound resolution and random effect choices cannot
decide timing separately. If it fails that proof, revise cue collection or use
bounded chunk mixing before integrating a full exporter. Do not retain raw
video while waiting for an unknown complete audio schedule.

### Separate audio preparation and final packaging

Rendering audio separately is compatible with the offline design and is the
preferred integration-proof structure. Separate generation does not require the
player to save or merge two files:

1. Freeze the reel's source/movie mapping, camera paths and random sound choices.
2. Traverse the required shot ranges to collect resolved sound cues and listener
   paths; render their stereo samples offline. No speaker recording is needed.
3. Reset/pre-roll the scene and render video frames from the same recipe. With
   the prepared audio available, feed timestamped AAC and video chunks to the
   MP4 muxer under backpressure. The public result is one file.

As an internal diagnostic, the short proof may also save a WAV and silent MP4
and combine them afterward. Combining already encoded tracks is muxing/remuxing;
it need not encode the video again. That route requires bounded intermediate
storage and a tested remux adapter. It is not a reason to retain all raw video
frames, install FFmpeg into the public browser client or require external user
tools. The simpler initial public candidate prepares audio first, then writes
the two tracks into one MP4 as video renders.

These are separate responsibilities: mixing constructs the audio samples;
encoding compresses samples/pictures; muxing packages the encoded tracks with
timestamps. Do not await an entire audio-track feed before beginning the video
feed in a muxer that applies inter-track backpressure. Preparation can be
sequential while track feeding is interleaved/concurrent, as in the synthetic
PoC. Separate passes still require the same exact schedule, camera/listener
trajectory, cut/loop rules, initial codec delay and end-padding policy.

### Optional encoding worker and parallel preparation, 2026-10-27

Worker concurrency is feasible without another game scene. Keep this as a
bounded proof gate rather than a prerequisite to the first real-game export.
The original page may retain its scene; the dedicated export page owns one
export scene. Encoder workers own media data and job state, not a Babylon
engine, map, camera or third scene.

Verified API boundaries: WebCodecs exposes `AudioEncoder`, `VideoEncoder`,
`AudioData` and `VideoFrame` to dedicated workers; the raw media types have
transfer support. Web Audio's `OfflineAudioContext` is exposed to Window,
not an ordinary worker. Creating it in the export page still permits its
asynchronous browser audio rendering to overlap other work. Browser codec and
audio implementations own their processing resources; adding JavaScript workers
does not guarantee extra hardware throughput or a particular speedup.

The simplest worker candidate is one encoding/muxing worker that owns both
encoders, the muxer and output ordering. The export page renders/composes the
picture and transfers frames plus prepared audio samples through bounded queues.
One worker can submit both tracks asynchronously; separate audio/video workers
are optional only if profiling justifies their extra communication and lifetime
coordination. Keep the file-picker user gesture in the page. Prove whether the
selected writable can be handed to the worker or whether positional writes need
a page-side bridge; there must remain one writer owner and end-to-end pressure.

First worker proof: reuse the synthetic fixture, encode transferred frame/sample
data, decode the result and check frame IDs, timestamps and A/V sync. Exercise
slow output, worker/codec failure, cancellation, transferred-resource ownership,
queue bounds and repeated jobs. Validate the pinned Mediabunny adapter in this
placement; WebCodecs worker exposure alone does not establish that integration.
Retain a same-page encoder adapter if moving ownership adds more complexity than
the measured responsiveness benefit warrants.

Once cue collection and the exact camera/shot schedule are frozen, offline audio
mixing can potentially run while the export scene renders video. This is a
different optimization from moving encoders to a worker. It cannot skip the
dependency on sound events/listener paths, and inter-track backpressure must
bound video produced while audio is not ready. Start with prepared audio first;
test overlapping these stages after the shared schedule and audio correctness
proofs pass. Moving the complete game renderer into an OffscreenCanvas worker
or introducing a custom worker audio mixer is outside this initial plan.

References: [WebCodecs worker interfaces](https://www.w3.org/TR/webcodecs/)
and [OfflineAudioContext interface](https://www.w3.org/TR/webaudio-1.1/#OfflineAudioContext).

### Public modal UI contract, 2026-10-27

The owner's preferred UI is an in-page dialog over a strongly blurred/dimmed
background, launched by a small Export video button in the existing highlight
reel popover. Put that secondary button in the lower hint/footer area with
enough room for the copy, rather than overlapping the 1/2/3-minute watch keys.
Keep the existing watch path intact. Source: `DemosView.openReel()` makes each
minute key start playback immediately; the popover therefore does not provide
a persisted export selection to reuse implicitly.

The export dialog has its own 1 / 2 / 3 minute selector. Opening it selects
an available length (proposed default: last valid export choice, otherwise one
minute). Reuse the existing `reelLengths` availability policy and explanation
for disabled lengths; an empty highlight analysis still needs its own outcome.
Show map and player summary, selected target length, format/resolution/rate and
the exact calculated final duration when preparation determines it. Changing the
length before generation invalidates any prepared recipe. Once generation starts,
freeze length/settings and export that recipe. Switching a length after a result
exists must not silently discard an undownloaded file.

Use the game's established yellow panels, heading fonts, raised action buttons
and top-right X. The background becomes inert as well as visually blurred;
dialog focus is trapped, button/phase announcements are accessible, and closing
returns focus to Export video. The backdrop/dialog is outside the recorded
compositor. Keep the dialog sharp while blurring the surrounding UI. Honour
reduced-motion/blur policy and retain an opaque/dimmed fallback with usable
contrast. A progress display never depends on animation alone.

| Dialog state | Main content/actions | Closing behavior |
| --- | --- | --- |
| Ready | Duration selector and summary; Generate video | X and Escape available; outside dismissal may follow the host dialog convention |
| Preparing/generating | Frozen duration, phase, percentage/frame progress when known, ETA when useful; Cancel | X disabled with explanation; Escape/outside clicks cannot discard the job |
| Cancelling | Cancelling message while resources and unfinished output are released | Remains open until cancellation acknowledges cleanup, then returns to Ready |
| Finalizing | Finishing file; retain Cancel while safely abortable | Same protected close behavior; all frames submitted is not completion |
| Video ready | Finished filename/duration/size; Download; optional Generate another | X/Escape available; discarding an unsaved result requires an explicit choice |
| Saving | Saving progress where measurable; preserve generated result until save succeeds | Protect the copy operation; cancellation/failure returns to Video ready for another attempt |
| Saved | Saved confirmation after destination close succeeds; Download again or Close | X/Escape/Close available |
| Error | Specific error, recovery and retry/return action | Closing allowed once cleanup has finished |

Cancel generation stops the job, not merely hides the dialog. Browser tab close
or navigation can still terminate it; disabling the dialog's X cannot guarantee
survival of browser shutdown. Keep any unload warning limited to an active job
or unsaved result and avoid claiming a recoverable checkpoint after reload.

An in-page dialog does not require giving the live page another scene. Candidate:
embed the dedicated same-origin export document inside the modal, so it owns
the export scene and its own globals while presenting the requested modal UX.
Parent controls and job messages need explicit origin/job ownership and a
single cancellation/cleanup path. This remains a proof gate: validate iframe
render scheduling/visibility, focus and save gestures rather than assuming a
`display:none` frame behaves like an active export page. The visible UI can
remain in the parent while the isolated document renders; neither path creates
a third scene. The standalone export page remains useful as a developer harness,
not the planned public popup-window requirement.

Generate-then-Download requires a temporary encoded file, not a retained array
of raw frames or an automatically memory-backed 450 MB Blob. Candidate: a
per-job Origin Private File System file with positional muxer writes. Check
storage capability/budget before generation, handle quota/write errors, and
stream/copy the finalized file to the selected destination on Download. That
click supplies a new save-picker gesture. If the picker is cancelled, keep the
generated file ready without regenerating the reel. Release it after explicit
discard/close or a documented bounded result lifetime; clean up abandoned job
files without touching the package download cache or another export job.

Show Video ready only after the temporary MP4 is finalized/closed, and Saved
only after the destination has closed successfully. If a fallback uses browser
download handling without completion acknowledgement, say Download started
instead. Temporary-storage support, peak disk usage (potentially temporary plus
destination copies), quota failures, file permissions, retries and cleanup are
additional acceptance cases for this preferred UX. Source references:
[OPFS](https://web.dev/articles/origin-private-file-system),
[File System Standard](https://fs.spec.whatwg.org/) and
[save picker user gestures](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Browser APIs and the pinned research package also need a release-dependency
decision: lazy-load the export-only adapter, review/retain Mediabunny notices,
and validate the selected package version rather than mixing current online API
examples with the 1.62.1 proof. Real-time preview playback remains available if
export is unsupported. Any optional upload compatibility check is a separate
manual action, not automatic YouTube publishing.

Current primary references: [WebCodecs](https://www.w3.org/TR/webcodecs/),
[Mediabunny output and backpressure](https://mediabunny.dev/guide/writing-media-files),
and [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
These support the API direction; none establishes Washoi game acceptance.
