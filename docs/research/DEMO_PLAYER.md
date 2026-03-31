# Cinematic Demo Player — Research & Design

> **Branch:** `feature/demo-player-cinematic`
> **Date:** 2026-03-31
> **Status:** Research / Design Phase

## Executive Summary

The engine already has demo recording (`.shagdemo` format), a `DemoReader` with random-access frame seeking, and a `DemoViewer` with transport controls (play/pause/seek/speed). The goal is to build a **cinematic demo player** that pre-analyzes a demo file, identifies highlight-worthy moments (multi-kills, airborne frags, streaks, impressive movement sequences), and automatically assembles a "highlight reel" that plays back like an action movie — with camera angle variety, slow-motion replays, and dramatic pacing.

Console command concept: `demoplay_cinematic <minutes>` — plays a highlight reel of the loaded demo, compressed to the given duration.

---

## 1. Existing Infrastructure

### 1.1 What We Have

| Component | File | Relevant Capabilities |
|-----------|------|-----------------------|
| Demo format | `src/games/fps/server/DemoRecorder.ts` | Full-snapshot `.shagdemo` with index table, random-access seeking |
| Demo reader | `src/shared/demo/DemoReader.ts` | `readHeader()`, `readIndex()`, `readFrame(i)`, `findFrameByTick(t)`, binary search |
| Demo viewer | `src/games/fps/client/DemoViewer.ts` | State machine (idle→loaded→playing→paused→ended), speed control (0.25x–4x), seek-to-frame/tick/progress |
| Spectator camera | `src/engine/camera/controllers/SpectatorController.ts` | Chase-cam following entity with smoothing |
| Freefly camera | `src/engine/camera/controllers/FreeflyController.ts` | Noclip 6DOF camera, configurable speed |
| Camera system | `src/engine/camera/CameraSystem.ts` | Controller switching (`fps`, `freefly`, `spectator`), perspective/ortho modes |
| Player cycling | `src/engine/camera/controllers/SpectatorCycling.ts` | Enumerate alive entities, next/prev cycle |
| Award system | `src/games/fps/server/gametypes/AwardTracker.ts` | Kill streaks (5=on_fire, 10=raging, 20=unstoppable), first blood |
| HUD overlay | `src/games/fps/client/DemoViewerHUD.ts` | Timeline scrubber, play/pause, speed, player list |

### 1.2 Key Data Available in Demo Frames

Each `DemoFrame` contains a full `GameState` snapshot with:

- **Events per frame:**
  - `death` — entityId, killerId, weaponId, victim position (x,y,z), victim velocity (velX,velY,velZ)
  - `damage` — entityId, attackerId, damage amount, weaponId, position
  - `weapon_fire` — entityId, weaponId, origin, direction
  - `projectile_impact` — defId, position, surface normal
  - `combat_state` — entityId, health, armor, dead flag
  - `award` — awardType (frag, first_blood, on_fire, raging, unstoppable), playerId, value

- **Entity components:**
  - `transform` — position {x,y,z}, rotation {yaw,pitch}
  - `velocity` — linear {x,y,z}, **grounded** flag
  - `health`, `armor`, `weapon` state

This data is sufficient for detecting highlights without any server-side changes.

---

## 2. Highlight Detection — The Analysis Pass

The core innovation: **pre-read the entire demo and score every moment** before playback begins. This produces a timeline of scored "highlight candidates" that the sequence builder can pick from.

### 2.1 DemoAnalyzer — Frame-by-Frame Scoring

```
DemoReader.readAllFrames() → DemoAnalyzer.analyze() → HighlightTimeline
```

#### Frag Events to Detect

| Highlight Type | Detection Logic | Score Weight |
|----------------|----------------|-------------|
| **Multi-kill** (double, triple, mega) | Same killer, 2–3+ kills within 5–10 seconds (100–200 ticks at 20Hz) | High (3–5× per extra kill) |
| **Airborne frag** | Killer entity `velocity.grounded === false` at time of death event | Medium-High |
| **Rocket jump frag** | Killer airborne + high upward velocity (velY > threshold) + frag | High |
| **Long-range rail/shaft** | Distance between killer and victim positions > threshold at death | Medium |
| **First blood** | `award.awardType === 'first_blood'` event | Medium |
| **Kill streak active** | `award.awardType === 'on_fire' | 'raging' | 'unstoppable'` | High (scales with streak) |
| **Revenge kill** | Player A kills Player B shortly after B killed A | Low-Medium |
| **Close-range finish** | Distance < melee range at death, implies shotgun/melee style | Medium |
| **Low-HP frag** | Killer health < 25 at time of kill (clutch kill) | Medium |
| **Weapon variety** | Quick weapon switches between kills (detected via weapon_fire events) | Low-Medium |

#### Movement Events to Detect

| Highlight Type | Detection Logic | Score Weight |
|----------------|----------------|-------------|
| **Sustained air time** | Entity airborne (`grounded === false`) for N+ consecutive frames | Medium |
| **High-speed run** | `sqrt(velX² + velZ²)` exceeds speed threshold over sustained period | Medium |
| **Trick jump sequence** | Alternating grounded/airborne states with increasing speed | Medium-High |
| **Height gain** | Large positive Y displacement over short period (rocket jump, ramp jump) | Medium |

#### Scoring Algorithm

```typescript
interface HighlightCandidate {
  startTick: number;       // when the action sequence begins
  peakTick: number;        // the "money shot" moment (the frag itself)
  endTick: number;         // when the sequence concludes
  score: number;           // composite score (higher = more highlight-worthy)
  type: HighlightType;     // 'multi_kill' | 'airborne_frag' | 'streak_kill' | etc.
  primaryPlayer: string;   // the player this highlight is about
  weaponId?: string;       // weapon used
  killCount?: number;      // for multi-kills
  tags: string[];          // ['airborne', 'rocket_jump', 'low_hp', etc.]
}
```

**Composite scoring** — tags stack multiplicatively:
- Base frag: 10 points
- Airborne: ×1.5
- Multi-kill: ×(1 + 0.5 per extra kill)
- Low HP clutch: ×1.3
- Kill streak active: ×1.2
- Rocket jump: ×1.8
- First blood: ×1.5

A rocket-jump triple-kill at low HP would score: `10 × 1.8 × 2.0 × 1.3 = 46.8` vs a normal frag at `10`.

### 2.2 Context Window

Each highlight needs a **lead-in** and **follow-through**:

- **Lead-in:** 3–8 seconds before the peak moment (shows the approach, the jump, the positioning)
- **Peak:** The frag/action itself
- **Follow-through:** 1–3 seconds after (shows the aftermath, gib physics, next move)
- **Total window:** ~6–15 seconds per highlight segment

The lead-in length depends on what preceded the frag:
- If a cool movement sequence led to it → longer lead-in (show the run-up)
- If the frag was part of a multi-kill → extend window to cover all kills
- Standing-still rail shot → shorter lead-in, focus on the hit

---

## 3. Sequence Builder — Assembling the Reel

Given a target duration (e.g. `demoplay_cinematic 2` = 2 minutes), the sequence builder selects and orders highlights:

### 3.1 Selection Algorithm

```
1. Sort highlights by score (descending)
2. Calculate budget: target_duration / avg_segment_length = N segments
3. Greedily pick top-N highlights
4. Remove overlapping/adjacent highlights (merge multi-kills into single segments)
5. Sort selected highlights chronologically (preserve demo timeline)
6. Insert transitions between segments
```

### 3.2 Segment Types

Each segment in the final reel is one of:

| Segment Type | Duration | Camera | Speed | When Used |
|--------------|----------|--------|-------|-----------|
| **First-person frag** | 4–8s | Chase-cam (SpectatorController) locked to killer | 1.0x | Default for most frags |
| **Third-person action** | 5–10s | Freefly positioned behind/above killer | 1.0x | For movement sequences leading to frags |
| **Slow-motion replay** | 3–6s | Same segment replayed at 0.25x–0.5x | 0.25x–0.5x | Top-scored highlights get an instant replay |
| **Freefly cinematic** | 4–8s | Scripted freefly orbit around action | 0.5x–1.0x | For multi-kills, showing the arena |
| **Establishing shot** | 2–4s | Wide freefly overview of the map | 1.0x | Opening segment, transitions between players |
| **Transition / crossfade** | 0.5–1.5s | Blend between cameras | — | Between segments |

### 3.3 Camera Scripting Presets

These are **prescripted camera behaviors** that can be applied to any highlight regardless of map or demo content. They work because they're relative to the action, not absolute positions:

#### Preset: "Chase Hero"
```
Camera: SpectatorController following killer
Timing: Lead-in through follow-through at 1.0x
Best for: Standard frags, weapon skill showcases
```

#### Preset: "Orbit Kill"
```
Camera: Freefly, starts behind killer, orbits 90° around during frag
Timing: Start 3s before frag, orbit during, hold 2s after
Best for: Multi-kills, arena overview
Speed: 0.5x during the kill moment
```

#### Preset: "Rocket Jump Hero"  
```
Camera: Freefly, positioned below the jump arc looking up
Timing: Start at jump, follow the arc, switch to chase-cam at apex
Best for: Airborne frags, trick jumps
Speed: 0.75x during flight, 0.25x at frag moment
```

#### Preset: "Victim POV"
```
Camera: SpectatorController following the victim
Timing: 2s before death, showing what the victim saw
Best for: Surprise attacks, flanks, dramatic deaths
```

#### Preset: "Dramatic Zoom"
```
Camera: Freefly, starts wide, quickly dollies in to the frag
Timing: Wide shot 2s before, zoom during approach, tight on impact
Best for: Long-range shots, rail kills
```

#### Preset: "Replay Orbit"
```
Camera: Freefly, slow 360° orbit around the kill position at 0.25x speed
Timing: Replays the peak moment from a different angle
Best for: Instant replays of top highlights
```

### 3.4 Camera Angle Selection Logic

The system picks camera presets based on highlight tags:

```
if (highlight.tags.includes('rocket_jump') || highlight.tags.includes('airborne'))
  → "Rocket Jump Hero" or "Third-person action"
  
if (highlight.tags.includes('multi_kill'))
  → "Orbit Kill" (shows the arena and all victims)
  
if (highlight.tags.includes('long_range'))
  → "Dramatic Zoom" or "Victim POV"
  
if (highlight.score > TOP_10_PERCENT_THRESHOLD)
  → append "Replay Orbit" as instant replay after main segment

default → "Chase Hero" (first-person, reliable, always works)
```

### 3.5 Prescripted Freefly Paths

Freefly paths are computed **relative to the action**, making them map-agnostic:

```typescript
interface CameraKeyframe {
  tick: number;                    // when in the demo timeline
  position: { x: number; y: number; z: number };  // world position
  lookAt: { x: number; y: number; z: number };     // look-at target
  fov?: number;                    // optional FOV override
  speed?: number;                  // playback speed at this keyframe
}

interface CameraPath {
  keyframes: CameraKeyframe[];
  interpolation: 'linear' | 'catmull_rom' | 'ease_in_out';
}
```

**Computing freefly positions from action data:**

```
killerPos = entity.transform.position at peakTick
victimPos = death event position

// "Behind killer" offset
behindKiller = killerPos - (killerForward * 200) + (0, 80, 0)

// "Orbit" positions (circle around midpoint of killer↔victim)
midpoint = (killerPos + victimPos) / 2
orbitRadius = distance(killerPos, victimPos) * 0.8
orbitPos(angle) = midpoint + (cos(angle) * orbitRadius, 60, sin(angle) * orbitRadius)

// "Below jump arc" for airborne
belowArc = killerPos - (0, 100, 0)  // look up at the jumper
```

These offsets work on any map because they're relative to the players.

---

## 4. Playback Engine — CinematicDemoPlayer

### 4.1 Architecture

```
                    ┌──────────────────────────────────┐
                    │      demoplay_cinematic 2         │
                    └─────────────┬────────────────────┘
                                  │
                    ┌─────────────▼────────────────────┐
                    │        DemoAnalyzer               │
                    │  Pre-reads all frames             │
                    │  Detects highlights               │
                    │  Scores & ranks                   │
                    └─────────────┬────────────────────┘
                                  │ HighlightCandidate[]
                    ┌─────────────▼────────────────────┐
                    │      SequenceBuilder              │
                    │  Selects top highlights           │
                    │  Assigns camera presets           │
                    │  Builds segment timeline          │
                    │  Inserts transitions              │
                    └─────────────┬────────────────────┘
                                  │ CinematicSegment[]
                    ┌─────────────▼────────────────────┐
                    │    CinematicDemoPlayer            │
                    │  Extends DemoViewer               │
                    │  Manages segment playback         │
                    │  Controls camera per segment      │
                    │  Handles speed changes            │
                    │  Drives transitions               │
                    └─────────────┬────────────────────┘
                                  │
                    ┌─────────────▼────────────────────┐
                    │  CameraSystem + DemoViewer        │
                    │  (existing infrastructure)        │
                    └──────────────────────────────────┘
```

### 4.2 CinematicSegment

```typescript
interface CinematicSegment {
  // Timeline
  startTick: number;
  endTick: number;
  durationMs: number;
  
  // Camera
  cameraPreset: string;           // 'chase_hero' | 'orbit_kill' | 'rocket_jump_hero' | etc.
  cameraTarget?: string;          // entity ID to follow (for chase-cam modes)
  cameraPath?: CameraKeyframe[];  // for freefly scripted paths
  
  // Playback
  playbackSpeed: number;          // 0.25–4.0
  speedKeyframes?: { tick: number; speed: number }[];  // for speed ramps within segment
  
  // Metadata
  highlightType: string;
  isReplay: boolean;              // true = instant replay of previous segment
  
  // Transitions
  transitionIn: 'cut' | 'crossfade' | 'white_flash';
  transitionOut: 'cut' | 'crossfade' | 'fade_to_black';
  transitionDurationMs: number;
}
```

### 4.3 Playback Loop

```
each render frame:
  1. Check if current segment has ended (tick >= segment.endTick)
     → If yes, advance to next segment
     → Apply transition effect
     → Switch camera controller/target
     → Seek DemoViewer to new segment's startTick
     
  2. Apply speed keyframes for current segment
     → DemoViewer.setSpeed(currentSpeedForTick)
     
  3. DemoViewer.update(deltaMs) advances frames normally
  
  4. If segment.cameraPath exists:
     → Interpolate camera position/lookAt from keyframes
     → Override FreeflyController position directly
     
  5. If segment uses chase-cam:
     → Ensure SpectatorController target = segment.cameraTarget
```

### 4.4 Transition Effects

| Effect | Implementation | Use Case |
|--------|---------------|----------|
| **Cut** | Instant camera switch, no blending | Between similar angles |
| **Crossfade** | Alpha blend between two render targets (or just quick dissolve via post-process) | Between different players/locations |
| **White flash** | Brief white overlay + fade | High-energy moments, multi-kill starts |
| **Fade to black** | Gradual darkness | End of reel, dramatic pauses |
| **Speed ramp** | Gradual speed change (1.0x → 0.25x → 1.0x) | Leading into slow-motion replay |

Simplest initial implementation: **cut** for everything, add fancier transitions later.

---

## 5. UI/UX — How Users Interact With This

There are **three entry points** to the cinematic demo player, ranging from zero-friction GUI to power-user console commands.

### 5.1 Entry Point 1: Lobby UI — Demo Cards (Primary)

The lobby already has a **DEMOS tab** with demo cards showing map, gametype, players, duration, date. Currently the "VIEW DEMO" button downloads the `.shagdemo` file. This needs to become the main entry point.

**Changes to existing demo cards:**

```
┌──────────────────────────────────────────┐
│  AEROWALK                    DUEL        │  ← banner (existing)
├──────────────────────────────────────────┤
│  player1 vs player2                      │  ← players (existing)
│  8:42  ·  Mar 19, 10:28am  ·  1.2 MB    │  ← meta (existing)
├──────────────────────────────────────────┤
│  ▶ PLAY DEMO    ⚡ HIGHLIGHTS            │  ← NEW: two buttons
└──────────────────────────────────────────┘
```

| Button | Action |
|--------|--------|
| **▶ PLAY DEMO** | Fetch demo from server, load into DemoViewer, enter full demo playback with existing HUD (timeline, speed controls, player list) |
| **⚡ HIGHLIGHTS** | Fetch demo, run DemoAnalyzer, open duration picker, then play cinematic reel |

**Highlights duration picker** — a small modal/dropdown when clicking HIGHLIGHTS:

```
┌─────────────────────────┐
│  HIGHLIGHT REEL          │
│                          │
│  Duration:               │
│  [1 min] [2 min] [5 min] │
│                          │
│  [ ▶ PLAY HIGHLIGHTS ]  │
└─────────────────────────┘
```

Clicking a duration button selects it (highlighted), then "PLAY HIGHLIGHTS" starts analysis + playback.

**Demo fetching** — both buttons need to fetch the demo from the server. The lobby server already serves demos as static files at `/data/demos/{filename}`. The client fetches the file via HTTP, decompresses (gzip → raw bytes), and feeds it to DemoReader. This replaces the current download-link behavior.

```typescript
// Lobby demo card button handler (replaces current download link)
async function loadAndPlayDemo(filename: string, cinematic?: { durationMinutes: number }) {
  const response = await fetch(`/data/demos/${filename}`);
  const data = new Uint8Array(await response.arrayBuffer());
  
  if (cinematic) {
    // Analyze → build sequence → play cinematic
    cinematicPlayer.loadAndPlay(data, cinematic.durationMinutes);
  } else {
    // Normal demo playback
    demoViewer.load(data);
    demoViewer.play();
  }
}
```

### 5.2 Entry Point 2: Console Commands (Power User)

For users who prefer the console, or for demos loaded from other sources.

#### Demo listing from lobby server

```
demolist
  - Requests demo list from connected lobby server (demos:list message)
  - Prints formatted table to console:

    #   MAP          TYPE   PLAYERS              DURATION  DATE
    1   aerowalk     duel   player1 vs player2   8:42      Mar 19, 10:28
    2   bloodrun     ffa    alice, bob, carl      12:15     Mar 18, 22:10
    3   toxicity     tdm    team1 vs team2        9:30      Mar 18, 20:45
    ...

demolist <filter>
  - Filter by map or player name
  - Example: demolist aerowalk
  - Example: demolist player1
```

#### Demo loading and playback

```
demo <number|filename>
  - Load a demo by list number or filename
  - Example: demo 1                   (loads #1 from demolist)
  - Example: demo aerowalk_duel_20260319_092800.shagdemo

demoplay
  - Play loaded demo from current position (normal playback)

demoplay_cinematic <minutes>
  - Analyze loaded demo, build highlight reel, play for <minutes> duration
  - Example: demoplay_cinematic 2

demoplay_stop
  - Stop any demo playback (normal or cinematic), return to idle

demoplay_analyze
  - Run analysis only, print highlight summary to console:

    HIGHLIGHT ANALYSIS — aerowalk_duel_20260319_092800.shagdemo
    Found 23 highlights in 8:42 demo

    #   TICK    SCORE  TYPE             PLAYER    TAGS
    1   4820    46.8   multi_kill (3)   player1   airborne, rocket_jump, low_hp
    2   7100    32.0   airborne_frag    player2   rail, long_range
    3   1200    25.0   first_blood      player1   shotgun, close_range
    4   9500    22.5   streak_kill      player1   on_fire, rocket
    ...

    Top 2-minute reel would include highlights: 1, 2, 3, 4, 7, 9, 12
```

### 5.3 Entry Point 3: In-Game Demo Viewer Controls

When a demo is playing (normal mode via DemoViewerHUD), add a button to switch into cinematic mode:

```
┌──────────────────────────────────────────────────────────────┐
│  ◄◄  ▶  ►►  │  1:23 / 8:42  │  1.0x  │  [⚡ HIGHLIGHTS]    │  ← existing HUD + new button
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  player1 ▾       │
└──────────────────────────────────────────────────────────────┘
```

Clicking "HIGHLIGHTS" while a demo is loaded opens the same duration picker, then switches to cinematic mode.

### 5.4 Cinematic Playback HUD

During cinematic playback, the HUD changes to a minimal "movie mode" overlay:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────────────────────┐                             │
│  │  ⚡ HIGHLIGHT 3/12          │   ← top-left: segment info  │
│  │  TRIPLE KILL — player1      │                             │
│  │  rocket_launcher             │                             │
│  └─────────────────────────────┘                             │
│                                                              │
│                                                              │
│                     (game renders here)                       │
│                                                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  0:45 / 2:00    ████████░░░░░░░░░░   ▶ 0.25x  REPLAY  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                     ↑ bottom bar: cinematic progress          │
└──────────────────────────────────────────────────────────────┘
```

**Top-left info card** (auto-hides after 3s):
- Current highlight number / total
- Highlight type in human-readable form ("TRIPLE KILL", "AIRBORNE FRAG", "FIRST BLOOD")
- Player name
- Weapon used
- Tags as small badges (if replay: "REPLAY" badge)

**Bottom progress bar:**
- Shows progress through the **cinematic reel** (not the full demo)
- Current time / total reel duration
- Current playback speed (shows "0.25x" during slow-mo)
- "REPLAY" label when showing instant replay
- Click to scrub through the reel (jumps between segments)

**Keyboard controls during cinematic:**

| Key | Action |
|-----|--------|
| Space | Pause / resume cinematic |
| Escape | Exit cinematic, return to normal demo viewer |
| Right arrow | Skip to next highlight segment |
| Left arrow | Go back to previous highlight segment |
| + / - | Adjust reel playback speed globally |

### 5.5 Lobby → Demo → Cinematic Flow (Full Journey)

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  LOBBY   │────▶│  DEMO CARDS  │────▶│  LOADING     │────▶│  DEMO VIEWER     │
│  (main)  │     │  (demos tab) │     │  (fetch +    │     │  (normal HUD)    │
│          │     │              │     │   decompress)│     │                  │
└──────────┘     └──────┬───────┘     └──────────────┘     └────────┬─────────┘
                        │                                           │
                   click ⚡                                    click ⚡
                   HIGHLIGHTS                                  HIGHLIGHTS
                        │                                           │
                        ▼                                           ▼
                ┌───────────────┐                          ┌───────────────┐
                │ DURATION      │                          │ DURATION      │
                │ PICKER        │                          │ PICKER        │
                │ [1] [2] [5]   │                          │ [1] [2] [5]   │
                └───────┬───────┘                          └───────┬───────┘
                        │                                           │
                        ▼                                           ▼
                ┌───────────────────────────────────────────────────────────┐
                │  ANALYZING...  (progress bar, <1 second for most demos)  │
                └───────────────────────────┬───────────────────────────────┘
                                            │
                                            ▼
                ┌───────────────────────────────────────────────────────────┐
                │  CINEMATIC PLAYBACK                                       │
                │  (cinematic HUD, auto-plays through highlights)          │
                │                                                           │
                │  ESC → back to normal demo viewer                        │
                │  Reel ends → "REPLAY?" prompt or back to demo viewer     │
                └───────────────────────────────────────────────────────────┘
```

### 5.6 Console Command: `demolist` — Lobby Demo Browser

Currently the only way to see demos is the lobby UI tab. A console `demolist` command adds a power-user path:

```typescript
// Implementation sketch
class DemoListCommand extends Command {
  name = 'demolist';
  description = 'List available demos from lobby server';
  
  async execute(args: string[]): Promise<string> {
    // 1. Request demo list via LobbyClient.requestDemoList()
    // 2. Wait for demos:list_response
    // 3. Optionally filter by args[0] (map name, player name)
    // 4. Format as table and return
  }
}

class DemoCommand extends Command {
  name = 'demo';
  description = 'Load a demo by number (from demolist) or filename';
  
  async execute(args: string[]): Promise<string> {
    // If arg is a number: look up in cached demolist, fetch from server
    // If arg is a filename: fetch from /data/demos/{filename}
    // Load into DemoViewer
  }
}
```

This requires the console to have access to LobbyClient (for the demo list request) and to the HTTP fetch path (for downloading the demo file). The existing command pattern (`Command` base class in `src/engine/console/Command.ts`) supports async `execute()` which is needed for the fetch + decompress step.

### 5.7 Configuration CVars

```
cin_lead_in_min 3          // minimum lead-in seconds before peak moment
cin_lead_in_max 8          // maximum lead-in seconds
cin_follow_through 2       // seconds after peak moment
cin_replay_threshold 40    // minimum score to get an instant replay
cin_multi_kill_window 10   // seconds to group kills as multi-kill
cin_transition_type cut     // default transition (cut|crossfade|flash)
cin_show_hud 1             // show player names, weapon, health during playback
cin_speed_ramp 1           // enable speed ramps (slow-mo into highlights)
```

---

## 6. Implementation Plan — Detailed Task Lists

### Prerequisites / Notes

- **Browser gzip:** Already handled. `DemoReader.fromFile()` uses `DecompressionStream` API in browser, `zlib.gunzipSync()` in Node. No work needed.
- **Command auto-discovery:** Commands in `src/engine/console/commands/` matching `*Command.ts` are auto-registered via Vite glob import. Just create the file with `export default class`.
- **Camera switching:** `CameraSystem.getInstance().setController('spectator' | 'freefly')` detaches current, attaches new. `SpectatorController.setSpectateTarget(entityId)` switches chase-cam target.
- **FreeflyController position:** `FreeflyController.setPosition(Vector3)` directly sets camera world position. For scripted paths we set position + rotation each frame.
- **Snapshot rate:** Demos record at `snapshotRate` (typically 20Hz = 50ms/frame). A 10-min demo = 12,000 frames. `readAllFrames()` iterates all via the index table.

---

### Phase 1: DemoAnalyzer — Highlight Detection

**Goal:** Pure data module that reads a demo and produces scored `HighlightCandidate[]`. No rendering, no Babylon dependencies. Runs in browser or Node.

**New files:**
- `src/shared/demo/DemoAnalyzer.ts`
- `src/shared/demo/__tests__/DemoAnalyzer.test.ts`

#### Types

```typescript
// src/shared/demo/DemoAnalyzer.ts

type HighlightType =
  | 'frag'             // standard kill
  | 'multi_kill'       // 2+ kills in window
  | 'airborne_frag'    // killer not grounded
  | 'streak_kill'      // during kill streak
  | 'first_blood'      // first kill of match
  | 'movement'         // pure movement highlight (no kill)

type HighlightTag =
  | 'airborne' | 'rocket_jump' | 'low_hp' | 'close_range'
  | 'long_range' | 'multi_kill' | 'revenge' | 'first_blood'
  | 'on_fire' | 'raging' | 'unstoppable' | 'high_speed'
  | 'trick_jump' | 'height_gain'

interface HighlightCandidate {
  startTick: number
  peakTick: number
  endTick: number
  score: number
  type: HighlightType
  primaryPlayer: string       // entity ID of the "hero" of this highlight
  primaryPlayerName: string   // display name
  victimPlayer?: string       // entity ID of victim (for frags)
  weaponId?: string
  killCount?: number
  tags: HighlightTag[]
  // Positions at peak tick (for camera path generation later)
  killerPos?: { x: number; y: number; z: number }
  victimPos?: { x: number; y: number; z: number }
  killerVelocity?: { x: number; y: number; z: number }
}

interface DemoAnalysis {
  highlights: HighlightCandidate[]
  demoHeader: DemoHeader
  totalTicks: number
  totalDurationMs: number
  playerStats: Map<string, { kills: number; deaths: number; name: string }>
}
```

#### Tasks

- [ ] **1.1 — DemoAnalyzer class skeleton**
  Create class with `analyze(reader: DemoReader): DemoAnalysis`. Calls `reader.readAllFrames()`, iterates frames, delegates to detection methods. Returns sorted highlights.

- [ ] **1.2 — Per-player state tracker**
  Internal state accumulated across frames:
  ```typescript
  interface PlayerTracker {
    entityId: string
    name: string
    kills: number
    deaths: number
    killStreak: number
    lastKillTick: number          // for multi-kill detection
    recentKills: Array<{ tick: number; victimId: string }>  // sliding window
    lastDeathTick: number         // for revenge detection
    lastKilledBy: string | null   // for revenge detection
    consecutiveAirFrames: number  // for sustained air time
    lastGrounded: boolean
    positionHistory: Array<{ tick: number; x: number; y: number; z: number }>  // ring buffer, last ~100 frames
  }
  ```
  Initialize from demo header player roster. Update each frame from entity data.

- [ ] **1.3 — Death event extraction**
  For each frame, scan `state.events` for `type === 'death'`. Extract killerId, entityId (victim), weaponId, positions, velocities. Create base `HighlightCandidate` with `type: 'frag'`, `score: 10`, `peakTick = frame.tick`.

  Key: resolve entity IDs. Death events use entity IDs like `player_abc123`. The killer entity needs to be looked up in `state.entities` to get its transform/velocity components at that tick.

  Implementation detail — getting killer entity state at time of kill:
  ```typescript
  const killerEntity = state.entities.get(deathEvent.killerId);
  const killerTransform = killerEntity?.getComponent('transform');
  const killerVelocity = killerEntity?.getComponent('velocity');
  ```

- [ ] **1.4 — Airborne frag detection**
  At time of death event, check killer entity's velocity component: `velocity.grounded === false`. Add tag `'airborne'`. If also `velocity.linear.y > 150` (high upward velocity), add `'rocket_jump'` tag.

  Score multipliers: airborne ×1.5, rocket_jump ×1.8 (applied after all tags collected).

- [ ] **1.5 — Multi-kill grouping**
  After all death events extracted, group by killer: if same killer has 2+ kills within `MULTI_KILL_WINDOW` ticks (default: 200 ticks = 10s at 20Hz), merge into a single `'multi_kill'` highlight. Set `killCount`, extend `startTick`/`endTick` to cover all kills, set `peakTick` to last kill.

  Score: ×(1 + 0.5 per extra kill). Triple = ×2.0, quad = ×2.5.

- [ ] **1.6 — Distance-based tags**
  Calculate distance between killer and victim at death: `sqrt(dx² + dy² + dz²)`.
  - `> 1500` units → `'long_range'` tag
  - `< 150` units → `'close_range'` tag

  Positions come from: killer's transform component at peakTick, victim position from death event data (x, y, z fields).

- [ ] **1.7 — Combat state correlation (low HP kills)**
  Scan for `combat_state` events in same frame or recent frames for the killer entity. If killer health < 25 at time of kill → `'low_hp'` tag, ×1.3.

  Alternatively, check death events in reverse: if killer dies within 100 ticks after killing someone, the earlier kill was a clutch.

- [ ] **1.8 — Award event correlation**
  Scan for `type === 'award'` events. Map award types to tags:
  - `'first_blood'` → `'first_blood'` tag, ×1.5
  - `'on_fire'` → `'on_fire'` tag, ×1.2
  - `'raging'` → `'raging'` tag, ×1.4
  - `'unstoppable'` → `'unstoppable'` tag, ×1.6

  Correlate with nearest death event for the same player (award and kill are in the same frame from SnapshotBuilder).

- [ ] **1.9 — Revenge kill detection**
  Track `lastKilledBy` per player. When player kills someone who recently killed them (within 200 ticks), add `'revenge'` tag. Low score boost (×1.1) — it's a nice-to-show tag but not a primary selector.

- [ ] **1.10 — Movement highlight detection**
  Per-frame entity scanning (runs on all player entities each frame):
  - Track `consecutiveAirFrames`: increment when `velocity.grounded === false`, reset when grounded.
  - If `consecutiveAirFrames > 40` (~2s airborne), create a `'movement'` highlight with `'trick_jump'` tag.
  - Track horizontal speed: `sqrt(vel.linear.x² + vel.linear.z²)`. If exceeds 600 for 20+ consecutive frames, `'high_speed'` tag.
  - Track Y position: if position.y increases by >200 units within 10 frames, `'height_gain'` tag (rocket jump arc).

  Movement highlights have lower base score (5) — they're fillers when not enough frags.

- [ ] **1.11 — Context window calculation**
  For each highlight, compute `startTick` and `endTick`:
  ```
  leadin = clamp(3s, 8s) converted to ticks
  followthrough = 2s in ticks
  
  // Extend leadin if there's interesting movement before the frag
  if (movement highlight overlaps leadin window):
    leadin = max(leadin, distance_to_movement_start)
  
  startTick = peakTick - leadin_ticks
  endTick = peakTick + followthrough_ticks
  
  // Clamp to demo bounds
  startTick = max(0, startTick)
  endTick = min(totalTicks, endTick)
  ```

- [ ] **1.12 — Composite score calculation**
  After all tags collected for a highlight, apply multipliers:
  ```typescript
  const MULTIPLIERS: Record<HighlightTag, number> = {
    airborne: 1.5,
    rocket_jump: 1.8,  // replaces airborne if both present
    low_hp: 1.3,
    multi_kill: 1.0,   // handled separately via killCount
    close_range: 1.1,
    long_range: 1.2,
    revenge: 1.1,
    first_blood: 1.5,
    on_fire: 1.2,
    raging: 1.4,
    unstoppable: 1.6,
    high_speed: 1.2,
    trick_jump: 1.3,
    height_gain: 1.2,
  };
  
  let score = BASE_SCORE;  // 10 for frags, 5 for movement
  for (tag of highlight.tags) score *= MULTIPLIERS[tag];
  if (highlight.killCount) score *= (1 + 0.5 * (killCount - 1));
  ```

- [ ] **1.13 — Final sort and dedup**
  Sort by score descending. Remove highlights whose `[startTick, endTick]` ranges overlap with a higher-scored highlight (keep the better one). Return `DemoAnalysis`.

- [ ] **1.14 — Unit tests**
  Test with manually constructed `DemoFrame[]` arrays (no real demo files needed):
  - Test: single frag → 1 highlight, score = 10
  - Test: airborne frag → tags include 'airborne', score > 10
  - Test: two kills within window → merged into multi_kill, killCount = 2
  - Test: two kills outside window → two separate highlights
  - Test: low HP kill → 'low_hp' tag
  - Test: first_blood award → correlated with frag highlight
  - Test: movement-only (sustained air) → movement highlight
  - Test: overlapping highlights → lower-scored one removed
  - Test: empty demo (no events) → empty highlights array

  Helper: `createMockFrame(tick, events, entities)` factory that builds `DemoFrame` with correct `GameState` structure.

---

### Phase 2: SequenceBuilder — Reel Assembly

**Goal:** Given `HighlightCandidate[]` + target duration in minutes, produce `CinematicSegment[]` ready for playback. Pure data, no rendering.

**New files:**
- `src/shared/demo/SequenceBuilder.ts`
- `src/shared/demo/__tests__/SequenceBuilder.test.ts`

#### Types

```typescript
type CameraPresetId =
  | 'chase_hero'         // first-person chase-cam on killer
  | 'orbit_kill'         // freefly orbit around action midpoint
  | 'rocket_jump_hero'   // freefly below jump arc, looking up
  | 'victim_pov'         // chase-cam on victim before death
  | 'dramatic_zoom'      // freefly wide→tight dolly
  | 'replay_orbit'       // slow 360° orbit for instant replay

type TransitionType = 'cut' | 'crossfade' | 'white_flash' | 'fade_to_black'

interface CinematicSegment {
  startTick: number
  endTick: number
  durationMs: number       // (endTick - startTick) / snapshotRate * 1000 / playbackSpeed
  
  cameraPreset: CameraPresetId
  cameraTarget?: string    // entity ID for chase-cam presets
  
  playbackSpeed: number
  speedKeyframes?: Array<{ tick: number; speed: number }>
  
  highlight: HighlightCandidate  // source highlight (for HUD display)
  isReplay: boolean
  segmentIndex: number     // position in the reel (0-based)
  
  transitionIn: TransitionType
  transitionOut: TransitionType
  transitionDurationMs: number
}

interface CinematicReel {
  segments: CinematicSegment[]
  totalDurationMs: number
  totalSegments: number
  demoHeader: DemoHeader
  snapshotRate: number
}
```

#### Tasks

- [ ] **2.1 — SequenceBuilder class skeleton**
  `build(analysis: DemoAnalysis, targetDurationMinutes: number, snapshotRate: number): CinematicReel`

- [ ] **2.2 — Highlight selection with budget**
  ```
  1. targetMs = targetDurationMinutes * 60 * 1000
  2. avgSegmentMs = 8000  // 8 seconds average per segment
  3. maxSegments = floor(targetMs / avgSegmentMs)
  4. Sort highlights by score descending
  5. selectedHighlights = []
  6. for each highlight (by score):
     - if overlaps with already-selected highlight (within 2s buffer): skip
     - selectedHighlights.push(highlight)
     - if selectedHighlights.length >= maxSegments: break
  7. Sort selectedHighlights chronologically (by peakTick)
  ```

- [ ] **2.3 — Camera preset assignment**
  For each selected highlight, choose a `CameraPresetId` based on tags:
  ```typescript
  function assignPreset(h: HighlightCandidate): CameraPresetId {
    if (h.tags.includes('rocket_jump') || h.tags.includes('height_gain'))
      return 'rocket_jump_hero';
    if (h.tags.includes('multi_kill') && h.killCount && h.killCount >= 3)
      return 'orbit_kill';
    if (h.tags.includes('long_range'))
      return 'dramatic_zoom';
    // 20% chance of victim_pov for variety (deterministic: based on tick % 5)
    if (h.peakTick % 5 === 0 && h.victimPlayer)
      return 'victim_pov';
    return 'chase_hero';  // reliable default
  }
  ```

- [ ] **2.4 — Speed assignment**
  Base speed per preset:
  - `chase_hero`: 1.0x
  - `orbit_kill`: 0.5x during peak (±1s around peakTick), 1.0x otherwise
  - `rocket_jump_hero`: 0.75x during flight, 0.25x at frag
  - `victim_pov`: 1.0x, then 0.5x at death moment
  - `dramatic_zoom`: 1.0x approach, 0.25x at impact
  - `replay_orbit`: 0.25x throughout

  Encode as `speedKeyframes` array: `[{ tick, speed }]` pairs for each speed change within the segment.

- [ ] **2.5 — Instant replay insertion**
  After segment assembly, check each segment's score against `REPLAY_THRESHOLD` (configurable, default top 15%). For qualifying segments, insert a replay segment immediately after:
  ```typescript
  const replaySegment: CinematicSegment = {
    ...originalSegment,
    cameraPreset: 'replay_orbit',
    playbackSpeed: 0.25,
    isReplay: true,
    // Use a tighter window: peakTick ± 2 seconds
    startTick: highlight.peakTick - 2s_in_ticks,
    endTick: highlight.peakTick + 2s_in_ticks,
    transitionIn: 'white_flash',
  };
  ```

- [ ] **2.6 — Duration recalculation and trim**
  After all segments + replays assembled:
  ```
  actualDuration = sum(segment.durationMs + segment.transitionDurationMs)
  if actualDuration > targetMs:
    remove lowest-scored segments until within budget
  if actualDuration < targetMs * 0.7:
    extend lead-ins on remaining segments, or add movement highlights
  ```

- [ ] **2.7 — Transition assignment**
  Rules:
  - First segment: `transitionIn: 'fade_to_black'` (fade from black = opening)
  - Last segment: `transitionOut: 'fade_to_black'` (fade to black = ending)
  - Before replay: `transitionIn: 'white_flash'`
  - Same player consecutive segments: `transitionIn: 'cut'`
  - Different player: `transitionIn: 'crossfade'`
  - Default `transitionDurationMs: 500`

- [ ] **2.8 — Segment numbering and finalization**
  Assign `segmentIndex` (0-based). Calculate `totalDurationMs`. Return `CinematicReel`.

- [ ] **2.9 — Unit tests**
  - Test: 3 highlights, 1-minute budget → selects top N that fit
  - Test: overlapping highlights → lower one skipped
  - Test: rocket_jump tag → gets 'rocket_jump_hero' preset
  - Test: top-scored highlight → gets replay segment appended
  - Test: budget overflow → lowest segments trimmed
  - Test: single highlight demo → works (1 segment + maybe replay)
  - Test: empty highlights → returns empty reel with 0 segments
  - Test: transition types assigned correctly for player switches

---

### Phase 3: Camera Path Generator

**Goal:** Given a `HighlightCandidate` and a `CameraPresetId`, compute concrete `CameraKeyframe[]` for freefly presets, or entity IDs for chase-cam presets.

**New files:**
- `src/shared/demo/CinematicCameraPaths.ts`
- `src/shared/demo/__tests__/CinematicCameraPaths.test.ts`

Note: in `src/shared/demo/` because it's pure math (Vec3 arithmetic), no Babylon dependency. Uses plain `{x, y, z}` objects, not `Vector3`.

#### Types

```typescript
interface CameraKeyframe {
  tick: number
  position: { x: number; y: number; z: number }
  lookAt: { x: number; y: number; z: number }
  fov?: number      // degrees, default 90
  speed?: number    // playback speed override at this keyframe
}

interface CameraPathResult {
  type: 'chase' | 'freefly'
  // For chase presets:
  targetEntityId?: string
  // For freefly presets:
  keyframes?: CameraKeyframe[]
  interpolation?: 'linear' | 'catmull_rom'
}
```

#### Tasks

- [ ] **3.1 — Path generator function**
  `generateCameraPath(preset: CameraPresetId, highlight: HighlightCandidate, snapshotRate: number): CameraPathResult`

  Dispatch to preset-specific generators.

- [ ] **3.2 — Chase Hero path**
  Trivial — return `{ type: 'chase', targetEntityId: highlight.primaryPlayer }`. The SpectatorController handles the rest.

- [ ] **3.3 — Victim POV path**
  Return `{ type: 'chase', targetEntityId: highlight.victimPlayer }`. Falls back to Chase Hero if no victim.

- [ ] **3.4 — Orbit Kill path**
  ```
  midpoint = (killerPos + victimPos) / 2
  radius = max(distance(killerPos, victimPos) * 0.8, 200)
  height = midpoint.y + 80
  
  keyframes over segment duration:
    t=0: angle=0°    → pos = midpoint + (cos(0)*r, height, sin(0)*r), lookAt=midpoint
    t=0.25: angle=45° 
    t=0.5: angle=90°  → also set speed=0.5 around peakTick
    t=0.75: angle=120°
    t=1.0: angle=150°
  
  interpolation = 'catmull_rom'
  ```

- [ ] **3.5 — Rocket Jump Hero path**
  ```
  // Start below the jump, end at apex
  jumpStart = killerPos at startTick (or estimate from peakTick - leadin)
  jumpApex = killerPos at peakTick
  
  below = { x: jumpStart.x, y: jumpStart.y - 100, z: jumpStart.z + 150 }
  
  keyframes:
    t=0: pos=below, lookAt=jumpStart  (looking up at the player)
    t=0.5: pos=lerp toward side, lookAt=midpoint of arc
    t=1.0: pos=behind+above jumpApex, lookAt=jumpApex  (transitions to "behind" view)
  ```

- [ ] **3.6 — Dramatic Zoom path**
  ```
  // Wide establishing → tight on impact
  killerToVictim = normalize(victimPos - killerPos)
  perpendicular = cross(killerToVictim, {0,1,0})  // side offset
  
  widePos = midpoint + perpendicular * 400 + {0, 200, 0}
  tightPos = victimPos + perpendicular * 80 + {0, 40, 0}
  
  keyframes:
    t=0: pos=widePos, lookAt=midpoint, fov=90
    t=0.7: pos=lerp(widePos, tightPos, 0.7), lookAt=victimPos, fov=60
    t=1.0: pos=tightPos, lookAt=victimPos, fov=50
  ```

- [ ] **3.7 — Replay Orbit path**
  ```
  center = killerPos at peakTick (or midpoint of killer↔victim)
  radius = 250
  height = center.y + 60
  
  // Full or partial orbit (360° looks great at 0.25x)
  keyframes at 10° intervals:
    for angle 0° to 270°:
      pos = center + (cos(angle)*r, height, sin(angle)*r)
      lookAt = center
  
  interpolation = 'catmull_rom'
  ```

- [ ] **3.8 — Catmull-Rom interpolation utility**
  ```typescript
  function interpolateCatmullRom(
    keyframes: CameraKeyframe[],
    tick: number
  ): { position: Vec3; lookAt: Vec3; fov: number }
  ```
  Standard Catmull-Rom spline between 4 control points. For positions and lookAt targets independently. Handles edge cases (fewer than 4 keyframes → fall back to linear).

- [ ] **3.9 — Vec3 math helpers**
  Small set of pure functions (not a Vec3 class — just functions on `{x,y,z}`):
  `add`, `sub`, `scale`, `normalize`, `distance`, `cross`, `lerp`
  
  Keep in same file or a small `vec3.ts` utility. No Babylon dependency.

- [ ] **3.10 — Unit tests**
  - Test: Chase Hero returns chase type with correct entityId
  - Test: Orbit Kill generates N keyframes in a circle around midpoint
  - Test: Orbit Kill radius scales with killer↔victim distance
  - Test: Catmull-Rom interpolation returns smooth values between keyframes
  - Test: all generators handle missing positions gracefully (fallback to chase)

---

### Phase 4: CinematicDemoPlayer — Playback Engine

**Goal:** Runtime component that plays a `CinematicReel` by driving `DemoViewer` + `CameraSystem`. This is the only phase with Babylon/rendering dependencies.

**New files:**
- `src/games/fps/client/CinematicDemoPlayer.ts`
- `src/games/fps/client/__tests__/CinematicDemoPlayer.test.ts`

#### Dependencies

- `DemoViewer` (composition — wraps existing instance)
- `CameraSystem.getInstance()` — switch between `'spectator'` and `'freefly'` controllers
- `SpectatorController.setSpectateTarget(entityId)` — for chase-cam segments
- `FreeflyController.setPosition(Vector3)` — for scripted freefly paths
- Camera rotation: `camera.rotation.set(pitch, yaw, 0)` for freefly look-at

#### Tasks

- [ ] **4.1 — CinematicDemoPlayer class skeleton**
  ```typescript
  class CinematicDemoPlayer {
    private demoViewer: DemoViewer;
    private reel: CinematicReel | null = null;
    private currentSegmentIndex: number = 0;
    private state: 'idle' | 'analyzing' | 'playing' | 'paused' | 'ended' = 'idle';
    private reelElapsedMs: number = 0;   // progress through entire reel
    private segmentElapsedMs: number = 0; // progress within current segment
    
    // Callbacks
    private onSegmentChange: ((segment: CinematicSegment, index: number) => void) | null = null;
    private onReelEnd: (() => void) | null = null;
    private onStateChange: ((state: string) => void) | null = null;
  }
  ```

- [ ] **4.2 — loadAndPlay(data, durationMinutes) orchestrator**
  Full pipeline:
  ```
  1. setState('analyzing')
  2. reader = await DemoReader.fromFile(data)
  3. await demoViewer.load(data)  // loads into DemoViewer for frame delivery
  4. analysis = new DemoAnalyzer().analyze(reader)
  5. reel = new SequenceBuilder().build(analysis, durationMinutes, header.snapshotRate)
  6. generateCameraPaths for all segments
  7. startPlayback()
  ```

- [ ] **4.3 — Segment state machine**
  ```
  startPlayback():
    currentSegmentIndex = 0
    applySegment(reel.segments[0])
    setState('playing')
  
  applySegment(segment):
    demoViewer.seekToTick(segment.startTick)
    demoViewer.setSpeed(segment.playbackSpeed)
    segmentElapsedMs = 0
    
    if segment.cameraPreset is chase-cam type:
      CameraSystem.setController('spectator')
      spectatorController.setSpectateTarget(segment.cameraTarget)
    else:
      CameraSystem.setController('freefly')
      // First keyframe position
      freeflyController.setPosition(keyframes[0].position)
    
    onSegmentChange?.(segment, currentSegmentIndex)
  
  advanceSegment():
    currentSegmentIndex++
    if currentSegmentIndex >= reel.segments.length:
      setState('ended')
      onReelEnd?.()
      return
    applySegment(reel.segments[currentSegmentIndex])
  ```

- [ ] **4.4 — update(deltaMs) — main playback loop**
  Called each render frame (wired into Babylon render loop or Game update).
  ```
  if state !== 'playing': return
  
  segment = reel.segments[currentSegmentIndex]
  segmentElapsedMs += deltaMs
  reelElapsedMs += deltaMs
  
  // Check segment end
  currentTick = demoViewer.getInfo().currentTick
  if currentTick >= segment.endTick:
    advanceSegment()
    return
  
  // Apply speed keyframes within segment
  if segment.speedKeyframes:
    for each speedKf in segment.speedKeyframes:
      if currentTick >= speedKf.tick:
        demoViewer.setSpeed(speedKf.speed)
  
  // Update freefly camera path
  if segment uses freefly && segment has keyframes:
    { position, lookAt, fov } = interpolateCatmullRom(keyframes, currentTick)
    freeflyController.setPosition(toVector3(position))
    // Calculate rotation from position→lookAt
    camera.rotation = lookAtRotation(position, lookAt)
    if fov: camera.fov = fov * (Math.PI / 180)
  
  // DemoViewer.update() is driven separately by the render loop
  // (CinematicDemoPlayer doesn't call it — Game's render loop does)
  ```

- [ ] **4.5 — lookAt rotation helper**
  Convert position + lookAt target to Babylon camera rotation (pitch, yaw, 0):
  ```typescript
  function lookAtRotation(from: Vec3, to: Vec3): { pitch: number; yaw: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return {
      yaw: Math.atan2(dx, dz),
      pitch: -Math.atan2(dy, dist),
    };
  }
  ```

- [ ] **4.6 — Transport controls**
  ```
  pause(): setState('paused'), demoViewer.pause()
  resume(): setState('playing'), demoViewer.play()
  togglePlayPause(): pause or resume
  skipToSegment(index): seek to that segment, applySegment
  nextSegment(): skipToSegment(currentSegmentIndex + 1)
  prevSegment(): skipToSegment(max(0, currentSegmentIndex - 1))
  stop(): setState('idle'), cleanup camera state
  ```

- [ ] **4.7 — Reel progress info**
  ```typescript
  getReelInfo(): {
    state: string
    currentSegment: number
    totalSegments: number
    reelElapsedMs: number
    reelTotalMs: number
    reelProgress: number        // 0.0–1.0
    currentHighlight: HighlightCandidate | null
    isReplay: boolean
    currentSpeed: number
  }
  ```

- [ ] **4.8 — dispose()**
  Reset state, restore camera to default controller, clear callbacks.

- [ ] **4.9 — Unit tests**
  Mock DemoViewer (spy on seekToTick, setSpeed, pause, play). Mock CameraSystem.
  - Test: loadAndPlay calls analyze → build → startPlayback
  - Test: segment advance when tick exceeds endTick
  - Test: nextSegment/prevSegment boundary conditions
  - Test: pause/resume toggles state correctly
  - Test: reel end fires callback
  - Test: speed keyframes applied at correct ticks
  - Test: freefly path updates position each frame

---

### Phase 5: Console Commands & Demo Loading

**Goal:** Wire up console commands for demo listing, loading, and cinematic playback. Commands auto-register via Vite glob.

**New files:**
- `src/engine/console/commands/DemoListCommand.ts`
- `src/engine/console/commands/DemoCommand.ts`
- `src/engine/console/commands/DemoPlayCommand.ts`

#### Tasks

- [ ] **5.1 — DemoListCommand**
  ```typescript
  export default class DemoListCommand extends Command {
    readonly definition: CommandDef = {
      name: 'demolist',
      description: 'List available demos from lobby server',
      usage: 'demolist [filter]',
    };
    
    async execute(args: string[]): Promise<string> {
      // Get LobbyClient instance (import from Game or a service locator)
      // Call lobbyClient.requestDemoList()
      // Listen for demos:list_response (one-shot)
      // Format as table, optionally filter by args[0]
      // Cache result in static field for DemoCommand to reference by number
    }
  }
  ```
  
  Challenge: Commands don't currently have access to LobbyClient. Options:
  - Import `Game.getInstance()` and access lobby client through it
  - Use a lightweight service locator / global singleton for LobbyClient
  - Pass dependencies via CommandRegistry (would require extending the registry)
  
  Recommendation: Import through `Game.getInstance()` — same pattern as `SpectatorController.update()` already uses. `Game` is the central singleton that owns the lobby client connection.

- [ ] **5.2 — DemoCommand**
  ```typescript
  export default class DemoCommand extends Command {
    readonly definition: CommandDef = {
      name: 'demo',
      description: 'Load a demo by number or filename',
      usage: 'demo <number|filename>',
    };
    
    async execute(args: string[]): Promise<string> {
      // If args[0] is a number: look up in DemoListCommand's cached list
      // If args[0] is a filename: use directly
      // Fetch via HTTP: fetch(`/data/demos/${filename}`)
      // Load via DemoReader.fromFile()
      // Store loaded DemoReader + raw data on Game instance or a DemoService
      // Return "Loaded demo: {summary}"
    }
  }
  ```

- [ ] **5.3 — DemoPlayCommand**
  ```typescript
  export default class DemoPlayCommand extends Command {
    readonly definition: CommandDef = {
      name: 'demoplay',
      description: 'Play loaded demo (normal or cinematic mode)',
      usage: 'demoplay [cinematic <minutes> | analyze | stop]',
      subcommands: [
        { name: 'cinematic', description: 'Play highlight reel', args: [{ name: 'minutes', type: 'number', required: true }] },
        { name: 'analyze', description: 'Analyze highlights without playing' },
        { name: 'stop', description: 'Stop demo playback' },
      ],
    };
    
    async execute(args: string[]): Promise<string> {
      if (args[0] === 'cinematic'):
        // Get loaded demo data from DemoService
        // Create CinematicDemoPlayer, call loadAndPlay(data, minutes)
        // Show cinematic HUD
      if (args[0] === 'analyze'):
        // Run DemoAnalyzer only, format results as table
      if (args[0] === 'stop'):
        // Stop playback, dispose cinematic player
      default (no args):
        // Normal demo playback via DemoViewer
    }
  }
  ```

- [ ] **5.4 — DemoService singleton**
  Light state container shared between commands and UI:
  ```typescript
  class DemoService {
    static instance: DemoService;
    cachedDemoList: DemoInfo[] = [];
    loadedDemoData: Uint8Array | null = null;
    loadedDemoReader: DemoReader | null = null;
    activeCinematicPlayer: CinematicDemoPlayer | null = null;
    activeDemoViewer: DemoViewer | null = null;
  }
  ```
  Lives in `src/shared/demo/DemoService.ts`. Both console commands and lobby UI use this to share state.

- [ ] **5.5 — Unit tests for commands**
  Mock fetch, mock LobbyClient, mock DemoService. Verify:
  - `demolist` calls requestDemoList and formats output
  - `demo 1` looks up cached list
  - `demo filename.shagdemo` fetches correct URL
  - `demoplay cinematic 2` calls CinematicDemoPlayer.loadAndPlay
  - `demoplay analyze` returns formatted highlight table
  - `demoplay stop` calls dispose

---

### Phase 6: UI — Lobby Demo Cards & Cinematic HUD

**Goal:** Update lobby demo cards with PLAY/HIGHLIGHTS buttons, add cinematic HUD overlay.

**Modified files:**
- `src/engine/ui/panels/LobbyPanel.ts` (modify demo card rendering)

**New files:**
- `src/games/fps/client/CinematicHUD.ts`
- `src/games/fps/client/DurationPickerModal.ts`

#### Tasks

- [ ] **6.1 — Replace demo card "VIEW DEMO" with two buttons**
  In `LobbyPanel.ts`, in the demo card building loop (~line 959-970):
  
  Replace the single download button with:
  ```typescript
  // ▶ PLAY DEMO button
  const playBtn = document.createElement('button');
  playBtn.className = 'lobby__demo-card-btn';
  playBtn.textContent = '▶ PLAY';
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const data = await fetchDemo(d.filename);
    DemoService.getInstance().loadAndPlayNormal(data);
  });
  
  // ⚡ HIGHLIGHTS button
  const highlightBtn = document.createElement('button');
  highlightBtn.className = 'lobby__demo-card-btn lobby__demo-card-btn--highlight';
  highlightBtn.textContent = '⚡ HIGHLIGHTS';
  highlightBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    DurationPickerModal.show(async (minutes) => {
      const data = await fetchDemo(d.filename);
      DemoService.getInstance().loadAndPlayCinematic(data, minutes);
    });
  });
  
  // Button row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:6px;';
  btnRow.appendChild(playBtn);
  btnRow.appendChild(highlightBtn);
  card.appendChild(btnRow);
  ```

- [ ] **6.2 — fetchDemo helper**
  ```typescript
  async function fetchDemo(filename: string): Promise<Uint8Array> {
    const response = await fetch(`/data/demos/${filename}`);
    if (!response.ok) throw new Error(`Failed to fetch demo: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  ```
  Can live in `DemoService` or as a utility in LobbyPanel.

- [ ] **6.3 — DurationPickerModal**
  Small DOM modal, similar pattern to existing `SpectatorOverlay`:
  ```
  ┌──────────────────────┐
  │  HIGHLIGHT REEL       │
  │                       │
  │  [1 min] [2 min] [5]  │   ← buttons, selected one highlighted
  │                       │
  │  [▶ PLAY HIGHLIGHTS]  │
  │  [    CANCEL    ]     │
  └──────────────────────┘
  ```
  
  Implementation:
  - `show(callback: (minutes: number) => void)` — creates DOM, appends to body
  - Duration buttons: 1, 2, 5. Click toggles selection (CSS class).
  - PLAY button: calls `callback(selectedMinutes)`, removes modal
  - CANCEL: removes modal
  - Styled to match lobby aesthetic (dark, translucent, same font family)

- [ ] **6.4 — CinematicHUD**
  DOM overlay shown during cinematic playback, replaces DemoViewerHUD.
  
  Two parts:
  
  **Top-left info card** (auto-hiding):
  ```typescript
  class CinematicHUD {
    private infoCard: HTMLDivElement;    // top-left
    private progressBar: HTMLDivElement; // bottom
    private infoHideTimer: number = 0;
    
    // Called when segment changes
    showSegmentInfo(segment: CinematicSegment): void {
      // Update info card content:
      //   "⚡ HIGHLIGHT 3/12"
      //   "TRIPLE KILL — player1"
      //   "rocket_launcher"
      //   Tags as small badges
      // Show card, reset hide timer (3 seconds)
    }
    
    // Called each frame
    updateProgress(reelInfo: ReelInfo): void {
      // Update bottom bar:
      //   Time: "0:45 / 2:00"
      //   Progress bar fill width
      //   Speed label: "0.25x" or "1.0x"
      //   "REPLAY" label if segment.isReplay
    }
  }
  ```

  **Bottom progress bar:**
  - Shows reel progress (not demo progress)
  - Clickable for scrubbing: maps click position to segment index
  - Small segment markers on the bar showing where each highlight falls

- [ ] **6.5 — Highlight type display names**
  Map internal types to user-facing strings:
  ```typescript
  const HIGHLIGHT_DISPLAY_NAMES: Record<string, string> = {
    'frag': 'FRAG',
    'multi_kill': (count) => count === 2 ? 'DOUBLE KILL' : count === 3 ? 'TRIPLE KILL' : `${count}x MULTI KILL`,
    'airborne_frag': 'AIRBORNE FRAG',
    'streak_kill': 'KILLING SPREE',
    'first_blood': 'FIRST BLOOD',
    'movement': 'MOVEMENT',
  };
  ```

- [ ] **6.6 — Keyboard bindings during cinematic**
  Wire into existing input system (`FPSActions` context or a new `cinematic` context):
  - Space → `cinematicPlayer.togglePlayPause()`
  - Escape → `cinematicPlayer.stop()`, show normal demo viewer or return to lobby
  - ArrowRight → `cinematicPlayer.nextSegment()`
  - ArrowLeft → `cinematicPlayer.prevSegment()`

- [ ] **6.7 — "HIGHLIGHTS" button on DemoViewerHUD**
  Add a button to existing `DemoViewerHUD.build()` method in the controls row:
  ```typescript
  const highlightsBtn = document.createElement('button');
  highlightsBtn.textContent = '⚡ HIGHLIGHTS';
  highlightsBtn.style.cssText = `/* match existing button style */`;
  highlightsBtn.addEventListener('click', () => {
    this._onHighlightsRequest?.();
  });
  controlsRow.appendChild(highlightsBtn);
  ```
  Add callback: `onHighlightsRequest(callback: () => void)`.
  
  When clicked, the caller shows DurationPickerModal and switches to cinematic mode with the already-loaded demo data.

- [ ] **6.8 — Loading/analyzing overlay**
  Brief overlay shown during analysis (typically <1s):
  ```
  ┌──────────────────────────┐
  │                           │
  │   ANALYZING DEMO...       │
  │   ████████░░░░  67%       │
  │                           │
  └──────────────────────────┘
  ```
  Simple DOM overlay. In practice this is near-instant for most demos, but it prevents a blank screen during the `readAllFrames()` + `analyze()` step.

---

### Phase 7: Integration & Polish

**Goal:** Wire everything together end-to-end. Transitions, CVars, edge cases.

**Modified files:**
- `src/games/fps/Game.ts` (wire cinematic player into game lifecycle)

#### Tasks

- [ ] **7.1 — Game.ts integration**
  Add demo/cinematic state to Game's state machine:
  ```
  States: 'spectator' | 'playing' | 'demo_viewer' | 'demo_cinematic'
  ```
  
  When entering `demo_viewer`:
  - Hide gameplay HUD
  - Show DemoViewerHUD
  - Camera: freefly or spectator (user choice)
  
  When entering `demo_cinematic`:
  - Hide DemoViewerHUD
  - Show CinematicHUD
  - Camera: managed by CinematicDemoPlayer

- [ ] **7.2 — CVars registration**
  Register cinematic cvars in the cvar system:
  ```
  cin_lead_in_min    (number, default 3)
  cin_lead_in_max    (number, default 8)
  cin_follow_through (number, default 2)
  cin_replay_threshold (number, default 40)
  cin_multi_kill_window (number, default 10)
  cin_show_hud       (boolean, default true)
  cin_speed_ramp     (boolean, default true)
  ```
  
  DemoAnalyzer and SequenceBuilder read these values instead of hardcoded constants.

- [ ] **7.3 — Transition effects (v1: simple)**
  Start with DOM-based transitions (no shader needed):
  - **Cut:** No overlay, instant switch.
  - **Fade to/from black:** Full-screen black div, animate opacity 0→1 or 1→0 over 500ms.
  - **White flash:** Full-screen white div, opacity 0.8→0 over 300ms.
  - **Crossfade:** Quick black dip (fade to black 200ms + fade from black 200ms).
  
  All via CSS transitions on a fixed overlay div. Simple, reliable, no WebGL needed.

- [ ] **7.4 — Reel end behavior**
  When reel finishes:
  - Show a "REEL COMPLETE" overlay with options:
    - "REPLAY" — start cinematic from beginning
    - "VIEW DEMO" — switch to normal DemoViewer at last highlight's tick
    - "BACK TO LOBBY" — return to lobby panel
  - Auto-timeout: if no input for 10s, return to lobby.

- [ ] **7.5 — Edge case: short demos / few highlights**
  In SequenceBuilder, when fewer highlights than expected:
  - If 0 highlights: show "No highlights found" message, offer normal playback instead.
  - If highlights fill <50% of requested duration: extend lead-ins, add establishing shots between segments (wide freefly at map center).

- [ ] **7.6 — Edge case: FreeflyController input suppression**
  During cinematic freefly segments, the user's mouse/keyboard should NOT move the camera (CinematicDemoPlayer controls it). 
  - Call `freeflyController.setEnabled(false)` during scripted freefly segments.
  - Re-enable on cinematic stop or when switching to non-cinematic mode.
  - SpectatorController already ignores input (follows target only), so no change needed there.

- [ ] **7.7 — End-to-end smoke test**
  Manual test plan:
  1. Start server, play a match, verify demo recorded
  2. Open lobby, see demo in DEMOS tab
  3. Click "PLAY DEMO" → verify normal playback with DemoViewerHUD
  4. Click "HIGHLIGHTS" → duration picker → select 1 min → verify cinematic plays
  5. Verify segment transitions (camera switches, speed changes)
  6. Verify keyboard controls (space, escape, arrows)
  7. Console: `demolist` → `demo 1` → `demoplay cinematic 2` → verify same flow
  8. Console: `demoplay analyze` → verify highlight table output
  9. Test with short demo (<1 min) — verify graceful handling
  10. Test with FFA demo (many players) — verify highlights from multiple players

---

## 7. Key Design Decisions

### 7.1 Pre-analysis vs Real-time Detection

**Decision: Pre-analysis.** Reading the entire demo before playback is fast (DemoReader uses random-access binary format with full snapshots, no delta dependency chain). A 10-minute demo at 20Hz = 12,000 frames. Scanning events in each frame is cheap — no rendering, no physics. Expected analysis time: <1 second.

Pre-analysis is better because:
- Can score globally (know the best moments before deciding what to show)
- Can look ahead/behind for context (was this kill part of a multi-kill?)
- Can budget time across the whole demo
- No surprises during playback

### 7.2 Map-Agnostic Camera Paths

**Decision: All camera positions computed relative to players, not absolute coordinates.** This means the same "orbit around kill" preset works on any map. The freefly camera may clip through walls in some cases — acceptable for v1, can add BSP trace raycasting later to adjust camera positions that end up inside geometry.

### 7.3 Extending vs Wrapping DemoViewer

**Decision: CinematicDemoPlayer wraps DemoViewer** (composition, not inheritance). It uses `DemoViewer.seekToTick()` and `DemoViewer.setSpeed()` to control playback, and directly manages the CameraSystem. This keeps DemoViewer clean and the cinematic logic isolated.

### 7.4 Shared Code Location

**Decision: DemoAnalyzer and SequenceBuilder in `src/shared/demo/`** since they're pure data processing with no rendering dependencies. They could run server-side too (e.g., pre-analyzing demos for a web highlight browser). CinematicDemoPlayer goes in `src/games/fps/client/` since it drives the renderer.

---

## 8. Edge Cases & Considerations

### 8.1 Short Demos

If a demo is shorter than the requested cinematic duration, play highlights at normal speed without compression. If there are very few frags, pad with movement highlights or establishing shots.

### 8.2 Low-Action Demos

If a demo has fewer highlights than needed to fill the time:
- Lower the score threshold
- Include movement sequences (fast runs, trick jumps)
- Add longer lead-ins to show positioning/strategy
- Fall back to "greatest hits at normal speed" mode

### 8.3 Demos with Many Players (FFA/TDM)

More players = more potential highlights. The scoring system naturally handles this — top moments rise regardless of player count. Camera assignment should favor the same player for consecutive segments when possible (narrative flow), but not at the cost of missing better highlights.

### 8.4 Wall Clipping

Freefly camera paths computed relative to players may end up inside BSP geometry. Solutions (in priority order):
1. **Accept it for v1** — most orbit/behind paths won't clip on typical maps
2. **BSP raycasting** — trace from target to desired camera pos, pull camera forward if blocked
3. **Fallback to chase-cam** — if freefly path is obstructed, use first-person instead

### 8.5 Dead Player Following

When the highlight involves a player who dies, the camera needs to handle the death gracefully:
- Continue following corpse/gib position briefly
- Switch to killer's perspective
- Or hold position and let the action play out

---

## 9. Future Ideas

### 9.1 AI-Assisted Highlight Scoring

Use the existing bot neural network infrastructure (`src/bot/`) to score "interestingness" of moments. The bot already processes game state into neural inputs — could train a small classifier on human-curated highlights.

### 9.2 Music-Synced Editing

Sync speed ramps and cuts to BPM of background music. The music system (`src/engine/audio/`) already exists — extend it with beat detection for tempo-synced editing.

### 9.3 Highlight Export

Export the assembled highlight reel as a segment manifest that could be rendered to video (via headless rendering + ffmpeg). Would allow sharing highlights without requiring the game engine.

### 9.4 Community Highlight Reels

Combine highlights from multiple demos across different matches/maps into a single "best of" reel. The SequenceBuilder already works on scored candidates — just feed it candidates from multiple demo files.

### 9.5 Interactive Mode

Let the viewer manually tag moments as "cool" during normal demo playback, then assemble a reel from those tags + auto-detected highlights.

### 9.6 Picture-in-Picture

During a replay/freefly segment, show a small PiP window with the first-person view (or vice versa). Gives context while showing dramatic angles.

### 9.7 Pre-Computed Highlight Index

Server-side: run DemoAnalyzer on demos after recording, store the highlight candidates alongside the demo file. Lobby UI can then show "highlight preview" without client-side analysis.

---

## 10. Summary

The existing demo infrastructure (recording, random-access reading, frame-level playback, camera controllers) provides all the building blocks. The missing pieces are:

1. **DemoAnalyzer** — event-driven highlight detection with composite scoring
2. **SequenceBuilder** — time-budgeted segment selection with camera preset assignment  
3. **CinematicDemoPlayer** — segment-driven playback with camera path control
4. **Camera path computation** — relative-position freefly paths from action data

All camera presets are prescriptable and map-agnostic because they're computed relative to player positions. The analysis pass is fast because demo frames are full snapshots (no delta chains to resolve). The entire system layers cleanly on top of existing infrastructure without modifying it.
