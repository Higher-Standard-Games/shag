# Anti-Cheat Features — Research & Roadmap

**Status:** Research + active build (Phase C). Companion to `docs/research/v0.9.16-server-authority.md`
(the server-authority *prevention* layer). This doc is the *detection*, *evidence*, and *response*
layers — the part that deals with cheats authority alone can't stop. **Shipped so far:** WO-12
telemetry substrate; WO-AC1 accuracy/headshot; WO-AC2 impossible-input counters; Phase D flick histogram substrate (log-only); sim RNG determinism
(R3/R3b); and the WO-AC4 re-sim **oracle** (`ReSim.ts` — tamper-evident replay, movement scope). See
§7. WO-AC4 (`ReSim` oracle + `ReSimBundle` + `demo:verify`) done; **R10 blocker cleared** (full
weapon+combat+projectile stack proven deterministic under replay); **WO-AC3 calibration harness**
(`anticheat:calibrate`) done. Next: real-demo calibration (R2, needs full-match re-sim R10) or the
Phase D detection signals (occlusion-aim, reaction; flick histogram substrate is log-only).

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
- **Hook:** `Telemetry.recordInput` (already receives pitch/yaw) buckets the computed speed.
- **Status:** substrate implemented as cumulative `flickHistogram` telemetry + `flickHist=` logs. Log-only until R2 real-demo calibration.
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
| 4 | Flick histogram (angular-velocity shape) | 2 | Med-High | S | Low-Med | **C — substrate done (log-only); R2 gates** |
| 5 | Demo telemetry sidecar (evidence store) | 3 | — (enables review) | M | — | D |
| 6 | Reaction-time / time-to-target | 2 | High | M | Med | D |
| 7 | Spinbot / view-entropy | 2 | Med (dumb cheats) | S | Low | D |
| 8 | Server-random canaries (ESP/wallhack bait) | 2 | Med-High | M | Low† | D |
| 9 | Occlusion-aware aim (wallhack/prefire) | 2 | **High** (best ESP tell) | M | Med | D |
| 10 | Aim-trajectory shape (snap vs arc) | 2 | Med-High | S | Med | D |
| 11 | Offline calibration harness (labeled demos) | 3 | — (enables everything) | M | — | **C — DONE (synthetic; real-demo v2 open, R2)** |
| 12 | Community demo review (trust-weighted) | 3 | High (human) | M | Low | D+ |
| 13 | Trust score + soft segregation | 4 | — (response) | L | — | D+ |
| 14 | Trusted / tournament pools | 4 | — (enables prize play) | M | — | D+ |
| 15 | LobbyServer / account security audit + trust pools | — | — (Layer-4 home) | L | — | D+ (own doc) |
| 16 | **Deterministic demo re-sim** (oracle + bundle + `demo:verify`) | 3 | — (ground-truth oracle) | M | — | **C — DONE (movement scope); full-match = R10** |

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
| Flick histogram (2.3) | `[rec]` | substrate shipped log-only; R2 still blocks gates |
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

### WO-AC3 — Offline calibration harness  ·  Roadmap #11  ·  the guardrail  ·  ✅ IMPLEMENTED
**Goal:** measure detection% vs **false-positive%** per threshold against labeled data, so no signal
ships un-calibrated (§0.3).
**As built:** `src/games/fps/server/Calibrate.ts` + **`anticheat:calibrate` CLI**.
- `runAccuracyTrial(seed, aimNoiseDeg, ticks)` — a controlled full-combat trial (reusing the
  now-deterministic weapon+combat stack from R10): a shooter tracks a target and fires a machinegun
  with **seeded aim noise**. Near-zero noise = stand-in **aimbot**; several degrees = **human**.
  Returns the WO-AC1 accuracy (hits/shots).
- `calibrateAccuracy({trials, ticks, human/aimbot noise, thresholds})` runs N of each and returns,
  per threshold, **detection rate** (aimbots ≥ threshold) and **false-positive rate** (humans ≥
  threshold). `npm run anticheat:calibrate` prints the table.
- **Result today:** human ≈38% accuracy, aimbot ≈100% → clean separation; any threshold 50–99% gives
  100% detection / 0% FP *on this synthetic data*. That very cleanliness is the warning: real players
  aren't uniform-noise stand-ins.
**Key caveat (risk R2):** the synthetic human is a stand-in and our demos are me-vs-bot. Treat the
numbers as **directional**; recalibrate on real player demos before any threshold gates. Wiring the
harness to run over *recorded* demos is the natural v2 (needs the full-match re-sim, R10).
**Files:** `Calibrate.ts`, `Calibrate.test.ts` (determinism; aimbot ≫ human; a threshold with high
detection + low FP; FP monotonic in threshold), `src/cli/anticheat-calibrate.ts`.
**Acceptance:** ✅ repeatable command; aimbot scores clearly above human; FP/detection table emitted.

### WO-AC4 — Deterministic demo re-simulation  ·  Roadmap #16  ·  foundational  ·  ✅ IMPLEMENTED (movement scope; full-match = R10)
**Goal:** record usercmds in demos + a verifier that replays them through the authoritative sim and
checks reconciliation → tamper-evident demos + a full-fidelity offline detector oracle + the
definitive appeal answer.

**AC4a — re-sim oracle (✅ IMPLEMENTED):** `src/games/fps/server/ReSim.ts` —
`resimulate(spawns, log, ticks)` replays a recorded usercmd log through a fresh `FPSMovementSubsystem`
sim and emits a **per-tick state checksum** (`WorldState.checksum()`); `verifyAgainst(spawns, log,
golden[])` compares those to a golden series. `ReSim.test.ts` proves the three oracle properties:
determinism (two re-sims agree), clean reconciliation, and **tamper-evidence** — a doctored input log
*or* a doctored recorded checksum both diverge, at the expected tick. This is the computational heart
of `demo:verify`. Scope: **movement only** (the fixed-rate input path the determinism work targeted);
weapons/combat re-sim needs a collision world — tracked as a limitation, not yet built.

**AC4b — on-disk plumbing (✅ IMPLEMENTED):** rather than entangle the fragile `.shagdemo` footer
format with the (movement-scope) oracle, AC4b ships a **standalone re-sim bundle** — the cleaner,
decoupled artifact:
- `src/games/fps/server/ReSimBundle.ts` — a gzipped binary (magic `SHVR`, versioned) carrying
  `{tickRate, ticks, spawns, usercmd log, golden per-tick checksums}`. `buildBundle` runs the oracle
  to fill `golden`; `encodeBundle`/`decodeBundle` round-trip it; `verifyBundle(bytes)` re-sims and
  reconciles.
- **`demo:verify` CLI** (`src/cli/demo-verify.ts`, `npm run demo:verify -- <bundle>`) — exit 0 =
  reconciled, exit 1 = diverged (prints the tick) or unreadable. Verified end-to-end: a clean bundle
  reconciles; a corrupted one is rejected (gzip CRC / diverged tick).
- Tests: `ReSimBundle.test.ts` (round-trip; clean verify; doctored-golden and tampered-log both
  diverge; non-bundle bytes throw).

**Why a bundle, not `.shagdemo`:** the oracle is movement-scope, so a bundle it can actually
reconcile is the honest artifact today. Extending to verify a *full recorded `.shagdemo` match* needs
full-server re-sim (all subsystems + collision + join/respawn/event replay) — tracked as R10.

**R10 progress — full-stack determinism proven:** `ReSim.resimulateFull` runs movement + weapons +
combat + projectiles with the same per-tick damage forwarding as `GameServer.tick`, and
`stateChecksum` now folds in velocity + health/dead (not just position) so combat/knockback are
observable. `ReSim.test.ts` proves the full combat stack is **deterministic under replay** and that
combat is actually exercised. That clears R10's real blocker (was the full stack even deterministic?
— yes). The remaining R10 work is mechanical: a collision world, gametype/event replay, and recording
the event+usercmd+checksum stream live.
**Key work — determinism audit (✅ complete):** `server:fuzz` proves run1==run2 *within one
process/seed*; record→replay across processes needs **every** non-deterministic sim input captured
or seeded. **Done:** all sim-affecting RNG is now seeded from sim state via
`shared/DeterministicRng.ts` (`rngFrom(tick, entityId, salt)`) — `WeaponSystem` drop scatter +
projectile spread (R3), and `SpawnPointStrategy` + `jitterSpawn` selection (R3b). Hitscan spread was
already deterministic (`computeSpreadSeed`); KB has no RNG; the bot-ready `setTimeout` is wall-clock
pre-recording (out of scope). **The sim is now RNG-deterministic** — the remaining WO-AC4 work is the
demo usercmd track + the `demo:verify` re-sim checker itself.
**Prompt:** *"Audit the server sim for non-determinism across a record→replay boundary (start with
the Math.random weapon-drop scatter). Then add a usercmd track to DemoRecorder and a demo:verify CLI
that re-simulates recorded inputs and asserts per-tick snapshot checksums match. Test: a clean bot
demo reconciles; a hand-edited demo fails."*
**Acceptance:** `demo:verify` reconciles a clean demo, rejects a tampered one; determinism sources
documented.

---

## 8. Risk register (living)

Kept current as work lands. **Sev** = impact if unmitigated. **Status:** OPEN / MITIGATED / WATCH.

| # | Risk | Sev | Status | Mitigation / note |
|---|------|-----|--------|-------------------|
| R1 | **False positives** — a signal wired to auto-punish before calibration wrongly flags an honest player (the cardinal sin, §0.3) | **High** | MITIGATED | Everything shipped so far is **log-only, gates nothing**. Hard rule: no signal gates until WO-AC3 measures its FP rate; high-impact actions need offline review. |
| R2 | **Biased calibration data** — the calibration *harness* exists (WO-AC3), but its "human" is a synthetic uniform-noise stand-in and our demos are me-vs-bot, so FP thresholds are not yet trustworthy for real players | High | OPEN | `anticheat:calibrate` produces the detection/FP table; treat numbers as *directional* until fed real ranked demos (v2, needs full-match re-sim R10). **Still blocks trustworthy gating** — record real player demos early (§3). |
| R3 | **Determinism for re-sim (AC4)** — RNG in the sim breaks record→replay reconciliation | Med | MITIGATED | `WeaponSystem` drop scatter + projectile spread now seeded from sim state (`shared/DeterministicRng.ts`, `rngFrom(tick, entityId, salt)`). `DeterministicRng.test.ts` proves reproducibility; `server:fuzz` green. Sim RNG audit complete (see R3b). |
| R3b | **Spawn/respawn selection RNG** — `SpawnPointStrategy` (3 strategies) + `GametypeController.jitterSpawn` picked spawns via `Math.random()` | Med | MITIGATED | `choose()`/`jitterSpawn()` take a seeded `rng`; join/respawn/getSpawnPoint pass `rngFrom(tick, entityId)`; `SpawnDeterminism.test.ts` covers it. **Intentionally NOT seeded:** the bot auto-ready `setTimeout(Math.random()*5000)` — wall-clock lobby timing that runs *before* recording starts, outside the sim, so it can't affect re-sim. |
| R4 | **Accuracy scope evasion** — WO-AC1 is single-ray hitscan only; a cheater using only pellet/projectile weapons dodges the accuracy signal | Med | WATCH | Deliberate v1 scope; covered by other signals (occlusion-aim, flick, reaction). Revisit if pellet/projectile cheating shows up. |
| R5 | **Skilled-player overlap** — high accuracy / fast flicks / low reaction also describe genuinely great humans | Med | WATCH | Distributions + min-sample gating + score composition; **never a solo verdict** (§0.3). Calibrate the "impossible" bands from human demos. |
| R6 | **Open-source evasion** — cheaters read the detection code | Med | MITIGATED (by design) | Kerckhoffs (§0.2): secrets live in **server-side thresholds outside the repo** + no feedback loop (shadow-flag, offline decide, delayed respond). **Risk if thresholds ever get committed to the public repo** — keep them in deployment config. |
| R7 | **Telemetry map growth** — per-entity maps (`accuracy`, `tripwireHits`) grow with entity ids; `Telemetry`/physics clean on remove, but `WeaponSystem.accuracy` isn't cleared per-entity | Low | WATCH | Bounded by joins per server session; fine for now. Add cleanup if long-lived servers show growth. |
| R8 | **Jitter includes server scheduling** — telemetry jitter uses `performance.now`, so GC/load noise mixes with network jitter | Low | WATCH | It measures *arrival regularity* (which is what a jitter buffer cares about); calibrate accordingly, don't read as pure network jitter. |
| R9 | **Privacy scope creep** — behavioral collection drifting toward fingerprinting/surveillance | Med | MITIGATED | §0.3 guardrail: only gameplay-derived data, no hardware/machine inspection, bounded retention, transparent. Re-check when adding ban-evasion linkage (§4). |
| R10 | **Re-sim scope < full match** — verifying a real recorded `.shagdemo` (all subsystems + collision + join/respawn/event replay) | Med | PARTIALLY MITIGATED | **Blocker cleared:** `resimulateFull` (movement+weapon+combat+projectile) is proven **deterministic under replay** (`ReSim.test.ts` R10 block), and `stateChecksum` now folds in velocity + health/dead so combat/knockback are observable. So full-match re-sim is *achievable* — the remaining work is mechanical: a collision world (map via pk3 index), gametype respawn + join/disconnect **event replay**, and recording the event+usercmd+checksum stream during a live match. Not a determinism problem anymore. |

---

## Cross-links
- `docs/research/v0.9.16-server-authority.md` — Layer 1 (prevention), the sanitizer, PVS, tripwire,
  and the WO-12 telemetry work orders. WO-14 there is the home of Layer 4 (trust pools / lobby).
- Demo pipeline / `.shagdemo` — the evidence substrate for Layer 3 (and re-sim oracle, WO-AC4).
- `src/games/fps/server/Telemetry.ts` — the WO-12 substrate AC1/AC2 extend.
