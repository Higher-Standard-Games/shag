# Controller implementation review

Reviewed on 2026-11-05 against the uncommitted `feature/controller-support`
implementation in the engine and FPS repositories. Scope: browser standard-pad
sampling, loading-screen activation, gameplay and spectator routing, shared DOM
navigation, binding persistence, settings lifecycle, and cleanup. No new game
mode, map, packet, snapshot, demo format or server rule is introduced.

## Findings and fixes

All findings below are fixed in the working tree. Severity describes their
impact before the fix.

| Severity | Finding and reproduction | Fix and regression coverage |
| --- | --- | --- |
| P1 | After closing a menu, a resting stick above the hardcoded 0.10 threshold but inside its configured dead zone could keep all controller input blocked indefinitely. | `GamepadInput.ts` accepts physical-stick radial dead zones from `ControllerInput.ts`, respecting swapped sticks. Sampling and runtime tests exercise diagonal drift, larger configured zones, swaps and rearming. |
| P1 | A throwing frame subscriber aborted the sampler before the next animation frame was scheduled. A runtime error during gameplay could leave a virtual action held. | Sampler subscribers are isolated and errors are reported once per failure streak. The gameplay subscriber clears its actions and exits play on failure. Tests cover continued polling, other subscribers, recovery, stop inside a callback and held-fire cleanup. |
| P1 | Actions outside the active input context retained their previous held state, even after a blocking context took ownership. | `InputSystem.ts` clears inactive actions and reports release once. A regression test holds Jump across a blocking context and releases its source while blocked. |
| P2 | Releasing a controller action could report release while its keyboard binding was still held, and vice versa. Tab and View could also hide each other's scoreboard. | Aggregate action release requires all sources to be released. Match scoreboard holds track keyboard and gamepad ownership and clear on blur. Tests release each source in both orders. Same-frame taps and continuous wheel behavior are preserved. |
| P2 | Navigation could use a scope inside a hidden/inert ancestor, activate an old selection after native focus changed, or restore focus behind a still-open child dialog. | Scope visibility checks ancestors, live native focus updates selection, and removing a covered scope does not restore its opener. Deferred restoration handles background inertness during modal cleanup. DOM tests cover each case and stable focus after redraw. |
| P2 | An open settings list lives on `document.body`; hiding its owner could leave both the list and its controller scope active. | Settings explicitly dismiss owned lists on page change, pause and destruction. Tests check the DOM, expanded state and navigation scope for all three exits. |
| P2 | Simultaneous Confirm and Back could activate a control and back out of the resulting dialog in the same sample. | Back takes priority and the adapter stops routing further intents after a scope revision. A runtime test verifies only Back is delivered for simultaneous A/B. |
| P2 | Controller navigation scanned and visibility-checked every control every animation frame, including the large keyboard settings page. | Stable selection uses a fast path; full candidate scans happen for selection recovery and navigation. A 100-control regression checks that idle refreshes do not rescan the page. |
| P2 | Movement prompts always named the left stick, spectator chase prompts retained keyboard arrows, and spectator cues were frozen at construction. | Movement labels respect swapped sticks. Spectator cues refresh on mode/device/play transitions and chase-target refreshes; previous/next prompts read the actual bindings. Tests remap actions, swap sticks and resume. Controller hints describe the look stick and mapped weapon buttons. |

## Validation and limits

Validation results and the exact changed-file inventory are recorded after the
checks in `.agent/controller-qa/review-report.md`. Focused regression coverage
is in the sampler, virtual-action, navigation, controller-runtime, match-input,
spectator-prompt and settings-view test files.

Browser probes use injected standard-pad snapshots in headless Edge on the real
GPU. Gameplay smoke testing assumes solo Duel practice on `washoi_dm2`; shared
input behavior is intended for Duel, Amphi, FFA and S&D. Required headless
simulation/physics and server determinism checks exercise existing shared
contracts. On 2026-11-06 the user confirmed physical Xbox controller input worked
and gameplay felt smooth. Windows also reported the Xbox Controller and its
XINPUT-compatible HID device with status OK. The user reported difficulty
browsing the Escape menu; the follow-up adds ordered pause-menu navigation,
explicit main-menu/room entry focus and controller-specific raised-key focus
styling. D-pad navigation worked in the reproduction probe before this change;
the exact original failure was not reproduced. Bluetooth, subjective tuning,
native runtimes and a live controller pass through every gametype remain
separate acceptance checks.
