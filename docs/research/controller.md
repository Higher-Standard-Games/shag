# Controller support implementation plan

Status: implemented on the feature branch; physical Xbox acceptance remains pending.
The sections below retain the design and acceptance checklist. The implementation
decisions and validation ledger at the end distinguish tested behavior from
hardware work still to do.
Source review: 2026-11-05, against engine `48ae787b` and FPS `4053c54`.
Feature branch: `feature/controller-support` in both repositories, created from
their respective local `main` branches.

## Goal and scope

Support an Xbox controller through the browser Gamepad API, with the owner's
USB-connected controller as the first hardware acceptance target. Extend Washoi
in `src/games/fps`; keep reusable device and navigation primitives in SHAG.

Use the same lobby, settings, match menus, dialogs, and HUD layouts as mouse,
keyboard, and touch. Add selection, focus styling, navigation metadata, and
small control adapters to those components. A Controller settings tab and its
controller diagram are new content in the existing settings screen, not a
parallel controller interface. Do not create alternate controller HTML pages,
duplicate menu trees, or make a virtual mouse the default navigation model.

Gameplay scope is every existing 1.0 gametype (Duel, Amphi, FFA, S&D), both solo
practice and network matches. Use `washoi_dm2` for the first repeatable gameplay
check; support must not depend on that map. Include joining, readying, death,
respawn, spectator/freefly, and returning to the lobby. Map-editor operation,
split-screen, a controller text keyboard, vibration, arbitrary nonstandard
device calibration, and additional gametypes are outside the first delivery.
Text entry can retain the physical keyboard or platform keyboard.

The USB connection is reported by the owner. Browser detection, actual device
mapping, firmware behavior, and hardware playability have not yet been tested.

## Verified starting points at the source-review commits

Paths below are relative to the assembled root.

| Source | Finding and implication |
| --- | --- |
| `src/engine/input/InputTypes.ts`, `BindingValidation.ts` | `gamepadButton` is accepted as a nonnegative integer, but the type calls it future support. There are no gamepad axes in the binding contract. |
| `src/engine/input/InputSystem.ts` | Action evaluation handles keys, mouse buttons, wheel, and virtual actions, but does not read gamepads. Initialization attaches to a Babylon scene. Account for lobby/startup navigation before scene input is available. |
| `src/engine/input/InputDevice.ts`, `src/engine/core/EventBus.ts` | Device identity and the device-change event support only `touch` and `keyboard_mouse`. `in_touch` is an existing testing override. |
| `src/engine/input/PlayCapture.ts`, `src/engine/camera/CameraInputHandler.ts` | Play is pointer lock or explicitly held touch play. Look application already handles camera limits and the FPS ADS sensitivity modifier. Extend capture semantics for controllers. |
| `src/games/fps/client/TouchControls.ts`, `camera/FPSController.ts` | Touch uses `setVirtualAction`, `setMoveAxis`, and `touchLook`. Reuse the underlying movement/look paths through device-neutral entry points rather than calling touch-specific APIs from the controller adapter. |
| `src/games/fps/client/MoveStick.ts` | Stick direction is normalized after a 0.12 dead zone; partial displacement still gives full movement speed. The current path provides arbitrary movement angle, not proportional walking speed. |
| `src/games/fps/client/FPSActions.ts` | Gameplay action IDs, defaults, and gameplay/spectator contexts already exist. The generic UI also has menu/confirm/cancel action names in `InputSystem.ts`. |
| `src/games/fps/client/MatchInputBindings.ts`, `Game.ts` | Some match UI and spectator behavior uses raw keyboard/mouse handlers and callbacks. Defining a controller binding alone will not make these actions work. |
| `src/games/fps/client/settings/FPSSettingsView.ts`, `SettingsModel.ts` | One settings view serves lobby and match hosts. Settings pages, reset behavior, and persistence status are centrally defined. |
| `src/games/fps/client/settings/ControlsPage.ts`, `InputDiagram.ts` | Keyboard/mouse diagram, grouped action rows, popovers, and capture already exist. Hover highlighting needs equivalent focus behavior. |
| `src/games/fps/client/settings/SettingsModel.ts` | `bindingToCode` drops unfamiliar binding types; `assignKey` rebuilds affected binding arrays from those codes. Adding gamepad bindings without changing this would let a keyboard edit erase them. `resetKeys` also resets whole actions. |
| `src/games/fps/client/settings/SettingsFields.ts` | Shared fields use buttons and range inputs. The custom select puts its listbox under `document.body` and keeps active-option state internally. It needs an adapter, not a generic query for buttons. |
| `src/games/fps/client/LobbyPanel.ts`, `client/hud/widgets/SettingsRailOverlay.ts` | Page navigation can be moved into a rail. Match settings puts its stage beside the dialog rail, so a navigation scope cannot simply query descendants of `[role=dialog]`. |
| `src/engine/ui/panels/GameDialogPanel.ts`, FPS `PauseMenu.ts` | Dialog open/close and match-menu callbacks exist. Focus and Escape handling are distributed; controller back must close only the active layer. |
| `src/games/fps/Game.ts`, `camera/FPSController.ts`, `src/engine/network/components/InputComponent.ts` | Existing commands carry movement direction and view angles. `ASSISTED_AIM` already exists; the FPS controller sets it for touch. Controller support can reuse that contract. |
| `src/shared/settings/SyncedSettings.ts` | `shag_keybindings` already follows the account. Persisted cvars under `in_` do not automatically sync; the allowlist must explicitly address new controller preferences. |

The browser API returns button/axis snapshots and exposes a standard mapping;
device indices can contain holes. A controller may remain undisclosed until
the player interacts with it. Implement detection against `mapping ===
"standard"`, not an Xbox name substring. See the
[W3C Gamepad specification](https://www.w3.org/TR/gamepad/), especially
`getGamepads()` and Remapping. Target a secure origin; verify the actual browser
and packaged runtimes separately rather than assuming identical support.

## 1. Device discovery and input ownership

Add a reusable `GamepadInput` service under `src/engine/input`. It owns device
enumeration, normalized snapshots, button edges, trigger thresholds, stick
filtering, and connection events. Inject its reader/time source for tests. Keep
FPS mappings out of engine code and browser types out of `src/shared`.

Start it from application startup so the lobby and ready screen can use it.
There must be one polling owner and one sample per application frame. The
gameplay action evaluator and UI navigation consume that sample, rather than
running independent polling loops. Establish and test the ordering: poll,
route input to the active scope, evaluate allowed actions, update gameplay,
then clear edges. Do not let scene attachment or FPS HUD destruction stop lobby
navigation or leave a second poll loop alive.

Device policy agreed with the owner:

- A controller button on the loading screen selects controller mode and starts
  the ready flow. A connection or stick motion alone never selects it.
- A click, Enter/Space, or touch starts with keyboard/mouse or touch as
  appropriate. Keep an early start choice while the rest of loading finishes.
- Consume the controller start press until release so it cannot confirm a
  lobby selection, jump, or fire in the next screen.
- Controller mode stays selected for the session, including while typing or
  moving the mouse. Those actions do not switch modes automatically.
- Offer Use controller / Use keyboard / mouse / Use touch in the Controller
  tab. A controller first used after startup becomes available for this explicit
  selection. Keyboard/mouse remain available for recovery and text entry.
- Retain `in_touch` as a developer override; document its precedence and show
  when it overrides the normal policy. Do not overload it with new numeric modes.
- Lock the active pad during play until disconnect or deliberate selection of
  another pad in settings. Do not silently combine two controllers.

Display Connected / Press a controller button / Disconnected / Unsupported
mapping / API unavailable with concise recovery advice. Include a device picker
when multiple pads are exposed. An empty mapping gets diagnostics and an honest
unsupported notice in v1, not guessed Xbox button indices.

Add a `gamepad` device kind to the device-change contract and audit all consumers.
Switching to it hides touch controls and changes prompts without changing page,
layout, or the player's selected settings tab. Explicitly clear the previous
analog source so touch and controller do not overwrite the same move axis.

Disconnect, blur, hidden tab, opening menus, and loss of play ownership release
all controller holds and axes. Disconnect during play leaves play and shows the
existing match menu with a reconnect notice; the online match continues. After
reconnect/resume, require neutral input and a fresh press before firing or
confirming. Never carry held A/RT across a menu or map transition.

## 2. Navigate the existing UI

Add an engine `UINavigation` service that accepts semantic intents: directions,
confirm, back, and optional previous/next group. Game-owned screens register
their active scopes and back/activation callbacks. Do not dispatch fake global
keyboard events or infer Back by searching button text. Use the existing click
handler for ordinary button activation and explicit adapters for complex fields.

Use real DOM focus and a controller-focus CSS class. The focus marker should
match existing raised-key/highlight styling, remain distinct from selected
values, and be visible on light and dark surfaces. Add focus-in/out behavior
where the diagram or action rows only highlight on mouse enter/leave. Mouse
movement restores normal pointer presentation without deleting keyboard focus.

### Navigation and scope rules

- D-pad and left stick move selection; a press moves once, a hold repeats after
  a delay. Use threshold hysteresis and choose one direction for diagonals.
- A activates; B backs out; Menu opens the match menu in play and resumes from
  its top level. B closes a child section/popover before its parent screen.
- Prefer explicit ordering within lists and groups. Across cards/columns, rank
  candidates by direction and alignment using their current layout rectangles.
  Allow small `data-nav-*` hints for ambiguous neighbors, default targets,
  groups, and stable identities. Do not hardcode viewport coordinates.
- Include enabled interactive elements only. Exclude hidden ancestors, inert
  regions, disabled/aria-disabled controls, decorations, and inactive pages.
  Scroll the chosen element into its nearest scroll container when needed.
- Register a scope with multiple roots where necessary: settings rail plus
  stage; an opened body-mounted select/popover becomes a child scope. The
  topmost scope alone consumes a press, regardless of z-index or listener order.
- Store focus by stable identity before a page redraw replaces DOM children.
  Restore the same action/field afterward, or the nearest valid fallback.
  Popovers/dialogs restore their opener when closed. Dynamic room lists and
  disabled Video settings must not strand focus.
- UI activation must not fire a gameplay action in the same frame. On closing
  a modal, consume the triggering press until release. Text fields and binding
  capture receive their own scopes; ordinary menu navigation yields to them.

### Existing field adapters

| Field | Controller behavior on the same component |
| --- | --- |
| Button, raised key, checkbox | Focus and A call the existing activation path. |
| Range slider | Left/right adjusts by the declared step, clamped to its bounds; up/down exits the row. Commit through the same input/change path and preference-write batching. |
| Segmented choice, swatches | Navigate sibling choices, A selects; selected state stays separate from focus. |
| Custom select/listbox | A opens, up/down changes the active option, A commits, B cancels; expose the component's internal operations to both input adapters. |
| Action binding row | A starts controller capture; a child scope owns the next input. |
| Text field | A focuses the existing field; typing uses the physical/platform keyboard. B leaves field editing before backing out of the screen. |
| Scrollable list or page | Selection scrolls into view; right stick scrolls the active region when not editing a field. |

Register and audit startup/ready, welcome/name/profile dialogs, lobby rail and
rooms, settings, loadout choices, join/team selection, ready controls, match
pause, confirmations, post-game, and spectator UI. Secondary lobby pages
(leaderboard, demos, credits) use the same service and need a reachability pass.
Preserve mouse, touch, and keyboard navigation throughout. Browser-protected
actions such as fullscreen, clipboard, or audio startup may still require a
real click/tap; check them explicitly and keep existing recovery feedback.

## 3. Controller settings and diagram

Add **Controller** beside **Controls** in `SETTINGS_PAGES`. Keep keyboard/mouse
on Controls. Build a `ControllerPage` hosted by the existing `FPSSettingsView`
so lobby and match settings share the implementation and saved state. This
also exposes the tab through each host's existing page rail.

Reuse cards, grouped action rows, selectors, sliders, saved-state feedback, and
reset confirmation. Add an inline SVG/CSS Xbox wireframe with real focusable
button hotspots and accessible labels. Use the same action-group colors as the
keyboard/mouse diagram. Outline and labels are ordinary source assets; no
generated bitmap or separate controller-themed stylesheet/layout is needed.

Show connection/mapping status, active pad, input policy, preset selector,
diagram, action mappings, and stick tuning. Highlight physically held buttons,
live trigger values, and stick positions in a test area. The test area consumes
input while active so checking RT does not fire a weapon or activate another
setting. Diagram and action-list selection highlight each other on focus as
well as pointer hover.

Initial presets are **Standard** and **Bumper jump**, plus **Custom** derived
from edited mappings. Applying a preset updates controller mappings only.
Reset Controller resets its mappings/tuning; Reset Controls resets only
keyboard/mouse; Reset all includes both. Opening a tab, connecting a pad, and
receiving an account sync must never reapply the preset over custom bindings.

### Proposed default mapping

These are design defaults to validate with the USB controller, not claims about
existing support. The browser's standard button numbering is the implementation
input; the table uses the labels shown to the player.

| Xbox control | Standard gameplay | Bumper jump difference |
| --- | --- | --- |
| Left stick | Move | Same |
| Right stick | Look | Same |
| RT / LT | Fire / aim | Same |
| A | Jump | Previous weapon |
| B | Crouch / slide, held | Same |
| X / Y | Use / reload | Same |
| LB / RB | Previous / next weapon | LB jumps; RB next weapon |
| Left stick click | Sprint modifier (walk with the existing Always run default) | Same |
| Right stick click | Blade | Same |
| D-pad left / right | Primary / secondary weapon | Same |
| D-pad up / down | Ready / join when allowed | Same |
| View | Hold scoreboard | Same |
| Menu | Open/resume match menu | Same |

In menus, D-pad/stick navigation, A confirm, B back, and Menu recovery are fixed
and independent of gameplay remaps. Contexts give the same physical button
different meanings without a conflict. Do not depend on the Xbox system button.
Spectator contexts use the same mapped intent layer for ascend/descend, chase,
target cycling, join, scoreboard, and menu; define and display those contextual
labels instead of inventing synthetic mouse clicks.

### Editing and persistence

Use `InputBinding.gamepadButton` for buttons/triggers and the existing action
registry. Keep paired move/look sticks as dedicated axis input with tuning and
an optional swap-sticks layout setting; do not expand a stick into four
on/off keyboard bindings. Analog axis-to-arbitrary-action remapping can follow
after the initial controller delivery.

Update binding helpers to filter/edit/reset by input family while preserving
the other families and unfamiliar valid bindings. Add controller defaults
without making existing saved keyboard overrides suppress those defaults.
Use a versioned, per-family default/override distinction, including explicit
empty mappings, while preserving account synchronization and import/export.
Implemented decision: controller actions use `gamepad:v1:<FPS-action-id>` entries
in the existing `shag_keybindings` dictionary. Their registered defaults are
independent of keyboard overrides. No JSON envelope or legacy-key migration is
needed; existing IDs/arrays retain their meaning, and an empty controller array
remains explicitly unbound. Presets/reset edit only the controller namespace.

Remapping flow: select an action with A, release controls to neutral, then press
the desired gameplay button. Menu cancels capture; an on-screen Cancel remains
reachable. B can therefore be bound to crouch without being mistaken for Back
inside capture. Keep Menu reserved for recovery. Show a same-context conflict
and a controller-operable Replace/Cancel choice before taking a button from
another action. Offer Clear separately; label unbound actions. Close capture
on disconnect, screen change, or lost focus. Reject noisy axes and partial
trigger motion as accidental captures.

Store new numeric settings through existing cvar/preferences mechanisms.
Registered controls: independent move
and look dead zones, horizontal/vertical look speed, response curve, invert Y,
and controller ADS scale. Keep device selection and input-policy override local;
sync mappings and personal look preferences deliberately through
`SyncedSettings.ts`. Device-specific dead zones should stay local. Retain
session-only storage failure feedback and cover reset/import/export/account
download in the implementation tests.

## 4. Gameplay integration and aiming

Add a game-owned adapter mapping sampled gamepad controls to `FPSActions` and
shared match UI callbacks. Keep source holds separate before aggregating them:
releasing a gamepad button must not release the same action still held by a
key or touch. The single `virtualHeld` set is not sufficient for independently
owned sources without extending its ownership model.

Generalize touch-specific move/look entry points and play capture so controller
play needs no pointer lock and no touch overlay. Keep mouse pointer lock intact.
Update FPS, spectator/freefly, and resume paths to consume the correct analog
source. Route scoreboard, join, ready, pause, and spectator actions through
explicit shared callbacks/action intents alongside existing keyboard handlers.
Update prompts in weapon slots, pickup/use, hints, ready/join, and spectating
to show the active device's actual bindings, including remaps.

For movement, reuse the existing normalized arbitrary-angle path in v1.
Dead-zone filtering occurs before direction normalization. Full-speed movement
outside the dead zone matches touch; walking uses the existing sprint modifier.
Proportional walking is a separate shared-simulation/prediction change and is
not required to deliver this plan.

For look, convert filtered stick displacement to angular velocity, then apply
`turn = velocity * frameSeconds`. Rescale radial dead zones smoothly and clamp
oversized frame times after focus loss. Start with a simple power response curve;
provide precise center control and a sufficient full-stick turn rate. Do not
reuse touch-drag acceleration or multiply by mouse sensitivity. Preserve pitch
limits, view freeze, and exactly one intended ADS scaling stage.

Evaluate the existing FPS aim-assist helpers with the controller rather than
silently inheriting touch tuning. Initial hardware validation should include
assist off to judge raw stick response. Tune and expose controller assist in a
follow-up patch within this feature if needed; mark its acceptance separately.
Reuse the existing `ASSISTED_AIM` device claim for controller play, consistent
with its touch/controller contract and scoreboard/telemetry behavior. Keyboard
takeover must clear it when controller ownership ends.

No snapshot, demo-format, or server-rule change is expected for normalized
movement, view angles, and the existing assisted-input flag. If implementation
proves otherwise, read the protocol-change procedure and revise this plan
before changing the contract. Do not classify a prediction-input edit as low
risk merely because it sits in the FPS camera controller.

## 5. Implementation sequence

Each patch must leave keyboard, mouse, and touch usable.

1. **Input foundation and migration.** Engine polling/normalization, source
   ownership, device identity/event changes, per-family binding persistence,
   migration, diagnostics, and lifecycle tests. Hook one sampler into startup
   and frame ordering. Inspect actual USB ID/mapping/axes in the test view.
2. **Existing UI navigation.** Scope stack, focus/selection styling, geometry
   navigation with explicit overrides, shared-field adapters, and focus
   restoration. Make startup-to-settings and pause-to-resume paths usable.
3. **Controller tab.** Shared settings page, diagram, live test area, Standard
   and Bumper jump presets, remapping/conflicts, tuning, resets, persistence,
   and account sync. Complete before relying on the hardware user to tune play.
4. **Gameplay and match UI.** Device-neutral capture/move/look, gameplay action
   mappings, raw-key callback bridges, contextual spectator controls, and bound
   prompts. Check prediction-input regressions even if no wire bytes change.
5. **Hardware tuning and reachability.** Owner's USB Xbox controller, aiming and
   advanced movement, menu audit across responsive layouts, disconnect/reconnect,
   device switching, and optional aim-assist tuning. Update player/developer
   manuals and the living changelog to describe only implemented behavior.

New runtime files: engine `input/GamepadInput.ts`, engine
`ui/navigation/UINavigation.ts`, FPS `client/ControllerInput.ts`,
`client/ControllerEvents.ts`, and settings `ControllerPage.ts`,
`ControllerPage.css`, and `ControllerModel.ts`. The inline controller diagram
lives in ControllerPage. Main modification points are the verified sources
above, startup composition, shared UI components, and their tests.

## 6. Validation and acceptance

Use deterministic fake pad snapshots for button edges, independent holds,
triggers, dead-zone boundaries, drift, repeat timing, pad selection, missing
API, disconnect, focus transitions, and no same-press action leakage. Test
equivalent look displacement over equal elapsed time at 30/60/144 FPS.

DOM tests should cover navigation over visible elements, rail/stage scopes,
body-mounted popovers, sliders/selects, nested Back, redraw focus restoration,
disabled Video settings, and existing mouse/keyboard/touch operation. Binding
tests must cover legacy migration, explicit unbound mappings, presets, conflict
replacement, reset isolation, and account/import/export round trips.

### Headless before browser/hardware QA

Run from the assembled root and check command output, not just exit status:

```text
npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm --prefix src/games/fps run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
npm run typecheck
npm run test:run
npm run build
npm run gate:biome
npm run docs:build
```

Use `.claude/skills/regression-check/SKILL.md` for any prediction/networking or
renderer changes. Its additional commands are:

```text
npm --prefix src/games/fps run server:tick
npm --prefix src/games/fps run server:fuzz -- --ticks 1000
```

Run the FPS manual's `docs:build` when changing that manual. Use the
`browser-probe` and `local-stack` procedures for real browser/network QA;
automated fake-pad tests do not establish physical-controller support.

### USB Xbox acceptance session

Record browser/runtime version, reported ID, mapping, and connection type.

- Open the game, press a controller button, reach the lobby and Controller tab.
  Check startup/audio/fullscreen behavior; document any required initial click.
- Navigate lobby rooms and settings without a mouse. Every actionable control
  has a visible selection and reachable activation/back path. Test both a wide
  desktop viewport and a narrow layout; text typing is the stated exception.
- Apply each preset, remap an action, clear it, resolve a conflict, reset just
  Controller, and reload. Confirm keyboard bindings remain unchanged. Check an
  account settings round trip without losing controller or keyboard bindings.
- Play `washoi_dm2` in practice, then a local network match. Move/aim/fire/ADS,
  reload/use, change the three carried weapons, ready/join, die/respawn, and
  spectate. Check strafe jumps, wall jumps, and crouchslide with both presets.
- Check resting-stick drift, small corrections, full turns, ADS, and assist
  off/on if implemented. Compare behavior across frame-rate caps.
- Open settings while holding RT, resume while holding A, unplug while moving,
  reconnect with a displaced stick, alt-tab, and switch mouse/touch/controller.
  No stuck input, accidental shot/confirmation, focus theft, or duplicate loop.
- Check prompts after custom remaps and the existing assisted-input indication.
  Verify Duel, Amphi, FFA, and S&D context-specific flows during final QA.

Hardware acceptance is complete when the same UI supports the above navigation,
controller mappings/tuning persist safely, gameplay and spectator controls work,
required gates pass, hardware results are recorded, and manuals/changelog match
the implementation. Automated tests and fake-pad browser probes do not establish
physical stick feel or USB/Bluetooth compatibility. Record those separately.

## Implementation decisions and validation

The follow-up [code review](./controller-review.md) records concrete findings,
their fixes and regression coverage.

- Startup owns the single GamepadInput animation-frame sampler. It starts
  before renderer creation so loading-screen selection works early. Frame
  routing handles UI before gameplay and clears input across scene/UI handoffs.
- Source-owned virtual holds prevent controller releases from cancelling touch
  holds. Movement and camera turns use the existing FPS/freefly paths. Controller
  look has its own sensitivity, inversion, response, ADS scale and aim assist.
- Generic panels/dialogs register existing roots; custom name/profile/welcome,
  loadout, join, post-game and settings popovers register explicit scopes. Match
  settings includes its stage as well as its rail. Back, slider and listbox
  operations call existing handlers rather than synthetic keyboard events.
- Controller defaults/presets use the versioned binding namespace above. Look
  preferences use an explicit account-sync allowlist; dead zones remain local.
- Existing normalized move-axis and assisted-input contracts are reused. No
  network packet, snapshot, demo format, server rule, or gametype was changed.
- Automated coverage includes loading-screen activation, sticky selection,
  disconnect/replacement pads, neutral handoffs, source ownership, equivalent
  30/60/144 FPS turning, binding-family isolation, persistence, and DOM focus.

Validation commands, final results, file inventory and browser screenshots are
recorded in the implementation handoff generated under
`.agent/controller-qa/report.md`. Physical USB/Bluetooth play, detailed aim-assist
tuning, and live acceptance of every gametype remain distinct hardware/manual
checks; do not infer them from passing fake-pad probes.

### Validation recorded on 2026-11-05

- Clean full suite: 777 files passed; 5,996 tests passed and one skipped.
  An overloaded concurrent run had four timing failures in unchanged benchmark,
  bot-invite and compiler tests. All 21 tests in those four files passed in an
  isolated recheck, followed by the clean full run above. No timeout or baseline
  was raised to obtain the passing result.
- `npm run typecheck`, `npm run build`, `npm run gate:biome`, engine
  `npm run docs:build`, and FPS `npm --prefix src/games/fps run docs:build`
  passed. Biome stayed at zero errors and 47 baseline warnings.
- Required headless map, 91-tick movement replay, simulation, physics,
  server-tick and 1,000-tick fuzz checks passed. The map check reported 7,475 faces.
- Headless Edge on the real GPU with WebGL2 and injected standard-pad snapshots
  confirmed startup selection, navigation, conflict-aware remapping, preserved
  focus at 540-pixel width without horizontal overflow, movement, turning, fire,
  and disconnect-to-menu behavior in solo Duel practice on `washoi_dm2`.
  The player moved 326.3 horizontal units and turned 32.1 degrees in the sampled
  input interval. The successful probe had no browser errors or failed HTTP
  requests; existing transport fallback, model-skin and map-entity warnings
  remain in its diagnostics.
- Typing safety is covered by the runtime tests: entering a text field releases
  controller gameplay input and a held trigger cannot fire again until released.
  Chat owns a navigation scope and releases it on close, hide or destruction.
- Physical USB/Bluetooth input, subjective stick feel/aim-assist tuning, other
  native runtimes and a live controller pass through every gametype remain
  unverified. Temporary QA servers and browser instances were stopped. No
  commits or pushes were made.

### Hardware feedback and navigation follow-up on 2026-11-06

The user confirmed the physical Xbox controller worked and gameplay felt smooth.
A read-only Windows check also found the Xbox Controller and XINPUT-compatible
HID device with status OK. This confirms basic physical input; Bluetooth and
acceptance of every action, menu and gametype are not inferred from that report.

The follow-up addresses the reported Escape-menu browsing difficulty with an
ordered vertical pause-menu scope and the shared raised-key focus styling.
The main menu has an explicit left-rail entry point. Entering a room prefers
an enabled map-vote card, or Ready when a map is already selected; leaving the
room returns entry focus to the rail. Entry resets do not move focus behind
an active modal. D-pad navigation worked in the before probe; the exact
original hardware failure was not reproduced there.

The final feature suite passed 779 files: 6,025 tests passed and one was skipped.
Headless map loading, the 91-tick movement replay, simulation, physics and server
determinism checks passed before release. Browser QA on the real GPU confirmed
both D-pad and left-stick pause-menu navigation, access to Controller settings,
map-vote entry and selection, and return focus to the main rail. Exact release
commands, results and commit/file inventories are recorded under
`.agent/controller-qa/beta6-release-report.md`.
