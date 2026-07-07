# Anti-Cheat Features — Research & Roadmap

**Status:** Research + active build (Phase C). Companion to `docs/research/v0.9.16-server-authority.md`
(the server-authority *prevention* layer). This doc is the *detection*, *evidence*, and *response*
layers — the part that deals with cheats authority alone can't stop. **Shipped so far:** WO-12
telemetry substrate + WO-AC1 accuracy/headshot + WO-AC2 impossible-input counters (see §7). Next:
WO-AC3 calibration harness (the guardrail) or WO-AC4 deterministic re-sim.

**Mission:** a **safe space for vintage FPS gamers** — a place where players of classic-style
movement-shooters get fair games, and where cheating is made costly, risky, and mostly kept away
from the people who just want to play. We don't need to *defeat* every cheat to succeed at that; we
need to keep the honest majority insulated from the ones that exist.

---

## 0. Thesis & threat model (read this first)

Washoi is a **free, open-source** Q3/Warsow-style FPS. That fact sets hard, honest limits:

- **The client is untrusted and unprotectable.** Anyone can read, patch, or replace the client
  binary/JS. So **client-side anti-cheat is theater** — obfuscation, integrity checks, and
  "kernel" anti-cheat are all bypassable and, for an OSS game, undesirable (invasive, and the
  source is right there). We do **not** build any of it.
- **We will not stop a determined, skilled aimbotter.** A good external aimbot that reads the
  screen and moves a real mouse is, in the limit, indistinguishable from a very good human on any
  single action. Warsow/Q3 never "solved" this and neither will we. **That is not the goal.**
- **The goal is to raise the cost and thin the herd.** Make the *easy* cheats impossible, make the
  *common* cheats detectable, and make it socially and mechanically annoying enough that casual
  cheaters bounce off and honest players rarely share a server with them.

So the strategy is four layers, in order of durability:

| Layer | What it does | Against | Status |
|---|---|---|---|
| **1. Prevent** | Server authority: client can't set state, speed, fire-rate, ammo, damage, position | Speed/aimbot-teleport/ammo/damage/wallpoke hacks | **Mostly done** (v0.9.16 Phase A/B) |
| **2. Detect** | Statistical signals on *server-owned ground truth* (hits, angles, timing) | Aimbot/triggerbot/spinbot patterns | This doc |
| **3. Evidence** | Record suspect matches; review offline | Manual review, appeals, tuning | This doc (+ demo pipeline) |
| **4. Respond** | Trust score → soft matchmaking segregation; flag, don't auto-ban | Keeping cheaters away from honest players | This doc (north star) |

**Key principle:** every detection signal must come from data the **server already owns and
computes** — never from anything the client reports about itself. If the client can lie about it,
it's not a signal.

### 0.1 Historical context & why this approach

Washoi grows out of the Warsow/Q3 lineage, and it inherits that lineage's hard-won lesson about
anti-cheat. In games of this kind, effective anti-cheat has historically demanded specialized,
adversarial, low-level engineering — a skillset that is rare on volunteer game teams whose energy
naturally goes into *making the game*. When that capability exists at all it tends to concentrate in
one or two specialists, and such tools have sometimes ended up closed-source or commercial. Either
way the result is a **single point of failure**: when the specialist or the tool stops being
available as open, community-maintained code, the capability is simply lost. And once aimbots
circulate for a popular free game, competitive integrity — including any realistic prospect of prize
competition — erodes with it.

We treat that as a design constraint, not a footnote. This roadmap deliberately avoids that failure
mode:

- **No specialist bottleneck.** Everything is high-level, server-side, in-language, and in-repo —
  maintainable and reviewable by ordinary contributors, not a lone low-level expert.
- **Nothing ownable.** The value is server authority + open signals + a trust model — none of it a
  secret binary that can walk away with whoever wrote it.
- **Integrity without winning the client war** (see §0.2 and §4): server-authoritative ground
  truth, reviewable demos, and trusted/segregated pools deliver real competitive integrity without
  an unwinnable low-level arms race.

And four principles that turn the history into a method:

- **Anti-cheat as a byproduct, not a project.** A volunteer team's energy must go to *making the
  game*, so the only integrity work that survives is the kind that free-rides on systems you build
  anyway: server authority (needed for netcode), demos (built for spectating), telemetry (your
  netcode diagnostics). Don't run an "anti-cheat project" — architect the game so fairness falls out
  of it almost for free. Every item in this doc is chosen to reuse something we already have.
- **Don't build the closed-AC dependency in the first place.** Anti-cheat becomes closed/commercial
  *because it's hard and scarce* — and a vendor's moat *is* keeping it secret. That makes commercial
  AC structurally misaligned with an open game: the vendor wants scarcity and secrecy; the game
  wants openness and survival. An open game that leans on it is permanently hostage. So the lesson
  isn't "someone took our tool" — it's "never make the dependency."
- **Build the substrate in peacetime.** Aimbots arrived *fast*, and once a scene is poisoned trust
  does not come back — players leave and stay gone. So the ground-truth substrate (authority, demos,
  telemetry) is insurance you buy *before* the fire. Standing up telemetry (WO-12) before any
  detector exists is correct, not premature — teams that wait until cheats appear are already too
  late.
- **Openness is the asset — if you build for participation.** The same open code that helps cheat
  authors also makes it *the whole community vs. cheaters* instead of *one specialist vs. cheaters*.
  Community reporting, trust-weighted demo review, and open, auditable detection turn our biggest
  apparent liability into the strategy (§3, §4).

### 0.2 Detection that survives open source (Kerckhoffs for anti-cheat)

"All the code is public" feels like it dooms detection — but only if you try to hide the *logic*.
Security-through-obscurity of logic fails: the source is right there. The durable move is
**Kerckhoffs's principle** — make the *mechanism* public and keep the secret in the **data and the
response**, not the code.

- **Secret thresholds & weights, not secret algorithms.** The repo can say *we measure headshot
  ratio, flick distribution, and reaction floor*; it need not contain the exact cutoffs, the
  per-signal weights, or how they combine into a trust score. Those live in **server-side config /
  deployment data outside the public repo**, and can be re-tuned live without a code change. A
  cheater who reads the source learns *what* is measured, not *where the line is* — and the line
  moves.
- **Evasion = playing more like a human = cheating less.** The quiet superpower of statistical
  detection: to hide from an accuracy / flick / reaction signal, a cheat must throttle itself down
  toward human performance. The only way to beat the measurement is to surrender most of the
  advantage. Open code doesn't help here — the evasion *is* the win condition for us.
- **Deny the cheater a feedback loop.** Cheaters iterate by testing against a live detector ("did I
  get caught?"). Take that away: **shadow-flag** (never announce detection), **decide offline**
  (batch / demo review), **respond on a delay** (trust adjustments, occasional waves — not instant
  kicks). With no did-it-work signal, iteration stalls even though the code is open. The source can
  reveal *what* we compute; it cannot reveal what the server *logged*, when it *flagged*, or when it
  will *act*.
- **Server-random canaries** (§2.6): the *mechanism* (bait the client shouldn't be able to perceive)
  can be public; the *specific* placement and timing are server-random per match, so reading the
  source doesn't tell a wallhack how to avoid biting.
- **Ground-truth asymmetry.** The server owns exact hit geometry, timing, and cross-player
  correlation; the client has none of it and can't watch how it's evaluated. Public code doesn't
  change who holds the data.

**Honest boundary:** these make cheating *costlier, riskier, and weaker*, and make casual /
"aimbot-from-a-forum" cheats detectable. They do **not** make a disciplined, human-throttled
external cheat impossible — nothing open *or closed* reliably does (see §0 thesis). That's fine: the
mission is a safe space for the honest majority, not a perfect wall.

### 0.3 Guardrails: false positives & player privacy

Detection that harms honest players fails the mission *worse* than a missed cheater does. Two
standing rules govern everything below:

- **False positives are the cardinal sin.** A wrongly-flagged honest player breaks the "safe space"
  promise directly — worse than ten missed cheaters. So: every signal is *one input to a score*,
  never a solo verdict; high-impact responses (bans) require high confidence **plus** offline
  human/demo review; thresholds are calibrated against real human play (§3) *before* they gate
  anything; and we prefer **graduated, reversible** responses (§4) over hard public punishment.
- **Minimal, honest data.** Telemetry is derived only from gameplay the server already processes —
  we do **not** fingerprint hardware, inspect the player's machine, or collect more than the game
  itself produces. Be transparent that fair-play detection exists in principle, keep retention
  bounded, and treat behavioral data as a fairness tool for the community, not surveillance. (This
  is also just consistent with being open source.)

---

## 1. What we already have (Layer 1 — prevention)

Cataloged so we build *on* it, not beside it. (Detail in `v0.9.16-server-authority.md`.)

- **Server-authoritative movement/physics** — position/velocity computed server-side; input *rate*
  can't change physics rate (fixed one-dt-per-tick). No speed hack, no moon-jump.
- **Usercmd sanitizer** (`src/shared/server/simulation/InputSanitizer.ts`) — rejects NaN/Inf,
  clamps pitch, wraps yaw, unit-clamps wish direction. **The choke point every client input passes
  through.**
- **Server-authoritative hit detection** (`WeaponSystem` traces) — the client never claims a hit;
  the server ray/cone-traces from server-side positions. *This is the goldmine for Layer 2 — see §2.1.*
- **PVS snapshot culling** (`SnapshotBroadcaster.filterStateForClient`) — entities a client can't
  potentially see aren't sent, so ESP/wallhack can't reveal what isn't on the wire. A genuine
  structural anti-wallhack; **verify it's enabled in production.**
- **Anti-warp + rate cap** (`MovementValidator`) — bounds input flooding.
- **Position-delta tripwire** (`FPSMovementSubsystem`, log-only) — flags impossible one-tick moves.
- **Per-client telemetry substrate** (`Telemetry.ts`, WO-12) — uplink jitter/loss + the
  **view-angular-speed (flick)** signal. This doc's §2 mostly extends this.
- **Demo pipeline** (`.shagdemo`) — records full snapshots of a match. The evidence store for §3.

---

## 2. Detection signals (Layer 2)

Each is a feature with: **what it catches**, **cost**, **false-positive risk**, **code hook**, and
**phase**. Ordered cheapest-and-highest-signal first. All are server-authoritative.

### 2.1 Accuracy & headshot telemetry ⭐ (do first)
- **Catches:** aimbots (the single strongest tell). Superhuman hit% and headshot-ratio, especially
  per-weapon (railgun/instagun accuracy, LG/machinegun tracking%) and at range.
- **How:** we already trace every shot server-side. Accumulate per-client, per-weapon:
  shots-fired, hits, headshots, and hit-distance distribution.
- **Cost:** ~nil — counters incremented at the existing trace site.
- **FP risk:** low as a *signal*, medium as a *verdict* — great humans exist; use as one input to a
  score, never a solo autoban. Watch small-sample noise (require N shots before it counts).
- **Hook:** `WeaponSystem.traceHitscanRay` / `fireMelee` (hit registration) → push to `Telemetry`.
- **Phase:** C (extends WO-12).

### 2.2 Impossible-input hard counters ⭐ (do first)
- **Catches:** modified/scripted clients that violate the input contract. A legit client trips
  these ~never; a hacked one trips them constantly → near-zero false positives.
- **How:** promote events we *already detect and discard* into per-client counters:
  - `rejectedCmds` — sanitizer returned null (NaN/Inf) (`InputSanitizer`/`GameServer.handleInput`).
  - `pitchClampHits` / `dirClampHits` — sanitizer had to clamp (client sent out-of-range).
  - `tripwireHits` — WO-9 impossible position delta.
  - `warpStrikes` — already in `MovementValidator` (reuse).
- **Cost:** ~nil — the detection already happens; we just count instead of forget.
- **FP risk:** **very low** (these are contract violations, not skill).
- **Hook:** the sanitizer + tripwire + validator already fire; add a counter push to `Telemetry`.
- **Phase:** C (extends WO-12).

### 2.3 Flick / angular-velocity distribution (histogram, not EWMA)
- **Catches:** aimbots' bimodal aim — near-zero micro-tracking punctuated by instant snaps that a
  human wrist can't produce. An EWMA/peak (what WO-12 has now) smears this; a histogram keeps the
  *shape*.
- **How:** small fixed-bucket histogram of per-usercmd angular speed (deg/s) per client. The signal
  is the **fraction of samples above a humanly-impossible threshold** and the bimodality.
- **Cost:** low (a few int buckets per client).
- **FP risk:** low-medium — high-sens players flick fast; calibrate the "impossible" bucket from
  real human data (and from our own demos).
- **Hook:** `Telemetry.recordInput` (already receives pitch/yaw) → bucket the computed speed.
- **Phase:** C/D.

### 2.4 Reaction-time / time-to-target
- **Catches:** triggerbots and aimbot lock-on. The server knows when an enemy first enters a
  client's view cone (it owns both positions) — measure ticks until that client's aim lands on the
  target and fires. Consistent sub-human reaction (< ~130–150ms) is the tell.
- **How:** per-client, sample "enemy-entered-cone → first-fire-on-target" latency; track the
  *distribution's* floor, not the mean.
- **Cost:** medium (per-tick visibility/aim check — piggyback on PVS/trace work).
- **FP risk:** medium — pre-aiming/prediction by good players looks similar; needs the distribution,
  not single events.
- **Hook:** new sampler reading positions + `input.yaw/pitch` + fire events.
- **Phase:** D.

### 2.5 Spinbot / view-entropy signals (cheap catch for dumb cheats)
- **Catches:** spinbots and obvious scripted aim (constant angular velocity, perfectly periodic
  input, zero jitter in a human-should-be-jittery signal).
- **How:** the flip side of 2.3 — flag *too regular* as well as *too fast*. Near-zero input jitter
  combined with perfect on-target tracking is non-human.
- **Cost:** low (reuse WO-12 jitter + 2.3 histogram).
- **FP risk:** low for the egregious cases.
- **Phase:** D.

### 2.6 Server-random canaries (bait for ESP / wallhack)
- **Catches:** wallhack/ESP that reacts to entity data an honest player could not perceive.
- **How:** the server briefly introduces a bait it *knows* is outside the client's legitimate
  perception (e.g. an entity the PVS would cull, or state never sent to that client) and watches
  whether the client's aim/behavior reacts to it. Reacting = reading state it was never given.
  Placement and timing are **server-random per match**, so open code reveals the mechanism but not
  the specific test (see §0.2).
- **Cost:** low-medium. **FP risk:** low *if* the bait is genuinely unperceivable to an honest
  client — design so a legit client physically *cannot* coincidentally react (else it's a false
  accusation generator).
- **Caveat:** our PVS already withholds non-visible entities, so ESP has less to grab than in
  classic Q3/Warsow — canaries are most useful against clients that reconstruct hidden state from
  the wire, and as a targeted probe on already-suspected accounts.
- **Phase:** D.

### 2.7 Occlusion-aware aim (wallhack / prefire) — the strongest server-side ESP tell
- **Catches:** wallhack/ESP. The server knows (collision + PVS) exactly when a target is *occluded*
  from a client. Aim that tracks an enemy **through a wall**, or pre-fires the instant an enemy
  rounds a corner with zero reaction delay, is reacting to information the player could not
  legitimately have.
- **How:** per client, sample the correlation between aim-on-target and target *visibility*. Honest
  aim only settles on a target after it's actually visible (plus human reaction); wallhack aim
  tracks occluded targets and prefires blind corners. Score the *distribution* of
  "aim-locked-while-occluded" and "corner-peek reaction delay" — flag the floor, not single events.
- **Cost:** medium (occlusion test per candidate aim/target pair — reuse the trace/PVS we already
  run). **FP risk:** medium — good players pre-aim common angles from game sense, so it needs volume
  + the distribution, never one peek.
- **Why it matters:** pure server ground truth, and it targets the exact cheat class PVS culling
  *doesn't* fully kill (clients that reconstruct hidden state from the wire). **Phase:** D.

### 2.8 Aim-trajectory shape (snap-and-lock vs human arc)
- **Catches:** aimbots by the *shape* of the aim path into a kill, not just its speed. Humans arc,
  overshoot, and micro-correct onto a target; many aimbots slew in a near-straight angular line to
  target-center and lock with no overshoot.
- **How:** reconstruct the angular path from the usercmd yaw/pitch stream in the moments before a
  hit; score straightness / overshoot / settle time. Too-perfect or bimodal paths flag.
- **Cost:** low-med (reuses the angle stream WO-12 already samples). **FP risk:** med — calibrate
  from human demos (§3). **Phase:** D.

> **Not worth building:** client memory/integrity checks, screenshot/streamproof, "signature"
> detection of known cheat binaries (OSS → recompile defeats it), CAPTCHAs, hardware bans (trivially
> evaded, hostile to honest users). These are cost with ~no durable benefit here.

---

## 3. Evidence & review (Layer 3)

- **Deterministic re-simulation — a ground-truth oracle almost no game has.** ⭐⭐ Two facts are
  already true of this codebase: the server sim is **deterministic** (`server:fuzz` proves
  run1 == run2 for the same inputs), and we have a **demo pipeline**. Add a **usercmd (input) track**
  to demos and you can *replay a recorded match's inputs back through the authoritative simulation
  and verify the outputs reconcile.* That unlocks three things at once:
  - **Tamper-evident demos** — a doctored demo won't re-simulate cleanly.
  - **A perfect offline detector oracle** — re-run *any* Layer-2 detector (accuracy, occlusion-aim,
    flick) on the exact match at full server fidelity. This is what the calibration harness (§ below)
    and appeals actually need.
  - **The definitive appeal answer** — "here are your recorded inputs; the authoritative sim says
    *this* is what happened." No he-said-she-said.

  It's a modest change (record inputs alongside snapshots) that turns demos from "a replay" into a
  *verifiable ground-truth record* and upgrades half of Layers 2–3 for near-free. **Foundational —
  build it early.**
- **Demo files as the telemetry sink.** ⭐ The `.shagdemo` already records full match snapshots.
  Write a **per-client telemetry track** (§2 signals) into a sidecar/footer. Then a suspect match
  can be *replayed and reviewed offline* with the aim/accuracy/impossible-input data attached —
  the demo system becomes the concrete **anti-cheat evidence store**, not just conceptually. This
  is the highest-leverage tie-in and it reuses a pipeline we already shipped.
- **Flag → review → decide.** Detection **flags**, humans (or a higher-confidence offline pass on
  the demo) **decide**. Never autoban on a live single-match signal — false positives on skilled
  players are more damaging than a slow cheater.
- **Appeals & tuning.** Recorded demos are the ground truth for both appeals and for calibrating
  thresholds against real human play (our own bot/human demos are a free labeled-ish dataset).
- **Calibrate against labeled data — for (nearly) free.** ⭐ Our demos are a clean-ish *human*
  dataset; we can also script an aimbot against our *own* server in a test harness to produce a
  *known-cheating* set. Tune every threshold and **measure the false-positive rate offline** on real
  human play *before* a signal gates anything. This is how §0.3's "cardinal sin" rule is actually
  enforced — no detector ships un-calibrated.
- **Community demo review (trust-weighted).** For a small open game, human review scales through the
  community: let players report, weight each report by the *reporter's* own trust, and surface
  suspect demos to volunteer reviewers (CS:GO-Overwatch-style). The demo pipeline makes this nearly
  free, and it's the one "detector" that can't be reverse-engineered from source — it's a person
  watching a replay.

---

## 4. Response (Layer 4 — the north star)

The durable answer to *"cheaters overpopulating honest players"* is **not** perfect detection —
it's **segregation**:

- **Per-account trust score** aggregating the §2 signals (accuracy outlier + impossible-input
  counters + flick shape + reaction floor) plus account age/history.
- **Soft matchmaking segregation** — low-trust accounts preferentially matched *together*. A
  cheater's best case becomes "ruin other cheaters' games," which is self-limiting and needs no
  perfect verdict.
- **Shadow actions over hard bans** where possible (lower matchmaking priority, restricted ranked)
  — bans invite ban-evasion churn; segregation is quieter and stickier.
- **New-account friction** — fresh/low-trust accounts start segregated and earn trust, so a banned
  cheater's new account doesn't immediately land among honest players.
- **Graduated response ladder** (reversible → severe): observe → shadow-lower matchmaking priority →
  restrict from ranked/tournament pools → segregate into a low-trust pool → *(last, high-confidence,
  offline-reviewed)* ban. Most cheaters never need the last rung; segregation alone achieves the
  mission and keeps false positives recoverable (§0.3).
- **Ban-evasion via behavioral linkage.** Caught cheaters re-register; movement/input-timing
  signatures and aim micro-patterns (all server-side, all statistical) can *softly* link a new
  account to a flagged one, so an alt starts low-trust instead of clean. Soft signal → trust weight,
  **never** an automatic ban.
- **Trusted / tournament pools — the realistic path to prize play.** You can't run an open-bracket
  money tournament on a free game with floating aimbots (the lesson of §0.1). What *does* work:
  vetted pools — LAN, invited/known players, a high-trust-score gate, mandatory demo submission +
  review, opt-in stricter client. The strict client is bypassable, but combined with a small vetted
  pool, social stakes, and post-hoc demo review, cheating becomes socially and practically costly.
  This is how real competitive scenes actually police money play — it sidesteps the unwinnable
  live-client fight instead of pretending to win it.

**The response layer lives in the LobbyServer, not the game server.** The historical tournaments
died at the *organizational* layer — open bracket, anyone joins. So trust scoring, pool assignment,
and segregation are fundamentally **matchmaking/lobby** concerns: the lobby is where a trust score
gates which pool (trusted / normal / low-trust) a player lands in. That reframes WO-14 (the
LobbyServer audit, `v0.9.16-server-authority.md`) — it isn't just a security pass, it's *building
the place where Layer 4 lives*. Game servers *produce* signals; the lobby *consumes* them into
matchmaking.

This is Phase-D-and-beyond, but it's the point of the whole substrate: §2 feeds a score, §3 backs
appeals and calibration, §4 keeps the honest majority insulated — and the trusted-pool path is what
eventually makes real competition possible again.

---

## 5. Prioritized roadmap

| # | Feature | Layer | Signal strength | Cost | FP risk | Phase |
|---|---------|-------|-----------------|------|---------|-------|
| 1 | Per-client telemetry substrate (jitter/loss/flick) | 2 | — (substrate) | M | — | **C (WO-12, done)** |
| 2 | Accuracy & headshot telemetry | 2 | **High** | S | Low* | **C (WO-AC1, done)** |
| 3 | Impossible-input hard counters | 2 | **High** (contract) | S | **Very low** | **C (WO-AC2, done)** |
| 4 | Flick histogram (angular-velocity shape) | 2 | Med-High | S | Low-Med | C/D |
| 5 | Demo telemetry sidecar (evidence store) | 3 | — (enables review) | M | — | D |
| 6 | Reaction-time / time-to-target | 2 | High | M | Med | D |
| 7 | Spinbot / view-entropy | 2 | Med (dumb cheats) | S | Low | D |
| 8 | Server-random canaries (ESP/wallhack bait) | 2 | Med-High | M | Low† | D |
| 9 | Occlusion-aware aim (wallhack/prefire) | 2 | **High** (best ESP tell) | M | Med | D |
| 10 | Aim-trajectory shape (snap vs arc) | 2 | Med-High | S | Med | D |
| 11 | Offline calibration harness (labeled demos) | 3 | — (enables everything) | M | — | **C/D** |
| 12 | Community demo review (trust-weighted) | 3 | High (human) | M | Low | D+ |
| 13 | Trust score + soft segregation | 4 | — (response) | L | — | D+ |
| 14 | Trusted / tournament pools | 4 | — (enables prize play) | M | — | D+ |
| 15 | LobbyServer / account security audit + trust pools | — | — (Layer-4 home) | L | — | D+ (own doc) |
| 16 | **Deterministic demo re-sim** (input track + verifier) | 3 | — (ground-truth oracle) | M | — | **C/D (foundational)** |

\* Low as a *signal*; never a solo verdict — always one input to the score.
† Only if the bait is genuinely unperceivable to an honest client (§2.6).

**Recommended near-term:** fold **#2 and #3 into Phase C** now, while the telemetry substrate is
fresh — they're cheap, reuse data we already compute, and turn the substrate from "netcode-quality"
into "genuinely detection-ready." Stand up the **calibration harness (#11)** early too — it's the
guardrail that lets any later signal ship without risking false-positive harm (§0.3). Everything
else is Phase D, gated on the demo evidence sidecar (#5) which makes tuning and review tractable.

---

## 6. Prioritization & voting

Ordering is open to the team (and, later, the community). Keep it lightweight — a rough,
**RICE-ish** gut score beats endless debate:

- **Reach** — how many honest players it protects (every match? ranked only?).
- **Impact** — how strong the signal / how much it thins the herd.
- **Confidence** — how sure we are it works, and how *low* the false-positive risk.
- **Effort** — build + tuning cost (lower is better).

**Guiding rule of thumb:** `prevention > cheap detection that reuses data we already compute >
evidence tooling > response/segregation > exotic detection`. Ship signals that cost ~nothing before
anything that needs new per-tick work or new wire data.

Tally (append your initials; higher = do sooner). `[rec]` = assistant recommendation. This is a
living vote, not a binding one:

| Feature (§) | Votes | Notes |
|---|---|---|
| Accuracy & headshot telemetry (2.1) | `[rec]` | cheap, high signal — do first |
| Impossible-input counters (2.2) | `[rec]` | cheap, near-zero FP — do first |
| Calibration harness / labeled demos (§3) | `[rec]` | guardrail — build alongside first signals so nothing ships un-calibrated |
| Demo telemetry sidecar (§3) |  | unlocks offline review + threshold tuning |
| Occlusion-aware aim (2.7) |  | strongest server-side ESP tell |
| Flick histogram (2.3) |  |  |
| Aim-trajectory shape (2.8) |  |  |
| Reaction-time (2.4) |  |  |
| Server-random canaries (2.6) |  | strongest active probe vs ESP; design carefully |
| Spinbot / view-entropy (2.5) |  | cheap win vs dumb cheats |
| Trust score + segregation (§4) |  | north star; enables trusted tournament pools |
| Trusted / tournament pools (§4) |  | the realistic path back to prize play |

---

## 7. Near-term implementation guide (Phase C)

Agent-ready work orders for the recommended near-term set, against the **current code**
(`Telemetry.ts` from WO-12 is the foundation). Ground rules carry over from
`v0.9.16-server-authority.md` §7: fps submodule commits first; determinism gate (`server:fuzz`)
after each; everything here is derived from data the server already computes and lives in message
handlers / event drains / diagnostic logs — **not** sim-tick state — so it stays deterministic.
**No detector gates anything until the calibration harness (WO-AC3) has measured its FP rate (§0.3).**

Order: **AC1 → AC2 → AC3**, then the foundational **AC4** as its own slice.

### WO-AC1 — Accuracy & headshot telemetry  ·  Roadmap #2  ·  Effort S  ·  ✅ IMPLEMENTED
**Goal:** per-client accuracy% and headshot% (the strongest aim signal), from data we already produce.
**As built (deviates from the original sketch — cleaner, and consistent with how warp-strikes
already work):**
- Accounting lives in **`WeaponSystem`** (keyed by entity, where shot/hit/weapon-type semantics
  are), *not* in `Telemetry`. Same pattern as strikes in `MovementValidator`: the raw counters live
  next to the ground truth; `GameServer` **composes** them into the `[Telemetry]` log at flush time
  (it owns `entityId ↔ playerId`). No event draining, so **no double-drain risk** and no attribution
  plumbing through `GameServer.tick`.
- **Scope: single-ray hitscan only** (machinegun / electrobolt / instagun / lasergun / voltaic) —
  one trigger pull = one ray = 0/1 hit, the cleanest possible shot↔hit mapping and the strongest
  signal (rail accuracy, MG tracking%, HS%). **Pellet (riotgun) and projectile/splash weapons are
  excluded** — a blast has no clean shot↔hit ratio (multi-victim splash would inflate >100%).
  Documented as a deliberate v1 scope; extend later if needed.
- `traceHitscanRay` now returns `hitLocation` too; the single-ray path increments
  `shots`/`hits`/`headshots`. `WeaponSystem.getAccuracy(entityId)` exposes cumulative-per-entity
  (≈ per-match, since respawn reuses the entity id) counts.
- `GameServer.logClientTelemetry` composes `acc=` / `hs=` / `shots=` into the log line,
  **min-sample gated** (≥30 shots → `acc`, ≥10 hits → `hs`, else `n/a`) so small samples don't lie (§0.3).
**Files:** `WeaponSystem.ts` (accuracy map + getter + `traceHitscanRay` return + single-ray
accounting), `GameServer.ts` (`logClientTelemetry` compose). **Tests:** `WeaponSystem.test.ts`
(shot+hit on landing ray; shot-no-hit on miss + accumulation; zero for never-fired).
**Result:** 1167 tests green, tsc + biome clean, determinism holds.

### WO-AC2 — Impossible-input hard counters  ·  Roadmap #3  ·  Effort S  ·  ✅ IMPLEMENTED
**Goal:** per-client counters for input-contract violations — near-zero false positives because an
honest client trips them ~never. All are events we *already detect and discarded*; now we count them.
**As built:**
- `Telemetry.recordViolation(playerId, "rejected" | "clamped")` + `rejectedCmds` / `clampedCmds` in
  `ClientMetrics`.
- **rejected** — `GameServer.handleInput`, when `sanitizeCommand` returns `null` (non-finite
  dir/pitch/yaw). **clamped** — computed in `handleInput` from the *raw* command
  (`|pitch| > π/2` or `|wishdir_xz| > 1`), so no change to `sanitizeMovement`'s shape/tests (avoids
  breaking the `toEqual` sanitizer tests). Both need no new detection — the sanitizer already does it.
- **tripwire** — `FPSMovementSubsystem` bumps a per-entity `tripwireHits` counter in the WO-9
  warn block; `getTripwireHits(entityId)` exposes it; `GameServer` composes it at flush (entity→player),
  same pattern as accuracy/strikes.
- **warpStrikes** — already composed from `MovementValidator.getStrikes`.
- `logClientTelemetry` now appends `rejected=… clamped=… tripwire=…` to the `[Telemetry]` line.
**Files:** `Telemetry.ts` (+counters +`recordViolation`), `GameServer.ts` (record on reject/clamp;
compose tripwire), `FPSMovementSubsystem.ts` (`tripwireHits` +`getTripwireHits`). **Tests:**
`Telemetry.test.ts` (violation counters, untracked no-op), `FixedRatePhysics.test.ts` (tripwire
counter increments on an impossible delta).
**Result:** 1168 tests green, tsc + biome clean, determinism holds. Honest play → all ≈ 0.

### WO-AC3 — Offline calibration harness  ·  Roadmap #11  ·  Effort M  ·  the guardrail
**Goal:** measure detection% vs **false-positive%** per threshold against labeled data, so no signal
ships un-calibrated (§0.3).
**Approach:**
- New CLI (e.g. `anticheat:calibrate`): (a) a **human baseline** from our recorded demos; (b) a
  **scripted test-bench aimbot** — drive `BotServer`/usercmds with superhuman aim/reaction — as the
  cheating set. Run the Layer-2 detectors (AC1 accuracy, later occlusion/flick) over both; emit a
  detection% / FP% table per threshold.
- v1 can run detectors **live** during a scripted human-like-vs-aimbot session (no re-sim needed);
  v2 runs them over stored demos via WO-AC4.
**Key caveat to document:** our current demos are me-vs-bot — a small, biased baseline. Treat FP
numbers as **directional** until real player demos exist; that's a reason to record ranked demos
early (§3).
**Prompt:** *"Build an anticheat:calibrate CLI that runs the aim detectors over (a) recorded human
demos and (b) a scripted superhuman-aim bot session, and prints detection% vs false-positive% per
threshold. Document it in AGENTS.md; note the baseline is currently small/biased."*
**Acceptance:** repeatable command; aimbot run scores clearly above the human run on aim signals.

### WO-AC4 — Deterministic demo re-simulation  ·  Roadmap #16  ·  Effort M  ·  foundational (own slice)
**Goal:** record usercmds in demos + a verifier that replays them through the authoritative sim and
checks reconciliation → tamper-evident demos + a full-fidelity offline detector oracle + the
definitive appeal answer.
**Approach:** (a) extend `DemoRecorder` with a **usercmd track** (sanitized inputs per tick per
player); (b) a `demo:verify` CLI that builds a `GameServer` sim, feeds the recorded usercmds
tick-by-tick, and compares per-tick snapshot checksums to the recorded ones (same idea as
`server:fuzz`).
**Key work — determinism audit:** `server:fuzz` proves run1==run2 *within one process/seed*;
record→replay across processes needs **every** non-deterministic sim input captured or seeded.
**Known offender: weapon-drop scatter uses `Math.random()`** (`WeaponSystem.addWeapon` /
`dropAllWeapons`) → must be seeded or excluded from the reconciliation checksum. Spread is already
deterministic (`computeSpreadSeed`); KB has no RNG. Catalog and fix/seed all such sources first.
**Prompt:** *"Audit the server sim for non-determinism across a record→replay boundary (start with
the Math.random weapon-drop scatter). Then add a usercmd track to DemoRecorder and a demo:verify CLI
that re-simulates recorded inputs and asserts per-tick snapshot checksums match. Test: a clean bot
demo reconciles; a hand-edited demo fails."*
**Acceptance:** `demo:verify` reconciles a clean demo, rejects a tampered one; determinism sources
documented.

---

## Cross-links
- `docs/research/v0.9.16-server-authority.md` — Layer 1 (prevention), the sanitizer, PVS, tripwire,
  and the WO-12 telemetry work orders. WO-14 there is the home of Layer 4 (trust pools / lobby).
- Demo pipeline / `.shagdemo` — the evidence substrate for Layer 3 (and re-sim oracle, WO-AC4).
- `src/games/fps/server/Telemetry.ts` — the WO-12 substrate AC1/AC2 extend.
