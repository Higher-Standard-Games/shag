# Runtime Audio Restyling for Warsow Media

**Status:** investigation and implementation plan

**Last verified:** 2026-08-07

**Scope:** browser, Capacitor, and Electron clients; existing Warsow/QFusion sound media; no media replacement required

## Executive recommendation

Yes, SHAG can give the existing Warsow sounds a substantially different character in code.

The first implementation should **not add an audio library**. Use native Web Audio nodes to transform decoded short sounds in an `OfflineAudioContext`, cache the resulting `AudioBuffer`, and pass that buffer back to Babylon Audio V2 for normal playback and spatialization. This route uses stable browser APIs and Babylon's public `AudioBuffer` input, changes no files inside the pk3s, and makes the original sound an automatic fallback.

Start with two deliberately different treatments:

1. **Announcer:** a dedicated, intelligible robotic-radio profile: band limiting, a small presence lift, gentle saturation, subtle ring modulation, compression, and a dry/wet control. Do not make time-changing pitch reduction the default.
2. **Gameplay SFX:** category-specific weight rather than one global bass boost. Weapons and explosions can receive a modest low shelf and light saturation; movement, pickups, UI, and player voices should remain much closer to the original.

Babylon Audio V2 should continue to own buffer reuse, voice playback, and 3D spatialization in the first milestone. Its installed `9.17.0` API supports buses and analyzers, but it does **not** expose a supported filter/effect insert on a bus. Do not reach into underscore-prefixed Web Audio internals to add one.

When SHAG needs continuously changing underwater filtering, shared master limiting, reverb zones, or live preset morphing, add a real mixer graph. At that point either Babylon must expose public effect inserts or SHAG should own a native Web Audio playback/mixer backend. Tone.js is a reasonable prototyping option for that later stage, not a necessary first dependency.

## What "editing on the fly" can mean

There are three useful levels, with different engineering costs.

| Level | When processing happens | Can change during a playing sound? | Best use |
|---|---|---:|---|
| Load-time render | Once after decoding, before playback | No | Announcer voice, weapon weight, stable art-direction presets |
| Per-voice real-time graph | Every time a sound plays | Yes, for that voice | Modulation, procedural variations, experiments |
| Shared mixer-bus graph | Continuously after many voices are mixed | Yes | Underwater state, master dynamics, ducking, reverb zones |

The recommended first milestone is load-time rendering. It is still runtime transformation: the pk3 media remains untouched, profiles can be selected in settings, and generated buffers exist only in memory. The important limitation is that a sound already playing cannot morph from dry to underwater.

## Current SHAG audio reality

The current client path is:

```text
PK3 bytes / direct URL
        |
        v
AudioV2Sfx -> Babylon Audio V2 StaticSoundBuffer
        |                |
        |                +-> cached 2D StaticSound
        +-------------------> bounded per-play 3D StaticSound
                                  |
                                  v
                              one SFX bus
                                  |
                                  v
                               output
```

Verified foundations:

- [`AudioManager`](../../src/engine/AudioManager.ts) owns the public music/SFX API and the four current cvars: `s_volume`, `s_musicenabled`, `s_sfxvolume`, and `s_sfxenabled`.
- [`AudioV2Sfx`](../../src/engine/audio/AudioV2Sfx.ts) uses Babylon Audio V2 for short decoded effects, one SFX bus, PK3 lookup, browser unlock, buffer caching, cached 2D sounds, per-play 3D sounds, and a 48-spatial-voice cap.
- [`AudioV2Sfx.test.ts`](../../src/engine/__tests__/AudioV2Sfx.test.ts) already verifies shared decoding, PK3 loading, 2D reuse, 3D construction, and disposal.
- [`FPSBombAudio`](../../src/games/fps/client/FPSBombAudio.ts) already names the active announcer cues explicitly under `sounds/announcer/`.
- Other gameplay sound selection is already separated into small banks such as [`FPSCombatAudio`](../../src/games/fps/client/FPSCombatAudio.ts), [`FPSMovementAudio`](../../src/games/fps/client/FPSMovementAudio.ts), [`FPSPickupAudio`](../../src/games/fps/client/FPSPickupAudio.ts), and [`FPSLiquidAudio`](../../src/games/fps/client/FPSLiquidAudio.ts).
- Music still uses `HTMLAudioElement` in `AudioManager`. [`RainEffect`](../../src/engine/effects/RainEffect.ts) and [`ThunderEffect`](../../src/engine/effects/ThunderEffect.ts) also bypass Audio V2. A claim that a new SFX profile affects "all audio" would therefore be false until those paths are consolidated.
- Headless execution is currently safe because `AudioV2Sfx` returns without initializing when `window` or `AudioContext` is absent. New classification and preset resolution must remain pure and testable without DOM audio.

### Local Warsow media inventory

The locally available pk3 corpus was inspected by ZIP entry name, without extracting or modifying media.

| Archive | Audio entries | Main categories |
|---|---:|---|
| `data0_21.pk3` | 158 | 101 announcer, 33 vsay, 17 music, 7 misc |
| `data0_21pure.pk3` | 59 | 33 players, 16 weapons, 8 items, 2 world |
| `data0_000_nonfree_21pure.pk3` | 96 | 34 players, 27 weapons, 16 world, 12 items, plus movers/ambient/bomb |
| `data0_000_nonfree_21.pk3` | 7 | menu and misc |

All 101 `sounds/announcer/*` entries in `data0_21.pk3` are Ogg Vorbis. They cover CTF, bomb, countdown, scoring, timeout, midair, callvote, overtime, and post-match groups. The current bomb bank contains 15 announcer references representing 14 unique voice files, so it is a small and practical first preload set even though the eventual compatibility bank is much larger.

These counts describe the developer's local media snapshot, not a guarantee that every installation mounts every archive.

### Constraints hidden in the current cache

`AudioV2Sfx` keys cached 2D `StaticSound` objects only by normalized file path. The first creation therefore fixes `outBus` and `maxInstances` for later calls to that path. Once routes and profiles exist, a processed-sound key must include the immutable render identity, for example:

```text
normalized path + preset version + route + render sample rate
```

Alternatively, enforce one canonical route and concurrency policy per asset. Do not allow the same path to silently become both an announcer and a generic SFX according to whichever call wins a race.

The public play methods also return no voice handle. That is adequate for fire-and-forget SFX, but announcer serialization, cancellation, priority, exact ducking release, and long-lived loops eventually need a small `AudioVoiceHandle` containing at least `stop()`, `ended`, and duration/state information.

## Relevant platform capabilities

### Native Web Audio

The browser already provides almost everything needed for the first two profiles:

- `BiquadFilterNode` supplies high-pass, low-pass, low-shelf, high-shelf, peaking, notch, and related filters. A low shelf is the correct primitive for a measured bass lift; a low-pass/high-pass pair creates the radio bandwidth. [MDN: Biquad filter types](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/type)
- `WaveShaperNode` supplies nonlinear saturation/distortion and is explicitly useful for adding warmth. [MDN: WaveShaperNode](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode)
- `DynamicsCompressorNode` controls peaks and mix density. It is useful for avoiding clipping when sounds combine, but it is not a guaranteed true-peak brick-wall limiter. [MDN: DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode)
- `OfflineAudioContext` renders an audio graph to an `AudioBuffer` as fast as the implementation can process it rather than sending it to the device. This is the clean bridge back into Babylon's static sound API. [MDN: OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)
- `PannerNode` and the context listener are available if SHAG later owns spatial playback itself. [MDN: PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)
- `AudioWorklet` supports custom JavaScript or WebAssembly DSP on the audio rendering thread, but loading a custom processor requires a secure context. It should be reserved for an effect that native nodes cannot express. [MDN: AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode)

These nodes are mature, broadly available browser features. The native-node profile should still be verified on the project's actual Android WebView, Electron version, Chrome/Edge, Firefox, and Safari targets.

### Babylon Audio V2

Babylon Audio V2 already gives SHAG useful engine-level behavior:

- decoded static and streaming sounds;
- sound buffers created from `ArrayBuffer`, URL, or `AudioBuffer`;
- reusable audio buses with volume, stereo, spatial, and analyzer facilities;
- one listener that can attach to a Babylon camera;
- public routing through `outBus`;
- browser unlock and context lifecycle.

The official [`AudioEngineV2` API](https://doc.babylonjs.com/typedoc/classes/BABYLON.AudioEngineV2) documents buffer, sound, streaming, source, and bus creation. The installed source confirms that an `AudioBuffer` is accepted without another decode.

The installed package does not contain a public biquad, waveshaper, compressor, convolver, or arbitrary effect-node insert for an Audio V2 bus. Comments describe buses as a place to group sounds and apply effects, but the exposed bus surface currently provides routing, volume, analyzer, spatial, and stereo features. The implementation must target the API that exists, not the aspiration in a comment.

Do not:

- cast the engine or bus to Babylon's underscore-prefixed `_WebAudio*` classes;
- replace `mainOut._inNode` or reach through `_audioContext`;
- depend on internal subgraph order;
- create a second unrelated `AudioContext` just for effects.

Those approaches would be fragile across Babylon upgrades and could split unlock, listener, output-device, and lifecycle behavior.

## Sound-design recipes

The values below are safe starting points for an A/B prototype, not mastered shipping settings. Every comparison must be loudness matched; otherwise the louder version will usually seem more impressive even when it is less clear.

### Robotic announcer: recommended first profile

```text
decoded voice
  -> input trim (-4 to -6 dB)
  -> high-pass (140-200 Hz)
  -> low-pass (4.5-6 kHz)
  -> presence peak (1.4-2 kHz, +1 to +3 dB, broad Q)
  -> split
       |-> dry gain (about 0.80-0.90) -------------------|
       |-> mild waveshaper -> low-rate ring mod --------|-> compressor -> matched output
                                 (wet about 0.10-0.20)
```

Why this works:

- Band limiting creates an intentional radio/intercom identity.
- A small presence lift preserves consonants and objective information.
- Mild saturation adds harmonics that read as electronic without destroying words.
- Ring modulation creates metallic sidebands and a genuinely robotic timbre while keeping clip duration unchanged.
- Keeping most of the dry signal protects intelligibility.
- Compression makes short lines land consistently over combat.

Native ring modulation does not require an `AudioWorklet`: an `OscillatorNode` can modulate the gain parameter of the wet branch. Use a low modulation rate as the initial experiment and stop/disconnect the oscillator with the render graph. A small fixed frequency shift is another classic robotic effect, but native Web Audio has no dedicated frequency-shifter node.

Recommended safeguards:

- Serialize or prioritize announcer lines instead of allowing three unrelated sentences to overlap.
- Do not apply the robot treatment to all character pain/death sounds by path accident.
- Keep an `original` preset and an instant bypass for comparison and accessibility.
- Avoid long reverb and obvious echo on time-critical countdown or objective lines.
- Test on laptop speakers and inexpensive headphones, not only full-range monitors.

### "Deeper" is not the same as "more bass"

Three commonly confused operations have different results:

| Operation | What changes | Timing | Main risk |
|---|---|---|---|
| Low-shelf EQ | Tonal balance; existing bass becomes louder | Unchanged | Mud and clipping; cannot invent a missing fundamental |
| `playbackRate` / `detune` | Pitch and playback speed together | Changes | Announcements become slow/late; gameplay timing changes |
| Time-preserving pitch shift | Pitch with approximately the same duration | Approximately unchanged | CPU, latency, phase/formant artifacts |

An `AudioBufferSourceNode` playback rate below `1` explicitly plays the sample more slowly, so it is not the right default for countdowns or objective calls. [MDN: `playbackRate`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate)

If listening tests show that actual pitch reduction is essential, test it only after the timbre profile:

- Tone.js provides `PitchShift` and `FrequencyShifter` along with EQ, distortion, compression, and limiting. Its frequency shifter deliberately breaks normal harmonic relationships to produce a ring-modulator-like timbre. [Tone.js API](https://tonejs.github.io/docs/), [Tone.js FrequencyShifter](https://tonejs.github.io/docs/15.0.4/classes/FrequencyShifter.html)
- Signalsmith Stretch has an MIT-licensed Web Audio/WASM/AudioWorklet release with pitch, time, and formant controls. It is a more specialized candidate when preserving speech duration and formants is a real requirement. [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)

Both add more code, latency, platform validation, and tuning risk than the proposed native profile. Neither should be adopted before an A/B recording proves that it wins.

### Gameplay weight: do not bass-boost everything equally

A blanket boost across every sound would consume headroom, make rapid combat muddy, exaggerate footsteps and UI clicks, and cause a compressor to pump when explosions overlap. It can also make important high-frequency location cues harder to read.

Use semantic routes:

| Route | Suggested treatment | Intent |
|---|---|---|
| `announcer` | Robotic-radio chain above | New game identity; maximum speech clarity |
| `weapon` | High-pass below useful range, modest low shelf, very mild saturation | Heavier fire and impact without uncontrolled rumble |
| `explosion` | Slightly stronger low shelf with input trim | Cinematic impact; strict voice cap |
| `world` | Mostly original; optional gentle warmth | Preserve positional readability |
| `movement` | Original or extremely light EQ | Preserve timing and opponent information |
| `playerVoice` | Original or light compression | Keep character readable and distinct from announcer |
| `item` | Mostly original | Pickups must remain immediately recognizable |
| `ui` | Original and non-spatial | Avoid fatiguing clicks and menu coloration |
| `music` | Separate music mastering path | Never inherit SFX settings accidentally |

An initial enhanced weapon curve could be an input trim around `-3 dB`, a high-pass around `25-35 Hz`, and a low shelf around `80-120 Hz` at only `+1.5 to +2.5 dB`. Those values must be tuned by ear and metering against representative simultaneous combat, not one solo rocket sample.

### Announcer ducking

A short, subtle volume dip on competing sound routes may improve the announcer more than stronger distortion or EQ.

Suggested experiment:

- ramp music down roughly 2-4 dB and nonessential world SFX down 1-2 dB;
- leave critical local weapon and damage feedback alone or reduce it less;
- attack over roughly 20-50 ms;
- release smoothly after the line over roughly 150-300 ms.

This is gain automation, not compressor side-chaining. It needs announcer start/end ownership and route buses. Babylon bus volume can support route gain changes, but the current backend first needs separate buses and a voice handle or reliable buffer duration.

## Classification and compatibility

Audio should be classified semantically at the call site, with Warsow path rules as compatibility fallback.

Priority order:

1. explicit `route` in the play request;
2. a registered exact asset override;
3. normalized path-prefix rules;
4. `genericSfx` fallback.

Suggested fallback table:

| Normalized path | Route |
|---|---|
| `sounds/announcer/**` | `announcer` |
| `sounds/vsay/**` | `voiceChat` |
| `sounds/weapons/**` | `weapon` or exact `explosion` override |
| `sounds/players/**` | `playerVoice` or `movement`, selected explicitly when possible |
| `sounds/items/**` | `item` |
| `sounds/world/**`, `sounds/movers/**`, `sounds/ambient/**` | `world` |
| `sounds/bomb/**` | `objective` |
| unknown | `genericSfx` |

The path resolver belongs in engine audio code because Q3/Warsow compatibility is an asset concern. Gameplay should pass stronger semantic information where it has it. A weapon definition knows whether a sound is fire, flight, or explosion; a prefix alone does not.

One possible public contract:

```ts
export type AudioRoute =
  | "announcer"
  | "voiceChat"
  | "playerVoice"
  | "weapon"
  | "explosion"
  | "movement"
  | "item"
  | "objective"
  | "world"
  | "ui"
  | "genericSfx";

export interface SfxPlayRequest {
  path: string;
  route?: AudioRoute;
  volume?: number;
  maxInstances?: number;
  priority?: number;
  spatial?: {
    position: { x: number; y: number; z: number };
    minDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
  };
}
```

Keep the existing `playSfx2D` and `playSfx3D` signatures as compatibility wrappers while gameplay call sites migrate. Do not force unrelated systems to construct a large request for a simple click.

## Proposed load-time architecture

```text
                       profile registry
                              |
PK3 bytes -> decode -> pure route resolver -> offline effect renderer
                   |                          |
                   |                          v
                   +--------------------> processed AudioBuffer
                                                  |
                                                  v
                                  Babylon StaticSoundBuffer cache
                                                  |
                             +--------------------+--------------------+
                             v                                         v
                    route-specific 2D sound                  route-specific 3D sound
                             |                                         |
                             +-----------------> Audio V2 buses <-------+
                                                     |
                                                     v
                                                   output
```

### Core components

`AudioRouteResolver`

- Pure, deterministic, and headless-safe.
- Normalizes slashes/case exactly once.
- Applies explicit route, exact overrides, then prefix rules.
- Exposes a reason string for `audio info`, tests, and asset audits.

`AudioFxPresetRegistry`

- Contains trusted code-owned presets, not executable graphs from pk3 content.
- Gives each preset a stable version used in cache keys.
- Clamps every tunable range.
- Can resolve `original`, `enhanced`, `cinematic`, and `night` profiles.

`OfflineSfxProcessor`

- Accepts a decoded `AudioBuffer`, effect preset, and desired output sample rate.
- Builds native nodes in an `OfflineAudioContext`.
- Adds tail frames only for presets that deliberately use delay or reverb.
- Always disconnects/stops oscillators and drops intermediate references.
- On any unsupported API or render error, logs once and returns the original decoded buffer.

`AudioBufferCache`

- Deduplicates simultaneous requests with promises, as the current backend does.
- Keys processed buffers by path plus immutable preset identity.
- Keeps only profiles that are actually selected/preloaded.
- Exposes decoded duration for announcer scheduling.
- Has an explicit memory budget or least-recently-used eviction before all 320+ local sounds are multiplied by several presets.

`AudioBusGraph`

- Creates at least `announcer`, `gameplay`, `ui`, and `generic` buses under the SFX bus.
- Controls route volumes and announcer ducking now.
- Does not pretend that these Babylon buses can host native filters in the installed version.

### One context, not many

Create one `AudioContext` in the backend and pass it through Babylon's public `CreateAudioEngineAsync({ audioContext })` option. Retaining the same context also lets SHAG decode raw PK3 bytes before offline rendering without reaching into the Babylon engine instance.

The existing unlock path remains authoritative. Context creation, user-gesture resume, pause/interruption, and disposal must have exactly one owner.

### Preloading strategy

- Preload the 14 unique currently used announcer files during the normal gameplay audio preload.
- Render with bounded concurrency to avoid a load-time CPU/memory spike on mobile.
- Lazy-process the rest of the 101-file compatibility bank when it is actually requested, or add mode-specific banks later.
- Preload common local weapon and pickup sounds after announcer media, not the whole corpus.
- Cache failures as warnings only long enough to avoid log spam; a newly mounted pk3 must still be able to satisfy an earlier miss, matching current behavior.

## Future live mixer graph

Load-time processing is deliberately not the final answer for environment-wide audio states. The future graph should look approximately like this:

```text
voice source -> source gain -> optional 3D panner -> semantic route bus
                                                       |
           announcer -> voice FX ----------------------|----> SFX mix --|
           UI -----------------------------------------|                |
           weapon/world -> dry/underwater crossfade ---|                |-> master dynamics -> output
                                                                        |
           streamed music -> music bus ---------------------------------|
```

This unlocks:

- smooth underwater low-pass/high-shelf changes for sounds already playing;
- reverb or occlusion zones;
- one shared compressor/limiter after concurrent voices sum;
- route-level ducking and dynamic-range modes;
- music and weather consolidation;
- live effect tuning without rerendering caches.

The tradeoff is ownership. If Babylon has no public effect inserts when this phase begins, SHAG must either:

1. keep Babylon Audio V2 for unaffected sounds and create a carefully bounded second processed path; or
2. replace `AudioV2Sfx` with a native `WebAudioMixer` that owns buffer sources, voice caps, panners, listener sync, buses, streaming, unlock, and disposal.

The second option is cleaner long-term but recreates behavior Babylon currently supplies. It should be justified by the underwater/mixer requirement and delivered with parity tests, not hidden inside the announcer experiment.

### Underwater relationship

Underwater audio should be a listener-state mix, not another asset category:

- affect spatial world, weapon, impact, movement, and ambient routes;
- keep UI and announcer intelligible and mostly dry;
- decide separately how much local body/player voice is filtered;
- ramp the dry/wet crossfade rather than replacing nodes at the waterline;
- use the same authoritative/predicted liquid state already planned in [`WATER.md`](./WATER.md), while keeping the filter itself cosmetic and client-only.

Because the current SFX are mostly one-shots, a temporary load-time `underwater` variant can validate the sound design for newly started sounds. It cannot correctly transform an already-playing loop or explosion tail as the camera crosses the surface.

## Candidate feature matrix

| Candidate | Announcer robot | SFX weight | Live underwater/master FX | Runtime cost | Integration risk | Advantages | Disadvantages | Decision |
|---|---:|---:|---:|---|---|---|---|---|
| Native Web Audio + offline render into `AudioBuffer` | Excellent | Excellent per asset | No | One-time processing plus buffer memory | Low-medium | No dependency; public APIs; keeps Babylon playback/spatialization; deterministic preset cache; original fallback | First play/preload work; active sounds cannot morph; no shared mix limiter | **Recommended first implementation** |
| Native Web Audio per voice, wrapped with Babylon `createSoundSourceAsync` | Excellent | Good | Per voice only | Node graph per active voice | Medium | Real-time parameters; Babylon can still provide output routing/spatial features | Must own decode, `AudioBufferSourceNode`, voice caps, start/end/disposal; effects are duplicated per voice | Time-boxed announcer experiment only if offline rendering feels too static |
| Babylon Audio V2 buses alone | No | Gain only | No filters in installed `9.17.0` | Low | Low | Already integrated; useful category routing, volume, analyzer, and ducking | No public EQ/distortion/compressor insert | Use for routing, not tone generation |
| Full native `WebAudioMixer` backend | Excellent | Excellent | Excellent | Efficient shared buses; source/panner cost | High | Complete control; one coherent live graph; supports underwater, master dynamics, music, and weather | Reimplements Babylon playback/spatial lifecycle; broad regression surface | Recommended later only when live bus effects justify it |
| Tone.js | Excellent | Excellent | Excellent if it owns/routs the graph | Depends on chosen effects | Medium-high | Ready-made EQ, limiter, compressor, distortion, frequency shift, pitch shift, meters; can use a supplied context | Broad music framework for a focused game-audio need; new dependency; still requires Babylon coexistence or playback migration | Prototype advanced effects; do not add for phase 1 |
| Signalsmith Stretch Web/WASM | Pitch/formant specialist | Not needed | Per source | Higher CPU/latency; WASM/worklet | Medium-high | Serious duration-preserving pitch/time control; MIT | Solves only the optional pitch problem; worklet/platform/bundle validation | Optional later A/B candidate |
| Custom `AudioWorklet` DSP | Unlimited | Unlimited | Excellent | Audio-thread DSP | High | Exact custom vocoder, limiter, or pitch algorithm | DSP expertise, secure-context delivery, glitch testing, mobile risk | Only for a proven missing effect |
| Offline DAW/build-time asset processing | Excellent | Excellent | No | Near-zero runtime | Low runtime, medium pipeline | Best manual mastering and predictable result | Creates derived media, more storage/variants, no live settings, asset-license review | Useful final mastering option, not the runtime compatibility system |
| `playbackRate < 1` as "deep voice" | Crude | Crude | No | Very low | Low | One property | Slows calls, changes timing, sounds artificial, harms countdowns | Reject as default |
| Babylon private-node monkey patch | Possible | Possible | Possible | Low | Very high | Quick demo | Unsupported internal fields and subgraphs; upgrade and lifecycle hazards | Reject |

### Library decision

Tone.js is mature, MIT-licensed, supports a caller-supplied context, and includes nearly every effect this investigation names. [Tone.js repository and license](https://github.com/Tonejs/Tone.js), [Tone.js effect catalog](https://tonejs.github.io/docs/)

It is nevertheless not the best first choice. The required first profile uses a handful of native nodes, while Tone also brings transport, synthesis, scheduling, instruments, compatibility wrapping, and its own audio abstractions. It does not remove the hard part: deciding who owns source playback, buses, context lifecycle, spatialization, and cleanup alongside Babylon.

Reconsider Tone.js if the project wants an in-browser sound-design lab with many swappable effects, or if repeated prototyping shows that maintaining native graph helpers costs more than the dependency. If added, pin a reviewed version, use the existing shared context, import only the required modules where supported, and record its transitive licenses and built bundle impact.

## Product presets and settings

Audio treatment should be a separate preference, not tied directly to graphics detail. Biquads are cheap even when visuals are on Low, and a competitive player on a powerful GPU may still want the original dynamic, readable mix.

Suggested profiles:

| Profile | Announcer | Gameplay SFX | Dynamics | Purpose |
|---|---|---|---|---|
| `original` | Dry | Dry | Current behavior | Compatibility and instant A/B baseline |
| `enhanced` | Subtle robotic-radio | Conservative category warmth | Full range | Candidate eventual default |
| `cinematic` | Stronger wet character | More weapon/explosion weight | Mild bus compression later | Fun/"epic" presentation |
| `night` | Light voice treatment | Reduced low end and peaks | Reduced dynamic range later | Quiet speakers/headphones |

Possible cvars after confirming the existing [`Cvar`](../../src/engine/core/Cvar.ts) contract:

```text
s_audioProfile original|enhanced|cinematic|night
s_announcerFx 0|1
s_announcerWet 0..1
s_audioBass 0..1
s_dynamicRange full|reduced
s_underwaterFx 0|1        # later live-mixer phase
```

Avoid exposing raw frequencies, Q values, compressor ratios, and waveshaper curves in the normal settings screen. Put detailed tuning behind developer controls. User-facing presets make test results reproducible and prevent unsafe gain combinations.

The existing `audio` command should be extended rather than creating an unrelated command family:

```text
audio profile <original|enhanced|cinematic|night>
audio preview <path> [route]
audio info <path>
audio bypass <0|1>
audio stats
```

`audio info` should report normalized path, explicit/fallback route, preset/version, cache state, duration, channel count, sample rate, active instances, and the reason for the chosen route.

## Safety, quality, and accessibility practices

### Headroom and clipping

- Cut input gain before boosting a shelf or adding harmonics.
- Never assume the original assets share the same peak or perceived loudness.
- Test the summed worst case: rapid weapon fire, explosions, pickup, pain sound, and announcer together.
- Add a shared output dynamics stage only when it can sit after the real summed mix; per-file compression cannot prevent several individually safe voices from clipping when combined.
- Ramp parameter and bus-gain changes over a short interval to avoid zipper noise and clicks.
- Clamp presets to reviewed ranges; never execute arbitrary audio graphs or unbounded gain values from a pk3.

### Preserve competitive information

- Keep movement transients and directional cues near original.
- Do not widen or stereo-process mono 3D sources before spatialization without testing localization.
- Keep UI, damage feedback, and pickups distinct from cinematic weapon weight.
- Provide a one-action `original` profile.
- Do not let announcer processing delay the `3-2-1-fight` sequence.

### Loudness-matched evaluation

For each profile, compare at matched perceived output rather than matched gain values. At minimum record:

- peak amplitude and clipping count;
- RMS over a consistent window;
- compressor gain reduction when present;
- processed buffer render time and memory;
- first-play latency and cache-hit latency;
- active node/voice counts during a stress scene.

Web Audio has no built-in LUFS meter. A build-time measurement tool can be added later if RMS/peak plus listening tests are insufficient. Do not claim broadcast loudness compliance from an `AnalyserNode` alone.

### Licensing

Runtime processing does not remove the obligation to have rights to distribute and use the original Warsow media. It avoids committing a second set of derived files, but the source package license still governs the media. The local pk3 roots do not contain an obvious single license file covering all inspected audio, so the game's distribution/license records must be checked before release.

If Tone.js or Signalsmith Stretch is added, both projects state MIT licensing, but a dependency review must still include the pinned package and all transitive components.

## Implementation plan

### Phase 0 - listening spike

Goal: prove that the art direction is worth integrating.

1. Decode the 14 unique currently active announcer files from the mounted pk3s.
2. Render three variants with native `OfflineAudioContext`: original, subtle robot, and strong robot.
3. Add a developer-only browser A/B harness with loudness-matched output and a dry/wet slider.
4. Test representative weapon/explosion samples with `+0`, `+1.5`, and `+2.5 dB` low-shelf variants, each with compensated input trim.
5. Record settings and listening notes on laptop speakers, headphones, and Android hardware.

Exit gate: at least one announcer preset is clearly preferred at matched loudness and remains fully intelligible during a combat mix. If not, stop; no architecture should be built around an effect that only sounds novel in isolation.

### Phase 1 - semantic routes and offline processing

Likely files:

- `src/engine/audio/AudioRoutes.ts` - types, normalization, exact/prefix resolver, reason output.
- `src/engine/audio/AudioFxPresets.ts` - immutable reviewed presets and versions.
- `src/engine/audio/OfflineSfxProcessor.ts` - native node graphs and fallback.
- [`AudioV2Sfx.ts`](../../src/engine/audio/AudioV2Sfx.ts) - shared context, processed cache, route buses, route-aware sound identity.
- [`AudioManager.ts`](../../src/engine/AudioManager.ts) - request overloads, cvars, selected profile, stats.
- [`AudioCommand.ts`](../../src/engine/console/commands/AudioCommand.ts) - profile, preview, info, bypass, and stats.
- [`FPSBombAudio.ts`](../../src/games/fps/client/FPSBombAudio.ts) - explicit `announcer` route.

Work:

1. Add the pure route resolver and tests first.
2. Create and retain the one shared `AudioContext`; pass it to `CreateAudioEngineAsync`.
3. Decode PK3 bytes with that context when a processed profile is requested.
4. Render the reviewed graph offline and pass its `AudioBuffer` to Babylon.
5. Key all buffer/sound promises by path and immutable render identity.
6. Create route buses and retain the current top-level `s_sfxvolume` behavior.
7. Preload the active announcer bank with bounded concurrency.
8. Fail dry on any processor error and warn once per asset/profile.
9. Preserve current 2D/3D caps and disposal behavior.

Exit gate: processed announcer works from pk3 media in a real map, original mode is bit-for-bit the same code path as today where possible, headless remains silent/safe, and no first-use line is late.

### Phase 2 - gameplay weight and mix policy

1. Migrate FPS sound helpers to explicit semantic routes.
2. Add conservative `enhanced` and stronger `cinematic` per-route presets.
3. Introduce announcer priority/serialization and a voice handle.
4. Add route-volume ducking with ramped attack/release.
5. Add memory budgets, cache stats, and stress tests.
6. Make `original` an immediate runtime fallback; ship `enhanced` opt-in until listening and device results are complete.

Exit gate: a worst-case combat mix remains unclipped and readable, positional cues do not regress, and low-end/mobile processing stays inside measured budgets.

### Phase 3 - live environment mixer

Trigger: underwater audio, long loops, reverb zones, or shared master dynamics becomes a committed feature rather than a possibility.

1. Recheck the then-installed Babylon Audio V2 public effect API.
2. If public effect inserts exist, prototype them behind the existing backend contract.
3. Otherwise write a focused `WebAudioMixer` parity spike; do not use Babylon private nodes.
4. Consolidate music, rain, thunder, and looping ambience only after SFX parity is proven.
5. Add dry/underwater route crossfades driven by the local listener's liquid state.
6. Add a shared dynamics stage and instrumentation after the real summed mix.

Exit gate: seamless dry/wet transitions for already-playing loops and tails, equivalent or better spatialization, correct camera/listener coordinates, reliable unlock/resume on every client platform, and no leaked nodes or object URLs.

### Phase 4 - optional advanced voice DSP

Only if the native robotic profile is not enough:

1. Compare Tone.js `FrequencyShifter` and `PitchShift` against the native ring-mod profile.
2. Compare Signalsmith Stretch for a small downward pitch shift with formant compensation.
3. Measure latency, initialization, WASM/worklet payload, mobile CPU, glitches, and speech intelligibility.
4. Keep advanced pitch as an announcer-only quality option with dry fallback.

## Verification plan

### Pure and headless tests

- Normalize Windows and POSIX separators and case consistently.
- Verify explicit route wins over exact/path rules.
- Verify every compatibility prefix and unknown fallback.
- Verify preset values are finite and clamped.
- Verify cache keys change when preset version, route, or sample rate changes.
- Verify simultaneous loads share one promise.
- Verify profile failure returns the original buffer.
- Verify importing/initializing audio in Node does not require `window`, `AudioContext`, or `OfflineAudioContext`.

### Audio backend tests

- Extend `AudioV2Sfx.test.ts` with a mocked shared context, route buses, processed `AudioBuffer`, and dry fallback.
- Assert one decode/render per cache identity.
- Assert 2D and 3D playback use the same processed buffer but retain separate lifecycle behavior.
- Assert announcer and gameplay assets route to different buses.
- Assert disposal stops owned oscillators/worklets, releases active voices, clears promises, disposes buses, and closes only the context the backend owns.
- Assert a profile switch does not reuse a stale cached `StaticSound`.

Do not byte-compare offline-rendered output across different browser engines. Test graph topology, parameters, duration/tail policy, peak bounds, and broad frequency-energy properties at a fixed sample rate. Treat listening as a required product test, not something unit tests can replace.

### Required project validation for implementation

Confirm script names again in `package.json`, then run headless checks before browser listening:

```bash
npx vitest run src/engine/__tests__/AudioV2Sfx.test.ts
npm run test:simulation
npm run test:physics
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npx tsc --noEmit
npm run build
```

Audio changes are client-side and do not require the renderer/network regression suite merely because they process media. If the implementation changes networking or renderer paths while integrating underwater state, follow the stricter regression requirements in `AGENTS.md`.

### Manual/browser matrix

Test at minimum:

- Chromium desktop with headphones and speakers;
- Firefox desktop;
- Safari if it is a supported target;
- the committed Electron runtime;
- a real Android/Capacitor device, including suspend/resume and audio focus interruption;
- original/enhanced/cinematic switching before preload, after preload, and during combat;
- map change and service reset/disposal;
- missing pk3, corrupt sound, and unsupported codec fallback;
- many simultaneous explosions plus announcer and music;
- 3D localization before and after treatment;
- future waterline crossings while a loop/tail is already playing.

## Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Bass boost consumes headroom | Clipping, fatigue, compressor pumping | Input trim, small shelves, category routing, summed stress tests |
| Robot effect hides consonants | Players miss objective information | Majority dry mix, presence band, no long echo, speech-first A/B tests |
| First-play offline render is late | Missing countdown/announcement | Bounded preload of active announcer bank; dry immediate fallback if necessary |
| Multiple profiles multiply decoded memory | Mobile memory pressure | Stable cache keys, selected-profile preload only, LRU/budget, stats |
| Route inferred only from path | Wrong treatment of shared/misnamed assets | Explicit call-site route first, exact override second, prefix fallback last |
| Cached path fixes wrong bus/profile | Later calls silently reuse first construction | Route/preset-aware identity or one canonical descriptor per asset |
| Per-file compression is mistaken for mix limiting | Concurrent safe sounds can still clip | Preserve headroom now; add limiter only after a true shared sum exists |
| Babylon internal graph is patched | Upgrade and disposal failures | Public APIs only; dry fallback; full mixer as an explicit later project |
| Separate audio contexts compete | Unlock, latency, device, and lifecycle bugs | One retained context with a single owner |
| Worklet/WASM fails on a client | Silent or delayed announcer | Advanced DSP optional; feature detect; native/dry fallback |
| Aggressive processing harms competitive audio | Worse positioning and cue recognition | Keep movement/UI close to original; user-selectable original preset |
| Runtime transformation is assumed to solve licensing | Distribution risk remains | Verify original media rights and dependency licenses before release |

## Final decision matrix

| Decision | Options considered | Choice | Why |
|---|---|---|---|
| First processing mechanism | Offline Web Audio, live native nodes, Tone.js, worklet, pre-baked media | Offline native Web Audio -> Babylon `AudioBuffer` | Smallest supported integration; no dependency; preserves existing playback and 3D path |
| Announcer identity | Bass only, slowed pitch, robot timbre, full vocoder | Mostly dry robotic-radio timbre | Distinctive without changing timing; intelligibility can be controlled by wet mix |
| General sound treatment | One master bass boost, route profiles, no change | Route-specific profiles | Weapons can feel heavier without muddying movement, UI, voice, and pickups |
| Classification | Filename only, caller only, explicit plus fallback | Explicit route -> exact override -> prefix -> generic | Strong semantics for new code and broad Warsow compatibility |
| Babylon integration | Public API, private subgraph patch, replace backend immediately | Public API first | Keeps upgrade safety and limits scope |
| Audio library | Add Tone.js now, specialized pitch library, none | None for phase 1 | Native nodes cover the chosen effect; library does not solve ownership/routing by itself |
| True pitch shift | Default, optional later, never | Optional later A/B | It adds CPU/latency/artifacts and is unnecessary for the first robotic profile |
| Quality control | Tie to graphics tier, auto-only, separate audio profile | Separate audio profile | Audio preference and competitive clarity do not correlate with GPU tier |
| Underwater | Pre-render only, live bus, ignore | Live bus in later mixer phase | Listener state must affect sounds already playing while preserving UI/announcer clarity |
| Rollout | Replace current sound immediately, opt-in, permanent experiment | Opt-in through Phase 2, then decide default | Makes loudness-matched testing and safe rollback straightforward |

## Open questions for the listening spike

1. Which announcer voice variant (`01`/`02` where both exist) best survives the robotic profile?
2. Does a subtle ring mod read as intentional machinery on phone/laptop speakers, or only as rough distortion?
3. Is frequency shifting audibly better than native ring modulation enough to justify Tone.js?
4. Which sounds should count as explosions rather than generic weapons?
5. Should `vsay` receive a lighter radio effect, remain original, or get a team-communications profile?
6. How much announcer ducking is helpful before it feels like combat audio disappears?
7. What decoded-buffer memory budget is safe on the minimum Android target?
8. Does runtime use of the intended Warsow audio corpus have complete distribution/license documentation?

## Bottom line

The fun version is technically realistic: Warsow's announcer can become a SHAG-specific robotic voice, and its weapons can gain more weight without shipping replacement recordings. The disciplined version is better than a global "bass boost" switch:

- classify sounds by meaning;
- transform known short buffers with native Web Audio;
- preserve Babylon's proven playback/spatial path;
- keep the original mix one click away;
- reserve libraries and a full mixer rewrite for effects that actually need them;
- judge every preset in a loud, overlapping gameplay mix, not in solo playback.

That produces a distinctive sound identity now and leaves a clean path toward underwater hearing, ducking, reverb, and truly live "epic audio" later.
