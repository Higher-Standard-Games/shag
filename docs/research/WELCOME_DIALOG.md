# Welcome dialog / message of the day

Status: implemented, with headless and isolated browser validation recorded below.
This is a three-tab welcome flow shown once per initial client boot,
after the initial loading screen and account authentication/setup have finished.
It is shown to both new and returning players unless they have opted out of
automatic presentation on this browser. Returning from a game to the lobby must
not show it again. The final tab offers a saved opt-out, and a lobby help button
can always reopen the dialog. This supersedes the initial no-checkbox proposal.

## Experience and visual direction

Use a centered red dialog over a blurred, dimmed, non-interactive lobby. Match
the red keyboard-selection treatment in Controls: layered red/crimson faces,
dark red edges, strong cream text, raised keys, and a clearly selected tab. This
is a red dialog body, not just a red title bar over the existing gold panel.
Keep readable contrast on text, inactive tabs, focus rings and keycaps.

Three named tabs, numbered 1–3, remain visible. Clicking a tab or navigating it
with the keyboard changes the page; Next advances through the same sequence.
No automatic advance or timer. Content scrolls inside the dialog on small
screens while tabs and footer stay reachable. Use a short transition and honor
reduced-motion preferences. On narrow screens the mouse moves below the keyboard.

| Tab | Main content | Footer left | Footer right |
| --- | --- | --- | --- |
| Welcome to Washoi! | Short introduction | Empty | Next » |
| Your keys | Read-only keyboard and mouse | Go to keyboard setup | Next » |
| Tip of the day | Did you know? Movement lessons and one extra tip | Don't show this again checkbox | Close |

Use the arrow glyph visually, with an accessible label such as “Next: Your keys”.
The final Close removes the overlay, blur and interaction lock, and restores
focus to the lobby. Recommended standard keyboard behavior: Escape also closes
the dialog; closing alone never opts out. Initial presentation is not a
requirement to prove every page was read. Clicking the backdrop should not
dismiss it.

## Saved preference and lobby help button

On the final tab, place **[ ] Don't show this again** at the lower left, with
Close at the lower right. Add a short hint: “You can reopen this guide with ?
in the lobby.” First-time default is unchecked. On narrow screens, the checkbox
and hint wrap above the footer action without colliding with Close.

Persist checkbox changes immediately under a dedicated browser-local preference
such as `washoi.welcome.hideAutomatically`, using the existing `writePreference`
storage wrapper rather than a bare unchecked localStorage write. Store a boolean
value and parse it defensively; missing, malformed or inaccessible storage means
automatic presentation is enabled. Use the existing storage-failure feedback
pattern: if saving fails, explain “This choice couldn't be saved. The guide may
appear next time.” Never claim a successful persistent opt-out when it failed.
The preference contains no identity information and is browser-local, not synced
to an account. Do not reset it on updates or account switches.

When opened manually, the checkbox reflects the saved preference. Unchecking it
reenables automatic presentation on the next client boot. Changing it does not
immediately close or reopen the dialog. Escape/Close preserves the last saved
checkbox choice; automatic suppression and this boot's completed state are
separate concepts.

Add a small **?** button in a reserved bottom-right lobby footer row (final
placement), aligned with the chat panel's right edge. Reduce the page/chat height
to make room rather than overlaying the button. Keep the row extensible for
future links, with the FPS counter remaining at the top right.
Use a dark charcoal
or indigo raised 3D face, shaded side edge and cream glyph, visually distinct
from the yellow menu buttons. Align the footer with the chat panel and reserve
its height in the page layout so links cannot cover chat controls.
Keep a comfortable pointer/touch target even
if the glyph is small. Give it an accessible name and tooltip, “Welcome & tips”,
and visible keyboard focus.

Show this button only on the lobby's Play/main page, never inside match rooms or on Settings,
Leaderboard or Demos, nor in
gameplay, spectator, demo or map-loading overlays. Hide or disable it while an
identity dialog owns focus. It opens the same three-tab dialog at Welcome,
regardless of opt-out or prior completion. Avoid duplicate dialogs on repeated
clicks. On close, restore focus to the button; preserve the previous lobby page.
This is a local guide entry point, not an external help link or second settings
menu. The red dialog body remains the visual direction.

## Tab 1 — Welcome to Washoi!

Proposed copy:

> Fast movement. Loud weapons. One more round.
>
> Welcome to Washoi, an arena shooter where movement makes the difference.
> Chain jumps, slide through corners and push off walls to keep your momentum.
> Pick a match in the lobby, experiment with your movement, and find your flow.
>
> Here's a quick look at your controls and a few tricks to get you started.

Keep this short enough to read at a glance. The first version uses local,
version-controlled copy. A server-authored message of the day can be added
later; this plan does not require a new lobby protocol or remote HTML content.

## Tab 2 — Your keys

Proposed subtitle:

> Your controls, ready to go. You can change them in keyboard setup.

Reuse the Controls keyboard geometry, key legends and mouse illustration.
Highlight movement, jump, crouch, fire and weapon selection using the current
action colors; fade unassigned and unrelated keys strongly. Keep displayed
labels legible. Show action names with the highlighted keys so color is not
the only explanation. The mouse sits to the right at desktop widths.

This is a preview: no binding popovers, key capture, edits, hover prompts saying
“click to bind”, or tab stops on every key. Inline keycaps in the tips use the
same visual language, including mouse-button icons and wheel bindings.

Source bindings through the existing InputSystem and SettingsModel helpers:
`codesFor`, `codeName`, `inputName`, `KEYBOARD_ROWS`, `MOUSE_INPUTS`, `actionFor`
and the action/group metadata. Use `FPS.JUMP` and `FPS.CROUCH`, not literal
Space/C strings. Show all bound alternatives in the preview; in prose prefer
the first keyboard binding, then a mouse binding, with an indication of other
alternatives where space permits. If unbound, say “Jump is unbound” or “Crouch
is unbound” and provide the keyboard-setup action rather than inventing a key.

Extract a shared presentation component from ControlsPage. It should support
read-only rendering without constructing ControlsPage's editing listeners,
capture machinery, popovers and action list. Preserve the existing interactive
setup behavior and share its geometry/style rather than copying a second board.

### Go to keyboard setup

Suspend the welcome flow at Your keys, remove its blur and interaction lock,
and navigate to Settings → Controls using the existing FPS settings view.
Settings must remain fully usable. Show a small “Back to welcome” action in
that context; leaving the settings page through normal lobby navigation also
resumes the pending welcome flow at Your keys. Re-read bindings on resume.
Do not mark this session complete merely because the player opened setup.

The setup detour must not leave an invisible modal blocking Settings, nor
trigger a second full welcome flow. Account dialogs take priority if they open
during the detour. Preserve pending invitation/deep-link intent until the
welcome flow finishes.

## Tab 3 — Tip of the day

Heading: **Did you know?**

Always show these two short lessons together, with actual binding keycaps:

**Keep your momentum**

> Crouchsliding is essential. Build at least **{slideMinSpeed} u/s**, then press
> **{crouchBindings}** to slide and carry your speed through the arena.

**Reach a little higher**

> Can't quite reach that ledge? While airborne beside a wall, hold
> **{jumpBindings}** to charge a wall jump, then release to push off.

Use the movement configuration, not a hard-coded 400 u/s. Both
`DEFAULT_FPS_MOVEMENT_CONFIG.slideMinSpeed` and the current
`sv_slideMinSpeed` definition are **375**. In the initial lobby, there is no
joined match's authoritative movement config yet: use the standard profile
value as the fallback and label these as standard movement tips. If a valid
active rules/config source becomes available, use it instead. Do not imply a
local developer cvar is proof of a remote match's rules. Reuse an existing
public config accessor, or add a small FPS-owned reader; do not instantiate a
player simulation just to render the text.

Below the lessons, choose **one** secondary tip when the dialog opens and keep
it stable while changing tabs. Use a small local list with a random choice;
no daily server clock or storage history is needed for launch.

1. **Land softer:** “Hold **{crouchBindings}** before landing from a high fall
   to soften the impact.” Do not promise that every fall becomes harmless.
2. **Chain your movement:** “Jump out of a crouchslide with
   **{jumpBindings}** to turn the slide into another boosted jump.”

The proposed “jumping on a ledge gives a big movement boost if timed right”
tip remains a candidate for later verification. The inspected ledge-grab
pull-up finishes with a small forward velocity and explicitly no upward boost;
that does not establish the claimed timed ledge-jump mechanic. Do not teach it
as a confirmed rule until the exact move is reproduced and its source path
identified. This does not block the two verified secondary tips above.

## Startup and lifecycle

The existing WelcomeOverlay is the new-account name/key flow. Keep it distinct
from this introduction, for example `WelcomeDialog` or `LobbyWelcomeDialog`.
Do not replace authentication with the three-tab dialog.

Verified startup facts:

- `src/main.ts` constructs LobbyPanel behind the loading screen, waits briefly
  for its connection, waits for the user's Start action, hides LoadingScreen,
  and calls `lobby.show()`.
- `LobbyPanel.performLobbyLogin()` completes `ensureFpsLobbyConnection()`, then
  opens WelcomeOverlay for a newly created account; existing accounts continue
  directly to `runDeepLinkJoin()`.
- WelcomeOverlay's completion callback refreshes the player card and continues
  the deep link. LobbyPanel.show() is also used when returning to the lobby.
- Lobby transport `welcome` events can repeat after reconnects; they are not a
  safe once-per-boot presentation trigger.

Add an explicit initial-startup handoff after LoadingScreen is dismissed.
Keep the welcome state in the client boot/FPS UI coordinator, surviving lobby
view hide/show and reconstruction during that boot. Do not use accountIsNew(),
generic lobby.show(), or a socket welcome event as the once-per-boot guard.
Read localStorage only for the separate automatic-presentation preference.
An ordinary page reload starts a new boot and shows the dialog unless opted out.
Browser back/forward restoring the same live page should not reset completion.
When opted out, skip automatic presentation without blocking normal deep-link
joining. Manual help opening bypasses both opt-out and the completed guard.

Suggested state:

```text
pending → waiting-for-auth → open(tab)
                           ↕
                    suspended-for-controls
                           ↓
                        completed
```

Readiness is a conjunction: initial loading dismissed, authenticated lobby
ready, account setup completed if required, lobby visible, and no higher-priority
identity dialog. Set the open state before mounting to prevent duplicate opens.
Connection failure/capacity notices take priority; retry should present the
pending dialog when authentication later succeeds, once only. Account switches
must not replay a flow already completed in that boot.

Defer automatic invite/deep-link joins until this flow closes, including the
new-account completion path. On close, continue the existing one-shot join
logic once; do not lose or consume an invite while a blocking dialog is open.
Manual match launch controls are inaccessible behind the modal. If an external
transition starts loading a match, tear down the dialog safely and do not pop
it over gameplay or surprise the player on return; treat that boot's flow as
finished. Do not disable lobby networking, chat updates or authentication while
blocking background user input.

## Modal behavior and accessibility

- Put the overlay next to the lobby content, not inside the element being blurred
  or made inert. Blur/dim only the lobby background.
- Use `role="dialog"`, `aria-modal="true"`, an accessible heading, and standard
  tablist/tab/tabpanel semantics with selected state and arrow-key navigation.
- Make the background inert, not merely pointer-events:none. Trap focus inside
  the dialog and prevent lobby hotkeys/game input from handling modal keystrokes.
- Focus the selected tab or heading on open; Next announces the new panel. Give
  the final Close a clear keyboard focus state. Restore sensible lobby focus on
  close, or move focus into Controls during the setup detour.
- Restore prior inert, scroll-lock and blur states on every exit path. Destroy
  listeners and focus hooks on close, lobby destruction and failed transitions.
- Keep rendering read-only bindings accessible without hundreds of focusable
  key buttons. Include a compact text summary for screen readers.
- No new timers are needed for content; random selection happens once per open.

## Implementation order

1. Extract the keyboard/mouse presentation with a read-only mode. Validate that
   interactive setup, rebinding, fixed keys and mouse controls still work.
2. Build the red three-tab modal with static, polished copy; navigation, focus,
   inert background, scrolling and teardown should work independently.
3. Add current-binding keycaps, standard movement config text and stable random
   secondary-tip selection. Handle unbound/mouse-only and multiple bindings.
4. Wire the initial-boot readiness gate after authentication and splash dismissal;
   cover retries, existing/new accounts, deep links and match return.
5. Add the Controls detour/resume path, refresh bindings after edits, and verify
   no competing overlays remain active.
6. Add the saved opt-out and lobby-only dark help button. Cover storage failure,
   manual reopening, re-enabling automatic presentation and corner placement.
7. Update player/manual documentation and living changelog for the implemented
   behavior, then perform headless checks followed by browser QA.

Use the existing papercut branch in both repositories. Keep the UI and
binding/config adapters in FPS; put no new game-specific imports into generic
engine UI code. No new server message or auth protocol change is planned.

## Acceptance and validation

Headless tests should cover:

- Existing authenticated account: opens once after initial splash dismissal.
- New account/key restore: account setup first, introduction second; no overlap.
- Authentication retry, lobby reconnect and duplicate readiness events: one open.
- Return from a match, demo or settings after completion: no replay.
- Initial failure followed by successful authentication: pending flow still opens.
- Invitation/deep link: processed once after completion, never underneath modal.
- Tabs, Next, Close/Escape, focus restoration and inert/blur cleanup.
- Controls detour, changed bindings, unbound actions, mouse-only actions and
  multiple bindings; preview never edits or captures input.
- Configuration-derived slide threshold and stable random tip across tab changes.
- Destruction/transition while open leaves no active listeners or blocked lobby.
- First visit has an unchecked opt-out; checking it survives a reload and skips
  automatic display. Closing without checking does not suppress later boots.
- Manual help opens even when opted out or completed; it preserves the lobby
  page, reflects the saved checkbox and restores focus to its trigger.
- Unchecking opt-out reenables the next boot; corrupt/denied storage does not
  crash startup and failed saves show truthful feedback.
- Help button appears only in the lobby and does not collide with FPS/corner
  controls at supported sizes; authentication retains focus priority.

Run the repository gates on implementation: `npm run typecheck`,
`npm run test:run`, `npm run gate:biome`, `npm run build`, `npm run docs:build`,
and `npm run docs:fps:build` when editing the game manual. Apply additional
networking regressions only if implementation actually changes those systems.
Use the browser-probe procedure after headless validation to inspect desktop,
narrow layouts and keyboard-only use, verify blur does not affect the dialog,
and reproduce initial login → dialog → settings detour → match → lobby return.

## Implementation and validation

The modal, shared read-only input diagram, startup/authentication gate, saved
opt-out and reserved lobby footer are implemented. The footer reduces the page
height and aligns links with the chat panel, leaving room for future links.

Files changed for this feature:

- `src/main.ts`
- `src/games/fps/client/LobbyPanel.ts`
- `src/games/fps/client/LobbyWelcomeDialog.ts`
- `src/games/fps/client/LobbyWelcomeGuide.ts`
- `src/games/fps/client/settings/InputDiagram.ts`
- `src/games/fps/client/settings/ControlsPage.ts`
- `src/games/fps/client/settings/FPSSettingsView.ts`
- `src/games/fps/client/styles/LobbyWelcomeDialog.css`
- `src/games/fps/client/styles/LobbyPanel.css`
- `src/games/fps/client/__tests__/LobbyWelcomeGuide.test.ts`
- `src/games/fps/docs/manual/multiplayer/lobby.md`
- `src/games/fps/docs/manual/player/first-match.md`
- `docs/changelog/v0.9.31.md`
- `docs/research/WELCOME_DIALOG.md`

Headless validation:

- `npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  620 files passed; 5,121 tests passed and one skipped.
- `npm run test:run -- src/games/fps/client/__tests__/LobbyWelcomeGuide.test.ts src/games/fps/client/__tests__/LobbyPanelRecovery.test.ts src/games/fps/client/settings/__tests__`:
  49 tests passed, including the final keyboard activation correction.
- `npm run typecheck`, `npm run build`, `npm run gate:biome`,
  `npm run docs:build`, and `npm run docs:fps:build`: passed.
- `git diff --check` in both repositories: passed.

The isolated browser probe uses a scratch lobby on port 9162 and private Vite
on port 3162 (`node .cache/welcome-probe.mjs`). It checks authentication/startup,
blur and input ownership, the Controls detour with a changed binding, native
keyboard closing, opt-out persistence across reloads, manual reopening,
re-enabling automatic display, and a 650-pixel layout.
The final browser run passed with no captured console errors or failed requests.
The help button and chat panel had the same right edge, with 24 pixels between
the chat bottom and help button top. Only UI integration changed for this feature;
no renderer, movement or networking protocol changes were needed.

### Footer backdrop follow-up

`LobbyPanel.ts` measures the links row with a cleaned-up `ResizeObserver`.
`LobbyPanel.css` extends the page decoration behind that row while adding the
same height to the content's bottom padding. The narrow Play layout keeps its
natural content height so scrolling the stacked chat to the bottom still leaves
its controls above the footer. The living changelog records this correction.

Validation: `npm run typecheck`, the two welcome/recovery test files (19 passing
tests), `npm run gate:biome` and `npm run build`. The isolated browser check
`node .cache/footer-backdrop-probe.mjs` confirmed the page and light layer reach
the stage bottom. Chat clears the help button by 24 pixels on desktop and about
20 pixels at 650 pixels wide, with no captured console errors or failed requests.
This assumes the existing lobby page layouts; other browser engines were not
tested in this follow-up.

### Play-only help entry point

The help button now appears only on Play. `LobbyPanel.ts` refreshes the guide on
tab changes; `LobbyWelcomeGuide.ts` separates manual-help visibility from modal
eligibility so the Controls detour still works. Hidden help also collapses the
empty footer. Changes include the welcome lifecycle test, lobby manual,
changelog and this note.

Validation: `npm run typecheck`; `npm run test:run -- src/games/fps/client/__tests__/LobbyWelcomeGuide.test.ts src/games/fps/client/__tests__/LobbyPanelRecovery.test.ts`
(20 tests passed); `npm run gate:biome`; `npm run build`; and
`npm run docs:fps:build`. `node .cache/play-help-probe.mjs` verified that Demos,
Leaderboard and Settings hide help and reclaim all 56 pixels of footer height;
returning to Play restores it. No browser console errors or failed requests were
captured. This changes only the manual entry point, not initial welcome timing.

The main-page restriction also excludes match rooms within the Play tab.
`LobbyPanel.ts` checks for an active room view and refreshes help on room entry
and return. The same 20 welcome/recovery tests, typecheck, Biome gate, production
build and FPS manual build passed after this correction. The isolated browser
probe `node .cache/main-help-probe.mjs` created a private room and left it:
the footer measured 56 pixels on main Play, zero inside the room, and 56 again
on return, with no captured console errors or failed requests. This room check
does not launch a gameplay server.

Assumptions: tips describe standard movement rules (the source default is
375 u/s for crouchslide), and suppression is local to this browser. Actual
match/demo return and a remote invite handoff were not exercised in this browser
probe; headless tests cover lobby departure and deferred invite handling.
